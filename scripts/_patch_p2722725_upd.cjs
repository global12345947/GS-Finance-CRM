/**
 * Патч для P2722725: PO230640 (WOLFE) и PO230641 (Pilot John) отгружены (УПД №3 от 06.01.2026),
 * PO230730 (AvionTEQ) ещё не отгружен.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../server/db.cjs");

(async () => {
  const updLines = JSON.stringify([
    null,
    { num: "3", date: "06.01.2026", fileId: null },
    { num: "3", date: "06.01.2026", fileId: null },
  ]);

  await pool.query("ALTER TABLE open_po ADD COLUMN IF NOT EXISTS upd_lines TEXT");
  console.log("upd_lines column ensured");

  const result = await pool.query(
    `UPDATE open_po SET has_upd = true, upd_num = '3', upd_date = '06.01.2026', upd_lines = $1
     WHERE internal_po = 'P2722725' RETURNING id, internal_po, has_upd, upd_lines`,
    [updLines]
  );

  if (result.rows.length > 0) {
    console.log("✅ Обновлено:", result.rows[0].id, result.rows[0].internal_po);
    console.log("  has_upd:", result.rows[0].has_upd);
    console.log("  upd_lines:", result.rows[0].upd_lines);
  } else {
    console.log("❌ P2722725 не найден в БД");
  }

  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
