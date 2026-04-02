/**
 * Импорт «Фин результат» (ROT + EXP) и «Дебиторская задолженность» из файла
 * «Глобал Смарт финансы*.xlsx» в PostgreSQL и обновление src/data/finData.js, debtsData.js
 *
 * Запуск: node scripts/import-finances-from-xlsx.cjs [путь-к-xlsx]
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ExcelJS = require("exceljs");
const { pool } = require("../server/db.cjs");

function findFinanceXlsx(explicit) {
  if (explicit) return path.resolve(explicit);
  const root = path.join(__dirname, "..");
  const f = fs.readdirSync(root).find((x) => x.endsWith(".xlsx") && !x.includes("OPEN PO"));
  if (!f) throw new Error("Не найден xlsx (кроме OPEN PO) в корне проекта");
  return path.join(root, f);
}

function cellVal(cell) {
  const v = cell.value;
  if (v && typeof v === "object" && "result" in v && v.result != null) return v.result;
  return v;
}

function excelDateToStr(val) {
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  return String(val || "").trim();
}

function num(v) {
  if (v == null || v === "") return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v) {
  if (v == null) return "";
  return String(v).trim();
}

/**
 * Статус строки Фин. результата.
 * «Выполнен» только если есть УПД в тексте и есть оплата по клиенту (кол. 6) — иначе заказ в работе (дебиторка возможна после отгрузки).
 */
function deriveFinStatus(orderStatusText, paymentFact) {
  const t = orderStatusText || "";
  if (/отмен/i.test(t)) return "cancelled";
  const pf = typeof paymentFact === "number" ? paymentFact : parseFloat(paymentFact) || 0;
  if (/УПД/i.test(t) && pf > 0) return "completed";
  return "active";
}

function parseUpdFromOrderStatus(t) {
  if (!t || !/УПД/i.test(t)) return { hasUpd: false, updNum: "", updDate: "" };
  const numM = t.match(/УПД\s*№\s*([\d\w]+)/i);
  const dateM = t.match(/от\s*([\d.]+)/i);
  return {
    hasUpd: true,
    updNum: numM ? String(numM[1]).trim() : "",
    updDate: dateM ? String(dateM[1]).trim() : "",
  };
}

function parseFinSheet(ws, type) {
  const out = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const customer = str(cellVal(row.getCell(1)));
    if (!customer) continue;

    const orderStatusRaw = cellVal(row.getCell(5));
    const orderStatus = orderStatusRaw == null ? "" : String(orderStatusRaw).replace(/\r\n/g, "\n").trim();
    const paymentFactVal = num(cellVal(row.getCell(6)));
    const status = deriveFinStatus(orderStatus, paymentFactVal);
    const { hasUpd, updNum, updDate } = parseUpdFromOrderStatus(orderStatus);

    const c18 = cellVal(row.getCell(18));
    const c19 = cellVal(row.getCell(19));
    const c20 = cellVal(row.getCell(20));
    let comment = str(cellVal(row.getCell(21)));
    const extras = [c18, c19, c20]
      .filter((x) => x != null && str(x) !== "")
      .map((x) => str(x));
    if (extras.length) {
      comment = [comment, ...extras].filter(Boolean).join(" | ");
    }

    const rec = {
      type,
      status,
      customer,
      customerPo: str(cellVal(row.getCell(2))),
      orderDate: excelDateToStr(cellVal(row.getCell(3))),
      customerAmount: num(cellVal(row.getCell(4))),
      orderStatus,
      paymentFact: paymentFactVal,
      supplierPo: str(cellVal(row.getCell(7))),
      supplierAmount: num(cellVal(row.getCell(8))),
      supplier: str(cellVal(row.getCell(9))),
      finalBuyer: str(cellVal(row.getCell(10))),
      finAgent: str(cellVal(row.getCell(11))),
      paymentWithAgent: num(cellVal(row.getCell(12))),
      customsCost: num(cellVal(row.getCell(13))),
      deliveryCost: num(cellVal(row.getCell(14))),
      margin: num(cellVal(row.getCell(15))),
      netProfit: num(cellVal(row.getCell(16))),
      vatExempt: str(cellVal(row.getCell(17))),
      comment,
      hasUpd,
      updNum,
      updDate,
      noGlobalSmart: false,
    };
    out.push(rec);
  }
  return out;
}

function parseDebtsSheet(ws) {
  const out = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const company = str(cellVal(row.getCell(1)));
    if (!company) continue;
    const ord = str(cellVal(row.getCell(2)));
    if (!ord) continue;

    out.push({
      company,
      order: ord,
      amount: num(cellVal(row.getCell(3))),
      dueDate: excelDateToStr(cellVal(row.getCell(4))),
      upd: "",
      currency: "USD",
      status: "open",
      payDate: "",
      payComment: "",
    });
  }
  return out;
}

async function main() {
  const arg = process.argv[2];
  const xlsxPath = findFinanceXlsx(arg && !arg.startsWith("-") ? arg : null);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);

  const sheetRot = wb.worksheets[0];
  const sheetExp = wb.worksheets[1];
  const sheetDebts = wb.worksheets[2];

  const finDomestic = parseFinSheet(sheetRot, "domestic");
  const finExport = parseFinSheet(sheetExp, "export");
  const finAll = [...finDomestic, ...finExport];
  const debtsRows = parseDebtsSheet(sheetDebts);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM fin_results");
    await client.query("DELETE FROM debts");
    await client.query("ALTER SEQUENCE fin_results_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE debts_id_seq RESTART WITH 1");

    let id = 0;
    for (const r of finAll) {
      id++;
      await client.query(
        `INSERT INTO fin_results (
          id, type, status, customer, customer_po, order_date, customer_amount, order_status,
          payment_fact, supplier_po, supplier_amount, supplier, final_buyer, fin_agent,
          payment_with_agent, customs_cost, delivery_cost, margin, net_profit, vat_exempt, comment,
          has_upd, upd_num, upd_date, no_global_smart
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
        )`,
        [
          id,
          r.type,
          r.status,
          r.customer,
          r.customerPo,
          r.orderDate,
          r.customerAmount,
          r.orderStatus,
          r.paymentFact,
          r.supplierPo,
          r.supplierAmount,
          r.supplier,
          r.finalBuyer,
          r.finAgent,
          r.paymentWithAgent,
          r.customsCost,
          r.deliveryCost,
          r.margin,
          r.netProfit,
          r.vatExempt,
          r.comment,
          r.hasUpd,
          r.updNum,
          r.updDate,
          r.noGlobalSmart,
        ]
      );
    }

    await client.query(`SELECT setval('fin_results_id_seq', (SELECT COALESCE(MAX(id), 1) FROM fin_results))`);

    id = 0;
    for (const d of debtsRows) {
      id++;
      await client.query(
        `INSERT INTO debts (id, company, "order", amount, due_date, upd, currency, status, pay_date, pay_comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, d.company, d.order, d.amount, d.dueDate, d.upd, d.currency, d.status, d.payDate, d.payComment]
      );
    }
    await client.query(`SELECT setval('debts_id_seq', (SELECT COALESCE(MAX(id), 1) FROM debts))`);

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }

  const finDataJs = [];
  finAll.forEach((r, i) => {
    finDataJs.push({
      id: i + 1,
      type: r.type,
      status: r.status,
      customer: r.customer,
      customerPo: r.customerPo,
      orderDate: r.orderDate,
      customerAmount: r.customerAmount,
      orderStatus: r.orderStatus,
      paymentFact: r.paymentFact,
      supplierPo: r.supplierPo,
      supplierAmount: r.supplierAmount,
      supplier: r.supplier,
      finalBuyer: r.finalBuyer,
      finAgent: r.finAgent,
      paymentWithAgent: r.paymentWithAgent,
      customsCost: r.customsCost,
      deliveryCost: r.deliveryCost,
      margin: r.margin,
      netProfit: r.netProfit,
      vatExempt: r.vatExempt,
      comment: r.comment,
      hasUpd: r.hasUpd,
      updNum: r.updNum,
      updDate: r.updDate,
      updFile: null,
    });
  });

  const debtsDataJs = debtsRows.map((d, i) => ({
    id: i + 1,
    company: d.company,
    order: d.order,
    amount: d.amount,
    dueDate: d.dueDate,
    upd: d.upd,
    currency: d.currency,
    status: d.status,
    payDoc: null,
    payDate: d.payDate,
    payComment: d.payComment,
  }));

  const finPath = path.join(__dirname, "..", "src", "data", "finData.js");
  const debtsPath = path.join(__dirname, "..", "src", "data", "debtsData.js");

  const baseName = path.basename(xlsxPath);
  fs.writeFileSync(
    finPath,
    `// Фин результат — импорт из Excel (${baseName})\n// Всего записей: ${finDataJs.length} (ROT: ${finDomestic.length}, EXP: ${finExport.length})\n\nexport const FIN_DATA = ${JSON.stringify(finDataJs, null, 2)};\n`,
    "utf8"
  );

  const totalAmt = debtsDataJs.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
  fs.writeFileSync(
    debtsPath,
    `// Дебиторская задолженность — импорт из Excel (${baseName})\n// Всего записей: ${debtsDataJs.length}\n// Сумма (прибл.): $${totalAmt.toFixed(2)}\n\nexport const DEBTS_DATA = ${JSON.stringify(debtsDataJs, null, 2)};\n`,
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        file: xlsxPath,
        finResults: finAll.length,
        rot: finDomestic.length,
        exp: finExport.length,
        debts: debtsRows.length,
        finDataJs: finPath,
        debtsDataJs: debtsPath,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
