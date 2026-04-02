const { Router } = require("express");
const { pool } = require("../db.cjs");
const { snakeToCamel, buildInsert, buildUpdate } = require("../utils.cjs");
const { broadcast, isLockedByOther, getLockInfo } = require("../ws.cjs");
const router = Router();

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM fin_results ORDER BY id");
    res.json(rows.map(snakeToCamel));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { sql, vals } = buildInsert("fin_results", req.body);
    const { rows } = await pool.query(sql, vals);
    const row = snakeToCamel(rows[0]);
    broadcast("fin:create", row, req.headers["x-client-id"]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const clientId = req.headers["x-client-id"];
    if (isLockedByOther("fin", id, clientId)) {
      const lock = getLockInfo("fin", id);
      return res.status(423).json({ error: `Запись заблокирована: ${lock?.userName || "другой пользователь"}` });
    }
    const q = buildUpdate("fin_results", id, req.body);
    if (!q) return res.status(400).json({ error: "No valid fields" });
    const { rows } = await pool.query(q.sql, q.vals);
    const row = snakeToCamel(rows[0]);
    broadcast("fin:update", row, clientId);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const clientId = req.headers["x-client-id"];
    if (isLockedByOther("fin", id, clientId)) {
      const lock = getLockInfo("fin", id);
      return res.status(423).json({ error: `Запись заблокирована: ${lock?.userName || "другой пользователь"}` });
    }
    await pool.query("DELETE FROM fin_results WHERE id = $1", [id]);
    broadcast("fin:delete", { id }, clientId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
