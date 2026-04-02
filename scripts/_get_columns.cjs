require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../server/db.cjs");

(async () => {
  const { rows } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='fin_results' ORDER BY ordinal_position"
  );
  console.log("Columns:", rows.map(r => r.column_name).join(", "));

  // Full data for PO13052025
  const { rows: r2 } = await pool.query("SELECT * FROM fin_results WHERE customer_po ILIKE '%PO13052025%' ORDER BY id");
  for (const r of r2) console.log(JSON.stringify(r, null, 2));

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
