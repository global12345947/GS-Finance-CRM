require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../server/db.cjs");
pool.query(`SELECT internal_po, date_ordered FROM open_po WHERE
  internal_po ILIKE '%2494%' OR internal_po ILIKE '%2478%' OR
  internal_po ILIKE '%ЛЕВЕЛ%' OR internal_po ILIKE '%GS002%' OR
  internal_po ILIKE '%счет%15%' OR internal_po ILIKE '%счет%21%'`)
  .then(r => {
    r.rows.forEach(row => console.log(row.internal_po, "|", row.date_ordered));
    console.log("Total:", r.rows.length);
    pool.end();
  })
  .catch(e => { console.error(e.message); pool.end(); });
