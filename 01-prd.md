# 01. Product Requirements Document

**Product (working title):** Order Desk
**Project:** 2 of 3 (General Projects)
**Status:** Draft v0.1. Planning only; no code until the owner says "start building".
**Related:** `02-technical-requirements.md`, `03-app-flow.md`, `04-ui-ux-design-brief.md`, `DESIGN.md`, `security.md`

---

## 1. Summary

Order Desk is a mobile-first, offline-capable web app (installable PWA) that makes sure **no order is ever lost**. Restaurants, cafés, delivery businesses and repair shops take orders by phone, in person, and in chat apps. Today those orders live on paper, in memory, or inside scrolling message threads. Order Desk gives every order a place on a shared board, a clear status, a timeline, and a payment record, and lets the customer follow it with a simple link.

One product, three business templates:

| Template | Typical business | What an "order" is |
|----------|------------------|--------------------|
| Food | Restaurant, café, takeaway | Items from a menu: dine-in, takeaway or delivery |
| Delivery | Courier, grocery or pharmacy delivery | A pickup and a drop-off with an address, a fee and a courier |
| Repair | Phone, electronics, tailoring, shoe repair | A job: an item, a problem, an estimate, a deposit, a pickup |

## 2. Problem

- Orders arrive from many places (phone calls, walk-ins, Telegram, WhatsApp, Instagram) and are written wherever is handy. Some are forgotten, duplicated or mixed up.
- Staff do not know what is new, what is being worked on, and what is late. Owners find out when the customer calls angry.
- Customers keep asking "Is it ready?", and staff stop work to answer.
- Repair jobs get lost between "dropped off" and "ready"; estimates are not approved in writing; deposits and balances are forgotten.
- Delivery: the courier does not have the address, the phone number or the amount to collect in one place.

## 3. Users

| Role | Who | Needs |
|------|-----|-------|
| Owner | Runs the business | Sees everything: orders, money, late jobs, staff, reports. Sets up menu or services |
| Staff | Cashier, waiter, front-desk, technician | Takes orders fast, updates status, records payments |
| Kitchen | Cook or workshop | Sees what to make or fix, in order. Taps one button to move it forward. Does not see customer phone numbers or addresses |
| Courier | Delivery rider | Sees only the deliveries assigned to them: address, phone, amount to collect |
| Customer (no account) | The person ordering | Follows their order with a link; sees status and expected time only |

## 4. Goals and non-goals

**Goals (v1)**
1. Every order is captured in under 15 seconds, even offline, and is never lost.
2. Everyone sees the same board within a few seconds when online.
3. Every status change and payment is recorded in a timeline nobody can silently edit.
4. Late orders are impossible to miss.
5. Customers can follow their order without calling.
6. Works well in English, Amharic and Afaan Oromo, with prices in Ethiopian birr (ETB).

**Non-goals (v1)**
- Online payment gateway integration (payments are recorded by staff).
- Customer-facing ordering app or website (customers get a tracking link only).
- Live courier GPS tracking, route optimisation.
- Table reservations and appointment booking (that is project 3).
- Inventory deduction from recipes (project 1 handles stock for shops).
- Multi-branch management, payroll, accounting.

## 5. Success metrics (to validate in the pilot)

| Metric | Target |
|--------|--------|
| Orders lost or without a trail | 0 |
| Time to record a simple order | Median under 15 s; phone-in with address under 30 s |
| Board freshness (online) | New order visible on other devices in under 3 s (p95) |
| Orders completed on or before promised time | Baseline in pilot, then +15% |
| Customer "is it ready?" calls | Down by half after tracking links |
| Activation | 60% of new shops record their first order within 15 minutes of signup |
| Week-4 retention | 40% of pilot shops still using it daily |

## 6. Decisions to confirm (assumptions)

| # | Decision | My default | Why |
|---|----------|------------|-----|
| 1 | Platform | Installable web app (PWA), statically hosted | Same stack as project 1; no app-store friction; works on cheap Android phones |
| 2 | Backend | Supabase (Postgres with row level security, Auth, Realtime, Edge Functions) | RLS is required; Realtime gives live boards |
| 3 | First template to polish | Food, then Repair, then Delivery extras | Food has the highest order volume and the clearest pilot |
| 4 | Currency and languages | ETB; English, Amharic, Afaan Oromo | Same as project 1 |
| 5 | Roles | Owner, Staff, Kitchen, Courier | Matches how these businesses split work; each has a different data need |
| 6 | Notifications | In-app sound and vibration plus live board in v1; web push in v1.1 | Push on some phones is unreliable; do not depend on it for v1 |
| 7 | Customer messages | App drafts the message; a person sends it from their own phone or chat app | No messaging provider to integrate or pay for; no accidental spam |
| 8 | Chat-app intake (Telegram, WhatsApp) | Paste a message into Quick Entry and the assistant drafts the order. A bot is v1.1 | Fast to build, safe, useful immediately |
| 9 | Order numbers | Server assigns a short number per day (for example A-023). Offline orders show a temporary reference until they sync | Avoids duplicate numbers across devices |
| 10 | Photos on repair jobs | v1.1 | Needs storage rules and size limits |

## 7. Scope

| Module | v1 | v1.1 | Later |
|--------|----|------|-------|
| Accounts, shop, roles, invites | Yes | | |
| Menu or service catalog | Yes | CSV import | |
| Quick order entry (3 types plus repair intake) | Yes | | |
| Order board with statuses | Yes | Kitchen ticket print | |
| Payments and deposits | Yes | | Gateway integration |
| Customers and history | Yes | | Loyalty |
| Delivery assignment and courier view | Yes | | Live tracking |
| Customer tracking link | Yes | Web push | |
| Daily summary and reports | Yes | | |
| Assistant: order intake from pasted text, status message drafts, insights | Yes | Telegram bot | |
| Photos on repair jobs | | Yes | |
| Multi-branch | | | Yes |

## 8. Functional requirements

IDs are stable; acceptance criteria are testable.

### Accounts and shop
- **FR-A1** Sign up and in with email and password. *AC:* session persists; wrong credentials show a friendly message.
- **FR-A2** Create a shop in onboarding with a business type (Food, Delivery, Repair) that loads smart defaults (statuses wording, sample menu or services, order types).
- **FR-A3** Invite staff, kitchen and courier by single-use code (48 h expiry). Owner chooses the role.
- **FR-A4** Language switch (English, Amharic, Afaan Oromo) per person.
- **FR-A5** Owner can delete the shop and all its data.

### Catalog
- **FR-C1** Create items or services with name, price and category; mark unavailable (86'd) with one tap. *AC:* unavailable items cannot be added to new orders but stay on old ones.
- **FR-C2** Quick add in 3 fields (name, price, category).
- **FR-C3** Free-text lines are allowed on an order (repair parts, special requests).
- **FR-C4** Sample catalog by business type, editable.

### Orders
- **FR-O1** Create an order in one screen: type, items, customer (name or phone), channel, note, promised time. *AC:* a repeat customer is found by phone in two taps; default promised time is suggested from preparation times.
- **FR-O2** Order types: dine-in (table label), takeaway, delivery (address, fee), repair (see FR-R).
- **FR-O3** Works offline. *AC:* the order is saved on the device, shows a "Saved on this phone" mark, and syncs when online without creating duplicates.
- **FR-O4** Every order gets a short number per day assigned by the server; until then a temporary reference is shown.
- **FR-O5** Edit an order until it is ready (add or remove items, change notes). *AC:* each edit is recorded in the timeline with who and when.
- **FR-O6** Cancel with a reason (owner or staff). *AC:* cancelled orders stay visible in history.
- **FR-O7** Duplicate warning: same phone, same items, within 10 minutes.
- **FR-O8** Search orders by number, name, phone or item.

### Board and statuses
- **FR-B1** Board shows orders grouped by status, newest and most urgent first. *AC:* works as swipeable columns on phones and side-by-side columns on tablets.
- **FR-B2** Each order card has one primary action: the next status. *AC:* tapping it changes status instantly on screen (optimistic) and is confirmed by the server.
- **FR-B3** Statuses: New, Accepted, In progress, Waiting, Ready, Out for delivery, Completed, Cancelled. Wording adapts to the template (for example In progress = Preparing or Being repaired).
- **FR-B4** Only valid transitions are allowed, and only for the right roles (kitchen: accept, in progress, ready; courier: out for delivery, completed for their own deliveries).
- **FR-B5** Two people changing the same order at once never corrupt it. *AC:* the second change is rejected with a clear message and the card refreshes.
- **FR-B6** Orders past their promised time are flagged Late with the number of minutes.
- **FR-B7** New order alert: sound and vibration on kitchen and staff devices (can be muted).
- **FR-B8** Order timeline shows every event (created, edited, status, payment, assignment, note).

### Payments
- **FR-P1** Record payments and deposits (cash, mobile money, bank); balance is computed. *AC:* cannot record more than the balance; refunds are separate entries by the owner.
- **FR-P2** Payment status shown on the card: Unpaid, Part paid, Paid.
- **FR-P3** Delivery: courier sees "collect X birr" and can record cash collected.

### Repair template
- **FR-R1** Intake: item (for example phone model), problem, optional serial, estimate, deposit, contact. Pickup code generated.
- **FR-R2** Statuses with Waiting used for "awaiting approval" and "awaiting parts".
- **FR-R3** Estimate approval is recorded with who approved and when (customer approval is recorded by staff).
- **FR-R4** Handover needs the pickup code or an owner override (recorded).
- **FR-R5** Repair turnaround report (average days per stage).

### Delivery
- **FR-D1** Assign an order to a courier. *AC:* courier sees it instantly in their list.
- **FR-D2** Courier view: address, call button, map link, amount to collect, one big status button.
- **FR-D3** Delivery fee on the order; courier cash collected is recorded.

### Customer tracking
- **FR-T1** Each order has a tracking link with an unguessable token. *AC:* page shows shop name, order number, status, promised time, and nothing personal (no phone, no address, no prices of other orders).
- **FR-T2** Link can be shared from the order card with one tap (share sheet).
- **FR-T3** Page works on slow networks and in all three languages.

### Reports
- **FR-X1** Today view: orders by status, late orders, sales, cash in, unpaid balances.
- **FR-X2** Period reports (week, month): orders count, sales, top items or services, busiest hours, average completion time.
- **FR-X3** Export orders as CSV (formula-safe).

### Assistant (optional per shop)
- **FR-I1** Quick Entry: paste or type a message ("2 shiro and 1 tibs, deliver to Bole, call 09...") and get a draft order to confirm. Never saves automatically.
- **FR-I2** Status message drafts for customers ("ready", "delayed 20 minutes") in the customer's language. Copy or share; never sent by the app.
- **FR-I3** Daily insights for the owner: busiest times, late-order causes, repeat items.

## 9. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Performance | App shell loads in under 2.5 s on a mid-range phone on 3G; board interactions respond in under 100 ms; JS per route under budget in `02` |
| Reliability | Orders are saved locally before any network call; the sync queue survives app restarts; retries are idempotent |
| Offline | Create orders, change statuses, record payments offline; board shows the last known state |
| Security | See `security.md`. RLS on every table, role-based access (kitchen cannot see contact details; couriers see only their deliveries), no secrets in the client, validated input, rate limits on all APIs |
| Privacy | Customer phones and addresses are stored in a separate protected table; tracking pages expose no personal data |
| Accessibility | WCAG 2.2 AA; 48 px touch targets; works with large text; status is never conveyed by color alone |
| Localization | English, Amharic, Afaan Oromo; ETB; layouts tolerate 30% longer text |
| Observability | Error reporting without personal data; invariants checked nightly |

## 10. UX principles (summary; details in `04`)

- Standing rules: skeleton loaders instead of spinners across the app; instant feedback on every tap; no moving buttons in onboarding; no backend errors shown to users.
- UX laws: Jakob, Hick, Proximity, Miller, Von Restorff.
- Psychology used honestly: smart defaults, goal gradient, reciprocity, endowment, loss aversion.
- Simplicity, consistency, visual hierarchy.

## 11. Risks and open questions

| Risk | Mitigation |
|------|-----------|
| Kitchen staff will not use a phone app during a rush | Kitchen mode: one screen, huge text, one tap per order, sound; test in the pilot kitchen |
| Two devices change the same order | Server-side status machine with expected-status check and conflict message |
| Offline order numbers collide | Numbers assigned by the server; temporary local reference |
| Customers have no data connection to open tracking links | Tracking page is tiny and static; staff can also read status aloud from the card |
| Phone numbers and addresses are sensitive | Separate table, role-based RLS, redaction before AI calls |
| AI misreads a pasted order | Draft only; ambiguous items become questions; evals per language |

Open questions:
1. Is the first pilot a café or restaurant, a repair shop, or a delivery business?
2. Do they take orders mostly by phone, Telegram, or walk-in?
3. Does the kitchen have a tablet or only staff phones?
4. Is any printer available for kitchen tickets?
5. Which mobile-money providers do customers use (for the payment method labels)?

## 12. Release criteria (v1)

- All FR marked v1 pass their acceptance criteria.
- RLS matrix tests pass for all five actors (anonymous, outsider, owner, staff, kitchen, courier) on every table.
- No order can be created, changed or paid without a timeline event (invariant job green).
- Offline create, status change and payment replay tested, including two-device conflicts.
- Lighthouse mobile performance 90 or higher, accessibility 95 or higher.
- Pilot of 3 to 5 businesses with no lost orders for 2 weeks.
