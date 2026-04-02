/**
 * Синхронизация Open PO с Excel: цвет строки (кол. B), частичная отмена в Internal PO ref (кол. 11, зачёркивание → префикс ~).
 * Зелёная строка → status=completed, order_stage=done
 * Красная строка → status=cancelled, order_stage=cancelled
 * Белая/без заливки → status=active; канбан: если был done/cancelled — сброс в in_work, иначе без изменений
 *
 * Сопоставление: Excel «Client PO ref» (кол. 4) = БД internal_po.
 * Один и тот же Client PO может быть на нескольких строках Excel (несколько External PO) — все колонки K склеиваются по порядку.
 * Цвет строк B: все красные → отмена; все зелёные → выполнен; красная+зелёная → выполнен (часть отменена, часть сделана). Если есть хотя бы одна белая строка — заказ в работе (пока не все строки закрашены). Красная+белая без зелёной → в работе.
 * Красная строка Excel: к каждой строке K в БД добавляется префикс ~ (отменённая позиция), если ещё не зачёркнуто в rich text.
 * Rich text в K: если в одной ячейке есть и зачёркнутый, и рабочий Ext PO — в БД только рабочие (черновик PO230639 не дублируется); если все зачёркнуты — строки с ~.
 * Колонки 12–15 (дата размещения у поставщика, resp., поставщик, сумма) склеиваются по строкам Excel для того же Client PO.
 *
 * Запуск: node scripts/sync-open-po-from-excel.cjs [--dry-run] [--verbose] [путь-к-xlsx]
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ExcelJS = require("exceljs");
const { pool } = require("../server/db.cjs");

const DEFAULT_XLSX = path.join(__dirname, "..", "OPEN PO Actual LIST GS (1).xlsx");

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
  return String(val || "").trim();
}

/** Текст ячейки, включая richText без учёта зачёркивания */
function cellToPlainString(cell) {
  const v = cell.value;
  if (v == null || v === "") return "";
  if (typeof v === "string" || typeof v === "number") return String(v).trim();
  if (v.richText && Array.isArray(v.richText)) return v.richText.map((p) => p.text || "").join("").replace(/\s+/g, " ").trim();
  if (v.text != null) return String(v.text).trim();
  return String(v).trim();
}

function getArgbFromFill(cell) {
  const f = cell.fill;
  if (!f || f.type !== "pattern" || !f.fgColor?.argb) return null;
  return f.fgColor.argb;
}

/** @returns {'red'|'green'|'white'} */
function classifyRowColor(argb) {
  if (!argb || argb === "FFFFFFFF") return "white";
  const R = parseInt(argb.slice(2, 4), 16);
  const G = parseInt(argb.slice(4, 6), 16);
  const B = parseInt(argb.slice(6, 8), 16);
  if (R > 200 && G < 100 && B < 100) return "red";
  if (G > 140 && R < 80 && B < 120) return "green";
  if (G > 100 && G > R + 40) return "green";
  return "white";
}

/**
 * Rich text / string → internal_po_ref.
 * Зачёркнутые фрагменты: если в одной ячейке есть и зачёркнутые, и рабочие номера — в БД только рабочие
 * (отменённый черновик не дублируем с ~). Если в ячейке только зачёркнутые — строки с префиксом ~ (полная отмена позиций).
 */
function cellToInternalPoRef(cell) {
  const v = cell.value;
  if (v == null || v === "") return "";
  if (typeof v === "string") return String(v).replace(/\r\n/g, "\n").trimEnd();
  if (typeof v === "number") return String(v);
  if (v.richText && Array.isArray(v.richText)) {
    const lineBuf = { text: "", strike: null };
    /** @type {{ text: string; strike: boolean }[]} */
    const lines = [];

    const flushLine = () => {
      const line = lineBuf.text.replace(/\r/g, "").trim();
      if (!line.length) {
        lineBuf.text = "";
        lineBuf.strike = null;
        return;
      }
      const st = lineBuf.strike === true;
      lines.push({ text: line, strike: st });
      lineBuf.text = "";
      lineBuf.strike = null;
    };

    for (const part of v.richText) {
      const text = part.text ?? "";
      const strike = !!(part.font && part.font.strike);
      const chunks = text.split("\n");
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) flushLine();
        const chunk = chunks[i];
        if (!chunk.length) continue;
        if (lineBuf.strike === null) lineBuf.strike = strike;
        else if (lineBuf.strike !== strike) lineBuf.strike = false;
        lineBuf.text += chunk;
      }
    }
    flushLine();

    const hasActive = lines.some((l) => !l.strike);
    if (hasActive) {
      return lines
        .filter((l) => !l.strike)
        .map((l) => l.text.trim())
        .filter(Boolean)
        .join("\n");
    }
    return lines
      .map((l) => (l.strike ? "~" : "") + l.text)
      .join("\n")
      .replace(/\n$/, "");
  }
  return String(v).replace(/\r\n/g, "\n").trimEnd();
}

/**
 * Склейка K11 с учётом цвета строки: красная строка Excel = отмена позиции → префикс ~ (как зачёркивание).
 * Порядок строк — порядок строк Excel (ROT, затем EXP).
 */
function mergeInternalPoRefsWithRowColors(refs, rowColors) {
  const lines = [];
  const seen = new Set();
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const rowColor = rowColors[i];
    if (ref == null || ref === "") continue;
    const prefix = rowColor === "red" ? "~" : "";
    for (const line of String(ref).replace(/\r\n/g, "\n").split("\n")) {
      let t = line.trim();
      if (!t) continue;
      if (prefix && t.startsWith("~")) t = t.replace(/^\~+/, "");
      const marked = prefix ? prefix + t : t;
      if (seen.has(marked)) continue;
      seen.add(marked);
      lines.push(marked);
    }
  }
  return lines.join("\n");
}

/** Агрегация цветов строк B для одного Client PO (несколько физических строк Excel). */
function mergeRowColors(colors) {
  if (!colors || colors.length === 0) return "white";
  if (colors.every((c) => c === "red")) return "red";
  if (colors.every((c) => c === "green")) return "green";

  const hasR = colors.some((c) => c === "red");
  const hasG = colors.some((c) => c === "green");
  const hasW = colors.some((c) => c === "white");

  // Сначала: пока есть незакрашенная (белая) строка — заказ целиком в работе
  if (hasW) return "white";

  // Без белых: красная + зелёная — часть отменена, часть выполнена — заказ закрыт по выполнению
  if (hasR && hasG) return "green";
  if (hasR) return "red";

  return "white";
}

/**
 * Собирает строки Excel с одинаковым Client PO (кол. 4): и ROT, и EXP по очереди.
 * @returns {Map<string, { clientPo: string, internalPoRef: string, color: string, excelRowCount: number, sheetRows: { sheetKind: string, sheetRow: number }[] }>}
 */
function mergeExcelRowsByClientPo(fromDomestic, fromExp) {
  /** @type {Map<string, { internalPoRefs: string[], colors: string[], sheetRows: { sheetKind: string, sheetRow: number }[], datePlaced: string[], respProc: string[], supplierNames: string[], amountLines: (string|number)[] }>} */
  const acc = new Map();
  const push = (row) => {
    let e = acc.get(row.clientPo);
    if (!e) {
      e = {
        internalPoRefs: [],
        colors: [],
        sheetRows: [],
        datePlaced: [],
        respProc: [],
        supplierNames: [],
        amountLines: [],
      };
      acc.set(row.clientPo, e);
    }
    e.internalPoRefs.push(row.internalPoRef);
    e.colors.push(row.color);
    e.sheetRows.push({ sheetKind: row.sheetKind, sheetRow: row.sheetRow });
    e.datePlaced.push(row.datePlacedSupplier || "");
    e.respProc.push(row.respProcurement || "");
    e.supplierNames.push(row.supplierName || "");
    e.amountLines.push(row.supplierAmountLine);
  };
  for (const row of fromDomestic) push(row);
  for (const row of fromExp) push(row);

  const out = new Map();
  for (const [clientPo, e] of acc) {
    const sumSupplier = e.amountLines.reduce((s, a) => s + (parseFloat(a) || 0), 0);
    out.set(clientPo, {
      clientPo,
      internalPoRef: mergeInternalPoRefsWithRowColors(e.internalPoRefs, e.colors),
      color: mergeRowColors(e.colors),
      excelRowCount: e.sheetRows.length,
      sheetRows: e.sheetRows,
      datePlacedSupplier: e.datePlaced.map((x) => String(x).trim()).join("\n"),
      respProcurement: e.respProc.map((x) => String(x).trim()).join("\n"),
      supplierName: e.supplierNames.map((x) => String(x).trim()).join("\n"),
      supplierAmounts: e.amountLines
        .map((a) => {
          if (a == null || a === "") return "";
          const n = parseFloat(a);
          return Number.isFinite(n) ? String(n) : String(a);
        })
        .join("\n"),
      supplierAmountSum: sumSupplier,
    });
  }
  return out;
}

function normClientPo(val) {
  if (val == null) return "";
  const s = String(val).replace(/\r\n/g, "\n").trim();
  // В Excel иногда номер PO и примечание в одной ячейке через перенос — в БД обычно только первая строка
  return s.split("\n")[0].trim();
}

/**
 * @param {import('exceljs').Worksheet} ws
 * @param {'domestic'|'export'} sheetKind
 */
function collectRows(ws, sheetKind) {
  const rows = [];
  const firstDataRow = 2;
  for (let r = firstDataRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const clientPo = normClientPo(row.getCell(4).value);
    if (!clientPo) continue;
    const bCell = row.getCell(2);
    const color = classifyRowColor(getArgbFromFill(bCell));
    const internalPoRef = cellToInternalPoRef(row.getCell(11));
    rows.push({
      sheetRow: r,
      sheetKind,
      clientPo,
      color,
      internalPoRef,
      datePlacedSupplier: excelDateToStr(cellVal(row.getCell(12))),
      respProcurement: cellToPlainString(row.getCell(13)),
      supplierName: cellToPlainString(row.getCell(14)),
      supplierAmountLine: cellVal(row.getCell(15)),
    });
  }
  return rows;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const verbose = argv.includes("--verbose");
  const fileArg = argv.find((a) => !a.startsWith("--"));
  const xlsxPath = path.resolve(fileArg || DEFAULT_XLSX);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);

  const domestic = wb.worksheets[0];
  const exp = wb.worksheets[1];
  const fromDomestic = collectRows(domestic, "domestic");
  const fromExp = collectRows(exp, "export");

  const byClientPo = mergeExcelRowsByClientPo(fromDomestic, fromExp);

  let multiRowClientPo = 0;
  for (const ex of byClientPo.values()) {
    if (ex.excelRowCount > 1) multiRowClientPo++;
  }

  const stats = {
    updated: 0,
    skippedNoMatch: 0,
    skippedDuplicate: 0,
    dryRun,
    rowsFromExcel: byClientPo.size,
    excelPhysicalRows: fromDomestic.length + fromExp.length,
    clientPoMergedFromSeveralExcelRows: multiRowClientPo,
    missingClientPos: [],
  };

  const client = await pool.connect();
  try {
    for (const [clientPo, ex] of byClientPo) {
      const { rows: found } = await client.query(
        `SELECT id, internal_po, status, order_stage, internal_po_ref, date_placed_supplier, resp_procurement, supplier_name, supplier_amounts, supplier_amount
         FROM open_po WHERE TRIM(internal_po) = $1`,
        [clientPo]
      );
      if (found.length === 0) {
        stats.skippedNoMatch++;
        stats.missingClientPos.push({
          clientPo,
          excelRows: ex.sheetRows,
        });
        continue;
      }
      if (found.length > 1) stats.skippedDuplicate++;

      const newRef = ex.internalPoRef;
      const newDatePlaced = ex.datePlacedSupplier || "";
      const newResp = ex.respProcurement || "";
      const newSupplier = ex.supplierName || "";
      const newSupplierAmounts = ex.supplierAmounts || "";
      const newSupplierAmount = ex.supplierAmountSum > 0 ? ex.supplierAmountSum : null;

      for (const dbRow of found) {
        let status;
        let orderStage;
        if (ex.color === "green") {
          status = "completed";
          orderStage = "done";
        } else if (ex.color === "red") {
          status = "cancelled";
          orderStage = "cancelled";
        } else {
          status = "active";
          orderStage =
            dbRow.order_stage === "done" || dbRow.order_stage === "cancelled"
              ? "in_work"
              : dbRow.order_stage;
        }

        const norm = (s) => (s || "").replace(/\r\n/g, "\n").trim();
        const sameRef = norm(dbRow.internal_po_ref) === norm(newRef);
        const sameStatus = dbRow.status === status && dbRow.order_stage === orderStage;
        const sameMeta =
          norm(dbRow.date_placed_supplier) === norm(newDatePlaced) &&
          norm(dbRow.resp_procurement) === norm(newResp) &&
          norm(dbRow.supplier_name) === norm(newSupplier) &&
          norm(dbRow.supplier_amounts || "") === norm(newSupplierAmounts);
        const sameAmt =
          newSupplierAmount == null ||
          Math.abs(parseFloat(dbRow.supplier_amount) - newSupplierAmount) < 0.005;

        if (sameRef && sameStatus && sameMeta && sameAmt) continue;

        if (!dryRun) {
          await client.query(
            `UPDATE open_po SET status = $1, order_stage = $2, internal_po_ref = $3,
              date_placed_supplier = $4, resp_procurement = $5, supplier_name = $6, supplier_amounts = $7,
              supplier_amount = COALESCE($8, supplier_amount)
             WHERE id = $9`,
            [
              status,
              orderStage,
              newRef,
              newDatePlaced,
              newResp,
              newSupplier,
              newSupplierAmounts,
              newSupplierAmount,
              dbRow.id,
            ]
          );
        }
        stats.updated++;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  const out = { ...stats };
  if (!verbose) delete out.missingClientPos;
  console.log(JSON.stringify(out, null, 2));
  if (stats.skippedNoMatch > 0) {
    console.log(
      `[sync-open-po] В Excel есть Client PO, которых нет в БД (по internal_po): ${stats.skippedNoMatch} — проверьте опечатки или импорт. Добавьте --verbose для списка.`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
