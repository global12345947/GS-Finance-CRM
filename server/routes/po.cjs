const { Router } = require("express");
const { pool } = require("../db.cjs");
const { snakeToCamel, buildInsert, buildUpdate } = require("../utils.cjs");
const { broadcast, isLockedByOther, getLockInfo } = require("../ws.cjs");
const router = Router();

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM open_po ORDER BY id");
    res.json(rows.map(snakeToCamel));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { sql, vals } = buildInsert("open_po", req.body);
    const { rows } = await pool.query(sql, vals);
    const row = snakeToCamel(rows[0]);
    broadcast("po:create", row, req.headers["x-client-id"]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const clientId = req.headers["x-client-id"];
    if (isLockedByOther("po", id, clientId)) {
      const lock = getLockInfo("po", id);
      return res.status(423).json({ error: `Запись заблокирована: ${lock?.userName || "другой пользователь"}` });
    }
    const q = buildUpdate("open_po", id, req.body);
    if (!q) return res.status(400).json({ error: "No valid fields" });
    const { rows } = await pool.query(q.sql, q.vals);
    const row = snakeToCamel(rows[0]);
    broadcast("po:update", row, clientId);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const clientId = req.headers["x-client-id"];
    if (isLockedByOther("po", id, clientId)) {
      const lock = getLockInfo("po", id);
      return res.status(423).json({ error: `Запись заблокирована: ${lock?.userName || "другой пользователь"}` });
    }
    await pool.query("DELETE FROM open_po WHERE id = $1", [id]);
    broadcast("po:delete", { id }, clientId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
