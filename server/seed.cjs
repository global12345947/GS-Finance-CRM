const fs = require("fs");
const path = require("path");
const { pool, initDB } = require("./db.cjs");

// Парсим ESM-экспорт как JSON (убираем export const X = и конвертируем в валидный JS)
const parseDataFile = (filePath, exportName) => {
  let content = fs.readFileSync(filePath, "utf-8");
  // Убираем ESM export
  content = content.replace(/export\s+const\s+\w+\s*=\s*/, "");
  // Убираем trailing ;
  content = content.replace(/;\s*$/, "");
  // eval как JS (данные — чистые литералы объектов/массивов)
  return eval(`(${content})`);
};

const seed = async () => {
  await initDB();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Open PO
    console.log("[Seed] Загрузка Open PO...");
    const poData = parseDataFile(path.join(__dirname, "..", "src", "data", "poData.js"));
    for (const r of poData) {
      await client.query(
        `INSERT INTO open_po (id, type, status, num, customer, resp_sales, internal_po, date_ordered,
          customer_deadline, terms_delivery, customer_amount, payment_status_customer, date_customer_paid,
          internal_po_ref, date_placed_supplier, resp_procurement, supplier_name, supplier_amount,
          payment_status_supplier, paying_company, date_paid_supplier, delivery_cost, awb, tracking,
          comments, mgmt_comments, has_upd, upd_num, upd_date, no_global_smart, order_stage, cancel_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id, r.type || "domestic", r.status || "active", r.num || "", r.customer || "", r.respSales || "",
          r.internalPo || "", r.dateOrdered || "", r.customerDeadline || "", r.termsDelivery || "",
          parseFloat(r.customerAmount) || 0, r.paymentStatusCustomer || "", r.dateCustomerPaid || "",
          r.internalPoRef || "", r.datePlacedSupplier || "", r.respProcurement || "", r.supplierName || "",
          parseFloat(r.supplierAmount) || 0, r.paymentStatusSupplier || "", r.payingCompany || "",
          r.datePaidSupplier || "", parseFloat(r.deliveryCost) || 0, r.awb || "", r.tracking || "",
          r.comments || "", r.mgmtComments || "", r.hasUpd || false, r.updNum || "", r.updDate || "",
          r.noGlobalSmart || false,
          r.orderStage || (r.status === "completed" ? "done" : r.status === "cancelled" ? "cancelled" : "in_work"),
          r.cancelReason || "",
        ]
      );
    }
    // Обновим sequence
    await client.query("SELECT setval('open_po_id_seq', (SELECT COALESCE(MAX(id),0) FROM open_po))");
    console.log(`[Seed] Open PO: ${poData.length} записей`);

    // 2. Fin Results
    console.log("[Seed] Загрузка Фин. результат...");
    const finData = parseDataFile(path.join(__dirname, "..", "src", "data", "finData.js"));
    for (const r of finData) {
      await client.query(
        `INSERT INTO fin_results (id, type, status, customer, customer_po, order_date, customer_amount,
          order_status, payment_fact, supplier_po, supplier_amount, supplier, final_buyer, fin_agent,
          payment_with_agent, customs_cost, delivery_cost, margin, net_profit, vat_exempt, comment,
          has_upd, upd_num, upd_date, no_global_smart)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id, r.type || "domestic", r.status || "active", r.customer || "", r.customerPo || "",
          r.orderDate || "", parseFloat(r.customerAmount) || 0, r.orderStatus || "",
          parseFloat(r.paymentFact) || 0, r.supplierPo || "", parseFloat(r.supplierAmount) || 0,
          r.supplier || "", r.finalBuyer || "", r.finAgent || "", parseFloat(r.paymentWithAgent) || 0,
          parseFloat(r.customsCost) || 0, parseFloat(r.deliveryCost) || 0, parseFloat(r.margin) || 0,
          parseFloat(r.netProfit) || 0, r.vatExempt || "", r.comment || "",
          r.hasUpd || false, r.updNum || "", r.updDate || "", r.noGlobalSmart || false,
        ]
      );
    }
    await client.query("SELECT setval('fin_results_id_seq', (SELECT COALESCE(MAX(id),0) FROM fin_results))");
    console.log(`[Seed] Фин. результат: ${finData.length} записей`);

    // 3. Debts
    console.log("[Seed] Загрузка Дебиторка...");
    const debtsData = parseDataFile(path.join(__dirname, "..", "src", "data", "debtsData.js"));
    for (const r of debtsData) {
      await client.query(
        `INSERT INTO debts (id, company, "order", amount, due_date, upd, currency, status, pay_date, pay_comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id, r.company || "", r.order || "", parseFloat(r.amount) || 0, r.dueDate || "",
          r.upd || "", r.currency || "USD", r.status || "open", r.payDate || "", r.payComment || "",
        ]
      );
    }
    await client.query("SELECT setval('debts_id_seq', (SELECT COALESCE(MAX(id),0) FROM debts))");
    console.log(`[Seed] Дебиторка: ${debtsData.length} записей`);

    // 4. Balances
    console.log("[Seed] Загрузка Балансы...");
    const balancesData = parseDataFile(path.join(__dirname, "..", "src", "data", "balancesData.js"));
    for (const r of balancesData) {
      await client.query(
        `INSERT INTO balances (id, name, "group", balance, currency, is_safe)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [r.id, r.name, r.group, parseFloat(r.balance) || 0, r.currency || "USD", r.isSafe || false]
      );
    }
    await client.query("SELECT setval('balances_id_seq', (SELECT COALESCE(MAX(id),0) FROM balances))");
    console.log(`[Seed] Балансы: ${balancesData.length} записей`);

    // 5. Infra Operations
    console.log("[Seed] Загрузка Инфра-операции...");
    const infraData = parseDataFile(path.join(__dirname, "..", "src", "data", "infraData.js"));
    let infraCount = 0;
    for (const [accountName, operations] of Object.entries(infraData)) {
      for (const r of operations) {
        await client.query(
          `INSERT INTO infra_operations (id, account_name, po_ref, received, outgoing, bank_fees,
            supplier, invoice, date, balance, description, comment)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO NOTHING`,
          [
            r.id, accountName, r.poRef || "", parseFloat(r.received) || 0, parseFloat(r.outgoing) || 0,
            parseFloat(r.bankFees) || 0, r.supplier || "", r.invoice || "", r.date || "",
            parseFloat(r.balance) || 0, r.description || "", r.comment || "",
          ]
        );
        infraCount++;
      }
    }
    await client.query("SELECT setval('infra_operations_id_seq', (SELECT COALESCE(MAX(id),0) FROM infra_operations))");
    console.log(`[Seed] Инфра-операции: ${infraCount} записей`);

    await client.query("COMMIT");
    console.log("\n[Seed] Миграция завершена успешно!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Seed] Ошибка:", err);
  } finally {
    client.release();
    await pool.end();
  }
};

seed();
