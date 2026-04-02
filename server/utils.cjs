const snakeToCamel = (row) => {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
};

const camelToSnake = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())] = v;
  }
  return out;
};

const COLUMNS = {
  open_po: new Set([
    "type", "status", "num", "customer", "resp_sales", "internal_po", "date_ordered",
    "customer_deadline", "terms_delivery", "customer_amount", "payment_status_customer",
    "date_customer_paid", "internal_po_ref", "date_placed_supplier", "resp_procurement",
    "supplier_name", "supplier_amount", "payment_status_supplier", "paying_company",
    "date_paid_supplier", "delivery_cost", "awb", "tracking", "comments", "mgmt_comments",
    "has_upd", "upd_num", "upd_date", "upd_file_id", "no_global_smart", "order_stage", "cancel_reason",
    "logistics_plan", "supplier_amounts", "payment_file_id",
  ]),
  fin_results: new Set([
    "type", "status", "customer", "customer_po", "order_date", "customer_amount",
    "order_status", "payment_fact", "payment_date", "payment_doc_file_id", "supplier_po",
    "supplier_amount", "supplier", "final_buyer", "fin_agent", "payment_with_agent",
    "customs_cost", "delivery_cost", "margin", "net_profit", "vat_exempt", "comment",
    "has_upd", "upd_num", "upd_date", "upd_file_id", "no_global_smart",
  ]),
  debts: new Set([
    "company", "order", "amount", "due_date", "upd", "currency", "status",
    "pay_doc_file_id", "pay_date", "pay_comment",
  ]),
  balances: new Set(["name", "group", "balance", "currency", "is_safe"]),
  infra_operations: new Set([
    "account_name", "po_ref", "received", "outgoing", "bank_fees",
    "supplier", "invoice", "date", "balance", "description", "comment", "transfer_id",
  ]),
  pending_transfers: new Set([
    "from_acc", "to_acc", "amount", "currency", "to_currency",
    "exchange_rate", "converted_amount", "description", "date",
    "status", "completed_at", "file_name", "file_id",
  ]),
};

const filterCols = (data, table) => {
  const valid = COLUMNS[table];
  if (!valid) return data;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (valid.has(k)) out[k] = v;
  }
  return out;
};

const buildInsert = (table, body) => {
  const data = filterCols(camelToSnake(body), table);
  const keys = Object.keys(data);
  const vals = keys.map((k) => data[k]);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const quotedKeys = keys.map((k) => `"${k}"`);
  return {
    sql: `INSERT INTO ${table} (${quotedKeys.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    vals,
  };
};

const buildUpdate = (table, id, body) => {
  const data = filterCols(camelToSnake(body), table);
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  const sets = keys.map((k, i) => `"${k}" = $${i + 1}`);
  const vals = [...keys.map((k) => data[k]), parseInt(id)];
  return {
    sql: `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
    vals,
  };
};

module.exports = { snakeToCamel, camelToSnake, filterCols, buildInsert, buildUpdate, COLUMNS };
