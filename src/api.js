const API = "/api";

let _clientId = null;
export const setClientId = (id) => { _clientId = id; };
export const getClientId = () => _clientId;

const hdrs = (extra = {}) => {
  const h = { "Content-Type": "application/json", ...extra };
  if (_clientId) h["X-Client-Id"] = _clientId;
  return h;
};

const json = (r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// ==================== Open PO ====================
export const fetchPO = () => fetch(`${API}/po`).then(json);
export const updatePO = (id, data) =>
  fetch(`${API}/po/${id}`, { method: "PUT", headers: hdrs(), body: JSON.stringify(data) }).then(json);
export const createPO = (data) =>
  fetch(`${API}/po`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);
export const deletePO = (id) =>
  fetch(`${API}/po/${id}`, { method: "DELETE", headers: hdrs() }).then(json);

// ==================== Фин. результат ====================
export const fetchFin = () => fetch(`${API}/fin`).then(json);
export const updateFin = (id, data) =>
  fetch(`${API}/fin/${id}`, { method: "PUT", headers: hdrs(), body: JSON.stringify(data) }).then(json);
export const createFin = (data) =>
  fetch(`${API}/fin`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);
export const deleteFin = (id) =>
  fetch(`${API}/fin/${id}`, { method: "DELETE", headers: hdrs() }).then(json);

// ==================== Дебиторка ====================
export const fetchDebts = () => fetch(`${API}/debts`).then(json);
export const updateDebt = (id, data) =>
  fetch(`${API}/debts/${id}`, { method: "PUT", headers: hdrs(), body: JSON.stringify(data) }).then(json);
export const createDebt = (data) =>
  fetch(`${API}/debts`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);

// ==================== Балансы ====================
export const fetchBalances = () => fetch(`${API}/balances`).then(json);
export const updateBalance = (id, balance) =>
  fetch(`${API}/balances/${id}`, { method: "PUT", headers: hdrs(), body: JSON.stringify({ balance }) }).then(json);

// ==================== Инфра-операции ====================
export const fetchInfra = () => fetch(`${API}/infra`).then(json);
export const fetchInfraAccounts = () => fetch(`${API}/infra/accounts`).then(json);
export const createInfraOp = (data) =>
  fetch(`${API}/infra`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);
export const updateInfraComment = (id, comment) =>
  fetch(`${API}/infra/${id}`, { method: "PUT", headers: hdrs(), body: JSON.stringify({ comment }) }).then(json);
export const updateInfraOp = (id, data) =>
  fetch(`${API}/infra/${id}`, { method: "PUT", headers: hdrs(), body: JSON.stringify(data) }).then(json);
export const deleteInfraOp = (id) =>
  fetch(`${API}/infra/${id}`, { method: "DELETE", headers: hdrs() }).then(json);
export const deleteInfraByTransfer = (transferId, desc) =>
  fetch(`${API}/infra/by-transfer/${transferId}?desc=${encodeURIComponent(desc || "")}`, { method: "DELETE", headers: hdrs() }).then(json);

// ==================== Переводы ====================
export const fetchTransfers = () => fetch(`${API}/transfers`).then(json);
export const createTransfer = (data) =>
  fetch(`${API}/transfers`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);
export const updateTransfer = (id, data) =>
  fetch(`${API}/transfers/${id}`, { method: "PUT", headers: hdrs(), body: JSON.stringify(data) }).then(json);
export const deleteTransfer = (id) =>
  fetch(`${API}/transfers/${id}`, { method: "DELETE", headers: hdrs() }).then(json);

// ==================== Курсы валют ====================
export const fetchExchangeRate = (from, to) =>
  fetch(`${API}/exchange-rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then(json);

// ==================== Файлы ====================
export const uploadFile = async (file, entityType, entityId) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("entityType", entityType);
  if (entityId) formData.append("entityId", String(entityId));
  const headers = {};
  if (_clientId) headers["X-Client-Id"] = _clientId;
  const r = await fetch(`${API}/files/upload`, { method: "POST", body: formData, headers });
  if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
  return r.json();
};

export const getFileUrl = (fileId) => `${API}/files/${fileId}`;

// ==================== Импорт платежей ====================
export const parsePayment = async (file, documentKind = "foreign") => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("documentKind", documentKind);
  const headers = {};
  if (_clientId) headers["X-Client-Id"] = _clientId;
  const r = await fetch(`${API}/import/parse`, { method: "POST", body: formData, headers });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  return r.json();
};

export const matchPayment = (data) =>
  fetch(`${API}/import/match`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);

export const applyImport = (data) =>
  fetch(`${API}/import/apply`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);

export const undoImport = (data) =>
  fetch(`${API}/import/undo`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);

// ==================== Импорт РФ платежей ====================
export const parsePaymentRF = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  const r = await fetch(`${API}/import/parse-rf`, { method: "POST", body: formData });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  return r.json();
};

export const matchPaymentRF = (data) =>
  fetch(`${API}/import/match-rf`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);

export const applyImportRF = (data) =>
  fetch(`${API}/import/apply-rf`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);

export const undoImportRF = (data) =>
  fetch(`${API}/import/undo-rf`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);

export const matchPaymentRu = (data) =>
  fetch(`${API}/import/match-ru`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);

export const applyImportRu = (data) =>
  fetch(`${API}/import/apply-ru`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);

export const undoImportRu = (data) =>
  fetch(`${API}/import/undo-ru`, { method: "POST", headers: hdrs(), body: JSON.stringify(data) }).then(json);
