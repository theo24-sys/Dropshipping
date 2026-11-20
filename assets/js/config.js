
/* ============================================================
   MORGGY store configuration
   Internal pricing currency is USD.
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
    whatsapp: "",
    whatsappNote: "WhatsApp support is not published yet.",
    hours: "Mon–Fri, 09:00–17:00 EAT",
    hoursLocal: "14:00–22:00 Singapore / Malaysia time",
    responseTime: "Within 1 working day"
  },

  baseCurrency: "USD",
  defaultMarket: "SG",
  orderPrefix: "MOR",

  markets: {
    SG: {
      name: "Singapore",
      status: "live",
      currency: "SGD",
      symbol: "S$",
      locale: "en-SG",
      fx: 1.35,
      fxUpdatedAt: "2026-11-01",
      decimals: 2,
      shipping: {
        flat: 3.9,
        perAdditionalItem: 1.2,
        eta: [5, 9],
        courier: "International tracked parcel"
      },
      taxNote: "Singapore GST and any import charges are set by Singapore Customs and are not included in our prices. If your parcel is assessed, the courier will collect the amount on delivery.",
      addressFields: ["line1", "line2", "postalCode"],
      postalExample: "238823 (6 digits)"
    },

    MY: {
      name: "Malaysia",
      status: "live",
      currency: "MYR",
      symbol: "RM",
      locale: "ms-MY",
      fx: 4.7,
      fxUpdatedAt: "2026-11-01",
      decimals: 2,
      shipping: {
        flat: 4.9,
        perAdditionalItem: 1.5,
        eta: [6, 10],
        courier: "International tracked parcel"
      },
      taxNote: "Malaysian sales tax (SST) and any import charges are set by the Royal Malaysian Customs Department and are not included in our prices. If your parcel is assessed, the courier will collect the amount on delivery.",
      addressFields: [
        "line1",
        "line2",
        "city",
        "postalCode",
        "state"
      ],
      postalExample: "50450 (5 digits)",
      states: [
        "Johor",
        "Kedah",
        "Kelantan",
        "Kuala Lumpur",
        "Labuan",
        "Melaka",
        "Negeri Sembilan",
        "Pahang",
        "Penang",
        "Perak",
        "Perlis",
        "Putrajaya",
        "Sabah",
        "Sarawak",
        "Selangor",
        "Terengganu"
      ]
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
      shipping: {
        flat: null,
        perAdditionalItem: null,
        eta: null,
        courier: null
      },
      taxNote: "Vietnam is not yet open for orders.",
      addressFields: [],
      postalExample: ""
    }
  },

  /* Supabase connection */
  supabase: {
    url: "https://ccemmjgtcxskznxogtsa.supabase.co",

    // Paste your Supabase sb_publishable_ key below.
    // Never put a service-role or secret key here.
    anonKey: "sb_publishable_3nJDPpbzUKUdBHk-rFLycw_og5InCFk"
  },

  payments: {
    providers: ["paystack", "flutterwave"],
    modes: {
      paystack: "test",
      flutterwave: "test"
    }
  },

  supplier: {
    name: "CJdropshipping",
    syncEnabled: false,
    lastSyncAt: null
  },

  newsletter: {
    enabled: false
  }
};
