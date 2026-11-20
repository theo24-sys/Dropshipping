/* MORGGY storefront application
   All prices are stored in USD. Local prices are display estimates only. */
(function () {
  "use strict";

  var C = window.MORGGY;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var keyMarket = "morggy:market", keyCart = "morggy:cart";

  var market = localStorage.getItem(keyMarket);
  if (!C.markets[market]) market = C.defaultMarket;

  var cart = (function () {
    try {
      var raw = JSON.parse(localStorage.getItem(keyCart) || "[]");
      return Array.isArray(raw) ? raw.filter(function (l) { return l && l.id; }) : [];
    } catch (e) { return []; }
  })();

  var data = { products: [], categories: [], source: "sample" };
  var ui = { qty: 1, variant: {} };

  /* ---------- money ---------- */
  function mkt() { return C.markets[market]; }
  function localPrice(usd) {
    var m = mkt(), dec = m.decimals, v = usd * m.fx;
    var s = v.toLocaleString(m.locale, { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return m.suffixSymbol ? s + m.symbol : m.symbol + s;
  }
  function usd(amount) { return "$" + Number(amount).toFixed(2); }
  function fxNote() {
    var m = mkt();
    return "Local prices are converted from USD at 1 USD = " + m.fx + " " + m.currency +
      " (estimate updated " + m.fxUpdatedAt + "). Your order is confirmed in USD.";
  }

  /* ---------- catalogue helpers ---------- */
  function productById(id) { return data.products.filter(function (p) { return p.id === id; })[0]; }
  function productBySlug(s) { return data.products.filter(function (p) { return p.slug === s; })[0]; }
  function catName(id) {
    var c = data.categories.filter(function (x) { return x.id === id; })[0];
    return c ? c.name : id;
  }
  function shipsTo(p) { return (p.destinations || []).indexOf(market) > -1; }
  function etaText(p) {
    var d = (p.deliveryDays || {})[market];
    if (!d) return mkt().shipping.eta ? mkt().shipping.eta[0] + "–" + mkt().shipping.eta[1] + " working days" : "—";
    return d[0] + "–" + d[1] + " working days";
  }
  /* ---------- cart ---------- */
  function lineKey(l) { return l.id + "|" + (l.variant || ""); }
  function saveCart() {
    localStorage.setItem(keyCart, JSON.stringify(cart));
    updateCount();
  }
  function lines() {
    return cart.map(function (l) {
      var p = productById(l.id);
      return p ? { p: p, qty: l.qty, variant: l.variant || "", key: lineKey(l) } : null;
    }).filter(Boolean);
  }
  function cartCount() { return cart.reduce(function (n, l) { return n + l.qty; }, 0); }
  function subtotal() {
    return lines().reduce(function (s, l) { return s + l.p.priceUsd * l.qty; }, 0);
  }
  function itemCount() { return lines().reduce(function (n, l) { return n + l.qty; }, 0); }
  function shippingUsd() {
    var m = mkt(), n = itemCount();
    if (!n || m.status !== "live") return 0;
    return m.shipping.flat + m.shipping.perAdditionalItem * (n - 1);
  }
  function addToCart(id, qty, variant) {
    var p = productById(id);
    if (!p) return;
    var v = variant || "";
    var found = cart.filter(function (l) { return l.id === id && (l.variant || "") === v; })[0];
    if (found) found.qty += qty || 1;
    else cart.push({ id: id, qty: qty || 1, variant: v });
    saveCart();
    toast(esc(p.name) + " added to your cart", "View cart", "cart.html");
    if (document.body.dataset.page === "cart" || document.body.dataset.page === "checkout") renderPage();
  }
  function setQty(key, qty) {
    cart.forEach(function (l) { if (lineKey(l) === key) l.qty = Math.max(1, Math.min(20, qty)); });
    saveCart();
    renderPage();
  }
  function removeLine(key) {
    cart = cart.filter(function (l) { return lineKey(l) !== key; });
    saveCart();
    renderPage();
  }
  function updateCount() {
    $$("[data-cart-count]").forEach(function (el) {
      var n = cartCount();
      el.textContent = n;
      el.hidden = n === 0;
    });
  }

  /* ---------- toast ---------- */
  var toastEl, toastTimer;
  function toast(msg, linkText, href) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = msg + (linkText ? '<a href="' + href + '">' + linkText + "</a>" : "");
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 4200);
  }

  /* ---------- icons ---------- */
  var I = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.3-4.3"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>',
    bag: '<svg viewBox="0 0 24 24"><path d="M6 8h12l1 12H5L6 8z"/><path d="M9 8V6a3 3 0 016 0v2"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    truck: '<svg viewBox="0 0 24 24"><path d="M3 16V7h11v9M14 11h4l3 3v2h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 3.8 5.5 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3z"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2L12 3z"/><path d="M4 7.2l8 4.3 8-4.3M12 11.5V21"/></svg>',
    card: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>'
  };

  /* ---------- chrome ---------- */
  function marketOptions() {
    return Object.keys(C.markets).map(function (k) {
      var m = C.markets[k];
      return '<option value="' + k + '"' + (k === market ? " selected" : "") + ">" +
        esc(m.name) + (m.status === "live" ? " · " + m.currency : " · coming soon") + "</option>";
    }).join("");
  }

  function renderChrome() {
    var head = $("#site-header");
    if (head) {
      head.innerHTML =
        '<div class="announce">Delivery to <b>Singapore</b> &amp; <b>Malaysia</b> &middot; Estimated 5–10 working days</div>' +
        '<header class="site-head"><div class="container head-inner">' +
          '<button class="icon-btn nav-toggle" id="navToggle" aria-label="Open menu" aria-expanded="false">' + I.menu + "</button>" +
          '<a class="brand" href="index.html"><b>MORGGY</b><span>' + esc(C.brand.tagline) + "</span></a>" +
          '<nav class="nav" aria-label="Main">' +
            '<a href="shop.html">Shop all</a><a href="categories.html">Categories</a>' +
            '<a href="about.html">About</a><a href="track.html">Track order</a><a href="contact.html">Contact</a>' +
          "</nav>" +
          '<div class="head-actions">' +
            '<label class="sr-only" for="marketPick">Country and currency</label>' +
            '<select class="market-select" id="marketPick">' + marketOptions() + "</select>" +
            '<button class="icon-btn" id="searchToggle" aria-label="Search products" aria-expanded="false">' + I.search + "</button>" +
            '<a class="icon-btn" href="account.html" aria-label="Your account and orders">' + I.user + "</a>" +
            '<a class="cart-btn" href="cart.html">' + I.bag + '<span class="cart-label">Cart</span>' +
              '<span class="cart-count" data-cart-count hidden>0</span></a>' +
          "</div>" +
        "</div>" +
        '<div class="search-panel" id="searchPanel"><div class="container"><form action="shop.html" method="get" role="search">' +
          '<label class="sr-only" for="q">Search products</label>' +
          '<input id="q" name="q" type="search" placeholder="Search products — tumbler, charger, packing cubes…">' +
          '<button class="btn btn--dark" type="submit">Search</button></form></div></div>' +
        '<div class="mobile-panel" id="mobilePanel">' +
          '<div class="container">' +
            '<a href="shop.html">Shop all</a><a href="categories.html">Categories</a><a href="about.html">About MORGGY</a>' +
            '<a href="track.html">Track order</a><a href="faq.html">FAQ</a><a href="contact.html">Contact</a>' +
            '<label class="sr-only" for="marketPickMobile">Country and currency</label>' +
            '<select class="market-select" id="marketPickMobile">' + marketOptions() + "</select>" +
          "</div>" +
        "</div></header>";
    }

    var foot = $("#site-footer");
    if (foot) {
      foot.innerHTML =
        '<footer class="site-foot"><div class="container">' +
          '<div class="foot-grid">' +
            '<div><a class="brand" href="index.html"><b>MORGGY</b><span>' + esc(C.brand.tagline) + "</span></a>" +
              '<p class="foot-about">MORGGY is an international online store operated by ' + esc(C.brand.legalName) +
              ", " + esc(C.brand.city) + ", " + esc(C.brand.country) +
              ". We work with vetted overseas suppliers who ship directly to customers in Singapore and Malaysia.</p></div>" +
            '<div class="foot-col"><h4>Shop</h4><a href="shop.html">Shop all</a><a href="categories.html">Categories</a>' +
              '<a href="shop.html#new">New arrivals</a><a href="cart.html">Your cart</a></div>' +
            '<div class="foot-col"><h4>Help</h4><a href="track.html">Track an order</a><a href="faq.html">FAQ</a>' +
              '<a href="shipping.html">Shipping policy</a><a href="returns.html">Returns &amp; refunds</a><a href="contact.html">Contact us</a></div>' +
            '<div class="foot-col"><h4>Company</h4><a href="about.html">About MORGGY</a><a href="privacy.html">Privacy policy</a>' +
              '<a href="terms.html">Terms &amp; conditions</a>' +
              '<a href="mailto:' + esc(C.brand.email) + '">' + esc(C.brand.email) + "</a>" +
              (C.brand.whatsapp ? '<a href="https://wa.me/' + esc(C.brand.whatsapp) + '" rel="noopener" target="_blank">WhatsApp support</a>' : "") + "</div>" +
          "</div>" +
          '<div class="foot-bottom"><span>&copy; ' + new Date().getFullYear() + " " + esc(C.brand.legalName) +
            ". All prices in USD; local currency figures are estimates.</span>" +
            "<span>" + esc(C.brand.hours) + "</span></div>" +
        "</div></footer>";
    }
    updateCount();
  }

  /* ---------- shared renderers ---------- */
  function card(p, tag, tagGold) {
    var href = "product.html?p=" + encodeURIComponent(p.slug);
    return '<article class="prod-card">' +
      '<a class="prod-media" href="' + href + '">' +
        (tag ? '<span class="prod-tag' + (tagGold ? " prod-tag--gold" : "") + '">' + esc(tag) + "</span>" : "") +
        		'<img src="' + esc(p.images[0]) + '" alt="' + esc(p.name) + '" width="1024" height="1024" loading="lazy" decoding="async"></a>' +
      '<div class="prod-body"><span class="prod-cat">' + esc(catName(p.category)) + "</span>" +
        '<a class="prod-name" href="' + href + '">' + esc(p.name) + "</a>" +
        '<p class="prod-desc">' + esc(p.shortDescription) + "</p>" +
        '<div class="prod-foot"><span class="price">' + localPrice(p.priceUsd) +
          "<small>USD " + p.priceUsd.toFixed(2) + "</small></span>" +
          '<button class="add-mini" data-add="' + esc(p.id) + '" aria-label="Add ' + esc(p.name) + ' to cart">Add</button></div>' +
      "</div></article>";
  }

  function grid(products, tag) {
    return products.map(function (p) { return card(p, tag); }).join("");
  }

  function renderCategoryTiles(host) {
    if (!host) return;
    host.innerHTML = data.categories.map(function (c) {
      return '<a class="cat-card" href="shop.html?category=' + esc(c.id) + '">' +
        '<img src="' + esc(c.image) + '" alt="' + esc(c.name) + '" width="1024" height="1024" loading="lazy" decoding="async">' +
        '<div class="cat-card-body"><span>Browse</span><h3>' + esc(c.name) + "</h3></div></a>";
    }).join("");
  }

  /* ---------- pages ---------- */
  function pageHome() {
    var t = $("#homeTrending"), n = $("#homeNew"), c = $("#homeCategories");
    if (c) renderCategoryTiles(c);
    var list = data.products.slice();
    if (t) t.innerHTML = grid(list.slice(0, 4));
    var newest = list.slice().sort(function (a, b) { return (b.createdAt || "").localeCompare(a.createdAt || ""); });
    if (n) n.innerHTML = grid(newest.slice(0, 4), "New", true);
    var best = $("#homeBest");
    /* Best sellers is intentionally empty: it only renders when the backend
       returns real order counts (see README). No sales figures are invented. */
    if (best) best.hidden = true;
    var ship = $("#homeShipping");
    if (ship) {
      ship.innerHTML = Object.keys(C.markets).map(function (k) {
        var m = C.markets[k];
        if (m.status !== "live") return "";
        return '<div class="market-card"><h3>' + esc(m.name) + " <span>" + esc(m.currency) + "</span></h3>" +
          "<dl><dt>Est. delivery</dt><dd>" + m.shipping.eta[0] + "–" + m.shipping.eta[1] + " working days</dd>" +
          "<dt>Est. shipping</dt><dd>" + m.symbol + m.shipping.flat.toFixed(2) + " first item (indicative rate)</dd>" +
          "<dt>Additional item</dt><dd>" + m.symbol + m.shipping.perAdditionalItem.toFixed(2) + "</dd>" +
          "<dt>Carrier</dt><dd>International parcel (tracking provided when issued)</dd></dl>" +
          "<p>" + esc(m.taxNote) + "</p></div>";
      }).join("");
    }
  }

  function pageShop() {
    var host = $("#shopGrid");
    if (!host) return;
    var params = new URLSearchParams(location.search);
    var q = (params.get("q") || "").trim().toLowerCase();
    var cat = params.get("category") || "";
    var sort = $("#shopSort") ? $("#shopSort").value : "featured";

    var list = data.products.filter(shipsTo);
    if (cat) list = list.filter(function (p) { return p.category === cat; });
    if (q) {
      list = list.filter(function (p) {
        return (p.name + " " + p.shortDescription + " " + catName(p.category)).toLowerCase().indexOf(q) > -1;
      });
    }
    if (sort === "price-asc") list.sort(function (a, b) { return a.priceUsd - b.priceUsd; });
    if (sort === "price-desc") list.sort(function (a, b) { return b.priceUsd - a.priceUsd; });
    if (sort === "newest") list.sort(function (a, b) { return (b.createdAt || "").localeCompare(a.createdAt || ""); });

    var filters = $("#shopFilters");
    if (filters) {
      filters.innerHTML = '<h3>Categories</h3><ul class="filter-list">' +
        '<li><a href="shop.html" aria-current="' + (!cat ? "true" : "false") + '">All products<small>' + data.products.length + "</small></a></li>" +
        data.categories.map(function (c) {
          var count = data.products.filter(function (p) { return p.category === c.id; }).length;
          return '<li><a href="shop.html?category=' + esc(c.id) + '" aria-current="' + (cat === c.id ? "true" : "false") + '">' +
            esc(c.name) + "<small>" + count + "</small></a></li>";
        }).join("") + "</ul>" +
        '<h3>Delivery to</h3><select class="market-select" aria-label="Delivery country" style="width:100%">' + marketOptions() + "</select>" +
        '<p class="result-count" style="margin-top:12px">Prices shown in ' + esc(mkt().currency) + "</p>";
    }
    var count = $("#resultCount");
    if (count) {
      count.textContent = list.length + (list.length === 1 ? " product" : " products") + (q ? ' for “' + q + "”" : "");
      if (data.source === "sample") count.textContent += " · bundled sample data, not the live catalogue";
    }
    host.innerHTML = list.length ? grid(list) :
      '<div class="empty" style="grid-column:1/-1"><h3>Nothing matched that search</h3>' +
      "<p>Try a different word, or browse all products.</p><a class=\"btn btn--dark\" href=\"shop.html\">View all products</a></div>";
  }

  function pageCategories() {
    var host = $("#categoryGrid");
    if (!host) return;
    host.innerHTML = data.categories.map(function (c) {
      var count = data.products.filter(function (p) { return p.category === c.id; }).length;
      return '<div><a class="cat-card" href="shop.html?category=' + esc(c.id) + '">' +
        '<img src="' + esc(c.image) + '" alt="' + esc(c.name) + '" width="1024" height="1024" loading="lazy" decoding="async">' +
        '<div class="cat-card-body"><span>' + count + " products</span><h3>" + esc(c.name) + "</h3></div></a>" +
        '<p class="muted" style="font-size:.85rem;margin-top:10px">' + esc(c.blurb) + "</p></div>";
    }).join("");
  }

  function pageProduct() {
    var host = $("#pdp");
    if (!host) return;
    var slug = new URLSearchParams(location.search).get("p");
    var p = productBySlug(slug);
    if (!p) {
      document.title = "Product not found | MORGGY";
      host.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>We cannot find that product</h3>' +
        "<p>The link may be out of date, or the product has been withdrawn.</p>" +
        '<a class="btn btn--dark" href="shop.html">Browse all products</a></div>';
      return;
    }
    var variants = (p.variants || [])[0];
    if (variants && !ui.variant[variants.name]) ui.variant[variants.name] = variants.options[0];
    var vstring = variants ? ui.variant[variants.name] : "";
    /* What the cart actually charges for this market — not the supplier's cost. */
    var ship = mkt().shipping.flat;
    document.title = p.name + " | MORGGY";

    host.innerHTML =
      '<div class="pdp-media"><img src="' + esc(p.images[0]) + '" alt="' + esc(p.name) + '" width="1024" height="1024" fetchpriority="high"></div>' +
      "<div>" +
        '<div class="breadcrumb"><a href="index.html">Home</a><span>/</span><a href="shop.html">Shop</a><span>/</span>' +
          '<a href="shop.html?category=' + esc(p.category) + '">' + esc(catName(p.category)) + "</a></div>" +
        "<h1>" + esc(p.name) + "</h1>" +
        '<p class="pdp-sku">SKU ' + esc(p.sku) + " &middot; Ships to " + esc(mkt().name) + "</p>" +
        '<div class="price-row"><span class="price">' + localPrice(p.priceUsd) + "</span>" +
          '<span class="base">' + usd(p.priceUsd) + " USD base price</span></div>" +
        '<p class="fx-note">' + esc(fxNote()) + "</p>" +
        '<p class="lead">' + esc(p.description) + "</p>" +
        (variants ? '<div class="variant"><label>' + esc(variants.name) + '</label><div class="variant-opts">' +
          variants.options.map(function (o) {
            return '<button class="opt" data-opt="' + esc(variants.name) + '" data-value="' + esc(o) + '" aria-pressed="' +
              (o === vstring ? "true" : "false") + '">' + esc(o) + "</button>";
          }).join("") + "</div></div>" : "") +
        '<div class="buy-row"><div class="qty"><button data-qd="-1" aria-label="Decrease quantity">−</button>' +
          '<span id="pdpQty">' + ui.qty + '</span><button data-qd="1" aria-label="Increase quantity">+</button></div>' +
          '<button class="btn btn--gold" id="pdpAdd">Add to cart</button></div>' +
        '<div class="pdp-notes">' +
          "<div>" + I.truck + "<span>Estimated delivery to " + esc(mkt().name) + ": " + esc(etaText(p)) +
            (ship != null ? " &middot; est. shipping " + localPrice(ship) + " first item" : "") + "</span></div>" +
          "<div>" + I.shield + "<span>Supplier stock is confirmed upon order placement; full refund if unavailable.</span></div>" +
          "<div>" + I.globe + "<span>Imported from an overseas supplier. Import taxes, if any, are payable on delivery.</span></div>" +
        "</div>" +
      "</div>";

    var spec = $("#pdpSpecs");
    if (spec) {
      spec.innerHTML =
        "<table class=\"spec-table\">" +
        "<tr><th>Category</th><td>" + esc(catName(p.category)) + "</td></tr>" +
        "<tr><th>Weight</th><td>" + p.weightKg + " kg</td></tr>" +
        "<tr><th>Dimensions</th><td>" + p.dimensionsCm.length + " × " + p.dimensionsCm.width + " × " + p.dimensionsCm.height + " cm</td></tr>" +
        "<tr><th>Shipping to " + esc(mkt().name) + "</th><td>" + (ship != null
          ? localPrice(ship) + " first item, " + localPrice(mkt().shipping.perAdditionalItem) + " each additional"
          : "Unavailable") + "</td></tr>" +
        "<tr><th>Estimated delivery</th><td>" + esc(etaText(p)) + "</td></tr>" +
        "<tr><th>Supplier</th><td>" + esc(p.supplier.name) + (p.supplier.mappingStatus === "unmapped" ? " (mapping pending)" : "") + "</td></tr>" +
        "<tr><th>Availability</th><td>" + (p.availability === "unverified" ? "Confirmed with supplier at order time" : esc(p.availability)) + "</td></tr>" +
        "</table>";
    }
    var features = $("#pdpFeatures");
    if (features) features.innerHTML = '<div class="panel"><h3>Details</h3><ul>' +
      (p.features || []).map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul></div>";

    var related = $("#pdpRelated");
    if (related) {
      var sameCat = data.products.filter(function (x) { return x.category === p.category && x.id !== p.id; });
      var rest = data.products.filter(function (x) { return x.category !== p.category; });
      related.innerHTML = grid(sameCat.concat(rest).slice(0, 4));
    }

    var add = $("#pdpAdd");
    if (add) add.onclick = function () { addToCart(p.id, ui.qty, vstring); };
    $$("[data-qd]").forEach(function (b) {
      b.onclick = function () {
        ui.qty = Math.max(1, Math.min(20, ui.qty + Number(b.dataset.qd)));
        $("#pdpQty").textContent = ui.qty;
      };
    });
    $$("[data-opt]").forEach(function (b) {
      b.onclick = function () {
        ui.variant[b.dataset.opt] = b.dataset.value;
        $$("[data-opt]").forEach(function (o) {
          o.setAttribute("aria-pressed", o.dataset.opt === b.dataset.opt && o.dataset.value === b.dataset.value ? "true" : "false");
        });
      };
    });
  }

  function pageCart() {
    var host = $("#cartItems");
    if (!host) return;
    var L = lines();
    if (!L.length) {
      $("#cartLayout").innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>Your cart is empty</h3>' +
        "<p>Browse the range and add something you will actually use.</p>" +
        '<a class="btn btn--dark" href="shop.html">Shop all products</a></div>';
      return;
    }
    host.innerHTML = L.map(function (l) {
      var v = l.variant ? '<span class="meta">' + esc(l.variant) + "</span>" : "";
      return '<div class="cart-item"><img src="' + esc(l.p.images[0]) + '" alt="' + esc(l.p.name) + '" width="104" height="104" loading="lazy">' +
        "<div><h3>" + esc(l.p.name) + "</h3>" + v +
        '<p class="meta">' + esc(l.p.sku) + " &middot; ships in " + esc(etaText(l.p)) + "</p>" +
        '<div class="qty"><button data-qty="' + esc(l.key) + '" data-delta="-1" aria-label="Decrease quantity">−</button>' +
          "<span>" + l.qty + '</span><button data-qty="' + esc(l.key) + '" data-delta="1" aria-label="Increase quantity">+</button></div>' +
          '<button class="remove" data-remove="' + esc(l.key) + '" style="margin-left:14px">Remove</button></div>' +
        '<div class="line-price">' + localPrice(l.p.priceUsd * l.qty) +
          "<small style=\"display:block;font-weight:400;color:var(--muted);font-size:.72rem\">" + usd(l.p.priceUsd * l.qty) + " USD</small></div></div>";
    }).join("");

    var sub = subtotal(), ship = shippingUsd();
    var rows = $("#cartSummary");
    if (rows) rows.innerHTML = '<div class="summary"><h2>Order summary</h2>' +
      '<div class="field"><label for="cartMarket">Deliver to</label>' +
        '<select class="market-select" id="cartMarket" style="width:100%">' + marketOptions() + "</select></div>" +
      '<div class="summary-row"><span>Subtotal<small>' + itemCount() + " item" + (itemCount() === 1 ? "" : "s") + "</small></span><span>" + localPrice(sub) + "</span></div>" +
      '<div class="summary-row"><span>Shipping<small>' + esc(mkt().name) + " &middot; " + esc(etaText({ deliveryDays: {} })) + "</small></span><span>" +
        (mkt().status === "live" ? localPrice(ship) : "—") + "</span></div>" +
      '<div class="summary-row summary-row--total"><span>Total</span><span>' + localPrice(sub + ship) + "</span></div>" +
      '<p class="result-count" style="margin:6px 0 16px">' + usd(sub + ship) + " USD charged</p>" +
      (mkt().status === "live"
        ? '<a class="btn btn--gold btn--block" href="checkout.html">Continue to checkout</a>'
        : '<div class="notice"><strong>Not available in ' + esc(mkt().name) + " yet</strong>Choose Singapore or Malaysia above to continue.</div>") +
      '<p class="result-count" style="margin-top:14px">' + esc(fxNote()) + "</p></div>";
  }

  function addressFieldsHTML(m) {
    var f = {
      line1: { label: "Address line 1", ph: "Street, building" },
      line2: { label: "Address line 2 (optional)", ph: "Unit, floor, landmark", optional: true },
      city: { label: "City", ph: "City" },
      postalCode: { label: "Postcode", ph: m.postalExample },
      state: { label: "State", select: m.states || [] }
    };
    return m.addressFields.map(function (k) {
      var d = f[k];
      if (!d) return "";
      if (d.select && d.select.length) {
        return '<div class="field"><label for="f-' + k + '">' + d.label + '</label><select id="f-' + k + '" name="' + k + '" required>' +
          d.select.map(function (s) { return "<option>" + esc(s) + "</option>"; }).join("") + "</select></div>";
      }
      return '<div class="field"><label for="f-' + k + '">' + d.label + '</label><input id="f-' + k + '" name="' + k + '" ' +
        'placeholder="' + esc(d.ph) + '" ' + (d.optional ? "" : "required") + "></div>";
    }).join("");
  }

  function summaryHTML() {
    var L = lines(), sub = subtotal(), ship = shippingUsd();
    var m = mkt();
    return '<div class="summary"><h2>Order summary</h2>' +
      '<div class="field"><label for="summaryMarket">Deliver to</label>' +
        '<select class="market-select" id="summaryMarket" style="width:100%">' + marketOptions() + "</select></div>" +
      L.map(function (l) {
        return '<div class="summary-row"><span>' + l.qty + " × " + esc(l.p.name) +
          (l.variant ? '<small>' + esc(l.variant) + "</small>" : "") + "</span><span>" + localPrice(l.p.priceUsd * l.qty) + "</span></div>";
      }).join("") +
      '<div class="summary-row"><span>Subtotal</span><span>' + localPrice(sub) + "</span></div>" +
      '<div class="summary-row"><span>Shipping</span><span>' + (m.status === "live" ? localPrice(ship) : "—") + "</span></div>" +
      '<div class="summary-row summary-row--total"><span>Total</span><span>' + localPrice(sub + ship) + "</span></div>" +
      '<p class="result-count" style="margin-top:6px">' + usd(sub + ship) + " USD — the amount you are charged</p>" +
      '<p class="result-count" style="margin-top:12px">' + esc(fxNote()) + "</p></div>";
  }

  function pageCheckout() {
    var host = $("#checkoutForm");
    if (!host) return;
    if (!lines().length) {
      $("#checkoutWrap").innerHTML = '<div class="empty"><h3>Your cart is empty</h3>' +
        '<p>Add a product before checking out.</p><a class="btn btn--dark" href="shop.html">Shop all products</a></div>';
      return;
    }
    var m = mkt();
    if (m.status !== "live") {
      host.innerHTML = '<div class="empty"><h3>We do not deliver to ' + esc(m.name) + " yet</h3>" +
        '<p>Orders are currently accepted for Singapore and Malaysia only. Choose a supported country in the summary.</p>' +
        '<a class="btn btn--dark" href="cart.html">Back to cart</a></div>';
      var s0 = $("#checkoutSummary");
      if (s0) s0.innerHTML = summaryHTML();
      return;
    }
    host.innerHTML = '<form id="coForm">' +
      '<div class="steps"><span class="step is-on"><b>1</b>Details</span><span class="step is-on"><b>2</b>Delivery</span>' +
        '<span class="step"><b>3</b>Payment</span></div>' +
      '<div class="form-card"><h2>Contact</h2><p class="sub">We only email about this order.</p>' +
        '<div class="field-row"><div class="field"><label for="c-name">Full name</label>' +
          '<input id="c-name" name="name" autocomplete="name" required></div>' +
          '<div class="field"><label for="c-email">Email</label><input id="c-email" name="email" type="email" autocomplete="email" required></div></div>' +
        '<div class="field"><label for="c-phone">Mobile number</label>' +
          '<input id="c-phone" name="phone" type="tel" autocomplete="tel" placeholder="' + esc(m.name === "Singapore" ? "+65 8123 4567" : "+60 12-345 6789") + '" required>' +
          '<p class="hint">The courier uses this number for delivery updates.</p></div></div>' +
      '<div class="form-card"><h2>Delivery address</h2><p class="sub">' + esc(m.name) + " — enter the address exactly as it appears on local mail.</p>" +
        addressFieldsHTML(m) +
        '<div class="notice"><strong>Import charges</strong>' + esc(m.taxNote) + "</div></div>" +
      '<div class="form-card"><h2>Payment</h2><p class="sub">Cards are handled by the payment provider. MORGGY never sees or stores card details.</p>' +
        '<div class="notice"><strong>Payments are not live yet</strong>' +
        "The Paystack and Flutterwave integration is being finalised, so no order can be completed and no money can be taken from this page. " +
        "Nothing is submitted until a gateway confirms payment on our server.</div>" +
        '<div id="payResult"></div>' +
        '<button class="btn btn--gold btn--block" type="submit">Continue to payment &middot; ' + localPrice(subtotal() + shippingUsd()) + "</button>" +
        '<p class="result-count" style="margin-top:12px">Need this now? <a class="link-arrow" href="contact.html">Contact us</a> and we will confirm availability by email.</p></div>' +
      "</form>";

    var summary = $("#checkoutSummary");
    if (summary) summary.innerHTML = summaryHTML();

    /* Stable for this page view, so retrying a slow submit cannot create two orders. */
    var idemKey = window.Store && Store.configured ? Store.idempotencyKey() : "";

    $("#coForm").onsubmit = function (e) {
      e.preventDefault();
      var form = e.target, out = $("#payResult");
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var fd = new FormData(form);
      var emailValue = String(fd.get("email") || "").trim();

      if (!window.Store || !Store.configured) {
        out.innerHTML = '<div class="notice"><strong>No order was placed</strong>' +
          "This storefront is not connected to an order database, so nothing was charged and nothing was sent to a supplier. " +
          'To have us hold these items, email <a href="mailto:' + esc(C.brand.ordersEmail) + '">' +
          esc(C.brand.ordersEmail) + "</a> with your delivery country.";
        return;
      }

      out.innerHTML = '<div class="notice">Creating your order…</div>';

      /* Totals are recomputed on the server; nothing price-related is trusted
         from this page. */
      Store.placeOrder({
        market: market,
        customer: { name: fd.get("name"), email: emailValue, phone: fd.get("phone") },
        address: {
          line1: fd.get("line1"), line2: fd.get("line2") || "",
          city: fd.get("city") || "", postcode: fd.get("postalCode"), state: fd.get("state") || ""
        },
        items: lines().map(function (l) {
          return { productId: l.p.id, quantity: l.qty, variantLabel: l.variant };
        }),
        idempotencyKey: idemKey
      }).then(function (order) {
        out.innerHTML = '<div class="notice">Order ' + esc(order.orderNumber) + " created. Opening the payment page…</div>";
        return Store.initiatePayment({ orderNumber: order.orderNumber, email: emailValue })
          .then(function (payment) {
            out.innerHTML = '<div class="notice"><strong>Taking you to payment</strong>Order ' +
              esc(order.orderNumber) + " · " + localPrice(order.totals.totalUsd) +
              ". You will come back to this site afterwards.</div>";
            window.location.href = payment.authorizationUrl;
          })
          .catch(function (err) {
            out.innerHTML = '<div class="notice"><strong>Order saved, payment not started</strong>' +
              "Order " + esc(order.orderNumber) + " is held for you, but " +
              esc(err.message || "the payment page could not open.") +
              " Nothing has been charged. Email <a href=\"mailto:" + esc(C.brand.ordersEmail) + "\">" +
              esc(C.brand.ordersEmail) + "</a> and we will send a payment link.";
          });
      }).catch(function (err) {
        out.innerHTML = '<div class="notice"><strong>No order was placed</strong>' +
          esc(err.message || "That request could not be completed.") + " Nothing has been charged.";
      });
    };
  }

  function pageTrack() {
    var form = $("#trackForm");
    if (!form) return;
    form.onsubmit = function (e) {
      e.preventDefault();
      var out = $("#trackResult");
      var fd = new FormData(form);
      var orderNumber = String(fd.get("order") || "").trim();
      var email = String(fd.get("email") || "").trim();

      if (!window.Store || !Store.configured) {
        out.innerHTML = '<div class="notice"><strong>Tracking is not connected yet</strong>' +
          "Order lookups become available once the order database is connected. If you already ordered, email " +
          '<a href="mailto:' + esc(C.brand.ordersEmail) + '">' + esc(C.brand.ordersEmail) + "</a> with your order number and we will send the latest courier status.</div>";
        return;
      }

      out.innerHTML = '<div class="notice">Looking up order…</div>';
      Store.trackOrder(orderNumber, email).then(function (order) {
        var shipments = order.shipments || [];
        var tracking = shipments.map(function (s) {
          if (!s.trackingNumber) return "No tracking number yet";
          var label = "Tracking " + esc(s.trackingNumber);
          return s.trackingUrl
            ? '<a href="' + esc(s.trackingUrl) + '" target="_blank" rel="noopener">' + label + "</a>"
            : label;
        }).join(", ");

        out.innerHTML = '<div class="notice"><strong>Order ' + esc(order.orderNumber) + " — " +
          esc(order.statusLabel || order.status) + "</strong>" +
          "Placed " + esc(new Date(order.placedAt).toLocaleDateString()) +
          " · " + localPrice(Number(order.totals.totalUsd)) + " (" +
          usd(Number(order.totals.totalUsd)) + " USD)" +
          "<br>" + (shipments.length ? tracking : esc(order.note || "")) + "</div>";
      }).catch(function (err) {
        out.innerHTML = '<div class="notice"><strong>No match</strong>' +
          esc(err.message || "We could not find an order with those details.") +
          " Check the order number and use the email address given at checkout.</div>";
      });
    };
  }

  function pageContact() {
    var form = $("#contactForm");
    if (!form) return;
    form.onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var order = String(fd.get("order") || "").trim();
      var body = "Name: " + fd.get("name") + "\nEmail: " + fd.get("email") +
        (order ? "\nOrder number: " + order : "") + "\n\n" + fd.get("message");
      location.href = "mailto:" + C.brand.email + "?subject=" + encodeURIComponent(fd.get("subject") || "Website enquiry") +
        "&body=" + encodeURIComponent(body);
      var out = $("#contactResult");
      if (out) out.innerHTML = '<div class="notice">Your email app should open with the message ready to send. If it does not, write to ' +
        '<a href="mailto:' + esc(C.brand.email) + '">' + esc(C.brand.email) + "</a>.</div>";
    };
  }

  function bindNewsletter() {
    $$("form[data-newsletter]").forEach(function (f) {
      f.onsubmit = function (e) {
        e.preventDefault();
        var out = f.parentElement.querySelector(".form-note");
        if (C.apiBase && C.newsletter.enabled) {
          fetch(C.apiBase + "/newsletter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: new FormData(f).get("email") }) })
            .then(function () { f.reset(); if (out) out.textContent = "You are on the list. Welcome to MORGGY."; })
            .catch(function () { if (out) out.textContent = "That did not go through. Please try again."; });
        } else if (out) {
          out.textContent = "The newsletter opens with the backend. Until then, email " + C.brand.email + " and we will add you.";
        }
      };
    });
  }

  /* ---------- routing ---------- */
  function renderPage() {
    var page = document.body.dataset.page || "home";
    if (page === "home") pageHome();
    if (page === "shop") pageShop();
    if (page === "categories") pageCategories();
    if (page === "product") pageProduct();
    if (page === "cart") pageCart();
    if (page === "checkout") pageCheckout();
    if (page === "track") pageTrack();
    if (page === "contact") pageContact();
    updateCount();
  }

  function bindGlobal() {
    document.addEventListener("click", function (e) {
      var add = e.target.closest("[data-add]");
      if (add) {
        var p = productById(add.dataset.add);
        var v = p && p.variants && p.variants[0] ? p.variants[0].options[0] : "";
        addToCart(add.dataset.add, 1, v);
        return;
      }
      var qb = e.target.closest("[data-qty]");
      if (qb) {
        var line = cart.filter(function (l) { return lineKey(l) === qb.dataset.qty; })[0];
        if (line) setQty(qb.dataset.qty, line.qty + Number(qb.dataset.delta));
        return;
      }
      var rm = e.target.closest("[data-remove]");
      if (rm) { removeLine(rm.dataset.remove); return; }
    });

    document.addEventListener("change", function (e) {
      if (e.target.matches(".market-select")) {
        market = e.target.value;
        localStorage.setItem(keyMarket, market);
        renderChrome();
        renderPage();
      }
    });

    document.addEventListener("click", function (e) {
      var t = e.target.closest("#searchToggle");
      if (t) {
        var panel = $("#searchPanel");
        var open = panel.classList.toggle("is-open");
        t.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) $("#q").focus();
      }
      var n = e.target.closest("#navToggle");
      if (n) {
        var mp = $("#mobilePanel");
        var isOpen = mp.classList.toggle("is-open");
        n.setAttribute("aria-expanded", isOpen ? "true" : "false");
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      ["#mobilePanel", "#searchPanel"].forEach(function (sel) {
        var panel = $(sel);
        if (!panel || !panel.classList.contains("is-open")) return;
        panel.classList.remove("is-open");
        var trigger = $(sel === "#mobilePanel" ? "#navToggle" : "#searchToggle");
        if (trigger) trigger.setAttribute("aria-expanded", "false");
      });
    });

    var sort = $("#shopSort");
    if (sort) sort.onchange = renderPage;
  }

  /* Live FX rates from the database replace the baked-in estimates. */
  function applyRates(rates) {
    if (!rates) return;
    var today = new Date().toISOString().slice(0, 10);
    Object.keys(C.markets).forEach(function (code) {
      var rate = rates[C.markets[code].currency];
      if (rate && rate > 0) {
        C.markets[code].fx = rate;
        C.markets[code].fxUpdatedAt = today;
      }
    });
  }

  /* ---------- boot ---------- */
  async function boot() {
    renderChrome();
    bindGlobal();

    var remote = null;
    if (window.Store && window.Store.configured) {
      try {
        remote = await Store.loadCatalogue();
      } catch (err) {
        console.error("Catalogue database unavailable; falling back to bundled sample data", err);
      }
    }

    if (remote && remote.products) {
      data.products = remote.products.filter(function (p) { return p.status === "published"; });
      data.categories = remote.categories || [];
      data.source = "database";
      applyRates(remote.rates);
    } else {
      try {
        var res = await Promise.all([
          fetch("data/products.json").then(function (r) { return r.json(); }),
          fetch("data/categories.json").then(function (r) { return r.json(); })
        ]);
        data.products = res[0].filter(function (p) { return p.status === "active"; });
        data.categories = res[1];
        data.source = "sample";
      } catch (err) {
        console.error("Catalogue failed to load", err);
      }
    }

    renderPage();
    bindNewsletter();
    var badge = $("#catalogueCount");
    if (badge) badge.textContent = data.products.length;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
