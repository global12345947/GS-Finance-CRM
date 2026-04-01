import React, { useState, useMemo, useCallback, useEffect } from "react";
import * as api from "./api.js";

// ==================== УТИЛИТЫ ====================
const downloadFile = (fileIdOrBase64, fileName) => {
  if (!fileIdOrBase64) return;
  const link = document.createElement("a");
  if (fileIdOrBase64.startsWith("data:")) {
    link.href = fileIdOrBase64;
  } else {
    link.href = api.getFileUrl(fileIdOrBase64);
  }
  link.download = fileName || "document";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

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

  const confirmComplete = async () => {
    const hasUpd = !!(updForm.updNum && updForm.updDate && updForm.updFile);
    if (!hasUpd && !updForm.noGS) return;

    pushLog({ type: "po_stage", id: order.id, prev: order.orderStage || "", prevStatus: order.status || "active" });
    const updates = { orderStage: "done", status: "completed" };

    if (updForm.noGS) {
      updates.noGlobalSmart = true;
      updates.hasUpd = true;
      updates.updNum = "Без участия GS";
      updates.updDate = "";
      updates.updFileId = null;
    } else {
      try {
        const uploaded = await api.uploadFile(updForm.updFile, "upd", order.id);
        updates.hasUpd = true;
        updates.updNum = updForm.updNum;
        updates.updDate = updForm.updDate;
        updates.updFileId = uploaded.id;
        updates.noGlobalSmart = false;
      } catch (err) {
        console.error("Ошибка загрузки УПД:", err);
        return;
      }
    }
    setData((prev) => prev.map((r) => (r.id === order.id ? { ...r, ...updates } : r)));
    if (syncUpdToFinResults) {
      syncUpdToFinResults(order.internalPo, true, updates.updNum, updates.updDate, updates.updFileId, updates.noGlobalSmart);
    }
    setCompleteModal(false);
  };

  const canComplete = !!(updForm.updNum && updForm.updDate && updForm.updFile) || updForm.noGS;

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
              <div className={`p-3 rounded-lg border ${updForm.noGS ? "border-slate-700 opacity-40 pointer-events-none" : "border-slate-600"}`}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Номер УПД {!updForm.noGS && "*"}</label>
                    <input type="text" value={updForm.updNum} onChange={(e) => setUpdForm({ ...updForm, updNum: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                      placeholder="Напр.: 123" disabled={updForm.noGS} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Дата УПД {!updForm.noGS && "*"}</label>
                    <input type="date" value={updForm.updDate} onChange={(e) => setUpdForm({ ...updForm, updDate: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500" disabled={updForm.noGS} />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="text-xs text-slate-400 mb-1 block">Скан УПД (PDF/JPG/PNG) {!updForm.noGS && "*"}</label>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      setUpdForm((f) => ({ ...f, updFile: file }));
                    }}
                    className="w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-blue-500 file:text-white file:cursor-pointer hover:file:bg-blue-600" disabled={updForm.noGS} />
                  {!updForm.updFile && !updForm.noGS && (
                    <p className="text-[10px] text-rose-400 mt-1">⚠ Без скана УПД заказ завершить нельзя</p>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-lg border border-slate-700 bg-slate-800/50">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input type="checkbox" checked={updForm.noGS} onChange={(e) => setUpdForm({ ...updForm, noGS: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0" />
                  <span className="text-sm text-white font-medium">Заказ без участия Global Smart</span>
                </label>
                <p className="text-[10px] text-slate-500 mt-1 ml-7">УПД не требуется для заказов, выполненных минуя GS</p>
              </div>
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
  const logistics = (order.logisticsPlan || "").split("\n").map((s) => s.trim()).filter(Boolean);
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
      logisticsPlan: logistics[i] || (logistics.length === 1 ? logistics[0] : ""),
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

// ==================== ФИЛЬТР КОЛОНОК (Google Sheets style) ====================
const getPoFilterValue = (o, colKey) => {
  switch (colKey) {
    case "num": return [o.num || "(пусто)"];
    case "customer": return [o.customer || "(пусто)"];
    case "internalPo": return [o.internalPo || "(пусто)"];
    case "dateOrdered": return [o.dateOrdered || "(пусто)"];
    case "customerDeadline": return [o.customerDeadline || "(пусто)"];
    case "customerAmount": return [o.customerAmount ? "$" + fmt(o.customerAmount) : "(пусто)"];
    case "paymentStatusCustomer": return [o.paymentStatusCustomer || "(пусто)"];
    case "dateCustomerPaid": return [o.dateCustomerPaid || "(пусто)"];
    case "internalPoRef": {
      const vals = (o.internalPoRef || "").split("\n").map((s) => s.trim()).filter(Boolean);
      return vals.length ? vals : ["(пусто)"];
    }
    case "supplierName": {
      const vals = (o.supplierName || "").split("\n").map((s) => s.trim()).filter(Boolean);
      return vals.length ? vals : ["(пусто)"];
    }
    case "supplierAmount": return [o.supplierAmount ? "$" + fmt(o.supplierAmount) : "(пусто)"];
    case "paymentStatusSupplier": {
      const vals = (o.paymentStatusSupplier || "").split("\n").map((s) => s.trim()).filter(Boolean);
      return vals.length ? vals : ["(пусто)"];
    }
    case "datePaidSupplier": return [o.datePaidSupplier || "(пусто)"];
    case "payingCompany": {
      const vals = (o.payingCompany || "").split("\n").map((s) => s.trim()).filter(Boolean);
      return vals.length ? vals : ["(пусто)"];
    }
    case "deliveryPlan": return [o.logisticsPlan || "(пусто)"];
    case "orderStage": {
      const s = ORDER_STAGES.find((st) => st.key === o.orderStage);
      return [s ? s.label : "(не указана)"];
    }
    case "upd": return [o.noGlobalSmart ? "Без участия GS" : o.hasUpd ? "Есть УПД" : "Нет УПД"];
    default: return ["(пусто)"];
  }
};

const ColumnFilterDropdown = ({ values, selected, onApply, onClear, onClose }) => {
  const [search, setSearch] = useState("");
  const [localSelected, setLocalSelected] = useState(() => new Set(selected || []));
  const dropRef = React.useRef(null);

  React.useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = search
    ? values.filter((v) => v.toLowerCase().includes(search.toLowerCase()))
    : values;
  const allChecked = filtered.length > 0 && filtered.every((v) => localSelected.has(v));

  const toggleAll = () => {
    const next = new Set(localSelected);
    if (allChecked) filtered.forEach((v) => next.delete(v));
    else filtered.forEach((v) => next.add(v));
    setLocalSelected(next);
  };

  const toggle = (v) => {
    const next = new Set(localSelected);
    if (next.has(v)) next.delete(v); else next.add(v);
    setLocalSelected(next);
  };

  return (
    <div ref={dropRef} onClick={(e) => e.stopPropagation()}
      className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-2xl border border-gray-200 z-[200] min-w-[220px] max-w-[320px]"
      style={{ maxHeight: "360px" }}>
      <div className="p-2 border-b border-gray-100">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск..."
          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:border-blue-400 text-gray-700"
          autoFocus />
      </div>
      <div className="px-2 py-1.5 border-b border-gray-100">
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer hover:text-gray-900 select-none">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} className="rounded accent-[#1E3A5F]" />
          Выбрать все ({filtered.length})
        </label>
      </div>
      <div className="overflow-y-auto p-1" style={{ maxHeight: "220px" }}>
        {filtered.map((v) => (
          <label key={v} className="flex items-center gap-2 px-2 py-1 text-xs text-gray-700 cursor-pointer hover:bg-gray-50 rounded select-none">
            <input type="checkbox" checked={localSelected.has(v)} onChange={() => toggle(v)} className="rounded accent-[#1E3A5F]" />
            <span className="truncate">{v}</span>
          </label>
        ))}
        {filtered.length === 0 && <div className="text-xs text-gray-400 px-2 py-3 text-center">Нет совпадений</div>}
      </div>
      <div className="flex items-center justify-between p-2 border-t border-gray-100 gap-2">
        <button onClick={() => { onClear(); onClose(); }}
          className="px-3 py-1.5 text-xs text-gray-500 hover:text-red-600 transition-colors">Сбросить</button>
        <button onClick={() => { onApply(localSelected); onClose(); }}
          className="px-4 py-1.5 bg-[#1E3A5F] text-white text-xs rounded-md hover:bg-[#2A4A6F] font-medium transition-colors">OK</button>
      </div>
    </div>
  );
};

const getFinFilterValue = (o, colKey) => {
  switch (colKey) {
    case "type": return [o.type === "domestic" ? "ROT" : o.type === "export" ? "EXP" : o.type || "(пусто)"];
    case "customer": return [o.customer || "(пусто)"];
    case "customerPo": return [o.customerPo || "(пусто)"];
    case "orderDate": return [o.orderDate || "(пусто)"];
    case "customerAmount": return [o.customerAmount ? "$" + fmt(o.customerAmount) : "(пусто)"];
    case "upd": return [o.noGlobalSmart ? "Без участия GS" : o.hasUpd ? "Есть УПД" : "Нет УПД"];
    case "paymentFact": return [o.paymentFact > 0 ? "Оплачено" : "Не оплачено"];
    case "supplierPo": return [o.supplierPo || "(пусто)"];
    case "supplierAmount": return [o.supplierAmount ? "$" + fmt(o.supplierAmount) : "(пусто)"];
    case "supplier": return [o.supplier || "(пусто)"];
    case "finalBuyer": return [o.finalBuyer || "(пусто)"];
    case "status": {
      const s = FIN_STAGES.find((st) => st.key === o.status);
      return [s ? s.label : "(не указан)"];
    }
    default: return ["(пусто)"];
  }
};

// ==================== АВТО-ДЕБИТОРКА (из Фин. результат) ====================
// Заказы с УПД, но без оплаты — автоматически попадают в дебиторку

// Парсим NET дни из paymentStatusCustomer (NET 5, NET 7, NET 10, NET 30)
const parseNetDays = (paymentStatus) => {
  if (!paymentStatus) return 0;
  const match = paymentStatus.match(/NET\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
};

// Считаем дату оплаты: дата УПД + NET дней
const calcDueDate = (updDate, netDays) => {
  if (!updDate || !netDays) return "";
  // Парсим дату (формат DD.MM.YYYY или YYYY-MM-DD)
  let d;
  if (updDate.includes(".")) {
    const [day, month, year] = updDate.split(".");
    d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  } else {
    d = new Date(updDate);
  }
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + netDays);
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
};

// Считаем дни до/после срока
const calcDaysRemaining = (dueDate) => {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (isNaN(due.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
};

const getAutoDebts = (finResults, existingDebts, openPoData) => {
  const existingOrders = new Set(existingDebts.map((d) => d.order));
  // Маппинг PO → paymentStatusCustomer из Open PO
  const poMap = {};
  (openPoData || []).forEach((po) => { poMap[po.internalPo] = po; });

  return finResults
    .filter((r) => {
      // Авто-дебиторка только для УПД, загруженных через CRM (есть файл)
      if (!r.updFileId) return false;
      if (r.status === "cancelled") return false;
      if (r.noGlobalSmart) return false;
      const pf = typeof r.paymentFact === "number" ? r.paymentFact : parseFloat(r.paymentFact) || 0;
      if (pf > 0) return false;
      if (existingOrders.has(r.customerPo)) return false;
      return true;
    })
    .map((r) => {
      const po = poMap[r.customerPo] || {};
      const payStatus = po.paymentStatusCustomer || "";
      const netDays = parseNetDays(payStatus);
      const updDate = r.updDate || po.updDate || "";
      const dueDate = netDays > 0 ? calcDueDate(updDate, netDays) : "";

      return {
        id: `auto_${r.id}`,
        company: r.customer,
        order: r.customerPo,
        amount: r.customerAmount || 0,
        dueDate,
        currency: "USD",
        status: "open",
        payDocFileId: null,
        payDate: "",
        payComment: "",
        source: "auto",
        finResultId: r.id,
      };
    });
};

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
const Dashboard = ({ balances, debts, finResults, openPo, infraData }) => {
  const [expandedGroup, setExpandedGroup] = useState(null);

  // Группируем балансы по инфраструктуре
  const rows = useMemo(() => {
    const groupOrder = ["РФ", "Crypto", "ALTURA", "YOON"];
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
      const accName = acc.name;
      const keys = [accName, accName.replace(" USD", "").replace(" GS", " GS"), accName.replace(" GS USD", " GS"), accName.replace(" GS ", " ")];
      for (const key of keys) {
        if (infraData[key]) {
          infraData[key].forEach((op) => ops.push({ ...op, _account: accName, _currency: acc.currency }));
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

  // Авто-дебиторка для дашборда
  const autoDebtsDash = useMemo(() => getAutoDebts(finResults || [], debts, openPo || []), [finResults, debts, openPo]);
  const allDebtsDash = useMemo(() => [...debts, ...autoDebtsDash], [debts, autoDebtsDash]);

  // Просроченные дебиторки
  const overdueTotal = useMemo(() => {
    const overdueDebts = allDebtsDash.filter(
      (d) => d.status === "open" && d.amount > 0 && d.dueDate && new Date(d.dueDate) < new Date()
    );
    return overdueDebts.reduce((s, d) => s + d.amount, 0);
  }, [allDebtsDash]);

  // Общая дебиторка
  const totalDebtDash = useMemo(() => {
    return allDebtsDash.filter((d) => d.status === "open" && d.amount > 0).reduce((s, d) => s + d.amount, 0);
  }, [allDebtsDash]);

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
            return keys.some((k) => infraData[k] && infraData[k].length > 0);
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
                          <th className="py-2.5 px-4 text-center font-semibold">Дата</th>
                          <th className="py-2.5 px-4 text-center font-semibold">Счёт</th>
                          <th className="py-2.5 px-4 text-center font-semibold">PO / Описание</th>
                          <th className="py-2.5 px-4 text-center font-semibold text-green-700">Приход</th>
                          <th className="py-2.5 px-4 text-center font-semibold text-red-700">Расход</th>
                          <th className="py-2.5 px-4 text-center font-semibold">Комиссии</th>
                          <th className="py-2.5 px-4 text-center font-semibold">Поставщик / Инвойс</th>
                          <th className="py-2.5 px-4 text-center font-semibold">Остаток</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ops.map((op, idx) => (
                          <tr key={`${op._account}-${op.id}`} className={`border-b border-gray-100 hover:bg-blue-50/40 ${idx % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                            <td className="py-2 px-4 text-center text-gray-700 whitespace-nowrap">{op.date || "—"}</td>
                            <td className="py-2 px-4 text-center text-gray-500 whitespace-nowrap">{op._currency}</td>
                            <td className="py-2 px-4 text-center text-gray-900 font-mono text-xs">
                              {op.poRef || (op.description ? <span className="text-blue-600 italic font-sans">{op.description}</span> : "—")}
                            </td>
                            <td className="py-2 px-4 text-center text-green-700 font-semibold tabular-nums">
                              {op.received ? "+" + fmt(op.received) : ""}
                            </td>
                            <td className="py-2 px-4 text-center text-red-600 font-semibold tabular-nums">
                              {op.outgoing ? "-" + fmt(op.outgoing) : ""}
                            </td>
                            <td className="py-2 px-4 text-center text-amber-600 tabular-nums">
                              {op.bankFees ? fmt(op.bankFees) : ""}
                            </td>
                            <td className="py-2 px-4 text-center text-gray-600 max-w-[220px] truncate" title={`${op.supplier || ""} ${op.invoice || ""}`}>
                              {op.supplier || op.invoice || "—"}
                            </td>
                            <td className={`py-2 px-4 text-center font-bold tabular-nums ${op.balance < 0 ? "text-red-600" : "text-gray-900"}`}>
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
  { key: "cancelled", label: "Отменён", color: "bg-red-500", text: "text-red-800", light: "bg-red-100", border: "border-red-400" },
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
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilter, setOpenFilter] = useState(null);
  const activeFilterCount = Object.values(columnFilters).filter((s) => s.size > 0).length;
  const clearAllColumnFilters = () => { setColumnFilters({}); setPage(-1); };
  const PP = 30;

  const FIN_FILTER_COL_KEYS = ["type", "customer", "customerPo", "orderDate", "customerAmount",
    "upd", "paymentFact", "supplierPo", "supplierAmount", "supplier", "finalBuyer", "status"];

  const finUniqueValuesMap = useMemo(() => {
    const map = {};
    FIN_FILTER_COL_KEYS.forEach((col) => {
      const vals = new Set();
      data.forEach((o) => getFinFilterValue(o, col).forEach((v) => vals.add(v)));
      map[col] = [...vals].sort();
    });
    return map;
  }, [data]);

  const filtered = useMemo(() => {
    let items = [...data];
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
    Object.entries(columnFilters).forEach(([colKey, selectedSet]) => {
      if (!selectedSet || selectedSet.size === 0) return;
      items = items.filter((o) => {
        const vals = getFinFilterValue(o, colKey);
        return vals.some((v) => selectedSet.has(v));
      });
    });
    return items;
  }, [data, filter, typeFilter, search, columnFilters]);

  const pages = Math.ceil(filtered.length / PP);
  // Авто-переход на последнюю страницу при первом рендере (-1 = auto)
  const effectivePage = page === -1 ? Math.max(0, pages - 1) : page;
  const slice = filtered.slice(effectivePage * PP, (effectivePage + 1) * PP);

  const doPayment = async () => {
    if (!payModal || !payForm.file) return;
    try {
      const uploaded = await api.uploadFile(payForm.file, "payments", payModal.id);
      pushLog({
        type: "fin_payment",
        id: payModal.id,
        prev: { paymentFact: payModal.paymentFact },
      });
      setData((prev) =>
        prev.map((r) =>
          r.id === payModal.id
            ? { ...r, paymentFact: parseFloat(payForm.amount) || 0, paymentDocFileId: uploaded.id, paymentDate: payForm.date }
            : r
        )
      );

      if (setDebts && payModal.customerPo) {
        setDebts((prev) => prev.map((d) => {
          if (d.order === payModal.customerPo && d.status === "open") {
            return { ...d, status: "closed", payDocFileId: uploaded.id, payDate: payForm.date, payComment: `Оплачено через Фин. результат: ₽${payForm.amount}` };
          }
          return d;
        }));
      }
    } catch (err) {
      console.error("Ошибка загрузки платёжки:", err);
      return;
    }
    setPayModal(null);
    setPayForm({ amount: "", date: "", file: null });
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
    if (newStatus === "cancelled") {
      const reason = prompt("Укажите причину отмены заказа:");
      if (!reason || !reason.trim()) return;
      pushLog({ type: "fin_status", id: r.id, prev: r.status });
      const prevComment = r.comment || "";
      const newComment = prevComment ? `${prevComment}\n⛔ Отменён: ${reason.trim()}` : `⛔ Отменён: ${reason.trim()}`;
      setData((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: "cancelled", comment: newComment } : x)));
      return;
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
      paymentDocFileId: r.paymentDocFileId || null,
      paymentDate: r.paymentDate || "",
      _newPayDoc: null,
    });
    setEditModal(r);
  };

  const saveEdit = async () => {
    if (!editModal) return;
    pushLog({ type: "fin_edit", id: editModal.id, prev: { ...editModal } });

    let finalPayDocFileId = editForm.paymentDocFileId;
    if (editForm._newPayDoc) {
      try {
        const uploaded = await api.uploadFile(editForm._newPayDoc, "payments", editModal.id);
        finalPayDocFileId = uploaded.id;
      } catch (err) {
        console.error("Ошибка загрузки платёжки:", err);
        return;
      }
    }

    const newPaymentFact = parseFloat(editForm.paymentFact) || 0;
    const oldPaymentFact = parseFloat(editModal.paymentFact) || 0;

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
              paymentDocFileId: finalPayDocFileId,
              paymentDate: editForm.paymentDate,
            }
          : x
      )
    );

    if (setDebts && newPaymentFact > 0 && oldPaymentFact === 0 && editModal.customerPo) {
      setDebts((prev) => prev.map((d) => {
        if (d.order === editModal.customerPo && d.status === "open") {
          return { ...d, status: "closed", payDocFileId: finalPayDocFileId, payDate: editForm.paymentDate, payComment: `Оплачено через Фин. результат: ${newPaymentFact}` };
        }
        return d;
      }));
    }

    setEditModal(null);
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
            { k: "cancelled", l: "Отменённые" },
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
        {activeFilterCount > 0 && (
          <button onClick={clearAllColumnFilters}
            className="px-3 py-2 bg-amber-100 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-200 transition-colors flex items-center gap-1.5">
            <span>Фильтры ({activeFilterCount})</span>
            <span className="text-amber-600">✕</span>
          </button>
        )}
        <span className="text-xs text-gray-500 font-medium">{filtered.length} записей</span>
      </div>

      {/* Таблица — структура как в Excel */}
      <div className="rounded-xl shadow-lg overflow-hidden border border-[#1E3A5F]/30">
        <div className="overflow-x-auto">
      <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1E3A5F] text-white text-center text-xs uppercase">
                {[
                  { key: "type", label: "Тип", align: "text-center" },
                  { key: "customer", label: "Клиент", align: "text-center" },
                  { key: "customerPo", label: "Internal PO", align: "text-center" },
                  { key: "orderDate", label: "Дата", align: "text-center" },
                  { key: "customerAmount", label: "Сумма USD", align: "text-center" },
                  { key: "upd", label: "УПД", align: "text-center" },
                  { key: "paymentFact", label: "Оплата факт ₽", align: "text-center" },
                  { key: "supplierPo", label: "External PO", align: "text-center" },
                  { key: "supplierAmount", label: "Сумма пост. $", align: "text-center" },
                  { key: "supplier", label: "Поставщик", align: "text-center" },
                  { key: "finalBuyer", label: "Структура", align: "text-center" },
                  { key: "status", label: "Статус", align: "text-center" },
                ].map((col) => {
                  const isActive = columnFilters[col.key]?.size > 0;
                  const isOpen = openFilter === col.key;
                  return (
                    <th key={col.key} className={`py-3 px-2 font-semibold relative ${col.align}`}>
                      <div className="flex items-center justify-center gap-1">
                        <span>{col.label}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenFilter(isOpen ? null : col.key); }}
                          className={`shrink-0 w-4 h-4 flex items-center justify-center rounded text-[8px] transition-all ${
                            isActive ? "bg-yellow-400 text-[#1E3A5F]" : "text-white/40 hover:text-white hover:bg-white/20"
                          }`}
                          title="Фильтр колонки">▼</button>
                      </div>
                      {isOpen && (
                        <ColumnFilterDropdown
                          values={finUniqueValuesMap[col.key] || []}
                          selected={columnFilters[col.key]}
                          onApply={(sel) => { setColumnFilters((prev) => ({ ...prev, [col.key]: sel })); setPage(-1); }}
                          onClear={() => { setColumnFilters((prev) => { const next = { ...prev }; delete next[col.key]; return next; }); setPage(-1); }}
                          onClose={() => setOpenFilter(null)}
                        />
                      )}
                    </th>
                  );
                })}
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
                  <td className="py-2.5 px-2 text-center"><TypeBadge type={r.type} /></td>
                  <td className="py-2.5 px-2 text-center text-gray-900 font-semibold text-xs max-w-[140px] truncate">{r.customer}</td>
                  <td className="py-2.5 px-2 text-center text-[#1E3A5F] font-mono text-xs max-w-[110px] truncate">{r.customerPo}</td>
                  <td className="py-2.5 px-2 text-center text-gray-600 text-xs whitespace-nowrap">{r.orderDate}</td>
                  <td className="py-2.5 px-2 text-center text-green-700 font-mono text-xs font-semibold">${fmt(r.customerAmount)}</td>
                  <td className="py-2.5 px-2">
                    {r.noGlobalSmart ? (
                      <div className="text-blue-600 cursor-help text-xs leading-tight font-medium" title="Заказ без участия Global Smart">
                        🔹 Без участия GS
                      </div>
                    ) : r.hasUpd ? (
                      <div title={r.orderStatus} className="text-emerald-600 text-xs leading-tight">
                        <div className="cursor-help">✅ УПД №{r.updNum || "—"}</div>
                        <div className="text-emerald-500 text-[10px] mt-0.5">от {r.updDate || "—"}
                          {r.updFileId && (
                            <button onClick={(e) => { e.stopPropagation(); downloadFile(r.updFileId, `УПД_${r.updNum || r.customerPo}.pdf`); }}
                              className="ml-1 text-blue-500 hover:text-blue-700 font-medium" title="Скачать УПД">⬇</button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    {r.paymentFact > 0 ? (
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-emerald-700 font-mono text-xs font-semibold" title={`₽${r.paymentFact.toLocaleString("ru-RU")}`}>
                          ₽{fmt(r.paymentFact)}
                        </span>
                        {r.paymentDocFileId && (
                          <button onClick={(e) => { e.stopPropagation(); downloadFile(r.paymentDocFileId, `Платёжка_${r.customerPo}.pdf`); }}
                            className="text-blue-500 hover:text-blue-700 text-[10px] font-medium" title="Скачать платёжку">⬇</button>
                        )}
                      </div>
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
                  <td className="py-2.5 px-2 text-center text-gray-700 font-mono text-xs max-w-[100px] truncate">{r.supplierPo}</td>
                  <td className="py-2.5 px-2 text-center text-gray-700 font-mono text-xs">{r.supplierAmount ? "$" + fmt(r.supplierAmount) : "—"}</td>
                  <td className="py-2.5 px-2 text-center text-gray-700 text-xs max-w-[120px] truncate">{r.supplier}</td>
                  <td className="py-2.5 px-2 text-center text-gray-600 text-xs max-w-[80px] truncate">{r.finalBuyer || "—"}</td>
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
              <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg text-emerald-300 text-sm flex items-center justify-between">
                <span>✅ УПД №{detailModal.updNum} от {detailModal.updDate}</span>
                {detailModal.updFileId && (
                  <button onClick={() => downloadFile(detailModal.updFileId, `УПД_${detailModal.updNum || detailModal.customerPo}.pdf`)}
                    className="px-3 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg text-xs font-medium transition-colors">⬇ Скачать</button>
                )}
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
                {editForm.paymentDocFileId && !editForm._newPayDoc && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-blue-400">✅ Платёжка загружена</span>
                    <button onClick={() => setEditForm({ ...editForm, paymentDocFileId: null })} className="text-xs text-rose-400 hover:text-rose-300">✕ Удалить</button>
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
  // Колоночные фильтры (Google Sheets style)
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilter, setOpenFilter] = useState(null);
  const activeFilterCount = Object.values(columnFilters).filter((s) => s.size > 0).length;
  const clearAllColumnFilters = () => { setColumnFilters({}); setPage(-1); };

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
  const syncUpdToFinResults = useCallback((poInternalPo, hasUpd, updNum, updDate, updFileId, noGlobalSmart) => {
    if (!setFinResults) return;
    setFinResults((prev) =>
      prev.map((fr) => {
        if (fr.customerPo === poInternalPo) {
          if (hasUpd) {
            return {
              ...fr,
              hasUpd: true,
              noGlobalSmart: !!noGlobalSmart,
              updNum: updNum || fr.updNum,
              updDate: updDate || fr.updDate,
              updFileId: updFileId || fr.updFileId,
              orderStatus: noGlobalSmart ? "Без участия GS" : (updNum ? `УПД №${updNum} от ${updDate}` : fr.orderStatus),
            };
          } else {
            return { ...fr, hasUpd: false, noGlobalSmart: false, updNum: "", updDate: "", updFileId: null, orderStatus: "" };
          }
        }
        return fr;
      })
    );
  }, [setFinResults]);
  const [newPO, setNewPO] = useState({
    customer: "", respSales: "", internalPo: "", dateOrdered: new Date().toISOString().split("T")[0],
    customerDeadline: "", termsDelivery: "", customerAmount: 0, paymentStatusCustomer: "",
    dateCustomerPaid: "", datePaidSupplier: "",
    deliveryCost: 0, awb: "", tracking: "", comments: "", mgmtComments: "",
    type: "domestic",
    externalOrders: [{ po: "", supplier: "", supplierAmount: 0, payment: "", payingCompany: "", datePlaced: "", respProcurement: "", logisticsPlan: "", cancelled: false }],
  });
  const PP = 30;

  const FILTER_COL_KEYS = ["num", "customer", "internalPo", "dateOrdered", "customerDeadline",
    "customerAmount", "paymentStatusCustomer", "dateCustomerPaid", "internalPoRef", "supplierName", "supplierAmount",
    "paymentStatusSupplier", "datePaidSupplier", "payingCompany", "deliveryPlan", "orderStage", "upd"];

  const uniqueValuesMap = useMemo(() => {
    let pool = [...data];
    if (typeFilter === "domestic") pool = pool.filter((o) => o.type === "domestic");
    if (typeFilter === "export") pool = pool.filter((o) => o.type === "export");
    if (typeFilter === "yoon") pool = pool.filter((o) => o.type === "yoon");
    const map = {};
    FILTER_COL_KEYS.forEach((col) => {
      const vals = new Set();
      pool.forEach((o) => getPoFilterValue(o, col).forEach((v) => vals.add(v)));
      map[col] = [...vals].sort();
    });
    return map;
  }, [data, typeFilter]);

  const filtered = useMemo(() => {
    let items = [...data];
    items.sort((a, b) => (a.dateOrdered || "").localeCompare(b.dateOrdered || ""));
    if (typeFilter === "domestic") items = items.filter((o) => o.type === "domestic");
    if (typeFilter === "export") items = items.filter((o) => o.type === "export");
    if (typeFilter === "yoon") items = items.filter((o) => o.type === "yoon");
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
    Object.entries(columnFilters).forEach(([colKey, selectedSet]) => {
      if (!selectedSet || selectedSet.size === 0) return;
      items = items.filter((o) => {
        const vals = getPoFilterValue(o, colKey);
        return vals.some((v) => selectedSet.has(v));
      });
    });
    return items;
  }, [data, filter, typeFilter, search, columnFilters]);

  const pages = Math.ceil(filtered.length / PP);
  const effectivePage = page === -1 ? Math.max(0, pages - 1) : page;
  const slice = filtered.slice(effectivePage * PP, (effectivePage + 1) * PP);

  const doUpd = async () => {
    if (!updModal) return;
    if (!updForm.noGS && (!updForm.file || !updForm.num || !updForm.date)) return;

    pushLog({
      type: "po_upd",
      id: updModal.id,
      prev: { hasUpd: updModal.hasUpd, updNum: updModal.updNum, updDate: updModal.updDate, mgmtComments: updModal.mgmtComments, noGlobalSmart: updModal.noGlobalSmart },
    });

    if (updForm.noGS) {
      setData((prev) =>
        prev.map((r) =>
          r.id === updModal.id
            ? { ...r, hasUpd: true, noGlobalSmart: true, updNum: "Без участия GS", updDate: "", updFileId: null,
                mgmtComments: `${r.mgmtComments ? r.mgmtComments + "\n" : ""}Без участия GS` }
            : r
        )
      );
      syncUpdToFinResults(updModal.internalPo, true, "Без участия GS", "", null, true);
    } else {
      try {
        const uploaded = await api.uploadFile(updForm.file, "upd", updModal.id);
        setData((prev) =>
          prev.map((r) =>
            r.id === updModal.id
              ? { ...r, hasUpd: true, noGlobalSmart: false, updNum: updForm.num, updDate: updForm.date, updFileId: uploaded.id,
                  mgmtComments: `${r.mgmtComments ? r.mgmtComments + "\n" : ""}УПД №${updForm.num} от ${updForm.date}` }
              : r
          )
        );
        syncUpdToFinResults(updModal.internalPo, true, updForm.num, updForm.date, uploaded.id, false);
      } catch (err) {
        console.error("Ошибка загрузки УПД:", err);
        return;
      }
    }
    setUpdModal(null);
    setUpdForm({ num: "", date: "", file: null, noGS: false });
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
      dateCustomerPaid: r.dateCustomerPaid || "",
      datePaidSupplier: r.datePaidSupplier || "",
      comments: r.comments, awb: r.awb, tracking: r.tracking,
      customerDeadline: r.customerDeadline, termsDelivery: r.termsDelivery,
      hasUpd: r.hasUpd || false, noGlobalSmart: r.noGlobalSmart || false,
      updNum: r.updNum || "", updDate: r.updDate || "", updFileId: r.updFileId || null,
      externalOrders: exts,
    });
  };

  const saveEdit = async () => {
    if (!editModal) return;
    pushLog({ type: "po_edit", id: editModal.id, prev: { ...editModal } });
    if (editForm._newUpdFile) {
      try {
        const uploaded = await api.uploadFile(editForm._newUpdFile, "upd", editModal.id);
        editForm.updFileId = uploaded.id;
      } catch (err) {
        console.error("Ошибка загрузки УПД:", err);
        return;
      }
    }
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
      logisticsPlan: exts.map((e) => e.logisticsPlan).join("\n"),
    };
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
    delete updatedForm._newUpdFile;
    setData((prev) => prev.map((r) => (r.id === editModal.id ? { ...r, ...updatedForm } : r)));
    syncUpdToFinResults(editModal.internalPo, updatedForm.hasUpd, updatedForm.updNum, updatedForm.updDate, updatedForm.updFileId, updatedForm.noGlobalSmart);
    setEditModal(null);
  };

  const emptyExtPO = { po: "", supplier: "", supplierAmount: 0, payment: "", payingCompany: "", datePlaced: "", respProcurement: "", logisticsPlan: "", cancelled: false, cancelReason: "" };
  const handleAddPO = async () => {
    const num = String(data.length + 1);
    const exts = newPO.externalOrders || [emptyExtPO];
    const assembled = {
      ...newPO,
      num, status: "active", hasUpd: false, updNum: "", updDate: "", updFileId: null, cancelReason: "",
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
      logisticsPlan: exts.map((e) => e.logisticsPlan).join("\n"),
    };
    const cancelComments = exts
      .filter((ext) => ext.cancelled && ext.cancelReason)
      .map((ext) => `[${new Date().toLocaleDateString("ru-RU")}] ОТМЕНА PO ${ext.po}: ${ext.cancelReason}`);
    if (cancelComments.length > 0) {
      assembled.comments = assembled.comments
        ? `${assembled.comments}\n${cancelComments.join("\n")}`
        : cancelComments.join("\n");
    }
    delete assembled.externalOrders;
    try {
      const saved = await api.createPO(assembled);
      saved.customerAmount = parseFloat(saved.customerAmount) || 0;
      saved.supplierAmount = parseFloat(saved.supplierAmount) || 0;
      saved.orderStage = saved.orderStage || "in_work";
      setData((prev) => [...prev, saved]);

      if (setFinResults) {
        const activeExts = exts.filter((e) => !e.cancelled);
        const finEntry = {
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
        };
        const savedFin = await api.createFin(finEntry);
        savedFin.customerAmount = parseFloat(savedFin.customerAmount) || 0;
        savedFin.supplierAmount = parseFloat(savedFin.supplierAmount) || 0;
        savedFin.paymentFact = parseFloat(savedFin.paymentFact) || 0;
        setFinResults((prev) => [...prev, savedFin]);
      }
    } catch (err) {
      console.error("Ошибка создания PO:", err);
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
        {activeFilterCount > 0 && (
          <button onClick={clearAllColumnFilters}
            className="px-3 py-2 bg-amber-100 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-200 transition-colors flex items-center gap-1.5">
            <span>Фильтры ({activeFilterCount})</span>
            <span className="text-amber-600">✕</span>
          </button>
        )}
        <span className="text-xs text-gray-500 font-medium">{filtered.length} записей</span>
    </div>

      {/* Таблица */}
      <div className="rounded-xl shadow-lg overflow-hidden border border-[#1E3A5F]/30 flex flex-col" style={{ minHeight: "calc(100vh - 220px)" }}>
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#1E3A5F] text-white">
                <th className="py-2.5 px-1 text-center font-semibold w-7"></th>
                {[
                  { key: "num", label: "№", align: "text-center" },
                  { key: "customer", label: "Клиент", align: "text-center" },
                  { key: "internalPo", label: "PO", align: "text-center" },
                  { key: "dateOrdered", label: "Дата", align: "text-center" },
                  { key: "customerDeadline", label: "Дедлайн", align: "text-center" },
                  { key: "customerAmount", label: "Сумма $", align: "text-center" },
                  { key: "paymentStatusCustomer", label: "Оплата кл.", align: "text-center" },
                  { key: "dateCustomerPaid", label: "Дата опл. кл.", align: "text-center" },
                  { key: "internalPoRef", label: "External PO", align: "text-center" },
                  { key: "supplierName", label: "Поставщик", align: "text-center" },
                  { key: "supplierAmount", label: "Сумма пост.", align: "text-center" },
                  { key: "paymentStatusSupplier", label: "Оплата пост.", align: "text-center" },
                  { key: "datePaidSupplier", label: "Дата опл. пост.", align: "text-center" },
                  { key: "payingCompany", label: "Плат. компания", align: "text-center" },
                  { key: "deliveryPlan", label: "Дост. план", align: "text-center" },
                  { key: "orderStage", label: "Стадия", align: "text-center" },
                  { key: "upd", label: "УПД", align: "text-center" },
                ].map((col) => {
                  const isActive = columnFilters[col.key]?.size > 0;
                  const isOpen = openFilter === col.key;
                  return (
                    <th key={col.key} className={`py-2.5 px-2 font-semibold relative ${col.align}`}>
                      <div className="flex items-center justify-center gap-1">
                        <span>{col.label}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenFilter(isOpen ? null : col.key); }}
                          className={`shrink-0 w-4 h-4 flex items-center justify-center rounded text-[8px] transition-all ${
                            isActive ? "bg-yellow-400 text-[#1E3A5F]" : "text-white/40 hover:text-white hover:bg-white/20"
                          }`}
                          title="Фильтр колонки">▼</button>
                      </div>
                      {isOpen && (
                        <ColumnFilterDropdown
                          values={uniqueValuesMap[col.key] || []}
                          selected={columnFilters[col.key]}
                          onApply={(sel) => { setColumnFilters((prev) => ({ ...prev, [col.key]: sel })); setPage(-1); }}
                          onClear={() => { setColumnFilters((prev) => { const next = { ...prev }; delete next[col.key]; return next; }); setPage(-1); }}
                          onClose={() => setOpenFilter(null)}
                        />
                      )}
                    </th>
                  );
                })}
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
                    <td className="py-2 px-2 text-center text-gray-500">{o.num}</td>
                    <td className="py-2 px-2 text-center text-[#1E3A5F] font-semibold max-w-[140px] truncate">{o.customer}</td>
                    <td className="py-2 px-2 text-center text-gray-900 font-mono text-xs max-w-[120px] truncate">{o.internalPo}</td>
                    <td className="py-2 px-2 text-center text-gray-600 whitespace-nowrap">{o.dateOrdered || "—"}</td>
                    <td className="py-2 px-2 text-center text-gray-600 whitespace-nowrap text-xs">{o.customerDeadline || "—"}</td>
                    <td className="py-2 px-2 text-center text-gray-900 font-semibold tabular-nums whitespace-nowrap">${fmt(o.customerAmount)}</td>
                    <td className="py-2 px-2 text-center max-w-[120px] relative" onClick={(e) => e.stopPropagation()}>
                      {inlineEdit && inlineEdit.id === o.id && inlineEdit.field === "paymentStatusCustomer" ? (
                        <div className="absolute z-50 top-0 left-0 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[130px]">
                          {["Paid", "Not paid", "NET 5", "NET 7", "NET 10", "NET 30"].map((opt) => (
                            <button key={opt} onClick={() => { pushLog({ type: "po_inline_edit", id: o.id, field: "paymentStatusCustomer", prev: o.paymentStatusCustomer || "" }); setData((prev) => prev.map((x) => x.id === o.id ? { ...x, paymentStatusCustomer: opt } : x)); setInlineEdit(null); }}
                              className={`w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-gray-100 transition-colors ${opt === "Paid" ? "text-emerald-700" : "text-amber-700"}`}>
                              {opt === "Paid" ? "✅ " : "🟡 "}{opt}
                            </button>
                          ))}
                          <button onClick={cancelInlineEdit} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-100 border-t border-gray-100">Отмена</button>
                      </div>
                      ) : (
                        <span onClick={() => startInlineEdit(o, "paymentStatusCustomer")}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all ${isPaid ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                          title="Нажмите для выбора">
                          {(o.paymentStatusCustomer || "—").substring(0, 20)}
                        </span>
                      )}
                    </td>
                    {/* Дата оплаты клиента */}
                    <td className="py-2 px-2 text-center text-gray-600 whitespace-nowrap text-xs" onClick={(e) => e.stopPropagation()}>
                      {inlineEdit && inlineEdit.id === o.id && inlineEdit.field === "dateCustomerPaid" ? (
                        <input type="date" autoFocus value={inlineEdit.value || ""}
                          onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                          onBlur={() => { pushLog({ type: "po_inline_edit", id: o.id, field: "dateCustomerPaid", prev: o.dateCustomerPaid || "" }); setData((prev) => prev.map((x) => x.id === o.id ? { ...x, dateCustomerPaid: inlineEdit.value } : x)); setInlineEdit(null); }}
                          onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setInlineEdit(null); }}
                          className="w-24 px-1 py-0.5 border border-blue-400 rounded text-xs text-center" />
                      ) : (
                        <span onClick={() => setInlineEdit({ id: o.id, field: "dateCustomerPaid", value: o.dateCustomerPaid || "" })}
                          className="cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded transition-colors">
                          {o.dateCustomerPaid || "—"}
                        </span>
                      )}
                    </td>
                    {/* External PO — номера с зачёркиванием */}
                    <td className="py-2 px-2 text-center font-mono text-xs max-w-[120px]">
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
                        <td className="py-2 px-2 text-center text-xs max-w-[120px]">
                          {!suppliers.length ? <span className="text-gray-400">—</span> :
                            suppliers.length === 1 ? <span className="text-gray-700 truncate block">{suppliers[0]}</span> :
                            <div className="space-y-0.5">{suppliers.map((n, i) => <div key={i} className="text-gray-700 truncate text-[10px] leading-tight">{n}</div>)}</div>}
                        </td>
                        <td className="py-2 px-2 text-center text-gray-700 tabular-nums whitespace-nowrap text-xs">
                          {amounts.length > 1 ? <div className="space-y-0.5">{amounts.map((a, i) => <div key={i} className="text-[10px] leading-tight">${fmt(parseFloat(a) || 0)}</div>)}</div>
                            : amounts.length === 1 ? "$" + fmt(parseFloat(amounts[0]) || 0)
                            : o.supplierAmount ? "$" + fmt(o.supplierAmount) : "—"}
                        </td>
                        <td className="py-2 px-2 text-center max-w-[120px] relative" onClick={(e) => e.stopPropagation()}>
                          {inlineEdit && inlineEdit.id === o.id && inlineEdit.field === "paymentStatusSupplier" ? (
                            <div className="absolute z-50 top-0 left-0 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[120px]">
                              {["Paid", "Not paid"].map((opt) => (
                                <button key={opt} onClick={() => {
                                  const exts = parseExternalPOs(o);
                                  const updatedPayments = exts.map((e) => e.cancelled ? e.payment : opt).join("\n");
                                  pushLog({ type: "po_inline_edit", id: o.id, field: "paymentStatusSupplier", prev: o.paymentStatusSupplier || "" });
                                  setData((prev) => prev.map((x) => x.id === o.id ? { ...x, paymentStatusSupplier: updatedPayments } : x));
                                  setInlineEdit(null);
                                }}
                                  className={`w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-gray-100 transition-colors ${opt === "Paid" ? "text-emerald-700" : "text-amber-700"}`}>
                                  {opt === "Paid" ? "✅ " : "🟡 "}{opt}
                                </button>
                              ))}
                              <button onClick={cancelInlineEdit} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-100 border-t border-gray-100">Отмена</button>
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
                        {/* Дата оплаты поставщику */}
                        <td className="py-2 px-2 text-center text-gray-600 whitespace-nowrap text-xs" onClick={(e) => e.stopPropagation()}>
                          {inlineEdit && inlineEdit.id === o.id && inlineEdit.field === "datePaidSupplier" ? (
                            <input type="date" autoFocus value={inlineEdit.value || ""}
                              onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                              onBlur={() => { pushLog({ type: "po_inline_edit", id: o.id, field: "datePaidSupplier", prev: o.datePaidSupplier || "" }); setData((prev) => prev.map((x) => x.id === o.id ? { ...x, datePaidSupplier: inlineEdit.value } : x)); setInlineEdit(null); }}
                              onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setInlineEdit(null); }}
                              className="w-24 px-1 py-0.5 border border-blue-400 rounded text-xs text-center" />
                          ) : (
                            <span onClick={() => setInlineEdit({ id: o.id, field: "datePaidSupplier", value: o.datePaidSupplier || "" })}
                              className="cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded transition-colors">
                              {o.datePaidSupplier || "—"}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center text-gray-600 text-xs max-w-[80px] truncate">{companies.length > 0 ? companies.join(", ") : "—"}</td>
                      </>);
                    })()}
                    <td className="py-2 px-2 text-center text-gray-600 text-xs max-w-[80px] truncate">{o.logisticsPlan || "—"}</td>
                    <td className="py-2 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <KanbanDropdown order={o} setData={setData} pushLog={pushLog} syncUpdToFinResults={syncUpdToFinResults} />
                    </td>
                    <td className="py-2 px-2 text-center">
                      {o.noGlobalSmart ? (
                        <span className="text-blue-600 text-xs font-medium cursor-help" title="Заказ без участия Global Smart">
                          🔹 Без участия GS
              </span>
                      ) : o.hasUpd ? (
                        <div className="text-emerald-600 text-xs leading-tight">
                          <span className="cursor-help" title={`УПД №${o.updNum} от ${o.updDate}`}>
                            ✅ <span className="text-emerald-700 font-medium">УПД №{o.updNum || "—"} от {o.updDate || "—"}</span>
                          </span>
                          {o.updFileId && (
                            <button onClick={(e) => { e.stopPropagation(); downloadFile(o.updFileId, `УПД_${o.updNum || o.internalPo}.pdf`); }}
                              className="ml-1 text-blue-500 hover:text-blue-700 text-[10px] font-medium" title="Скачать УПД">⬇</button>
                          )}
                        </div>
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
                      <td colSpan={19} className="p-0">
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
                  <div className="col-span-2"><div className="text-slate-500 text-[10px] mb-0.5">📦 План логистики</div><div className="text-slate-200">{ext.logisticsPlan || "—"}</div></div>
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
              <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg text-sm text-emerald-300 flex items-center justify-between">
                <span>✅ УПД №{detailModal.updNum} от {detailModal.updDate}</span>
                {detailModal.updFileId && (
                  <button onClick={() => downloadFile(detailModal.updFileId, `УПД_${detailModal.updNum || detailModal.internalPo}.pdf`)}
                    className="px-3 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg text-xs font-medium transition-colors">⬇ Скачать</button>
                )}
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
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Payment Status</label>
                <select value={editForm.paymentStatusCustomer} onChange={(e) => setEditForm({ ...editForm, paymentStatusCustomer: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500">
                  <option value="">— Выберите —</option>
                  <option value="Paid">Paid</option>
                  <option value="Not paid">Not paid</option>
                  <option value="NET 5">NET 5</option>
                  <option value="NET 7">NET 7</option>
                  <option value="NET 10">NET 10</option>
                  <option value="NET 30">NET 30</option>
                </select>
              </div>
              <InputField label="Дата оплаты клиента" value={editForm.dateCustomerPaid} onChange={(v) => setEditForm({ ...editForm, dateCustomerPaid: v })} type="date" />
              <InputField label="Дата оплаты поставщику" value={editForm.datePaidSupplier} onChange={(v) => setEditForm({ ...editForm, datePaidSupplier: v })} type="date" />
            </div>

            {/* Блок External PO */}
            <div className="border border-slate-600 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-300">External PO (заказы поставщикам)</span>
                <button onClick={() => setEditForm({ ...editForm, externalOrders: [...(editForm.externalOrders || []), { po: "", supplier: "", supplierAmount: 0, payment: "", payingCompany: "", logisticsPlan: "", cancelled: false }] })}
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
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Статус оплаты</label>
                      <select value={ext.payment} onChange={(e) => {
                        const upd = [...editForm.externalOrders]; upd[ei] = { ...upd[ei], payment: e.target.value };
                        setEditForm({ ...editForm, externalOrders: upd });
                      }}
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500">
                        <option value="">— Выберите —</option>
                        <option value="Paid">Paid</option>
                        <option value="Not paid">Not paid</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Платежная компания</label>
                      <select value={ext.payingCompany} onChange={(e) => {
                        const upd = [...editForm.externalOrders]; upd[ei] = { ...upd[ei], payingCompany: e.target.value };
                        setEditForm({ ...editForm, externalOrders: upd });
                      }}
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500">
                        <option value="">— Выберите —</option>
                        <option value="Altura Technics">Altura Technics</option>
                        <option value="YG ENGINEERING">YG ENGINEERING</option>
                      </select>
                    </div>
                    <InputField label="Дата размещения" value={ext.datePlaced} onChange={(v) => {
                      const upd = [...editForm.externalOrders]; upd[ei] = { ...upd[ei], datePlaced: v };
                      setEditForm({ ...editForm, externalOrders: upd });
                    }} type="date" />
                    <InputField label="Resp. Procurement" value={ext.respProcurement} onChange={(v) => {
                      const upd = [...editForm.externalOrders]; upd[ei] = { ...upd[ei], respProcurement: v };
                      setEditForm({ ...editForm, externalOrders: upd });
                    }} placeholder="KV, DS, DO..." />
                    <InputField label="План логистики" value={ext.logisticsPlan} onChange={(v) => {
                      const upd = [...editForm.externalOrders]; upd[ei] = { ...upd[ei], logisticsPlan: v };
                      setEditForm({ ...editForm, externalOrders: upd });
                    }} placeholder="Описание плана доставки..." />
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
                  <button onClick={() => setEditForm({ ...editForm, hasUpd: false, updNum: "", updDate: "", updFileId: null, _newUpdFile: null })}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors">✕ Удалить УПД</button>
                )}
              </div>
              {editForm.noGlobalSmart ? (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-blue-300 text-sm">
                  🔹 Заказ без участия Global Smart
                </div>
              ) : editForm.hasUpd ? (
                <div className="space-y-2">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-emerald-300 text-sm space-y-1">
                    <p>✅ УПД №{editForm.updNum} от {editForm.updDate}</p>
                    {(editForm.updFileId || editForm._newUpdFile) && <p className="text-xs text-emerald-400/70">Файл прикреплён</p>}
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Заменить файл УПД</label>
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setEditForm({ ...editForm, _newUpdFile: file });
                      }}
                      className="w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-blue-500 file:text-white file:cursor-pointer hover:file:bg-blue-600" />
                    {editForm._newUpdFile && <p className="text-xs text-amber-400 mt-1">📎 Новый файл: {editForm._newUpdFile.name}</p>}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-700/30 border border-slate-600/50 rounded-lg p-3 text-slate-400 text-sm">
                  УПД не загружена. Для загрузки измените стадию заказа на «Завершён».
                </div>
              )}
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
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Payment Status</label>
              <select value={newPO.paymentStatusCustomer} onChange={(e) => setNewPO({ ...newPO, paymentStatusCustomer: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500">
                <option value="">— Выберите —</option>
                <option value="Paid">Paid</option>
                <option value="Not paid">Not paid</option>
                <option value="NET 5">NET 5</option>
                <option value="NET 7">NET 7</option>
                <option value="NET 10">NET 10</option>
                <option value="NET 30">NET 30</option>
              </select>
            </div>
            <InputField label="Дата оплаты клиента" value={newPO.dateCustomerPaid} onChange={(v) => setNewPO({ ...newPO, dateCustomerPaid: v })} type="date" />
            <InputField label="Дата оплаты поставщику" value={newPO.datePaidSupplier} onChange={(v) => setNewPO({ ...newPO, datePaidSupplier: v })} type="date" />
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
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Статус оплаты</label>
                    <select value={ext.payment} onChange={(e) => {
                      const upd = [...newPO.externalOrders]; upd[ei] = { ...upd[ei], payment: e.target.value };
                      setNewPO({ ...newPO, externalOrders: upd });
                    }}
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500">
                      <option value="">— Выберите —</option>
                      <option value="Paid">Paid</option>
                      <option value="Not paid">Not paid</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Платежная компания</label>
                    <select value={ext.payingCompany} onChange={(e) => {
                      const upd = [...newPO.externalOrders]; upd[ei] = { ...upd[ei], payingCompany: e.target.value };
                      setNewPO({ ...newPO, externalOrders: upd });
                    }}
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500">
                      <option value="">— Выберите —</option>
                      <option value="Altura Technics">Altura Technics</option>
                      <option value="YG ENGINEERING">YG ENGINEERING</option>
                    </select>
                  </div>
                  <InputField label="Дата размещения" value={ext.datePlaced} onChange={(v) => {
                    const upd = [...newPO.externalOrders]; upd[ei] = { ...upd[ei], datePlaced: v };
                    setNewPO({ ...newPO, externalOrders: upd });
                  }} type="date" />
                  <InputField label="Resp. Procurement" value={ext.respProcurement} onChange={(v) => {
                    const upd = [...newPO.externalOrders]; upd[ei] = { ...upd[ei], respProcurement: v };
                    setNewPO({ ...newPO, externalOrders: upd });
                  }} placeholder="KV, DS, DO..." />
                  <InputField label="План логистики" value={ext.logisticsPlan} onChange={(v) => {
                    const upd = [...newPO.externalOrders]; upd[ei] = { ...upd[ei], logisticsPlan: v };
                    setNewPO({ ...newPO, externalOrders: upd });
                  }} placeholder="Описание плана доставки..." />
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
const Debts = ({ debts, setDebts, pushLog, finResults, setFinResults, openPo }) => {
  const [closeModal, setCloseModal] = useState(null);
  const [closeForm, setCloseForm] = useState({ file: null, date: "", comment: "", amount: "" });
  const [addModal, setAddModal] = useState(false);
  const [form, setForm] = useState({ company: "", order: "", amount: 0, dueDate: "", currency: "USD", upd: "" });
  const [viewDoc, setViewDoc] = useState(null);

  // Авто-дебиторка из Фин. результат (УПД есть, оплаты нет)
  const autoDebts = useMemo(() => getAutoDebts(finResults || [], debts, openPo || []), [finResults, debts, openPo]);

  // Обогащаем ручные записи NET-сроками из Open PO (дата УПД + NET дней)
  const enrichedManualDebts = useMemo(() => {
    const poMap = {};
    (openPo || []).forEach((po) => { poMap[po.internalPo] = po; });
    // Также ищем УПД-дату из finResults
    const frMap = {};
    (finResults || []).forEach((fr) => { frMap[fr.customerPo] = fr; });
    return debts.map((d) => {
      const po = poMap[d.order] || {};
      const fr = frMap[d.order] || {};
      const payStatus = po.paymentStatusCustomer || "";
      const netDays = parseNetDays(payStatus);
      // Дата УПД — берём из finResults или openPo
      const updDate = fr.updDate || po.updDate || "";
      // Если у ручной записи нет dueDate, но есть NET и дата УПД — вычислим
      const computedDue = (!d.dueDate && netDays > 0 && updDate) ? calcDueDate(updDate, netDays) : d.dueDate;
      return { ...d, dueDate: computedDue || d.dueDate };
    });
  }, [debts, openPo, finResults]);

  const allDebts = useMemo(() => [...enrichedManualDebts, ...autoDebts], [enrichedManualDebts, autoDebts]);

  const openD = allDebts.filter((d) => d.status === "open" && d.amount > 0);
  const closedD = debts.filter((d) => d.status === "closed");

  const totalDebt = openD.reduce((s, d) => s + d.amount, 0);
  const overdueItems = openD.filter((d) => d.dueDate && new Date(d.dueDate) < new Date());
  const overdueTotal = overdueItems.reduce((s, d) => s + d.amount, 0);

  const grouped = {};
  openD.forEach((d) => { if (!grouped[d.company]) grouped[d.company] = []; grouped[d.company].push(d); });

  const closeDebt = async () => {
    if (!closeModal || !closeForm.file || !closeForm.amount) return;
    try {
      const uploaded = await api.uploadFile(closeForm.file, "payments", closeModal.id);
      const payAmount = parseFloat(closeForm.amount) || 0;
      const isAuto = String(closeModal.id).startsWith("auto_");

      if (isAuto) {
        if (setFinResults && closeModal.finResultId) {
          pushLog({ type: "debt_close_auto", finResultId: closeModal.finResultId, prev: { paymentFact: 0 } });
          setFinResults((prev) => prev.map((fr) => {
            if (fr.id === closeModal.finResultId) {
              return { ...fr, paymentFact: payAmount, paymentDocFileId: uploaded.id, paymentDate: closeForm.date };
            }
            return fr;
          }));
        }
      } else {
        pushLog({ type: "debt_close", id: closeModal.id, prev: { status: "open", payDocFileId: null, payDate: "", payComment: "" } });
        setDebts((prev) => prev.map((d) => d.id === closeModal.id ? { ...d, status: "closed", payDocFileId: uploaded.id, payDate: closeForm.date, payComment: closeForm.comment } : d));

        if (setFinResults && closeModal.order) {
          setFinResults((prev) => prev.map((fr) => {
            if (fr.customerPo === closeModal.order) {
              return { ...fr, paymentFact: payAmount, paymentDocFileId: uploaded.id, paymentDate: closeForm.date };
            }
            return fr;
          }));
        }
      }
    } catch (err) {
      console.error("Ошибка загрузки платёжного документа:", err);
      return;
    }
    setCloseModal(null);
    setCloseForm({ file: null, date: "", comment: "", amount: "" });
  };

  const addDebt = async () => {
    try {
      const saved = await api.createDebt({ ...form, amount: parseFloat(form.amount) || 0, status: "open" });
      saved.amount = parseFloat(saved.amount) || 0;
      setDebts((prev) => [...prev, saved]);
    } catch (err) {
      console.error("Ошибка создания долга:", err);
    }
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

      {/* Заголовок */}
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
                <col className="w-[20%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[26%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr className="bg-[#1E3A5F]/10 text-[#1E3A5F] text-center text-xs uppercase">
                  <th className="py-2 px-4 font-semibold">Заказ</th>
                  <th className="py-2 px-3 font-semibold">Сумма</th>
                  <th className="py-2 px-3 font-semibold">Срок оплаты</th>
                  <th className="py-2 px-3 font-semibold">Статус срока</th>
                  <th className="py-2 px-3 font-semibold">Действия</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {items.map((d, idx) => {
                  const overdue = d.dueDate && new Date(d.dueDate) < new Date();
                  const daysLeft = calcDaysRemaining(d.dueDate);
                  const daysLabel = daysLeft !== null
                    ? daysLeft < 0
                      ? <span className="text-rose-700 font-bold">Просрочено {Math.abs(daysLeft)} дн. ⚠️</span>
                      : daysLeft === 0
                        ? <span className="text-amber-600 font-bold">Сегодня!</span>
                        : daysLeft <= 3
                          ? <span className="text-amber-500 font-semibold">Осталось {daysLeft} дн. ⏳</span>
                          : <span className="text-gray-600">Осталось {daysLeft} дн.</span>
                    : <span className="text-gray-400">—</span>;
                  return (
                    <tr key={d.id} className={`border-b border-gray-200 transition-colors hover:bg-blue-50 ${overdue ? "bg-red-200" : idx % 2 === 1 ? "bg-gray-50" : ""}`}>
                      <td className="py-2.5 px-4 text-center text-[#1E3A5F] font-mono text-xs font-medium">{d.order}</td>
                      <td className={`py-2.5 px-3 text-center font-mono text-xs font-bold ${overdue ? "text-rose-700" : "text-gray-900"}`}>${fmt(d.amount)}</td>
                      <td className="py-2.5 px-3 text-center text-xs">
                        {d.dueDate ? (
                          <span className={overdue ? "text-rose-700 font-bold" : "text-gray-600"}>{d.dueDate}</span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2.5 px-3 text-center text-xs">{daysLabel}</td>
                      <td className="py-2.5 px-3 text-center">
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
                <tr className="bg-emerald-50 text-emerald-800 text-center text-xs uppercase">
                  <th className="py-2.5 px-4 font-semibold">Компания</th>
                  <th className="py-2.5 px-3 font-semibold">Заказ</th>
                  <th className="py-2.5 px-3 font-semibold">Сумма</th>
                  <th className="py-2.5 px-3 font-semibold">Дата закрытия</th>
                  <th className="py-2.5 px-3 font-semibold">Документ</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {closedD.map((d, idx) => (
                  <tr key={d.id} className={`border-b border-gray-100 ${idx % 2 === 1 ? "bg-gray-50" : ""}`}>
                    <td className="py-2 px-4 text-center text-gray-700 font-medium text-xs">{d.company}</td>
                    <td className="py-2 px-3 text-center text-gray-500 text-xs">{d.order}</td>
                    <td className="py-2 px-3 text-center text-emerald-600 font-mono text-xs line-through">{fmt(d.amount)} {d.currency}</td>
                    <td className="py-2 px-3 text-center text-gray-500 text-xs">{d.payDate || "—"}</td>
                    <td className="py-2 px-3">
                      {d.payDocFileId ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => setViewDoc(d)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">📎 Просмотр</button>
                          <button onClick={() => downloadFile(d.payDocFileId, `Платёжка_${d.order}.pdf`)}
                            className="text-xs text-emerald-600 hover:text-emerald-800 font-medium" title="Скачать документ">⬇</button>
                        </div>
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
        {viewDoc && viewDoc.payDocFileId && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-slate-400 text-sm">{viewDoc.company} — {viewDoc.order} — Закрыт: {viewDoc.payDate}</p>
              <button onClick={() => downloadFile(viewDoc.payDocFileId, `Платёжка_${viewDoc.order}.pdf`)}
                className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors">⬇ Скачать документ</button>
            </div>
            <a href={api.getFileUrl(viewDoc.payDocFileId)} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Открыть документ</a>
            {viewDoc.payComment && <p className="mt-3 text-slate-400 text-sm">Комментарий: {viewDoc.payComment}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
};

// ==================== ИНФРАСТРУКТУРЫ ====================
const Infrastructure = ({ balances, setBalances, pushLog, infraData, setInfraData, pendingTransfers, setPendingTransfers }) => {
  const [selectedAcc, setSelectedAcc] = useState(null);
  const [showPayment, setShowPayment] = useState(false);
  const [payment, setPayment] = useState({ from: "", to: "", amount: 0, desc: "", date: new Date().toISOString().split("T")[0] });
  const [editingComment, setEditingComment] = useState(null);
  const [editCommentVal, setEditCommentVal] = useState("");
  const [confirmTransfer, setConfirmTransfer] = useState(null);
  const [confirmFile, setConfirmFile] = useState(null);
  const [confirmFees, setConfirmFees] = useState({ sendFee: 0, receiveFee: 0 });
  const [exchangeRate, setExchangeRate] = useState(null);
  const [rateLoading, setRateLoading] = useState(false);

  const currencyToISO = (c) => ({ BAT: "THB" }[c?.toUpperCase()] || c?.toUpperCase());

  useEffect(() => {
    if (!payment.from || !payment.to) { setExchangeRate(null); return; }
    const fromAcc = balances.find((b) => b.name === payment.from);
    const toAcc = balances.find((b) => b.name === payment.to);
    if (!fromAcc || !toAcc) { setExchangeRate(null); return; }
    const fromISO = currencyToISO(fromAcc.currency);
    const toISO = currencyToISO(toAcc.currency);
    if (fromISO === toISO) { setExchangeRate(null); return; }
    setRateLoading(true);
    api.fetchExchangeRate(fromISO, toISO)
      .then((data) => setExchangeRate({ rate: data.rate, from: fromAcc.currency, to: toAcc.currency, fromISO, toISO }))
      .catch(() => setExchangeRate(null))
      .finally(() => setRateLoading(false));
  }, [payment.from, payment.to, balances]);

  const startEditComment = (op) => { setEditingComment(op.id); setEditCommentVal(op.comment || ""); };
  const saveComment = (opId) => {
    api.updateInfraComment(opId, editCommentVal).catch((e) => console.error("Ошибка сохранения комментария:", e));
    setEditingComment(null);
  };

  const isInternalTransfer = (fromName, toName) => {
    const fa = balances.find((b) => b.name === fromName);
    const ta = balances.find((b) => b.name === toName);
    return fa && ta && fa.group && ta.group && fa.group.toUpperCase() === ta.group.toUpperCase();
  };

  const processPayment = async () => {
    const amt = parseFloat(payment.amount) || 0;
    if (!payment.from || !amt) return;
    const fromAcc = balances.find((b) => b.name === payment.from);
    const toAcc = balances.find((b) => b.name === payment.to);
    const internal = payment.to && isInternalTransfer(payment.from, payment.to);
    const convertedAmt = exchangeRate ? Math.round(amt * exchangeRate.rate * 100) / 100 : amt;
    const receivedAmt = internal && exchangeRate ? convertedAmt : (exchangeRate ? convertedAmt : amt);

    pushLog({ type: "infra_payment", accName: payment.from, prev: fromAcc?.balance || 0 });
    setBalances((prev) => prev.map((b) => b.name === payment.from ? { ...b, balance: b.balance - amt } : b));

    if (payment.to && internal) {
      pushLog({ type: "infra_payment", accName: payment.to, prev: toAcc?.balance || 0 });
      setBalances((prev) => prev.map((b) => b.name === payment.to ? { ...b, balance: b.balance + receivedAmt } : b));

      const completedDate = payment.date || new Date().toISOString().split("T")[0];
      const transferData = {
        fromAcc: payment.from, toAcc: payment.to, amount: amt,
        currency: fromAcc?.currency || "USD", description: payment.desc,
        date: completedDate, status: "completed", completedAt: new Date().toISOString(),
      };
      if (exchangeRate && toAcc) {
        transferData.toCurrency = toAcc.currency;
        transferData.exchangeRate = exchangeRate.rate;
        transferData.convertedAmount = convertedAmt;
      }
      try {
        const saved = await api.createTransfer(transferData);
        saved.amount = parseFloat(saved.amount) || 0;
        saved.convertedAmount = parseFloat(saved.convertedAmount) || 0;
        saved.exchangeRate = parseFloat(saved.exchangeRate) || 0;
        const mappedTransfer = { ...saved, from: saved.fromAcc, to: saved.toAcc, desc: saved.description };
        setPendingTransfers((prev) => [...prev, mappedTransfer]);

        const poRef = extractPoRef(payment.desc);
        const transferDesc = poRef ? payment.desc : `TRANSFER FROM ${payment.from.toUpperCase()} TO ${payment.to.toUpperCase()}`;
        const rateNote = exchangeRate ? ` (${fromAcc.currency}→${toAcc.currency} @${exchangeRate.rate.toFixed(4)})` : "";
        const currentFromBal = (fromAcc?.balance || 0) - amt;
        const currentToBal = (toAcc?.balance || 0) + receivedAmt;

        const parseOp = (op) => { op.received = parseFloat(op.received) || 0; op.outgoing = parseFloat(op.outgoing) || 0; op.bankFees = parseFloat(op.bankFees) || 0; op.balance = parseFloat(op.balance) || 0; return op; };
        try {
          const outOp = parseOp(await api.createInfraOp({
            accountName: payment.from, poRef: poRef || "", description: transferDesc + rateNote,
            received: 0, outgoing: amt, bankFees: 0, supplier: "", invoice: "", date: completedDate, balance: currentFromBal, transferId: saved.id,
          }));
          setInfraData((prev) => ({ ...prev, [payment.from]: [...(prev[payment.from] || []), outOp] }));
        } catch (err) { console.error("Ошибка создания операции (откуда):", err); }
        try {
          const inOp = parseOp(await api.createInfraOp({
            accountName: payment.to, poRef: poRef || "", description: transferDesc + rateNote,
            received: receivedAmt, outgoing: 0, bankFees: 0, supplier: "", invoice: "", date: completedDate, balance: currentToBal, transferId: saved.id,
          }));
          setInfraData((prev) => ({ ...prev, [payment.to]: [...(prev[payment.to] || []), inOp] }));
        } catch (err) { console.error("Ошибка создания операции (куда):", err); }
      } catch (err) {
        console.error("Ошибка создания внутреннего перевода:", err);
      }

    } else if (payment.to) {
      const transferData = {
        fromAcc: payment.from, toAcc: payment.to, amount: amt,
        currency: fromAcc?.currency || "USD", description: payment.desc,
        date: payment.date, status: "pending",
      };
      if (exchangeRate && toAcc) {
        transferData.toCurrency = toAcc.currency;
        transferData.exchangeRate = exchangeRate.rate;
        transferData.convertedAmount = convertedAmt;
      }
      try {
        const saved = await api.createTransfer(transferData);
        saved.amount = parseFloat(saved.amount) || 0;
        saved.convertedAmount = parseFloat(saved.convertedAmount) || 0;
        saved.exchangeRate = parseFloat(saved.exchangeRate) || 0;
        setPendingTransfers((prev) => [...prev, { ...saved, from: saved.fromAcc, to: saved.toAcc, desc: saved.description }]);
      } catch (err) {
        console.error("Ошибка создания перевода:", err);
      }
    }
    setShowPayment(false);
    setExchangeRate(null);
    setPayment({ from: "", to: "", amount: 0, desc: "", date: new Date().toISOString().split("T")[0] });
  };

  const extractPoRef = (desc, fromAcc, toAcc) => {
    if (!desc) return null;
    const poMatch = desc.match(/[A-Z]{1,3}\d{2}-\d{3,5}/i);
    return poMatch ? poMatch[0].toUpperCase() : null;
  };

  const handleConfirmTransfer = async () => {
    if (!confirmTransfer || !confirmFile) return;
    const t = confirmTransfer;
    const sendFee = parseFloat(confirmFees.sendFee) || 0;
    const receiveFee = parseFloat(confirmFees.receiveFee) || 0;
    const isCrossCurrency = t.convertedAmount && t.convertedAmount > 0 && t.toCurrency;
    const receivedAmount = isCrossCurrency ? t.convertedAmount : t.amount;
    const netReceived = receivedAmount - receiveFee;

    pushLog({ type: "infra_payment", accName: t.to, prev: balances.find((b) => b.name === t.to)?.balance || 0 });
    setBalances((prev) => prev.map((b) => b.name === t.to ? { ...b, balance: b.balance + netReceived } : b));

    if (sendFee > 0) {
      pushLog({ type: "infra_payment", accName: t.from, prev: balances.find((b) => b.name === t.from)?.balance || 0 });
      setBalances((prev) => prev.map((b) => b.name === t.from ? { ...b, balance: b.balance - sendFee } : b));
    }

    let fileId = null;
    if (confirmFile.file) {
      try {
        const uploaded = await api.uploadFile(confirmFile.file, "statements", t.id);
        fileId = uploaded.id;
      } catch (err) {
        console.error("Ошибка загрузки выписки:", err);
      }
    }

    const poRef = extractPoRef(t.desc, t.from, t.to);
    const transferDesc = poRef ? t.desc : `TRANSFER FROM ${(t.from || "").toUpperCase()} TO ${(t.to || "").toUpperCase()}`;
    const completedDate = new Date().toISOString().split("T")[0];

    const currentFromBalance = balances.find((b) => b.name === t.from)?.balance || 0;
    const newFromBalance = currentFromBalance - sendFee;
    const currentToBalance = balances.find((b) => b.name === t.to)?.balance || 0;
    const newToBalance = currentToBalance + netReceived;

    const rateNote = isCrossCurrency ? ` (${t.currency}→${t.toCurrency} @${t.exchangeRate})` : "";

    const parseOp = (op) => {
      op.received = parseFloat(op.received) || 0;
      op.outgoing = parseFloat(op.outgoing) || 0;
      op.bankFees = parseFloat(op.bankFees) || 0;
      op.balance = parseFloat(op.balance) || 0;
      return op;
    };

    try {
      const outOp = parseOp(await api.createInfraOp({
        accountName: t.from,
        poRef: poRef || "",
        description: transferDesc + rateNote,
        received: 0,
        outgoing: t.amount,
        bankFees: sendFee,
        supplier: "",
        invoice: "",
        date: t.date || completedDate,
        balance: newFromBalance,
        transferId: t.id,
      }));
      setInfraData((prev) => ({ ...prev, [t.from]: [...(prev[t.from] || []), outOp] }));
    } catch (err) {
      console.error("Ошибка создания операции (откуда):", err);
    }

    try {
      const inOp = parseOp(await api.createInfraOp({
        accountName: t.to,
        poRef: poRef || "",
        description: transferDesc + rateNote,
        received: netReceived,
        outgoing: 0,
        bankFees: receiveFee,
        supplier: "",
        invoice: "",
        date: completedDate,
        balance: newToBalance,
        transferId: t.id,
      }));
      setInfraData((prev) => ({ ...prev, [t.to]: [...(prev[t.to] || []), inOp] }));
    } catch (err) {
      console.error("Ошибка создания операции (куда):", err);
    }

    const updates = { status: "completed", completedAt: new Date().toISOString(), fileName: confirmFile.name, fileId };
    api.updateTransfer(t.id, updates).catch((e) => console.error("Ошибка обновления перевода:", e));
    setPendingTransfers((prev) => prev.map((p) => p.id === t.id ? { ...p, ...updates } : p));
    setConfirmTransfer(null);
    setConfirmFile(null);
    setConfirmFees({ sendFee: 0, receiveFee: 0 });
  };

  const [cancelConfirm, setCancelConfirm] = useState(null);

  const cancelTransfer = async (t) => {
    const isDone = t.status === "completed";
    const expectedDesc = `TRANSFER FROM ${(t.from || "").toUpperCase()} TO ${(t.to || "").toUpperCase()}`;
    const poRef = t.desc ? t.desc.match(/[A-Z]{1,3}\d{2}-\d{3,5}/i)?.[0]?.toUpperCase() : null;

    const isRelatedOp = (op) =>
      op.transferId === t.id ||
      (op.description && op.description.toUpperCase() === expectedDesc) ||
      (poRef && op.description && op.description.toUpperCase() === t.desc.toUpperCase());

    setBalances((prev) => prev.map((b) => b.name === t.from ? { ...b, balance: b.balance + t.amount } : b));

    if (isDone) {
      const relatedOps = [];
      for (const [accName, ops] of Object.entries(infraData)) {
        for (const op of ops) {
          if (isRelatedOp(op)) relatedOps.push({ accName, opId: op.id, received: op.received, outgoing: op.outgoing, bankFees: op.bankFees });
        }
      }
      for (const op of relatedOps) {
        if (op.received > 0) {
          setBalances((prev) => prev.map((b) => b.name === op.accName ? { ...b, balance: b.balance - op.received } : b));
        }
        if (op.bankFees > 0) {
          setBalances((prev) => prev.map((b) => b.name === op.accName ? { ...b, balance: b.balance + op.bankFees } : b));
        }
      }

      try {
        await api.deleteInfraByTransfer(t.id, expectedDesc);
      } catch (err) {
        console.error("Ошибка удаления операций:", err);
      }
      setInfraData((prev) => {
        const next = { ...prev };
        for (const accName of Object.keys(next)) {
          next[accName] = next[accName].filter((op) => !isRelatedOp(op));
        }
        return next;
      });
    }

    try {
      await api.deleteTransfer(t.id);
    } catch (err) {
      console.error("Ошибка удаления перевода:", err);
    }
    setPendingTransfers((prev) => prev.filter((p) => p.id !== t.id));
    setCancelConfirm(null);
  };

  const [transferTab, setTransferTab] = useState("pending");
  const pendingCount = pendingTransfers.filter((t) => t.status === "pending" || !t.status).length;
  const completedCount = pendingTransfers.filter((t) => t.status === "completed").length;
  const cancelledCount = pendingTransfers.filter((t) => t.status === "cancelled").length;
  const filteredTransfers = [...pendingTransfers]
    .filter((t) => transferTab === "pending" ? (t.status === "pending" || !t.status) : t.status === "completed")
    .reverse();

  const safes = balances.filter((b) => b.name.includes("Сейф") || b.name.includes("Crypto"));
  const accounts = balances.filter((b) => !b.name.includes("Сейф") && !b.name.includes("Crypto"));
  const accOps = selectedAcc ? [...(infraData[selectedAcc] || [])].reverse() : [];

  const totalUSD = balances.filter((b) => b.currency === "USD").reduce((s, b) => s + b.balance, 0);
  const totalAccounts = accounts.length;

  return (
    <div className="space-y-4">
      {/* Сводные карточки */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-[#1E3A5F] rounded-xl p-4 border border-[#2A4A6F]">
          <div className="flex items-start justify-between mb-2">
            <span className="text-blue-200/70 text-xs font-medium uppercase tracking-wider">Общий баланс USD</span>
            <span className="text-xl">💰</span>
          </div>
          <div className={`text-2xl font-bold tracking-tight ${totalUSD < 0 ? "text-rose-400" : "text-white"}`}>${fmt(totalUSD)}</div>
          <div className="text-xs text-blue-300/60 mt-1">По всем USD-счетам</div>
        </div>
        <div className="bg-[#1E3A5F] rounded-xl p-4 border border-[#2A4A6F]">
          <div className="flex items-start justify-between mb-2">
            <span className="text-blue-200/70 text-xs font-medium uppercase tracking-wider">Счета</span>
            <span className="text-xl">🏦</span>
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">{totalAccounts}</div>
          <div className="text-xs text-blue-300/60 mt-1">Банковские счета</div>
        </div>
        <div className="bg-[#1E3A5F] rounded-xl p-4 border border-[#2A4A6F]">
          <div className="flex items-start justify-between mb-2">
            <span className="text-blue-200/70 text-xs font-medium uppercase tracking-wider">Сейф / Crypto</span>
            <span className="text-xl">🔐</span>
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">{safes.length}</div>
          <div className="text-xs text-blue-300/60 mt-1">Наличные и крипто</div>
        </div>
      </div>

      {/* Заголовок */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#1E3A5F]">Инфраструктуры и остатки</h2>
          <p className="text-xs text-gray-500">Балансы и операции по каждому счёту. Нажмите на карточку для просмотра операций.</p>
        </div>
        <button onClick={() => setShowPayment(true)} className="px-4 py-2 bg-[#1E3A5F] hover:bg-[#2A4A6F] text-white rounded-lg text-sm font-medium border border-[#2A4A6F] transition-colors">💳 Провести платёж</button>
      </div>

      {/* Сейф / Crypto */}
      {safes.length > 0 && (
        <div className="rounded-xl shadow-lg overflow-hidden border border-[#1E3A5F]/30">
          <div className="bg-[#1E3A5F] px-5 py-3">
            <h3 className="text-white font-semibold text-sm">Сейф / Crypto</h3>
          </div>
          <div className="bg-white p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
            {safes.map((b) => (
              <div key={b.id} onClick={() => setSelectedAcc(selectedAcc === b.name ? null : b.name)}
                className={`rounded-xl border-2 p-4 cursor-pointer transition-all hover:shadow-md ${
                  selectedAcc === b.name ? "border-[#1E3A5F] bg-blue-50 shadow-md" : "border-gray-200 hover:border-[#1E3A5F]/50"
                }`}>
                <h4 className="text-[#1E3A5F] font-semibold text-sm mb-2">{b.name}</h4>
                <div className={`text-xl font-bold tabular-nums ${b.balance < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {fmt(b.balance, b.currency)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Банковские счета */}
      <div className="rounded-xl shadow-lg overflow-hidden border border-[#1E3A5F]/30">
        <div className="bg-[#1E3A5F] px-5 py-3">
          <h3 className="text-white font-semibold text-sm">Банковские счета</h3>
        </div>
        <div className="bg-white p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {accounts.map((b) => (
            <div key={b.id} onClick={() => setSelectedAcc(selectedAcc === b.name ? null : b.name)}
              className={`rounded-xl border-2 p-4 cursor-pointer transition-all hover:shadow-md ${
                selectedAcc === b.name ? "border-[#1E3A5F] bg-blue-50 shadow-md" : "border-gray-200 hover:border-[#1E3A5F]/50"
              }`}>
              <h4 className="text-[#1E3A5F] font-semibold text-sm mb-1">{b.name}</h4>
              <div className="text-xs text-gray-400 mb-2">{b.group} · {b.currency}</div>
              <div className={`text-xl font-bold tabular-nums ${b.balance < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                {fmt(b.balance, b.currency)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Журнал переводов */}
      {pendingTransfers.length > 0 && (
        <div className="rounded-xl shadow-lg overflow-hidden border border-[#1E3A5F]/30">
          <div className="bg-[#1E3A5F] px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-white font-semibold text-sm">Журнал переводов</h3>
              <div className="flex rounded-lg overflow-hidden border border-white/20">
                <button onClick={() => setTransferTab("pending")}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${transferTab === "pending" ? "bg-amber-500 text-white" : "bg-transparent text-white/60 hover:text-white"}`}>
                  В пути {pendingCount > 0 && `(${pendingCount})`}
                </button>
                <button onClick={() => setTransferTab("completed")}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${transferTab === "completed" ? "bg-emerald-500 text-white" : "bg-transparent text-white/60 hover:text-white"}`}>
                  Выполненные {completedCount > 0 && `(${completedCount})`}
                </button>
              </div>
            </div>
          </div>
          <div className="bg-white p-4 space-y-3">
            {filteredTransfers.length === 0 && (
              <div className="text-center text-gray-400 text-sm py-6">
                {transferTab === "pending" ? "Нет переводов в пути" : "Нет выполненных переводов"}
              </div>
            )}
            {filteredTransfers.map((t) => {
              const isDone = t.status === "completed";
              return (
                <div key={t.id} className={`rounded-xl border p-4 flex items-center justify-between gap-4 flex-wrap transition-colors ${
                  isDone ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"
                }`}>
                  <div className="flex items-center gap-3 flex-1 min-w-[280px]">
                    <div className="text-right">
                      <div className="text-xs text-gray-400 mb-0.5">Откуда</div>
                      <div className="text-sm font-semibold text-rose-600">{t.from}</div>
                    </div>
                    <div className={`text-xl ${isDone ? "text-emerald-500" : "text-amber-500"}`}>→</div>
                    <div>
                      <div className="text-xs text-gray-400 mb-0.5">Куда</div>
                      <div className="text-sm font-semibold text-emerald-600">{t.to}</div>
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-400 mb-0.5">Сумма</div>
                    <div className="text-lg font-bold tabular-nums text-[#1E3A5F]">{fmt(t.amount, t.currency)}</div>
                    {t.convertedAmount > 0 && t.toCurrency && (
                      <div className="text-xs text-cyan-600 font-medium">= {fmt(t.convertedAmount, t.toCurrency)}</div>
                    )}
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-400 mb-0.5">Дата отправки</div>
                    <div className="text-sm text-gray-700">{t.date}</div>
                  </div>
                  <div className="text-center min-w-[100px]">
                    {isDone && (
                      <>
                        <div className="text-xs font-semibold text-emerald-600 mb-0.5">✓ Исполнен</div>
                        <div className="text-[10px] text-gray-400">{new Date(t.completedAt).toLocaleDateString("ru-RU")}</div>
                        {t.fileName && (
                          <button onClick={() => downloadFile(t.fileId || t.fileData, t.fileName)}
                            className="text-[10px] text-blue-500 hover:text-blue-700 font-medium truncate max-w-[120px]" title={`Скачать: ${t.fileName}`}>
                            📎 {t.fileName} ⬇
                          </button>
                        )}
                      </>
                    )}
                    {(t.status === "pending" || !t.status) && <div className="text-xs font-semibold text-amber-600">⏳ В пути</div>}
                  </div>
                  {t.desc && <div className="text-xs text-gray-500 basis-full">{t.desc}</div>}
                  <div className="flex gap-2 basis-full justify-end">
                    {(t.status === "pending" || !t.status) && (
                      <button onClick={() => { setConfirmTransfer(t); setConfirmFile(null); setConfirmFees({ sendFee: 0, receiveFee: 0 }); }}
                        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-medium transition-colors">
                        Подтвердить получение
                      </button>
                    )}
                    {cancelConfirm === t.id ? (
                      <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">
                        <span className="text-xs text-rose-700">Отменить перевод{isDone ? " и откатить операции" : ""}?</span>
                        <button onClick={() => cancelTransfer(t)}
                          className="px-3 py-1 bg-rose-500 hover:bg-rose-600 text-white rounded text-xs font-medium transition-colors">
                          Да
                        </button>
                        <button onClick={() => setCancelConfirm(null)}
                          className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded text-xs font-medium transition-colors">
                          Нет
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setCancelConfirm(t.id)}
                        className="px-3 py-2 bg-gray-100 hover:bg-rose-50 text-gray-500 hover:text-rose-600 rounded-lg text-xs font-medium transition-colors">
                        Отменить
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Модалка подтверждения перевода */}
      <Modal isOpen={!!confirmTransfer} onClose={() => { setConfirmTransfer(null); setConfirmFile(null); setConfirmFees({ sendFee: 0, receiveFee: 0 }); }} title="Подтверждение получения перевода">
        {confirmTransfer && (
          <div className="space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-blue-300 text-sm">
              Для зачисления средств приложите банковскую выписку. Укажите комиссии банка (если есть).
            </div>
            <div className="bg-slate-700/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Откуда:</span>
                <span className="text-rose-400 font-medium">{confirmTransfer.from}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Куда:</span>
                <span className="text-emerald-400 font-medium">{confirmTransfer.to}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Сумма перевода:</span>
                <span className="text-white font-bold">{fmt(confirmTransfer.amount, confirmTransfer.currency)}</span>
              </div>
              {confirmTransfer.convertedAmount > 0 && confirmTransfer.toCurrency && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Курс:</span>
                    <span className="text-cyan-300 font-medium">1 {confirmTransfer.currency} = {confirmTransfer.exchangeRate} {confirmTransfer.toCurrency}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">К зачислению:</span>
                    <span className="text-emerald-400 font-bold">{fmt(confirmTransfer.convertedAmount, confirmTransfer.toCurrency)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Дата отправки:</span>
                <span className="text-white">{confirmTransfer.date}</span>
              </div>
              {confirmTransfer.desc && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Описание:</span>
                  <span className="text-white">{confirmTransfer.desc}</span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Комиссия отправки ({confirmTransfer.from})</label>
                <input type="number" min="0" step="0.01" value={confirmFees.sendFee || ""}
                  onChange={(e) => setConfirmFees((p) => ({ ...p, sendFee: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Комиссия получения ({confirmTransfer.to})</label>
                <input type="number" min="0" step="0.01" value={confirmFees.receiveFee || ""}
                  onChange={(e) => setConfirmFees((p) => ({ ...p, receiveFee: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>
            {(parseFloat(confirmFees.sendFee) > 0 || parseFloat(confirmFees.receiveFee) > 0) && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-amber-300 text-xs space-y-1">
                {parseFloat(confirmFees.sendFee) > 0 && (
                  <div>Комиссия отправки: {fmt(parseFloat(confirmFees.sendFee))} — спишется с {confirmTransfer.from}</div>
                )}
                {parseFloat(confirmFees.receiveFee) > 0 && (
                  <div>Комиссия получения: {fmt(parseFloat(confirmFees.receiveFee))} — удержится из суммы на {confirmTransfer.to}</div>
                )}
                <div className="font-medium pt-1 border-t border-amber-500/20">
                  Зачислится на {confirmTransfer.to}: {fmt(
                    (confirmTransfer.convertedAmount > 0 ? confirmTransfer.convertedAmount : confirmTransfer.amount) - (parseFloat(confirmFees.receiveFee) || 0),
                    confirmTransfer.toCurrency || confirmTransfer.currency
                  )}
                </div>
              </div>
            )}
            <div>
              <label className="text-xs text-slate-400 mb-2 block">Банковская выписка (обязательно)</label>
              <label className={`flex items-center justify-center gap-2 py-4 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                confirmFile ? "border-emerald-500/50 bg-emerald-500/10" : "border-slate-600 hover:border-blue-500/50 hover:bg-blue-500/5"
              }`}>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setConfirmFile({ name: f.name, file: f }); }
                }} />
                {confirmFile
                  ? <span className="text-emerald-400 text-sm font-medium">✓ {confirmFile.name}</span>
                  : <span className="text-slate-400 text-sm">📎 Нажмите для загрузки файла</span>}
              </label>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => { setConfirmTransfer(null); setConfirmFile(null); setConfirmFees({ sendFee: 0, receiveFee: 0 }); }} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Отмена</button>
              <button onClick={handleConfirmTransfer} disabled={!confirmFile}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${
                  confirmFile ? "bg-emerald-500 hover:bg-emerald-600 text-white" : "bg-slate-700 text-slate-500 cursor-not-allowed"
                }`}>
                Подтвердить зачисление
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Таблица операций выбранного счёта */}
      {selectedAcc && (
        <div className="rounded-xl shadow-lg overflow-hidden border border-[#1E3A5F]/30">
          <div className="bg-[#1E3A5F] px-5 py-3 flex items-center justify-between">
            <h3 className="text-white font-semibold text-sm">Операции: {selectedAcc}</h3>
            <button onClick={() => setSelectedAcc(null)} className="text-white/60 hover:text-white text-lg transition-colors">&times;</button>
          </div>
          {accOps.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#1E3A5F]/10 text-[#1E3A5F] text-center text-xs uppercase">
                    <th className="py-2.5 px-3 font-semibold">PO / Описание</th>
                    <th className="py-2.5 px-3 font-semibold">Приход</th>
                    <th className="py-2.5 px-3 font-semibold">Расход</th>
                    <th className="py-2.5 px-3 font-semibold">Комиссии</th>
                    <th className="py-2.5 px-3 font-semibold">Поставщик</th>
                    <th className="py-2.5 px-3 font-semibold">Инвойс</th>
                    <th className="py-2.5 px-3 font-semibold">Дата</th>
                    <th className="py-2.5 px-3 font-semibold">Остаток</th>
                    <th className="py-2.5 px-3 font-semibold">Комментарий</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {accOps.map((op, idx) => (
                    <tr key={op.id} className={`border-b border-gray-200 hover:bg-blue-50 transition-colors ${idx % 2 === 1 ? "bg-gray-50" : ""}`}>
                      <td className="py-2 px-3 text-center text-gray-800 font-mono text-xs max-w-[180px]">
                        {op.poRef
                          ? <span className="whitespace-pre-line">{op.poRef}</span>
                          : op.description
                            ? <span className="text-blue-600 italic text-xs">{op.description}</span>
                            : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2 px-3 text-center text-emerald-600 font-semibold tabular-nums text-xs">{op.received ? "+" + fmt(op.received) : ""}</td>
                      <td className="py-2 px-3 text-center text-rose-600 font-semibold tabular-nums text-xs">{op.outgoing ? "-" + fmt(op.outgoing) : ""}</td>
                      <td className="py-2 px-3 text-center text-amber-600 text-xs tabular-nums">{op.bankFees ? fmt(op.bankFees) : ""}</td>
                      <td className="py-2 px-3 text-center text-gray-700 text-xs max-w-[150px] whitespace-pre-line">{op.supplier || "—"}</td>
                      <td className="py-2 px-3 text-center text-gray-500 font-mono text-xs">{op.invoice || "—"}</td>
                      <td className="py-2 px-3 text-center text-gray-500 text-xs whitespace-nowrap">{op.date || "—"}</td>
                      <td className={`py-2 px-3 text-center font-semibold tabular-nums text-xs ${op.balance < 0 ? "text-rose-600" : "text-gray-900"}`}>
                        {op.balance !== 0 ? fmt(op.balance) : "—"}
                      </td>
                      <td className="py-2 px-3 text-xs max-w-[220px]">
                        {editingComment === op.id ? (
                          <textarea autoFocus value={editCommentVal} onChange={(e) => setEditCommentVal(e.target.value)}
                            onBlur={() => saveComment(op.id)}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveComment(op.id); } if (e.key === "Escape") setEditingComment(null); }}
                            className="w-full min-w-[180px] px-2 py-1 border border-blue-400 rounded text-xs text-gray-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y" rows={2} />
                        ) : (
                          <span onClick={() => startEditComment(op)}
                            className={`cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 inline-block min-w-[60px] ${op.comment ? "text-gray-600" : "text-gray-300 italic"}`}>
                            {op.comment || "добавить..."}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-white p-8 text-center text-gray-400 text-sm">Нет данных об операциях</div>
          )}
          <div className="p-3 text-xs text-gray-500 border-t border-gray-200 bg-gray-50">
            Всего {accOps.length} операций
          </div>
        </div>
      )}

      <Modal isOpen={showPayment} onClose={() => setShowPayment(false)} title="Провести перевод">
        <div className="space-y-4">
          {(() => {
            const internal = payment.from && payment.to && isInternalTransfer(payment.from, payment.to);
            return (
              <div className={`border rounded-lg p-3 text-sm ${internal ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "bg-blue-500/10 border-blue-500/20 text-blue-300"}`}>
                {internal
                  ? "Внутренний перевод — зачисление мгновенное, платёжка не требуется."
                  : "Внешний перевод — деньги спишутся сразу, зачисление после подтверждения с банковской выпиской."}
              </div>
            );
          })()}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Счёт списания (откуда)</label>
            <select value={payment.from} onChange={(e) => setPayment({ ...payment, from: e.target.value })} className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white">
              <option value="">Выберите...</option>
              {balances.map((b) => <option key={b.id} value={b.name}>{b.name} ({b.currency})</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Счёт зачисления (куда)</label>
            <select value={payment.to} onChange={(e) => setPayment({ ...payment, to: e.target.value })} className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-white">
              <option value="">Выберите...</option>
              {balances.filter((b) => b.name !== payment.from).map((b) => <option key={b.id} value={b.name}>{b.name} ({b.currency})</option>)}
            </select>
          </div>
          {payment.from && payment.to && (
            <div className="bg-slate-700/30 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-center gap-3 text-sm">
                <span className="text-rose-400 font-medium">{payment.from}</span>
                <span className="text-amber-400 text-lg">→</span>
                <span className="text-emerald-400 font-medium">{payment.to}</span>
              </div>
              {rateLoading && <div className="text-center text-xs text-slate-400">Загрузка курса...</div>}
              {exchangeRate && (
                <div className="text-center text-xs">
                  <span className="text-cyan-300 font-medium">1 {exchangeRate.from} = {exchangeRate.rate.toFixed(4)} {exchangeRate.to}</span>
                </div>
              )}
            </div>
          )}
          <InputField label={`Сумма${exchangeRate ? ` (${balances.find((b) => b.name === payment.from)?.currency || ""})` : ""}`} value={payment.amount} onChange={(v) => setPayment({ ...payment, amount: v })} type="number" />
          {exchangeRate && parseFloat(payment.amount) > 0 && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-emerald-300 text-sm text-center">
              {fmt(parseFloat(payment.amount))} {exchangeRate.from} = <span className="font-bold">{fmt(Math.round(parseFloat(payment.amount) * exchangeRate.rate * 100) / 100)} {exchangeRate.to}</span>
            </div>
          )}
          <InputField label="Описание" value={payment.desc} onChange={(v) => setPayment({ ...payment, desc: v })} />
          <InputField label="Дата" value={payment.date} onChange={(v) => setPayment({ ...payment, date: v })} type="date" />
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowPayment(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Отмена</button>
            <button onClick={processPayment} disabled={!payment.from || !payment.to || !(parseFloat(payment.amount) > 0)}
              className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${
                payment.from && payment.to && parseFloat(payment.amount) > 0
                  ? "bg-emerald-500 hover:bg-emerald-600 text-white" : "bg-slate-700 text-slate-500 cursor-not-allowed"
              }`}>
              {payment.from && payment.to && isInternalTransfer(payment.from, payment.to) ? "Перевести мгновенно" : "Провести"}
            </button>
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
      {/* Инструкция */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
        <h3 className="text-[#1E3A5F] font-semibold text-base mb-4 flex items-center gap-2">
          <span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center text-lg">💳</span>
          Импорт банковских платёжек
        </h3>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5 text-sm text-blue-800">
          <p className="font-semibold mb-2">Инструкция:</p>
          <ol className="space-y-1 list-decimal list-inside text-blue-700">
            <li>Скопируйте данные из банковской выписки (CSV; разделитель — точка с запятой)</li>
            <li>Первая строка — заголовки, остальные — данные</li>
            <li>Нажмите «Распарсить», назначьте инфраструктуру и тип каждой строке</li>
            <li>Нажмите «Импортировать» для зачисления</li>
          </ol>
        </div>
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1.5 block uppercase tracking-wider">Вставьте данные выписки</label>
          <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)}
            placeholder={"Дата;Описание;Сумма;Валюта\n2026-03-01;Оплата WENCOR;3500;USD"}
            className="w-full h-36 px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 font-mono placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none" />
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={parseCSV} disabled={!csvText.trim()}
            className="px-5 py-2.5 bg-[#1E3A5F] hover:bg-[#2A4A6F] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">
            Распарсить
          </button>
        </div>
      </div>

      {/* Таблица распознанных операций */}
      {parsedRows.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-[#1E3A5F] font-semibold text-base">
              Распознанные операции <span className="text-gray-400 font-normal">({parsedRows.length})</span>
            </h3>
            <button onClick={importAll}
              className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors">
              Импортировать
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#1E3A5F] text-white text-center text-xs uppercase">
                  {Object.keys(parsedRows[0]).filter((k) => !k.startsWith("_")).map((h) => (
                    <th key={h} className="py-2.5 px-3 font-semibold">{h}</th>
                  ))}
                  <th className="py-2.5 px-3 font-semibold">Инфраструктура</th>
                  <th className="py-2.5 px-3 font-semibold">Тип</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {parsedRows.map((row, idx) => (
                  <tr key={row._id} className={`border-b border-gray-200 hover:bg-blue-50 transition-colors ${idx % 2 === 1 ? "bg-gray-50" : ""}`}>
                    {Object.entries(row).filter(([k]) => !k.startsWith("_")).map(([k, v]) => (
                      <td key={k} className="py-2.5 px-3 text-center text-gray-700 text-xs">{v}</td>
                    ))}
                    <td className="py-2.5 px-3 text-center">
                      <select value={row._infra} onChange={(e) => updateRow(row._id, "_infra", e.target.value)}
                        className="px-2 py-1.5 bg-white border border-gray-300 rounded-lg text-xs text-gray-700 focus:outline-none focus:border-blue-500">
                        <option value="">— Выберите —</option>
                        {balances.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
                      </select>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <select value={row._type} onChange={(e) => updateRow(row._id, "_type", e.target.value)}
                        className="px-2 py-1.5 bg-white border border-gray-300 rounded-lg text-xs text-gray-700 focus:outline-none focus:border-blue-500">
                        <option value="income">Приход</option>
                        <option value="expense">Расход</option>
                      </select>
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
};

// ==================== MAIN APP ====================
export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [balances, setBalances] = useState([]);
  const [debts, setDebts] = useState([]);
  const [finResults, setFinResults] = useState([]);
  const [openPo, setOpenPo] = useState([]);
  const [infraData, setInfraData] = useState({});
  const [pendingTransfersGlobal, setPendingTransfersGlobal] = useState([]);
  const [actionLog, setActionLog] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [poRaw, fin, dbt, bal, infra, transfers] = await Promise.all([
          api.fetchPO(), api.fetchFin(), api.fetchDebts(),
          api.fetchBalances(), api.fetchInfra(), api.fetchTransfers(),
        ]);
        setOpenPo(poRaw.map((r) => ({
          ...r,
          customerAmount: parseFloat(r.customerAmount) || 0,
          supplierAmount: parseFloat(r.supplierAmount) || 0,
          deliveryCost: r.deliveryCost,
          orderStage: r.orderStage || (r.status === "completed" ? "done" : r.status === "cancelled" ? "cancelled" : "in_work"),
        })));
        setFinResults(fin.map((r) => ({
          ...r,
          customerAmount: parseFloat(r.customerAmount) || 0,
          supplierAmount: parseFloat(r.supplierAmount) || 0,
          paymentFact: parseFloat(r.paymentFact) || 0,
          paymentWithAgent: parseFloat(r.paymentWithAgent) || 0,
          customsCost: parseFloat(r.customsCost) || 0,
          deliveryCost: parseFloat(r.deliveryCost) || 0,
          margin: parseFloat(r.margin) || 0,
          netProfit: parseFloat(r.netProfit) || 0,
        })));
        setDebts(dbt.map((r) => ({ ...r, amount: parseFloat(r.amount) || 0 })));
        setBalances(bal.map((r) => ({ ...r, balance: parseFloat(r.balance) || 0 })));
        setInfraData(Object.fromEntries(
          Object.entries(infra).map(([k, ops]) => [k, ops.map((o) => ({
            ...o,
            received: parseFloat(o.received) || 0,
            outgoing: parseFloat(o.outgoing) || 0,
            bankFees: parseFloat(o.bankFees) || 0,
            balance: parseFloat(o.balance) || 0,
          }))])
        ));
        setPendingTransfersGlobal(transfers.map((t) => ({
          ...t,
          amount: parseFloat(t.amount) || 0,
          exchangeRate: parseFloat(t.exchangeRate) || 0,
          convertedAmount: parseFloat(t.convertedAmount) || 0,
          from: t.fromAcc || t.from || "",
          to: t.toAcc || t.to || "",
          desc: t.description || t.desc || "",
        })));
      } catch (err) {
        console.error("Ошибка загрузки данных:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const makeSyncSetter = useCallback((rawSetter, updateFn, deleteFn) => {
    return (updater) => {
      rawSetter((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        setTimeout(() => {
          const prevMap = new Map(prev.map((r) => [r.id, r]));
          const nextMap = new Map(next.map((r) => [r.id, r]));
          for (const [id, item] of nextMap) {
            const old = prevMap.get(id);
            if (old && old !== item) {
              const changes = {};
              for (const [k, v] of Object.entries(item)) {
                if (v !== old[k]) changes[k] = v;
              }
              if (Object.keys(changes).length > 0) {
                updateFn(id, changes).catch((e) => console.error("Sync update error:", e));
              }
            }
          }
          for (const [id] of prevMap) {
            if (!nextMap.has(id) && deleteFn) {
              deleteFn(id).catch((e) => console.error("Sync delete error:", e));
            }
          }
        }, 0);
        return next;
      });
    };
  }, []);

  const syncOpenPo = useMemo(() => makeSyncSetter(setOpenPo, api.updatePO, api.deletePO), [makeSyncSetter]);
  const syncFinResults = useMemo(() => makeSyncSetter(setFinResults, api.updateFin, api.deleteFin), [makeSyncSetter]);
  const syncDebts = useMemo(() => makeSyncSetter(setDebts, api.updateDebt, null), [makeSyncSetter]);
  const syncBalances = useMemo(() => makeSyncSetter(setBalances, (id, data) => api.updateBalance(id, data.balance), null), [makeSyncSetter]);

  const pushLog = useCallback((a) => setActionLog((prev) => [...prev, a]), []);

  const undo = () => {
    if (!actionLog.length) return;
    const last = actionLog[actionLog.length - 1];
    if (last.type === "fin_status") syncFinResults((prev) => prev.map((r) => (r.id === last.id ? { ...r, status: last.prev } : r)));
    if (last.type === "fin_upd") syncFinResults((prev) => prev.map((r) => (r.id === last.id ? { ...r, ...last.prev, updFileId: null } : r)));
    if (last.type === "fin_payment") syncFinResults((prev) => prev.map((r) => (r.id === last.id ? { ...r, paymentFact: last.prev.paymentFact, paymentDocFileId: null, paymentDate: "" } : r)));
    if (last.type === "fin_edit") syncFinResults((prev) => prev.map((r) => (r.id === last.id ? { ...last.prev } : r)));
    if (last.type === "fin_delete") syncFinResults((prev) => [...prev, last.prev]);
    if (last.type === "po_status" || last.type === "po_cancel") syncOpenPo((prev) => prev.map((r) => (r.id === last.id ? { ...r, status: last.prev?.status || last.prev, cancelReason: last.prev?.cancelReason || "" } : r)));
    if (last.type === "po_upd") syncOpenPo((prev) => prev.map((r) => (r.id === last.id ? { ...r, ...last.prev, updFileId: null } : r)));
    if (last.type === "po_edit") syncOpenPo((prev) => prev.map((r) => (r.id === last.id ? { ...last.prev } : r)));
    if (last.type === "po_inline_edit") syncOpenPo((prev) => prev.map((r) => (r.id === last.id ? { ...r, [last.field]: last.prev } : r)));
    if (last.type === "po_logistics") syncOpenPo((prev) => prev.map((r) => (r.id === last.id ? { ...r, ...last.prev } : r)));
    if (last.type === "po_stage") syncOpenPo((prev) => prev.map((r) => (r.id === last.id ? { ...r, orderStage: last.prev, status: last.prevStatus || "active" } : r)));
    if (last.type === "po_delete") syncOpenPo((prev) => [...prev, last.prev]);
    if (last.type === "debt_close") syncDebts((prev) => prev.map((d) => (d.id === last.id ? { ...d, ...last.prev } : d)));
    if (last.type === "infra_payment") syncBalances((prev) => prev.map((b) => (b.name === last.accName ? { ...b, balance: last.prev } : b)));
    setActionLog((prev) => prev.slice(0, -1));
  };

  const activePO = openPo.filter((r) => r.status === "active").length;
  const autoDebtsCount = useMemo(() => getAutoDebts(finResults, debts, openPo), [finResults, debts, openPo]);
  const openDebts = debts.filter((d) => d.status === "open" && d.amount > 0).length + autoDebtsCount.length;

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
          {loading ? (
            <div className="flex flex-col items-center justify-center py-32">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <div className="text-gray-500 text-sm">Загрузка данных...</div>
            </div>
          ) : (<>
          {activeTab === "dashboard" && <Dashboard balances={balances} debts={debts} finResults={finResults} openPo={openPo} infraData={infraData} />}
          {activeTab === "fin" && <FinResults data={finResults} setData={syncFinResults} pushLog={pushLog} debts={debts} setDebts={syncDebts} />}
          {activeTab === "openpo" && <OpenPO data={openPo} setData={syncOpenPo} pushLog={pushLog} finResults={finResults} setFinResults={syncFinResults} />}
          {activeTab === "debts" && <Debts debts={debts} setDebts={syncDebts} pushLog={pushLog} finResults={finResults} setFinResults={syncFinResults} openPo={openPo} />}
          {activeTab === "infra" && <Infrastructure balances={balances} setBalances={syncBalances} pushLog={pushLog} infraData={infraData} setInfraData={setInfraData} pendingTransfers={pendingTransfersGlobal} setPendingTransfers={setPendingTransfersGlobal} />}
          {activeTab === "import" && <BankImport balances={balances} setBalances={syncBalances} />}
          </>)}
        </div>
      </div>
    </div>
  );
}
