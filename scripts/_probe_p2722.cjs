const path = require("path");
const ExcelJS = require("exceljs");

(async () => {
  const fp = path.join(__dirname, "..", "OPEN PO Actual LIST GS (1).xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const ws = wb.worksheets[0];
  for (const r of [208, 209, 210]) {
    const row = ws.getRow(r);
    const d4 = row.getCell(4).value;
    const cells = [1, 2, 4, 11, 12, 13, 14, 15].map((c) => row.getCell(c).value);
    console.log("row", r, "D4", d4, "\n  ", cells);
  }
})();
