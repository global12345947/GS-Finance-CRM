const API = "/api";

const json = (r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// ==================== Open PO ====================
export const fetchPO = () => fetch(`${API}/po`).then(json);
export const updatePO = (id, data) =>
  fetch(`${API}/po/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(json);
export const createPO = (data) =>
  fetch(`${API}/po`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(json);
export const deletePO = (id) =>
  fetch(`${API}/po/${id}`, { method: "DELETE" }).then(json);

// ==================== Фин. результат ====================
export const fetchFin = () => fetch(`${API}/fin`).then(json);
export const updateFin = (id, data) =>
  fetch(`${API}/fin/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(json);
export const createFin = (data) =>
  fetch(`${API}/fin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(json);
export const deleteFin = (id) =>
  fetch(`${API}/fin/${id}`, { method: "DELETE" }).then(json);

// ==================== Дебиторка ====================
export const fetchDebts = () => fetch(`${API}/debts`).then(json);
export const updateDebt = (id, data) =>
  fetch(`${API}/debts/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(json);
export const createDebt = (data) =>
  fetch(`${API}/debts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(json);

// ==================== Балансы ====================
export const fetchBalances = () => fetch(`${API}/balances`).then(json);
export const updateBalance = (id, balance) =>
  fetch(`${API}/balances/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ balance }) }).then(json);

// ==================== Инфра-операции ====================
export const fetchInfra = () => fetch(`${API}/infra`).then(json);
export const fetchInfraAccounts = () => fetch(`${API}/infra/accounts`).then(json);
export const createInfraOp = (data) =>
  fetch(`${API}/infra`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(json);
export const updateInfraComment = (id, comment) =>
  fetch(`${API}/infra/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment }) }).then(json);
export const deleteInfraOp = (id) =>
  fetch(`${API}/infra/${id}`, { method: "DELETE" }).then(json);
export const deleteInfraByTransfer = (transferId, desc) =>
  fetch(`${API}/infra/by-transfer/${transferId}?desc=${encodeURIComponent(desc || "")}`, { method: "DELETE" }).then(json);

// ==================== Переводы ====================
export const fetchTransfers = () => fetch(`${API}/transfers`).then(json);
export const createTransfer = (data) =>
  fetch(`${API}/transfers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(json);
export const updateTransfer = (id, data) =>
  fetch(`${API}/transfers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(json);
export const deleteTransfer = (id) =>
  fetch(`${API}/transfers/${id}`, { method: "DELETE" }).then(json);

// ==================== Курсы валют ====================
export const fetchExchangeRate = (from, to) =>
  fetch(`${API}/exchange-rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then(json);

// ==================== Файлы ====================
export const uploadFile = async (file, entityType, entityId) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("entityType", entityType);
  if (entityId) formData.append("entityId", String(entityId));
  const r = await fetch(`${API}/files/upload`, { method: "POST", body: formData });
  if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
  return r.json();
};

export const getFileUrl = (fileId) => `${API}/files/${fileId}`;
