const { Router } = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../db.cjs");
const { snakeToCamel } = require("../utils.cjs");

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
  "altura": "Altura GS",
  "yoon": "Yoon Engineering",
  "avs": "AVS GS",
};

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

const PARSE_PROMPT = `You are an expert financial document parser for an aircraft spare parts company. 
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

router.post("/parse", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY не настроен. Добавьте ключ в файл .env" });
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
      const { data: { text } } = await Tesseract.recognize(req.file.path, "eng+rus");
      extractedText = text;
    } else if (mime === "text/csv" || req.file.originalname?.endsWith(".csv")) {
      extractedText = fs.readFileSync(req.file.path, "utf8");
    } else {
      extractedText = fs.readFileSync(req.file.path, "utf8");
    }

    if (!extractedText || extractedText.trim().length < 10) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Не удалось извлечь текст из документа. Возможно, это сканированное изображение." });
    }

    const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const fileNameHint = originalName ? `\nIMPORTANT — Original filename: "${originalName}"\nThe filename often contains the PO/order reference number (e.g. "POP AT26-0010.pdf" means reference is "AT26-0010"). Extract it if present.\n\n` : "\n\n";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert financial document parser for an aircraft spare parts trading company. You must extract data with absolute precision. Return only valid JSON." },
        { role: "user", content: PARSE_PROMPT + fileNameHint + extractedText.substring(0, 12000) },
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
    parsed.fees = parseFloat(parsed.fees) || 0;

    const suggestedAccount = guessInfraAccount(parsed.payer, parsed.currency);

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
  try {
    const { beneficiary, amount, currency, reference, payer } = req.body;
    if (!beneficiary && !reference) {
      return res.json({ matches: [], aiReasoning: null });
    }

    const { rows: allPo } = await pool.query(
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

    const matchedIds = new Set(aiMatches.matchedIds || []);

    let matches = [];
    if (matchedIds.size > 0) {
      const placeholders = [...matchedIds].map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await pool.query(`SELECT * FROM open_po WHERE id IN (${placeholders})`, [...matchedIds]);
      matches = rows.map(snakeToCamel);
    }

    const { rows: balRows } = await pool.query("SELECT * FROM balances");
    const accounts = balRows.map(snakeToCamel);

    res.json({
      matches,
      accounts,
      aiReasoning: aiMatches.reasoning || null,
      aiConfidence: aiMatches.confidence || "none",
    });
  } catch (err) {
    console.error("[Import] Ошибка сопоставления:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/apply", async (req, res) => {
  try {
    const { poId, paymentFileId, datePaid, infraAccount, outgoing, bankFees, supplier, poRef, date } = req.body;

    const results = { poUpdated: false, infraOpCreated: false };

    let prevPoData = null;
    if (poId && paymentFileId) {
      const { rows: prevRows } = await pool.query(
        "SELECT payment_status_supplier, date_paid_supplier, payment_file_id FROM open_po WHERE id = $1", [poId]
      );
      if (prevRows.length) prevPoData = prevRows[0];

      await pool.query(
        `UPDATE open_po SET payment_status_supplier = 'Paid', date_paid_supplier = $1, payment_file_id = $2 WHERE id = $3`,
        [datePaid, paymentFileId, poId]
      );
      results.poUpdated = true;
      results.prevPoPaymentStatus = prevPoData?.payment_status_supplier || "Not paid";
      results.prevPoDatePaid = prevPoData?.date_paid_supplier || "";
      results.prevPoPaymentFileId = prevPoData?.payment_file_id || null;
    }

    let prevBalance = null;
    let infraOpId = null;
    if (infraAccount && outgoing) {
      const { rows: balRows } = await pool.query("SELECT * FROM balances WHERE name = $1", [infraAccount]);
      const currentBalance = balRows.length > 0 ? parseFloat(balRows[0].balance) || 0 : 0;
      prevBalance = currentBalance;
      const totalOut = (parseFloat(outgoing) || 0) + (parseFloat(bankFees) || 0);
      const newBalance = currentBalance - totalOut;

      const { rows: opRows } = await pool.query(
        `INSERT INTO infra_operations (account_name, po_ref, received, outgoing, bank_fees, supplier, date, balance, description)
         VALUES ($1, $2, 0, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [infraAccount, poRef || "", outgoing, bankFees || 0, supplier || "", date, newBalance,
         poRef ? `Оплата поставщику ${supplier || ""} по ${poRef}` : `Оплата поставщику ${supplier || ""}`]
      );
      infraOpId = opRows[0]?.id;

      await pool.query("UPDATE balances SET balance = $1 WHERE name = $2", [newBalance, infraAccount]);

      results.infraOpCreated = true;
      results.infraOpId = infraOpId;
      results.prevBalance = prevBalance;
      results.newBalance = newBalance;
    }

    let importHistoryId = null;
    if (req.body.parsedData) {
      const { rows: histRows } = await pool.query(
        `INSERT INTO import_history (file_id, parsed_data, matched_po_id, infra_account, status)
         VALUES ($1, $2, $3, $4, 'applied') RETURNING id`,
        [paymentFileId, JSON.stringify(req.body.parsedData), poId || null, infraAccount || null]
      );
      importHistoryId = histRows[0]?.id;
    }

    res.json({ success: true, ...results, importHistoryId });
  } catch (err) {
    console.error("[Import] Ошибка применения:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/undo", async (req, res) => {
  try {
    const { poId, prevPaymentStatus, prevDatePaid, prevPaymentFileId,
            infraAccount, infraOpId, prevBalance, importHistoryId } = req.body;

    if (poId) {
      await pool.query(
        `UPDATE open_po SET payment_status_supplier = $1, date_paid_supplier = $2, payment_file_id = $3 WHERE id = $4`,
        [prevPaymentStatus || "Not paid", prevDatePaid || null, prevPaymentFileId || null, poId]
      );
    }

    if (infraOpId) {
      await pool.query("DELETE FROM infra_operations WHERE id = $1", [infraOpId]);
    }

    if (infraAccount && prevBalance !== null && prevBalance !== undefined) {
      await pool.query("UPDATE balances SET balance = $1 WHERE name = $2", [prevBalance, infraAccount]);
    }

    if (importHistoryId) {
      await pool.query("DELETE FROM import_history WHERE id = $1", [importHistoryId]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[Import] Ошибка отката:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
