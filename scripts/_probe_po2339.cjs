const path = require("path");
const ExcelJS = require("exceljs");

(async () => {
  const fp = path.join(__dirname, "..", "OPEN PO Actual LIST GS (1).xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const ws = wb.worksheets[0];
  for (const r of [17, 18]) {
    const cell = ws.getRow(r).getCell(11);
    console.log("row", r, "font", JSON.stringify(cell.font), "value", cell.value);
  }
})();
