# 02. Technical Requirements Document

**Product:** Order Desk (working title). **Status:** Draft v0.1.
**Reads with:** `01-prd.md`, `05-backend-schema.md`, `security.md`, `06-implementation-plan.md`.

---

## 1. Architecture at a glance

```
Phone / tablet (installable PWA, static files)
  React UI  <->  Local database (IndexedDB)  <->  Sync engine (outbox + pull + realtime)
                                                      |
                              HTTPS, compressed JSON  |
                                                      v
        Supabase: Auth | Postgres + RLS + RPC | Realtime | Edge Functions
                                                      |
                                      Edge Functions: assistant (model API), public tracking
Static hosting + CDN (HTML, JS, CSS, fonts, icons)  <-- only thing served to browsers
```

- **Static front end.** The site is exported to plain files and served from a CDN. No server renders pages at request time.
- **Local first.** The screen reads from the local database. Actions are written locally first, queued, and sent in the background.
- **The server is the judge.** Order numbers, totals, status changes and payment balances are decided in the database, not in the browser.
- **Realtime for freshness.** Devices subscribe to their shop's changes; the same data rules (RLS) apply to the live stream.

## 2. Technology choices

| Layer | Choice | Reason |
|-------|--------|--------|
| UI | React with Next.js static export, TypeScript (strict) | Team already knows it; static output satisfies the hosting rule |
| Styling | Tailwind CSS with design tokens from `DESIGN.md` | Consistency; small CSS |
| Local data | IndexedDB through Dexie | Offline orders, outbox, cached board |
| Server data | Supabase Postgres (RLS), Auth, Realtime, Edge Functions | RLS, live updates, no server to run |
| Validation | Zod, shared by client and Edge Functions; SQL constraints as the last line | One source of truth for shapes |
| Assistant | Model API called only from Edge Functions | Keys never reach the browser |
| Hosting | Static host with CDN (for example Cloudflare Pages) and a generated per-page CSP | Meets "statically hosted" |
| Tests | Node test runner and tsx for domain logic; pgTAP for the database; Playwright for flows | Fast feedback |

Dependency policy: few, audited, pinned. Every new runtime dependency needs a reason and a bundle-size check.

## 3. Client structure

```
src/
  app/            routes (static): board, new-order, order detail, customers, catalog, reports, team, settings, sync
  components/     UI primitives, order card, status stepper, skeletons
  domain/         pure logic (no network): money, order totals, status machine, late calculation, outbox, search, dates, csv, i18n helpers
  lib/            api (RPC wrappers), db (Dexie), sync, realtime, session, error translation
  i18n/           en, am, om catalogs
  tracking/       tiny standalone page for customers (separate small bundle)
supabase/
  migrations/     SQL, one file per milestone
  functions/      assistant, track-order
  tests/          pgTAP
```

Rules: `domain/` has no imports from `lib/` or React, so it is unit tested without a browser. Screens never talk to the network directly; they read the local database and call action functions.

## 4. Data flow

### 4.1 Creating an order (offline safe)

1. The form builds an order draft with a **client-generated UUID**.
2. One local transaction writes the order, its items, contact details and an outbox item. The board shows it immediately with a "Saved on this phone" mark and a temporary reference.
3. The sync engine sends `create_order(...)` as one RPC. The server checks the role, validates everything, recomputes totals, assigns the day number, writes the order, items, contact, timeline event.
4. A replay with the same UUID returns the stored order unchanged (idempotent).
5. The server's answer replaces the temporary reference with the real number.

### 4.2 Changing status

1. The button updates the local card at once (optimistic).
2. An outbox item `advance_order(order, to_status, expected_from, client_id)` is queued.
3. The server checks: valid transition for this order type, allowed for this role, current status equals `expected_from`.
4. If it matches, it updates the order and appends a timeline event in one transaction. If not, it returns `CONFLICT` with the current status; the device refreshes that card and shows "This order was just updated by someone else."
5. Realtime pushes the change to other devices.

### 4.3 Pulling and realtime

- First load and reconnect: incremental pull by `updated_at` cursor (orders from the last 3 days plus all open orders; older history on demand).
- Realtime subscription per shop on `orders` and `order_events`. Events patch the local database; the UI updates through live queries.
- While local changes are waiting to be sent, pulls do not overwrite those orders (the outbox wins until confirmed).
- Fallback: if the realtime connection drops, poll every 10 seconds while the board is open.

### 4.4 Order numbers

- The server assigns `order_no` per shop per local day with a counter row locked in the same transaction (`next_order_no`). The display number is a day letter plus three digits, for example `A-023` (letter changes daily or weekly; configurable).
- Offline orders show `#` plus the last 4 characters of the UUID until synced.

### 4.5 Public tracking

- The customer link contains a random 128-bit token. Only its hash is stored.
- The page calls the `track-order` Edge Function with the token. The function returns only: shop name, order number, status, promised time, last update time. No phone, no address, no money.
- Rate limited per IP and per token; unknown tokens return a generic answer after the same delay.

## 5. Status machine (single source of truth)

Defined once in `domain/status.ts` and mirrored in SQL (`order_transitions` table); tests assert both agree.

| From | To (allowed) | Who |
|------|--------------|-----|
| new | accepted, cancelled | owner, staff, kitchen (accept only) |
| accepted | in_progress, waiting, cancelled | owner, staff, kitchen (in_progress) |
| in_progress | ready, waiting | owner, staff, kitchen |
| waiting | in_progress, cancelled | owner, staff |
| ready | out_for_delivery (delivery type), completed | owner, staff; courier for out_for_delivery |
| out_for_delivery | completed | owner, staff, assigned courier |
| any open status | cancelled (reason required) | owner, staff |
| completed, cancelled | none | final |

Extra rules: repair orders cannot move to `completed` without the pickup code or an owner override (recorded); delivery orders need a courier before `out_for_delivery`; `completed` requires the balance to be zero or an explicit "settle later" flag set by owner/staff.

## 6. Performance and speed rules

These are requirements, enforced by CI budgets and review.

| Rule | How it is met |
|------|---------------|
| No uncompressed JSON | The CDN and API gateway use Brotli or gzip; responses are compact (only needed columns); list calls are paged at 50 rows |
| No illogical DB writes | One business action = one transaction = one RPC. No client loops of dependent writes. Counters and totals are updated only by the server. Append-only ledgers for events and payments |
| No single dependency bottleneck | The app shell and cached data work without the network; the assistant is optional and its failure never blocks ordering; tracking is a separate tiny bundle; timeouts and fallbacks on every external call |
| No un-optimistic rendering | Every tap updates the screen first and reconciles after; failures roll back with a clear message |
| No non-statically hosted site | Static export on a CDN; no server-side rendering at request time |

Budgets (measured in CI on a throttled mobile profile):

| Metric | Budget |
|--------|--------|
| JS on first load (gzip) | 170 KB for the board route; 25 KB for the tracking page |
| Largest Contentful Paint | under 2.5 s on Fast 3G profile |
| Interaction to Next Paint | under 200 ms |
| Board render with 200 open orders | under 100 ms per update |
| Local database read for the board | under 50 ms |

Other speed measures: lazy-load reports and settings; virtualise lists past 100 rows; fonts self-hosted and subset with `font-display: swap`; images avoided in v1 (icons are inline SVG).

## 7. Security requirements (summary; full rules in `security.md`)

1. **No secrets or keys in the frontend or inside the app.** Only the public project URL and public (anon) key ship. Model API keys and the service-role key live in server secrets.
2. **Users access only authorized data.** Access is decided on the server from the verified session and the user's role in the shop.
3. **Backend and database rules are enforced.** UI checks are convenience. RLS, constraints, status machine and RPC checks are the real rules.
4. **All user and AI input is validated** on the client and again on the server, then constrained in the database.
5. **Row level security on every table, with policies written in the same migration.** Contact details live in `order_contacts` so kitchen staff cannot read them.
6. **Rate limiting on all APIs** (auth, RPCs, tracking, assistant), at the CDN, in functions, and in the database.
7. **No backend errors shown to users.** Coded errors are translated to plain sentences with a next step.

## 8. Error handling

- Server errors are short codes: `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `INVALID_TRANSITION`, `OVERPAYMENT`, `RATE_LIMITED`, `SESSION_EXPIRED`, `OFFLINE`, `AI_UNAVAILABLE`, `UNKNOWN`.
- One translation module maps each code to a localized sentence plus a suggested action. Unknown errors show "Something went wrong. Your work is saved on this phone. Try again."
- Details go to logs with a request id. No SQL, table names, stack traces or raw JSON ever appear in the UI.
- Sync failures that cannot succeed (for example `INVALID_TRANSITION`) move the item to a "Needs attention" list with Retry and Discard.

## 9. Offline and sync

- The outbox is a local table: id (the client UUID), kind, payload, status, attempts, next attempt time.
- Retries use exponential backoff with jitter; stuck "syncing" items recover after a timeout; success removes the item after a short grace period.
- Kinds: `create_order`, `edit_order`, `advance_order`, `record_payment`, `assign_order`, `cancel_order`, `create_customer`, `catalog_item`.
- Sign out wipes the local database and caches. The service worker caches only static files, never API responses.

## 10. Localization

- English, Amharic (Ge'ez script), Afaan Oromo (Latin). Message catalogs per language, lazy loaded.
- ETB with two decimals. Dates and times use `Intl` with the shop timezone.
- Status wording is per template and per language (for example "Preparing" and "Being repaired" use different catalog keys).
- Search normalises text and works across scripts.
- Native speakers review all money and status words before launch.

## 11. Testing strategy

| Layer | Tool | What |
|-------|------|------|
| Domain | Node test runner | Status machine, totals, late calculation, outbox, search, CSV, i18n completeness |
| Database | pgTAP | RLS matrix for every table and role (anonymous, outsider, owner, staff, kitchen, courier), transitions, idempotency, conflicts, invariants |
| Edge Functions | Node tests plus contract tests | Validation, grounding, redaction, tracking data minimisation, rate limits |
| UI flows | Playwright | Create order offline, sync, two-device conflict, kitchen flow, courier flow, tracking page |
| Accessibility | axe in CI, manual screen reader pass | Every screen |
| Performance | Lighthouse CI with throttling | Budgets above |
| AI | Eval suite (`evals.md`) | Intake accuracy, safety, grounding, redaction |

## 12. Environments and delivery

- Environments: local (Supabase CLI), staging, production. Migrations are applied by CI only.
- CI on every pull request: typecheck, unit tests, pgTAP, build, bundle secret scan, dependency audit, secret scan on history.
- Feature flags (server-side): assistant on or off, tracking links on or off, new sign-ups on or off, read-only mode.
- Backups and point-in-time recovery enabled; a restore drill before launch.

## 13. Observability

- Error reporting with request ids and no personal data.
- Metrics: sync queue age, RPC error rate by code, conflict rate, realtime reconnects, assistant success and cost per shop.
- Nightly invariants: every order has a created event; paid amount equals the sum of payments; no order in a final status has open balance unless flagged; no duplicate day numbers.

## 14. Open technical questions

1. Is Supabase Realtime acceptable for the expected number of concurrent devices per shop (tens, not thousands)? Load test in M4.
2. Do target phones support the audio and vibration alerts reliably when the screen is off? Test on real devices in the pilot.
3. Is a Telegram bot worth the added surface in v1.1, or is paste-in enough?
