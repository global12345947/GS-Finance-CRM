/**
 * Глубокий зонд финансового Excel-файла:
 * - Сколько реальных строк в каждом листе
 * - Где ДОПОЛНЕНИЕ №20
 * - Строки без даты
 * - Строки с УПД и 0-оплатой
 */
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const f = fs.readdirSync(root).find((x) => x.endsWith(".xlsx") && !x.includes("OPEN PO"));
console.log("File:", f);

function cellStr(cell) {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object" && v.result != null) return String(v.result).trim();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim().replace(/\r\n/g, " ").replace(/\n/g, " ");
}
function cellNum(cell) {
  const v = cell.value;
  if (v == null) return 0;
  if (typeof v === "object" && v.result != null) return parseFloat(v.result) || 0;
  return parseFloat(v) || 0;
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(root, f));

  // === Sheet 0: ROT ===
  const ws0 = wb.worksheets[0];
  let rotDataRows = 0;
  let dopolnenieRows = [];
  let noDateRows = [];
  let updWithNoPaymentRows = [];
  const dop20Idx = { row: -1 };

  for (let r = 2; r <= ws0.rowCount; r++) {
    const row = ws0.getRow(r);
    const customer = cellStr(row.getCell(1));
    if (!customer) continue;
    rotDataRows++;
    const po = cellStr(row.getCell(2));
    const date = cellStr(row.getCell(3));
    const status = cellStr(row.getCell(5));
    const payment = cellNum(row.getCell(6));

    if (po.includes("ДОПОЛНЕНИЕ")) {
      dopolnenieRows.push({ r, po, date, status, payment });
      if (po.includes("ДОПОЛНЕНИЕ № 20") || po.includes("ДОПОЛНЕНИЕ №20")) {
        dop20Idx.row = r;
      }
    }
    if (!date) {
      noDateRows.push({ r, customer, po, status, payment });
    }
    if (/УПД/i.test(status) && payment === 0) {
      updWithNoPaymentRows.push({ r, customer, po, date, status });
    }
  }

  console.log("\n=== ROT (Sheet 0) ===");
  console.log("Data rows:", rotDataRows);
  console.log("ДОПОЛНЕНИЕ orders:", dopolnenieRows.length);
  dopolnenieRows.forEach((d) => console.log("  row", d.r, d.po, "| payment:", d.payment));
  console.log("\nДОПОЛНЕНИЕ №20 row:", dop20Idx.row);
  console.log("\nRows WITHOUT date:", noDateRows.length);
  noDateRows.slice(0, 20).forEach((d) => console.log("  row", d.r, "|", d.customer, "|", d.po, "|", d.status.substring(0, 30)));
  console.log("\nRows WITH УПД but NO payment:", updWithNoPaymentRows.length);
  updWithNoPaymentRows.slice(0, 20).forEach((d) => console.log("  row", d.r, "|", d.customer, "|", d.po, "|", d.date, "|", d.status.substring(0, 30)));

  // === Sheet 1: EXP ===
  const ws1 = wb.worksheets[1];
  let expDataRows = 0;
  let expUpdNoPayment = [];
  for (let r = 2; r <= ws1.rowCount; r++) {
    const row = ws1.getRow(r);
    const customer = cellStr(row.getCell(1));
    if (!customer) continue;
    expDataRows++;
    const po = cellStr(row.getCell(2));
    const date = cellStr(row.getCell(3));
    const status = cellStr(row.getCell(5));
    const payment = cellNum(row.getCell(6));
    if (/УПД/i.test(status) && payment === 0) {
      expUpdNoPayment.push({ r, customer, po, date, status });
    }
  }
  console.log("\n=== EXP (Sheet 1) ===");
  console.log("Data rows:", expDataRows);
  console.log("Rows WITH УПД but NO payment:", expUpdNoPayment.length);
  expUpdNoPayment.slice(0, 10).forEach((d) => console.log("  row", d.r, "|", d.customer, "|", d.po, "|", d.date, "|", d.status.substring(0, 30)));

})().catch((e) => { console.error(e); process.exit(1); });
