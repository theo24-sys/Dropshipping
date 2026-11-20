/* ============================================================
   MORGGY store configuration
   Internal pricing currency is USD. Local currencies are display
   estimates computed from `fx` (local units per 1 USD).
   Update fx rates here; no other file needs to change.
   ============================================================ */
window.MORGGY = {
  brand: {
    name: "MORGGY",
    tagline: "Discover more. Live better.",
    legalName: "Morggy Technologies",
    city: "Nairobi",
    country: "Kenya",
    email: "hello@morggy.com",
    ordersEmail: "orders@morggy.com",
    whatsapp: "254700000000",   // country code + number, digits only. Replace before launch.
    hours: "Mon–Fri, 08:00–18:00 EAT"
  },

  baseCurrency: "USD",
  defaultMarket: "SG",

  /* --- Markets -------------------------------------------------
     status: "live" accepts orders · "waitlist" shows a notice
     and blocks checkout.
     ------------------------------------------------------------ */
  markets: {
    SG: {
      name: "Singapore",
      status: "live",
      currency: "SGD",
      symbol: "S$",
      locale: "en-SG",
      fx: 1.35,                 // 1 USD = 1.35 SGD
      fxUpdatedAt: "2026-11-01",
      decimals: 2,
      shipping: { flat: 3.9, perAdditionalItem: 1.2, eta: [5, 9], courier: "International tracked parcel" },
      taxNote: "Singapore GST and any import charges are set by Singapore Customs and are not included in our prices. If your parcel is assessed, the courier will collect the amount on delivery.",
      addressFields: ["line1", "line2", "postalCode"],
      /* keys must match addressFieldsHTML in app.js */
      postalExample: "238823 (6 digits)"
    },
    MY: {
      name: "Malaysia",
      status: "live",
      currency: "MYR",
      symbol: "RM",
      locale: "ms-MY",
      fx: 4.7,                  // 1 USD = 4.7 MYR
      fxUpdatedAt: "2026-11-01",
      decimals: 2,
      shipping: { flat: 4.9, perAdditionalItem: 1.5, eta: [6, 10], courier: "International tracked parcel" },
      taxNote: "Malaysian sales tax (SST) and any import charges are set by the Royal Malaysian Customs Department and are not included in our prices. If your parcel is assessed, the courier will collect the amount on delivery.",
      addressFields: ["line1", "line2", "city", "postalCode", "state"],
      postalExample: "50450 (5 digits)",
      states: ["Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka", "Negeri Sembilan", "Pahang", "Penang", "Perak", "Perlis", "Putrajaya", "Sabah", "Sarawak", "Selangor", "Terengganu"]
    },
    VN: {
      name: "Vietnam",
      status: "waitlist",
      currency: "VND",
      symbol: "₫",
      suffixSymbol: true,
      locale: "vi-VN",
      fx: 26300,
      fxUpdatedAt: "2026-11-01",
      decimals: 0,
      shipping: { flat: null, perAdditionalItem: null, eta: null, courier: null },
      taxNote: "Vietnam is not yet open for orders.",
      addressFields: [],
      postalExample: ""
    }
  },

  /* --- Integrations -------------------------------------------
     apiBase stays empty until the Django backend is deployed.
     With no apiBase: no order is created, no payment is taken.
     ------------------------------------------------------------ */
  apiBase: "",
  payments: {
    enabled: false,             // must stay false until gateway + webhook verification exist
    providers: ["paystack", "flutterwave"],
    modes: { paystack: "test", flutterwave: "test" }
  },
  supplier: {
    name: "CJdropshipping",
    syncEnabled: false,
    lastSyncAt: null
  },
  newsletter: { enabled: false }
};
