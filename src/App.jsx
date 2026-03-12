import React, { useState, useMemo, useCallback } from "react";
import { PO_DATA } from "./data/poData.js";
import { FIN_DATA } from "./data/finData.js";
import { DEBTS_DATA } from "./data/debtsData.js";
import { BALANCES_DATA } from "./data/balancesData.js";
import { INFRA_DATA } from "./data/infraData.js";

// ==================== УТИЛИТЫ ====================
const fmt = (n, currency = "") => {
  if (n === null || n === undefined || n === "" || (typeof n === "number" && isNaN(n))) return "—";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "—";
  const formatted = Math.abs(num).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (num < 0 ? "-" : "") + (currency ? currency + " " : "") + formatted;
};
// Компактный формат для дашборда (без копеек для больших чисел)
const fmtShort = (n, currency = "") => {
  if (n === null || n === undefined || n === "" || (typeof n === "number" && isNaN(n))) return "—";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "—";
  const abs = Math.abs(num);
  const formatted = abs >= 100000
    ? Math.round(abs).toLocaleString("ru-RU")
    : abs.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (num < 0 ? "-" : "") + (currency ? currency + " " : "") + formatted;
};

// ==================== КАНБАН СТАДИИ ЗАКАЗА ====================
const ORDER_STAGES = [
  { key: "in_work", label: "Заказ в работе", color: "bg-sky-400", text: "text-sky-900", light: "bg-sky-100", border: "border-sky-400" },
  { key: "placed", label: "Заказ размещен", color: "bg-orange-400", text: "text-orange-900", light: "bg-orange-100", border: "border-orange-400" },
  { key: "compliance", label: "Прохождение Комплаенса", color: "bg-yellow-400", text: "text-yellow-900", light: "bg-yellow-100", border: "border-yellow-400" },
  { key: "payment", label: "Заказ в Оплате", color: "bg-rose-400", text: "text-rose-900", light: "bg-rose-100", border: "border-rose-400" },
  { key: "logistics", label: "Заказ в Логистике", color: "bg-violet-400", text: "text-violet-900", light: "bg-violet-100", border: "border-violet-400" },
  { key: "done", label: "Заказ завершен", color: "bg-emerald-500", text: "text-emerald-900", light: "bg-emerald-100", border: "border-emerald-500" },
  { key: "cancelled", label: "Заказ отменен", color: "bg-red-500", text: "text-red-900", light: "bg-red-100", border: "border-red-500" },
];

const KanbanDropdown = ({ order, setData, pushLog, syncUpdToFinResults }) => {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [completeModal, setCompleteModal] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelReasonText, setCancelReasonText] = useState("");
  const [updForm, setUpdForm] = useState({ updNum: "", updDate: "", updFile: null, noGS: false });
  const ref = React.useRef(null);

  // Закрыть при клике вне
  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const currentStage = ORDER_STAGES.find((s) => s.key === order.orderStage) || null;
  const mainStages = ORDER_STAGES.filter((s) => s.key !== "cancelled");
  const currentIdx = currentStage && currentStage.key !== "cancelled" ? mainStages.indexOf(currentStage) : -1;

  const selectStage = (stage) => {
    if (stage.key === order.orderStage) { setOpen(false); return; }
    // Если «Заказ завершен» — показать модалку с УПД
    if (stage.key === "done" && !order.hasUpd) {
      setOpen(false);
      setUpdForm({ updNum: "", updDate: "", updFile: null, noGS: false });
      setCompleteModal(true);
      return;
    }
    // Если «Заказ отменен» — запросить причину отмены
    if (stage.key === "cancelled") {
      setOpen(false);
      setCancelReasonText("");
      setCancelModal(true);
      return;
    }
    pushLog({ type: "po_stage", id: order.id, prev: order.orderStage || "", prevStatus: order.status || "active" });
    const newStatus = stage.key === "done" ? "completed" : "active";
    setData((prev) => prev.map((r) => (r.id === order.id ? { ...r, orderStage: stage.key, status: newStatus } : r)));
    setOpen(false);
  };

  const confirmCancel = () => {
    if (!cancelReasonText.trim()) return;
    pushLog({ type: "po_stage", id: order.id, prev: order.orderStage || "", prevStatus: order.status || "active", prevComments: order.comments });
    const dateStr = new Date().toLocaleDateString("ru-RU");
    const cancelComment = `[${dateStr}] ОТМЕНА ЗАКАЗА: ${cancelReasonText.trim()}`;
    setData((prev) => prev.map((r) => (r.id === order.id ? {
      ...r, orderStage: "cancelled", status: "cancelled", cancelReason: cancelReasonText.trim(),
      comments: r.comments ? `${r.comments}\n${cancelComment}` : cancelComment,
    } : r)));
    setCancelModal(false);
    setCancelReasonText("");
  };

  const confirmComplete = () => {
    const hasUpd = !!(updForm.updNum && updForm.updDate);
    if (!hasUpd && !updForm.noGS) return; // нельзя завершить без УПД или галочки
    pushLog({ type: "po_stage", id: order.id, prev: order.orderStage || "", prevStatus: order.status || "active" });
    const updates = { orderStage: "done", status: "completed" };
    if (hasUpd) {
      updates.hasUpd = true;
      updates.updNum = updForm.updNum;
      updates.updDate = updForm.updDate;
      updates.updFile = updForm.updFile;
      updates.noGlobalSmart = false;
    }
    if (updForm.noGS) {
      updates.noGlobalSmart = true;
      updates.hasUpd = true; // помечаем как «завершён» для фильтров
      updates.updNum = "Без участия GS";
      updates.updDate = "";
      updates.updFile = null;
    }
    setData((prev) => prev.map((r) => (r.id === order.id ? { ...r, ...updates } : r)));
    if (syncUpdToFinResults) {
      syncUpdToFinResults(order.internalPo, true, updates.updNum, updates.updDate, updates.updFile, updates.noGlobalSmart);
    }
    setCompleteModal(false);
  };

  const canComplete = !!(updForm.updNum && updForm.updDate) || updForm.noGS;

  const handleToggle = (e) => {
    e.stopPropagation();
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const dropdownHeight = 350; // примерная высота дропдауна
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUp(spaceBelow < dropdownHeight);
    }
    setOpen(!open);
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={handleToggle}
        className={`px-2 py-1 rounded text-[10px] font-semibold cursor-pointer transition-all hover:ring-2 hover:ring-blue-300 whitespace-nowrap ${
          currentStage ? `${currentStage.light} ${currentStage.text} border ${currentStage.border}` : "bg-gray-100 text-gray-500 border border-gray-300"
        }`}>
        {currentStage ? currentStage.label : "Выбрать стадию"}
      </button>

      {open && (
        <div className={`absolute z-50 ${openUp ? "bottom-full mb-1" : "top-full mt-1"} left-0 bg-white rounded-xl shadow-2xl border border-gray-200 p-2 min-w-[420px]`}
          onClick={(e) => e.stopPropagation()}>
          <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-2 px-1">Стадия заказа</div>
          {/* Прогресс-бар (без "Отменен") */}
          <div className="flex gap-0.5 mb-3 px-1">
            {mainStages.map((s, i) => (
              <div key={s.key} className={`h-1.5 flex-1 rounded-full transition-all ${order.orderStage !== "cancelled" && i <= currentIdx ? s.color : "bg-gray-200"}`} />
            ))}
          </div>
          {/* Основные стадии */}
          <div className="flex flex-col gap-1">
            {mainStages.map((s, i) => {
              const isActive = s.key === order.orderStage;
              const isPast = order.orderStage !== "cancelled" && i < currentIdx;
              return (
                <button key={s.key} onClick={() => selectStage(s)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left ${
                    isActive ? `${s.light} ${s.text} ring-2 ${s.border} ring-offset-1` 
                    : isPast ? "bg-gray-50 text-gray-400"
                    : "hover:bg-gray-50 text-gray-700"
                  }`}>
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${isActive ? s.color : isPast ? "bg-gray-300" : "border-2 border-gray-300"}`}>
                    {(isActive || isPast) && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>}
                  </div>
                  <span className="flex-1">{s.label}</span>
                  {isActive && <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">Текущая</span>}
                </button>
              );
            })}
            {/* Разделитель */}
            <div className="border-t border-gray-200 my-1"></div>
            {/* Отмена — отдельно */}
            {(() => {
              const s = ORDER_STAGES.find((x) => x.key === "cancelled");
              const isActive = order.orderStage === "cancelled";
              return (
                <button onClick={() => selectStage(s)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left ${
                    isActive ? `${s.light} ${s.text} ring-2 ${s.border} ring-offset-1` : "hover:bg-red-50 text-gray-700"
                  }`}>
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${isActive ? s.color : "border-2 border-red-300"}`}>
                    {isActive && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>}
                  </div>
                  <span className="flex-1">{s.label}</span>
                  {isActive && <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">Текущая</span>}
                </button>
              );
            })()}
          </div>
        </div>
      )}

      {/* Модалка завершения заказа — требуется УПД или галочка */}
      {completeModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => setCompleteModal(false)}>
          <div className="bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-6 w-[440px] max-w-[95vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">✅ Завершение заказа</h3>
            <p className="text-sm text-slate-400 mb-4">Для завершения заказа загрузите УПД или отметьте, что заказ без участия Global Smart</p>

            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Номер УПД</label>
                  <input type="text" value={updForm.updNum} onChange={(e) => setUpdForm({ ...updForm, updNum: e.target.value })}
                    disabled={updForm.noGS}
                    className={`w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 ${updForm.noGS ? "opacity-40" : ""}`}
                    placeholder="Напр.: 123" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Дата УПД</label>
                  <input type="date" value={updForm.updDate} onChange={(e) => setUpdForm({ ...updForm, updDate: e.target.value })}
                    disabled={updForm.noGS}
                    className={`w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 ${updForm.noGS ? "opacity-40" : ""}`} />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Скан УПД (PDF/JPG/PNG)</label>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png"
                  disabled={updForm.noGS}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => setUpdForm((f) => ({ ...f, updFile: ev.target.result }));
                    reader.readAsDataURL(file);
                  }}
                  className={`w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-blue-500 file:text-white file:cursor-pointer hover:file:bg-blue-600 ${updForm.noGS ? "opacity-40" : ""}`} />
              </div>
            </div>

            <div className="border-t border-slate-700 pt-3 mb-4">
              <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-slate-700/40 transition-colors">
                <input type="checkbox" checked={updForm.noGS} onChange={(e) => setUpdForm({ ...updForm, noGS: e.target.checked, ...(e.target.checked ? { updNum: "", updDate: "", updFile: null } : {}) })}
                  className="w-4 h-4 rounded border-slate-500 text-amber-500 focus:ring-amber-500/30" />
                <div>
                  <span className="text-sm text-amber-400 font-medium">Заказ без участия Global Smart</span>
                  <p className="text-[10px] text-slate-500 mt-0.5">УПД не требуется для данного заказа</p>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setCompleteModal(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Отмена</button>
              <button onClick={confirmComplete} disabled={!canComplete}
                className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">
                Завершить заказ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка причины отмены заказа */}
      {cancelModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => setCancelModal(false)}>
          <div className="bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-6 w-[440px] max-w-[95vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">⛔ Отмена заказа</h3>
            <p className="text-sm text-slate-400 mb-4">Укажите причину отмены заказа <span className="font-mono text-white">{order.internalPo}</span>. Причина будет автоматически записана в комментарии.</p>
            <div className="mb-4">
              <label className="text-xs text-slate-400 mb-1 block">Причина отмены *</label>
              <textarea value={cancelReasonText} onChange={(e) => setCancelReasonText(e.target.value)}
                rows={3} placeholder="Опишите причину отмены заказа..."
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500 resize-none" />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setCancelModal(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Назад</button>
              <button onClick={confirmCancel} disabled={!cancelReasonText.trim()}
                className="px-6 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">
                Отменить заказ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== ПАРСЕР EXTERNAL PO из строк с \n ====================
// Формат: если PO начинается с "~" — он отменён (зачёркнут)
const parseExternalPOs = (order) => {
  const refs = (order.internalPoRef || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const suppliers = (order.supplierName || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const payments = (order.paymentStatusSupplier || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const payCompanies = (order.payingCompany || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const amounts = (order.supplierAmounts || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const datesPlaced = (order.datePlacedSupplier || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const procurements = (order.respProcurement || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const count = Math.max(refs.length, 1);
  const result = [];
  for (let i = 0; i < count; i++) {
    const rawPo = refs[i] || "";
    const cancelled = rawPo.startsWith("~");
    result.push({
      po: cancelled ? rawPo.substring(1) : rawPo,
      supplier: suppliers[i] || (suppliers.length === 1 ? suppliers[0] : ""),
      payment: payments[i] || (payments.length === 1 ? payments[0] : ""),
      payingCompany: payCompanies[i] || (payCompanies.length === 1 ? payCompanies[0] : ""),
      supplierAmount: amounts[i] || "",
      datePlaced: datesPlaced[i] || (datesPlaced.length === 1 ? datesPlaced[0] : ""),
      respProcurement: procurements[i] || (procurements.length === 1 ? procurements[0] : ""),
      cancelled,
      cancelReason: "",
    });
  }
  return result;
};

// ==================== ПАРСЕР ДОСТАВКИ: план / факт ====================
const parseDeliveryCost = (raw) => {
  if (!raw) return { plan: "", actual: "" };
  const str = String(raw);
  const lines = str.split("\n").map((l) => l.trim()).filter(Boolean);
  let plan = "";
  let actual = "";
  for (const line of lines) {
    if (/^plan\s/i.test(line)) {
      plan = line;
    } else {
      actual = actual ? actual + "\n" + line : line;
    }
  }
  // Если нет явного "plan" и нет факта — считаем всё фактом
  if (!plan && actual) {
    // Если строка одна и содержит только стоимость — это факт
    return { plan: "", actual };
  }
  return { plan, actual };
};

// ==================== АВТО-ДЕБИТОРКА (из Фин. результат) ====================
// Заказы с УПД, но без оплаты — автоматически попадают в дебиторку
// getAutoDebts удалена — дебиторка теперь ТОЛЬКО из ручных данных (debtsData.js)

// ==================== UI КОМПОНЕНТЫ ====================
const StatusBadge = ({ status }) => {
  const colors = {
    completed: "bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold",
    active: "bg-amber-100 text-amber-800 border border-amber-300",
    cancelled: "bg-red-100 text-red-800 border border-red-300 font-semibold",
    overdue: "bg-rose-100 text-rose-800 border border-rose-300 font-semibold",
    open: "bg-red-100 text-red-700 border border-red-300",
    closed: "bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold",
  };
  const labels = {
    completed: "Выполнен",
    active: "В работе",
    cancelled: "Отменён",
    overdue: "Просрочен",
    open: "Открыт",
    closed: "Закрыт",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || colors.active}`}>
      {labels[status] || status}
    </span>
  );
};

const UPDBadge = ({ has_upd }) =>
  has_upd ? (
    <span className="px-2 py-0.5 rounded text-xs font-medium bg-violet-500/20 text-violet-300 border border-violet-500/30">
      УПД
    </span>
  ) : null;

const TypeBadge = ({ type }) => (
  <span
    className={`px-2 py-0.5 rounded text-xs font-bold ${
      type === "export"
        ? "bg-cyan-100 text-cyan-800 border border-cyan-300"
        : "bg-orange-100 text-orange-800 border border-orange-300"
    }`}
  >
    {type === "export" ? "EXP" : "ROT"}
  </span>
);

const Card = ({ children, className = "", onClick }) => (
  <div
    className={`bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 rounded-xl ${className} ${onClick ? "cursor-pointer" : ""}`}
    onClick={onClick}
  >
    {children}
  </div>
);

const StatCard = ({ title, value, subtitle, icon, color = "blue" }) => {
  const gradients = {
    blue: "from-blue-500/20 to-cyan-500/10",
    green: "from-emerald-500/20 to-green-500/10",
    amber: "from-amber-500/20 to-yellow-500/10",
    red: "from-rose-500/20 to-red-500/10",
    violet: "from-violet-500/20 to-purple-500/10",
  };
  const iconColors = {
    blue: "text-blue-400",
    green: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-rose-400",
    violet: "text-violet-400",
  };
  return (
    <Card className={`p-5 bg-gradient-to-br ${gradients[color]}`}>
      <div className="flex items-start justify-between mb-3">
        <span className="text-slate-400 text-sm font-medium">{title}</span>
        <span className={`text-2xl ${iconColors[color]}`}>{icon}</span>
      </div>
      <div className="text-3xl font-bold text-white mb-1 tracking-tight">{value}</div>
      {subtitle && <div className="text-sm text-slate-400">{subtitle}</div>}
    </Card>
  );
};

// ==================== МОДАЛЬНОЕ ОКНО ====================
const Modal = ({ isOpen, onClose, title, children, wide }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className={`relative bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl ${
          wide ? "max-w-5xl" : "max-w-2xl"
        } w-full max-h-[85vh] overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">
            &times;
          </button>
        </div>
        <div className="p-5 overflow-y-auto max-h-[calc(85vh-72px)]">{children}</div>
      </div>
    </div>
  );
};

const InputField = ({ label, value, onChange, type = "text", placeholder = "", disabled = false }) => (
  <div>
    <label className={`text-xs text-slate-400 mb-1 block ${disabled ? "opacity-40" : ""}`}>{label}</label>
    <input
      type={type}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    />
  </div>
);

// ==================== ТАБЫ ====================
const TabBar = ({ tabs, active, onChange }) => (
  <div className="flex gap-1 bg-slate-800/40 p-1 rounded-xl border border-slate-700/50 overflow-x-auto">
    {tabs.map((t) => (
      <button
        key={t.key}
        onClick={() => onChange(t.key)}
        className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
          active === t.key
            ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
            : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/40"
        }`}
      >
        {t.icon && <span className="mr-1.5">{t.icon}</span>}
        {t.label}
      </button>
    ))}
  </div>
);

// ==================== БАЛАНС ====================
const Dashboard = ({ balances, debts, finResults }) => {
  const [expandedGroup, setExpandedGroup] = useState(null);

  // Группируем балансы по инфраструктуре
  const rows = useMemo(() => {
    const groupOrder = ["РФ", "Lotus", "Crypto", "AJ PARTS", "ALTURA", "AVS TRADING MASHREQ", "AVS TRADING ISLAMIC", "AJ GLOBAL GS"];
    const grouped = {};
    balances.forEach((b) => {
      const g = b.group || b.name;
      if (!grouped[g]) grouped[g] = { usd: null, aed: null, bat: null, safe: [], accounts: [] };
      grouped[g].accounts.push(b);
      if (b.isSafe) {
        grouped[g].safe.push(b);
      } else if (b.currency === "USD") {
        grouped[g].usd = b.balance;
      } else if (b.currency === "AED") {
        grouped[g].aed = b.balance;
      } else if (b.currency === "BAT") {
        grouped[g].bat = b.balance;
      }
    });
    return groupOrder.filter((g) => grouped[g]).map((g) => ({ name: g, ...grouped[g] }));
  }, [balances]);

  // Получить операции для группы
  const getOpsForGroup = (groupName) => {
    const row = rows.find((r) => r.name === groupName);
    if (!row) return [];
    const ops = [];
    row.accounts.forEach((acc) => {
      // Ищем по name в INFRA_DATA
      const accName = acc.name;
      // Пробуем несколько вариантов ключей
      const keys = [accName, accName.replace(" USD", "").replace(" GS", " GS"), accName.replace(" GS USD", " GS"), accName.replace(" GS ", " ")];
      for (const key of keys) {
        if (INFRA_DATA[key]) {
          INFRA_DATA[key].forEach((op) => ops.push({ ...op, _account: accName, _currency: acc.currency }));
          break;
        }
      }
    });
    ops.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    return ops;
  };

  // Итоги
  const totals = useMemo(() => {
    const usd = balances.filter((b) => b.currency === "USD" && !b.isSafe).reduce((s, b) => s + b.balance, 0);
    const aed = balances.filter((b) => b.currency === "AED" && !b.isSafe).reduce((s, b) => s + b.balance, 0);
    const bat = balances.filter((b) => b.currency === "BAT" && !b.isSafe).reduce((s, b) => s + b.balance, 0);
    return { usd, aed, bat };
  }, [balances]);

  // Просроченные дебиторки
  const overdueTotal = useMemo(() => {
    const overdueDebts = debts.filter(
      (d) => d.status === "open" && d.amount > 0 && d.dueDate && new Date(d.dueDate) < new Date()
    );
    return overdueDebts.reduce((s, d) => s + d.amount, 0);
  }, [debts]);

  // Общая дебиторка
  const totalDebtDash = useMemo(() => {
    return debts.filter((d) => d.status === "open" && d.amount > 0).reduce((s, d) => s + d.amount, 0);
  }, [debts]);

  const fmtCell = (val, prefix = "") => {
    if (val === null || val === undefined) return <span className="text-gray-300">—</span>;
    const num = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(num)) return <span className="text-gray-300">—</span>;
    const formatted = Math.abs(num).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const isNeg = num < 0;
    return (
      <span className={isNeg ? "text-red-600 font-semibold" : "text-gray-900 font-semibold"}>
        {isNeg ? "-" : ""}{prefix}{formatted}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Итого + Просроченные — верхняя панель */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#1E3A5F] rounded-xl shadow-sm p-5">
          <div className="text-xs text-blue-200 uppercase tracking-wider mb-2">Итого USD</div>
          <div className="text-2xl font-bold text-green-300 tabular-nums">
            ${totals.usd.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-[#1E3A5F] rounded-xl shadow-sm p-5">
          <div className="text-xs text-blue-200 uppercase tracking-wider mb-2">Итого AED</div>
          <div className="text-2xl font-bold text-blue-300 tabular-nums">
            dh {totals.aed.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-[#1E3A5F] rounded-xl shadow-sm p-5">
          <div className="text-xs text-blue-200 uppercase tracking-wider mb-2">Итого BAT</div>
          <div className="text-2xl font-bold text-amber-300 tabular-nums">
            ฿{totals.bat.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-[#1E3A5F] rounded-xl shadow-sm p-5">
          <div className="text-xs text-red-300 uppercase tracking-wider mb-2">⚠ Просроченные дебиторки</div>
          <div className="text-2xl font-bold text-red-400 tabular-nums">
            ${overdueTotal.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Карточки инфраструктур */}
      <div>
        <h2 className="text-base font-bold text-[#1E3A5F] mb-1">Остатки по инфраструктурам</h2>
        <p className="text-xs text-[#1E3A5F]/60 mb-4">Нажмите на карточку, чтобы раскрыть операции</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {rows.map((row) => {
          const isExpanded = expandedGroup === row.name;
          const ops = isExpanded ? getOpsForGroup(row.name) : [];
          const hasOps = row.accounts.some((acc) => {
            const keys = [acc.name, acc.name.replace(" USD", "").replace(" GS", " GS"), acc.name.replace(" GS USD", " GS")];
            return keys.some((k) => INFRA_DATA[k] && INFRA_DATA[k].length > 0);
          });

          return (
            <div key={row.name} className={`${isExpanded ? "md:col-span-2 xl:col-span-3" : ""}`}>
              <div
                className={`bg-[#1E3A5F] rounded-xl shadow-lg border-2 p-5 transition-all cursor-pointer hover:shadow-xl ${
                  isExpanded ? "border-blue-400 ring-2 ring-blue-400/30" : "border-[#2A4A6F] hover:border-blue-400/60"
                }`}
                onClick={() => hasOps && setExpandedGroup(isExpanded ? null : row.name)}
              >
                {/* Заголовок карточки */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-white">{row.name}</h3>
                  {hasOps && (
                    <span className={`text-blue-300 text-sm transition-transform ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                  )}
                </div>

                {/* Балансы по валютам */}
                <div className="flex flex-wrap gap-4">
                  {row.usd !== null && (
                    <div className="flex-1 min-w-[120px] bg-[#2A4A6F] rounded-lg p-3 border border-[#3A5A7F]">
                      <div className="text-xs text-green-300 font-medium mb-1">$ USD</div>
                      <div className={`text-xl font-bold tabular-nums ${row.usd < 0 ? "text-red-400" : "text-green-300"}`}>
                        {row.usd < 0 ? "-" : ""}${Math.abs(row.usd).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  )}
                  {row.aed !== null && (
                    <div className="flex-1 min-w-[120px] bg-[#2A4A6F] rounded-lg p-3 border border-[#3A5A7F]">
                      <div className="text-xs text-blue-300 font-medium mb-1">AED</div>
                      <div className={`text-xl font-bold tabular-nums ${row.aed < 0 ? "text-red-400" : "text-blue-300"}`}>
                        {row.aed < 0 ? "-" : ""}dh {Math.abs(row.aed).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  )}
                  {row.bat !== null && (
                    <div className="flex-1 min-w-[120px] bg-[#2A4A6F] rounded-lg p-3 border border-[#3A5A7F]">
                      <div className="text-xs text-amber-300 font-medium mb-1">฿ BAT</div>
                      <div className={`text-xl font-bold tabular-nums ${row.bat < 0 ? "text-red-400" : "text-amber-300"}`}>
                        {row.bat < 0 ? "-" : ""}฿{Math.abs(row.bat).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  )}
                  {row.safe.length > 0 && (
                    <div className="flex-1 min-w-[120px] bg-[#2A4A6F] rounded-lg p-3 border border-[#3A5A7F]">
                      <div className="text-xs text-violet-300 font-medium mb-1">Сейф</div>
                      {row.safe.map((s) => (
                        <div key={s.id} className="text-xl font-bold tabular-nums text-violet-300">
                          {s.currency === "USD"
                            ? `$${Math.abs(s.balance).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : `р.${Math.abs(s.balance).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          }
                        </div>
                      ))}
                    </div>
                  )}
                  {row.usd === null && row.aed === null && row.bat === null && row.safe.length === 0 && (
                    <div className="text-gray-400 text-sm">Нет данных</div>
                  )}
                </div>
              </div>

              {/* Раскрытая таблица операций */}
              {isExpanded && ops.length > 0 && (
                <div className="mt-2 bg-white rounded-xl shadow-sm border border-blue-200 overflow-hidden">
                  <div className="px-5 py-3 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
                    <span className="text-sm font-semibold text-blue-800">Операции: {row.name}</span>
                    <span className="text-xs text-gray-500 bg-blue-100 px-2 py-0.5 rounded-full">{ops.length} записей</span>
                  </div>
                  <div className="overflow-x-auto max-h-[450px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-blue-50">
                        <tr className="text-gray-600 text-xs uppercase">
                          <th className="py-2.5 px-4 text-left font-semibold">Дата</th>
                          <th className="py-2.5 px-4 text-left font-semibold">Счёт</th>
                          <th className="py-2.5 px-4 text-left font-semibold">PO / Описание</th>
                          <th className="py-2.5 px-4 text-right font-semibold text-green-700">Приход</th>
                          <th className="py-2.5 px-4 text-right font-semibold text-red-700">Расход</th>
                          <th className="py-2.5 px-4 text-right font-semibold">Комиссии</th>
                          <th className="py-2.5 px-4 text-left font-semibold">Поставщик / Инвойс</th>
                          <th className="py-2.5 px-4 text-right font-semibold">Остаток</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ops.map((op, idx) => (
                          <tr key={`${op._account}-${op.id}`} className={`border-b border-gray-100 hover:bg-blue-50/40 ${idx % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                            <td className="py-2 px-4 text-gray-700 whitespace-nowrap">{op.date || "—"}</td>
                            <td className="py-2 px-4 text-gray-500 whitespace-nowrap">{op._currency}</td>
                            <td className="py-2 px-4 text-gray-900 font-mono text-xs">
                              {op.poRef || (op.description ? <span className="text-blue-600 italic font-sans">{op.description}</span> : "—")}
                            </td>
                            <td className="py-2 px-4 text-right text-green-700 font-semibold tabular-nums">
                              {op.received ? "+" + fmt(op.received) : ""}
                            </td>
                            <td className="py-2 px-4 text-right text-red-600 font-semibold tabular-nums">
                              {op.outgoing ? "-" + fmt(op.outgoing) : ""}
                            </td>
                            <td className="py-2 px-4 text-right text-amber-600 tabular-nums">
                              {op.bankFees ? fmt(op.bankFees) : ""}
                            </td>
                            <td className="py-2 px-4 text-gray-600 max-w-[220px] truncate" title={`${op.supplier || ""} ${op.invoice || ""}`}>
                              {op.supplier || op.invoice || "—"}
                            </td>
                            <td className={`py-2 px-4 text-right font-bold tabular-nums ${op.balance < 0 ? "text-red-600" : "text-gray-900"}`}>
                              {op.balance !== undefined && op.balance !== 0 ? fmt(op.balance) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ==================== КАНБАН СТАТУС ФИН. РЕЗУЛЬТАТ ====================
const FIN_STAGES = [
  { key: "active", label: "В работе", color: "bg-blue-500", text: "text-blue-800", light: "bg-blue-100", border: "border-blue-400" },
  { key: "completed", label: "Выполнен", color: "bg-emerald-500", text: "text-emerald-800", light: "bg-emerald-100", border: "border-emerald-500" },
];

const FinStatusDropdown = ({ order, onChangeStatus }) => {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  const current = FIN_STAGES.find((s) => s.key === order.status) || FIN_STAGES[0];

  React.useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`px-2 py-1 rounded text-[10px] font-semibold cursor-pointer transition-all hover:ring-2 hover:ring-blue-300 whitespace-nowrap ${current.light} ${current.text} border ${current.border}`}>
        {current.label}
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 bg-white rounded-xl shadow-2xl border border-gray-200 p-2 min-w-[200px]"
          onClick={(e) => e.stopPropagation()}>
          <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-2 px-1">Статус заказа</div>
          <div className="flex flex-col gap-1">
            {FIN_STAGES.map((s) => {
              const isActive = s.key === order.status;
              return (
                <button key={s.key} onClick={() => { onChangeStatus(order, s.key); setOpen(false); }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left ${
                    isActive ? `${s.light} ${s.text} ring-2 ${s.border} ring-offset-1` : "hover:bg-gray-50 text-gray-700"
                  }`}>
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${isActive ? s.color : "border-2 border-gray-300"}`}>
                    {isActive && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>}
                  </div>
                  <span className="flex-1">{s.label}</span>
                  {isActive && <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">Текущий</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== ФИН. РЕЗУЛЬТАТ ====================
const FinResults = ({ data, setData, pushLog, debts, setDebts }) => {
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(-1); // -1 = auto-last-page
  const [detailModal, setDetailModal] = useState(null);
  const [payModal, setPayModal] = useState(null);
  const [payForm, setPayForm] = useState({ amount: "", date: "", file: null });
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [completeModal, setCompleteModal] = useState(null); // модалка подтверждения "Выполнен"
  const PP = 30;

  const filtered = useMemo(() => {
    let items = [...data];
    // Сортировка по дате: от старого к новому (самые новые на последней странице)
    items.sort((a, b) => (a.orderDate || "").localeCompare(b.orderDate || ""));
    if (filter === "active") items = items.filter((o) => o.status === "active");
    if (filter === "completed") items = items.filter((o) => o.status === "completed");
    if (filter === "cancelled") items = items.filter((o) => o.status === "cancelled");
    if (filter === "upd") items = items.filter((o) => o.hasUpd);
    if (filter === "no_upd") items = items.filter((o) => !o.hasUpd && o.status !== "cancelled");
    if (typeFilter === "domestic") items = items.filter((o) => o.type === "domestic");
    if (typeFilter === "export") items = items.filter((o) => o.type === "export");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (o) =>
          o.customer?.toLowerCase().includes(q) ||
          o.customerPo?.toLowerCase().includes(q) ||
          o.supplier?.toLowerCase().includes(q) ||
          o.supplierPo?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [data, filter, typeFilter, search]);

  const pages = Math.ceil(filtered.length / PP);
  // Авто-переход на последнюю страницу при первом рендере (-1 = auto)
  const effectivePage = page === -1 ? Math.max(0, pages - 1) : page;
  const slice = filtered.slice(effectivePage * PP, (effectivePage + 1) * PP);

  const doPayment = () => {
    if (!payModal || !payForm.file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const payDocData = e.target.result;
      pushLog({
        type: "fin_payment",
        id: payModal.id,
        prev: { paymentFact: payModal.paymentFact },
      });
      setData((prev) =>
        prev.map((r) =>
          r.id === payModal.id
            ? { ...r, paymentFact: parseFloat(payForm.amount) || 0, paymentDoc: payDocData, paymentDate: payForm.date }
            : r
        )
      );

      // Синхронизация: закрываем долг в дебиторке по совпадению PO
      if (setDebts && payModal.customerPo) {
        setDebts((prev) => prev.map((d) => {
          if (d.order === payModal.customerPo && d.status === "open") {
            return { ...d, status: "closed", payDoc: payDocData, payDate: payForm.date, payComment: `Оплачено через Фин. результат: ₽${payForm.amount}` };
          }
          return d;
        }));
      }

      setPayModal(null);
      setPayForm({ amount: "", date: "", file: null });
    };
    reader.readAsDataURL(payForm.file);
  };

  // Kanban-статус: переход на «Выполнен» требует проверки
  const handleFinStage = (r, newStatus) => {
    if (newStatus === "completed") {
      const hasUpdOrGS = r.hasUpd || r.noGlobalSmart;
      const hasPay = parseFloat(r.paymentFact) > 0;
      // Если заказ «без участия GS» — можно закрывать сразу
      if (r.noGlobalSmart) {
    pushLog({ type: "fin_status", id: r.id, prev: r.status });
        setData((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: "completed" } : x)));
        return;
      }
      // Иначе — показываем модалку с проверкой условий
      if (!hasUpdOrGS || !hasPay) {
        setCompleteModal(r);
        return;
      }
    }
    pushLog({ type: "fin_status", id: r.id, prev: r.status });
    setData((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: newStatus } : x)));
  };

  // confirmFinComplete больше не нужен — кнопка подтверждения заблокирована
  // Оставляем для случая, когда оба условия выполнены (например через edit)
  const confirmFinComplete = () => {
    if (!completeModal) return;
    pushLog({ type: "fin_status", id: completeModal.id, prev: completeModal.status });
    setData((prev) => prev.map((x) => (x.id === completeModal.id ? { ...x, status: "completed" } : x)));
    setCompleteModal(null);
  };

  const deleteOrder = (r) => {
    if (!window.confirm(`Удалить заказ ${r.customerPo || r.id}? Действие можно отменить.`)) return;
    pushLog({ type: "fin_delete", id: r.id, prev: { ...r } });
    setData((prev) => prev.filter((o) => o.id !== r.id));
  };

  const openEdit = (r) => {
    setEditForm({
      customer: r.customer || "",
      customerPo: r.customerPo || "",
      orderDate: r.orderDate || "",
      customerAmount: r.customerAmount || 0,
      orderStatus: r.orderStatus || "",
      paymentFact: r.paymentFact || 0,
      supplierPo: r.supplierPo || "",
      supplierAmount: r.supplierAmount || 0,
      supplier: r.supplier || "",
      finalBuyer: r.finalBuyer || "",
      finAgent: r.finAgent || "",
      customsCost: r.customsCost || 0,
      deliveryCost: r.deliveryCost || 0,
      comment: r.comment || "",
      type: r.type || "domestic",
      status: r.status || "active",
      // УПД поля (только чтение — приходят из Open PO)
      hasUpd: r.hasUpd || false,
      noGlobalSmart: r.noGlobalSmart || false,
      updNum: r.updNum || "",
      updDate: r.updDate || "",
      // Оплата поля
      paymentDoc: r.paymentDoc || null,
      paymentDate: r.paymentDate || "",
      _newPayDoc: null, // новый файл платёжки
    });
    setEditModal(r);
  };

  const saveEdit = () => {
    if (!editModal) return;
    pushLog({ type: "fin_edit", id: editModal.id, prev: { ...editModal } });

    // Функция применения обновления
    const applyUpdate = (newPayDoc) => {
      const newPaymentFact = parseFloat(editForm.paymentFact) || 0;
      const oldPaymentFact = parseFloat(editModal.paymentFact) || 0;
      const finalPayDoc = newPayDoc || editForm.paymentDoc;

    setData((prev) =>
        prev.map((x) =>
          x.id === editModal.id
            ? {
                ...x,
                customer: editForm.customer,
                customerPo: editForm.customerPo,
                orderDate: editForm.orderDate,
                customerAmount: parseFloat(editForm.customerAmount) || 0,
                paymentFact: newPaymentFact,
                supplierPo: editForm.supplierPo,
                supplierAmount: parseFloat(editForm.supplierAmount) || 0,
                supplier: editForm.supplier,
                finalBuyer: editForm.finalBuyer,
                finAgent: editForm.finAgent,
                customsCost: parseFloat(editForm.customsCost) || 0,
                deliveryCost: parseFloat(editForm.deliveryCost) || 0,
                comment: editForm.comment,
                type: editForm.type,
                // Оплата
                paymentDoc: finalPayDoc,
                paymentDate: editForm.paymentDate,
              }
            : x
        )
      );

      // Синхронизация с дебиторкой: если оплата появилась — закрываем долг
      if (setDebts && newPaymentFact > 0 && oldPaymentFact === 0 && editModal.customerPo) {
        setDebts((prev) => prev.map((d) => {
          if (d.order === editModal.customerPo && d.status === "open") {
            return { ...d, status: "closed", payDoc: finalPayDoc, payDate: editForm.paymentDate, payComment: `Оплачено через Фин. результат: ${newPaymentFact}` };
          }
          return d;
        }));
      }

      setEditModal(null);
    };

    // Читаем новый файл платёжки, если загружен
    if (editForm._newPayDoc) {
      const reader = new FileReader();
      reader.onload = (e) => applyUpdate(e.target.result);
      reader.readAsDataURL(editForm._newPayDoc);
    } else {
      applyUpdate(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-[#1E3A5F] p-1 rounded-lg">
          {[
            { k: "all", l: "Все" },
            { k: "active", l: "В работе" },
            { k: "completed", l: "Выполнены" },
            { k: "upd", l: "С УПД" },
            { k: "no_upd", l: "Без УПД" },
          ].map((f) => (
            <button
              key={f.k}
              onClick={() => { setFilter(f.k); setPage(-1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                filter === f.k ? "bg-white text-[#1E3A5F]" : "text-white/80 hover:text-white hover:bg-[#2A4A6F]"
              }`}
            >
              {f.l}
            </button>
          ))}
    </div>
        <div className="flex gap-1 bg-[#1E3A5F] p-1 rounded-lg">
          {[
            { k: "all", l: "Все типы" },
            { k: "domestic", l: "ROT" },
            { k: "export", l: "EXP" },
          ].map((f) => (
            <button
              key={f.k}
              onClick={() => { setTypeFilter(f.k); setPage(-1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                typeFilter === f.k ? "bg-white text-[#1E3A5F]" : "text-white/80 hover:text-white hover:bg-[#2A4A6F]"
              }`}
            >
              {f.l}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Поиск по клиенту, PO, поставщику..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(-1); }}
          className="flex-1 min-w-48 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30"
        />
        <span className="text-xs text-gray-500 font-medium">{filtered.length} записей</span>
      </div>

      {/* Таблица — структура как в Excel */}
      <div className="rounded-xl shadow-lg overflow-hidden border border-[#1E3A5F]/30">
        <div className="overflow-x-auto">
      <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1E3A5F] text-white text-left text-xs uppercase">
                <th className="py-3 px-2 font-semibold">Тип</th>
                <th className="py-3 px-2 font-semibold">Клиент</th>
                <th className="py-3 px-2 font-semibold">Internal PO</th>
                <th className="py-3 px-2 font-semibold">Дата</th>
                <th className="py-3 px-2 text-right font-semibold">Сумма USD</th>
                <th className="py-3 px-2 font-semibold">УПД</th>
                <th className="py-3 px-2 text-right font-semibold">Оплата факт ₽</th>
                <th className="py-3 px-2 font-semibold">External PO</th>
                <th className="py-3 px-2 text-right font-semibold">Сумма пост. $</th>
                <th className="py-3 px-2 font-semibold">Поставщик</th>
                <th className="py-3 px-2 font-semibold">Структура</th>
                <th className="py-3 px-2 font-semibold">Статус</th>
                <th className="py-3 px-2 font-semibold">Действия</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {slice.map((r, idx) => (
                <tr
                  key={r.id}
                  className={`border-b border-gray-200 hover:bg-blue-50 cursor-pointer transition-colors ${
                    r.status === "cancelled" ? "bg-red-200" : r.status === "completed" ? "bg-green-200" : idx % 2 === 1 ? "bg-gray-50" : ""
                  }`}
                  onClick={() => setDetailModal(r)}
                >
                  <td className="py-2.5 px-2"><TypeBadge type={r.type} /></td>
                  <td className="py-2.5 px-2 text-gray-900 font-semibold text-xs max-w-[140px] truncate">{r.customer}</td>
                  <td className="py-2.5 px-2 text-[#1E3A5F] font-mono text-xs max-w-[110px] truncate">{r.customerPo}</td>
                  <td className="py-2.5 px-2 text-gray-600 text-xs whitespace-nowrap">{r.orderDate}</td>
                  <td className="py-2.5 px-2 text-right text-green-700 font-mono text-xs font-semibold">${fmt(r.customerAmount)}</td>
                  <td className="py-2.5 px-2">
                    {r.noGlobalSmart ? (
                      <div className="text-blue-600 cursor-help text-xs leading-tight font-medium" title="Заказ без участия Global Smart">
                        🔹 Без участия GS
                      </div>
                    ) : r.hasUpd ? (
                      <div title={r.orderStatus} className="text-emerald-600 cursor-help text-xs leading-tight">
                        <div>✅ УПД №{r.updNum || "—"}</div>
                        <div className="text-emerald-500 text-[10px] mt-0.5">от {r.updDate || "—"}</div>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-right">
                    {r.paymentFact > 0 ? (
                      <span className="text-emerald-700 font-mono text-xs font-semibold" title={`₽${r.paymentFact.toLocaleString("ru-RU")}`}>
                        ₽{fmt(r.paymentFact)}
                      </span>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setPayModal(r); }}
                        className="text-amber-600 hover:text-amber-700 text-xs font-medium"
                        title="Внести оплату (только с платёжкой из банка)"
                      >
                        💳 Внести
                      </button>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-gray-700 font-mono text-xs max-w-[100px] truncate">{r.supplierPo}</td>
                  <td className="py-2.5 px-2 text-right text-gray-700 font-mono text-xs">{r.supplierAmount ? "$" + fmt(r.supplierAmount) : "—"}</td>
                  <td className="py-2.5 px-2 text-gray-700 text-xs max-w-[120px] truncate">{r.supplier}</td>
                  <td className="py-2.5 px-2 text-gray-600 text-xs max-w-[80px] truncate">{r.finalBuyer || "—"}</td>
                  <td className="py-2.5 px-2" onClick={(e) => e.stopPropagation()}>
                    <FinStatusDropdown order={r} onChangeStatus={handleFinStage} />
                  </td>
                  <td className="py-2.5 px-2">
                    <div className="flex items-center gap-1">
                    <button
                        onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                        className="text-blue-600 hover:text-blue-800 text-xs transition-colors"
                        title="Редактировать заказ"
                      >
                        ✏️
                    </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteOrder(r); }}
                        className="text-red-400 hover:text-red-600 text-xs transition-colors"
                        title="Удалить заказ"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
      </table>
    </div>
        <div className="p-3 text-xs text-gray-500 border-t border-gray-200 bg-gray-50">
          Стр. {effectivePage + 1} из {pages} · Показано {slice.length} из {filtered.length} записей (сортировка: от старых к новым)
        </div>
      </div>

      {/* Пагинация */}
      {pages > 1 && (
        <div className="flex justify-center gap-1 flex-wrap">
          {effectivePage > 0 && (
            <button onClick={() => setPage(effectivePage - 1)} className="w-8 h-8 rounded-lg bg-[#1E3A5F] hover:bg-[#2A4A6F] text-white text-sm border border-[#2A4A6F]">&laquo;</button>
          )}
          {Array.from({ length: Math.min(pages, 10) }, (_, i) => {
            const p = pages <= 10 ? i : effectivePage < 5 ? i : effectivePage > pages - 6 ? pages - 10 + i : effectivePage - 5 + i;
            return (
              <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 rounded-lg text-sm border ${effectivePage === p ? "bg-[#2A4A6F] text-white border-blue-400/50" : "bg-[#1E3A5F] hover:bg-[#2A4A6F] text-blue-200 border-[#2A4A6F]"}`}>
                {p + 1}
              </button>
            );
          })}
          {effectivePage < pages - 1 && (
            <button onClick={() => setPage(effectivePage + 1)} className="w-8 h-8 rounded-lg bg-[#1E3A5F] hover:bg-[#2A4A6F] text-white text-sm border border-[#2A4A6F]">&raquo;</button>
          )}
        </div>
      )}

      {/* Модал подтверждения «Выполнен» */}
      <Modal isOpen={!!completeModal} onClose={() => setCompleteModal(null)} title={`Подтверждение — ${completeModal?.customerPo || ""}`}>
        {completeModal && (() => {
          const hasUpdOrGS = completeModal.hasUpd || completeModal.noGlobalSmart;
          const hasPay = parseFloat(completeModal.paymentFact) > 0;
          return (
        <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-amber-300 text-sm">
                Для перевода заказа в статус «Выполнен» должны быть выполнены оба условия:
          </div>
              <div className="space-y-3">
                <div className={`flex items-center gap-3 p-3 rounded-lg border ${hasUpdOrGS ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${hasUpdOrGS ? "bg-emerald-500" : "bg-red-500/30"}`}>
                    {hasUpdOrGS ? <span className="text-white text-xs">✓</span> : <span className="text-red-400 text-xs">✕</span>}
                  </div>
          <div>
                    <div className={`text-sm font-medium ${hasUpdOrGS ? "text-emerald-300" : "text-red-300"}`}>
                      {completeModal.noGlobalSmart ? "Заказ без участия GS" : "УПД загружена"}
          </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {hasUpdOrGS
                        ? (completeModal.noGlobalSmart ? "🔹 Без участия GS" : `✅ УПД №${completeModal.updNum} от ${completeModal.updDate}`)
                        : "УПД подгружается автоматически из Open PO"}
                    </div>
                  </div>
                </div>
                <div className={`flex items-center gap-3 p-3 rounded-lg border ${hasPay ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${hasPay ? "bg-emerald-500" : "bg-red-500/30"}`}>
                    {hasPay ? <span className="text-white text-xs">✓</span> : <span className="text-red-400 text-xs">✕</span>}
                  </div>
                  <div>
                    <div className={`text-sm font-medium ${hasPay ? "text-emerald-300" : "text-red-300"}`}>
                      Оплата получена
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {hasPay ? `₽${fmt(completeModal.paymentFact)}` : "Оплата от клиента ещё не внесена"}
                    </div>
                  </div>
                </div>
              </div>
              {(!hasUpdOrGS || !hasPay) && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-rose-300 text-xs">
                  ⛔ Невозможно закрыть заказ. Для перевода в «Выполнен» необходимы оба условия:
                  {!hasUpdOrGS && <div className="mt-1">• УПД должна быть загружена в Open PO</div>}
                  {!hasPay && <div className="mt-1">• Оплата от клиента должна быть внесена</div>}
                </div>
              )}
          <div className="flex justify-end gap-3">
                <button onClick={() => setCompleteModal(null)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Закрыть</button>
                <button onClick={confirmFinComplete} disabled={!hasUpdOrGS || !hasPay}
                  className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">
                  ✅ Подтвердить «Выполнен»
            </button>
        </div>
      </div>
          );
        })()}
    </Modal>

      {/* Модал внесения оплаты — только с платёжкой из банка */}
      <Modal isOpen={!!payModal} onClose={() => setPayModal(null)} title={`Внесение оплаты — ${payModal?.customer || ""}`}>
        <div className="space-y-4">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-amber-300 text-sm">
            <div className="font-medium">⚠ Оплата факт (руб.) вносится только с приложением банковской платёжки!</div>
            <div className="text-xs mt-1 text-amber-400">Заказ: {payModal?.customerPo} — ${fmt(payModal?.customerAmount)}</div>
          </div>
          <InputField label="Сумма оплаты (₽) *" value={payForm.amount} onChange={(v) => setPayForm({ ...payForm, amount: v })} type="number" />
          <InputField label="Дата оплаты *" value={payForm.date} onChange={(v) => setPayForm({ ...payForm, date: v })} type="date" />
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Банковская платёжка (PDF/JPG) *</label>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setPayForm({ ...payForm, file: e.target.files[0] })} className="w-full text-sm text-slate-300" />
            {!payForm.file && <p className="text-xs text-rose-400 mt-1">Без документа внести нельзя!</p>}
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setPayModal(null)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Отмена</button>
            <button onClick={doPayment} disabled={!payForm.file || !payForm.amount || !payForm.date} className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">
              Внести оплату
            </button>
          </div>
        </div>
      </Modal>

      {/* Модал деталей */}
      <Modal isOpen={!!detailModal} onClose={() => setDetailModal(null)} title={`Фин. результат — ${detailModal?.customerPo || ""}`} wide>
        {detailModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                ["Клиент", detailModal.customer],
                ["PO клиента", detailModal.customerPo],
                ["Дата заказа", detailModal.orderDate],
                ["Сумма клиента ($)", "$" + fmt(detailModal.customerAmount)],
                ["Статус заказа / УПД", detailModal.noGlobalSmart ? "Без участия GS" : (detailModal.orderStatus || "—")],
                ["Оплата факт (руб)", fmt(detailModal.paymentFact)],
                ["PO поставщика", detailModal.supplierPo],
                ["Сумма поставщика ($)", "$" + fmt(detailModal.supplierAmount)],
                ["Поставщик", detailModal.supplier],
                ["Структура", detailModal.finalBuyer || "—"],
                ["Фин. агент", detailModal.finAgent || "—"],
                ["Оплата с агентскими", fmt(detailModal.paymentWithAgent)],
                ["Таможня", fmt(detailModal.customsCost)],
                ["Перевозка", fmt(detailModal.deliveryCost)],
                ["Маржа", detailModal.margin ? (detailModal.margin * 100).toFixed(2) + "%" : "—"],
                ["Чистая прибыль", fmt(detailModal.netProfit)],
              ].map(([label, value], i) => (
                <div key={i} className="py-2 border-b border-slate-700/30">
                  <div className="text-slate-500 text-xs mb-1">{label}</div>
                  <div className="text-slate-200 whitespace-pre-wrap">{value}</div>
                </div>
              ))}
            </div>
            {detailModal.comment && (
              <div className="bg-slate-700/30 p-3 rounded-lg text-sm">
                <div className="text-slate-500 text-xs mb-1">Комментарий</div>
                <div className="text-slate-300">{detailModal.comment}</div>
              </div>
            )}
            {detailModal.noGlobalSmart ? (
              <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-lg text-blue-300 text-sm">
                🔹 Заказ без участия Global Smart
              </div>
            ) : detailModal.hasUpd ? (
              <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg text-emerald-300 text-sm">
                ✅ УПД №{detailModal.updNum} от {detailModal.updDate}
              </div>
            ) : null}
              </div>
            )}
      </Modal>

      {/* Модал редактирования заказа */}
      <Modal isOpen={!!editModal} onClose={() => setEditModal(null)} title={`Редактирование — ${editModal?.customerPo || ""}`} wide>
        {editModal && (
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            {/* Основные данные заказа */}
            <div className="border border-slate-600/50 rounded-lg p-3">
              <h4 className="text-xs text-slate-400 uppercase tracking-wider mb-3 font-semibold">📋 Данные заказа</h4>
              <div className="grid grid-cols-2 gap-3">
                <InputField label="Клиент" value={editForm.customer} onChange={(v) => setEditForm({ ...editForm, customer: v })} />
                <InputField label="PO клиента" value={editForm.customerPo} onChange={(v) => setEditForm({ ...editForm, customerPo: v })} />
                <InputField label="Дата заказа" value={editForm.orderDate} onChange={(v) => setEditForm({ ...editForm, orderDate: v })} type="date" />
                <InputField label="Сумма клиента ($)" value={editForm.customerAmount} onChange={(v) => setEditForm({ ...editForm, customerAmount: v })} type="number" />
                <InputField label="PO поставщика" value={editForm.supplierPo} onChange={(v) => setEditForm({ ...editForm, supplierPo: v })} />
                <InputField label="Сумма поставщика ($)" value={editForm.supplierAmount} onChange={(v) => setEditForm({ ...editForm, supplierAmount: v })} type="number" />
                <InputField label="Поставщик" value={editForm.supplier} onChange={(v) => setEditForm({ ...editForm, supplier: v })} />
                <InputField label="Структура (фин. покупатель)" value={editForm.finalBuyer} onChange={(v) => setEditForm({ ...editForm, finalBuyer: v })} />
                <InputField label="Фин. агент" value={editForm.finAgent} onChange={(v) => setEditForm({ ...editForm, finAgent: v })} />
                <InputField label="Таможня ($)" value={editForm.customsCost} onChange={(v) => setEditForm({ ...editForm, customsCost: v })} type="number" />
                <InputField label="Перевозка ($)" value={editForm.deliveryCost} onChange={(v) => setEditForm({ ...editForm, deliveryCost: v })} type="number" />
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Тип</label>
                  <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white">
                    <option value="domestic">ROT (Rotable)</option>
                    <option value="export">EXP (Expendable)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Статус</label>
                  <div className="w-full px-3 py-2 bg-slate-700/30 border border-slate-600 rounded-lg text-sm text-slate-400 italic">
                    {editForm.status === "completed" ? "✅ Выполнен" : "🔵 В работе"}
                    <span className="text-[10px] block mt-0.5 text-slate-500">Статус меняется через канбан в таблице</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Информация УПД (только чтение — подгружается из Open PO) */}
            {(editForm.hasUpd || editForm.noGlobalSmart) && (
              <div className={`border rounded-lg p-3 ${editForm.noGlobalSmart ? "border-blue-500/30 bg-blue-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
                <h4 className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">📄 УПД (из Open PO)</h4>
                {editForm.noGlobalSmart ? (
                  <div className="text-blue-300 text-sm">🔹 Заказ без участия Global Smart</div>
                ) : (
                  <div className="text-emerald-300 text-sm">✅ УПД №{editForm.updNum || "—"} от {editForm.updDate || "—"}</div>
                )}
                <div className="text-[10px] text-slate-500 mt-1">УПД подгружается автоматически из Open PO и не редактируется здесь</div>
              </div>
            )}

            {/* Секция оплаты */}
            <div className={`border rounded-lg p-3 ${editForm.paymentFact > 0 ? "border-blue-500/30 bg-blue-500/5" : "border-slate-600/50"}`}>
              <h4 className="text-xs text-slate-400 uppercase tracking-wider mb-3 font-semibold">💳 Оплата от заказчика</h4>
              <div className="grid grid-cols-2 gap-3">
                <InputField label="Оплата факт (₽)" value={editForm.paymentFact} onChange={(v) => setEditForm({ ...editForm, paymentFact: v })} type="number" />
                <InputField label="Дата оплаты" value={editForm.paymentDate} onChange={(v) => setEditForm({ ...editForm, paymentDate: v })} type="date" />
              </div>
              <div className="mt-3">
                <label className="text-xs text-slate-400 mb-1 block">Платёжный документ</label>
                {editForm.paymentDoc && !editForm._newPayDoc && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-blue-400">✅ Платёжка загружена</span>
                    <button onClick={() => setEditForm({ ...editForm, paymentDoc: null })} className="text-xs text-rose-400 hover:text-rose-300">✕ Удалить</button>
                  </div>
                )}
                {editForm._newPayDoc && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-blue-400">📎 {editForm._newPayDoc.name}</span>
                    <button onClick={() => setEditForm({ ...editForm, _newPayDoc: null })} className="text-xs text-rose-400 hover:text-rose-300">✕</button>
                  </div>
                )}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setEditForm({ ...editForm, _newPayDoc: e.target.files[0] || null })}
                  className="w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-blue-500/20 file:text-blue-300 hover:file:bg-blue-500/30 file:cursor-pointer" />
              </div>
              {editForm.hasUpd && parseFloat(editForm.paymentFact) > 0 && (
                <div className="mt-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 text-xs text-emerald-300">
                  ✅ УПД + оплата есть — заказ НЕ будет в дебиторке
                </div>
              )}
              {editForm.hasUpd && !(parseFloat(editForm.paymentFact) > 0) && (
                <div className="mt-3 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2 text-xs text-rose-300">
                  ⚠ УПД есть, но оплаты нет — заказ попадёт в дебиторку
                </div>
              )}
            </div>

            {/* Комментарий */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Комментарий</label>
              <textarea value={editForm.comment} onChange={(e) => setEditForm({ ...editForm, comment: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 h-20 resize-none" />
            </div>
            <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-slate-800 py-3 -mx-1 px-1">
              <button onClick={() => setEditModal(null)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Отмена</button>
              <button onClick={saveEdit} className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors">
                💾 Сохранить
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

// ==================== ЛОГИСТИЧЕСКАЯ ПАНЕЛЬ (раскрывающаяся строка) ====================
const ExpandedLogisticsPanel = ({ order, setData, pushLog }) => {
  const [editing, setEditing] = useState(null); // "awb" | "delivery" | "comments" | null
  const [form, setForm] = useState({});

  // Разбиваем deliveryCost на план / факт
  const parsed = parseDeliveryCost(order.deliveryCost);
  // Факт. стоимость: сначала отдельное поле, потом парсинг из deliveryCost
  const actualCost = order.deliveryActualCost || parsed.actual || "";

  // Цвета миль
  const milestoneColors = {
    "": { bg: "bg-gray-100", text: "text-gray-500", border: "border-gray-300", label: "Не указана" },
    "1": { bg: "bg-red-100", text: "text-red-800", border: "border-red-400", label: "Миля 1", dot: "bg-red-500" },
    "2": { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-400", label: "Миля 2", dot: "bg-orange-500" },
    "3": { bg: "bg-yellow-100", text: "text-yellow-800", border: "border-yellow-400", label: "Миля 3", dot: "bg-yellow-500" },
    "4": { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-400", label: "Миля 4", dot: "bg-emerald-500" },
  };

  const startFieldEdit = (section) => {
    setEditing(section);
    if (section === "awb") {
      setForm({ awb: order.awb || "", milestone: order.milestone || "" });
    } else if (section === "delivery") {
      setForm({
        deliveryActualCost: actualCost,
        termsDelivery: order.termsDelivery || "",
        deliveryVat: order.deliveryVat || "0",
      });
    } else if (section === "comments") {
      setForm({ comments: order.comments || "" });
    }
  };

  const saveFieldEdit = () => {
    if (!editing) return;
    pushLog({ type: "po_logistics", id: order.id, section: editing, prev: {
      awb: order.awb, milestone: order.milestone, deliveryActualCost: order.deliveryActualCost,
      termsDelivery: order.termsDelivery, deliveryVat: order.deliveryVat,
      comments: order.comments, deliveryCost: order.deliveryCost,
    }});
    const updates = { ...form };
    // При сохранении доставки — обновляем deliveryCost: план + факт
    if (editing === "delivery") {
      const planPart = parsed.plan;
      const newActual = form.deliveryActualCost || "";
      updates.deliveryCost = [planPart, newActual].filter(Boolean).join("\n");
    }
    setData((prev) => prev.map((r) => (r.id === order.id ? { ...r, ...updates } : r)));
    setEditing(null);
  };

  const cancelFieldEdit = () => { setEditing(null); setForm({}); };

  const inputCls = "w-full px-2 py-1.5 text-xs border border-blue-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500";
  const labelCls = "text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1 block";

  return (
    <div className="px-4 py-3 border-l-4 border-[#1E3A5F]">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* ✈️ AWB / Накладные + Миля */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">✈️</span>
              <span className="text-[11px] font-semibold text-[#1E3A5F] uppercase tracking-wide">AWB / Накладные</span>
            </div>
            {editing !== "awb" ? (
              <button onClick={() => startFieldEdit("awb")} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">✏️ Изменить</button>
            ) : (
              <div className="flex gap-1">
                <button onClick={saveFieldEdit} className="text-[10px] text-emerald-600 hover:text-emerald-800 font-bold">✓ Сохранить</button>
                <button onClick={cancelFieldEdit} className="text-[10px] text-gray-400 hover:text-gray-600">Отмена</button>
              </div>
            )}
          </div>
          {editing === "awb" ? (
            <div className="space-y-2">
              <textarea value={form.awb || ""} onChange={(e) => setForm({ ...form, awb: e.target.value })}
                className={`${inputCls} h-16 resize-none`} placeholder="Номера накладных, FX, TL..." autoFocus />
              <div>
                <label className={labelCls}>Миля</label>
                <div className="flex gap-1.5">
                  {["1", "2", "3", "4"].map((m) => {
                    const mc = milestoneColors[m];
                    const isActive = form.milestone === m;
                    return (
                      <button key={m} onClick={() => setForm({ ...form, milestone: isActive ? "" : m })}
                        className={`flex-1 px-2 py-1.5 rounded-md text-xs font-bold border-2 transition-all ${
                          isActive ? `${mc.bg} ${mc.text} ${mc.border} ring-2 ring-offset-1 ring-${m === "1" ? "red" : m === "2" ? "orange" : m === "3" ? "yellow" : "emerald"}-300` 
                                   : "bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100"
                        }`}>
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-gray-700 whitespace-pre-wrap break-all max-h-20 overflow-y-auto">
                {order.awb || <span className="text-gray-400 italic">Не указано — нажмите «Изменить»</span>}
              </div>
              {/* Индикатор мили */}
              {order.milestone ? (
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${milestoneColors[order.milestone]?.bg} ${milestoneColors[order.milestone]?.text} border ${milestoneColors[order.milestone]?.border}`}>
                  <span className={`w-2 h-2 rounded-full ${milestoneColors[order.milestone]?.dot}`}></span>
                  {milestoneColors[order.milestone]?.label}
                </div>
              ) : (
                <span className="text-[10px] text-gray-400 italic">Миля не указана</span>
              )}
            </div>
          )}
        </div>

        {/* 🚚 Доставка */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">🚚</span>
              <span className="text-[11px] font-semibold text-[#1E3A5F] uppercase tracking-wide">Доставка</span>
            </div>
            {editing !== "delivery" ? (
              <button onClick={() => startFieldEdit("delivery")} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">✏️ Изменить</button>
            ) : (
              <div className="flex gap-1">
                <button onClick={saveFieldEdit} className="text-[10px] text-emerald-600 hover:text-emerald-800 font-bold">✓ Сохранить</button>
                <button onClick={cancelFieldEdit} className="text-[10px] text-gray-400 hover:text-gray-600">Отмена</button>
              </div>
            )}
          </div>
          {editing === "delivery" ? (
            <div className="space-y-2">
              <div>
                <label className={labelCls}>Факт. стоимость логистики</label>
                <input type="text" value={form.deliveryActualCost || ""} onChange={(e) => setForm({ ...form, deliveryActualCost: e.target.value })}
                  className={inputCls} placeholder="Напр.: $1200" autoFocus />
              </div>
              <div>
                <label className={labelCls}>Условия доставки</label>
                <input type="text" value={form.termsDelivery || ""} onChange={(e) => setForm({ ...form, termsDelivery: e.target.value })}
                  className={inputCls} placeholder="DDP MOW / EXW UAE / CIF..." />
              </div>
              <div>
                <label className={labelCls}>НДС</label>
                <div className="flex gap-2">
                  <button onClick={() => setForm({ ...form, deliveryVat: "0" })}
                    className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      form.deliveryVat === "0" ? "bg-[#1E3A5F] text-white border-[#1E3A5F]" : "bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100"
                    }`}>0%</button>
                  <button onClick={() => setForm({ ...form, deliveryVat: "22" })}
                    className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      form.deliveryVat === "22" ? "bg-[#1E3A5F] text-white border-[#1E3A5F]" : "bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100"
                    }`}>22%</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-700 space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Факт. стоимость:</span>
                <span className="font-semibold text-[#1E3A5F] text-right max-w-[200px] whitespace-pre-wrap">{actualCost || <span className="text-gray-400 italic font-normal">—</span>}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Условия:</span>
                <span className="font-medium">{order.termsDelivery || <span className="text-gray-400 italic font-normal">—</span>}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">НДС:</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  order.deliveryVat === "22" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                }`}>{order.deliveryVat === "22" ? "22%" : "0%"}</span>
              </div>
            </div>
          )}
        </div>

        {/* 💬 Комментарии */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">💬</span>
              <span className="text-[11px] font-semibold text-[#1E3A5F] uppercase tracking-wide">Комментарии</span>
            </div>
            {editing !== "comments" ? (
              <button onClick={() => startFieldEdit("comments")} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">✏️ Изменить</button>
            ) : (
              <div className="flex gap-1">
                <button onClick={saveFieldEdit} className="text-[10px] text-emerald-600 hover:text-emerald-800 font-bold">✓ Сохранить</button>
                <button onClick={cancelFieldEdit} className="text-[10px] text-gray-400 hover:text-gray-600">Отмена</button>
              </div>
            )}
          </div>
          {editing === "comments" ? (
            <textarea value={form.comments || ""} onChange={(e) => setForm({ ...form, comments: e.target.value })}
              className={`${inputCls} h-24 resize-none`} placeholder="Записи логиста: статусы, даты, примечания..." autoFocus />
          ) : (
            <div className="text-xs text-gray-700 whitespace-pre-wrap max-h-24 overflow-y-auto">
              {order.comments || <span className="text-gray-400 italic">Нет записей — нажмите «Изменить»</span>}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

// ==================== OPEN PO ====================
const OpenPO = ({ data, setData, pushLog, finResults, setFinResults }) => {
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("domestic");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(-1); // -1 = auto last page
  const [updModal, setUpdModal] = useState(null);
  const [updForm, setUpdForm] = useState({ num: "", date: "", file: null, noGS: false });
  const [detailModal, setDetailModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  // Раскрытые строки (логистическая панель)
  const [expandedRows, setExpandedRows] = useState(new Set());
  const toggleExpand = (id) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Инлайн-редактирование статуса оплаты
  const [inlineEdit, setInlineEdit] = useState(null); // { id, field, value }

  const startInlineEdit = (o, field) => {
    setInlineEdit({ id: o.id, field, value: o[field] || "" });
  };

  const saveInlineEdit = () => {
    if (!inlineEdit) return;
    const { id, field, value } = inlineEdit;
    const row = data.find((r) => r.id === id);
    if (row) {
      pushLog({ type: "po_inline_edit", id, field, prev: row[field] || "" });
      setData((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    }
    setInlineEdit(null);
  };

  const cancelInlineEdit = () => setInlineEdit(null);

  // Синхронизация УПД: OpenPO → Фин. результат (по совпадению PO клиента)
  const syncUpdToFinResults = useCallback((poInternalPo, hasUpd, updNum, updDate, updFile, noGlobalSmart) => {
    if (!setFinResults) return;
    setFinResults((prev) =>
      prev.map((fr) => {
        // Ищем совпадение по PO клиента (Internal PO в OpenPO = customerPo в FinResults)
        if (fr.customerPo === poInternalPo) {
          if (hasUpd) {
            return {
              ...fr,
              hasUpd: true,
              noGlobalSmart: !!noGlobalSmart,
              updNum: updNum || fr.updNum,
              updDate: updDate || fr.updDate,
              updFile: updFile || fr.updFile,
              orderStatus: noGlobalSmart ? "Без участия GS" : (updNum ? `УПД №${updNum} от ${updDate}` : fr.orderStatus),
            };
          } else {
            // УПД удалена — убираем из FinResults и, следовательно, из Дебиторки
            return { ...fr, hasUpd: false, noGlobalSmart: false, updNum: "", updDate: "", updFile: null, orderStatus: "" };
          }
        }
        return fr;
      })
    );
  }, [setFinResults]);
  const [newPO, setNewPO] = useState({
    customer: "", respSales: "", internalPo: "", dateOrdered: new Date().toISOString().split("T")[0],
    customerDeadline: "", termsDelivery: "", customerAmount: 0, paymentStatusCustomer: "",
    dateCustomerPaid: "",
    deliveryCost: 0, awb: "", tracking: "", comments: "", mgmtComments: "",
    type: "domestic",
    externalOrders: [{ po: "", supplier: "", supplierAmount: 0, payment: "", payingCompany: "", datePlaced: "", respProcurement: "", cancelled: false }],
  });
  const PP = 30;

  const filtered = useMemo(() => {
    let items = [...data];
    // Сортировка по дате: от старого к новому
    items.sort((a, b) => (a.dateOrdered || "").localeCompare(b.dateOrdered || ""));
    // Фильтр по типу (ROT / EXP / YOON)
    if (typeFilter === "domestic") items = items.filter((o) => o.type === "domestic");
    if (typeFilter === "export") items = items.filter((o) => o.type === "export");
    if (typeFilter === "yoon") items = items.filter((o) => o.type === "yoon");
    // Фильтр по статусу
    if (filter === "active") items = items.filter((o) => o.status === "active");
    if (filter === "completed") items = items.filter((o) => o.status === "completed");
    if (filter === "cancelled") items = items.filter((o) => o.status === "cancelled");
    if (filter === "upd") items = items.filter((o) => o.hasUpd);
    if (filter === "no_upd") items = items.filter((o) => !o.hasUpd && o.status !== "cancelled");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (o) =>
          o.customer?.toLowerCase().includes(q) ||
          o.internalPo?.toLowerCase().includes(q) ||
          o.supplierName?.toLowerCase().includes(q) ||
          o.internalPoRef?.toLowerCase().includes(q) ||
          o.comments?.toLowerCase().includes(q) ||
          o.mgmtComments?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [data, filter, typeFilter, search]);

  const pages = Math.ceil(filtered.length / PP);
  const effectivePage = page === -1 ? Math.max(0, pages - 1) : page;
  const slice = filtered.slice(effectivePage * PP, (effectivePage + 1) * PP);

  const doUpd = () => {
    if (!updModal) return;
    if (!updForm.noGS && !updForm.file) return;

    const applyPoUpdate = (fileData) => {
      pushLog({
        type: "po_upd",
        id: updModal.id,
        prev: { hasUpd: updModal.hasUpd, updNum: updModal.updNum, updDate: updModal.updDate, mgmtComments: updModal.mgmtComments, noGlobalSmart: updModal.noGlobalSmart },
      });
      if (updForm.noGS) {
      setData((prev) =>
        prev.map((r) =>
          r.id === updModal.id
            ? {
                  ...r, hasUpd: true, noGlobalSmart: true, updNum: "Без участия GS", updDate: "", updFile: null,
                  mgmtComments: `${r.mgmtComments ? r.mgmtComments + "\n" : ""}Без участия GS`,
                }
              : r
          )
        );
        syncUpdToFinResults(updModal.internalPo, true, "Без участия GS", "", null, true);
      } else {
        setData((prev) =>
          prev.map((r) =>
            r.id === updModal.id
              ? {
                  ...r, hasUpd: true, noGlobalSmart: false, updNum: updForm.num, updDate: updForm.date, updFile: fileData,
                mgmtComments: `${r.mgmtComments ? r.mgmtComments + "\n" : ""}УПД №${updForm.num} от ${updForm.date}`,
              }
            : r
        )
      );
        syncUpdToFinResults(updModal.internalPo, true, updForm.num, updForm.date, fileData, false);
      }
      setUpdModal(null);
      setUpdForm({ num: "", date: "", file: null, noGS: false });
    };

    if (updForm.noGS) {
      applyPoUpdate(null);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => applyPoUpdate(e.target.result);
    reader.readAsDataURL(updForm.file);
    }
  };

  const cancelOrder = () => {
    if (!cancelModal || !cancelReason.trim()) return;
    pushLog({ type: "po_cancel", id: cancelModal.id, prev: { status: cancelModal.status, cancelReason: cancelModal.cancelReason, comments: cancelModal.comments } });
    const dateStr = new Date().toLocaleDateString("ru-RU");
    const cancelComment = `[${dateStr}] ОТМЕНА ЗАКАЗА: ${cancelReason.trim()}`;
    setData((prev) =>
      prev.map((r) => (r.id === cancelModal.id ? {
        ...r, status: "cancelled", cancelReason,
        orderStage: "cancel",
        comments: r.comments ? `${r.comments}\n${cancelComment}` : cancelComment,
      } : r))
    );
    setCancelModal(null);
    setCancelReason("");
  };

  const restoreOrder = (r) => {
    pushLog({ type: "po_status", id: r.id, prev: r.status });
    setData((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: "active", cancelReason: "" } : x)));
  };

  const completeOrder = (r) => {
    pushLog({ type: "po_status", id: r.id, prev: r.status });
    setData((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: "completed" } : x)));
  };

  const deleteOrder = (r) => {
    if (!window.confirm(`Удалить заказ ${r.internalPo || r.customerPo || r.num}? Действие можно отменить.`)) return;
    pushLog({ type: "po_delete", id: r.id, prev: { ...r } });
    setData((prev) => prev.filter((o) => o.id !== r.id));
  };

  const startEdit = (r) => {
    setEditModal(r);
    const exts = parseExternalPOs(r);
    setEditForm({
      customer: r.customer, respSales: r.respSales, internalPo: r.internalPo,
      customerAmount: r.customerAmount,
      paymentStatusCustomer: r.paymentStatusCustomer,
      comments: r.comments, awb: r.awb, tracking: r.tracking,
      customerDeadline: r.customerDeadline, termsDelivery: r.termsDelivery,
      hasUpd: r.hasUpd || false, noGlobalSmart: r.noGlobalSmart || false,
      updNum: r.updNum || "", updDate: r.updDate || "", updFile: r.updFile || null,
      externalOrders: exts,
    });
  };

  const saveEdit = () => {
    if (!editModal) return;
    pushLog({ type: "po_edit", id: editModal.id, prev: { ...editModal } });
    const exts = editForm.externalOrders || [];
    const updatedForm = {
      ...editForm,
      internalPoRef: exts.map((e) => (e.cancelled ? "~" : "") + e.po).join("\n"),
      supplierName: exts.map((e) => e.supplier).join("\n"),
      supplierAmount: exts.reduce((s, e) => s + (parseFloat(e.supplierAmount) || 0), 0),
      supplierAmounts: exts.map((e) => e.supplierAmount || "0").join("\n"),
      paymentStatusSupplier: exts.map((e) => e.payment).join("\n"),
      payingCompany: exts.map((e) => e.payingCompany).join("\n"),
      datePlacedSupplier: exts.map((e) => e.datePlaced).join("\n"),
      respProcurement: exts.map((e) => e.respProcurement).join("\n"),
    };
    // Автозапись причин отмены ext PO в комментарии
    const prevExts = parseExternalPOs(editModal);
    const cancelComments = [];
    exts.forEach((ext, i) => {
      const wasCancelled = prevExts[i]?.cancelled || false;
      if (ext.cancelled && !wasCancelled && ext.cancelReason) {
        const dateStr = new Date().toLocaleDateString("ru-RU");
        cancelComments.push(`[${dateStr}] ОТМЕНА PO ${ext.po}: ${ext.cancelReason}`);
      }
    });
    if (cancelComments.length > 0) {
      updatedForm.comments = (updatedForm.comments || "")
        ? `${updatedForm.comments}\n${cancelComments.join("\n")}`
        : cancelComments.join("\n");
    }
    delete updatedForm.externalOrders;
    // Если удалили УПД — сбросить поля
    if (!updatedForm.hasUpd) {
      updatedForm.updNum = "";
      updatedForm.updDate = "";
      updatedForm.updFile = null;
      updatedForm.noGlobalSmart = false;
    }
    if (updatedForm.noGlobalSmart) {
      updatedForm.hasUpd = true;
      updatedForm.updNum = "Без участия GS";
      updatedForm.updDate = "";
      updatedForm.updFile = null;
    }
    setData((prev) => prev.map((r) => (r.id === editModal.id ? { ...r, ...updatedForm } : r)));
    // Синхронизация → Фин. результат → Дебиторка
    syncUpdToFinResults(editModal.internalPo, updatedForm.hasUpd, updatedForm.updNum, updatedForm.updDate, updatedForm.updFile, updatedForm.noGlobalSmart);
    setEditModal(null);
  };

  const emptyExtPO = { po: "", supplier: "", supplierAmount: 0, payment: "", payingCompany: "", datePlaced: "", respProcurement: "", cancelled: false, cancelReason: "" };
  const handleAddPO = () => {
    const id = Math.max(...data.map((o) => o.id), 0) + 1;
    const num = String(data.length + 1);
    const exts = newPO.externalOrders || [emptyExtPO];
    const assembled = {
      ...newPO,
      id, num, status: "active", hasUpd: false, updNum: "", updDate: "", updFile: null, cancelReason: "",
      customerAmount: parseFloat(newPO.customerAmount) || 0,
      supplierAmount: exts.reduce((s, e) => s + (parseFloat(e.supplierAmount) || 0), 0),
      deliveryCost: parseFloat(newPO.deliveryCost) || 0,
      internalPoRef: exts.map((e) => (e.cancelled ? "~" : "") + e.po).join("\n"),
      supplierName: exts.map((e) => e.supplier).join("\n"),
      supplierAmounts: exts.map((e) => e.supplierAmount || "0").join("\n"),
      paymentStatusSupplier: exts.map((e) => e.payment).join("\n"),
      payingCompany: exts.map((e) => e.payingCompany).join("\n"),
      datePlacedSupplier: exts.map((e) => e.datePlaced).join("\n"),
      respProcurement: exts.map((e) => e.respProcurement).join("\n"),
    };
    // Автозапись причин отмены ext PO в комментарии нового заказа
    const cancelComments = exts
      .filter((ext) => ext.cancelled && ext.cancelReason)
      .map((ext) => `[${new Date().toLocaleDateString("ru-RU")}] ОТМЕНА PO ${ext.po}: ${ext.cancelReason}`);
    if (cancelComments.length > 0) {
      assembled.comments = assembled.comments
        ? `${assembled.comments}\n${cancelComments.join("\n")}`
        : cancelComments.join("\n");
    }
    delete assembled.externalOrders;
    setData([...data, assembled]);

    // Авто-создание записи в Фин. результат
    if (setFinResults) {
      const activeExts = exts.filter((e) => !e.cancelled);
      const finEntry = {
        id: Date.now(),
        customer: newPO.customer || "",
        customerPo: newPO.internalPo || "",
        orderDate: newPO.dateOrdered || "",
        customerAmount: parseFloat(newPO.customerAmount) || 0,
        orderStatus: "",
        paymentFact: 0,
        supplierPo: activeExts.map((e) => e.po).join(", "),
        supplierAmount: activeExts.reduce((s, e) => s + (parseFloat(e.supplierAmount) || 0), 0),
        supplier: activeExts.map((e) => e.supplier).filter(Boolean).join(", "),
        finalBuyer: activeExts.map((e) => e.payingCompany).filter(Boolean)[0] || "",
        finAgent: "",
        customsCost: 0,
        deliveryCost: 0,
        comment: "",
        type: newPO.type || "domestic",
        status: "active",
        hasUpd: false,
        noGlobalSmart: false,
        updNum: "",
        updDate: "",
        updFile: null,
        paymentDoc: null,
        paymentDate: "",
      };
      setFinResults((prev) => [...prev, finEntry]);
    }

    setShowAdd(false);
    setNewPO({
      customer: "", respSales: "", internalPo: "", dateOrdered: new Date().toISOString().split("T")[0],
      customerDeadline: "", termsDelivery: "", customerAmount: 0, paymentStatusCustomer: "",
      dateCustomerPaid: "",
      deliveryCost: 0, awb: "", tracking: "", comments: "", mgmtComments: "",
      type: "domestic",
      externalOrders: [{ ...emptyExtPO }],
    });
  };

  return (
    <div className="space-y-4">
      {/* Фильтры и поиск — стиль как в Фин. результат */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Вкладки типа: ROT / EXP / YOON */}
        <div className="flex gap-1 bg-[#1E3A5F] p-1 rounded-lg">
          {[
            { k: "domestic", l: `ROT (${data.filter((o) => o.type === "domestic").length})` },
            { k: "export", l: `EXP (${data.filter((o) => o.type === "export").length})` },
            { k: "yoon", l: `YOON (${data.filter((o) => o.type === "yoon").length})` },
          ].map((f) => (
            <button key={f.k} onClick={() => { setTypeFilter(f.k); setPage(-1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                typeFilter === f.k ? "bg-white text-[#1E3A5F] font-bold" : "text-white/80 hover:text-white hover:bg-[#2A4A6F]"
              }`}>
              {f.l}
            </button>
          ))}
        </div>
        {/* Фильтр по статусу */}
        <div className="flex gap-1 bg-[#1E3A5F] p-1 rounded-lg">
          {[
            { k: "all", l: "Все" },
            { k: "active", l: "В работе" },
            { k: "completed", l: "Выполнено" },
            { k: "cancelled", l: "Отменено" },
          ].map((f) => (
            <button key={f.k} onClick={() => { setFilter(f.k); setPage(-1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                filter === f.k ? "bg-white text-[#1E3A5F] font-bold" : "text-white/80 hover:text-white hover:bg-[#2A4A6F]"
              }`}>
              {f.l}
            </button>
          ))}
    </div>
        <input type="text" placeholder="Поиск по клиенту, PO, поставщику..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(-1); }}
          className="flex-1 min-w-48 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-[#1E3A5F] hover:bg-[#2A4A6F] text-white rounded-lg text-sm font-medium transition-colors">
          + Новый PO
        </button>
        <span className="text-xs text-gray-500 font-medium">{filtered.length} записей</span>
    </div>

      {/* Таблица */}
      <div className="rounded-xl shadow-lg overflow-hidden border border-[#1E3A5F]/30 flex flex-col" style={{ minHeight: "calc(100vh - 220px)" }}>
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#1E3A5F] text-white">
                <th className="py-2.5 px-1 text-center font-semibold w-7"></th>
                <th className="py-2.5 px-2 text-left font-semibold">№</th>
                <th className="py-2.5 px-2 text-left font-semibold">Клиент</th>
                <th className="py-2.5 px-2 text-left font-semibold">PO</th>
                <th className="py-2.5 px-2 text-left font-semibold">Дата</th>
                <th className="py-2.5 px-2 text-left font-semibold">Дедлайн</th>
                <th className="py-2.5 px-2 text-right font-semibold">Сумма $</th>
                <th className="py-2.5 px-2 text-left font-semibold">Оплата клиента</th>
                <th className="py-2.5 px-2 text-left font-semibold">External PO</th>
                <th className="py-2.5 px-2 text-left font-semibold">Поставщик</th>
                <th className="py-2.5 px-2 text-right font-semibold">Сумма пост.</th>
                <th className="py-2.5 px-2 text-left font-semibold">Оплата пост.</th>
                <th className="py-2.5 px-2 text-left font-semibold">Плат. компания</th>
                <th className="py-2.5 px-2 text-left font-semibold">Дост. план</th>
                <th className="py-2.5 px-2 text-left font-semibold">Стадия</th>
                <th className="py-2.5 px-2 text-left font-semibold">УПД</th>
                <th className="py-2.5 px-2 text-center font-semibold">Действия</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {slice.map((o, idx) => {
                const ps = (o.paymentStatusCustomer || "").toLowerCase();
                const isPaid = (ps.includes("paid") || ps.includes("prepayment") || ps.includes("100%") || ps.includes("advance")) && !ps.includes("not paid");
                const isExpanded = expandedRows.has(o.id);
                const hasLogistics = o.comments || o.awb || o.tracking || o.mgmtComments;
                return (
                  <React.Fragment key={o.id}>
                  <tr
                    onClick={() => setDetailModal(o)}
                    className={`border-b border-gray-200 hover:bg-blue-50 cursor-pointer transition-colors ${
                      o.orderStage === "cancelled" || o.status === "cancelled" ? "bg-red-200" : o.orderStage === "done" || o.status === "completed" ? "bg-green-200" : idx % 2 === 1 ? "bg-gray-50" : ""
                    }`}>
                    {/* Кнопка раскрытия логистической панели */}
                    <td className="py-2 px-1 text-center" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => toggleExpand(o.id)}
                        className={`w-5 h-5 flex items-center justify-center rounded text-[10px] transition-all ${
                          isExpanded ? "bg-[#1E3A5F] text-white" : hasLogistics ? "bg-blue-100 text-[#1E3A5F] hover:bg-blue-200" : "text-gray-300"
                        }`}
                        title={isExpanded ? "Свернуть" : "Развернуть логистику"}>
                        {isExpanded ? "▾" : "▸"}
                      </button>
                    </td>
                    <td className="py-2 px-2 text-gray-500">{o.num}</td>
                    <td className="py-2 px-2 text-[#1E3A5F] font-semibold max-w-[140px] truncate">{o.customer}</td>
                    <td className="py-2 px-2 text-gray-900 font-mono text-xs max-w-[120px] truncate">{o.internalPo}</td>
                    <td className="py-2 px-2 text-gray-600 whitespace-nowrap">{o.dateOrdered || "—"}</td>
                    <td className="py-2 px-2 text-gray-600 whitespace-nowrap text-xs">{o.customerDeadline || "—"}</td>
                    <td className="py-2 px-2 text-right text-gray-900 font-semibold tabular-nums whitespace-nowrap">${fmt(o.customerAmount)}</td>
                    <td className="py-2 px-2 max-w-[120px]" onClick={(e) => e.stopPropagation()}>
                      {inlineEdit && inlineEdit.id === o.id && inlineEdit.field === "paymentStatusCustomer" ? (
                        <div className="flex items-center gap-1">
                          <input type="text" value={inlineEdit.value} autoFocus
                            onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") saveInlineEdit(); if (e.key === "Escape") cancelInlineEdit(); }}
                            className="w-full px-1.5 py-0.5 text-[11px] border border-blue-400 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
                          <button onClick={saveInlineEdit} className="text-emerald-600 text-xs font-bold hover:text-emerald-800" title="Сохранить">✓</button>
                          <button onClick={cancelInlineEdit} className="text-red-400 text-xs font-bold hover:text-red-600" title="Отмена">✕</button>
                      </div>
                      ) : (
                        <span onClick={() => startInlineEdit(o, "paymentStatusCustomer")}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all ${isPaid ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                          title="Нажмите для редактирования">
                          {(o.paymentStatusCustomer || "—").substring(0, 20)}
                        </span>
                      )}
                    </td>
                    {/* External PO — номера с зачёркиванием */}
                    <td className="py-2 px-2 font-mono text-xs max-w-[120px]">
                      {(() => {
                        const refs = (o.internalPoRef || "").split("\n").map((s) => s.trim()).filter(Boolean);
                        if (!refs.length) return <span className="text-gray-400">—</span>;
                        return <div className="space-y-0.5">
                          {refs.map((ref, ri) => {
                            const isCancelled = ref.startsWith("~");
                            const displayRef = isCancelled ? ref.substring(1) : ref;
                            return <div key={ri} className={`truncate text-[10px] leading-tight ${isCancelled ? "line-through text-gray-400" : "text-gray-600"}`}>{displayRef}</div>;
                          })}
                        </div>;
                      })()}
                    </td>
                    {/* Поставщик — данные заказа (без отменённых PO) */}
                    {(() => {
                      const exts = parseExternalPOs(o);
                      const active = exts.filter((e) => !e.cancelled);
                      const suppliers = active.map((e) => e.supplier).filter(Boolean);
                      const amounts = active.map((e) => e.supplierAmount).filter(Boolean);
                      const payments = active.map((e) => e.payment).filter(Boolean);
                      const companies = active.map((e) => e.payingCompany).filter(Boolean);
                      return (<>
                        <td className="py-2 px-2 text-xs max-w-[120px]">
                          {!suppliers.length ? <span className="text-gray-400">—</span> :
                            suppliers.length === 1 ? <span className="text-gray-700 truncate block">{suppliers[0]}</span> :
                            <div className="space-y-0.5">{suppliers.map((n, i) => <div key={i} className="text-gray-700 truncate text-[10px] leading-tight">{n}</div>)}</div>}
                        </td>
                        <td className="py-2 px-2 text-right text-gray-700 tabular-nums whitespace-nowrap text-xs">
                          {amounts.length > 1 ? <div className="space-y-0.5">{amounts.map((a, i) => <div key={i} className="text-[10px] leading-tight">${fmt(parseFloat(a) || 0)}</div>)}</div>
                            : amounts.length === 1 ? "$" + fmt(parseFloat(amounts[0]) || 0)
                            : o.supplierAmount ? "$" + fmt(o.supplierAmount) : "—"}
                        </td>
                        <td className="py-2 px-2 max-w-[120px]" onClick={(e) => e.stopPropagation()}>
                          {inlineEdit && inlineEdit.id === o.id && inlineEdit.field === "paymentStatusSupplier" ? (
                            <div className="flex items-center gap-1">
                              <input type="text" value={inlineEdit.value} autoFocus
                                onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                                onKeyDown={(e) => { if (e.key === "Enter") saveInlineEdit(); if (e.key === "Escape") cancelInlineEdit(); }}
                                className="w-full px-1.5 py-0.5 text-[11px] border border-blue-400 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
                              <button onClick={saveInlineEdit} className="text-emerald-600 text-xs font-bold hover:text-emerald-800" title="Сохранить">✓</button>
                              <button onClick={cancelInlineEdit} className="text-red-400 text-xs font-bold hover:text-red-600" title="Отмена">✕</button>
          </div>
                          ) : (() => {
                            if (!payments.length) return <span className="text-gray-400 cursor-pointer text-[10px]" onClick={() => startInlineEdit(o, "paymentStatusSupplier")}>—</span>;
                            return <div className="space-y-0.5" onClick={() => startInlineEdit(o, "paymentStatusSupplier")}>
                              {payments.map((p, pi) => {
                                const paid = p.toLowerCase().includes("paid") && !p.toLowerCase().includes("not paid");
                                return <div key={pi} className={`px-1 py-0.5 rounded text-[9px] font-medium cursor-pointer ${paid ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{p}</div>;
                              })}
                            </div>;
                          })()}
                        </td>
                        <td className="py-2 px-2 text-gray-600 text-xs max-w-[80px] truncate">{companies.length > 0 ? companies.join(", ") : "—"}</td>
                      </>);
                    })()}
                    <td className="py-2 px-2 text-gray-600 text-xs max-w-[80px] truncate">{parseDeliveryCost(o.deliveryCost).plan || "—"}</td>
                    <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                      <KanbanDropdown order={o} setData={setData} pushLog={pushLog} syncUpdToFinResults={syncUpdToFinResults} />
                    </td>
                    <td className="py-2 px-2 text-center">
                      {o.noGlobalSmart ? (
                        <span className="text-blue-600 text-xs font-medium cursor-help" title="Заказ без участия Global Smart">
                          🔹 Без участия GS
              </span>
                      ) : o.hasUpd ? (
                        <span className="text-emerald-600 text-xs cursor-help" title={`УПД №${o.updNum} от ${o.updDate}`}>
                          ✅ <span className="text-emerald-700 font-medium">УПД №{o.updNum || "—"} от {o.updDate || "—"}</span>
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-2 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => startEdit(o)} className="p-1 hover:bg-gray-200 rounded" title="Редактировать">✏️</button>
                        <button onClick={() => deleteOrder(o)} className="p-1 hover:bg-red-100 rounded text-red-400 hover:text-red-600" title="Удалить заказ">🗑️</button>
                      </div>
                    </td>
                  </tr>
                  {/* Раскрывающаяся панель логистики */}
                  {isExpanded && (
                    <tr className="bg-slate-50 border-b border-gray-200">
                      <td colSpan={17} className="p-0">
                        <ExpandedLogisticsPanel order={o} setData={setData} pushLog={pushLog} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        <div className="p-3 text-xs text-gray-500 border-t border-gray-200 bg-gray-50 flex items-center justify-between mt-auto">
          <span>Показано {slice.length} из {filtered.length}</span>
          {pages > 1 && (
            <div className="flex gap-1">
              <button onClick={() => setPage(0)} disabled={effectivePage === 0}
                className="px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-30">«</button>
              <button onClick={() => setPage(Math.max(0, effectivePage - 1))} disabled={effectivePage === 0}
                className="px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-30">‹</button>
              {Array.from({ length: pages }, (_, i) => i)
                .filter((i) => Math.abs(i - effectivePage) <= 2 || i === 0 || i === pages - 1)
                .map((i, idx, arr) => (
                  <React.Fragment key={i}>
                    {idx > 0 && arr[idx - 1] !== i - 1 && <span className="px-1 text-gray-400">…</span>}
                    <button onClick={() => setPage(i)}
                      className={`px-2 py-1 rounded border text-xs font-medium ${
                        effectivePage === i ? "bg-[#1E3A5F] text-white border-[#1E3A5F]" : "border-gray-300 text-gray-600 hover:bg-gray-100"
                      }`}>{i + 1}</button>
                  </React.Fragment>
                ))}
              <button onClick={() => setPage(Math.min(pages - 1, effectivePage + 1))} disabled={effectivePage === pages - 1}
                className="px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-30">›</button>
              <button onClick={() => setPage(pages - 1)} disabled={effectivePage === pages - 1}
                className="px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-30">»</button>
                      </div>
                    )}
        </div>
      </div>

      {/* Модал отмены заказа */}
      <Modal isOpen={!!cancelModal} onClose={() => setCancelModal(null)} title={`Отмена заказа — ${cancelModal?.internalPo || ""}`}>
        <div className="space-y-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-300 text-sm">
            <div className="font-medium">Вы собираетесь отменить заказ:</div>
            <div className="text-xs mt-1">{cancelModal?.customer} — {cancelModal?.internalPo} — ${fmt(cancelModal?.customerAmount)}</div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Причина отмены *</label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Укажите причину отмены заказа..."
              className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500 h-24 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setCancelModal(null)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Назад</button>
            <button onClick={cancelOrder} disabled={!cancelReason.trim()}
              className="px-6 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">
              Отменить заказ
            </button>
          </div>
        </div>
      </Modal>

      {/* Модал загрузки УПД */}
      <Modal isOpen={!!updModal} onClose={() => setUpdModal(null)} title={`Загрузка УПД — ${updModal?.internalPo || ""}`}>
        <div className="space-y-4">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-blue-300 text-sm">
            📌 Логист загружает скан УПД. Данные автоматически обновятся в <b>Фин. результат</b> и <b>Дебиторке</b>.
          </div>
          <InputField label="Номер УПД *" value={updForm.num} onChange={(v) => setUpdForm({ ...updForm, num: v })} placeholder="Напр.: 153" disabled={updForm.noGS} />
          <InputField label="Дата УПД *" value={updForm.date} onChange={(v) => setUpdForm({ ...updForm, date: v })} type="date" disabled={updForm.noGS} />
          <div>
            <label className={`text-xs text-slate-400 mb-1 block ${updForm.noGS ? "opacity-40" : ""}`}>Скан УПД (PDF/JPG/PNG) *</label>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setUpdForm({ ...updForm, file: e.target.files[0] })} className={`w-full text-sm text-slate-300 ${updForm.noGS ? "opacity-40" : ""}`} disabled={updForm.noGS} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
            <input type="checkbox" checked={updForm.noGS || false} onChange={(e) => setUpdForm({ ...updForm, noGS: e.target.checked, ...(e.target.checked ? { num: "", date: "", file: null } : {}) })}
              className="accent-blue-500 w-4 h-4 rounded" />
            Заказ без участия Global Smart
          </label>
          <div className="flex justify-end gap-3">
            <button onClick={() => setUpdModal(null)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Отмена</button>
            <button onClick={doUpd} disabled={!updForm.noGS && (!updForm.file || !updForm.num || !updForm.date)}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">
              {updForm.noGS ? "Подтвердить" : "Загрузить"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Модал деталей PO */}
      <Modal isOpen={!!detailModal} onClose={() => setDetailModal(null)} title={`Заказ ${detailModal?.internalPo || ""}`} wide>
        {detailModal && (
          <div className="space-y-4">
            {detailModal.status === "cancelled" && detailModal.cancelReason && (
              <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg text-red-300 text-sm">
                <div className="font-medium">⛔ Заказ отменён</div>
                <div className="text-xs mt-1">{detailModal.cancelReason}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">№</div><div className="text-slate-200">{detailModal.num}</div></div>
              <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Статус</div><StatusBadge status={detailModal.status} /></div>
              <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Customer</div><div className="text-slate-200 font-medium">{detailModal.customer}</div></div>
              <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Resp. Sales</div><div className="text-slate-200">{detailModal.respSales}</div></div>
              <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Internal PO</div><div className="text-slate-200 font-mono">{detailModal.internalPo}</div></div>
              <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Date</div><div className="text-slate-200">{detailModal.dateOrdered}</div></div>
              <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Deadline</div><div className="text-slate-200">{detailModal.customerDeadline || "—"}</div></div>
              <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Terms</div><div className="text-slate-200">{detailModal.termsDelivery || "—"}</div></div>
              <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Customer Amount</div><div className="text-slate-200 font-bold">${fmt(detailModal.customerAmount)}</div></div>
              <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Payment Status</div><div className="text-slate-200">{detailModal.paymentStatusCustomer || "—"}</div></div>
              <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Date Customer Paid</div><div className="text-slate-200 whitespace-pre-wrap">{detailModal.dateCustomerPaid || "—"}</div></div>
              <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">External PO</div><div className="text-slate-200 font-mono whitespace-pre-wrap">{detailModal.internalPoRef || "—"}</div></div>
            </div>
            <div className="border-t border-slate-700/50 pt-4">
              <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">External PO (заказы поставщикам)</div>
              {parseExternalPOs(detailModal).map((ext, ei) => (
                <div key={ei} className={`bg-slate-700/30 rounded-lg p-3 mb-2 grid grid-cols-2 gap-2 text-sm`}>
                  <div><div className="text-slate-500 text-[10px] mb-0.5">External PO</div><div className={`text-slate-200 font-mono ${ext.cancelled ? "line-through text-gray-500" : ""}`}>{ext.po || "—"}{ext.cancelled ? " (отменён)" : ""}</div></div>
                  <div><div className="text-slate-500 text-[10px] mb-0.5">Поставщик</div><div className="text-slate-200">{ext.supplier || "—"}</div></div>
                  <div><div className="text-slate-500 text-[10px] mb-0.5">Сумма ($)</div><div className="text-slate-200 font-bold">{ext.supplierAmount ? "$" + fmt(parseFloat(ext.supplierAmount) || 0) : "—"}</div></div>
                  <div><div className="text-slate-500 text-[10px] mb-0.5">Статус оплаты</div><div className={`font-medium ${(ext.payment || "").toLowerCase().includes("paid") && !(ext.payment || "").toLowerCase().includes("not") ? "text-emerald-400" : "text-amber-400"}`}>{ext.payment || "—"}</div></div>
                  <div><div className="text-slate-500 text-[10px] mb-0.5">Плат. компания</div><div className="text-slate-200">{ext.payingCompany || "—"}</div></div>
                  <div><div className="text-slate-500 text-[10px] mb-0.5">Дата размещения</div><div className="text-slate-200">{ext.datePlaced || "—"}</div></div>
                  <div><div className="text-slate-500 text-[10px] mb-0.5">Resp. Procurement</div><div className="text-slate-200">{ext.respProcurement || "—"}</div></div>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3 text-sm mt-2">
                <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Общая сумма поставщикам</div><div className="text-slate-200 font-bold">${fmt(detailModal.supplierAmount)}</div></div>
                <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Date Paid Supplier</div><div className="text-slate-200 whitespace-pre-wrap">{detailModal.datePaidSupplier || "—"}</div></div>
                <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">Delivery Cost</div><div className="text-slate-200">{detailModal.deliveryCost ? "$" + fmt(detailModal.deliveryCost) : "—"}</div></div>
                <div className="py-2 border-b border-slate-700/30"><div className="text-slate-500 text-xs mb-1">AWB</div><div className="text-slate-200 text-xs whitespace-pre-wrap">{detailModal.awb || "—"}</div></div>
              </div>
            </div>
            {detailModal.comments && (
              <div className="bg-slate-700/30 p-3 rounded-lg text-sm">
                <div className="text-slate-500 text-xs mb-1">Comments</div>
                <div className="text-slate-300 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto">{detailModal.comments}</div>
              </div>
            )}
            {detailModal.noGlobalSmart && (
              <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-lg text-sm text-blue-300">
                🔹 Заказ без участия Global Smart
              </div>
            )}
            {detailModal.hasUpd && !detailModal.noGlobalSmart && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg text-sm text-emerald-300">
                ✅ УПД №{detailModal.updNum} от {detailModal.updDate}
              </div>
            )}
            {detailModal.mgmtComments && (
              <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg text-sm">
                <div className="text-amber-400 text-xs mb-1">Management Comments (УПД)</div>
                <div className="text-amber-200 text-xs whitespace-pre-wrap">{detailModal.mgmtComments}</div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Модал редактирования */}
      <Modal isOpen={!!editModal} onClose={() => setEditModal(null)} title={`Редактирование — ${editModal?.internalPo || ""}`} wide>
        {editModal && (
      <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <InputField label="Customer" value={editForm.customer} onChange={(v) => setEditForm({ ...editForm, customer: v })} />
              <InputField label="Resp. Sales" value={editForm.respSales} onChange={(v) => setEditForm({ ...editForm, respSales: v })} />
              <InputField label="Internal PO" value={editForm.internalPo} onChange={(v) => setEditForm({ ...editForm, internalPo: v })} />
              <InputField label="Customer Amount ($)" value={editForm.customerAmount} onChange={(v) => setEditForm({ ...editForm, customerAmount: parseFloat(v) || 0 })} type="number" />
              <InputField label="Deadline" value={editForm.customerDeadline} onChange={(v) => setEditForm({ ...editForm, customerDeadline: v })} type="date" />
              <InputField label="Terms" value={editForm.termsDelivery} onChange={(v) => setEditForm({ ...editForm, termsDelivery: v })} />
              <InputField label="Payment Status" value={editForm.paymentStatusCustomer} onChange={(v) => setEditForm({ ...editForm, paymentStatusCustomer: v })} />
            </div>

            {/* Блок External PO */}
            <div className="border border-slate-600 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-300">External PO (заказы поставщикам)</span>
                <button onClick={() => setEditForm({ ...editForm, externalOrders: [...(editForm.externalOrders || []), { po: "", supplier: "", supplierAmount: 0, payment: "", payingCompany: "", cancelled: false }] })}
                  className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-medium transition-colors">+ Добавить PO</button>
              </div>
              {(editForm.externalOrders || []).map((ext, ei) => (
                <div key={ei} className="bg-slate-700/40 rounded-lg p-3 relative">
                  {(editForm.externalOrders || []).length > 1 && (
                    <button onClick={() => setEditForm({ ...editForm, externalOrders: editForm.externalOrders.filter((_, i) => i !== ei) })}
                      className="absolute top-2 right-2 text-red-400 hover:text-red-300 text-xs" title="Удалить">✕</button>
                  )}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">External PO #{ei + 1}</span>
                    <label className="text-[10px] text-red-400 flex items-center gap-1 ml-auto">
                      <input type="checkbox" checked={ext.cancelled || false} onChange={(e) => {
                        const upd = [...editForm.externalOrders];
                        if (e.target.checked) {
                          const reason = prompt("Укажите причину отмены External PO:");
                          if (!reason || !reason.trim()) return; // отмена без причины не допускается
                          upd[ei] = { ...upd[ei], cancelled: true, cancelReason: reason.trim() };
                        } else {
                          upd[ei] = { ...upd[ei], cancelled: false, cancelReason: "" };
                        }
                        setEditForm({ ...editForm, externalOrders: upd });
                      }} /> Отменён
                    </label>
                  </div>
                  {ext.cancelled && ext.cancelReason && (
                    <div className="mb-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-xs text-red-300">
                      ⛔ Причина: {ext.cancelReason}
                    </div>
                  )}
                  <div className={`grid grid-cols-2 gap-2 ${ext.cancelled ? "opacity-50" : ""}`}>
                    <InputField label="External PO" value={ext.po} onChange={(v) => {
                      const upd = [...editForm.externalOrders]; upd[ei] = { ...upd[ei], po: v };
                      setEditForm({ ...editForm, externalOrders: upd });
                    }} />
                    <InputField label="Поставщик" value={ext.supplier} onChange={(v) => {
                      const upd = [...editForm.externalOrders]; upd[ei] = { ...upd[ei], supplier: v };
                      setEditForm({ ...editForm, externalOrders: upd });
                    }} />
                    <InputField label="Сумма ($)" value={ext.supplierAmount} onChange={(v) => {
                      const upd = [...editForm.externalOrders]; upd[ei] = { ...upd[ei], supplierAmount: v };
                      setEditForm({ ...editForm, externalOrders: upd });
                    }} type="number" />
                    <InputField label="Статус оплаты" value={ext.payment} onChange={(v) => {
                      const upd = [...editForm.externalOrders]; upd[ei] = { ...upd[ei], payment: v };
                      setEditForm({ ...editForm, externalOrders: upd });
                    }} />
                    <InputField label="Плат. компания" value={ext.payingCompany} onChange={(v) => {
                      const upd = [...editForm.externalOrders]; upd[ei] = { ...upd[ei], payingCompany: v };
                      setEditForm({ ...editForm, externalOrders: upd });
                    }} />
                    <InputField label="Дата размещения" value={ext.datePlaced} onChange={(v) => {
                      const upd = [...editForm.externalOrders]; upd[ei] = { ...upd[ei], datePlaced: v };
                      setEditForm({ ...editForm, externalOrders: upd });
                    }} type="date" />
                    <InputField label="Resp. Procurement" value={ext.respProcurement} onChange={(v) => {
                      const upd = [...editForm.externalOrders]; upd[ei] = { ...upd[ei], respProcurement: v };
                      setEditForm({ ...editForm, externalOrders: upd });
                    }} placeholder="KV, DS, DO..." />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <InputField label="AWB" value={editForm.awb} onChange={(v) => setEditForm({ ...editForm, awb: v })} />
              <InputField label="Tracking" value={editForm.tracking} onChange={(v) => setEditForm({ ...editForm, tracking: v })} />
        </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Comments</label>
              <textarea value={editForm.comments || ""} onChange={(e) => setEditForm({ ...editForm, comments: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 h-20 resize-none" />
      </div>

            {/* Секция УПД */}
            <div className={`border rounded-lg p-3 space-y-2 ${editForm.noGlobalSmart ? "border-blue-500/30 bg-blue-500/5" : editForm.hasUpd ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-600"}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-blue-300">📄 УПД (Универсальный передаточный документ)</h4>
                {editForm.hasUpd && !editForm.noGlobalSmart && (
                  <button onClick={() => setEditForm({ ...editForm, hasUpd: false, noGlobalSmart: false, updNum: "", updDate: "", updFile: null })}
                    className="text-xs text-red-400 hover:text-red-300">✕ Удалить УПД</button>
                )}
              </div>
              <div className="flex items-center gap-4 mb-2">
                <label className="text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={editForm.noGlobalSmart || false}
                    onChange={(e) => setEditForm({ ...editForm, noGlobalSmart: e.target.checked, ...(e.target.checked ? { hasUpd: true, updNum: "Без участия GS", updDate: "", updFile: null } : { hasUpd: false, updNum: "", updDate: "", updFile: null }) })}
                    className="mr-2 accent-blue-500" />
                  Без участия GS
                </label>
                {!editForm.noGlobalSmart && (
                  <label className="text-xs text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={editForm.hasUpd && !editForm.noGlobalSmart}
                      onChange={(e) => setEditForm({ ...editForm, hasUpd: e.target.checked })}
                      className="mr-2" />
                    УПД загружена
                  </label>
                )}
              </div>
              {editForm.noGlobalSmart ? (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-blue-300 text-sm">
                  🔹 Заказ отмечен как «Без участия Global Smart»
                </div>
              ) : editForm.hasUpd ? (
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Номер УПД" value={editForm.updNum} onChange={(v) => setEditForm({ ...editForm, updNum: v })} />
                  <InputField label="Дата УПД" value={editForm.updDate} onChange={(v) => setEditForm({ ...editForm, updDate: v })} type="date" />
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1 block">Файл УПД (скан)</label>
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => setEditForm({ ...editForm, updFile: ev.target.result });
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="w-full text-xs text-slate-300" />
                    {editForm.updFile && <p className="text-xs text-emerald-400 mt-1">✓ Файл прикреплён</p>}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setEditModal(null)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Отмена</button>
              <button onClick={saveEdit} className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors">Сохранить</button>
            </div>
          </div>
        )}
    </Modal>

      {/* Модал добавления нового PO */}
      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Новый заказ (Open PO)" wide>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <InputField label="Customer *" value={newPO.customer} onChange={(v) => setNewPO({ ...newPO, customer: v })} />
            <InputField label="Resp. Sales *" value={newPO.respSales} onChange={(v) => setNewPO({ ...newPO, respSales: v })} placeholder="Напр.: AS, KV, GK" />
            <InputField label="Internal PO *" value={newPO.internalPo} onChange={(v) => setNewPO({ ...newPO, internalPo: v })} placeholder="Напр.: P2812326" />
            <InputField label="Date" value={newPO.dateOrdered} onChange={(v) => setNewPO({ ...newPO, dateOrdered: v })} type="date" />
            <InputField label="Deadline" value={newPO.customerDeadline} onChange={(v) => setNewPO({ ...newPO, customerDeadline: v })} type="date" />
            <InputField label="Terms of Delivery" value={newPO.termsDelivery} onChange={(v) => setNewPO({ ...newPO, termsDelivery: v })} placeholder="DDP MOW / EXW UAE" />
            <InputField label="Customer Amount ($)" value={newPO.customerAmount} onChange={(v) => setNewPO({ ...newPO, customerAmount: v })} type="number" />
            <InputField label="Payment Status" value={newPO.paymentStatusCustomer} onChange={(v) => setNewPO({ ...newPO, paymentStatusCustomer: v })} />
          </div>

          {/* Блок External PO */}
          <div className="border border-slate-600 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-300">External PO (заказы поставщикам)</span>
              <button onClick={() => setNewPO({ ...newPO, externalOrders: [...(newPO.externalOrders || []), { ...emptyExtPO }] })}
                className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-medium transition-colors">+ Добавить PO</button>
            </div>
            {(newPO.externalOrders || []).map((ext, ei) => (
              <div key={ei} className="bg-slate-700/40 rounded-lg p-3 relative">
                {(newPO.externalOrders || []).length > 1 && (
                  <button onClick={() => setNewPO({ ...newPO, externalOrders: newPO.externalOrders.filter((_, i) => i !== ei) })}
                    className="absolute top-2 right-2 text-red-400 hover:text-red-300 text-xs" title="Удалить">✕</button>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">External PO #{ei + 1}</span>
                  <label className="text-[10px] text-red-400 flex items-center gap-1 ml-auto">
                    <input type="checkbox" checked={ext.cancelled || false} onChange={(e) => {
                      const upd = [...newPO.externalOrders];
                      if (e.target.checked) {
                        const reason = prompt("Укажите причину отмены External PO:");
                        if (!reason || !reason.trim()) return;
                        upd[ei] = { ...upd[ei], cancelled: true, cancelReason: reason.trim() };
                      } else {
                        upd[ei] = { ...upd[ei], cancelled: false, cancelReason: "" };
                      }
                      setNewPO({ ...newPO, externalOrders: upd });
                    }} /> Отменён
                  </label>
                </div>
                {ext.cancelled && ext.cancelReason && (
                  <div className="mb-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-xs text-red-300">
                    ⛔ Причина: {ext.cancelReason}
                  </div>
                )}
                <div className={`grid grid-cols-2 gap-2 ${ext.cancelled ? "opacity-50" : ""}`}>
                  <InputField label="External PO *" value={ext.po} onChange={(v) => {
                    const upd = [...newPO.externalOrders]; upd[ei] = { ...upd[ei], po: v };
                    setNewPO({ ...newPO, externalOrders: upd });
                  }} placeholder="PO230xxx" />
                  <InputField label="Поставщик" value={ext.supplier} onChange={(v) => {
                    const upd = [...newPO.externalOrders]; upd[ei] = { ...upd[ei], supplier: v };
                    setNewPO({ ...newPO, externalOrders: upd });
                  }} />
                  <InputField label="Сумма поставщика ($)" value={ext.supplierAmount} onChange={(v) => {
                    const upd = [...newPO.externalOrders]; upd[ei] = { ...upd[ei], supplierAmount: v };
                    setNewPO({ ...newPO, externalOrders: upd });
                  }} type="number" />
                  <InputField label="Статус оплаты" value={ext.payment} onChange={(v) => {
                    const upd = [...newPO.externalOrders]; upd[ei] = { ...upd[ei], payment: v };
                    setNewPO({ ...newPO, externalOrders: upd });
                  }} placeholder="paid / not paid" />
                  <InputField label="Платежная компания" value={ext.payingCompany} onChange={(v) => {
                    const upd = [...newPO.externalOrders]; upd[ei] = { ...upd[ei], payingCompany: v };
                    setNewPO({ ...newPO, externalOrders: upd });
                  }} />
                  <InputField label="Дата размещения" value={ext.datePlaced} onChange={(v) => {
                    const upd = [...newPO.externalOrders]; upd[ei] = { ...upd[ei], datePlaced: v };
                    setNewPO({ ...newPO, externalOrders: upd });
                  }} type="date" />
                  <InputField label="Resp. Procurement" value={ext.respProcurement} onChange={(v) => {
                    const upd = [...newPO.externalOrders]; upd[ei] = { ...upd[ei], respProcurement: v };
                    setNewPO({ ...newPO, externalOrders: upd });
                  }} placeholder="KV, DS, DO..." />
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Тип</label>
              <select value={newPO.type} onChange={(e) => setNewPO({ ...newPO, type: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white">
                <option value="domestic">ROT (Rotable)</option>
                <option value="export">EXP (Expendable)</option>
                <option value="yoon">YOON</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Comments</label>
            <textarea value={newPO.comments} onChange={(e) => setNewPO({ ...newPO, comments: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 h-20 resize-none" />
          </div>
          <InputField label="Management Comments" value={newPO.mgmtComments} onChange={(v) => setNewPO({ ...newPO, mgmtComments: v })} />
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Отмена</button>
            <button onClick={handleAddPO} disabled={!newPO.customer || !newPO.internalPo}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">Создать PO</button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// ==================== ДЕБИТОРСКАЯ ЗАДОЛЖЕННОСТЬ ====================
const Debts = ({ debts, setDebts, pushLog, finResults, setFinResults }) => {
  const [closeModal, setCloseModal] = useState(null);
  const [closeForm, setCloseForm] = useState({ file: null, date: "", comment: "", amount: "" });
  const [addModal, setAddModal] = useState(false);
  const [form, setForm] = useState({ company: "", order: "", amount: 0, dueDate: "", currency: "USD", upd: "" });
  const [viewDoc, setViewDoc] = useState(null);

  const openD = debts.filter((d) => d.status === "open" && d.amount > 0);
  const closedD = debts.filter((d) => d.status === "closed");

  const totalDebt = openD.reduce((s, d) => s + d.amount, 0);
  const overdueItems = openD.filter((d) => d.dueDate && new Date(d.dueDate) < new Date());
  const overdueTotal = overdueItems.reduce((s, d) => s + d.amount, 0);

  const grouped = {};
  openD.forEach((d) => { if (!grouped[d.company]) grouped[d.company] = []; grouped[d.company].push(d); });

  const closeDebt = () => {
    if (!closeModal || !closeForm.file || !closeForm.amount) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const payDocData = e.target.result;
      const payAmount = parseFloat(closeForm.amount) || 0;

      pushLog({ type: "debt_close", id: closeModal.id, prev: { status: "open", payDoc: null, payDate: "", payComment: "" } });
      setDebts((prev) => prev.map((d) => d.id === closeModal.id ? { ...d, status: "closed", payDoc: payDocData, payDate: closeForm.date, payComment: closeForm.comment } : d));

      // Синхронизация: проставляем оплату в Фин. результат по совпадению PO
      if (setFinResults && closeModal.order) {
        setFinResults((prev) => prev.map((fr) => {
          if (fr.customerPo === closeModal.order) {
            return { ...fr, paymentFact: payAmount, paymentDoc: payDocData, paymentDate: closeForm.date };
          }
          return fr;
        }));
      }

      setCloseModal(null);
      setCloseForm({ file: null, date: "", comment: "", amount: "" });
    };
    reader.readAsDataURL(closeForm.file);
  };

  const addDebt = () => {
    setDebts((prev) => [...prev, { ...form, id: Date.now(), amount: parseFloat(form.amount) || 0, status: "open", payDoc: null, payDate: "", payComment: "" }]);
    setAddModal(false);
    setForm({ company: "", order: "", amount: 0, dueDate: "", currency: "RUB", upd: "" });
  };

  return (
    <div className="space-y-4">
      {/* Сводные карточки */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-[#1E3A5F] rounded-xl p-4 border border-[#2A4A6F]">
          <div className="flex items-start justify-between mb-2">
            <span className="text-blue-200/70 text-xs font-medium uppercase tracking-wider">Общая дебиторка</span>
            <span className="text-xl">📋</span>
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">${fmt(totalDebt)}</div>
          <div className="text-xs text-blue-300/60 mt-1">{openD.length} позиций</div>
        </div>
        <div className="bg-[#1E3A5F] rounded-xl p-4 border border-[#2A4A6F]">
          <div className="flex items-start justify-between mb-2">
            <span className="text-blue-200/70 text-xs font-medium uppercase tracking-wider">Просрочено</span>
            <span className="text-xl">⚠️</span>
          </div>
          <div className="text-2xl font-bold text-rose-400 tracking-tight">${fmt(overdueTotal)}</div>
          <div className="text-xs text-blue-300/60 mt-1">{overdueItems.length} позиций</div>
        </div>
    </div>

      {/* Фильтры */}
      <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
          <h2 className="text-lg font-semibold text-[#1E3A5F]">Открытые задолженности</h2>
          <p className="text-xs text-gray-500">Для закрытия долга обязательно приложить платёжный документ из банка.</p>
          </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAddModal(true)} className="px-4 py-2 bg-[#1E3A5F] hover:bg-[#2A4A6F] text-white rounded-lg text-sm font-medium border border-[#2A4A6F] transition-colors">+ Добавить</button>
        </div>
          </div>

      {/* Блоки по компаниям */}
      {Object.keys(grouped).length === 0 && (
        <div className="rounded-xl border border-[#1E3A5F]/20 bg-white p-8 text-center text-gray-400 text-sm">Нет открытых задолженностей</div>
      )}
      {Object.entries(grouped).map(([company, items]) => {
        const companyTotal = items.reduce((s, d) => s + d.amount, 0);
        const companyOverdue = items.filter((d) => d.dueDate && new Date(d.dueDate) < new Date());
        return (
          <div key={company} className="rounded-xl shadow-lg overflow-hidden border border-[#1E3A5F]/30 mb-4">
            {/* Шапка компании */}
            <div className="bg-[#1E3A5F] px-5 py-3 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <h3 className="text-white font-semibold text-sm">{company}</h3>
                <span className="text-blue-200/60 text-xs">{items.length} {items.length === 1 ? "позиция" : "позиций"}</span>
                {companyOverdue.length > 0 && (
                  <span className="px-2 py-0.5 bg-rose-500/30 text-rose-200 text-[10px] font-bold rounded-full">⚠️ {companyOverdue.length} просроч.</span>
                )}
              </div>
              <span className="text-lg font-bold text-white tabular-nums">${fmt(companyTotal)}</span>
            </div>
            {/* Таблица внутри блока */}
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[20%]" />
                <col className="w-[15%]" />
                <col className="w-[10%]" />
                <col className="w-[20%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="bg-[#1E3A5F]/10 text-[#1E3A5F] text-left text-xs uppercase">
                  <th className="py-2 px-4 font-semibold">Заказ</th>
                  <th className="py-2 px-3 font-semibold">УПД</th>
                  <th className="py-2 px-3 text-right font-semibold">Сумма</th>
                  <th className="py-2 px-3 font-semibold">Валюта</th>
                  <th className="py-2 px-3 font-semibold">Срок оплаты</th>
                  <th className="py-2 px-3 font-semibold">Действия</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {items.map((d, idx) => {
                  const overdue = d.dueDate && new Date(d.dueDate) < new Date();
                  return (
                    <tr key={d.id} className={`border-b border-gray-200 transition-colors hover:bg-blue-50 ${overdue ? "bg-red-200" : idx % 2 === 1 ? "bg-gray-50" : ""}`}>
                      <td className="py-2.5 px-4 text-[#1E3A5F] font-mono text-xs font-medium">{d.order}</td>
                      <td className="py-2.5 px-3 text-xs">
                        {d.upd ? <span className="text-violet-600 font-medium">{d.upd}</span> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-mono text-xs font-bold ${overdue ? "text-rose-700" : "text-gray-900"}`}>${fmt(d.amount)}</td>
                      <td className="py-2.5 px-3 text-gray-600 text-xs">{d.currency}</td>
                      <td className="py-2.5 px-3 text-xs">
                        {d.dueDate ? (
                          <span className={overdue ? "text-rose-700 font-bold" : "text-gray-600"}>{d.dueDate} {overdue && "⚠️"}</span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2.5 px-3">
                        <button onClick={() => { setCloseModal(d); setCloseForm({ file: null, date: "", comment: "", amount: String(d.amount || "") }); }} className="px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg text-xs font-medium border border-emerald-300 transition-colors">✅ Закрыть</button>
                      </td>
                    </tr>
                );
              })}
              </tbody>
            </table>
            </div>
        );
      })}

      {/* Закрытые */}
      {closedD.length > 0 && (
        <div>
          <h3 className="text-emerald-700 font-medium text-sm mb-2">✅ Закрытые ({closedD.length})</h3>
          <div className="rounded-xl shadow-sm overflow-hidden border border-emerald-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-emerald-50 text-emerald-800 text-left text-xs uppercase">
                  <th className="py-2.5 px-4 font-semibold">Компания</th>
                  <th className="py-2.5 px-3 font-semibold">Заказ</th>
                  <th className="py-2.5 px-3 text-right font-semibold">Сумма</th>
                  <th className="py-2.5 px-3 font-semibold">Дата закрытия</th>
                  <th className="py-2.5 px-3 font-semibold">Документ</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {closedD.map((d, idx) => (
                  <tr key={d.id} className={`border-b border-gray-100 ${idx % 2 === 1 ? "bg-gray-50" : ""}`}>
                    <td className="py-2 px-4 text-gray-700 font-medium text-xs">{d.company}</td>
                    <td className="py-2 px-3 text-gray-500 text-xs">{d.order}</td>
                    <td className="py-2 px-3 text-right text-emerald-600 font-mono text-xs line-through">{fmt(d.amount)} {d.currency}</td>
                    <td className="py-2 px-3 text-gray-500 text-xs">{d.payDate || "—"}</td>
                    <td className="py-2 px-3">
                      {d.payDoc ? (
                        <button onClick={() => setViewDoc(d)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">📎 Документ</button>
                      ) : <span className="text-gray-400 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
    </div>
        </div>
      )}

      <Modal isOpen={!!closeModal} onClose={() => setCloseModal(null)} title="Закрытие задолженности">
        <div className="space-y-4">
          {closeModal && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-sm">
              <div className="text-white font-medium">{closeModal.company} — заказ {closeModal.order}</div>
              <div className="text-white text-xs mt-1">Сумма долга: <span className="font-bold text-rose-400">${fmt(closeModal.amount)}</span> {closeModal.currency}</div>
              <div className="text-rose-400 font-medium mt-2 text-xs">⚠ Для закрытия ОБЯЗАТЕЛЬНО приложите банковский платёжный документ!</div>
              <div className="text-blue-300 text-xs mt-1">💡 Оплата автоматически проставится в Фин. результат</div>
            </div>
          )}
          <InputField label="Сумма оплаты *" value={closeForm.amount} onChange={(v) => setCloseForm({ ...closeForm, amount: v })} type="number" placeholder="Сумма в валюте долга" />
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Платёжный документ (PDF/JPG) *</label>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setCloseForm({ ...closeForm, file: e.target.files[0] })} className="w-full text-sm text-slate-300" />
            {!closeForm.file && <p className="text-xs text-rose-400 mt-1">Без документа закрыть нельзя!</p>}
          </div>
          <InputField label="Дата оплаты *" value={closeForm.date} onChange={(v) => setCloseForm({ ...closeForm, date: v })} type="date" />
          <InputField label="Комментарий" value={closeForm.comment} onChange={(v) => setCloseForm({ ...closeForm, comment: v })} />
          <div className="flex justify-end gap-3">
            <button onClick={() => setCloseModal(null)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Отмена</button>
            <button onClick={closeDebt} disabled={!closeForm.file || !closeForm.date || !closeForm.amount} className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">✅ Закрыть долг</button>
        </div>
      </div>
    </Modal>

      <Modal isOpen={addModal} onClose={() => setAddModal(false)} title="Новая задолженность">
        <div className="space-y-4">
          <InputField label="Компания" value={form.company} onChange={(v) => setForm({ ...form, company: v })} />
          <InputField label="Номер заказа" value={form.order} onChange={(v) => setForm({ ...form, order: v })} />
          <InputField label="Сумма" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} type="number" />
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Валюта</label>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white">
              {["RUB", "USD", "EUR", "AED", "BAT"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <InputField label="Срок оплаты" value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} type="date" />
          <InputField label="УПД" value={form.upd} onChange={(v) => setForm({ ...form, upd: v })} />
          <div className="flex justify-end gap-3">
            <button onClick={() => setAddModal(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Отмена</button>
            <button onClick={addDebt} className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors">Добавить</button>
        </div>
      </div>
    </Modal>

      <Modal isOpen={!!viewDoc} onClose={() => setViewDoc(null)} title="Платёжный документ" wide>
        {viewDoc && viewDoc.payDoc && (
          <div>
            <p className="text-slate-400 text-sm mb-3">{viewDoc.company} — {viewDoc.order} — Закрыт: {viewDoc.payDate}</p>
            {viewDoc.payDoc.startsWith("data:image") ? <img src={viewDoc.payDoc} alt="Платёжка" className="max-w-full rounded-lg" /> : <a href={viewDoc.payDoc} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Открыть PDF</a>}
            {viewDoc.payComment && <p className="mt-3 text-slate-400 text-sm">Комментарий: {viewDoc.payComment}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
};

// ==================== ИНФРАСТРУКТУРЫ ====================
const Infrastructure = ({ balances, setBalances, pushLog }) => {
  const [selectedAcc, setSelectedAcc] = useState(null);
  const [showPayment, setShowPayment] = useState(false);
  const [payment, setPayment] = useState({ acc: "", type: "income", amount: 0, desc: "", date: new Date().toISOString().split("T")[0] });

  const processPayment = () => {
    const amt = parseFloat(payment.amount) || 0;
    if (!payment.acc || !amt) return;
    pushLog({ type: "infra_payment", accName: payment.acc, prev: balances.find((b) => b.name === payment.acc)?.balance || 0 });
    setBalances((prev) => prev.map((b) => b.name === payment.acc ? { ...b, balance: payment.type === "income" ? b.balance + amt : b.balance - amt } : b));
    setShowPayment(false);
    setPayment({ acc: "", type: "income", amount: 0, desc: "", date: new Date().toISOString().split("T")[0] });
  };

  const safes = balances.filter((b) => b.name.includes("Сейф") || b.name.includes("Crypto"));
  const accounts = balances.filter((b) => !b.name.includes("Сейф") && !b.name.includes("Crypto"));
  const accOps = selectedAcc ? (INFRA_DATA[selectedAcc] || []) : [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div><h2 className="text-lg font-semibold text-white">Инфраструктуры и остатки</h2><p className="text-xs text-slate-500">Балансы и операции по каждому счёту</p></div>
        <button onClick={() => setShowPayment(true)} className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg text-sm font-medium border border-emerald-500/30 transition-colors">💳 Провести платёж</button>
    </div>

      {safes.length > 0 && (
        <div>
          <h3 className="text-slate-400 font-medium text-sm mb-2">Сейф / Crypto</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {safes.map((b) => (
              <Card key={b.id} className={`p-4 hover:border-blue-500/30 transition-all ${selectedAcc === b.name ? "border-blue-500/50 bg-blue-500/5" : ""}`} onClick={() => setSelectedAcc(b.name)}>
                <h4 className="text-white font-semibold text-sm mb-2">{b.name}</h4>
                <div className={`text-xl font-bold ${b.balance < 0 ? "text-red-400" : "text-emerald-400"}`}>{fmt(b.balance)} {b.currency}</div>
              </Card>
            ))}
    </div>
        </div>
      )}

      <div>
        <h3 className="text-slate-400 font-medium text-sm mb-2">Банковские счета</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((b) => (
            <Card key={b.id} className={`p-4 hover:border-blue-500/30 transition-all ${selectedAcc === b.name ? "border-blue-500/50 bg-blue-500/5" : ""}`} onClick={() => setSelectedAcc(b.name)}>
              <h4 className="text-white font-semibold text-sm mb-2">{b.name}</h4>
              <div className={`text-xl font-bold ${b.balance < 0 ? "text-red-400" : "text-emerald-400"}`}>{fmt(b.balance)} {b.currency}</div>
            </Card>
          ))}
        </div>
      </div>

      {selectedAcc && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Операции: {selectedAcc}</h3>
            <button onClick={() => setSelectedAcc(null)} className="text-slate-400 hover:text-white text-xl">&times;</button>
          </div>
          {accOps.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-slate-400 text-xs uppercase border-b border-slate-700">
                  <th className="py-2 px-2 text-left">PO</th>
                  <th className="py-2 px-2 text-right">Приход</th>
                  <th className="py-2 px-2 text-right">Расход</th>
                  <th className="py-2 px-2 text-right">Комиссии</th>
                  <th className="py-2 px-2 text-left">Поставщик</th>
                  <th className="py-2 px-2 text-left">Инвойс</th>
                  <th className="py-2 px-2 text-left">Дата</th>
                  <th className="py-2 px-2 text-right">Остаток</th>
                </tr></thead>
                <tbody>{accOps.map((op) => (
                  <tr key={op.id} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                    <td className="py-2 px-2 text-slate-300 font-mono text-xs">{op.poRef || (op.description ? <span className="text-blue-300 italic">{op.description}</span> : "—")}</td>
                    <td className="py-2 px-2 text-right text-emerald-400">{op.received ? "+" + fmt(op.received) : ""}</td>
                    <td className="py-2 px-2 text-right text-red-400">{op.outgoing ? "-" + fmt(op.outgoing) : ""}</td>
                    <td className="py-2 px-2 text-right text-amber-400 text-xs">{op.bankFees ? fmt(op.bankFees) : ""}</td>
                    <td className="py-2 px-2 text-slate-300 text-xs max-w-[150px] whitespace-pre-line">{op.supplier || "—"}</td>
                    <td className="py-2 px-2 text-slate-400 font-mono text-xs">{op.invoice || "—"}</td>
                    <td className="py-2 px-2 text-slate-400 text-xs whitespace-nowrap">{op.date || "—"}</td>
                    <td className="py-2 px-2 text-right font-medium"><span className={op.balance < 0 ? "text-red-400" : "text-white"}>{op.balance !== 0 ? fmt(op.balance) : "—"}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="text-slate-500 text-sm">Нет данных об операциях</div>}
        </Card>
      )}

      <Modal isOpen={showPayment} onClose={() => setShowPayment(false)} title="Провести платёж">
        <div className="space-y-4">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-blue-300 text-sm">💡 Платёж обновит остаток выбранной инфраструктуры</div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Счёт</label>
            <select value={payment.acc} onChange={(e) => setPayment({ ...payment, acc: e.target.value })} className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white">
            <option value="">Выберите...</option>
              {balances.map((b) => <option key={b.id} value={b.name}>{b.name} ({b.currency})</option>)}
            </select>
        </div>
          <div className="grid grid-cols-2 gap-4">
            {["income", "expense"].map((t) => (
              <button key={t} onClick={() => setPayment({ ...payment, type: t })}
                className={`py-2 rounded-lg text-sm font-medium transition-colors border ${payment.type === t ? (t === "income" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-rose-500/20 text-rose-300 border-rose-500/30") : "bg-slate-700/50 text-slate-400 border-slate-600 hover:bg-slate-700"}`}>
                {t === "income" ? "Приход" : "Расход"}
              </button>
            ))}
          </div>
          <InputField label="Сумма" value={payment.amount} onChange={(v) => setPayment({ ...payment, amount: v })} type="number" />
          <InputField label="Описание" value={payment.desc} onChange={(v) => setPayment({ ...payment, desc: v })} />
          <InputField label="Дата" value={payment.date} onChange={(v) => setPayment({ ...payment, date: v })} type="date" />
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowPayment(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Отмена</button>
            <button onClick={processPayment} className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors">Провести</button>
        </div>
      </div>
    </Modal>
    </div>
  );
};

// ==================== ИМПОРТ БАНКОВСКИХ ПЛАТЕЖЕЙ ====================
const BankImport = ({ balances, setBalances }) => {
  const [csvText, setCsvText] = useState("");
  const [parsedRows, setParsedRows] = useState([]);

  const parseCSV = () => {
    const lines = csvText.trim().split("\n");
    if (lines.length < 2) return;
    const headers = lines[0].split(";").map((h) => h.trim());
    const rows = lines.slice(1).map((line, i) => {
      const cols = line.split(";").map((c) => c.trim());
      const obj = {};
      headers.forEach((h, j) => (obj[h] = cols[j] || ""));
      obj._id = i; obj._infra = ""; obj._type = "expense";
      return obj;
    });
    setParsedRows(rows);
  };

  const updateRow = (id, field, value) => setParsedRows(parsedRows.map((r) => (r._id === id ? { ...r, [field]: value } : r)));

  const importAll = () => {
    const newBalances = [...balances];
    parsedRows.forEach((row) => {
      if (!row._infra) return;
      const amount = parseFloat(Object.values(row).find((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0)) || 0;
      if (!amount) return;
      const bIdx = newBalances.findIndex((b) => b.name === row._infra);
      if (bIdx >= 0) newBalances[bIdx] = { ...newBalances[bIdx], balance: newBalances[bIdx].balance + (row._type === "income" ? amount : -amount) };
    });
    setBalances(newBalances);
    setParsedRows([]);
    setCsvText("");
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><span className="text-emerald-400">💳</span> Импорт банковских платёжек</h3>
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-4 text-sm text-blue-300">
          <p className="font-medium mb-2">Инструкция:</p>
          <p>1. Скопируйте данные из банковской выписки (CSV; разделитель — точка с запятой)</p>
          <p>2. Нажмите «Распарсить» → Назначьте инфраструктуру и тип → «Импортировать»</p>
        </div>
        <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)}
          placeholder={"Дата;Описание;Сумма;Валюта\n2026-03-01;Оплата WENCOR;3500;USD"}
          className="w-full h-32 px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none" />
        <div className="flex justify-end mt-3">
          <button onClick={parseCSV} className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg text-sm font-medium border border-blue-500/30">Распарсить</button>
        </div>
      </Card>

      {parsedRows.length > 0 && (
        <Card className="p-5">
          <h3 className="text-white font-semibold mb-4">Распознанные операции ({parsedRows.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-400 text-xs border-b border-slate-700">
                {Object.keys(parsedRows[0]).filter((k) => !k.startsWith("_")).map((h) => <th key={h} className="py-2 px-2 text-left">{h}</th>)}
                <th className="py-2 px-2">Инфраструктура</th><th className="py-2 px-2">Тип</th>
              </tr></thead>
              <tbody>{parsedRows.map((row) => (
                <tr key={row._id} className="border-b border-slate-700/30">
                  {Object.entries(row).filter(([k]) => !k.startsWith("_")).map(([k, v]) => <td key={k} className="py-2 px-2 text-slate-300 text-xs">{v}</td>)}
                  <td className="py-2 px-2">
                    <select value={row._infra} onChange={(e) => updateRow(row._id, "_infra", e.target.value)} className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white">
                      <option value="">—</option>{balances.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
                    </select>
                  </td>
                  <td className="py-2 px-2">
                    <select value={row._type} onChange={(e) => updateRow(row._id, "_type", e.target.value)} className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-white">
                      <option value="income">Приход</option><option value="expense">Расход</option>
                    </select>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={importAll} className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors">Импортировать</button>
          </div>
        </Card>
      )}
    </div>
  );
};

// ==================== MAIN APP ====================
export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [balances, setBalances] = useState(BALANCES_DATA);
  const [debts, setDebts] = useState(DEBTS_DATA);
  const [finResults, setFinResults] = useState(FIN_DATA);
  const [openPo, setOpenPo] = useState(() => PO_DATA.map((r) => ({
    ...r,
    orderStage: r.orderStage || (r.status === "completed" ? "done" : r.status === "cancelled" ? "cancelled" : "in_work"),
  })));
  const [actionLog, setActionLog] = useState([]);

  const pushLog = useCallback((a) => setActionLog((prev) => [...prev, a]), []);

  const undo = () => {
    if (!actionLog.length) return;
    const last = actionLog[actionLog.length - 1];
    if (last.type === "fin_status") setFinResults((prev) => prev.map((r) => (r.id === last.id ? { ...r, status: last.prev } : r)));
    if (last.type === "fin_upd") setFinResults((prev) => prev.map((r) => (r.id === last.id ? { ...r, ...last.prev, updFile: null } : r)));
    if (last.type === "fin_payment") setFinResults((prev) => prev.map((r) => (r.id === last.id ? { ...r, paymentFact: last.prev.paymentFact, paymentDoc: null, paymentDate: "" } : r)));
    if (last.type === "fin_edit") setFinResults((prev) => prev.map((r) => (r.id === last.id ? { ...last.prev } : r)));
    if (last.type === "fin_delete") setFinResults((prev) => [...prev, last.prev]);
    if (last.type === "po_status" || last.type === "po_cancel") setOpenPo((prev) => prev.map((r) => (r.id === last.id ? { ...r, status: last.prev?.status || last.prev, cancelReason: last.prev?.cancelReason || "" } : r)));
    if (last.type === "po_upd") setOpenPo((prev) => prev.map((r) => (r.id === last.id ? { ...r, ...last.prev, updFile: null } : r)));
    if (last.type === "po_edit") setOpenPo((prev) => prev.map((r) => (r.id === last.id ? { ...last.prev } : r)));
    if (last.type === "po_inline_edit") setOpenPo((prev) => prev.map((r) => (r.id === last.id ? { ...r, [last.field]: last.prev } : r)));
    if (last.type === "po_logistics") setOpenPo((prev) => prev.map((r) => (r.id === last.id ? { ...r, ...last.prev } : r)));
    if (last.type === "po_stage") setOpenPo((prev) => prev.map((r) => (r.id === last.id ? { ...r, orderStage: last.prev, status: last.prevStatus || "active" } : r)));
    if (last.type === "po_delete") setOpenPo((prev) => [...prev, last.prev]);
    if (last.type === "debt_close") setDebts((prev) => prev.map((d) => (d.id === last.id ? { ...d, ...last.prev } : d)));
    if (last.type === "infra_payment") setBalances((prev) => prev.map((b) => (b.name === last.accName ? { ...b, balance: last.prev } : b)));
    setActionLog((prev) => prev.slice(0, -1));
  };

  const activePO = openPo.filter((r) => r.status === "active").length;
  const openDebts = debts.filter((d) => d.status === "open" && d.amount > 0).length;

  const tabs = [
    { key: "dashboard", label: "Баланс", icon: "💰" },
    { key: "fin", label: `Фин. результат (${finResults.length})`, icon: "💰" },
    { key: "openpo", label: `Open PO (${openPo.length})`, icon: "📋" },
    { key: "debts", label: `Дебиторка (${openDebts})`, icon: "⚠" },
    { key: "infra", label: `Инфраструктуры (${balances.length})`, icon: "🏦" },
    { key: "import", label: "Импорт платежей", icon: "💳" },
  ];

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Левая навигационная панель в стиле RetailCRM */}
      <div className="w-64 bg-[#1E3A5F] text-white flex flex-col fixed left-0 top-0 bottom-0">
        {/* Логотип и заголовок */}
        <div className="p-4 border-b border-[#2A4A6F]">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-white rounded flex items-center justify-center">
              <span className="text-[#1E3A5F] font-bold text-lg">G</span>
        </div>
            <span className="font-semibold text-sm">Финансы</span>
      </div>
        </div>

        {/* Навигационное меню */}
        <div className="flex-1 overflow-y-auto py-2">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`w-full px-4 py-2.5 text-left flex items-center gap-3 text-sm transition-colors ${
              activeTab === "dashboard" ? "bg-[#2A4A6F] text-white" : "text-gray-300 hover:bg-[#2A4A6F]/50"
            }`}
          >
            <span className="text-lg">📊</span>
            <span>Баланс</span>
          </button>
          <button
            onClick={() => setActiveTab("fin")}
            className={`w-full px-4 py-2.5 text-left flex items-center gap-3 text-sm transition-colors ${
              activeTab === "fin" ? "bg-[#2A4A6F] text-white" : "text-gray-300 hover:bg-[#2A4A6F]/50"
            }`}
          >
            <span className="text-lg">💰</span>
            <span>Фин. результат</span>
          </button>
          <button
            onClick={() => setActiveTab("openpo")}
            className={`w-full px-4 py-2.5 text-left flex items-center gap-3 text-sm transition-colors ${
              activeTab === "openpo" ? "bg-[#2A4A6F] text-white" : "text-gray-300 hover:bg-[#2A4A6F]/50"
            }`}
          >
            <span className="text-lg">📋</span>
            <span>Open PO</span>
          </button>
          <button
            onClick={() => setActiveTab("debts")}
            className={`w-full px-4 py-2.5 text-left flex items-center gap-3 text-sm transition-colors ${
              activeTab === "debts" ? "bg-[#2A4A6F] text-white" : "text-gray-300 hover:bg-[#2A4A6F]/50"
            }`}
          >
            <span className="text-lg">⚠</span>
            <span>Дебиторка</span>
          </button>
          <button
            onClick={() => setActiveTab("infra")}
            className={`w-full px-4 py-2.5 text-left flex items-center gap-3 text-sm transition-colors ${
              activeTab === "infra" ? "bg-[#2A4A6F] text-white" : "text-gray-300 hover:bg-[#2A4A6F]/50"
            }`}
          >
            <span className="text-lg">🏦</span>
            <span>Инфраструктуры</span>
          </button>
          <button
            onClick={() => setActiveTab("import")}
            className={`w-full px-4 py-2.5 text-left flex items-center gap-3 text-sm transition-colors ${
              activeTab === "import" ? "bg-[#2A4A6F] text-white" : "text-gray-300 hover:bg-[#2A4A6F]/50"
            }`}
          >
            <span className="text-lg">💳</span>
            <span>Импорт платежей</span>
          </button>
        </div>

        {/* Нижняя панель */}
        <div className="border-t border-[#2A4A6F] p-4 flex items-center justify-between">
          <div className="w-8 h-8 bg-[#2A4A6F] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#3A5A7F]">
            <span className="text-sm">🔔</span>
          </div>
          <div className="w-8 h-8 bg-[#2A4A6F] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#3A5A7F]">
            <span className="text-sm">⚙</span>
          </div>
          <div className="w-8 h-8 bg-[#2A4A6F] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#3A5A7F]">
            <span className="text-sm">?</span>
          </div>
          <div className="w-8 h-8 bg-[#2A4A6F] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#3A5A7F]">
            <span className="text-xs font-semibold">K</span>
          </div>
        </div>
      </div>

      {/* Основной контент */}
      <div className="flex-1 ml-64 bg-gray-50 min-h-screen">
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-gray-900">
              {activeTab === "dashboard" && "Баланс"}
              {activeTab === "fin" && "Фин. результат"}
              {activeTab === "openpo" && "Open PO"}
              {activeTab === "debts" && "Дебиторка"}
              {activeTab === "infra" && "Инфраструктуры"}
              {activeTab === "import" && "Импорт платежей"}
            </h1>
            <div className="flex items-center gap-3">
              {actionLog.length > 0 && (
                <button onClick={undo} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-sm font-medium flex items-center gap-2 transition-colors">
                  ↩ Отменить ({actionLog.length})
                </button>
              )}
              <div className="text-xs text-gray-500">{new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</div>
            </div>
          </div>
        </div>

        <div className="p-6">
          {activeTab === "dashboard" && <Dashboard balances={balances} debts={debts} finResults={finResults} />}
          {activeTab === "fin" && <FinResults data={finResults} setData={setFinResults} pushLog={pushLog} debts={debts} setDebts={setDebts} />}
          {activeTab === "openpo" && <OpenPO data={openPo} setData={setOpenPo} pushLog={pushLog} finResults={finResults} setFinResults={setFinResults} />}
          {activeTab === "debts" && <Debts debts={debts} setDebts={setDebts} pushLog={pushLog} finResults={finResults} setFinResults={setFinResults} />}
          {activeTab === "infra" && <Infrastructure balances={balances} setBalances={setBalances} pushLog={pushLog} />}
          {activeTab === "import" && <BankImport balances={balances} setBalances={setBalances} />}
        </div>
      </div>
    </div>
  );
}
