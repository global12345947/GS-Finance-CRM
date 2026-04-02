/**
 * Для EXP записей: если есть УПД (has_upd=true) И оплата (payment_fact > 0) → статус "completed"
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const path = require("path");
const fs   = require("fs");
const { pool } = require("../server/db.cjs");

(async () => {
  // Смотрим что будет затронуто
  const { rows: preview } = await pool.query(`
    SELECT id, customer, customer_po, payment_fact, has_upd, upd_num, status
    FROM fin_results
    WHERE type = 'export'
      AND status != 'cancelled'
      AND status != 'completed'
      AND has_upd = true
      AND payment_fact::numeric > 0
    ORDER BY id
  `);

  console.log(`Будет обновлено: ${preview.length} записей`);
  for (const r of preview) {
    console.log(`  id=${r.id} ${r.customer} | ${r.customer_po} | оплата=${r.payment_fact} | УПД=${r.upd_num}`);
  }

  if (preview.length === 0) {
    console.log("Нечего обновлять.");
    await pool.end();
    return;
  }

  const { rowCount } = await pool.query(`
    UPDATE fin_results
    SET status = 'completed'
    WHERE type = 'export'
      AND status != 'cancelled'
      AND status != 'completed'
      AND has_upd = true
      AND payment_fact::numeric > 0
  `);
  console.log(`\n✅ Обновлено: ${rowCount} записей → status='completed'`);

  // Перегенерируем finData.js
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

  console.log(`✅ finData.js обновлён: domestic=${domestic.length}, export=${exported.length}`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
