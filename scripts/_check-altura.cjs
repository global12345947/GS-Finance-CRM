require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../server/db.cjs");

(async () => {
  // Все операции Altura GS USD, сортировка по дате
  const { rows: ops } = await pool.query(
    "SELECT * FROM infra_operations WHERE account_name='Altura GS USD' ORDER BY date, id"
  );
  console.log(`Все операции Altura GS USD (${ops.length}):`);
  for (const o of ops) {
    console.log(`  id=${o.id} ${o.date} balance=${o.balance} recv=${o.received} out=${o.outgoing} fee=${o.bank_fees} inv="${o.invoice}" sup="${o.supplier}" desc="${o.description}"`);
  }

  // Операции BAT
  const { rows: batOps } = await pool.query(
    "SELECT * FROM infra_operations WHERE account_name='Altura GS BAT' ORDER BY date, id"
  );
  console.log(`\nОперации Altura GS BAT (${batOps.length}):`);
  for (const o of batOps) {
    console.log(`  id=${o.id} ${o.date} balance=${o.balance} recv=${o.received} out=${o.outgoing} fee=${o.bank_fees} desc="${o.description}"`);
  }

  const { rows: b } = await pool.query("SELECT * FROM balances WHERE name IN ('Altura GS USD','Altura GS BAT')");
  console.log("\nБалансы:", b.map(r=>`${r.name}=${r.balance} ${r.currency}`).join(", "));

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
