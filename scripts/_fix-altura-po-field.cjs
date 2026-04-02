require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../server/db.cjs");

(async () => {
  // Переносим invoice → po_ref для всех новых операций Altura GS USD (id > 66)
  // где invoice непустой
  const { rowCount, rows } = await pool.query(`
    UPDATE infra_operations
    SET po_ref  = invoice,
        invoice = ''
    WHERE account_name = 'Altura GS USD'
      AND id > 66
      AND invoice IS NOT NULL
      AND invoice <> ''
    RETURNING id, po_ref, invoice
  `);

  console.log(`✅ Обновлено ${rowCount} строк:`);
  for (const r of rows) {
    console.log(`  id=${r.id}  po_ref="${r.po_ref}"  invoice="${r.invoice}"`);
  }

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
