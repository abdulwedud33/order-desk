# 06. Implementation Plan

**Product:** Order Desk (working title). **Status:** Draft v0.1. **No code is written until the owner says "start building".**
**Estimate basis:** one developer working part time with AI assistance. Ranges are rough and are re-planned after each milestone.

---

## 1. Approach

- **Milestones in value order.** Each ends with something demonstrable on a real phone.
- **Database first.** Schema, RLS and status machine are written and tested before screens depend on them.
- **Tests with every milestone.** pgTAP for rules, unit tests for domain logic, a Playwright flow for each core journey.
- **Review gates.** At the end of each UI milestone: Web Interface Guidelines review, axe accessibility pass, throttled-network check, offline check.
- **Pilot early.** A real café or workshop uses the app from milestone M4.

## 2. Milestones

| # | Milestone | Weeks | Outcome |
|---|-----------|-------|---------|
| M0 | Decisions and repository | 0.5 | Assumptions confirmed; repo, CI, hosting skeleton |
| M1 | Foundation: auth, shop, roles, onboarding | 1.5 | Sign up, create shop by business type, invite staff, language switch |
| M2 | Catalog and customers | 1 | Menu or services, availability toggle, customer lookup |
| M3 | Orders core and offline outbox | 2 | Create, edit and cancel orders, even offline, with server day numbers |
| M4 | Board, status machine, realtime, kitchen mode | 2 | Live board across devices, conflicts handled, kitchen role works |
| M5 | Payments and deposits | 1 | Record payments and refunds; balances and settle-later |
| M6 | Repair template | 1.5 | Intake, estimate approval, pickup code handover |
| M7 | Delivery and courier view | 1 | Assign, courier list, cash collected |
| M8 | Customer tracking page | 1 | Tracking link and tiny public page |
| M9 | Reports | 1 | Today and period reports, CSV export |
| M10 | Assistant: intake, status drafts, insights | 2 | Quick Entry, message drafts, daily insights, evals passing |
| M11 | Hardening and pilot | 2 | Security review, performance budgets, restore drill, pilot with 3 to 5 shops |

Total: about 17 to 18 weeks part time. A usable food-template v1 without repair, delivery extras and the assistant is reachable after M5 (about 8 weeks).

## 3. Milestone details

### M0. Decisions and repository
- Confirm the decisions in `01-prd.md` section 6 and answer the open questions.
- Repo with strict TypeScript, linting, test runners, CI (typecheck, tests, pgTAP, build, bundle secret scan, dependency audit, history secret scan).
- Static hosting project with generated security headers; Supabase projects (staging, production).
- **Exit:** "hello" page deploys from CI; secret scan job proves it fails on a planted fake key.

### M1. Foundation
- Migrations 0001-0002: enums, privileges, helpers, rate limiter, profiles, shops, members, invites, audit, `create_shop`, `create_invite`, `accept_invite`, `delete_shop`.
- UI: sign in and up, onboarding (3 fixed steps), join with code, language switch, role-aware navigation, skeleton primitives, toast and banner, error translation module.
- **Tests:** RLS matrix for identity tables; invite single-use and expiry; rate limits.
- **Exit:** a new owner reaches the board in under 2 minutes; a staff user joins by code.

### M2. Catalog and customers
- Migration 0003. UI: catalog list and quick add, availability toggle, categories, customer search by phone or name, sample catalogs by business type.
- **Exit:** menu of 30 items entered in under 5 minutes; unavailable items hidden from the order grid.

### M3. Orders core and offline outbox
- Migration 0004: orders, items, prices, money, contacts, counters, transitions seed; `create_order`, `edit_order`.
- Client: local database, outbox (create, edit), optimistic rendering, temporary references, duplicate warning, promised-time suggestion.
- **Tests:** idempotent replay; server day numbers unique under concurrency; totals computed server-side; kitchen cannot read money or contacts.
- **Exit:** orders created with the phone in airplane mode appear on the server after reconnect with no duplicates.

### M4. Board, status machine, realtime, kitchen mode
- Migration 0005: events, `advance_order`, `assign_order`, `cancel_order`, guard trigger.
- Client: board (tabs on phone, columns on tablet), next-step button, conflict handling, age timers and Late, realtime subscription with polling fallback, alert sound and vibration, kitchen mode.
- **Tests:** transition table equals domain code; conflict path; courier and kitchen role limits; two-device Playwright test.
- **Exit (pilot starts):** two phones show the same board within 3 seconds; kitchen can run a shift from one screen.

### M5. Payments and deposits
- Migration 0006. UI: payment sheet, balance chips, refunds (owner), settle-later.
- **Tests:** overpayment blocked; paid amount equals payment ledger; refund rules.
- **Exit:** a day's cash in matches the ledger to the birr.

### M6. Repair template
- Migration 0007. UI: repair intake, status wording, estimate approval, waiting reasons, pickup code and handover, turnaround numbers.
- **Tests:** handover needs code or recorded override; total above approved estimate moves to waiting.
- **Exit:** a repair shop completes 10 real jobs end to end.

### M7. Delivery and courier view
- UI: assign courier, My deliveries, call and map links, amount to collect, cash collected.
- **Tests:** courier sees only assigned orders (RLS), including via realtime.
- **Exit:** two couriers work a lunch rush without seeing each other's orders.

### M8. Customer tracking page
- Edge Function `track-order`, tiny static page, share from the order card, rate limits, token expiry.
- **Tests:** page exposes no phone, address or money; unknown tokens give a generic answer; rate limit returns 429 and the page shows a calm message.
- **Exit:** a customer opens the link on a slow connection and sees status in under 3 seconds; page JS under 25 KB gzip.

### M9. Reports
- Migration 0008. UI: Today and period views, top items or services, busiest hours, average completion time, CSV export (formula-safe).
- **Exit:** report numbers reconcile with ledgers.

### M10. Assistant
- Migration 0009. Edge Functions: `ai-parse-order`, `ai-status-draft`, `ai-insights`; guardrails, redaction of phone numbers before model calls, grounding, rate limits, kill switch, memory screen.
- Evals (`evals.md`): at least 200 intake messages across the three languages plus adversarial cases.
- **Exit:** evals meet thresholds per language; the manual flow is unaffected when the assistant is off.

### M11. Hardening and pilot
- Migration 0010: realtime publication check, lockdown, nightly invariants.
- Full security checklist, dependency audit, penetration-style abuse cases, backup restore drill, performance budgets, accessibility audit, native-speaker review of all strings.
- Pilot with 3 to 5 businesses for 2 weeks; fix what they hit.
- **Exit:** release criteria in `01-prd.md` section 12 met.

## 4. Definition of Done (every milestone)

- Requirements covered and acceptance criteria tested.
- RLS enabled on every new table with policies and tests for every role in the matrix.
- All inputs validated on the client and the server; database constraints in place.
- No secrets in the client; bundle scan green.
- Rate limits on every new endpoint, with tests.
- Skeleton loaders on every new screen (no spinners); every action gives instant feedback (optimistic with rollback); no backend errors visible (error translation covers new codes).
- Onboarding or any fixed-layout screen has no moving buttons (visual regression check).
- The five UX laws and psychology patterns reviewed against `04-ui-ux-design-brief.md`.
- Speed rules respected: compressed responses, one RPC per action, no dependency that blocks ordering, optimistic rendering, static hosting.
- Accessibility pass, offline pass, three-language pass.
- Docs updated if behaviour changed.

## 5. Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Kitchen adoption fails | Pilot from M4; kitchen mode designed with the pilot kitchen; sound alerts; one tap per order |
| Realtime reliability on poor networks | Polling fallback; local-first; clear "last updated" indicator |
| Conflicts frustrate staff | Optimistic UI with calm conflict messages; expected-status checks only where needed |
| Order numbers confuse offline users | Temporary reference clearly marked until synced |
| Scope creep (payments gateway, bot, push) | Explicit non-goals and v1.1 list; each addition needs a written reason |
| Assistant quality in Amharic and Afaan Oromo | Per-language eval thresholds; manual flow always available; native review |
| Sensitive data exposure | Separate tables, role-based RLS, redaction before AI, tracking page minimisation, security tests |

## 6. What the owner provides

- Answers to the open questions (first pilot type, order channels, devices, printer, mobile-money providers).
- A pilot business for each template (or at least food first).
- A native Amharic and Afaan Oromo reviewer for status and money wording.
- Accounts: hosting, Supabase, model API; a domain name if wanted.
- Agreement to run the final `CHECKLIST.md` at the end (what only the owner can do).

## 7. Working agreement

- No code until "start building".
- Work milestone by milestone; after each, a short note of what changed and what was verified (and what could not be).
- Anything not verified by a test or a run is labelled as such.
