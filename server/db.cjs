const { Pool } = require("pg");
const path = require("path");

const pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  port: parseInt(process.env.PG_PORT || "5432"),
  database: process.env.PG_DATABASE || "gscrm",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "GlobalSmart",
});

const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS open_po (
        id SERIAL PRIMARY KEY,
        type TEXT DEFAULT 'domestic',
        status TEXT DEFAULT 'active',
        num TEXT,
        customer TEXT,
        resp_sales TEXT,
        internal_po TEXT,
        date_ordered TEXT,
        customer_deadline TEXT,
        terms_delivery TEXT,
        customer_amount NUMERIC DEFAULT 0,
        payment_status_customer TEXT,
        date_customer_paid TEXT,
        customer_payment_file_id TEXT,
        internal_po_ref TEXT,
        date_placed_supplier TEXT,
        resp_procurement TEXT,
        supplier_name TEXT,
        supplier_amount NUMERIC DEFAULT 0,
        payment_status_supplier TEXT,
        paying_company TEXT,
        date_paid_supplier TEXT,
        delivery_cost NUMERIC DEFAULT 0,
        awb TEXT,
        tracking TEXT,
        comments TEXT,
        mgmt_comments TEXT,
        has_upd BOOLEAN DEFAULT FALSE,
        upd_num TEXT,
        upd_date TEXT,
        upd_file_id TEXT,
        no_global_smart BOOLEAN DEFAULT FALSE,
        order_stage TEXT DEFAULT 'in_work',
        cancel_reason TEXT,
        logistics_plan TEXT,
        supplier_amounts TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS fin_results (
        id SERIAL PRIMARY KEY,
        type TEXT DEFAULT 'domestic',
        status TEXT DEFAULT 'active',
        customer TEXT,
        customer_po TEXT,
        order_date TEXT,
        customer_amount NUMERIC DEFAULT 0,
        order_status TEXT,
        payment_fact NUMERIC DEFAULT 0,
        payment_date TEXT,
        payment_doc_file_id TEXT,
        supplier_po TEXT,
        supplier_amount NUMERIC DEFAULT 0,
        supplier TEXT,
        final_buyer TEXT,
        fin_agent TEXT,
        payment_with_agent NUMERIC DEFAULT 0,
        customs_cost NUMERIC DEFAULT 0,
        delivery_cost NUMERIC DEFAULT 0,
        margin NUMERIC DEFAULT 0,
        net_profit NUMERIC DEFAULT 0,
        vat_exempt TEXT,
        comment TEXT,
        has_upd BOOLEAN DEFAULT FALSE,
        upd_num TEXT,
        upd_date TEXT,
        upd_file_id TEXT,
        no_global_smart BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS debts (
        id SERIAL PRIMARY KEY,
        company TEXT,
        "order" TEXT,
        amount NUMERIC DEFAULT 0,
        due_date TEXT,
        upd TEXT,
        currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT 'open',
        pay_doc_file_id TEXT,
        pay_date TEXT,
        pay_comment TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS balances (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE,
        "group" TEXT,
        balance NUMERIC DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        is_safe BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS infra_operations (
        id SERIAL PRIMARY KEY,
        account_name TEXT,
        po_ref TEXT,
        received NUMERIC DEFAULT 0,
        outgoing NUMERIC DEFAULT 0,
        bank_fees NUMERIC DEFAULT 0,
        supplier TEXT,
        invoice TEXT,
        date TEXT,
        balance NUMERIC DEFAULT 0,
        description TEXT,
        comment TEXT,
        transfer_id INTEGER
      );

      CREATE TABLE IF NOT EXISTS pending_transfers (
        id SERIAL PRIMARY KEY,
        from_acc TEXT,
        to_acc TEXT,
        amount NUMERIC DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        to_currency TEXT,
        exchange_rate NUMERIC,
        converted_amount NUMERIC,
        description TEXT,
        date TEXT,
        status TEXT,
        completed_at TIMESTAMPTZ,
        file_name TEXT,
        file_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        entity_type TEXT,
        entity_id INTEGER,
        original_name TEXT,
        stored_path TEXT,
        mime_type TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS import_history (
        id SERIAL PRIMARY KEY,
        file_id TEXT,
        parsed_data JSONB,
        matched_po_id INTEGER,
        infra_account TEXT,
        status TEXT DEFAULT 'applied',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Миграции: добавление недостающих колонок
    const migrations = [
      { table: "open_po", column: "logistics_plan", type: "TEXT" },
      { table: "open_po", column: "supplier_amounts", type: "TEXT" },
      { table: "infra_operations", column: "transfer_id", type: "INTEGER" },
      { table: "pending_transfers", column: "to_currency", type: "TEXT" },
      { table: "pending_transfers", column: "exchange_rate", type: "NUMERIC" },
      { table: "pending_transfers", column: "converted_amount", type: "NUMERIC" },
      { table: "open_po", column: "payment_file_id", type: "TEXT" },
      { table: "open_po", column: "customer_payment_file_id", type: "TEXT" },
      { table: "fin_results", column: "supplier_amounts", type: "TEXT" },
    ];
    for (const m of migrations) {
      try {
        await client.query(`ALTER TABLE ${m.table} ADD COLUMN IF NOT EXISTS ${m.column} ${m.type}`);
      } catch (e) {
        // колонка уже существует — OK
      }
    }

    console.log("[DB] Таблицы созданы/проверены");
  } finally {
    client.release();
  }
};

module.exports = { pool, initDB };
