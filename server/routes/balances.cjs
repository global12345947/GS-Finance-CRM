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

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM balances ORDER BY id");
    res.json(rows.map(snakeToCamel));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { balance } = req.body;
    const { rows } = await pool.query(
      "UPDATE balances SET balance = $1 WHERE id = $2 RETURNING *",
      [balance, parseInt(req.params.id)]
    );
    const row = snakeToCamel(rows[0]);
    broadcast("balances:update", row, req.headers["x-client-id"]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
