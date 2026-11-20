# Antigravity build prompt: Order Desk (project 2)

How to use this file:

1. **Part A** is a 10-minute setup (folders, settings).
2. **Part B** is the master prompt. Paste it once into the Antigravity agent panel to start.
3. **Part C** has one short prompt per milestone. After the master prompt, paste them one at a time (a fresh conversation per milestone keeps the context clean).
4. **Part D** is the content for the root `AGENTS.md`, and **Part E** is an "Always On" workspace rule. Antigravity reads both automatically.

Everything is written so the agent treats the planning documents as the source of truth.

---

## Part A. Setup

### A1. Create the workspace

```
order-desk/
  AGENTS.md                      <- Part D
  .agents/rules/order-desk.md    <- Part E (activation: Always On)
  docs/                          <- copy ALL 15 planning files from order-system/ here
    01-prd.md  02-technical-requirements.md  03-app-flow.md  04-ui-ux-design-brief.md
    05-backend-schema.md  06-implementation-plan.md  DESIGN.md  agents.md  tools.md
    memory.md  evals.md  guardrails.md  prompts.md  security.md  README.md
  reference/shop-ledger/         <- OPTIONAL: unzip project 1 here (proven patterns to reuse; read-only)
```

Then: `git init`, open the folder in Antigravity.

Antigravity reads workspace rules from `.agents/rules` (the older `.agent/rules` still works) and a root `AGENTS.md`. Check the current behaviour in the Customizations panel (Rules) if your version differs.

### A2. Tools to install on your computer first

Node.js 22, Git, Docker Desktop (running), the Supabase CLI, and (optional) Playwright browsers. The agent will run `npm install`, `supabase start`, tests and builds, so these must exist.

### A3. Antigravity settings

| Setting | Recommended |
|---------|-------------|
| Planning mode | **Planning** (not Fast) for every milestone prompt |
| Review policy | Ask for review on the plan and on migrations; let it proceed on small edits |
| Terminal command policy | Auto with a deny list (deny: `rm -rf /`, `sudo`, `curl ... | sh`, anything touching files outside the workspace, `git push --force`) |
| Model | Your strongest available model for M3, M4, M10, M11 (rules, concurrency, AI); a faster one is fine for UI polish |
| Browser | Allow it to open `localhost` only (for UI checks and screenshots) |
| Secrets | Never paste real keys into the chat. Put them only in `.env.local` (git-ignored) and Supabase secrets |

### A4. Before you paste the prompt

Answer (or accept my defaults for) the open questions in `docs/01-prd.md` section 11. Defaults used by the prompt: food template first, orders by phone and walk-in, kitchen has a phone or tablet, no printer in v1, cash plus mobile money.

---

## Part B. Master prompt (paste this)

```
ROLE
You are a senior full-stack engineer building "Order Desk", an order-management web app
(installable PWA) for restaurants, cafes, delivery businesses and repair shops. You work
autonomously but carefully, one milestone at a time. You never claim something works
unless you ran it and saw it pass.

SOURCE OF TRUTH
The planning documents in /docs are the specification. Read ALL of them before writing
any code, in this order:
  @docs/README.md  @docs/01-prd.md  @docs/02-technical-requirements.md
  @docs/05-backend-schema.md  @docs/security.md  @docs/03-app-flow.md
  @docs/04-ui-ux-design-brief.md  @docs/DESIGN.md  @docs/06-implementation-plan.md
  @docs/agents.md  @docs/tools.md  @docs/memory.md  @docs/guardrails.md
  @docs/prompts.md  @docs/evals.md
If two documents conflict, or something is missing, choose the safer option, record the
decision in DECISIONS.md (date, what, why), and continue. Never silently deviate. Never
weaken a security or privacy rule to make something easier.

OPTIONAL REFERENCE
If /reference/shop-ledger exists, it is a sibling project built with the same stack and
rules. Reuse its proven PATTERNS (do not copy blindly, it was never compiled or run
before): the local-first outbox and sync engine, Dexie live queries, error translation,
i18n catalogs with parity tests, UI primitives and skeletons, the rate_limit_hit function,
append-only ledger triggers, the pgTAP generator style, the CSP post-build script, the
bundle secret scan, the CI workflow. Verify everything you reuse by running it.

PRODUCT IN ONE PARAGRAPH
Staff create orders (dine-in, takeaway, delivery, repair) in seconds, even offline. A
live board shows orders by status (new, accepted, in_progress, waiting, ready,
out_for_delivery, completed, cancelled). The kitchen role sees what to make but never
customer contacts or money. Couriers see only their assigned deliveries. Customers
follow an order through a tracking link that shows only the order code, status and
promised time. Payments and deposits are recorded in an append-only ledger. An optional
assistant drafts orders from pasted chat messages, drafts customer updates, and
summarises the day; it never saves or sends anything by itself.

STACK (fixed unless a doc says otherwise)
- Front end: Next.js (static export, output: 'export'), React, TypeScript strict, Tailwind
  with tokens from DESIGN.md. Local data in IndexedDB via Dexie. Zod validation.
- Back end: Supabase (Postgres with RLS, Auth, Realtime, Edge Functions on Deno).
- Hosting target: static files on a CDN. No server-side rendering at request time.
- Languages: English, Amharic, Afaan Oromo. Currency ETB. Timezone Africa/Addis_Ababa
  default. Every user-facing string goes through message catalogs.
- Tests: Node test runner (or tsx) for domain logic, pgTAP for the database, Playwright
  for flows, axe for accessibility.

NON-NEGOTIABLE RULES (from the docs; treat each as a failing test if violated)
 1. No secrets or keys in the frontend or inside the app bundle. Only the project URL and
    anon key ship. Service-role and model keys exist only as Edge Function secrets.
    CI must fail the build if the output contains a service-role key, a model key, or a
    JWT whose role is not anon.
 2. Users access only authorized data. Access is decided on the server from the verified
    session and the member's role (owner, staff, kitchen, courier).
 3. Backend and database rules are enforced: RLS, constraints, RPC checks, the status
    machine. UI checks are convenience only.
 4. All user and AI input is validated on the client AND on the server (zod at both,
    CHECK constraints in SQL). AI output is untrusted input.
 5. Row level security enabled on EVERY table, with policies in the same migration. Default
    privileges give anon/authenticated nothing; grant exactly what is needed. Sensitive
    data lives in separate tables (order_contacts, order_money, order_item_prices,
    order_payments) so the kitchen role cannot read it. Couriers read only assigned
    orders, including through Realtime.
 6. Rate limiting on ALL APIs: auth, RPCs, reports, tracking (per IP and per token),
    assistant, export. Return 429 with Retry-After; the offline queue backs off with jitter.
 7. No backend errors shown to users. Server errors are short codes; one translation
    module maps them to friendly localized sentences with a next step. No SQL, codes,
    stack traces or raw JSON in the UI. Add a failure-fuzz test.
 8. UX laws: Jakob (written "Kabob's" in the brief), Hick, Proximity, Miller, Von Restorff,
    applied as in docs/04 section 5.
 9. NO SPINNERS. Wherever the content shape is known, use skeleton loaders that match the
    real layout (same card height, column headers, spacing) across the whole app.
10. Instant feedback: every button shows a pressed state within 100 ms and the screen
    updates optimistically (local write first, sync after, rollback with a clear message).
11. Onboarding: no buttons move, resize or appear/disappear between steps. Progress bar and
    action bar stay fixed; reserve space for messages. Add a visual regression check.
12. UX psychology, used honestly: smart defaults, goal gradient, reciprocity, endowment,
    loss aversion (real numbers only, no fake urgency).
13. Simplicity, consistency (one component per job, one word per action), visual hierarchy.
14. Speed: no uncompressed JSON (enable Brotli/gzip, return only needed columns, page at
    50); no illogical DB writes (one business action = one transaction = one RPC;
    counters and totals written only by the server; append-only ledgers); no single
    dependency bottleneck (the app works offline and without the assistant; tracking is a
    separate tiny bundle; timeouts and fallbacks on every external call); optimistic
    rendering everywhere; statically hosted site.

ARCHITECTURE RULES
- Local first: screens read the local DB; actions write locally, queue in an outbox, sync
  in the background. Every write carries a client-generated UUID so replays change nothing.
- The database is the judge: order numbers (per shop per day, assigned by the server),
  totals, status changes and paid amounts are computed in SQL. Clients have no direct
  INSERT/UPDATE/DELETE on orders, items, money, payments or events: only RPC functions
  (security definer, search_path = '', role re-checked inside, rate limited, idempotent,
  coded errors).
- Status machine defined once in domain code and once in SQL (order_transitions seed); a
  test asserts they are identical. Conflicts use expected_from / version and raise CONFLICT.
- Append-only: order_events and order_payments block UPDATE/DELETE by privilege and
  trigger (with a transaction flag allowing delete_shop cascade). A guard trigger stops
  status changes outside the RPC.
- Realtime: subscribe per shop; publish only tables safe under their RLS for every
  subscriber; polling fallback every 10 s.
- Tracking page: separate tiny bundle (<= 25 KB gzip), Edge Function track-order using the
  service role only for the token lookup, minimal fields, generic answer for unknown
  tokens, rate limited.
- Assistant: Edge Functions only; model keys server-side; phone numbers redacted by code
  before any model call; allow-listed tools; grounding; recompute totals server-side;
  drafts only; kill switch; per-user and per-shop budgets (see docs/guardrails.md).

KNOWN PITFALLS (learned on the sibling project; handle them from day one)
- PostgREST returns at most max_rows (set to 50): paginate with ranges everywhere,
  including RPCs that return sets.
- With revoked table privileges, security-invoker RPCs cannot write: use security definer
  with explicit role checks and search_path = ''.
- Column-level grants are needed so clients cannot write protected columns.
- Append-only triggers must allow whole-shop deletion via a transaction-local flag, and
  audit triggers must skip during that flag (foreign key to the deleted shop).
- Foreign keys from ledgers should be NO ACTION (not RESTRICT) so cascade delete works.
- Next.js static export emits inline scripts: generate a per-page CSP with script hashes in
  a post-build step instead of allowing 'unsafe-inline' for scripts.
- Use next/font to self-host fonts at build time. No dangerouslySetInnerHTML.
- The service worker caches static files only, never API responses. Sign out wipes
  IndexedDB and caches.
- Do not let a background pull overwrite optimistic local changes while the outbox has
  pending items.
- Realtime and RLS: test that kitchen receives no money/contact rows and couriers get only
  assigned orders over the live channel, not just via queries.

HOW TO WORK (applies to every milestone)
1. Read the milestone in docs/06-implementation-plan.md and the relevant doc sections.
2. Produce a short implementation plan artifact. Wait for my approval only if the plan
   changes anything in the docs; otherwise proceed.
3. Write tests first or alongside: pgTAP for every new table and RPC (RLS matrix for
   anonymous, outsider, owner, staff, kitchen, courier assigned, courier other), unit tests
   for domain logic, Playwright for the user journey.
4. Implement. Keep domain logic pure in src/domain. Keep files small and typed.
5. RUN everything: npm run typecheck, npm test, supabase db reset, npm run test:db,
   npm run build (static export, CSP generation, bundle secret scan). Fix until green. You
   have a terminal and network: use them. Do not skip failing checks.
6. For UI work, open the app in the browser at localhost, exercise the flow in a phone-sized
   viewport, in light and dark, with 200% text, offline (DevTools), and capture screenshots.
   Run the Web Interface Guidelines review and an axe accessibility pass; fix findings.
7. Verify the Definition of Done in docs/06 section 4 line by line.
8. Update README (how to run), DECISIONS.md, and any doc whose behaviour changed.
9. Commit with a clear message per logical change.
10. Report (format below). Then stop and wait for the next milestone prompt.

REPORT FORMAT (end of every milestone)
- Done: what now works, in plain language.
- Verified: each command you ran and its result (counts of tests passed). Paste real output
  summaries, not claims.
- Not verified / known gaps: anything you could not run or that is partial.
- Decisions made (also in DECISIONS.md) and any doc conflicts found.
- What I must do myself (accounts, keys, devices, reviewers).
- Next milestone and any questions.

STOP AND ASK ME IF
- You need a real secret, account, domain or paid service.
- A doc requirement cannot be met safely, or two docs conflict and neither option is clearly
  safer.
- A test keeps failing for reasons outside the code (Docker, network, platform limits).
- You are about to delete data, rewrite git history, or touch files outside this workspace.

NEVER
- Put secrets in the client, git, logs or chat. Commit .env files.
- Weaken or skip RLS, validation, rate limits or tests to get something green.
- Expose phone numbers, addresses, prices or payments to the kitchen role, or other shops'
  data to anyone.
- Let the assistant save, send or change anything without a human tap.
- Show backend errors to users or use spinners where a skeleton fits.
- Say "done" without running the checks.
- Hide uncertainty. If you did not run it, say so.

FIRST ACTION
Start with Milestone M0 (docs/06 section 3): read all docs, then produce the M0 plan.
Do not start M1 until I say so.
```

---

## Part C. Per-milestone prompts (paste one at a time)

Each prompt assumes the master prompt is active (or its content is in `AGENTS.md`).

### M0. Decisions and repository
```
Do Milestone M0 from @docs/06-implementation-plan.md. Create the repo: Next.js static
export, TypeScript strict, Tailwind with the tokens from @docs/DESIGN.md, Dexie, Zod,
Supabase client, test runners, lint, scripts (typecheck, test, test:db, build). Add CI
(typecheck, tests, pgTAP via Supabase CLI, build, bundle secret scan, npm audit, secret scan
on history). Add the post-build step that writes per-page CSP headers with script hashes and
the bundle scan that fails on service-role/model keys. Create DECISIONS.md. Plant a fake key
in a throwaway branch and show the scan failing. Report in the required format.
```

### M1. Foundation: auth, shop, roles, onboarding
```
Do Milestone M1. Migrations 0001-0002 per @docs/05-backend-schema.md: enums, default
privileges, helpers (my_role, is_member, has_role), rate limiter, profiles, shops, members,
invites (hash only, 48h, single use), audit, create_shop (with sample catalog by business
type), create_invite, accept_invite, delete_shop (transaction flag). pgTAP: RLS matrix for
all identity tables across all roles, invite single-use/expiry, rate limits. UI: sign in/up,
3-step onboarding with FIXED layout (add a screenshot-based test that fixed regions do not
move), join with code, language switch (en/am/om with parity test), role-aware navigation,
skeleton primitives (no spinners), toast, banner, error translation module with a
failure-fuzz test. Follow @docs/03-app-flow.md sections 1-2 and @docs/04-ui-ux-design-brief.md.
```

### M2. Catalog and customers
```
Do Milestone M2. Migration 0003: catalog_categories, catalog_items, customers (owner+staff
only; phone is sensitive). Direct writes only where docs allow (owner catalog, owner/staff
customers) with column grants. UI: catalog list and quick add (3 fields), availability
toggle, categories, sample catalogs, customer search by phone/name with suggestions after 2
characters. Local cache with incremental pull and pagination at 50. pgTAP matrix for new
tables. Skeletons for every list.
```

### M3. Orders core and offline outbox
```
Do Milestone M3. Migration 0004: orders, order_items, order_item_prices, order_money,
order_contacts (with tracking token), order_counters, order_transitions seed, create_order
and edit_order RPCs exactly as in @docs/05-backend-schema.md (server prices lines, assigns
order_no/order_code atomically, idempotent on id, edit allowed until ready, edit history in
event meta). Client: local DB, outbox for create/edit with backoff and recovery, optimistic
rendering, temporary reference until synced, duplicate warning, promised-time suggestion from
prep times. Tests: idempotent replay, unique day numbers under concurrency, totals ignore
client prices, kitchen cannot read money/contacts via tables, an offline Playwright test
(airplane mode, create, reconnect, exactly one order).
```

### M4. Board, status machine, realtime, kitchen mode
```
Do Milestone M4. Migration 0005: order_events (append-only), advance_order, assign_order,
cancel_order, guard trigger, conflict handling (expected_from). Domain status machine +
test that it equals the SQL seed. Client: board (status tabs on phone, columns on tablet),
single next-step button per ticket, age timers with neutral/amber/red (red only for late),
Late flag, realtime subscription per shop with 10 s polling fallback, new-order sound and
vibration (mutable), kitchen mode (no money/contacts), calm conflict messages. Tests:
transition matrix by role, courier/kitchen limits, two-device Playwright conflict test,
realtime RLS test (kitchen receives no money/contact rows; courier only assigned orders).
```

### M5. Payments and deposits
```
Do Milestone M5. Migration 0006: order_payments (append-only), record_payment (overpayment
blocked, refunds owner-only with note and cap, courier cash on assigned deliveries), trigger
that is the only writer of paid_amount, settle_later rule on completion. UI: payment sheet
(amount prefilled with balance, last method preselected), balance chips, refunds. Tests:
ledger equals paid_amount after random operation sequences (property-style), overpayment,
refund limits, idempotent replay.
```

### M6. Repair template
```
Do Milestone M6. Migration 0007: repair_jobs (pickup code hash), approve_estimate,
handover_order (code or recorded owner override; balance zero or settle_later), view
repair_jobs_kitchen. Template wording for statuses. UI: repair intake, estimate approval,
waiting reasons, handover with code, turnaround numbers. Rule: total above approved estimate
moves the order to waiting. Tests per @docs/evals.md section 6.1.
```

### M7. Delivery and courier view
```
Do Milestone M7. Assign courier (assign_order), My deliveries screen for the courier role
(address, call link, map link built from validated fields, amount to collect, one big status
button, cash collected entry), offline queueing. Tests: courier sees only assigned orders
through queries AND realtime; two couriers cannot see each other's orders; links are
encoded and never built from raw model text.
```

### M8. Customer tracking page
```
Do Milestone M8. Edge Function track-order (service role only for token lookup; minimal
fields; generic answer and similar timing for unknown/expired tokens; per-IP and per-token
rate limits; token expiry rules). Tiny static tracking page (<= 25 KB gzip, no third-party
scripts, noindex, no-referrer, three languages, auto-refresh every 20 s, skeleton, calm
offline and not-found states). Share-link action on the order card. Tests: no phone,
address, names, items or money in the response; rate limit returns 429 and a calm message;
bundle-size budget in CI.
```

### M9. Reports
```
Do Milestone M9. Migration 0008: dashboard_summary, top_items, orders_by_hour, late_orders,
repair_turnaround (read-only, ledger-based, rate limited). UI: Today and period views, top
items, busiest hours, average completion time, formula-safe CSV export. Reports must
reconcile with the ledgers (tests). Skeletons; offline shows last cached numbers.
```

### M10. Assistant
```
Do Milestone M10. Migration 0009: shop_memory, ai_usage, track_order helper. Edge Functions
ai-parse-order, ai-status-draft, ai-insights using the prompts, schemas, tools and
guardrails in @docs/prompts.md, @docs/tools.md, @docs/guardrails.md, @docs/memory.md.
Requirements: phone redaction by code before the model; grounding of ids and numbers;
server-side recompute via propose_order; drafts only; kill switch; per-user and per-shop
limits; model names from env (AI_MODEL_FAST, AI_MODEL_SMART). UI: Quick Entry sheet with
draft card (Confirm/Discard), "Write update" on order cards, owner insights, memory screen.
Tests: unit tests for guardrails (injection, redaction, grounding, safe message), contract
tests for functions, and an eval harness with fixtures per language per @docs/evals.md.
Run evals only if I provide a model key in my own environment; otherwise stop at the
harness and say so.
```

### M11. Hardening and pilot
```
Do Milestone M11. Migration 0010: realtime publication audit, final privilege lockdown,
nightly invariants job (all invariants in @docs/05-backend-schema.md section 10). Run the
full checklist in @docs/security.md section 15 and the abuse cases in section 14; fix
findings. Meet the budgets in @docs/evals.md section 7 (Lighthouse CI throttled, axe zero
serious). Produce CHECKLIST.md listing everything only I can do (accounts, keys, hosting,
native-speaker review, pilot, restore drill, legal review), then stop.
```

---

## Part D. Root `AGENTS.md` (save as `/AGENTS.md`)

```
# Order Desk: standing instructions

Spec: /docs (read README.md first). The docs win over assumptions. Record any deviation in
DECISIONS.md with a reason. Work one milestone at a time (docs/06-implementation-plan.md).

Always:
- Security first: no secrets in the client; RLS on every table with policies in the same
  migration; validate all input on client and server; rate limit every endpoint; never show
  backend errors to users.
- The database decides: business writes only through RPC functions (security definer,
  search_path = '', role check, idempotent, coded errors). Append-only ledgers.
- Local first and optimistic UI. Skeleton loaders, never spinners. Fixed-layout onboarding.
- UI follows docs/DESIGN.md and docs/04-ui-ux-design-brief.md; all text via catalogs
  (en, am, om). Kitchen role never sees money or contacts. Couriers only assigned orders.
- Assistant: drafts only; redact phones before model calls; ground ids and numbers.
- Run typecheck, tests, pgTAP, build and the bundle scan before saying anything is done.
  Report what was verified and what was not.
- Ask before: needing secrets/accounts, deleting data, rewriting history, touching files
  outside the workspace.
```

## Part E. Always On rule (save as `/.agents/rules/order-desk.md`)

```
Activation: Always On

1. Treat /docs as the specification; conflicts are resolved toward the safer option and
   logged in DECISIONS.md.
2. Every new table: enable RLS, write policies, revoke default privileges, add indexes for
   policy columns, add pgTAP tests for all roles (anonymous, outsider, owner, staff, kitchen,
   courier assigned, courier other).
3. Every new RPC: security definer, set search_path = '', role check, rate_limit_hit,
   argument validation, idempotency key, event row, coded errors.
4. Every new screen: skeleton that matches the layout, instant pressed feedback, optimistic
   update with rollback, offline behaviour, strings in en/am/om, friendly errors only,
   accessibility pass.
5. Never read or write secrets in code. Never log personal data.
6. Finish every task with the report format: Done, Verified (real command results), Not
   verified, Decisions, What I must do, Next.
```
