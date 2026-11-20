# MORGGY — international storefront

**Discover more. Live better.**

MORGGY is a dropshipping store for Singapore and Malaysia, operated by
Morggy Technologies (Nairobi, Kenya). Prices are held in USD; SGD and MYR are
display conversions. The front end is plain HTML/CSS/JavaScript with no build
step; the backend is Supabase (PostgreSQL, Auth, Storage, Edge Functions, RLS).

---

## Status

| Area | State |
| --- | --- |
| Storefront (15 pages) | Built. Branding, layout and responsive behaviour preserved. |
| Catalogue | Read from `v_product_public` when Supabase is configured; falls back to the bundled sample JSON otherwise. |
| Customer accounts | Implemented (Supabase Auth + `profiles` + RLS). Needs a live project to test. |
| Guest checkout | Implemented in the `place-order` function. |
| Payments | Paystack and Flutterwave code paths written. **Not operational** until secret keys and webhook URLs are configured. |
| Webhooks | Signature verification, amount matching and duplicate protection implemented. |
| Refunds | Paystack path implemented; Flutterwave refunds are recorded manually. |
| CJdropshipping | Edge Function written for sync, stock, freight, order creation and tracking. **No credentials configured; payloads not tested against CJ.** |
| Admin dashboard | Built at `/admin/` (products, verification, mapping, stock, orders, payments, refunds, shipments, analytics, customers, audit). |
| RLS | Policies for every table. Tests written in `supabase/tests/rls.sql`. |
| Migrations | Four SQL migrations + seed. Not yet applied to any project. |

Nothing in this repository has been tested against a live Supabase project: the
build environment has no Supabase CLI, no Python/Deno runtime and no network
access to a project. Everything below marked "verify" has to be run once
credentials exist.

---

## Layout

```
index.html  shop.html  categories.html  product.html  cart.html
checkout.html  track.html  account.html
about.html  contact.html  faq.html
shipping.html  returns.html  privacy.html  terms.html
admin/index.html                 staff dashboard (single page + hash routes)
assets/css/styles.css            storefront design system
assets/css/admin.css             dashboard styles
assets/js/config.js              brand, markets, FX, Supabase URL + anon key
assets/js/store.js               Supabase data/auth/function layer
assets/js/app.js                 storefront rendering, cart, checkout, tracking
assets/js/account.js             sign in / sign up / reset / profile / orders
assets/js/admin.js               dashboard logic
data/products.json               bundled sample catalogue (fallback only)
supabase/migrations/*.sql        schema, RLS, views, storage
supabase/seed.sql                demo catalogue (clearly labelled DEMO-)
supabase/functions/*             Edge Functions
supabase/tests/rls.sql           pgTAP tests for the access rules
.env.example                     every variable the project reads (placeholders)
```

---

## Setup for a new Supabase project

### 1. Create the project

Create a project at <https://supabase.com/dashboard>, then locally:

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

### 2. Apply the schema

```bash
supabase db push          # runs supabase/migrations in order
```

Or paste each file from `supabase/migrations/` into the SQL editor, in
filename order. The migrations are transactional.

### 3. Seed demo data (optional)

```bash
supabase db reset                       # local: migrations + seed
psql "$DATABASE_URL" -f supabase/seed.sql   # hosted
```

The seed creates six categories, nine products with `DEMO-` SKUs, two shipping
rates and three exchange rates. Every seeded product is `is_verified = false`
and every supplier row is `unmapped`, because no supplier item has actually been
selected. No orders, payments, reviews or sales figures are seeded.

### 4. Deploy the Edge Functions

```bash
supabase functions deploy place-order initiate-payment track-order \
  paystack-webhook flutterwave-webhook verify-payment process-refund cj-sync
```

JWT requirements per function are declared in `supabase/config.toml`: the
webhooks and guest checkout do not require a JWT, the staff functions do.

### 5. Set the server secrets

Copy `.env.example` to `.env`, fill it in, then:

```bash
supabase secrets set --env-file .env
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided
to functions automatically — do not set them yourself.

### 6. Point the storefront at the project

Edit `assets/js/config.js`:

```js
supabase: {
  url: "https://<ref>.supabase.co",
  anonKey: "<anon public key>"
}
```

The anon key is meant to be public. The service role key must never appear in
this file, in `data/`, or in any HTML.

### 7. Create the first administrator

Sign up through `/account.html`, then run this in the SQL editor (it needs the
service role; the browser cannot do it):

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

Staff accounts (`role = 'staff'`) get the dashboard but cannot change roles.

### 8. Run locally

```bash
supabase start
supabase functions serve --env-file .env
```

The storefront is static: serve the repository root with any file server and
open `index.html`, then `/admin/`.

---

## Edge Functions

| Function | Auth | Purpose |
| --- | --- | --- |
| `place-order` | optional JWT | Recomputes prices and shipping from the database, creates an order in `pending_payment`. Idempotent per `idempotencyKey`. Never marks anything paid. |
| `initiate-payment` | optional JWT | Creates a Paystack/Flutterwave checkout for a pending order owned by the caller. Amount comes from the order row. |
| `track-order` | none | Returns status for one order number + matching email. Same response for "not found" and "wrong email". |
| `paystack-webhook` | HMAC | Verifies `x-paystack-signature`, deduplicates via `webhook_events`, checks amount/currency, marks the payment and order paid once. |
| `flutterwave-webhook` | verif-hash | Verifies the header, then re-verifies each transaction against the API before marking paid. |
| `verify-payment` | staff | Manual re-verification when a webhook was missed. |
| `process-refund` | staff | Sends a refund to Paystack for a captured payment; Flutterwave returns 501 with guidance. |
| `cj-sync` | staff | `sync_product`, `check_stock`, `shipping_estimate`, `create_supplier_order`, `sync_tracking`. |

Supplier orders are only created when `orders.paid_at` is set and the status is
`paid` or `processing`, and a second submission for the same order is refused.

### Payment configuration

* **Paystack** — set `PAYSTACK_SECRET_KEY`. In the Paystack dashboard add
  `https://<ref>.supabase.co/functions/v1/paystack-webhook` as the webhook URL.
  Charges are created in USD because the store's base currency is USD.
* **Flutterwave** — set `FLUTTERWAVE_SECRET_KEY` and `FLUTTERWAVE_SECRET_HASH`,
  and point the webhook at `.../functions/v1/flutterwave-webhook`.
* `PAYMENT_CALLBACK_URL` is where the gateway returns the customer. It is a
  redirect only — status is never taken from the URL.

### CJ configuration

Set `CJ_API_EMAIL`, `CJ_API_KEY` and optionally `CJ_API_BASE`. Map a product in
the dashboard (Products → Map) before using any CJ action; unmapped products
produce a clear 409 instead of a guess.

`createOrderV2` accepts a payload that varies by CJ account. The body in
`supabase/functions/cj-sync/index.ts` follows the documented shape but must be
checked against the live account before the button is used for real orders.

---

## Data model

Fifteen tables plus two supporting ones:

`profiles`, `categories`, `products`, `product_variants`, `suppliers`,
`supplier_products`, `inventory`, `shipping_methods`, `addresses`, `orders`,
`order_items`, `payments`, `shipments`, `refunds`, `exchange_rates`,
`audit_logs`, and `webhook_events` (webhook idempotency).

* Money is `numeric(10,2)` in USD.
* `orders.total_usd` is constrained to `subtotal_usd + shipping_usd`.
* Order lines store a snapshot of name, SKU and price, so later catalogue edits
  cannot rewrite history.
* `orders.order_number` is generated by trigger as `MOR-YYYY-NNNNNN`.
* `audit_logs` records product, supplier-mapping, inventory, shipping-rate,
  order, payment and refund changes, with the actor's email.
* Views: `v_product_public` (storefront), `v_order_profit`, `v_product_profit`.
  All use `security_invoker`, so staff see cost data and customers do not.

### Access rules

| Data | Anonymous | Customer | Staff |
| --- | --- | --- | --- |
| Published products, categories, shipping rates, FX | read | read | read + write |
| Draft products, supplier cost, supplier items, inventory | — | — | read + write |
| Own profile, addresses | — | read + write | read |
| Orders, payments, shipments, refunds | — | own only | all |
| Audit log | — | — | read |
| Webhook events | — | — | service role only |

Orders and payments are writable only by the service role inside Edge Functions.
A customer changing their own `role` is blocked by a trigger as well as by RLS.

---

## Testing

### RLS tests (pgTAP)

`supabase/tests/rls.sql` sets `request.jwt.claims` for two customers and one
staff user, then asserts what each can read and that a customer cannot promote
themselves. It needs pgTAP:

```sql
create extension if not exists pgtap with schema extensions;
```

Then run it with `psql`, or `supabase test db` if pgTAP is installed locally.
**These tests have not been run** — no Supabase instance was available here.

### Manual end-to-end checklist

Run through this against a real project before launch:

1. **Storefront data** — `/shop.html` shows products from the database and the
   footer of the listing does *not* say "bundled sample data".
2. **Sign up** — `/account.html` creates an account; a row appears in `profiles`
   with role `customer`.
3. **RLS** — signed in as customer A, a direct `select * from orders` in the
   browser console returns only A's orders.
4. **Guest order** — checkout without signing in; `orders` gains one row,
   status `pending_payment`, and the totals equal the cart.
5. **Tampered price** — resubmit `place-order` with a lower `totals` object; the
   order still stores the database price.
6. **Duplicate submit** — send the same `idempotencyKey` twice; only one order
   exists and the second response has `"duplicate": true`.
7. **Payment** — with test keys, paying redirects back with the order still
   `pending_payment` until the webhook lands; then it becomes `paid` once.
8. **Webhook replay** — resend the same Paystack payload; response says
   `duplicate` and the order is untouched.
9. **Bad signature** — POST the webhook with a wrong signature; 401 and no
   change.
10. **Tracking** — `/track.html` returns status for the right email and the same
    "no match" message for a wrong one.
11. **Supplier guard** — `cj-sync` `create_supplier_order` on an unpaid order
    returns 409.
12. **Staff isolation** — a customer account opening `/admin/` sees
    "No staff access"; a direct insert into `products` fails with RLS.

### Quick API checks

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/place-order" \
  -H "Content-Type: application/json" -H "apikey: $ANON_KEY" \
  -d '{"market":"VN","customer":{"name":"Test","email":"t@example.com","phone":"+6512345678"},
       "address":{"line1":"1 Road","postcode":"238823"},"items":[]}'
# expect 400 market_not_open / empty_cart
```

---

## Missing credentials and known gaps

* No Supabase project, URL, anon key or service role key is configured.
* No Paystack or Flutterwave account; no test or live keys.
* No CJdropshipping API key; no product is mapped to a real CJ item.
* Product imagery is generated placeholder art; no product has been verified.
* The seed catalogue is demo data and says so (`DEMO-` SKUs).
* `createOrderV2` payload shape needs confirming against the live CJ account.
* Flutterwave refunds are not automated (recorded manually by staff).
* Email (order confirmation, password reset templates) is Supabase default;
  no custom SMTP is configured.
* Newsletter signup falls back to email because no list provider is connected.

## Security notes

* Card data never touches this codebase — only the gateway checkout page.
* Payment status comes from a verified webhook or a server-side API check, never
  from a redirect or from `localStorage`.
* Amounts are recalculated server-side; client totals are ignored.
* Webhook bodies are read raw before signature verification; each provider event
  is stored once in `webhook_events`.
* All secrets live in Supabase secrets; `.env` is gitignored and the service role
  key is never shipped to the browser.
* Administrative writes are captured in `audit_logs`.

## Deploying the storefront

The static files can be served by any host (Cloudflare Workers, Pages, Netlify,
S3). No framework and no build tooling beyond a copy step are required.

### Cloudflare Workers (wrangler)

`wrangler.jsonc` deploys the site as an assets-only Worker; `dist/` is the
uploaded directory, and `supabase/`, tests and docs are never published.

Requirements: Node 18+ and a Cloudflare account. Wrangler is not installed in
this repository's build environment — run these on a machine with Node:

```bash
cd morggy              # this directory (contains wrangler.jsonc)
npm install            # installs wrangler locally
npx wrangler login     # one browser approval, stores an OAuth token
npm run deploy         # builds dist/ and deploys the Worker
```

`npm run preview` serves the same build locally at the worker URL. `npm run
check` runs `node --check` over the four browser scripts, which is the quickest
way to catch a syntax error before deploying.

Notes:

* Work out the deployed URL (`https://morggy.<subdomain>.workers.dev`) after the
  first run; add a custom domain from the Cloudflare dashboard if needed.
* Workers static assets do not read a `_headers` file (that is a Pages feature),
  so the cache header in `_headers` applies only if you deploy through Pages.
* Fill in `assets/js/config.js` with the Supabase URL and anon key **before**
  deploying, or the site ships in bundled-sample-data mode.
* Never put `SUPABASE_SERVICE_ROLE_KEY`, Paystack or CJ keys in the static
  files; they belong in Supabase secrets only.

### Other hosts

Any static host works: publish the same set of files (`*.html`, `assets/`,
`data/`, `admin/`), set `index.html` as the root document, and keep the Supabase
migrations out of the public document root.
