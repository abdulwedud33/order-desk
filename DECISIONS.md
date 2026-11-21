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





