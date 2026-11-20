/* MORGGY Supabase layer
   ---------------------
   One place for the database, auth and Edge Function calls. Loaded before
   app.js as a classic script; supabase-js itself is imported lazily so pages
   still work (on bundled sample data) when the CDN or credentials are missing.

   The anon key is public by design. Every table is protected by Row Level
   Security and every privileged write goes through an Edge Function. */
(function () {
  "use strict";

  var C = window.MORGGY || {};
  var cfg = C.supabase || {};
  var configured = Boolean(cfg.url && cfg.anonKey);
  var clientPromise = null;
  var SDK = "https://esm.sh/@supabase/supabase-js@2.45.4";
  var CART_KEY = "morggy:cart";

  function client() {
    if (!configured) return Promise.reject(new Error("Supabase is not configured."));
    if (!clientPromise) {
      clientPromise = import(SDK).then(function (mod) {
        return mod.createClient(cfg.url, cfg.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
      });
      clientPromise.catch(function () { clientPromise = null; });
    }
    return clientPromise;
  }

  function functionsUrl() {
    return cfg.url.replace(/\/+$/, "") + "/functions/v1";
  }

  /* Cart lives in localStorage; it is deliberately not a table. */
  function readCart() {
    try {
      var raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (err) { return []; }
  }

  function idempotencyKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "ord-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function mapProduct(row) {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category_slug,
      sku: row.sku,
      shortDescription: row.short_description || "",
      description: row.description || "",
      features: row.features || [],
      images: (row.images || []).map(function (src) { return String(src); }),
      variants: (row.variants || []).map(function (v) {
        return { name: v.name, options: v.options || [] };
      }),
      priceUsd: Number(row.price_usd),
      supplier: {
        name: "CJdropshipping",
        mappingStatus: row.is_verified ? "mapped" : "unmapped"
      },
      shippingCostUsd: {},
      deliveryDays: row.delivery_days || {},
      destinations: row.destinations || [],
      supplierStock: null,
      availability: row.availability || "unknown",
      status: row.status,
      createdAt: row.created_at
    };
  }

  async function loadCatalogue() {
    var db = await client();

    var results = await Promise.all([
      db.from("v_product_public")
        .select("*")
        .eq("status", "published")
        .order("created_at", { ascending: false }),
      db.from("categories")
        .select("slug, name, blurb, image_url, position")
        .eq("is_active", true)
        .order("position", { ascending: true }),
      db.from("exchange_rates")
        .select("quote_currency, rate, effective_at")
        .order("effective_at", { ascending: false })
        .limit(30)
    ]);

    if (results[0].error) throw results[0].error;

    var categories = (results[1].data || []).map(function (c) {
      return { id: c.slug, name: c.name, blurb: c.blurb, image: c.image_url };
    });

    var rates = {};
    (results[2].data || []).forEach(function (row) {
      if (!rates[row.quote_currency]) rates[row.quote_currency] = Number(row.rate);
    });

    return {
      products: (results[0].data || []).map(mapProduct),
      categories: categories,
      rates: rates
    };
  }

  async function postFunction(name, body, token) {
    var headers = {
      "Content-Type": "application/json",
      "apikey": cfg.anonKey,
      "Authorization": "Bearer " + (token || cfg.anonKey)
    };

    var response = await fetch(functionsUrl() + "/" + name, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });

    var payload = {};
    try { payload = await response.json(); } catch (err) { payload = {}; }

    if (!response.ok) {
      var error = new Error(payload.error || "That request could not be completed.");
      error.status = response.status;
      error.code = payload.code;
      throw error;
    }
    return payload;
  }

  async function authToken() {
    try {
      var db = await client();
      var session = await db.auth.getSession();
      return session && session.data && session.data.session ? session.data.session.access_token : null;
    } catch (err) { return null; }
  }

  async function placeOrder(order) {
    return postFunction("place-order", order, await authToken());
  }

  async function initiatePayment(options) {
    return postFunction("initiate-payment", {
      orderNumber: options.orderNumber,
      email: options.email,
      provider: options.provider || "paystack"
    }, await authToken());
  }

  async function trackOrder(orderNumber, email) {
    return postFunction("track-order", { orderNumber: orderNumber, email: email }, null);
  }

  async function myOrders() {
    var db = await client();
    var user = (await db.auth.getUser()).data.user;
    if (!user) return [];
    var response = await db.from("orders")
      .select("order_number, status, placed_at, total_usd, currency_display, market")
      .eq("user_id", user.id)
      .order("placed_at", { ascending: false })
      .limit(25);
    if (response.error) throw response.error;
    return response.data || [];
  }

  window.Store = {
    configured: configured,
    client: client,
    loadCatalogue: loadCatalogue,
    placeOrder: placeOrder,
    initiatePayment: initiatePayment,
    trackOrder: trackOrder,
    myOrders: myOrders,
    readCart: readCart,
    idempotencyKey: idempotencyKey,
    functionsUrl: functionsUrl
  };
})();
