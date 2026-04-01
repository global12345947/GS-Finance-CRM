const { Router } = require("express");
const { pool } = require("../db.cjs");
const router = Router();

const snakeToCamel = (row) => {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
};

router.get("/accounts", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT DISTINCT account_name FROM infra_operations ORDER BY account_name"
    );
    res.json(rows.map((r) => r.account_name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:account", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM infra_operations WHERE account_name = $1 ORDER BY id",
      [req.params.account]
    );
    res.json(rows.map(snakeToCamel));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM infra_operations ORDER BY account_name, id");
    const grouped = {};
    rows.forEach((r) => {
      const acc = r.account_name;
      if (!grouped[acc]) grouped[acc] = [];
      grouped[acc].push(snakeToCamel(r));
    });
    res.json(grouped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { camelToSnake, filterCols } = require("../utils.cjs");
    const data = filterCols(camelToSnake(req.body), "infra_operations");
    const keys = Object.keys(data);
    const vals = keys.map((k) => data[k]);
    const placeholders = keys.map((_, i) => `$${i + 1}`);
    const quotedKeys = keys.map((k) => `"${k}"`);
    const { rows } = await pool.query(
      `INSERT INTO infra_operations (${quotedKeys.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
      vals
    );
    res.json(snakeToCamel(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { comment } = req.body;
    const { rows } = await pool.query(
      "UPDATE infra_operations SET comment = $1 WHERE id = $2 RETURNING *",
      [comment, parseInt(req.params.id)]
    );
    res.json(snakeToCamel(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/by-transfer/:transferId", async (req, res) => {
  try {
    const tid = parseInt(req.params.transferId);
    let { rows } = await pool.query(
      "DELETE FROM infra_operations WHERE transfer_id = $1 RETURNING *",
      [tid]
    );
    if (rows.length === 0 && req.query.desc) {
      const result = await pool.query(
        "DELETE FROM infra_operations WHERE UPPER(description) = UPPER($1) RETURNING *",
        [req.query.desc]
      );
      rows = result.rows;
    }
    res.json({ deleted: rows.length, ops: rows.map(snakeToCamel) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("DELETE FROM infra_operations WHERE id = $1 RETURNING *", [parseInt(req.params.id)]);
    res.json(rows[0] ? snakeToCamel(rows[0]) : { deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
