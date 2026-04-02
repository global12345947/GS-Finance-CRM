require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../server/db.cjs");

(async () => {
  const r1 = await pool.query(
    "SELECT COUNT(*) as total, SUM(CASE WHEN force_closed THEN 1 ELSE 0 END) as force_cnt, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed_cnt FROM fin_results WHERE type='domestic'"
  );
  console.log("Domestic:", r1.rows[0]);

  const r2 = await pool.query(
    "SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed_cnt FROM fin_results WHERE type='export'"
  );
  console.log("Export:", r2.rows[0]);

  const r3 = await pool.query(
    "SELECT COUNT(*) as no_date FROM fin_results WHERE (order_date IS NULL OR order_date='') AND type='domestic'"
  );
  console.log("Domestic без дат:", r3.rows[0]);

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
