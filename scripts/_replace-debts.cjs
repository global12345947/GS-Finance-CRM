/**
 * Полная замена дебиторской задолженности актуальными данными.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const path = require("path");
const fs   = require("fs");
const { pool } = require("../server/db.cjs");

// ── Актуальные данные ────────────────────────────────────────────────────────
const NEW_DEBTS = [
  // A-tech
  { company: "A-tech",  order: "P2710225",        amount: 23760.00, currency: "USD", dueDate: "2025-12-22" },
  { company: "A-tech",  order: "P2722725",         amount: 23193.00, currency: "USD", dueDate: "2026-01-13" },
  { company: "A-tech",  order: "P2760125",         amount:  5568.00, currency: "USD", dueDate: "2026-01-28" },
  { company: "A-tech",  order: "P2764725",         amount:  5859.00, currency: "USD", dueDate: "2026-01-27" },
  { company: "A-tech",  order: "P2668525",         amount:  6681.00, currency: "USD", dueDate: "2025-12-22" },
  { company: "A-tech",  order: "P2687125",         amount: 26502.00, currency: "USD", dueDate: "2025-12-25" },
  { company: "A-tech",  order: "P2831026",         amount:  4623.00, currency: "USD", dueDate: "" },
  { company: "A-tech",  order: "P2858926",         amount:  3358.00, currency: "USD", dueDate: "" },

  // RApart
  { company: "RApart",  order: "00KA-026402",      amount: 178066.00, currency: "USD", dueDate: "" },

  // Utair
  { company: "Utair",   order: "P19278126",        amount: 135000.00, currency: "USD", dueDate: "" },
  { company: "Utair",   order: "P19123826",        amount:   6497.00, currency: "USD", dueDate: "" },
  { company: "Utair",   order: "P19149826",        amount:   2452.16, currency: "USD", dueDate: "" },
  { company: "Utair",   order: "P19134526",        amount:  15000.00, currency: "USD", dueDate: "" },
  { company: "Utair",   order: "P19064826",        amount:  46000.00, currency: "USD", dueDate: "" },
  { company: "Utair",   order: "P19226826",        amount:   1474.40, currency: "USD", dueDate: "" },
  { company: "Utair",   order: "P18985326",        amount:   2660.32, currency: "USD", dueDate: "" },
  { company: "Utair",   order: "P19087426",        amount:   3884.85, currency: "USD", dueDate: "" },
  { company: "Utair",   order: "P19232826",        amount:  50000.00, currency: "USD", dueDate: "" },
  { company: "Utair",   order: "P19234126",        amount:   5635.70, currency: "USD", dueDate: "" },
  { company: "Utair",   order: "P19201826",        amount:   4420.00, currency: "USD", dueDate: "" },
  { company: "Utair",   order: "P19163126",        amount:   5463.81, currency: "USD", dueDate: "" },

  // Belavia
  { company: "Belavia", order: "ДОПОЛНЕНИЕ № 16",  amount: 306000.00, currency: "USD", dueDate: "" },
  { company: "Belavia", order: "ДОПОЛНЕНИЕ № 7",   amount:  15600.00, currency: "USD", dueDate: "" },
  { company: "Belavia", order: "ДОПОЛНЕНИЕ № 19",  amount:  14700.00, currency: "USD", dueDate: "" },
  { company: "Belavia", order: "ДОПОЛНЕНИЕ № 20",  amount:  16500.00, currency: "USD", dueDate: "" },
  { company: "Belavia", order: "ДОПОЛНЕНИЕ № 17",  amount:  28900.00, currency: "USD", dueDate: "" },
];

const TOTAL_EXPECTED = 937798.24;

(async () => {
  // Проверяем колонки
  const { rows: cols } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='debts' ORDER BY ordinal_position"
  );
  console.log("Колонки debts:", cols.map(r => r.column_name).join(", "));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Удаляем всё старое
    const { rowCount: deleted } = await client.query("DELETE FROM debts");
    console.log(`🗑  Удалено старых записей: ${deleted}`);

    // Сбрасываем последовательность ID
    await client.query("ALTER SEQUENCE debts_id_seq RESTART WITH 1");

    // Вставляем новые
    for (const d of NEW_DEBTS) {
      await client.query(
        `INSERT INTO debts (company, "order", amount, currency, due_date, status)
         VALUES ($1, $2, $3, $4, $5, 'open')`,
        [d.company, d.order, d.amount, d.currency, d.dueDate || null]
      );
    }
    console.log(`✅ Вставлено новых записей: ${NEW_DEBTS.length}`);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Проверяем сумму
  const { rows: sumRows } = await pool.query("SELECT SUM(amount) as total FROM debts WHERE status='open'");
  const total = parseFloat(sumRows[0].total);
  console.log(`\nИтого в БД: $${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  console.log(`Ожидалось:  $${TOTAL_EXPECTED.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  if (Math.abs(total - TOTAL_EXPECTED) < 0.01) console.log("✅ Суммы совпадают");
  else console.warn("⚠  Расхождение:", Math.abs(total - TOTAL_EXPECTED));

  // Регенерируем debtsData.js
  const { rows: allDebts } = await pool.query("SELECT * FROM debts ORDER BY id");

  const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const debtJs = allDebts.map((r) => {
    const obj = {};
    for (const [k, v] of Object.entries(r)) obj[toCamel(k)] = v === null ? null : v;
    return obj;
  });

  const outPath = path.join(__dirname, "..", "src", "data", "debtsData.js");
  fs.writeFileSync(outPath, `// Auto-generated — ${new Date().toISOString()}
export const initialDebts = ${JSON.stringify(debtJs, null, 2)};
`, "utf8");

  console.log(`✅ debtsData.js записан: ${debtJs.length} записей`);
  await pool.end();
})().catch(e => { console.error("Ошибка:", e.message); process.exit(1); });
