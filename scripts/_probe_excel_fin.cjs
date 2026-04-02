const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const f = fs.readdirSync(root).find((x) => x.endsWith(".xlsx") && !x.includes("OPEN PO"));
console.log("File:", f);
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(root, f));
  wb.worksheets.forEach((ws, i) => {
    console.log("\nSheet", i, ":", ws.name, "| rows:", ws.rowCount);
    for (let r = 1; r <= 5; r++) {
      const row = ws.getRow(r);
      const vals = [];
      for (let c = 1; c <= 8; c++) {
        const v = row.getCell(c).value;
        const s = v == null ? "" : (typeof v === "object" && v.result != null ? v.result : typeof v === "object" && v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
        vals.push(s.substring(0, 25).replace(/\n/g, " "));
      }
      console.log("  row", r, ":", vals.join(" | "));
    }
    console.log("  ...");
    // Last 5 rows
    for (let r = Math.max(ws.rowCount - 4, 6); r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const vals = [];
      for (let c = 1; c <= 8; c++) {
        const v = row.getCell(c).value;
        const s = v == null ? "" : (typeof v === "object" && v.result != null ? v.result : typeof v === "object" && v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
        vals.push(s.substring(0, 25).replace(/\n/g, " "));
      }
      console.log("  row", r, ":", vals.join(" | "));
    }
  });
})().catch(e => { console.error(e); process.exit(1); });
