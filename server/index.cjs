require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { initDB } = require("./db.cjs");

const poRoutes = require("./routes/po.cjs");
const finRoutes = require("./routes/fin.cjs");
const debtsRoutes = require("./routes/debts.cjs");
const balancesRoutes = require("./routes/balances.cjs");
const infraRoutes = require("./routes/infra.cjs");
const transfersRoutes = require("./routes/transfers.cjs");
const filesRoutes = require("./routes/files.cjs");
const importRoutes = require("./routes/import.cjs");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true }));
app.use(express.json({ limit: "50mb" }));

app.use("/api/po", poRoutes);
app.use("/api/fin", finRoutes);
app.use("/api/debts", debtsRoutes);
app.use("/api/balances", balancesRoutes);
app.use("/api/infra", infraRoutes);
app.use("/api/transfers", transfersRoutes);
app.use("/api/files", filesRoutes);
app.use("/api/import", importRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

const rateCache = {};
app.get("/api/exchange-rate", async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: "from and to required" });
  const fromU = from.toUpperCase();
  const toU = to.toUpperCase();
  if (fromU === toU) return res.json({ rate: 1, from: fromU, to: toU });
  const cacheKey = `${fromU}_${toU}`;
  const cached = rateCache[cacheKey];
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
    return res.json({ rate: cached.rate, from: fromU, to: toU, cached: true });
  }
  try {
    const resp = await fetch(`https://open.er-api.com/v6/latest/${fromU}`);
    const data = await resp.json();
    if (data.result !== "success" || !data.rates[toU]) {
      return res.status(400).json({ error: `Rate ${fromU}→${toU} not found` });
    }
    const rate = data.rates[toU];
    rateCache[cacheKey] = { rate, ts: Date.now() };
    res.json({ rate, from: fromU, to: toU });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const distPath = path.join(__dirname, "..", "dist");
const fs = require("fs");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
  console.log("[Server] Раздача фронтенда из dist/");
}

app.use((err, req, res, next) => {
  console.error("[Server] Unhandled error:", err);
  res.status(500).json({ error: err.message });
});

const start = async () => {
  await initDB();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] GS CRM API запущен на http://localhost:${PORT}`);
  });
};

start().catch((err) => {
  console.error("[Server] Ошибка запуска:", err);
  process.exit(1);
});
