/* MORGGY staff dashboard
   ----------------------
   Reads use the anon key and are filtered by Row Level Security: staff see all
   rows, and nothing here can be reached by a customer account. Privileged writes
   that involve money or a third party (payment verification, refunds, CJ calls)
   go through Edge Functions with the signed-in staff token. */
(function () {
  "use strict";

  var C = window.MORGGY || {};
  var cfg = C.supabase || {};
  var app = document.getElementById("app");
  var modal = document.getElementById("modal");
  var modalTitle = document.getElementById("modalTitle");
  var modalBody = document.getElementById("modalBody");

  var db = null;
  var me = null;
  var state = { products: [], categories: [], suppliers: [], mappings: [] };
  var cjSeq = 0; /* invalidates in-flight CJ searches when the modal closes or a newer search starts */

  var esc = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var money = function (value) {
    var number = Number(value);
    return Number.isFinite(number)
      ? "$" + number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";
  };
  var date = function (value) {
    if (!value) return "—";
    return new Date(value).toLocaleString(undefined, {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
  };
  var shortDate = function (value) {
    if (!value) return "—";
    return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  };
  var label = function (value) { return String(value || "").replace(/_/g, " "); };

  function badge(status) {
    var map = {
      paid: "ok", succeeded: "ok", delivered: "ok", completed: "ok", in_stock: "ok", mapped: "ok",
      active: "ok", published: "ok", in_transit: "info", shipped: "info", submitted: "info",
      processing: "warn", pending: "warn", pending_payment: "warn", requested: "warn",
      approved: "warn", initialised: "warn", label_created: "warn", unknown: "warn",
      preorder: "warn", needs_review: "warn", partial: "warn", partially_refunded: "warn",
      failed: "bad", cancelled: "bad", refunded: "bad", rejected: "bad", out_of_stock: "bad",
      exception: "bad", returned: "bad", unmapped: "bad", archived: "bad", draft: "warn"
    };
    var tone = map[status] || "";
    return '<span class="badge' + (tone ? " badge--" + tone : "") + '">' + esc(label(status)) + "</span>";
  }

  var view = function () { return document.getElementById("view"); };
  var titleEl = function () { return document.getElementById("viewTitle"); };
  var subEl = function () { return document.getElementById("viewSub"); };
  var actionsEl = function () { return document.getElementById("viewActions"); };

  function setHead(title, sub, actions) {
    if (titleEl()) titleEl().textContent = title;
    if (subEl()) subEl().textContent = sub || "";
    if (actionsEl()) actionsEl().innerHTML = actions || "";
  }

  function loading(text) {
    if (view()) view().innerHTML = '<div class="card"><div class="empty">' + esc(text || "Loading…") + "</div></div>";
  }

  function failure(error) {
    if (view()) {
      view().innerHTML = '<div class="notice notice--bad"><strong>Could not load this view.</strong> ' +
        esc((error && error.message) || "Unknown error") + "</div>";
    }
  }

  function flash(message, tone) {
    var host = document.getElementById("flash");
    if (!host) return;
    host.innerHTML = '<div class="notice' + (tone ? " notice--" + tone : "") + '">' + esc(message) + "</div>";
    setTimeout(function () { host.innerHTML = ""; }, 6000);
  }

  /* ------------------------------------------------------------------ auth */
  function configWarning() {
    app.innerHTML = '<div class="login"><h1>Not connected</h1>' +
      "<p>The dashboard needs a Supabase project. Add the URL and anon key to " +
      "<code>assets/js/config.js</code> (the same values the storefront uses).</p>" +
      '<a class="btn btn--ghost" href="../index.html">Back to the store</a></div>';
  }

  function renderLogin(message) {
    app.innerHTML = '<div class="login"><h1>Staff sign in</h1>' +
      "<p>Accounts with the customer role cannot open this dashboard.</p>" +
      '<div id="loginError"></div>' +
      '<form id="loginForm">' +
        '<div class="field"><label for="lg-email">Email</label>' +
        '<input id="lg-email" type="email" autocomplete="email" required></div>' +
        '<div class="field"><label for="lg-password">Password</label>' +
        '<input id="lg-password" type="password" autocomplete="current-password" required></div>' +
        '<button class="btn" type="submit" style="width:100%">Sign in</button>' +
      "</form>" +
      (message ? '<div class="notice notice--bad" style="margin-top:16px">' + esc(message) + "</div>" : "") +
      "</div>";

    document.getElementById("loginForm").onsubmit = async function (event) {
      event.preventDefault();
      var form = event.target;
      var result = await db.auth.signInWithPassword({
        email: form.querySelector("#lg-email").value.trim(),
        password: form.querySelector("#lg-password").value
      });
      if (result.error) {
        renderLogin("That email and password did not match.");
        return;
      }
      await loadMe(result.data.user);
    };
  }

  function renderForbidden(email) {
    app.innerHTML = '<div class="login"><h1>No staff access</h1>' +
      "<p><b>" + esc(email || "") + "</b> is signed in as a customer. An administrator must " +
      "change this account's role to staff or admin.</p>" +
      '<button class="btn btn--ghost" id="soBtn" type="button">Sign out</button></div>';
    document.getElementById("soBtn").onclick = async function () {
      await db.auth.signOut();
      renderLogin();
    };
  }

  async function loadMe(user) {
    var result = await db.from("profiles").select("role, email, full_name").eq("id", user.id).maybeSingle();
    if (result.error || !result.data) {
      renderForbidden(user.email);
      return;
    }
    if (result.data.role !== "staff" && result.data.role !== "admin") {
      renderForbidden(result.data.email || user.email);
      return;
    }
    me = result.data;
    renderShell();
  }

  /* ----------------------------------------------------------------- shell */
  function renderShell() {
    app.innerHTML =
      '<div class="layout">' +
        '<aside class="side">' +
          '<a class="brand" href="../index.html">MORGGY<small>Staff</small></a>' +
          "<nav>" +
            '<a href="#overview" data-nav="overview">Overview</a>' +
            '<a href="#products" data-nav="products">Products &amp; stock</a>' +
            '<a href="#orders" data-nav="orders">Orders</a>' +
            '<a href="#customers" data-nav="customers">Customers</a>' +
            '<a href="#audit" data-nav="audit">Audit log</a>' +
          "</nav>" +
          '<div class="who"><b>' + esc(me.email) + "</b>" + esc(me.role) +
            ' · <a href="#signout" data-action="signout">Sign out</a></div>' +
        "</aside>" +
        '<main class="main">' +
          '<div class="top"><div><h1 id="viewTitle"></h1><p id="viewSub"></p></div>' +
            '<div id="viewActions"></div></div>' +
          '<div id="flash"></div>' +
          '<div id="view"></div>' +
        "</main>" +
      "</div>";

    window.addEventListener("hashchange", route);
    route();
  }

  function route() {
    var name = (location.hash || "#overview").replace("#", "") || "overview";
    document.querySelectorAll("[data-nav]").forEach(function (link) {
      link.classList.toggle("is-on", link.dataset.nav === name);
    });
    if (name === "products") renderProducts();
    else if (name === "orders") renderOrders();
    else if (name === "customers") renderCustomers();
    else if (name === "audit") renderAudit();
    else renderOverview();
  }

  /* -------------------------------------------------------------- overview */
  async function renderOverview() {
    setHead("Overview", "Sales and profit are calculated from paid orders only.");
    loading();

    var results = await Promise.all([
      db.rpc("admin_sales_summary", { p_days: 30 }),
      db.rpc("admin_top_products", { p_days: 30, p_limit: 8 }),
      db.from("orders")
        .select("id, order_number, email, status, market, total_usd, placed_at")
        .order("placed_at", { ascending: false })
        .limit(10)
    ]);

    if (results[0].error) { failure(results[0].error); return; }
    var summary = results[0].data || {};
    var top = results[1].data || [];
    var recent = results[2].data || [];

    var kpis = [
      ["Revenue", money(summary.revenueUsd), summary.paidOrders + " paid orders"],
      ["Gross profit", money(summary.grossProfitUsd), "product margin, before fees"],
      ["Average order", money(summary.averageOrderUsd), "last " + (summary.windowDays || 30) + " days"],
      ["Awaiting payment", String(summary.pendingPayment ?? 0), "orders not yet paid"],
      ["Refunded", money(summary.refundedUsd), "completed refunds"]
    ].map(function (item) {
      return '<div class="kpi"><span>' + esc(item[0]) + "</span><b>" + esc(item[1]) +
        "</b><small>" + esc(item[2]) + "</small></div>";
    }).join("");

    view().innerHTML =
      '<div class="grid">' + kpis + "</div>" +
      '<div class="split">' +
        '<div class="card"><div class="card-head"><h2>Best performing products</h2>' +
          '<span class="muted">Revenue, last 30 days</span></div>' +
          '<div class="scroll"><table><thead><tr><th>Product</th><th class="num">Units</th>' +
          '<th class="num">Revenue</th><th class="num">Gross profit</th></tr></thead><tbody>' +
          (top.length ? top.map(function (row) {
            return "<tr><td>" + esc(row.name) + "</td><td class=\"num\">" + row.units +
              '</td><td class="num">' + money(row.revenue_usd) +
              '</td><td class="num">' + money(row.gross_profit_usd) + "</td></tr>";
          }).join("") : '<tr><td colspan="4" class="empty">No paid orders in this window yet.</td></tr>') +
          "</tbody></table></div></div>" +
        '<div class="card"><div class="card-head"><h2>Latest orders</h2>' +
          '<a class="btn btn--ghost btn--sm" href="#orders">All orders</a></div>' +
          '<div class="scroll"><table><thead><tr><th>Order</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>' +
          (recent.length ? recent.map(function (order) {
            return "<tr><td>" + esc(order.order_number) + "<small>" + esc(order.email) + "</small></td>" +
              "<td>" + badge(order.status) + "</td>" +
              '<td class="num">' + money(order.total_usd) + "</td></tr>";
          }).join("") : '<tr><td colspan="3" class="empty">No orders yet.</td></tr>') +
          "</tbody></table></div></div>" +
      "</div>";
  }

  /* -------------------------------------------------------------- products */
  async function renderProducts() {
    setHead("Products & stock", "Verify data, map supplier items and watch stock. Cost and margin are staff-only.",
      '<button class="btn btn--ghost" type="button" data-action="cj-search">Search CJ products</button> ' +
      '<button class="btn btn--gold" type="button" data-action="new-product">New product</button>');
    loading();

    var results = await Promise.all([
      db.from("v_product_profit").select("*").order("name"),
      db.from("supplier_products").select("id, product_id, supplier_id, supplier_product_id, cost_usd, mapping_status, last_synced_at, suppliers(name)"),
      db.from("categories").select("id, slug, name").order("name"),
      db.from("suppliers").select("id, name, code")
    ]);

    if (results[0].error) { failure(results[0].error); return; }

    state.products = results[0].data || [];
    state.mappings = results[1].data || [];
    state.categories = results[2].data || [];
    state.suppliers = results[3].data || [];

    view().innerHTML =
      '<div class="card"><div class="card-head"><h2>All products</h2>' +
        '<input id="productFilter" placeholder="Filter by name or SKU" style="max-width:260px">' +
      "</div><div class=\"scroll\"><table><thead><tr>" +
        "<th>Product</th><th>Price</th><th>Cost</th><th>Margin</th><th>Stock</th>" +
        "<th>Verified</th><th>Supplier</th><th></th></tr></thead>" +
        '<tbody id="productRows">' + productRows(state.products) + "</tbody></table></div></div>";

    var filter = document.getElementById("productFilter");
    if (filter) {
      filter.oninput = function () {
        var term = filter.value.trim().toLowerCase();
        var rows = state.products.filter(function (product) {
          return !term || (product.name + " " + product.sku).toLowerCase().indexOf(term) > -1;
        });
        document.getElementById("productRows").innerHTML = productRows(rows);
      };
    }
  }

  function productRows(products) {
    if (!products.length) {
      return '<tr><td colspan="8" class="empty">No products yet. Add one, or import the storefront catalogue.</td></tr>';
    }
    return products.map(function (product) {
      var mapping = state.mappings.filter(function (row) { return row.product_id === product.id; })[0];
      var supplierCell = mapping
        ? (mapping.supplier_product_id
            ? esc(mapping.suppliers ? mapping.suppliers.name : "Supplier") + "<small>" + esc(mapping.supplier_product_id) + "</small>"
            : "Not mapped")
        : "Not mapped";

      return "<tr>" +
        "<td><b>" + esc(product.name) + "</b><small>" + esc(product.sku) + "</small></td>" +
        '<td class="num">' + money(product.price_usd) + "</td>" +
        '<td class="num">' + (product.unit_cost_usd == null ? "—" : money(product.unit_cost_usd)) + "</td>" +
        '<td class="num">' + (product.margin_pct == null ? "—" : Number(product.margin_pct).toFixed(1) + "%") + "</td>" +
        "<td>" + badge(product.availability) +
          "<small>" + (product.supplier_stock == null ? "supplier stock unknown" : Number(product.supplier_stock) + " at supplier") + "</small></td>" +
        "<td>" + (product.is_verified ? '<span class="badge badge--ok">verified</span>' : '<span class="badge badge--warn">unverified</span>') +
          "<small>" + badge(product.status) + "</small></td>" +
        "<td>" + supplierCell + "</td>" +
        '<td class="num">' +
          '<button class="btn btn--ghost btn--sm" data-action="edit-product" data-id="' + product.id + '">Edit</button> ' +
          '<button class="btn btn--ghost btn--sm" data-action="map-product" data-id="' + product.id + '">Map</button> ' +
          '<button class="btn btn--ghost btn--sm" data-action="verify-product" data-id="' + product.id + '">' +
            (product.is_verified ? "Unverify" : "Verify") + "</button> " +
          '<button class="btn btn--ghost btn--sm" data-action="sync-stock" data-id="' + product.id + '">Sync</button>' +
        "</td></tr>";
    }).join("");
  }

  /* ------------------------------------------------------- CJ catalogue search */
  /* Only https image URLs are rendered; anything else is dropped. */
  function safeImageUrl(url) {
    try {
      var parsed = new URL(String(url || ""));
      return parsed.protocol === "https:" ? parsed.href : "";
    } catch (err) {
      return "";
    }
  }

  function cjPrice(value) {
    var number = Number(value);
    return value != null && Number.isFinite(number) && number > 0 ? money(number) : "—";
  }

  function cjCount(value) {
    var number = Number(value);
    return value != null && Number.isFinite(number) ? number.toLocaleString("en-US") : "—";
  }

  function cjRows(products) {
    if (!products.length) {
      return '<tr><td colspan="6" class="empty">CJ returned no products for that keyword.</td></tr>';
    }
    return products.map(function (item) {
      var image = safeImageUrl(item.image);
      var imageCell = image
        ? '<img src="' + esc(image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" ' +
          'style="width:56px;height:56px;object-fit:cover;border-radius:6px;display:block">'
        : '<span class="muted">No image</span>';

      return "<tr>" +
        "<td>" + imageCell + "</td>" +
        "<td><b>" + esc(item.name || "Untitled") + "</b>" +
          (item.category_name ? "<small>" + esc(item.category_name) + "</small>" : "") +
          (item.already_in_my_cj ? '<small>In your CJ list</small>' : "") + "</td>" +
        "<td>" + esc(item.sku || "—") + "</td>" +
        "<td><code>" + esc(item.cj_product_id || "—") + "</code></td>" +
        '<td class="num">' + cjPrice(item.supplier_price_usd) +
          (item.original_price_usd && item.original_price_usd !== item.supplier_price_usd
            ? "<small>list " + cjPrice(item.original_price_usd) + "</small>" : "") + "</td>" +
        '<td class="num">' + cjCount(item.stock) +
          "<small>verified " + cjCount(item.verified_inventory) + "</small></td>" +
      "</tr>";
    }).join("");
  }

  function openCjSearch() {
    cjSeq += 1;
    openModal("Search CJ products",
      '<form id="cjForm">' +
        '<div class="field"><label for="cj-keyword">Product keyword</label>' +
        '<div class="row"><input id="cj-keyword" maxlength="200" autocomplete="off" placeholder="e.g. phone stand" required>' +
        '<button class="btn" type="submit" id="cjSubmit">Search CJ</button></div></div>' +
      "</form>" +
      '<p class="muted" style="font-size:.78rem">Each search uses CJ API quota, so it only runs when you press Search.</p>' +
      '<div id="cjResults"></div>');

    var form = document.getElementById("cjForm");
    var input = document.getElementById("cj-keyword");
    var submit = document.getElementById("cjSubmit");
    var results = document.getElementById("cjResults");
    if (input) input.focus();

    form.onsubmit = async function (event) {
      event.preventDefault();
      var keyword = input.value.trim();
      if (!keyword) {
        results.innerHTML = '<div class="notice notice--bad">Enter a keyword to search.</div>';
        return;
      }

      cjSeq += 1;
      var seq = cjSeq;
      submit.disabled = true;
      results.innerHTML = '<div class="empty">Searching CJ…</div>';

      try {
        var data = await invoke("cj-search", { keyword: keyword, page: 1, size: 20 });
        if (seq !== cjSeq) return;
        if (!data || data.success === false) {
          throw new Error((data && data.message) || "CJ search failed.");
        }
        var products = Array.isArray(data.products) ? data.products : [];
        var total = Number(data.totalRecords);
        results.innerHTML =
          '<p class="muted" style="font-size:.82rem">Showing ' + products.length +
            (Number.isFinite(total) && total > products.length ? " of " + total.toLocaleString("en-US") : "") +
            " result" + (products.length === 1 ? "" : "s") + " for “" + esc(keyword) + "”.</p>" +
          '<div class="scroll"><table><thead><tr><th></th><th>Product</th><th>CJ SKU</th>' +
            '<th>CJ product ID</th><th class="num">Supplier price</th><th class="num">Stock</th></tr></thead>' +
            "<tbody>" + cjRows(products) + "</tbody></table></div>";
      } catch (error) {
        if (seq !== cjSeq) return;
        results.innerHTML = '<div class="notice notice--bad"><strong>CJ search failed.</strong> ' +
          esc(error.message || "Unknown error") + "</div>";
      } finally {
        if (seq === cjSeq) submit.disabled = false;
      }
    };
  }

  /* ---------------------------------------------------------------- orders */
  async function renderOrders() {
    setHead("Orders", "Payments are only marked paid by a verified gateway webhook.", "");
    loading();

    var result = await db.from("orders")
      .select("id, order_number, email, full_name, market, status, total_usd, shipping_usd, placed_at, paid_at")
      .order("placed_at", { ascending: false })
      .limit(100);

    if (result.error) { failure(result.error); return; }
    var orders = result.data || [];

    view().innerHTML =
      '<div class="card"><div class="card-head"><h2>Recent orders</h2>' +
        '<input id="orderFilter" placeholder="Filter by order number or email" style="max-width:280px"></div>' +
        '<div class="scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Market</th>' +
        '<th>Status</th><th class="num">Total</th><th>Placed</th><th></th></tr></thead>' +
        '<tbody id="orderRows">' + orderRows(orders) + "</tbody></table></div></div>";

    var filter = document.getElementById("orderFilter");
    if (filter) {
      filter.oninput = function () {
        var term = filter.value.trim().toLowerCase();
        document.getElementById("orderRows").innerHTML = orderRows(orders.filter(function (order) {
          return !term || (order.order_number + " " + order.email).toLowerCase().indexOf(term) > -1;
        }));
      };
    }
  }

  function orderRows(orders) {
    if (!orders.length) return '<tr><td colspan="7" class="empty">No orders yet.</td></tr>';
    return orders.map(function (order) {
      return "<tr>" +
        "<td><b>" + esc(order.order_number) + "</b><small>" + shortDate(order.placed_at) + "</small></td>" +
        "<td>" + esc(order.full_name) + "<small>" + esc(order.email) + "</small></td>" +
        "<td>" + esc(order.market) + "</td>" +
        "<td>" + badge(order.status) + "</td>" +
        '<td class="num">' + money(order.total_usd) + "</td>" +
        "<td>" + shortDate(order.placed_at) + "</td>" +
        '<td class="num"><button class="btn btn--ghost btn--sm" data-action="open-order" data-id="' +
          order.id + '">Open</button></td></tr>';
    }).join("");
  }

  async function openOrder(orderId) {
    openModal("Order", '<div class="empty">Loading…</div>');
    var results = await Promise.all([
      db.from("orders").select("*").eq("id", orderId).maybeSingle(),
      db.from("order_items").select("*").eq("order_id", orderId),
      db.from("payments").select("*").eq("order_id", orderId).order("created_at", { ascending: false }),
      db.from("shipments").select("*").eq("order_id", orderId),
      db.from("refunds").select("*").eq("order_id", orderId)
    ]);

    if (results[0].error || !results[0].data) {
      modalBody.innerHTML = '<div class="notice notice--bad">That order could not be loaded.</div>';
      return;
    }

    var order = results[0].data;
    var items = results[1].data || [];
    var payments = results[2].data || [];
    var shipments = results[3].data || [];
    var refunds = results[4].data || [];
    var address = order.shipping_address || {};

    var statusOptions = ["pending_payment", "paid", "processing", "submitted", "shipped", "delivered", "cancelled", "refunded"];
    var captured = payments.filter(function (payment) { return payment.status === "succeeded"; })[0];

    modalTitle.textContent = "Order " + order.order_number;
    modalBody.innerHTML =
      '<div class="notice"><strong>' + esc(order.full_name) + " · " + esc(order.email) + "</strong>" +
        esc([address.line1, address.line2, address.city, address.state, address.postcode].filter(Boolean).join(", ")) +
        "<br>" + esc(order.market) + " · " + esc(order.phone || "no phone") + " · " + badge(order.status) + "</div>" +

      '<div class="field"><label>Order status</label>' +
        '<div class="row"><select id="orderStatus">' + statusOptions.map(function (status) {
          return '<option value="' + status + '"' + (status === order.status ? " selected" : "") + ">" + esc(label(status)) + "</option>";
        }).join("") + "</select>" +
        '<button class="btn btn--sm" type="button" id="saveStatus">Update</button></div>' +
        '<p class="muted" style="font-size:.75rem">Setting a status here does not move money. Use the payment and refund controls below.</p></div>' +

      '<h3 style="margin:18px 0 8px;font-size:1rem">Items</h3>' +
      '<div class="scroll"><table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Line total</th></tr></thead><tbody>' +
        items.map(function (item) {
          return "<tr><td>" + esc(item.name_snapshot) +
            (item.variant_label ? "<small>" + esc(item.variant_label) + "</small>" : "") +
            "<small>" + esc(item.sku_snapshot) + "</small></td>" +
            '<td class="num">' + item.quantity + '</td><td class="num">' + money(item.line_total_usd) + "</td></tr>";
        }).join("") + "</tbody></table></div>" +

      '<h3 style="margin:18px 0 8px;font-size:1rem">Payments</h3>' +
      (payments.length ? '<div class="scroll"><table><thead><tr><th>Provider</th><th>Reference</th>' +
        "<th>Status</th><th class=\"num\">Amount</th><th></th></tr></thead><tbody>" +
        payments.map(function (payment) {
          return "<tr><td>" + esc(payment.provider) + "</td><td>" + esc(payment.provider_reference || "—") +
            "<small>" + esc(date(payment.created_at)) + "</small></td>" +
            "<td>" + badge(payment.status) + (payment.failure_reason ? "<small>" + esc(payment.failure_reason) + "</small>" : "") + "</td>" +
            '<td class="num">' + money(payment.amount_usd) + "</td>" +
            '<td class="num"><button class="btn btn--ghost btn--sm" data-action="verify-payment" data-id="' +
              payment.id + '">Re-verify</button></td></tr>';
        }).join("") + "</tbody></table></div>"
        : '<p class="muted" style="font-size:.84rem">No payment has been attempted for this order.</p>') +

      '<h3 style="margin:18px 0 8px;font-size:1rem">Shipment</h3>' +
      (shipments.length ? shipments.map(function (shipment) {
        return '<div class="notice">' + badge(shipment.status) + " " +
          esc(shipment.carrier || "carrier not set") + " · " + esc(shipment.tracking_number || "no tracking number") +
          (shipment.supplier_order_reference ? "<br>CJ order: " + esc(shipment.supplier_order_reference) : "") + "</div>";
      }).join("")
        : '<p class="muted" style="font-size:.84rem">No shipment recorded.</p>') +
      '<div class="row"><input id="shipCarrier" placeholder="Carrier">' +
        '<input id="shipTracking" placeholder="Tracking number">' +
        '<button class="btn btn--ghost btn--sm" type="button" id="addShipment">Record shipment</button></div>' +
      '<div class="row" style="margin-top:8px">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-action="submit-supplier" data-id="' + order.id + '">Send to CJ</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-action="sync-tracking" data-id="' + order.id + '">Sync tracking</button></div>' +

      '<h3 style="margin:18px 0 8px;font-size:1rem">Refunds</h3>' +
      (refunds.length ? refunds.map(function (refund) {
        return '<div class="notice">' + badge(refund.status) + " " + money(refund.amount_usd) +
          " · " + esc(refund.reason || "no reason given") +
          (refund.status === "requested" || refund.status === "approved"
            ? '<br><button class="btn btn--danger btn--sm" type="button" data-action="process-refund" data-id="' +
              refund.id + '">Send refund</button>'
            : "") + "</div>";
      }).join("")
        : "<p class=\"muted\" style=\"font-size:.84rem\">No refunds on this order.</p>") +
      (captured ? '<div class="row"><input id="refundAmount" placeholder="Amount USD" value="' +
        Number(captured.amount_usd).toFixed(2) + '"><input id="refundReason" placeholder="Reason">' +
        '<button class="btn btn--ghost btn--sm" type="button" id="createRefund">Create refund</button></div>'
        : '<p class="muted" style="font-size:.78rem">A refund needs a captured payment.</p>');

    var saveStatus = document.getElementById("saveStatus");
    if (saveStatus) {
      saveStatus.onclick = async function () {
        var status = document.getElementById("orderStatus").value;
        var update = await db.from("orders").update({ status: status }).eq("id", order.id);
        if (update.error) { flash("Status not saved: " + update.error.message, "bad"); return; }
        flash("Order status updated.");
        openOrder(order.id);
      };
    }

    var addShipment = document.getElementById("addShipment");
    if (addShipment) {
      addShipment.onclick = async function () {
        var carrier = document.getElementById("shipCarrier").value.trim();
        var tracking = document.getElementById("shipTracking").value.trim();
        if (!tracking) { flash("A tracking number is required.", "bad"); return; }
        var insert = await db.from("shipments").insert({
          order_id: order.id,
          carrier: carrier || null,
          tracking_number: tracking,
          status: "in_transit",
          shipped_at: new Date().toISOString()
        });
        if (insert.error) { flash("Shipment not saved: " + insert.error.message, "bad"); return; }
        flash("Shipment recorded.");
        openOrder(order.id);
      };
    }

    var createRefund = document.getElementById("createRefund");
    if (createRefund) {
      createRefund.onclick = async function () {
        var amount = Number(document.getElementById("refundAmount").value);
        var reason = document.getElementById("refundReason").value.trim();
        if (!Number.isFinite(amount) || amount <= 0) { flash("Enter a valid refund amount.", "bad"); return; }
        var insert = await db.from("refunds").insert({
          order_id: order.id,
          payment_id: captured.id,
          amount_usd: amount,
          reason: reason || null,
          status: "requested"
        });
        if (insert.error) { flash("Refund not created: " + insert.error.message, "bad"); return; }
        flash("Refund created. Send it to the provider when approved.");
        openOrder(order.id);
      };
    }
  }

  /* ------------------------------------------------------------- customers */
  async function renderCustomers() {
    setHead("Customers", "Roles decide who can open this dashboard.", "");
    loading();

    var result = await db.from("profiles")
      .select("id, email, full_name, phone, role, market, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (result.error) { failure(result.error); return; }
    var people = result.data || [];

    view().innerHTML =
      '<div class="card"><div class="card-head"><h2>Accounts</h2>' +
        '<span class="muted">Admin can change roles</span></div>' +
        '<div class="scroll"><table><thead><tr><th>Name</th><th>Contact</th><th>Market</th>' +
        "<th>Role</th><th>Joined</th></tr></thead><tbody>" +
        (people.length ? people.map(function (person) {
          var roleCell = me.role === "admin"
            ? '<select data-role-for="' + person.id + '">' +
                ["customer", "staff", "admin"].map(function (role) {
                  return '<option value="' + role + '"' + (role === person.role ? " selected" : "") + ">" + role + "</option>";
                }).join("") + "</select>"
            : esc(person.role);
          return "<tr><td>" + esc(person.full_name || "—") + "<small>" + esc(person.email) + "</small></td>" +
            "<td>" + esc(person.phone || "—") + "</td><td>" + esc(person.market || "—") + "</td>" +
            "<td>" + roleCell + "</td><td>" + shortDate(person.created_at) + "</td></tr>";
        }).join("") : '<tr><td colspan="5" class="empty">No accounts yet.</td></tr>') +
        "</tbody></table></div></div>";

    document.querySelectorAll("[data-role-for]").forEach(function (select) {
      select.onchange = async function () {
        var update = await db.from("profiles").update({ role: select.value }).eq("id", select.dataset.roleFor);
        if (update.error) { flash("Role not changed: " + update.error.message, "bad"); return; }
        flash("Role updated.");
      };
    });
  }

  /* ----------------------------------------------------------------- audit */
  async function renderAudit() {
    setHead("Audit log", "Product, order, payment and refund changes made through the dashboard.", "");
    loading();

    var result = await db.from("audit_logs")
      .select("id, actor_email, action, entity, entity_id, created_at")
      .order("created_at", { ascending: false })
      .limit(80);

    if (result.error) { failure(result.error); return; }

    view().innerHTML =
      '<div class="card"><div class="card-head"><h2>Recent activity</h2></div>' +
        '<div class="scroll"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th>' +
        "<th>Entity</th></tr></thead><tbody>" +
        ((result.data || []).length ? result.data.map(function (row) {
          return "<tr><td>" + esc(date(row.created_at)) + "</td><td>" + esc(row.actor_email || "system") + "</td>" +
            "<td>" + esc(row.action) + "</td><td>" + esc(row.entity) +
            "<small>" + esc(row.entity_id || "") + "</small></td></tr>";
        }).join("") : '<tr><td colspan="4" class="empty">No activity recorded yet.</td></tr>') +
        "</tbody></table></div></div>";
  }

  /* ----------------------------------------------------------------- modal */
  function openModal(title, html) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modal.classList.add("is-on");
  }

  function closeModal() {
    cjSeq += 1; /* drop any CJ search still in flight */
    modal.classList.remove("is-on");
    modalBody.innerHTML = "";
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-close-modal]") || event.target === modal) closeModal();
  });

  /* --------------------------------------------------------------- actions */
  async function invoke(name, body) {
    var session = await db.auth.getSession();
    var token = session && session.data.session ? session.data.session.access_token : "";
    var response = await fetch(cfg.url.replace(/\/+$/, "") + "/functions/v1/" + name, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.anonKey,
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify(body)
    });
    var payload = {};
    try { payload = await response.json(); } catch (err) { payload = {}; }
    if (!response.ok) throw new Error(payload.error || payload.message || "That request failed.");
    return payload;
  }

  document.addEventListener("click", async function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var action = button.dataset.action;
    var id = button.dataset.id;

    if (action === "signout") {
      await db.auth.signOut();
      renderLogin();
      return;
    }

    if (action === "new-product") {
      openProductForm(null);
      return;
    }

    if (action === "cj-search") {
      openCjSearch();
      return;
    }

    if (action === "edit-product") {
      openProductForm(state.products.filter(function (p) { return p.id === id; })[0]);
      return;
    }

    if (action === "map-product") {
      openMappingForm(id);
      return;
    }

    if (action === "verify-product") {
      var product = state.products.filter(function (p) { return p.id === id; })[0];
      var verify = !product.is_verified;
      var update = await db.from("products").update({
        is_verified: verify,
        verified_at: verify ? new Date().toISOString() : null
      }).eq("id", id);
      if (update.error) { flash("Could not update verification: " + update.error.message, "bad"); return; }
      flash(verify ? "Product marked verified." : "Verification removed.");
      renderProducts();
      return;
    }

    if (action === "sync-stock") {
      button.disabled = true;
      try {
        var stock = await invoke("cj-sync", { action: "check_stock", productId: id });
        flash("Supplier stock: " + (stock.supplierStock == null ? "not reported" : stock.supplierStock));
        renderProducts();
      } catch (error) {
        flash(error.message, "bad");
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === "open-order") {
      openOrder(id);
      return;
    }

    if (action === "verify-payment") {
      button.disabled = true;
      try {
        var verification = await invoke("verify-payment", { paymentId: id });
        flash("Payment status: " + verification.paymentStatus);
      } catch (error) {
        flash(error.message, "bad");
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === "process-refund") {
      button.disabled = true;
      try {
        await invoke("process-refund", { refundId: id });
        flash("Refund sent to the provider. It completes when the provider confirms.");
      } catch (error) {
        flash(error.message, "bad");
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === "submit-supplier") {
      button.disabled = true;
      try {
        var submission = await invoke("cj-sync", { action: "create_supplier_order", orderId: id });
        flash("Sent to CJ: " + submission.supplierOrderReference);
      } catch (error) {
        flash(error.message, "bad");
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === "sync-tracking") {
      button.disabled = true;
      try {
        var tracking = await invoke("cj-sync", { action: "sync_tracking", orderId: id });
        flash(tracking.trackingNumber ? "Tracking: " + tracking.trackingNumber : tracking.note || "No tracking yet.");
      } catch (error) {
        flash(error.message, "bad");
      } finally {
        button.disabled = false;
      }
      return;
    }
  });

  async function openProductForm(product) {
    var isNew = !product;
    if (!isNew) {
      /* v_product_profit omits description fields, so load the full record. */
      var fetched = await db.from("products")
        .select("name, slug, sku, price_usd, status, category_id, short_description, description")
        .eq("id", product.id)
        .maybeSingle();
      if (fetched.data) product = Object.assign({}, product, fetched.data);
    }
    openModal(isNew ? "New product" : "Edit product",
      '<form id="productForm">' +
        '<div class="field"><label for="pf-name">Name</label><input id="pf-name" required value="' + esc(product ? product.name : "") + '"></div>' +
        '<div class="row"><div class="field"><label for="pf-slug">Slug</label><input id="pf-slug" required value="' + esc(product ? product.slug : "") + '"></div>' +
        '<div class="field"><label for="pf-sku">SKU</label><input id="pf-sku" required value="' + esc(product ? product.sku : "") + '"></div></div>' +
        '<div class="row"><div class="field"><label for="pf-price">Price USD</label><input id="pf-price" type="number" step="0.01" min="0.01" required value="' + (product ? product.price_usd : "") + '"></div>' +
        '<div class="field"><label for="pf-status">Status</label><select id="pf-status">' +
          ["draft", "published", "archived"].map(function (status) {
            return '<option value="' + status + '"' + (product && product.status === status ? " selected" : "") + ">" + status + "</option>";
          }).join("") + "</select></div></div>" +
        '<div class="field"><label for="pf-category">Category</label><select id="pf-category">' +
          state.categories.map(function (category) {
            return '<option value="' + category.id + '"' +
              (product && product.category_id === category.id ? " selected" : "") + ">" +
              esc(category.name) + "</option>";
          }).join("") + "</select></div>" +
        '<div class="field"><label for="pf-short">Short description</label><input id="pf-short"></div>' +
        '<div class="field"><label for="pf-desc">Description</label><textarea id="pf-desc" rows="4"></textarea></div>' +
        '<button class="btn" type="submit">' + (isNew ? "Create product" : "Save changes") + "</button>" +
      "</form>");

    if (product) {
      document.getElementById("pf-short").value = product.short_description || "";
      document.getElementById("pf-desc").value = product.description || "";
    }

    document.getElementById("productForm").onsubmit = async function (event) {
      event.preventDefault();
      var categoryId = document.getElementById("pf-category").value || null;
      var payload = {
        name: document.getElementById("pf-name").value.trim(),
        slug: document.getElementById("pf-slug").value.trim(),
        sku: document.getElementById("pf-sku").value.trim(),
        price_usd: Number(document.getElementById("pf-price").value),
        status: document.getElementById("pf-status").value,
        category_id: categoryId
      };
      payload.short_description = document.getElementById("pf-short").value.trim() || null;
      payload.description = document.getElementById("pf-desc").value.trim() || null;

      var result = isNew
        ? await db.from("products").insert(payload)
        : await db.from("products").update(payload).eq("id", product.id);

      if (result.error) { flash("Not saved: " + result.error.message, "bad"); return; }
      closeModal();
      flash(isNew ? "Product created." : "Product updated.");
      renderProducts();
    };
  }

  function openMappingForm(productId) {
    var mapping = state.mappings.filter(function (row) { return row.product_id === productId; })[0];
    openModal("Supplier mapping",
      '<p class="muted" style="font-size:.82rem">Until a product is mapped, orders for it cannot be sent to the supplier.</p>' +
      '<div class="field"><label for="mp-supplier">Supplier</label><select id="mp-supplier">' +
        state.suppliers.map(function (supplier) {
          return '<option value="' + supplier.id + '"' + (mapping && mapping.supplier_id === supplier.id ? " selected" : "") + ">" +
            esc(supplier.name) + "</option>";
        }).join("") + "</select></div>" +
      '<div class="field"><label for="mp-item">Supplier product ID</label><input id="mp-item" value="' +
        esc(mapping ? mapping.supplier_product_id || "" : "") + '"></div>' +
      '<div class="field"><label for="mp-cost">Supplier cost USD</label><input id="mp-cost" type="number" step="0.01" min="0" value="' +
        (mapping && mapping.cost_usd != null ? mapping.cost_usd : "") + '"></div>' +
      '<div class="field"><label for="mp-status">Mapping status</label><select id="mp-status">' +
        ["unmapped", "mapped", "needs_review"].map(function (status) {
          return '<option value="' + status + '"' + (mapping && mapping.mapping_status === status ? " selected" : "") + ">" + status + "</option>";
        }).join("") + "</select></div>" +
      '<button class="btn" type="button" id="saveMapping">Save mapping</button>');

    document.getElementById("saveMapping").onclick = async function () {
      var supplierId = document.getElementById("mp-supplier").value;
      var supplierProductId = document.getElementById("mp-item").value.trim() || null;
      var cost = document.getElementById("mp-cost").value;
      var status = document.getElementById("mp-status").value;

      if (status === "mapped" && !supplierProductId) {
        flash("A mapped product needs the supplier's product ID.", "bad");
        return;
      }

      var payload = {
        product_id: productId,
        supplier_id: supplierId,
        supplier_product_id: supplierProductId,
        cost_usd: cost === "" ? null : Number(cost),
        mapping_status: status
      };

      var result = mapping
        ? await db.from("supplier_products").update(payload).eq("id", mapping.id)
        : await db.from("supplier_products").insert(payload);

      if (result.error) { flash("Not saved: " + result.error.message, "bad"); return; }
      closeModal();
      flash("Supplier mapping saved.");
      renderProducts();
    };
  }

  /* ------------------------------------------------------------------ boot */
  if (!cfg.url || !cfg.anonKey) {
    configWarning();
    return;
  }

  (async function boot() {
    try {
      var mod = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
      db = mod.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
      var session = await db.auth.getSession();
      if (!session.data.session) {
        renderLogin();
        return;
      }
      await loadMe(session.data.session.user);
    } catch (error) {
      app.innerHTML = '<div class="login"><h1>Dashboard unavailable</h1><p>' +
        esc(error.message || "Could not reach Supabase.") + "</p></div>";
    }
  })();
})();
