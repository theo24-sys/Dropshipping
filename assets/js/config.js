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
    /* Digits only, including country code (e.g. "254712345678").
       Leave empty until the number is confirmed: the store hides every
       WhatsApp link when this is blank, so a placeholder can never be
       published by accident. */
    whatsapp: "",
    whatsappNote: "WhatsApp support is not published yet.",
    /* EAT is UTC+3; Singapore and Malaysia are UTC+8 (+5 hours). */
    hours: "Mon–Fri, 09:00–17:00 EAT",
    hoursLocal: "14:00–22:00 Singapore / Malaysia time",
    responseTime: "Within 1 working day"
  },

  baseCurrency: "USD",
  defaultMarket: "SG",
  orderPrefix: "MOR",

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

  /* --- Supabase ------------------------------------------------
     Paste the project URL and the *anon* public key here.
     The anon key is designed to be public: Row Level Security decides what
     it may read, and every write goes through an Edge Function. Never put the
     service_role key in this file.

     While these are empty the storefront runs on the bundled sample
     catalogue and checkout says plainly that no order can be completed.
     ------------------------------------------------------------ */
  supabase: {
    url: "",
    anonKey: ""
  },
  payments: {
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
