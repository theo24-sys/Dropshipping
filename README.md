# MORGGY — international storefront

**Discover more. Live better.**

Static storefront for MORGGY (Morggy Technologies, Nairobi, Kenya). No build step, no
framework: plain HTML, CSS and JavaScript, deployable to Cloudflare Pages as-is.

## What is in this folder

```
index.html          homepage
shop.html           shop all (filters, sort, search via ?q=)
categories.html     six launch categories
product.html        product detail — driven by ?p=<slug>
cart.html           cart, destination selection, shipping
checkout.html       contact + address + payment step
track.html          order lookup
about.html  contact.html  faq.html
shipping.html  returns.html  privacy.html  terms.html
assets/css/styles.css
assets/js/config.js   store settings: markets, FX, shipping, payments, API
assets/js/app.js      catalogue, cart, currency, page rendering
data/products.json    product catalogue (full supplier schema)
data/categories.json  categories
assets/img/           product and hero photography
```

## Selling model

- International dropshipping. MORGGY holds **no inventory**; CJdropshipping ships
  directly to the customer.
- Internal base and settlement currency: **USD**. Singapore dollars and Malaysian
  ringgit are display estimates converted from `fx` in `config.js`.
- Live markets: **Singapore (SGD)** and **Malaysia (MYR)**. Vietnam is listed as
  `waitlist` — it appears in the selector as "coming soon" and checkout refuses it.

## What is real and what is not (read before launch)

| Area | State |
| --- | --- |
| Storefront, catalogue, cart, currency, shipping maths | Working, client-side |
| Product photography | AI-generated placeholders — replace with supplier images |
| Product data, prices, supplier costs | Launch sample data — verify against CJ before selling |
| Payments (Paystack / Flutterwave) | **Not connected.** `payments.enabled: false`; checkout states no order is placed |
| Order creation, tracking, newsletter, contact | **Not connected.** `apiBase` is empty; forms fall back to email |
| CJdropshipping import / sync / order submission | **Not built.** Supplier fields exist but every product is `unmapped` |
| Reviews, ratings, best sellers | Deliberately absent — nothing is invented |

The Best Sellers section is intentionally left out of the homepage. Only add it once
`/api/bestsellers` returns real order counts.

## Backend contract (stage 3 onwards)

Set `apiBase` in `config.js` to the deployed Django API (e.g. `https://api.morggy.com`)
and keep `payments.enabled: false` until the gateway is verified end to end.

Endpoints the storefront expects:

| Method | Path | Body / notes |
| --- | --- | --- |
| `POST` | `/orders` | `market`, `displayCurrency`, `chargeCurrency`, `customer`, `address`, `items[{productId,sku,variant,qty,unitPriceUsd}]`, `totals`. Returns `{orderNumber, paymentUrl}` or `{unavailable:[sku]}`. The server checks supplier stock **before** creating a payment. |
| `POST` | `/track` | `{orderNumber, email}` → `{status, events[]}` |
| `POST` | `/newsletter` | `{email}` |
| webhook | `/payments/paystack`, `/payments/flutterwave` | Verify the signature server-side, then set `payment_status = verified` |

Server rules that must not be broken:

1. Never accept an order for a product the supplier cannot supply.
2. Never submit an order to CJ before the payment webhook is verified.
3. Recalculate totals on the server — never trust cart prices from the browser.
4. Keep customer records and supplier records in separate tables.
5. Record landed cost, shipping, gateway fee and refunds so margin can be reported.

## Product schema (`data/products.json`)

`id, slug, name, category, sku, shortDescription, description, features[], images[],
variants[{name, options[]}], priceUsd, supplier{name, productId, url, costUsd,
lastSyncedAt, mappingStatus}, shippingCostUsd{SG,MY}, weightKg, dimensionsCm{length,
width,height}, destinations[], deliveryDays{SG:[min,max],MY:[min,max]}, supplierStock,
availability, status, createdAt`

Profit margin is derived, not stored: `priceUsd − supplier.costUsd − shippingCostUsd[market]`.
The product page shows the landed cost for transparency.

## Configuration

All commercial settings live in `assets/js/config.js`:

- `markets.<code>.fx` — local units per 1 USD; update and bump `fxUpdatedAt`.
- `markets.<code>.shipping` — flat rate, per-additional-item rate, ETA range.
- `markets.<code>.status` — `live` or `waitlist`.
- `payments` — providers and modes; `enabled` must stay `false` until verification works.
- `brand.whatsapp`, `brand.email` — **placeholders, replace before launch.**

## Run locally

Serve the folder over HTTP (the catalogue is fetched with `fetch`, so `file://` will
not work):

```
python -m http.server 8123 -d .
```

or any static server, then open <http://localhost:8123/>.

## Deploy

Cloudflare Pages → Connect to Git → build command empty, output directory `/`.
`_headers` sets a five-minute cache; shorten it while editing content.
