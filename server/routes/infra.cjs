const { Router } = require("express");
const { pool } = require("../db.cjs");
const { broadcast } = require("../ws.cjs");
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
    const row = snakeToCamel(rows[0]);
    broadcast("infra:create", row, req.headers["x-client-id"]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const allowed = ["po_ref", "description", "received", "outgoing", "bank_fees", "supplier", "invoice", "date", "balance", "comment"];
    const { camelToSnake } = require("../utils.cjs");
    const snake = camelToSnake(req.body);
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const col of allowed) {
      if (snake[col] !== undefined) {
        sets.push(`"${col}" = $${idx++}`);
        vals.push(snake[col]);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: "No valid fields" });
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE infra_operations SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      vals
    );
    const row = snakeToCamel(rows[0]);
    broadcast("infra:update", row, req.headers["x-client-id"]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/by-transfer/:transferId", async (req, res) => {
  try {
    const cid = req.headers["x-client-id"];
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
    const ops = rows.map(snakeToCamel);
    ops.forEach((op) => broadcast("infra:delete", { id: op.id, accountName: op.accountName }, cid));
    res.json({ deleted: rows.length, ops });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("DELETE FROM infra_operations WHERE id = $1 RETURNING *", [parseInt(req.params.id)]);
    const row = rows[0] ? snakeToCamel(rows[0]) : null;
    if (row) broadcast("infra:delete", { id: row.id, accountName: row.accountName }, req.headers["x-client-id"]);
    res.json(row || { deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
