require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../server/db.cjs");

(async () => {
  // EXP с УПД но без оплаты
  const { rows } = await pool.query(`
    SELECT id, customer, customer_po, order_date, customer_amount, payment_fact,
           has_upd, upd_num, upd_date, order_status, status
    FROM fin_results
    WHERE type = 'export'
      AND has_upd = true
      AND payment_fact::numeric = 0
    ORDER BY id
  `);

  console.log(`EXP с УПД но payment_fact=0: ${rows.length}`);
  for (const r of rows) {
    console.log(`  id=${r.id} status=${r.status} | ${r.customer} | ${r.customer_po} | УПД №${r.upd_num} от ${r.upd_date} | order_status="${r.order_status}"`);
  }

  // Итоги по EXP
  const { rows: stats } = await pool.query(`
    SELECT status, COUNT(*) as cnt
    FROM fin_results WHERE type='export'
    GROUP BY status ORDER BY status
  `);
  console.log("\nИтого EXP по статусам:");
  for (const r of stats) console.log(`  ${r.status}: ${r.cnt}`);

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
