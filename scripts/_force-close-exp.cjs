require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const path = require("path");
const fs   = require("fs");
const { pool } = require("../server/db.cjs");

const TARGET_POS = ["P19113026", "P2328126", "P19125526", "P20749026"];

(async () => {
  for (const po of TARGET_POS) {
    const { rows } = await pool.query(
      `UPDATE fin_results
       SET status = 'completed', force_closed = true
       WHERE customer_po = $1 AND type = 'export'
       RETURNING id, customer, customer_po, status, force_closed`,
      [po]
    );
    if (rows.length) {
      for (const r of rows)
        console.log(`✅ id=${r.id} ${r.customer} | ${r.customer_po} → completed (force_closed=true)`);
    } else {
      console.warn(`⚠  Не найден: ${po}`);
    }
  }

  // Обновляем finData.js
  const { rows: allFin } = await pool.query(
    `SELECT * FROM fin_results ORDER BY
       CASE type WHEN 'domestic' THEN 0 ELSE 1 END,
       CASE WHEN order_date ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN order_date::date ELSE NULL END NULLS LAST,
       id`
  );
  const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const rows2js = (rows) => rows.map((r) => {
    const obj = {};
    for (const [k, v] of Object.entries(r)) obj[toCamel(k)] = v === null ? null : v;
    return obj;
  });
  const domestic = rows2js(allFin.filter((r) => r.type === "domestic"));
  const exported = rows2js(allFin.filter((r) => r.type === "export"));

  const outPath = path.join(__dirname, "..", "src", "data", "finData.js");
  fs.writeFileSync(outPath, `// Auto-generated — ${new Date().toISOString()}
export const finDomestic = ${JSON.stringify(domestic, null, 2)};

export const finExport = ${JSON.stringify(exported, null, 2)};
`, "utf8");

  console.log(`\n✅ finData.js обновлён: domestic=${domestic.length}, export=${exported.length}`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
