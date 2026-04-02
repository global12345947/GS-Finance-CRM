require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../server/db.cjs");

(async () => {
  // Смотрим полные данные PO13052025
  const { rows } = await pool.query(
    `SELECT id, type, status, customer_po, customer, order_date, customer_amount, payment_fact,
            has_upd, upd_num, upd_date, supplier_po, supplier_name, supplier_amount,
            fin_agent, customs, transport, margin, net_profit, comment, force_closed
     FROM fin_results
     WHERE customer_po ILIKE '%PO13052025%'
     ORDER BY id`
  );
  for (const r of rows) {
    console.log("---");
    console.log(JSON.stringify(r, null, 2));
  }

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
