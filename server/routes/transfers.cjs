const { Router } = require("express");
const { pool } = require("../db.cjs");
const { snakeToCamel, buildInsert, buildUpdate } = require("../utils.cjs");
const { broadcast } = require("../ws.cjs");
const router = Router();

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM pending_transfers ORDER BY created_at DESC");
    res.json(rows.map(snakeToCamel));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { sql, vals } = buildInsert("pending_transfers", req.body);
    const { rows } = await pool.query(sql, vals);
    const row = snakeToCamel(rows[0]);
    broadcast("transfers:create", row, req.headers["x-client-id"]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const q = buildUpdate("pending_transfers", req.params.id, req.body);
    if (!q) return res.status(400).json({ error: "No valid fields" });
    const { rows } = await pool.query(q.sql, q.vals);
    const row = snakeToCamel(rows[0]);
    broadcast("transfers:update", row, req.headers["x-client-id"]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query("DELETE FROM pending_transfers WHERE id = $1 RETURNING *", [id]);
    broadcast("transfers:delete", { id }, req.headers["x-client-id"]);
    res.json(rows[0] ? snakeToCamel(rows[0]) : { deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
