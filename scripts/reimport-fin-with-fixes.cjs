/**
 * Полный переимпорт «Фин результат» (ROT + EXP) с исправлениями:
 *
 *  Task 1: orders с УПД + оплата → status="completed"
 *  Task 2: ROT-заказы до «ДОПОЛНЕНИЕ № 20» (Excel row 250) принудительно → completed,
 *           а если paymentFact=0 — добавляем рублёвый эквивалент suммы USD по курсу на дату УПД.
 *           Исключения: список FORCE_EXCLUDED_POS (не трогаем)
 *  Task 3: ROT → type="domestic", EXP → type="export"  (уже корректно по листам)
 *  Task 4: Строки без даты → берём дату из Open PO по совпадению internal_po = customerPo
 *
 * Запуск:  node scripts/reimport-fin-with-fixes.cjs [путь-к-xlsx]
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const ExcelJS = require("exceljs");
const { pool } = require("../server/db.cjs");

// ====== КОНФИГУРАЦИЯ ======

// Заказы, которые НЕ форсируем в "Выполнен" (Task 2)
const FORCE_EXCLUDED_POS = new Set([
  "00KA-024037",
  "PO2025-2208 R0",
  "P2806226",
  "P18649025",
  "P2716925",
  "P2770425",
  "P2752925",
  "Договор №Р592-2025",
  "ДОПОЛНЕНИЕ № 5",
  "P2796926",
  "P2783725",
  "P18985326",
  "P2818226",
  "P19280126",
]);

// Приблизительные среднемесячные курсы USD/RUB
const USD_RUB_RATES = {
  "2024-01": 89, "2024-02": 91, "2024-03": 92, "2024-04": 92,
  "2024-05": 89, "2024-06": 88, "2024-07": 87, "2024-08": 89,
  "2024-09": 91, "2024-10": 96, "2024-11": 100, "2024-12": 103,
  "2025-01": 101, "2025-02": 90, "2025-03": 87, "2025-04": 84,
  "2025-05": 82, "2025-06": 82, "2025-07": 81, "2025-08": 81,
  "2025-09": 90, "2025-10": 96, "2025-11": 100, "2025-12": 103,
  "2026-01": 90, "2026-02": 88, "2026-03": 86, "2026-04": 84,
};

function getUsdRubRate(dateStr) {
  if (!dateStr) return 90;
  let year, month;
  if (/^\d{4}-\d{2}/.test(dateStr)) {
    year = parseInt(dateStr.slice(0, 4));
    month = parseInt(dateStr.slice(5, 7));
  } else if (/(\d{2})\.(\d{2})\.(\d{4})/.test(dateStr)) {
    const m = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    month = parseInt(m[2]);
    year = parseInt(m[3]);
  } else return 90;
  const key = `${year}-${String(month).padStart(2, "0")}`;
  return USD_RUB_RATES[key] || 90;
}

// ====== УТИЛИТЫ ======

function findFinanceXlsx(explicit) {
  if (explicit) return path.resolve(explicit);
  const root = path.join(__dirname, "..");
  const f = fs.readdirSync(root).find((x) => x.endsWith(".xlsx") && !x.includes("OPEN PO"));
  if (!f) throw new Error("Не найден xlsx (кроме OPEN PO) в корне проекта");
  return path.join(root, f);
}

function cellVal(cell) {
  const v = cell.value;
  if (v && typeof v === "object") {
    if ("result" in v && v.result != null) return v.result;
    if (v instanceof Date) return v;
  }
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
  if (typeof val === "string" && /^\d{2}\.\d{2}\.\d{4}/.test(val)) {
    const [dd, mm, yyyy] = val.split(".");
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(val || "").trim();
}

function num(v) {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function str(v) {
  if (v == null) return "";
  return String(v).replace(/\r\n/g, "\n").trim();
}

function deriveFinStatus(orderStatusText, paymentFact) {
  const t = orderStatusText || "";
  if (/отмен/i.test(t)) return "cancelled";
  const pf = typeof paymentFact === "number" ? paymentFact : parseFloat(paymentFact) || 0;
  if (/УПД/i.test(t) && pf > 0) return "completed";
  return "active";
}

function parseUpdFromOrderStatus(t) {
  if (!t || !/УПД/i.test(t)) return { hasUpd: false, updNum: "", updDate: "" };
  const numM = t.match(/УПД\s*[№#]?\s*([\d\w]+)/i);
  const dateM = t.match(/от\s+([\d.]+)/i);
  return {
    hasUpd: true,
    updNum: numM ? String(numM[1]).trim() : "",
    updDate: dateM ? String(dateM[1]).trim() : "",
  };
}

// ====== ПАРСИНГ ЛИСТОВ ======

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
      _excelRow: r,
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
      forceClosed: false,
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

// ====== ГЛАВНАЯ ЛОГИКА ======

async function main() {
  const arg = process.argv[2];
  const xlsxPath = findFinanceXlsx(arg && !arg.startsWith("-") ? arg : null);
  console.log("Excel:", xlsxPath);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);

  const ws0 = wb.worksheets[0]; // ROT → domestic
  const ws1 = wb.worksheets[1]; // EXP → export
  const ws2 = wb.worksheets[2]; // Debts

  console.log(`Листы: "${ws0.name}" (${ws0.rowCount} rows), "${ws1.name}" (${ws1.rowCount} rows), "${ws2.name}" (${ws2.rowCount} rows)`);

  // Парсим данные
  const finDomestic = parseFinSheet(ws0, "domestic");
  const finExport = parseFinSheet(ws1, "export");
  const debtsRows = parseDebtsSheet(ws2);

  console.log(`Распарсено: ROT=${finDomestic.length}, EXP=${finExport.length}, Долги=${debtsRows.length}`);

  // ====== TASK 4: Загружаем даты из Open PO по совпадению ======
  const client = await pool.connect();
  let poDateMap = {};
  try {
    const { rows: poRows } = await client.query("SELECT internal_po, date_ordered FROM open_po");
    for (const row of poRows) {
      if (row.internal_po && row.date_ordered) {
        poDateMap[row.internal_po.trim().toLowerCase()] = row.date_ordered.trim();
      }
    }
    console.log(`Open PO: загружено ${poRows.length} записей для поиска дат`);
  } finally {
    // не отпускаем клиента — продолжаем транзакцию ниже
  }

  // Функция поиска даты из Open PO
  function lookupPoDate(customerPo) {
    if (!customerPo) return "";
    const key = customerPo.trim().toLowerCase();
    return poDateMap[key] || "";
  }

  // ====== TASK 4: Заполняем пустые даты ======
  let dateFixed = 0;
  for (const rec of finDomestic) {
    if (!rec.orderDate) {
      const found = lookupPoDate(rec.customerPo);
      if (found) {
        rec.orderDate = found;
        dateFixed++;
        console.log(`  Дата из Open PO: "${rec.customerPo}" → ${found}`);
      }
    }
  }
  console.log(`Task 4: исправлено дат = ${dateFixed}`);

  // ====== TASK 2: Force-completed для ROT до ДОПОЛНЕНИЕ №20 ======
  // Находим индекс ДОПОЛНЕНИЕ №20 в нашем массиве
  const dop20Idx = finDomestic.findIndex((r) =>
    /ДОПОЛНЕНИЕ\s*[№#]?\s*20$/i.test(r.customerPo)
  );
  const forceUpToIdx = dop20Idx >= 0 ? dop20Idx : finDomestic.length - 1;
  console.log(`ДОПОЛНЕНИЕ №20: индекс в массиве = ${dop20Idx} (customerPo="${finDomestic[dop20Idx]?.customerPo}")`);

  let forceCount = 0;
  let rubEquivCount = 0;

  for (let i = 0; i <= forceUpToIdx; i++) {
    const rec = finDomestic[i];
    if (rec.status === "cancelled") continue;
    if (FORCE_EXCLUDED_POS.has(rec.customerPo)) continue;

    // Форсируем статус
    if (rec.status !== "completed") {
      rec.status = "completed";
      forceCount++;
    }
    rec.forceClosed = true;

    // Добавляем рублёвый эквивалент только там, где платёж не задан
    if (rec.paymentFact === 0 && rec.customerAmount > 0) {
      // Дата для курса: сначала дата УПД, затем дата заказа
      const rateDate = rec.updDate || rec.orderDate || "";
      const rate = getUsdRubRate(rateDate);
      rec.paymentFact = Math.round(rec.customerAmount * rate);
      rubEquivCount++;
      console.log(`  RUB equiv: "${rec.customerPo}" — $${rec.customerAmount} × ${rate} = ${rec.paymentFact} RUB (дата: ${rateDate})`);
    }
  }

  console.log(`Task 2: force-completed = ${forceCount}, RUB эквивалентов = ${rubEquivCount}`);

  // ====== TASK 1: Проверяем — все с УПД+оплата должны быть completed ======
  let task1Fixed = 0;
  for (const rec of [...finDomestic, ...finExport]) {
    if (rec.status !== "cancelled" && rec.hasUpd && rec.paymentFact > 0 && rec.status !== "completed") {
      rec.status = "completed";
      task1Fixed++;
    }
  }
  console.log(`Task 1: дополнительно помечено completed = ${task1Fixed}`);

  const finAll = [...finDomestic, ...finExport];

  // ====== ЗАПИСЬ В БД ======
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM fin_results");
    await client.query("ALTER SEQUENCE fin_results_id_seq RESTART WITH 1");

    let id = 0;
    for (const r of finAll) {
      id++;
      await client.query(
        `INSERT INTO fin_results (
          id, type, status, customer, customer_po, order_date, customer_amount, order_status,
          payment_fact, supplier_po, supplier_amount, supplier, final_buyer, fin_agent,
          payment_with_agent, customs_cost, delivery_cost, margin, net_profit, vat_exempt, comment,
          has_upd, upd_num, upd_date, no_global_smart, force_closed
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
        )`,
        [
          id, r.type, r.status, r.customer, r.customerPo, r.orderDate, r.customerAmount,
          r.orderStatus, r.paymentFact, r.supplierPo, r.supplierAmount, r.supplier,
          r.finalBuyer, r.finAgent, r.paymentWithAgent, r.customsCost, r.deliveryCost,
          r.margin, r.netProfit, r.vatExempt, r.comment,
          r.hasUpd, r.updNum, r.updDate, r.noGlobalSmart, r.forceClosed || false,
        ]
      );
    }

    await client.query(`SELECT setval('fin_results_id_seq', (SELECT COALESCE(MAX(id), 1) FROM fin_results))`);

    // Долги
    await client.query("DELETE FROM debts");
    await client.query("ALTER SEQUENCE debts_id_seq RESTART WITH 1");
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
    console.log(`БД: записано fin_results=${finAll.length}, debts=${debtsRows.length}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }

  // ====== ЗАПИСЬ finData.js ======
  const finDataJs = finAll.map((r, i) => ({
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
    forceClosed: r.forceClosed || false,
  }));

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

  const baseName = path.basename(xlsxPath);
  const completedCount = finAll.filter((r) => r.status === "completed").length;
  const forceClosedCount = finAll.filter((r) => r.forceClosed).length;

  const finPath = path.join(__dirname, "..", "src", "data", "finData.js");
  fs.writeFileSync(
    finPath,
    `// Фин результат — импорт из Excel (${baseName})\n// Всего записей: ${finDataJs.length} (ROT: ${finDomestic.length}, EXP: ${finExport.length})\n// completed: ${completedCount}, force_closed: ${forceClosedCount}\n\nexport const FIN_DATA = ${JSON.stringify(finDataJs, null, 2)};\n`,
    "utf8"
  );

  const totalAmt = debtsDataJs.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
  const debtsPath = path.join(__dirname, "..", "src", "data", "debtsData.js");
  fs.writeFileSync(
    debtsPath,
    `// Дебиторская задолженность — импорт из Excel (${baseName})\n// Всего записей: ${debtsDataJs.length}\n// Сумма (прибл.): $${totalAmt.toFixed(2)}\n\nexport const DEBTS_DATA = ${JSON.stringify(debtsDataJs, null, 2)};\n`,
    "utf8"
  );

  console.log(JSON.stringify({ file: xlsxPath, finResults: finAll.length, rot: finDomestic.length, exp: finExport.length, completed: completedCount, forceClosed: forceClosedCount, datesFixed: dateFixed, debts: debtsRows.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
