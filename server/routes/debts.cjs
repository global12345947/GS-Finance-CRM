const { Router } = require("express");
const { pool } = require("../db.cjs");
const { snakeToCamel, buildInsert, buildUpdate } = require("../utils.cjs");
const router = Router();

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM debts ORDER BY id");
    res.json(rows.map(snakeToCamel));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { sql, vals } = buildInsert("debts", req.body);
    const { rows } = await pool.query(sql, vals);
    res.json(snakeToCamel(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const q = buildUpdate("debts", req.params.id, req.body);
    if (!q) return res.status(400).json({ error: "No valid fields" });
    const { rows } = await pool.query(q.sql, q.vals);
    res.json(snakeToCamel(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
