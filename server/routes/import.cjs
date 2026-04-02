const { Router } = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { pool } = require("../db.cjs");
const { snakeToCamel } = require("../utils.cjs");
const { broadcast } = require("../ws.cjs");

const router = Router();
const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TMP_DIR = path.join(__dirname, "..", "..", "crm-data", "tmp");
fs.mkdirSync(TMP_DIR, { recursive: true });

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
});

const ACCOUNT_KEYWORDS = {
  altura: "Altura GS",
  yoon: "Yoon Engineering",
  avs: "AVS GS",
};

const FOREIGN_PARSE_PROMPT = `You are an expert financial document parser for an aircraft spare parts company. 
Extract payment information from the bank document text below.

Return ONLY valid JSON with these fields (use null if not found):
{
  "payer": "Full legal name of the paying/ordering company",
  "beneficiary": "Full legal name of the receiving company (supplier/vendor being paid)",
  "amount": 18000.00,
  "currency": "USD",
  "fees": 76.11,
  "date": "2026-03-13",
  "reference": "AT26-0029",
  "bankName": "SIAM COMMERCIAL BANK"
}

CRITICAL RULES:
- "payer" — the company SENDING money (debtor, applicant, ordering customer). Look for: Applicant, Ordering Customer, Sender, Remitter, Customer Name
- "beneficiary" — the company RECEIVING money (creditor, beneficiary). Look for: Beneficiary, Payee, Receiver
- "amount" — the PRINCIPAL transfer amount only (number, NO currency symbols). This is the amount being sent, NOT the total debit including fees
- "fees" — SUM of ALL bank charges, commissions, cable charges combined into ONE number. Look for: Commission, Bank Charge, Cable Charge, Service Fee, Comm.in Lieu. Add them all together. If fees are in a different currency (e.g. THB/BAT), convert them to the payment currency using the exchange rate shown in the document
- "date" — payment/value date in ISO format YYYY-MM-DD
- "currency" — 3-letter ISO code of the PAYMENT (USD, EUR, THB, AED, RUB, KZT, etc.)
- "reference" — a purchase order number or invoice number related to the business order. Common patterns: "AT26-0029", "YE26-0033", "INV-12345", "PO2026-4504". Check BOTH the document text AND the filename for order references. Do NOT use bank transaction/sender reference numbers (like "31538R2603130235"). Set null only if no order reference found anywhere
- "bankName" — the bank that ISSUED this document (sender's bank), not the beneficiary's bank
- Extract correctly regardless of document language (English, Thai, Russian, Arabic, etc.)
- Return ONLY the JSON object, no explanation

Document text:
`;

function normSpaces(value) {
  return String(value || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}

function normMatch(value) {
  return normSpaces(value).toLowerCase().replace(/[«»"'`]/g, "").trim();
}

function compactMatch(value) {
  return normMatch(value).replace(/[^a-zа-яё0-9]/gi, "");
}

function toIsoDateRu(value) {
  const match = String(value || "").match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseRuMoney(value) {
  if (!value) return 0;
  const clean = String(value)
    .replace(/\s+/g, "")
    .replace(/[^\d,-.]/g, "")
    .replace(",", ".")
    .replace(/-(\d{2})$/, ".$1");
  return parseFloat(clean) || 0;
}

function previousNonEmpty(lines, idx) {
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (lines[i]) return lines[i];
  }
  return "";
}

router.post("/match-ru", async (req, res) => {
  try {
    const { payer, amount, currency, reference, date } = req.body;
    if (!payer && !reference) {
      return res.json({ poMatches: [], finMatches: [], aiReasoning: null, aiConfidence: "none" });
    }

    const { rows: allPo } = await pool.query(
      "SELECT id, internal_po, internal_po_ref, supplier_name, supplier_amount, payment_status_customer, customer, customer_amount, date_ordered, status, terms_delivery FROM open_po WHERE status != 'cancelled' ORDER BY id DESC"
    );
    const poList = allPo.map((r) => ({
      id: r.id, internalPo: r.internal_po, internalPoRef: r.internal_po_ref,
      customer: r.customer, customerAmount: parseFloat(r.customer_amount) || 0,
      paymentStatusCustomer: r.payment_status_customer,
      supplierName: r.supplier_name, dateOrdered: r.date_ordered, status: r.status,
      termsDelivery: r.terms_delivery,
    }));

    const { rows: allFin } = await pool.query(
      "SELECT id, customer, customer_po, customer_amount, payment_fact, payment_date, payment_doc_file_id, order_date, status FROM fin_results WHERE status != 'cancelled' ORDER BY id DESC"
    );
    const finList = allFin.map((r) => ({
      id: r.id, customer: r.customer, customerPo: r.customer_po,
      customerAmount: parseFloat(r.customer_amount) || 0,
      paymentFact: parseFloat(r.payment_fact) || 0,
      paymentDate: r.payment_date, paymentDocFileId: r.payment_doc_file_id,
      orderDate: r.order_date, status: r.status,
    }));

    const poSummary = poList.map((p) =>
      `ID:${p.id} | PO:${p.internalPo} | ExtPO:${p.internalPoRef || ""} | Customer:${p.customer} | CustAmount:${p.customerAmount} | CustPayStatus:${p.paymentStatusCustomer} | Terms:${p.termsDelivery || ""} | OrderStatus:${p.status}`
    ).join("\n");

    const finSummary = finList.map((f) =>
      `ID:${f.id} | CustomerPO:${f.customerPo || ""} | Customer:${f.customer} | CustAmount:${f.customerAmount} | PaymentFact:${f.paymentFact} | PayDate:${f.paymentDate || ""} | Status:${f.status}`
    ).join("\n");

    const matchPrompt = `You are a smart matching engine for an aircraft spare parts company (Global Smart / ООО "Глобал Смарт").

A CUSTOMER PAYMENT was received (incoming payment FROM a client TO Global Smart):
- Payer (customer): ${payer || "unknown"}
- Amount: ${amount} ${currency || "RUB"}
- Contract/Reference from document: ${reference || "none"}
- Payment date: ${date || "unknown"}

Below are two lists:
1) Open Purchase Orders (Open PO) — find matching orders by customer name AND/OR contract reference number
2) Financial Results (Fin Results) — find matching records

MATCHING RULES:
1. Match by contract/reference number if present — it may appear in "Terms" or "CustomerPO" fields (e.g., "2025037432" matches "Договор 2025037432")
2. Match by customer name: "ООО Глобал Скай" = "Global Sky" = "Глобал Скай" (same company, different writing)
3. One payment may cover multiple POs/orders
4. If customer payment status is already "Paid", deprioritize
5. Amount can help verify match but may not match exactly (partial payment or combined payment)
6. Return BOTH PO IDs and Fin Result IDs that match

Return ONLY valid JSON:
{
  "matchedPoIds": [123],
  "matchedFinIds": [456],
  "confidence": "high",
  "reasoning": "Contract 2025037432 found in PO terms, customer matches"
}

If no match: {"matchedPoIds": [], "matchedFinIds": [], "confidence": "none", "reasoning": "No match found"}

=== Open Purchase Orders ===
${poSummary}

=== Financial Results ===
${finSummary}`;

    let aiMatches = { matchedPoIds: [], matchedFinIds: [], confidence: "none", reasoning: "" };
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a precise order matching engine for Russian payment documents. Return only valid JSON." },
          { role: "user", content: matchPrompt },
        ],
        temperature: 0,
        max_tokens: 600,
      });
      const raw = completion.choices[0]?.message?.content || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      aiMatches = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (e) {
      console.error("[Import-RU] AI match error:", e.message);
    }

    let poMatches = [];
    const poIds = new Set(aiMatches.matchedPoIds || []);
    if (poIds.size > 0) {
      const placeholders = [...poIds].map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await pool.query(`SELECT * FROM open_po WHERE id IN (${placeholders})`, [...poIds]);
      poMatches = rows.map(snakeToCamel);
    }

    let finMatches = [];
    const finIds = new Set(aiMatches.matchedFinIds || []);
    if (finIds.size > 0) {
      const placeholders = [...finIds].map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await pool.query(`SELECT * FROM fin_results WHERE id IN (${placeholders})`, [...finIds]);
      finMatches = rows.map(snakeToCamel);
    }

    res.json({
      poMatches,
      finMatches,
      aiReasoning: aiMatches.reasoning || null,
      aiConfidence: aiMatches.confidence || "none",
    });
  } catch (err) {
    console.error("[Import-RU] Ошибка сопоставления:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/apply-ru", async (req, res) => {
  try {
    const { poIds, finIds, paymentFileId, datePaid, amount, parsedData } = req.body;

    const results = { poUpdated: [], finUpdated: [], prevPoStates: [], prevFinStates: [] };

    if (poIds?.length && paymentFileId) {
      for (const poId of poIds) {
        const { rows: prevRows } = await pool.query(
          "SELECT payment_status_customer, date_customer_paid, customer_payment_file_id FROM open_po WHERE id = $1", [poId]
        );
        const prev = prevRows[0] || {};
        results.prevPoStates.push({
          id: poId,
          paymentStatusCustomer: prev.payment_status_customer || "Not paid",
          dateCustomerPaid: prev.date_customer_paid || "",
          customerPaymentFileId: prev.customer_payment_file_id || null,
        });
        await pool.query(
          `UPDATE open_po SET payment_status_customer = 'Paid', date_customer_paid = $1, customer_payment_file_id = $2 WHERE id = $3`,
          [datePaid, paymentFileId, poId]
        );
        results.poUpdated.push(poId);
      }
    }

    if (finIds?.length && paymentFileId) {
      for (const finId of finIds) {
        const { rows: prevRows } = await pool.query(
          "SELECT payment_fact, payment_date, payment_doc_file_id, status, has_upd, no_global_smart FROM fin_results WHERE id = $1", [finId]
        );
        const prev = prevRows[0] || {};
        results.prevFinStates.push({
          id: finId,
          paymentFact: parseFloat(prev.payment_fact) || 0,
          paymentDate: prev.payment_date || "",
          paymentDocFileId: prev.payment_doc_file_id || null,
          status: prev.status || "active",
        });
        const newStatus = (prev.has_upd || prev.no_global_smart) ? "completed" : (prev.status || "active");
        await pool.query(
          `UPDATE fin_results SET payment_fact = $1, payment_date = $2, payment_doc_file_id = $3, status = $4 WHERE id = $5`,
          [amount, datePaid, paymentFileId, newStatus, finId]
        );
        results.finUpdated.push(finId);
        if (!results.finNewStatuses) results.finNewStatuses = {};
        results.finNewStatuses[finId] = newStatus;
      }
    }

    let importHistoryId = null;
    if (parsedData) {
      const { rows: histRows } = await pool.query(
        `INSERT INTO import_history (file_id, parsed_data, matched_po_id, infra_account, status)
         VALUES ($1, $2, $3, $4, 'applied') RETURNING id`,
        [paymentFileId, JSON.stringify({ ...parsedData, type: "ru" }), poIds?.[0] || null, null]
      );
      importHistoryId = histRows[0]?.id;
    }

    res.json({ success: true, ...results, importHistoryId });
  } catch (err) {
    console.error("[Import-RU] Ошибка применения:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/undo-ru", async (req, res) => {
  try {
    const { prevPoStates, prevFinStates, importHistoryId } = req.body;

    if (prevPoStates?.length) {
      for (const s of prevPoStates) {
        await pool.query(
          `UPDATE open_po SET payment_status_customer = $1, date_customer_paid = $2, customer_payment_file_id = $3 WHERE id = $4`,
          [s.paymentStatusCustomer || "Not paid", s.dateCustomerPaid || null, s.customerPaymentFileId || null, s.id]
        );
      }
    }

    if (prevFinStates?.length) {
      for (const s of prevFinStates) {
        await pool.query(
          `UPDATE fin_results SET payment_fact = $1, payment_date = $2, payment_doc_file_id = $3, status = $4 WHERE id = $5`,
          [s.paymentFact || 0, s.paymentDate || null, s.paymentDocFileId || null, s.status || "active", s.id]
        );
      }
    }

    if (importHistoryId) {
      await pool.query("DELETE FROM import_history WHERE id = $1", [importHistoryId]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[Import-RU] Ошибка отката:", err);
    res.status(500).json({ error: err.message });
  }
});

function guessInfraAccount(payerName, currency) {
  if (!payerName) return null;
  const lower = payerName.toLowerCase();
  for (const [keyword, baseName] of Object.entries(ACCOUNT_KEYWORDS)) {
    if (lower.includes(keyword)) {
      if (baseName === "Yoon Engineering") return baseName;
      return `${baseName} ${(currency || "USD").toUpperCase()}`;
    }
  }
  return null;
}

async function extractTextFromFile(file) {
  const mime = file.mimetype || "";
  if (mime === "application/pdf") {
    const { PDFParse } = require("pdf-parse");
    const buffer = fs.readFileSync(file.path);
    const uint8 = new Uint8Array(buffer);
    const pdf = new PDFParse(uint8);
    const result = await pdf.getText();
    return result.pages ? result.pages.map((p) => p.text).join("\n") : String(result);
  }
  if (mime.startsWith("image/")) {
    const Tesseract = require("tesseract.js");
    const { data: { text } } = await Tesseract.recognize(file.path, "eng+rus");
    return text;
  }
  if (mime === "text/csv" || file.originalname?.endsWith(".csv")) {
    return fs.readFileSync(file.path, "utf8");
  }
  return fs.readFileSync(file.path, "utf8");
}

async function parseForeignDocument(extractedText, originalName) {
  const fileNameHint = originalName
    ? `\nIMPORTANT — Original filename: "${originalName}"\nThe filename often contains the PO/order reference number (e.g. "POP AT26-0010.pdf" means reference is "AT26-0010"). Extract it if present.\n\n`
    : "\n\n";

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are an expert financial document parser for an aircraft spare parts trading company. You must extract data with absolute precision. Return only valid JSON." },
      { role: "user", content: FOREIGN_PARSE_PROMPT + fileNameHint + extractedText.substring(0, 12000) },
    ],
    temperature: 0,
    max_tokens: 800,
  });

  const raw = completion.choices[0]?.message?.content || "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  parsed.amount = parseFloat(parsed.amount) || 0;
  parsed.fees = parseFloat(parsed.fees) || 0;
  parsed.reference = parsed.reference || null;
  return parsed;
}

function parseRussianDocument(extractedText) {
  const lines = extractedText
    .split(/\r?\n/)
    .map((line) => normSpaces(line))
    .filter(Boolean);

  const payerIdx = lines.findIndex((line) => /Плательщик/i.test(line));
  const beneficiaryIdx = lines.findIndex((line) => /Получатель/i.test(line));
  const payerBankIdx = lines.findIndex((line) => /Банк плательщика/i.test(line));
  const purposeIdx = lines.findIndex((line) => /Назначение платежа/i.test(line));

  const payerMatch = extractedText.match(/Сумма\s+\d[\d\s-]*\n([^\n]+)\nПлательщик/i);
  const beneficiaryMatch = extractedText.match(/Сч\.\s*N\s*[^\n]+\n([^\n]+?)(?:\s+Вид оп\.|$)/i);
  const bankMatch = extractedText.match(/Плательщик[^\n]*\n([^\n]+)\n[^\n]+\nБанк плательщика/i);

  const payer = normSpaces(payerMatch?.[1] || previousNonEmpty(lines, payerIdx));
  const beneficiary = normSpaces(beneficiaryMatch?.[1] || previousNonEmpty(lines, beneficiaryIdx));
  const bankName = normSpaces(bankMatch?.[1] || previousNonEmpty(lines, payerBankIdx));
  const purpose = previousNonEmpty(lines, purposeIdx);

  const dateMatch = extractedText.match(/ПЛАТЕЖНОЕ ПОРУЧЕНИЕ\s*N\s*\d+\s+(\d{2}\.\d{2}\.\d{4})/i)
    || extractedText.match(/(\d{2}\.\d{2}\.\d{4})/);
  const amountMatch = extractedText.match(/Сумма\s+(\d[\d\s-]*\d)/i);
  const referenceMatch = extractedText.match(/Оплата по договору\s+([A-Za-zА-Яа-я0-9\-\/]+)/i);
  const updMatch = extractedText.match(/по УПД\s+([A-Za-zА-Яа-я0-9\-\/]+)/i);

  return {
    payer: payer || null,
    beneficiary: beneficiary || null,
    amount: parseRuMoney(amountMatch?.[1]),
    currency: "RUB",
    fees: 0,
    date: toIsoDateRu(dateMatch?.[1] || ""),
    reference: referenceMatch?.[1] || null,
    updNumber: updMatch?.[1] || null,
    bankName: bankName || null,
    purpose: purpose || null,
  };
}

async function fetchRowsByIds(client, table, ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean).map((id) => parseInt(id, 10)).filter(Boolean))];
  if (!uniqueIds.length) return [];
  const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await client.query(`SELECT * FROM ${table} WHERE id IN (${placeholders})`, uniqueIds);
  return rows.map(snakeToCamel);
}

async function matchForeignPayment(client, payload) {
  const { beneficiary, amount, currency, reference, payer } = payload;
  if (!beneficiary && !reference) {
    return { matches: [], accounts: [], aiReasoning: null, aiConfidence: "none" };
  }

  const { rows: allPo } = await client.query(
    "SELECT id, internal_po, internal_po_ref, supplier_name, supplier_amount, payment_status_supplier, customer, paying_company, date_ordered, status FROM open_po WHERE status != 'cancelled' ORDER BY id DESC"
  );

  const poList = allPo.map((r) => ({
    id: r.id,
    internalPo: r.internal_po,
    internalPoRef: r.internal_po_ref,
    supplierName: r.supplier_name,
    supplierAmount: parseFloat(r.supplier_amount) || 0,
    paymentStatus: r.payment_status_supplier,
    customer: r.customer,
    payingCompany: r.paying_company,
    dateOrdered: r.date_ordered,
    status: r.status,
  }));

  const poSummary = poList.map((p) =>
    `ID:${p.id} | PO:${p.internalPo} | ExtPO:${p.internalPoRef} | Supplier:${p.supplierName} | Amount:${p.supplierAmount} | PayStatus:${p.paymentStatus} | OrderStatus:${p.status} | Customer:${p.customer}`
  ).join("\n");

  const matchPrompt = `You are a smart matching engine for an aircraft spare parts company (Global Smart / Altura Technics).

A payment was made:
- Payer: ${payer || "unknown"}
- Beneficiary (supplier being paid): ${beneficiary}
- Amount: ${amount} ${currency || "USD"}
- Reference from document: ${reference || "none"}

Below is the list of active Purchase Orders in our system. Find the BEST matching PO(s) for this payment.

MATCHING RULES:
1. Company names may differ slightly: "SLS AEROSPACE LLC" = "SLS Aerospace", "AERO PACIFIC INDUSTRIES LTD" ≠ "Pacific Aero Tec" (different companies!)
2. Match by supplier name similarity FIRST, then verify by amount if possible
3. A PO with "internal_po_ref" (ExtPO) like "AT26-0029" should match if the payment reference contains this code
4. One payment may cover multiple POs to the same supplier — include all of them
5. Only match if you are CONFIDENT. Do not match different companies that just share one word
6. If payment status is already "Paid", deprioritize it (probably already processed)
7. Orders can be "active" or "completed" — a completed order may still need payment to supplier, so match both statuses

Return ONLY valid JSON:
{
  "matchedIds": [241],
  "confidence": "high",
  "reasoning": "SLS AEROSPACE LLC matches supplier SLS Aerospace in PO ID 241, amount is close"
}

If no confident match found, return: {"matchedIds": [], "confidence": "none", "reasoning": "No matching supplier found"}

Active Purchase Orders:
${poSummary}`;

  let aiMatches = { matchedIds: [], confidence: "none", reasoning: "" };
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a precise order matching engine. Return only valid JSON." },
        { role: "user", content: matchPrompt },
      ],
      temperature: 0,
      max_tokens: 500,
    });
    const raw = completion.choices[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    aiMatches = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch (e) {
    console.error("[Import] AI match error:", e.message);
  }

  const matches = await fetchRowsByIds(client, "open_po", aiMatches.matchedIds || []);
  const { rows: balRows } = await client.query("SELECT * FROM balances");

  return {
    matches,
    accounts: balRows.map(snakeToCamel),
    aiReasoning: aiMatches.reasoning || null,
    aiConfidence: aiMatches.confidence || "none",
  };
}

function findReferenceMatches(rows, field, reference) {
  const compactRef = compactMatch(reference);
  if (!compactRef) return [];
  return rows.filter((row) => compactMatch(row[field]).includes(compactRef)).map((row) => row.id);
}

function findUpdMatches(rows, updNumber) {
  const compactUpd = compactMatch(updNumber);
  if (!compactUpd) return [];
  return rows.filter((row) => compactMatch(row.updNum || row.orderStatus).includes(compactUpd)).map((row) => row.id);
}

async function matchRussianPayment(client, payload) {
  const { payer, beneficiary, amount, currency, reference, updNumber, purpose } = payload;

  const { rows: poRows } = await client.query(
    "SELECT id, internal_po, customer, customer_amount, payment_status_customer, date_customer_paid, customer_payment_file_id, status FROM open_po WHERE status != 'cancelled' ORDER BY id DESC"
  );
  const { rows: finRows } = await client.query(
    "SELECT id, customer_po, customer, customer_amount, payment_fact, payment_date, payment_doc_file_id, status, upd_num, order_status, has_upd, no_global_smart FROM fin_results WHERE status != 'cancelled' ORDER BY id DESC"
  );

  const poList = poRows.map((r) => ({
    id: r.id,
    internalPo: r.internal_po,
    customer: r.customer,
    customerAmount: parseFloat(r.customer_amount) || 0,
    paymentStatusCustomer: r.payment_status_customer,
    dateCustomerPaid: r.date_customer_paid,
    customerPaymentFileId: r.customer_payment_file_id,
    status: r.status,
  }));

  const finList = finRows.map((r) => ({
    id: r.id,
    customerPo: r.customer_po,
    customer: r.customer,
    customerAmount: parseFloat(r.customer_amount) || 0,
    paymentFact: parseFloat(r.payment_fact) || 0,
    paymentDate: r.payment_date,
    paymentDocFileId: r.payment_doc_file_id,
    status: r.status,
    updNum: r.upd_num,
    orderStatus: r.order_status,
    hasUpd: !!r.has_upd,
    noGlobalSmart: !!r.no_global_smart,
  }));

  let matchedPoIds = findReferenceMatches(poList, "internalPo", reference);
  let matchedFinIds = findReferenceMatches(finList, "customerPo", reference);
  let confidence = "none";
  let reasoning = "Совпадения не найдены";

  if (!matchedPoIds.length && !matchedFinIds.length && updNumber) {
    matchedFinIds = findUpdMatches(finList, updNumber);
    if (matchedFinIds.length) {
      confidence = "medium";
      reasoning = `Найдено по номеру УПД ${updNumber}`;
    }
  }

  if (matchedPoIds.length || matchedFinIds.length) {
    confidence = "high";
    reasoning = reference
      ? `Найдено по номеру договора/заказа ${reference}`
      : reasoning;
  } else {
    const poSummary = poList.map((p) =>
      `PO_ID:${p.id} | Customer:${p.customer} | InternalPO:${p.internalPo} | AmountUSD:${p.customerAmount} | PayStatus:${p.paymentStatusCustomer} | Status:${p.status}`
    ).join("\n");
    const finSummary = finList.map((f) =>
      `FIN_ID:${f.id} | Customer:${f.customer} | CustomerPO:${f.customerPo} | AmountUSD:${f.customerAmount} | PaymentFactRUB:${f.paymentFact} | Status:${f.status} | UPD:${f.updNum || f.orderStatus || ""}`
    ).join("\n");

    const matchPrompt = `You match incoming Russian customer payment documents to CRM orders.

Incoming payment:
- Payer (customer): ${payer || "unknown"}
- Beneficiary (our company): ${beneficiary || "unknown"}
- Amount: ${amount || 0} ${currency || "RUB"}
- Contract / order reference: ${reference || "none"}
- UPD number: ${updNumber || "none"}
- Payment purpose: ${purpose || "none"}

Rules:
1. Highest priority: exact contract/order number match inside Open PO.internal_po or FinResult.customer_po
2. Customer names may differ by legal form: ООО "Глобал Скай" = Global Sky
3. Use UPD number as additional evidence
4. Do not match unrelated companies
5. One payment normally maps to one Open PO and one Fin Result for the same customer/order

Return ONLY valid JSON:
{
  "matchedPoIds": [1],
  "matchedFinIds": [2],
  "confidence": "high",
  "reasoning": "Matched by exact contract number"
}

If no confident match exists, return:
{"matchedPoIds": [], "matchedFinIds": [], "confidence": "none", "reasoning": "No confident match found"}

Open PO:
${poSummary}

Fin Results:
${finSummary}`;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a precise order matching engine. Return only valid JSON." },
          { role: "user", content: matchPrompt },
        ],
        temperature: 0,
        max_tokens: 600,
      });
      const raw = completion.choices[0]?.message?.content || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      matchedPoIds = parsed.matchedPoIds || [];
      matchedFinIds = parsed.matchedFinIds || [];
      confidence = parsed.confidence || "none";
      reasoning = parsed.reasoning || reasoning;
    } catch (e) {
      console.error("[Import] RF AI match error:", e.message);
    }
  }

  if (matchedPoIds.length === 1 && !matchedFinIds.length) {
    const po = poList.find((row) => row.id === matchedPoIds[0]);
    if (po) matchedFinIds = finList.filter((row) => compactMatch(row.customerPo) === compactMatch(po.internalPo)).map((row) => row.id);
  }
  if (matchedFinIds.length === 1 && !matchedPoIds.length) {
    const fin = finList.find((row) => row.id === matchedFinIds[0]);
    if (fin) matchedPoIds = poList.filter((row) => compactMatch(row.internalPo) === compactMatch(fin.customerPo)).map((row) => row.id);
  }

  return {
    matches: await fetchRowsByIds(client, "open_po", matchedPoIds),
    finMatches: await fetchRowsByIds(client, "fin_results", matchedFinIds),
    aiReasoning: reasoning,
    aiConfidence: confidence,
  };
}

async function applyForeignPayment(client, body) {
  const { poId, paymentFileId, datePaid, infraAccount, outgoing, bankFees, supplier, poRef, date, parsedData } = body;
  const results = { poUpdated: false, infraOpCreated: false };

  if (poId && paymentFileId) {
    await client.query(
      `UPDATE open_po SET payment_status_supplier = 'Paid', date_paid_supplier = $1, payment_file_id = $2 WHERE id = $3`,
      [datePaid, paymentFileId, poId]
    );
    results.poUpdated = true;
  }

  if (infraAccount && outgoing) {
    const { rows: balRows } = await client.query("SELECT * FROM balances WHERE name = $1", [infraAccount]);
    const currentBalance = balRows.length > 0 ? parseFloat(balRows[0].balance) || 0 : 0;
    const totalOut = (parseFloat(outgoing) || 0) + (parseFloat(bankFees) || 0);
    const newBalance = currentBalance - totalOut;

    const { rows: opRows } = await client.query(
      `INSERT INTO infra_operations (account_name, po_ref, received, outgoing, bank_fees, supplier, date, balance, description)
       VALUES ($1, $2, 0, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [infraAccount, poRef || "", outgoing, bankFees || 0, supplier || "", date, newBalance,
        poRef ? `Оплата поставщику ${supplier || ""} по ${poRef}` : `Оплата поставщику ${supplier || ""}`]
    );

    await client.query("UPDATE balances SET balance = $1 WHERE name = $2", [newBalance, infraAccount]);

    results.infraOpCreated = true;
    results.infraOpId = opRows[0]?.id || null;
    results.prevBalance = currentBalance;
    results.newBalance = newBalance;
  }

  if (parsedData) {
    const { rows: histRows } = await client.query(
      `INSERT INTO import_history (file_id, parsed_data, matched_po_id, infra_account, status)
       VALUES ($1, $2, $3, $4, 'applied') RETURNING id`,
      [paymentFileId, JSON.stringify(parsedData), poId || null, infraAccount || null]
    );
    results.importHistoryId = histRows[0]?.id || null;
  }

  return results;
}

async function applyRussianPayment(client, body) {
  const { poId, finId, paymentFileId, datePaid, amount, parsedData } = body;
  const results = { poUpdated: false, finUpdated: false, updatedDebtIds: [], prevDebts: [] };

  if (poId && paymentFileId) {
    await client.query(
      `UPDATE open_po SET payment_status_customer = 'Paid', date_customer_paid = $1, customer_payment_file_id = $2 WHERE id = $3`,
      [datePaid, paymentFileId, poId]
    );
    results.poUpdated = true;
  }

  if (finId && paymentFileId) {
    const { rows: finRows } = await client.query(
      `SELECT id, customer_po, payment_fact, payment_date, payment_doc_file_id, status, has_upd, no_global_smart
       FROM fin_results WHERE id = $1`,
      [finId]
    );
    const prevFin = finRows[0];
    if (prevFin) {
      const nextStatus =
        prevFin.status !== "cancelled" && (prevFin.has_upd || prevFin.no_global_smart) && (parseFloat(amount) || 0) > 0
          ? "completed"
          : prevFin.status;

      await client.query(
        `UPDATE fin_results
         SET payment_fact = $1, payment_date = $2, payment_doc_file_id = $3, status = $4
         WHERE id = $5`,
        [amount || 0, datePaid, paymentFileId, nextStatus, finId]
      );

      const { rows: debtRows } = await client.query(
        `SELECT id, status, pay_doc_file_id, pay_date, pay_comment
         FROM debts WHERE "order" = $1 AND status = 'open'`,
        [prevFin.customer_po]
      );

      if (debtRows.length) {
        const payComment = `Оплачено через Импорт платежей РФ: ₽${(parseFloat(amount) || 0).toLocaleString("ru-RU", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
        for (const debt of debtRows) {
          await client.query(
            `UPDATE debts SET status = 'closed', pay_doc_file_id = $1, pay_date = $2, pay_comment = $3 WHERE id = $4`,
            [paymentFileId, datePaid, payComment, debt.id]
          );
        }
      }

      results.finUpdated = true;
      results.newFinStatus = nextStatus;
      results.prevDebts = debtRows.map((row) => snakeToCamel(row));
      results.updatedDebtIds = debtRows.map((row) => row.id);
    }
  }

  if (parsedData) {
    const { rows: histRows } = await client.query(
      `INSERT INTO import_history (file_id, parsed_data, matched_po_id, infra_account, status)
       VALUES ($1, $2, $3, $4, 'applied') RETURNING id`,
      [paymentFileId, JSON.stringify(parsedData), poId || null, null]
    );
    results.importHistoryId = histRows[0]?.id || null;
  }

  return results;
}

router.post("/parse", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });

    const documentKind = req.body.documentKind === "rf" ? "rf" : "foreign";
    const extractedText = await extractTextFromFile(req.file);

    if (!extractedText || extractedText.trim().length < 10) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Не удалось извлечь текст из документа. Возможно, это сканированное изображение." });
    }

    const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const parsed = documentKind === "rf"
      ? parseRussianDocument(extractedText)
      : await parseForeignDocument(extractedText, originalName);

    const suggestedAccount = documentKind === "foreign"
      ? guessInfraAccount(parsed.payer, parsed.currency)
      : null;

    fs.unlinkSync(req.file.path);

    res.json({
      parsed,
      extractedText: extractedText.substring(0, 2000),
      suggestedAccount,
    });
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error("[Import] Ошибка парсинга:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/match", async (req, res) => {
  const client = await pool.connect();
  try {
    const documentKind = req.body.documentKind === "rf" ? "rf" : "foreign";
    const result = documentKind === "rf"
      ? await matchRussianPayment(client, req.body)
      : await matchForeignPayment(client, req.body);
    res.json(result);
  } catch (err) {
    console.error("[Import] Ошибка сопоставления:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post("/apply", async (req, res) => {
  const client = await pool.connect();
  try {
    const cid = req.headers["x-client-id"];
    const documentKind = req.body.documentKind === "rf" ? "rf" : "foreign";
    await client.query("BEGIN");
    const result = documentKind === "rf"
      ? await applyRussianPayment(client, req.body)
      : await applyForeignPayment(client, req.body);
    await client.query("COMMIT");

    if (result.poUpdated && req.body.poId) {
      const { rows: poRows } = await client.query("SELECT * FROM open_po WHERE id = $1", [req.body.poId]);
      if (poRows[0]) broadcast("po:update", snakeToCamel(poRows[0]), cid);
    }
    if (result.finUpdated && req.body.finId) {
      const { rows: finRows } = await client.query("SELECT * FROM fin_results WHERE id = $1", [req.body.finId]);
      if (finRows[0]) broadcast("fin:update", snakeToCamel(finRows[0]), cid);
    }
    if (result.updatedDebtIds?.length) {
      for (const did of result.updatedDebtIds) {
        const { rows: dRows } = await client.query("SELECT * FROM debts WHERE id = $1", [did]);
        if (dRows[0]) broadcast("debts:update", snakeToCamel(dRows[0]), cid);
      }
    }
    if (result.infraOpCreated && result.infraOpId) {
      const { rows: iRows } = await client.query("SELECT * FROM infra_operations WHERE id = $1", [result.infraOpId]);
      if (iRows[0]) broadcast("infra:create", snakeToCamel(iRows[0]), cid);
    }
    if (req.body.infraAccount) {
      const { rows: bRows } = await client.query("SELECT * FROM balances WHERE name = $1", [req.body.infraAccount]);
      if (bRows[0]) broadcast("balances:update", snakeToCamel(bRows[0]), cid);
    }

    res.json({ success: true, ...result });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Import] Ошибка применения:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post("/undo", async (req, res) => {
  const client = await pool.connect();
  try {
    const cid = req.headers["x-client-id"];
    const {
      poId,
      poPaymentSide,
      prevPoState,
      finId,
      prevFinState,
      prevDebtsState,
      infraAccount,
      infraOpId,
      prevBalance,
      importHistoryId,
    } = req.body;

    await client.query("BEGIN");

    if (poId && prevPoState) {
      if (poPaymentSide === "customer") {
        await client.query(
          `UPDATE open_po SET payment_status_customer = $1, date_customer_paid = $2, customer_payment_file_id = $3 WHERE id = $4`,
          [prevPoState.paymentStatusCustomer || "", prevPoState.dateCustomerPaid || null, prevPoState.customerPaymentFileId || null, poId]
        );
      } else {
        await client.query(
          `UPDATE open_po SET payment_status_supplier = $1, date_paid_supplier = $2, payment_file_id = $3 WHERE id = $4`,
          [prevPoState.paymentStatusSupplier || "", prevPoState.datePaidSupplier || null, prevPoState.paymentFileId || null, poId]
        );
      }
    }

    if (finId && prevFinState) {
      await client.query(
        `UPDATE fin_results SET payment_fact = $1, payment_date = $2, payment_doc_file_id = $3, status = $4 WHERE id = $5`,
        [prevFinState.paymentFact || 0, prevFinState.paymentDate || null, prevFinState.paymentDocFileId || null, prevFinState.status || "active", finId]
      );
    }

    if (Array.isArray(prevDebtsState)) {
      for (const debt of prevDebtsState) {
        await client.query(
          `UPDATE debts SET status = $1, pay_doc_file_id = $2, pay_date = $3, pay_comment = $4 WHERE id = $5`,
          [debt.status || "open", debt.payDocFileId || null, debt.payDate || null, debt.payComment || null, debt.id]
        );
      }
    }

    if (infraOpId) {
      await client.query("DELETE FROM infra_operations WHERE id = $1", [infraOpId]);
    }

    if (infraAccount && prevBalance !== null && prevBalance !== undefined) {
      await client.query("UPDATE balances SET balance = $1 WHERE name = $2", [prevBalance, infraAccount]);
    }

    if (importHistoryId) {
      await client.query("DELETE FROM import_history WHERE id = $1", [importHistoryId]);
    }

    await client.query("COMMIT");

    if (poId) {
      const { rows: poRows } = await client.query("SELECT * FROM open_po WHERE id = $1", [poId]);
      if (poRows[0]) broadcast("po:update", snakeToCamel(poRows[0]), cid);
    }
    if (finId) {
      const { rows: finRows } = await client.query("SELECT * FROM fin_results WHERE id = $1", [finId]);
      if (finRows[0]) broadcast("fin:update", snakeToCamel(finRows[0]), cid);
    }
    if (Array.isArray(prevDebtsState)) {
      for (const debt of prevDebtsState) {
        const { rows: dRows } = await client.query("SELECT * FROM debts WHERE id = $1", [debt.id]);
        if (dRows[0]) broadcast("debts:update", snakeToCamel(dRows[0]), cid);
      }
    }
    if (infraOpId) broadcast("infra:delete", { id: infraOpId }, cid);
    if (infraAccount) {
      const { rows: bRows } = await client.query("SELECT * FROM balances WHERE name = $1", [infraAccount]);
      if (bRows[0]) broadcast("balances:update", snakeToCamel(bRows[0]), cid);
    }

    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Import] Ошибка отката:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ==================== РФ: Платёжное поручение ====================

const RF_PARSE_PROMPT = `You are an expert parser for Russian payment orders (Платёжное поручение).
Extract payment information from the document text below.

Return ONLY valid JSON with these fields (use null if not found):
{
  "payer": "ООО «Глобал Скай»",
  "beneficiary": "ООО «Глобал Смарт»",
  "amount": 11570348.93,
  "currency": "RUB",
  "date": "2026-02-24",
  "reference": "2025037432",
  "updNum": "168",
  "payerInn": "7708235034",
  "payerBank": "Банк ВТБ (ПАО)",
  "purpose": "Оплата по договору 2025037432 от 01.12.2025 по УПД 168"
}

CRITICAL RULES:
- "payer" — company sending money (Плательщик)
- "beneficiary" — company receiving money (Получатель)
- "amount" — numeric amount. In Russian payment orders the format is often "11570348-93" where the part after the dash is kopecks. Convert to decimal: 11570348.93
- "currency" — always "RUB" for Russian payment orders unless explicitly stated otherwise
- "date" — use the execution date (ИСПОЛНЕНО date, or document date). Format: YYYY-MM-DD
- "reference" — the CONTRACT number or AGREEMENT number from "Назначение платежа". Look for patterns like "договор XXXXXXXXXX", "по договору XXXXXXXXXX", "счёт №XXXX". NOT the payment order number (N 862). NOT the INN.
- "updNum" — UPD/invoice number if mentioned (e.g. "УПД 168", "УПД № 168" → "168")
- "payerBank" — bank of the payer (Банк плательщика)
- "purpose" — full text of "Назначение платежа" field
- Extract correctly from Russian text
- Return ONLY the JSON object, no explanation

Document text:
`;

router.post("/parse-rf", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY не настроен" });
    }

    const mime = req.file.mimetype || "";
    let extractedText = "";

    if (mime === "application/pdf") {
      const { PDFParse } = require("pdf-parse");
      const buffer = fs.readFileSync(req.file.path);
      const uint8 = new Uint8Array(buffer);
      const pdf = new PDFParse(uint8);
      const result = await pdf.getText();
      extractedText = result.pages ? result.pages.map((p) => p.text).join("\n") : String(result);
    } else if (mime.startsWith("image/")) {
      const Tesseract = require("tesseract.js");
      const { data: { text } } = await Tesseract.recognize(req.file.path, "rus+eng");
      extractedText = text;
    } else {
      extractedText = fs.readFileSync(req.file.path, "utf8");
    }

    if (!extractedText || extractedText.trim().length < 10) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Не удалось извлечь текст из документа" });
    }

    const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const fileHint = originalName ? `\nFilename: "${originalName}"\n\n` : "\n\n";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert Russian financial document parser. Return only valid JSON." },
        { role: "user", content: RF_PARSE_PROMPT + fileHint + extractedText.substring(0, 12000) },
      ],
      temperature: 0,
      max_tokens: 800,
    });

    const raw = completion.choices[0]?.message?.content || "";
    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (e) {
      fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: "AI не вернул корректный JSON", raw });
    }

    parsed.amount = parseFloat(parsed.amount) || 0;
    parsed.currency = parsed.currency || "RUB";

    fs.unlinkSync(req.file.path);
    res.json({ parsed, extractedText: extractedText.substring(0, 2000) });
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error("[Import RF] Ошибка парсинга:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/match-rf", async (req, res) => {
  try {
    const { payer, amount, reference, updNum } = req.body;
    if (!payer && !reference) {
      return res.json({ poMatches: [], finMatches: [], aiReasoning: null });
    }

    const { rows: allPo } = await pool.query(
      "SELECT id, internal_po, customer, customer_amount, payment_status_customer, date_customer_paid, status, internal_po_ref FROM open_po WHERE status != 'cancelled' ORDER BY id DESC"
    );
    const { rows: allFin } = await pool.query(
      "SELECT id, customer_po, customer, customer_amount, payment_fact, status, order_status FROM fin_results WHERE status != 'cancelled' ORDER BY id DESC"
    );

    const poSummary = allPo.map((r) =>
      `PO_ID:${r.id} | PO:${r.internal_po} | ExtPO:${r.internal_po_ref || ""} | Customer:${r.customer} | Amount:${r.customer_amount} | PayStatus:${r.payment_status_customer || "Not paid"}`
    ).join("\n");

    const finSummary = allFin.map((r) =>
      `FIN_ID:${r.id} | CustomerPO:${r.customer_po} | Customer:${r.customer} | Amount:${r.customer_amount} | PayFact:${r.payment_fact}`
    ).join("\n");

    const matchPrompt = `You are a matching engine for a Russian aircraft spare parts company (ООО "Глобал Смарт").

A Russian payment order (платёжное поручение) was received FROM a client:
- Payer (client): ${payer || "unknown"}
- Amount: ${amount} RUB
- Contract/reference: ${reference || "none"}
- UPD number: ${updNum || "none"}

Find the BEST matching entries in Open PO (customer orders) and Fin Results.

MATCHING RULES:
1. Match Open PO by: customer name similarity to payer, OR internal_po containing reference, OR ExtPO containing reference
2. Match Fin Results by: customer_po containing reference, OR customer name similarity to payer
3. Contract number like "2025037432" often appears in internal_po or customer_po fields
4. Company names may differ slightly: "Глобал Скай" = "Global Sky LLC", etc.
5. Only match if confident. If reference is found — that's strong evidence.
6. Return separate lists for PO matches and FinResult matches

Return ONLY valid JSON:
{
  "matchedPoIds": [123],
  "matchedFinIds": [456],
  "confidence": "high",
  "reasoning": "Contract 2025037432 found in PO ID 123 and FinResult ID 456"
}

Open Purchase Orders (customer side):
${poSummary}

Fin Results:
${finSummary}`;

    let aiMatches = { matchedPoIds: [], matchedFinIds: [], confidence: "none", reasoning: "" };
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a precise order matching engine. Return only valid JSON." },
          { role: "user", content: matchPrompt },
        ],
        temperature: 0,
        max_tokens: 600,
      });
      const raw = completion.choices[0]?.message?.content || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      aiMatches = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (e) {
      console.error("[Import RF] AI match error:", e.message);
    }

    const poIds = new Set(aiMatches.matchedPoIds || []);
    const finIds = new Set(aiMatches.matchedFinIds || []);

    let poMatches = [], finMatches = [];
    if (poIds.size > 0) {
      const ph = [...poIds].map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await pool.query(`SELECT * FROM open_po WHERE id IN (${ph})`, [...poIds]);
      poMatches = rows.map(snakeToCamel);
    }
    if (finIds.size > 0) {
      const ph = [...finIds].map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await pool.query(`SELECT * FROM fin_results WHERE id IN (${ph})`, [...finIds]);
      finMatches = rows.map(snakeToCamel);
    }

    res.json({ poMatches, finMatches, aiReasoning: aiMatches.reasoning, aiConfidence: aiMatches.confidence });
  } catch (err) {
    console.error("[Import RF] Ошибка сопоставления:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/apply-rf", async (req, res) => {
  try {
    const { poId, finId, paymentFileId, datePaid, amount, parsedData } = req.body;
    const results = { poUpdated: false, finUpdated: false };

    let prevPo = null;
    if (poId && paymentFileId) {
      const { rows } = await pool.query(
        "SELECT payment_status_customer, date_customer_paid, customer_payment_file_id FROM open_po WHERE id = $1", [poId]
      );
      if (rows.length) prevPo = rows[0];
      await pool.query(
        "UPDATE open_po SET payment_status_customer = 'Paid', date_customer_paid = $1, customer_payment_file_id = $2 WHERE id = $3",
        [datePaid, paymentFileId, poId]
      );
      results.poUpdated = true;
      results.prevPoPaymentStatus = prevPo?.payment_status_customer || "Not paid";
      results.prevPoDatePaid = prevPo?.date_customer_paid || "";
      results.prevPoPaymentFileId = prevPo?.customer_payment_file_id || null;
    }

    let prevFin = null;
    if (finId && paymentFileId) {
      const { rows } = await pool.query(
        "SELECT payment_fact, payment_doc_file_id, payment_date, status FROM fin_results WHERE id = $1", [finId]
      );
      if (rows.length) prevFin = rows[0];

      const { rows: finRows } = await pool.query("SELECT has_upd, no_global_smart FROM fin_results WHERE id = $1", [finId]);
      const fin = finRows[0] || {};
      const newStatus = (fin.has_upd || fin.no_global_smart) ? "completed" : prevFin?.status || "active";

      await pool.query(
        "UPDATE fin_results SET payment_fact = $1, payment_doc_file_id = $2, payment_date = $3, status = $4 WHERE id = $5",
        [parseFloat(amount) || 0, paymentFileId, datePaid, newStatus, finId]
      );
      results.finUpdated = true;
      results.prevFinPaymentFact = parseFloat(prevFin?.payment_fact) || 0;
      results.prevFinPaymentDocFileId = prevFin?.payment_doc_file_id || null;
      results.prevFinPaymentDate = prevFin?.payment_date || "";
      results.prevFinStatus = prevFin?.status || "active";
      results.newFinStatus = newStatus;
    }

    let importHistoryId = null;
    if (parsedData) {
      const { rows: histRows } = await pool.query(
        "INSERT INTO import_history (file_id, parsed_data, matched_po_id, status) VALUES ($1, $2, $3, 'applied') RETURNING id",
        [paymentFileId, JSON.stringify(parsedData), poId || finId || null]
      );
      importHistoryId = histRows[0]?.id;
    }

    res.json({ success: true, ...results, importHistoryId });
  } catch (err) {
    console.error("[Import RF] Ошибка применения:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/undo-rf", async (req, res) => {
  try {
    const { poId, prevPoPaymentStatus, prevPoDatePaid, prevPoPaymentFileId,
            finId, prevFinPaymentFact, prevFinPaymentDocFileId, prevFinPaymentDate, prevFinStatus,
            importHistoryId } = req.body;

    if (poId) {
      await pool.query(
        "UPDATE open_po SET payment_status_customer = $1, date_customer_paid = $2, customer_payment_file_id = $3 WHERE id = $4",
        [prevPoPaymentStatus || "Not paid", prevPoDatePaid || null, prevPoPaymentFileId || null, poId]
      );
    }
    if (finId) {
      await pool.query(
        "UPDATE fin_results SET payment_fact = $1, payment_doc_file_id = $2, payment_date = $3, status = $4 WHERE id = $5",
        [prevFinPaymentFact || 0, prevFinPaymentDocFileId || null, prevFinPaymentDate || null, prevFinStatus || "active", finId]
      );
    }
    if (importHistoryId) {
      await pool.query("DELETE FROM import_history WHERE id = $1", [importHistoryId]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[Import RF] Ошибка отката:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
