/**
 * Добавление новых операций Altura GS USD (23.03.2026 – 02.04.2026)
 * + парная конвертация $3 063 USD → BAT на Altura GS BAT
 *
 * Курс USD/THB (BAT) для расчёта: ~33 THB за $1
 * (на основе предыдущих операций март 2026 ≈ 31.6–32 THB/$)
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const path = require("path");
const fs   = require("fs");
const { pool } = require("../server/db.cjs");

const USD_BAT_RATE = 33.0;
const FINAL_USD_BALANCE = 310979.62;
const BAT_AMOUNT = Math.round(3063 * USD_BAT_RATE); // 101 079

const NEW_OPS_USD = [
  { date: "2026-03-23", invoice: "AT26-0038", supplier: "Skyline Aero",     received: 0,         outgoing: 16500.00,  bank_fees: 0,       balance: 58590.05,  description: "" },
  { date: "2026-03-23", invoice: "",          supplier: "",                  received: 36810.00,  outgoing: 0,         bank_fees: 0,       balance: 95400.05,  description: "Перевод долга с AJ Parts" },
  { date: "2026-03-24", invoice: "YE26-0040", supplier: "YOON ENG.",        received: 0,         outgoing: 268.00,    bank_fees: 31.35,   balance: 95100.70,  description: "" },
  { date: "2026-03-24", invoice: "YE26-0039", supplier: "YOON ENG.",        received: 0,         outgoing: 24039.04,  bank_fees: 90.97,   balance: 70970.69,  description: "" },
  { date: "2026-03-25", invoice: "YE26-0034", supplier: "YOON ENG.",        received: 0,         outgoing: 4159.50,   bank_fees: 41.26,   balance: 66769.93,  description: "" },
  { date: "2026-03-25", invoice: "",          supplier: "",                  received: 0,         outgoing: 680.74,    bank_fees: 32.43,   balance: 66056.76,  description: "ISO CERTIFICATE" },
  { date: "2026-03-30", invoice: "",          supplier: "",                  received: 359521.00, outgoing: 0,         bank_fees: 0,       balance: 425577.76, description: "Перевод на счёт" },
  { date: "2026-03-30", invoice: "AT26-0044", supplier: "APD",              received: 0,         outgoing: 44000.00,  bank_fees: 140.62,  balance: 381437.14, description: "" },
  { date: "2026-03-30", invoice: "AT26-0046", supplier: "AJW",              received: 0,         outgoing: 6000.00,   bank_fees: 45.62,   balance: 375391.52, description: "" },
  { date: "2026-03-31", invoice: "AT26-0052", supplier: "ELCO AERO",        received: 0,         outgoing: 40000.00,  bank_fees: 130.55,  balance: 335260.97, description: "" },
  { date: "2026-03-31", invoice: "AT26-0051", supplier: "RYNOUL AVIATION",  received: 0,         outgoing: 122800.00, bank_fees: 337.55,  balance: 212123.42, description: "" },
  { date: "2026-03-31", invoice: "AT26-0043", supplier: "YOON ENG.",        received: 0,         outgoing: 35118.56,  bank_fees: 118.25,  balance: 176886.61, description: "" },
  { date: "2026-03-31", invoice: "",          supplier: "",                  received: 435000.00, outgoing: 0,         bank_fees: 0,       balance: 611886.61, description: "Перевод на счёт" },
  { date: "2026-04-01", invoice: "AT26-0048", supplier: "OWR",              received: 0,         outgoing: 90000.00,  bank_fees: 255.53,  balance: 521631.08, description: "" },
  { date: "2026-04-01", invoice: "AT26-0045", supplier: "ETC SUPPORT",      received: 0,         outgoing: 26500.00,  bank_fees: 96.96,   balance: 495034.12, description: "" },
  { date: "2026-04-01", invoice: "AT26-0042", supplier: "APD",              received: 0,         outgoing: 410000.00, bank_fees: 1055.67, balance: 83978.45,  description: "" },
  { date: "2026-04-02", invoice: "",          supplier: "",                  received: 241112.20, outgoing: 0,         bank_fees: 0,       balance: 325090.65, description: "Перевод на счёт" },
  { date: "2026-04-02", invoice: "AT26-0054", supplier: "YOON ENG.",        received: 0,         outgoing: 10989.90,  bank_fees: 58.13,   balance: 314042.62, description: "" },
  // Конвертация USD → BAT
  { date: "2026-04-01", invoice: "",          supplier: "",                  received: 0,         outgoing: 3063.00,   bank_fees: 0,       balance: 310979.62, description: `Конвертация USD→BAT (адм расходы Иван, ${USD_BAT_RATE} THB/$)`, isUsdToBat: true },
];

(async () => {
  // Узнаём максимальный transfer_id для парной транзакции
  const { rows: maxTid } = await pool.query(
    "SELECT MAX(transfer_id) as m FROM infra_operations"
  );
  const transferId = (parseInt(maxTid[0]?.m) || 0) + 1;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let insertedUsd = 0;

    for (const op of NEW_OPS_USD) {
      const tid = op.isUsdToBat ? transferId : null;
      await client.query(
        `INSERT INTO infra_operations
           (account_name, invoice, supplier, received, outgoing, bank_fees, balance, date, description, transfer_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          "Altura GS USD",
          op.invoice || "",
          op.supplier || "",
          op.received,
          op.outgoing,
          op.bank_fees,
          op.balance,
          op.date,
          op.description || "",
          tid,
        ]
      );
      insertedUsd++;
      if (op.isUsdToBat) console.log(`   Конвертация USD→BAT: transfer_id=${tid}`);
    }

    console.log(`✅ Вставлено операций Altura GS USD: ${insertedUsd}`);

    // Парная запись на Altura GS BAT
    const { rows: batBal } = await client.query(
      "SELECT balance FROM balances WHERE name='Altura GS BAT'"
    );
    const prevBatBalance = parseFloat(batBal[0]?.balance) || 46070.63;
    const newBatBalance  = parseFloat((prevBatBalance + BAT_AMOUNT).toFixed(2));

    await client.query(
      `INSERT INTO infra_operations
         (account_name, invoice, supplier, received, outgoing, bank_fees, balance, date, description, transfer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        "Altura GS BAT",
        "", "", BAT_AMOUNT, 0, 0,
        newBatBalance,
        "2026-04-01",
        `Конвертация USD→BAT (${USD_BAT_RATE} THB/$, $${3063} = ฿${BAT_AMOUNT}, адм расходы Иван)`,
        transferId,
      ]
    );
    console.log(`✅ Запись Altura GS BAT: +฿${BAT_AMOUNT} (курс ${USD_BAT_RATE} THB/$) → новый баланс ฿${newBatBalance}`);

    // Обновляем балансы
    await client.query("UPDATE balances SET balance=$1 WHERE name='Altura GS USD'", [FINAL_USD_BALANCE]);
    await client.query("UPDATE balances SET balance=$1 WHERE name='Altura GS BAT'", [newBatBalance]);

    console.log(`✅ Баланс Altura GS USD: $${FINAL_USD_BALANCE.toLocaleString("en-US", {minimumFractionDigits: 2})}`);
    console.log(`✅ Баланс Altura GS BAT: ฿${newBatBalance.toLocaleString("en-US", {minimumFractionDigits: 2})}`);

    await client.query("COMMIT");
    console.log("\n✅ Транзакция зафиксирована");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Обновляем balancesData.js если файл существует
  const outPath = path.join(__dirname, "..", "src", "data", "balancesData.js");
  if (fs.existsSync(outPath)) {
    const { rows: allBals } = await pool.query("SELECT * FROM balances ORDER BY id");
    const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const balsJs = allBals.map(r => {
      const o = {}; for (const [k,v] of Object.entries(r)) o[toCamel(k)] = v===null?null:v; return o;
    });
    fs.writeFileSync(outPath,
      `// Auto-generated — ${new Date().toISOString()}\nexport const initialBalances = ${JSON.stringify(balsJs, null, 2)};\n`,
      "utf8"
    );
    console.log(`✅ balancesData.js обновлён`);
  }

  await pool.end();
})().catch(e => { console.error("Ошибка:", e.message); process.exit(1); });
