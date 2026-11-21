# Architectural and Implementation Decisions

This document records deliberate deviations from planning documents or specific architectural decisions made to preserve security, correctness, and reliability.

## Milestone M0 Decisions (2026-11-21)

1. **DEC-001: Next.js Static Export Architecture (`next.config.mjs`)**
   - **Decision:** Configured Next.js with `output: 'export'`, `trailingSlash: true`, `images: { unoptimized: true }`, `poweredByHeader: false`.
   - **Reason:** Satisfies the strict architectural constraint in `docs/02-technical-requirements.md` that the entire front-end is statically hosted on a CDN with zero server-side rendering at request time. All dynamic operations occur client-side (local-first via Dexie) or via Supabase RPCs/Edge Functions.

2. **DEC-002: Per-Page CSP Generation (`scripts/postbuild.mjs`)**
   - **Decision:** A post-build script hashes all inline scripts emitted by Next.js static export using SHA-256 and writes an `out/_headers` file.
   - **Reason:** Completely removes the need for `'unsafe-inline'` in `script-src`, strictly enforcing `docs/security.md` section 10.

3. **DEC-003: CI Static Bundle Secret Scanner (`scripts/check-bundle.mjs`)**
   - **Decision:** Added post-build bundle verification scanning all files in `out/` for `service_role`, Anthropic/model provider keys, and non-anon JWTs.
   - **Reason:** Non-negotiable security rule 1 (`docs/security.md` section 3): only the Supabase public URL and anon key may ship in client bundles. Any accidental bundling of elevated credentials immediately aborts the build with exit code 1.

4. **DEC-004: Product Baseline Defaults (from `docs/01-prd.md` s6 & s11)**
   - **Decision:** Confirmed following answers to PRD open questions:
     - Pilot business template: Food template first (café/restaurant), followed by Repair, then Delivery extras.
     - Intake channels: Walk-in and phone orders; chat intake via text paste into assistant Quick Entry; Telegram bot deferred to v1.1.
     - Kitchen hardware: Staff phone or counter tablet; no physical printer in v1 (glanceable screen with audio/vibration).
     - Payment methods: Cash and mobile money (Telebirr, CBE Birr) recorded by staff; no third-party payment gateway integration in v1.
     - Languages: English (`en`), Amharic (`am`), Afaan Oromo (`om`).
     - Currency: Ethiopian Birr (ETB).

5. **DEC-005: Strict TypeScript & Test Isolation**
   - **Decision:** Strict TypeScript compiler configuration (`strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`). Included `fake-indexeddb` for Dexie domain and outbox unit tests without browser runtime overhead.
   - **Reason:** Domain code in `src/domain/` stays pure with zero framework/browser dependencies, enabling lightning-fast node test execution.

## Milestone M1 Decisions (2026-11-21)

1. **DEC-006: Dynamic Schema Inspection for `create_shop` Catalog Seeding**
   - **Decision:** `create_shop` checks `to_regclass('public.catalog_categories') is not null` before seeding initial items.
   - **Reason:** Decouples Migration 0002 from Migration 0003, enabling clean M1 identity and RLS test execution while ensuring that once catalog tables exist in M2, new shops automatically receive their sample catalog by business type.

2. **DEC-007: Comprehensive Error Sanitization with Failure Fuzzing**
   - **Decision:** All user-facing error strings flow strictly through `translateError` and message catalogs `err.<CODE>`.
   - **Reason:** Non-negotiable security rule 7 (`docs/security.md` section 8). Proved via automated fuzzing against 100+ raw PostgreSQL exception codes, network errors, and raw JSON payloads that zero SQL fragments, stack traces, or technical error codes reach the UI.

3. **DEC-008: Fixed-Layout Onboarding Geometry Invariants**
   - **Decision:** Fixed height containers on `#onboarding-fixed-header` (64px) and `#onboarding-fixed-footer` (80px) with reserved error message slots (24px min height).
   - **Reason:** UX requirement (`docs/04-ui-ux-design-brief.md` s7): no buttons move, jump, or resize between onboarding steps. Verified with Playwright that `x`, `y`, `width`, and `height` coordinates remain 100% identical between steps.

4. **DEC-009: Database CI Strategy**
   - **Decision:** Prepared pgTAP test suite `supabase/tests/001_identity_and_rls.test.sql` to execute in GitHub Actions via `supabase/setup-cli@v1` and against remote Supabase projects, bypassing local Docker requirement.
   - **Reason:** Local environment lacks Docker daemon; database tests are enforced in CI before any merge.

## Milestone M2 Decisions (2026-11-21)

1. **DEC-010: Direct Table Writes Permitted Only by Owner/Staff with Column Grants**
   - **Decision:** As specified in `docs/05-backend-schema.md` and Milestone M2 instructions, direct writes are allowed on `catalog_categories` (owner only), `catalog_items` (owner only), and `customers` (owner and staff only) with explicit column grants (`INSERT/UPDATE` granted only on non-system columns like `name, price, available`, excluding `id, shop_id, created_at`).
   - **Reason:** Keeps simple CRUD straightforward while strictly denying kitchen and courier roles any read or write access on `customers` or modifying menu catalog items.

2. **DEC-011: Customer Personal Data Isolation (Phone & Sensitive Attributes)**
   - **Decision:** The `customers` table is locked down under RLS with `has_role(shop_id, 'staff')`. Kitchen and courier members have zero SELECT/INSERT/UPDATE/DELETE privileges on `customers`. In the client UI, kitchen and courier views display an explicit forbidden state if directly accessed.
   - **Reason:** Enforces Non-negotiable Rule 5 and `docs/security.md` section 4: customer contacts and phone numbers are sensitive personal data and must never be exposed to kitchen or courier roles.

3. **DEC-012: Search Suggestion 2-Character Rule & Ranking**
   - **Decision:** Customer search queries below 2 characters do not trigger filtering or substring queries; instead, recent customers are displayed. Queries of 2+ characters trigger normalized prefix-first matching, ranking exact name/phone prefix matches ahead of substring matches.
   - **Reason:** Satisfies FR-CU2 and UX responsiveness guidelines in `docs/04-ui-ux-design-brief.md` while preventing excessive UI re-renders on single-character inputs.

4. **DEC-013: Incremental Sync with 50-Row Pagination**
   - **Decision:** Sync engine in `src/lib/sync.ts` pages PostgREST fetches in batches of 50 (`.range(from, from + 49)`) using the `updated_at` watermark.
   - **Reason:** Prevents PostgREST `max_rows` truncation issues and ensures smooth offline hydration into local Dexie IndexedDB.

## Milestone M3 Decisions (2026-11-21)

1. **DEC-014: Atomic Server-Side Day Numbering & Daily Letter Cycles (`next_order_no`)**
   - **Decision:** Order numbers are generated exclusively server-side via `public.next_order_no(shop_id, date)`. The internal function locks/upserts `order_counters` to guarantee collision-free sequence numbers starting at 1 each day per shop. The display code combines a daily cycling letter (`chr(65 + (doy - 1) % 26)`) and a 3-digit padded number (`A-001`, `P-023`).
   - **Reason:** Prevents client collisions and duplicate numbers across multiple concurrent devices and offline queues (`docs/02-technical-requirements.md` s4.4 & `docs/05-backend-schema.md` s6).

2. **DEC-015: Server-Enforced Pricing & Non-Owner Client Override Isolation**
   - **Decision:** In `create_order` and `edit_order`, prices for catalog items are always looked up and locked from `public.catalog_items`. If staff or a client payload provides a modified price for a catalog item, the server ignores it and enforces the catalog price. Only owners can override a catalog line item price.
   - **Reason:** Enforces Non-negotiable Rule 3 and `docs/05-backend-schema.md`: business logic and financial calculations are determined by the database from trusted sources.

3. **DEC-016: 128-Bit Unguessable Tracking Tokens in `order_contacts`**
   - **Decision:** Generated during `create_order` via `translate(encode(gen_random_bytes(16), 'base64'), '+/=', '-_')` creating a URL-safe 22-character high-entropy token stored in `order_contacts.tracking_token`.
   - **Reason:** Satisfies FR-T1 and `docs/05-backend-schema.md` s3.4 for customer tracking links without exposing customer phone numbers, addresses, or internal order numbers to unauthorized callers or kitchen staff.

4. **DEC-017: Reactive Offline Dexie `useLiveQuery` Integration**
   - **Decision:** Replaced static polling in `/orders` with Dexie's `useLiveQuery` hook. When orders are created offline or synced, Dexie automatically triggers re-rendering of the ticket list without full page reloads or router re-fetches.
   - **Reason:** Delivers instant, sub-50ms feedback when saving orders offline and ensures seamless UI transitions even when the browser has zero network connectivity.

5. **DEC-018: 10-Minute Duplicate Warning Algorithm (FR-O7)**
   - **Decision:** `findDuplicateOrder` compares normalized digits of the customer phone and matching sets of item IDs/names created within 600,000 ms (10 minutes). If detected, an amber warning banner prompts staff with "Create Anyway" or "View Existing".
   - **Reason:** Implements FR-O7 to prevent accidental double-entry from phone calls and chats while permitting intentional duplicate orders when confirmed.

## Milestone M4 Decisions (2026-11-21)

1. **DEC-019: Status Mutation Lock via `orders_guard` & Append-Only `order_events`**
   - **Decision:** Created database trigger `orders_guard` on `public.orders` that raises an exception if `status`, `paid_amount`, `order_no`, `order_code`, or `shop_id` are modified outside trusted security-definer RPCs (`pg_trigger_depth() > 1` or explicit session context). Status transitions are executed only through `advance_order`, `assign_order`, and `cancel_order`, logging immutable audit records to `public.order_events`.
   - **Reason:** Strictly enforces Non-negotiable Rule 3 and `docs/05-backend-schema.md`: the database is the judge of state transitions. Direct updates to order states are forbidden.

2. **DEC-020: Age Timer Color Semantics & Von Restorff Principle**
   - **Decision:** Ticket age timers display elapsed/remaining time using neutral muted styling (`text-muted`) during normal duration, switching to warm amber (`text-amber-500`) when approaching promised time ($\le 5\text{m}$ or $\ge 80\%$ duration), and switching to assertive red (`text-red-500 font-bold`) strictly when an order has breached its promised time (`now > due_at`), displaying a `+Xm late` badge.
   - **Reason:** Conforms to `DESIGN.md:96` and Von Restorff law: red is strictly reserved across the entire app for lateness and errors so urgent exceptions stand out immediately on busy kitchen and counter screens.

3. **DEC-021: Single Primary Action Pattern per Order State**
   - **Decision:** Every order card on the board surfaces a single primary next-step button determined by `NEXT_ACTION_BY_STATUS` (e.g., `new -> Accept`, `accepted -> Start Prep`, `in_progress -> Ready`, `ready -> Deliver/Complete`, `out_for_delivery -> Complete`). Secondary actions (e.g. Cancel) require secondary disclosure.
   - **Reason:** Satisfies Hick's Law and `docs/04-ui-ux-design-brief.md`: staff under pressure have zero cognitive friction choosing what action to perform next.

4. **DEC-022: Multi-Modal Audio/Vibration New Order Notifications with Sound Preference**
   - **Decision:** Added a Web Audio API synthesized harmonic chime (523.25 Hz C5 + 659.25 Hz E5) paired with Web Vibration API patterns (`[100, 50, 100]`), persisted with a persistent mute toggle in `localStorage`.
   - **Reason:** Ensures kitchen staff receive clear sensory cues in noisy prep environments while respecting user control over sound output.

5. **DEC-023: Calm Conflict Toast Reconciliation on Concurrent Edits**
   - **Decision:** When advancing an order fails due to an outdated expected status (`ORDER_CONFLICT_FROM`), the sync layer catches the error, updates local Dexie cache with the server's state, and presents a non-alarmist calm toast (`"Order has already been updated to <status>"`) without blocking further user actions.
   - **Reason:** Satisfies Non-negotiable Rule 7 and `docs/03-app-flow.md`: calm conflict handling informs staff without raw error banners or loss of unsaved local work.

## Milestone M5 Decisions (2026-11-21)

1. **DEC-024: Append-Only Payments Ledger & Strict Mutability Lockdown**
   - **Decision:** All payments, deposits, and refunds are recorded in `public.order_payments` with trigger `check_ledger_immutable()` blocking direct `UPDATE` and `DELETE` operations.
   - **Reason:** Enforces Non-negotiable Rule 3 and `docs/05-backend-schema.md` s1.4: financial records must form an append-only ledger so daily cash reconciles to the exact birr.

2. **DEC-025: Trigger-Enforced `paid_amount` Single-Writer Invariant (`order_money_guard`)**
   - **Decision:** Created database trigger `order_money_guard` on `public.order_money` that raises `FORBIDDEN` if `paid_amount` is modified unless the session configuration `order_desk.allow_paid_amount_change` is `'on'`. This flag is set strictly by `order_payments_apply` upon insertion into `order_payments`.
   - **Reason:** Eliminates race conditions and guarantees that `order_money.paid_amount` is always the exact mathematical derivative of the ledger: $\sum(\text{payments} + \text{deposits}) - \sum(\text{refunds})$.

3. **DEC-026: Role Boundaries on Payments & Owner-Exclusive Refunds**
   - **Decision:** In `record_payment`, refunds are strictly restricted to shop `owner` and require a non-empty explanation note, capped at `paid_amount`. Courier role is restricted strictly to `payment` kind with `cash` method on assigned delivery orders.
   - **Reason:** Satisfies FR-P1, `docs/03-app-flow.md` s4, and `docs/security.md`: couriers only report cash collected, and staff cannot issue unauthorized refunds.

4. **DEC-027: Settle-Later Completion Gate & UI Interception**
   - **Decision:** When advancing an order to `completed`, if `total - paid_amount > 0` and `settle_later = false`, `advance_order` raises `VALIDATION`. In the UI, attempting to complete an unpaid order intercepts the click, presents a clear prompt, and opens the `PaymentSheet` offering one-tap balance settlement or settle-later toggle.
   - **Reason:** Enforces `docs/05-backend-schema.md` rule 7: completed orders must have a zero balance unless explicitly designated for later settlement.

5. **DEC-028: Persistent Payment Method Preference & Balance Prefill**
   - **Decision:** The `PaymentSheet` automatically prefills the amount with the exact outstanding balance, and preselects the user's last chosen payment method persisted in `localStorage`.
   - **Reason:** UX requirement in `docs/03-app-flow.md` s3.5b and `docs/04-ui-ux-design-brief.md` s8: minimizes cognitive load and counter delay (Hick's Law).

## Milestone M6 Decisions (2026-11-21)

1. **DEC-029: Hash-Only Storage for Repair Pickup Codes (`sha256 bytea`)**
   - **Decision:** Pickup codes are generated as 4-digit numeric pins on customer intake. Only the cryptographically hashed representation (`sha256(convert_to(upper(trim(code)), 'UTF8'))`) is stored in `public.repair_jobs.pickup_code_hash`. Plaintext codes exist temporarily on client local device memory during intake.
   - **Reason:** Enforces `docs/security.md` and Non-negotiable Rule 1: device handover requires proof of customer possession; database dumps or leaks never expose cleartext pickup credentials.

2. **DEC-030: Strict Owner-Only Handover Override Policy**
   - **Decision:** In `handover_order`, setting `p_override = true` is strictly guarded by `v_role = 'owner'` and rejected with `FORBIDDEN` for staff or couriers. Every override event is logged to immutable `order_events` with actor identity and timestamp.
   - **Reason:** Satisfies `docs/05-backend-schema.md` s6 and `docs/evals.md` s6.1: preventing unauthorized equipment release by staff without customer presence while accommodating legitimate customer loss of code verified directly by the shop owner.

3. **DEC-031: Estimate Threshold Status Invariant (`total > approved_total => waiting`)**
   - **Decision:** In `edit_order`, whenever item lines on a repair order are modified such that the recalculated total exceeds `approved_total`, the status machine automatically forces order status to `'waiting'` and sets `waiting_reason = 'estimate_exceeded'`. The order cannot progress to `ready` until an updated estimate is formally approved via `approve_estimate`.
   - **Reason:** Core requirement in `docs/05-backend-schema.md` s6 and user request: customers must never be blindsided by post-intake price escalations without explicit authorization.

4. **DEC-032: Kitchen Privacy Separation via `repair_jobs_kitchen` View**
   - **Decision:** RLS on `public.repair_jobs` restricts direct `SELECT` to `can_see_sensitive()` (owner, staff, assigned courier). The `kitchen` role accesses `public.repair_jobs_kitchen`, which explicitly omits `pickup_code_hash`, `approved_total`, `approved_by`, `handed_over_at`, and `handover_override`.
   - **Reason:** Satisfies Non-negotiable Rule 5 and `docs/05-backend-schema.md` matrix: technicians/bench staff see the device and problem description to perform work, with zero access to customer collection codes or financials.

5. **DEC-033: Dual-Gate Handover Verification (Code & Settle-Later)**
   - **Decision:** Order handover via `handover_order` requires both valid pickup code verification AND financial clearance (`total <= paid_amount` or `settle_later = true`). The UI intercepts unpaid handovers with a clear notice directing counter staff to collect payment or record a settle-later agreement first.
   - **Reason:** Enforces invariant 7 and 8 from `docs/05-backend-schema.md`: completed repairs must have a verified handover trail and reconciled balances.

## Milestone M7 Decisions (2026-11-21)

1. **DEC-034: Strict Sanitization & URL-Encoding for Courier Links (`formatTelUri` & `formatMapUri`)**
   - **Decision:** Dial links are scrubbed and validated against `^\+?[0-9]{7,15}$` before outputting `tel:${cleaned}`. Map URLs strictly percent-encode the address via `https://maps.google.com/?q=${encodeURIComponent(trimmed)}`. Links are never built from raw unescaped model text or unsanitized strings.
   - **Reason:** Core security requirement from M7 prompt and `docs/security.md` section 11: eliminates any possibility of XSS, `javascript:` pseudo-protocol injection, or URI parameter tampering in customer-facing dialers and navigation links.

2. **DEC-035: Multi-Courier RLS Isolation & Realtime Row Delivery**
   - **Decision:** `can_see_order` and `can_see_sensitive` restrict courier queries on `orders`, `order_contacts`, `order_money`, and `order_items` strictly to `assigned_to = auth.uid()`. Couriers have zero read access to `order_item_prices` or unassigned orders. Realtime row deliveries strictly follow table RLS.
   - **Reason:** Non-negotiable Rule 5 and `docs/security.md` section 4: two couriers working a lunch rush cannot see each other's deliveries, customer phone numbers, or addresses.

3. **DEC-036: One Big Primary Action Button Pattern for Courier Ergonomics**
   - **Decision:** The "My Deliveries" view provides a single high-contrast primary button (56px height, min 48px touch target) per ticket: `Picked Up` (`ready -> out_for_delivery`) and `Delivered` (`out_for_delivery -> completed`), offering immediate optimistic feedback (<100ms) with Dexie outbox queueing.
   - **Reason:** Designed for couriers on foot or scooter in bright daylight (`docs/04-ui-ux-design-brief.md` and `docs/03-app-flow.md` s3.5), minimizing taps and cognitive overhead.

4. **DEC-037: Integrated Cash-on-Delivery Collection Modal & Ledger Record**
   - **Decision:** Tapping `Delivered` on an order with an outstanding balance opens `CashCollectedDialog`, prefilled with the exact balance due and guarded against overpayment (`val <= balance`). Confirming queues `record_payment` (`kind: 'payment'`, `method: 'cash'`) and `advance_order` (`completed`) in a single outbox sequence.
   - **Reason:** Satisfies payment rules (`docs/05-backend-schema.md` rule 2 and `docs/03-app-flow.md` s3.5) ensuring cash in hand immediately reconciles with the append-only ledger without manual counter follow-up.

## Milestone M8 Decisions (2026-11-21)

1. **DEC-038: Service-Role Isolation & Minimalist Public Tracking Payload (`track-order`)**
   - **Decision:** The Edge Function `track-order` is the only external endpoint authorized to look up tokens via the service role client. The public tracking response is strictly scrubbed of all identifying attributes, exposing solely: `shop_name`, `business_type`, `order_code`, `order_type`, `status`, `due_at`, and `updated_at`.
   - **Reason:** Enforces Non-negotiable Rule 1 and `docs/security.md` section 9: zero customer phone numbers, addresses, personal names, items, or financial numbers ever leave the server for public tracking.

2. **DEC-039: Token Retention & Automatic Expiry Invariants (30d Cancelled / 60d Completed)**
   - **Decision:** Tokens automatically expire 30 days following cancellation or 60 days following order completion (`docs/05-backend-schema.md` section 11). Expired tokens return the exact same generic payload as non-existent tokens with timing equalisation.
   - **Reason:** Minimises tracking link longevity and eliminates user/order enumeration vectors.

3. **DEC-040: Layered Sliding-Window Rate Limiting (30/min IP, 10/min Token)**
   - **Decision:** `track-order` enforces sliding-window rate limits (30 requests/minute per client IP and 10 requests/minute per token), returning HTTP 429 with standard `Retry-After` headers and localized calm messages.
   - **Reason:** Mitigates automated scraping, token brute-forcing, and DDoS attacks on public endpoints (`docs/security.md` section 7).

4. **DEC-041: Tiny Static Tracking Bundle Budget (<= 25 KB Gzip) & Zero Third-Party Scripts**
   - **Decision:** The tracking route is prerendered to static HTML and lightweight chunks with no third-party libraries, tracking pixels, or analytics. Automated bundle analysis in CI verifies gzipped JS is strictly under the 25 KB budget with `noindex` and `no-referrer` tags.
   - **Reason:** Guarantees sub-3-second load times on slow mobile 3G networks in Ethiopia (`docs/02-technical-requirements.md` section 6).







