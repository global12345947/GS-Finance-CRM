// Дебиторская задолженность — актуальные данные
// Всего записей: 30 (без строк ИТОГО)
// Общая сумма: $1,662,728.33

export const DEBTS_DATA = [
  // A-tech — 8 заказов, итого $98,408.00
  { id: 1, company: "A-tech", order: "P2710225", amount: 23760, dueDate: "2025-12-22", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 2, company: "A-tech", order: "P2722725", amount: 23193, dueDate: "2026-01-13", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 3, company: "A-tech", order: "P2760125", amount: 5568, dueDate: "2026-01-28", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 4, company: "A-tech", order: "P2764725", amount: 5859, dueDate: "2026-01-27", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 5, company: "A-tech", order: "P2769525", amount: 2222, dueDate: "2026-01-27", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 6, company: "A-tech", order: "P2668525", amount: 6681, dueDate: "2025-12-22", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 7, company: "A-tech", order: "P2687125", amount: 26502, dueDate: "2025-12-25", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 8, company: "A-tech", order: "P2831026", amount: 4623, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },

  // RApart — 1 заказ, итого $178,066.00
  { id: 9, company: "RApart", order: "00KA-026402", amount: 178066, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },

  // N-W Aircompany — 1 заказ, итого $530,000.00
  { id: 10, company: "N-W Aircompany", order: "2026-224 R0", amount: 530000, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },

  // Utair — 11 заказов, итого $282,129.33
  { id: 11, company: "Utair", order: "P18556825", amount: 15300, dueDate: "2026-01-24", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 12, company: "Utair", order: "P19278126", amount: 135000, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 13, company: "Utair", order: "P19123826", amount: 6497, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 14, company: "Utair", order: "P19149826", amount: 2452.16, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 15, company: "Utair", order: "P19134526", amount: 15000, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 16, company: "Utair", order: "P19064826", amount: 46000, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 17, company: "Utair", order: "P19226826", amount: 1474.40, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 18, company: "Utair", order: "P18985326", amount: 2660.32, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 19, company: "Utair", order: "P19087426", amount: 3884.85, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 20, company: "Utair", order: "P19125526", amount: 3860.60, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 21, company: "Utair", order: "P19232826", amount: 50000, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },

  // S7 — 1 заказ, итого $5,625.00
  { id: 22, company: "S7", order: "P20488926", amount: 5625, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },

  // RusJet Technic — 1 заказ, итого $75,000.00
  { id: 23, company: "RusJet Technic", order: "P1902261502", amount: 75000, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },

  // Belavia — 6 дополнений, итого $493,500.00
  { id: 24, company: "Belavia", order: "ДОПОЛНЕНИЕ № 14", amount: 45600, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 25, company: "Belavia", order: "ДОПОЛНЕНИЕ № 16", amount: 306000, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 26, company: "Belavia", order: "ДОПОЛНЕНИЕ № 10", amount: 82300, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 27, company: "Belavia", order: "ДОПОЛНЕНИЕ № 18", amount: 29300, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 28, company: "Belavia", order: "ДОПОЛНЕНИЕ № 7", amount: 15600, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
  { id: 29, company: "Belavia", order: "ДОПОЛНЕНИЕ № 19", amount: 14700, dueDate: "", upd: "", currency: "USD", status: "open", payDoc: null, payDate: "", payComment: "" },
];
