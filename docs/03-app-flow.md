# 03. App Flow

**Product:** Order Desk (working title). **Status:** Draft v0.1.
**Reads with:** `01-prd.md` (requirements), `04-ui-ux-design-brief.md` (look and behaviour), `02-technical-requirements.md` (status machine).

---

## 1. Screen map

```
Public
  /track/<token>           Customer tracking page (no login, tiny bundle)
  /auth                    Sign in / create account
  /join                    Join a shop with an invite code

Signed in, no shop
  /onboarding              Business type -> shop name -> catalog -> first order (3 fixed steps)

Signed in, with shop (bottom navigation changes by role)
  /                        Board (orders by status)        [owner, staff, kitchen]
  /new                     New order                       [owner, staff]
  /order?id=               Order detail and timeline       [owner, staff, kitchen*, courier*]
  /deliveries              My deliveries                   [courier]
  /customers               Customers and history           [owner, staff]
  /catalog                 Menu or services                [owner; staff read]
  /reports                 Today and period reports        [owner]
  /more                    Team, settings, assistant memory, sync status, language, sign out
```
\* kitchen sees items and notes but no contact details or money; courier sees only orders assigned to them.

Bottom navigation by role:

| Role | Items (max 5, Miller) |
|------|----------------------|
| Owner | Board, New (center), Customers, Reports, More |
| Staff | Board, New (center), Customers, Catalog, More |
| Kitchen | Board (kitchen mode), More |
| Courier | My deliveries, More |

## 2. Onboarding (fixed layout: nothing moves between steps)

Progress bar and the Back/Next bar stay in the same place on every step; the content area scrolls. Space is reserved for validation messages so nothing jumps.

| Step | Content | Smart defaults |
|------|---------|----------------|
| 1. Your business | Business type (Food, Delivery, Repair), shop name, language | Language from the phone; type preselected from the most common answer |
| 2. Your menu or services | Pre-filled sample list for the chosen type, editable; add up to 8 | Sample names and prices; categories created automatically |
| 3. Ready | Summary and "Create my first order" | Goes straight to New order with the first item preselected |

Goal gradient: the progress bar fills to 100% on step 3, and the first order is the next screen, not a settings page. Team invites are offered after the first order (not in the way).

If offline during step 3: the app explains plainly that the first setup needs a connection, keeps the entries on the phone, and retries.

## 3. Core flows

### 3.1 New order (food, dine-in or takeaway) - target under 15 seconds

1. Tap center **New**. Sheet or screen opens with the type preselected (last used).
2. Tap items from the grid (frequent items first). Totals update instantly.
3. Optional: table label or customer name/phone (phone lookup suggests regulars).
4. Promised time is prefilled from preparation times; one tap to change (+10, +20, +30 min).
5. Tap **Create order**. The order appears on the board at once, marked "Saved on this phone" until confirmed.

Error and edge states: unavailable item hidden from the grid; duplicate warning if the same phone and items exist within 10 minutes (Create anyway / Open existing).

### 3.2 New order (delivery or phone-in) - target under 30 seconds

Same as 3.1 plus: delivery type shows address (free text), phone (required), delivery fee (default from settings), channel (Phone, Telegram, WhatsApp, Instagram, Other). **Quick Entry** (sparkle button): paste the chat message; the assistant fills a draft that the person checks and confirms.

### 3.3 Repair intake

1. New -> Repair. Fields: customer name and phone (required), item (for example phone model), problem, optional serial, estimate (optional), deposit (optional).
2. Create. A short pickup code is shown and can be shared with the customer.
3. Status path: Received (accepted) -> In progress (diagnosing or repairing) -> Waiting (awaiting approval or parts) -> Ready -> Completed (collected).
4. Estimate approval: staff taps **Customer approved** (records time and who). The price shown becomes the agreed price.
5. Handover: staff enters the pickup code or uses owner override; balance must be settled or marked settle-later.

### 3.4 Kitchen mode (board for the kitchen role)

- One list, oldest first, big cards: order number, items with quantities, notes, promised time countdown.
- Primary button is the single next step (Accept, Start, Ready). One tap per order.
- New order: sound and vibration; card slides in at the top (can be muted).
- Late orders show a red band with the minutes late (the only red on the screen).
- No phone numbers, addresses or prices are shown.

### 3.5 Delivery

1. Staff taps **Assign** on a ready or accepted delivery order and picks a courier.
2. Courier sees it in **My deliveries** (new item alert), with: address, call button, map link, items summary, amount to collect.
3. Courier taps **Picked up** (Out for delivery), then **Delivered**. If cash was collected, they enter the amount (defaults to the amount due).
4. Offline: courier actions queue and sync later.

### 3.5b Payments and deposits

Order detail -> **Record payment**: amount (prefilled with the balance), method (last used preselected). Overpayment is blocked with a clear message. Refunds are owner-only and need a reason.

### 3.6 Cancel and edit

- **Edit** until Ready: add or remove items, change notes or time. The timeline shows each edit.
- **Cancel**: choose a reason (Customer changed mind, Out of stock, Mistake, Other). Cancelled orders stay in history.

### 3.7 Customer tracking page

- Opens from a shared link. Shows shop name, order number, a status stepper (for example Received - Preparing - Ready), promised time, last update time.
- Auto-refreshes every 20 seconds while open; works on slow networks; three languages (language from the phone, switcher on the page).
- Shows nothing personal. If the link is unknown or expired: a calm "We couldn't find this order" message.

### 3.8 Assistant (optional)

- **Quick Entry:** paste or type; draft order card with items, quantities, type, channel; ambiguous items ask "Which one?" with options. Phone numbers are recognised in code, not by the model.
- **Status message draft:** on an order card, **Write update** gives a short message in the customer's language (ready, delayed, need approval). Copy or share; the app never sends it.
- **Daily insights (owner):** busiest hours, late orders and why they were late, repeat items.

## 4. Permissions by role

| Action | Owner | Staff | Kitchen | Courier |
|--------|:-----:|:-----:|:-------:|:-------:|
| Create or edit order | Yes | Yes | No | No |
| See customer phone and address | Yes | Yes | No | Own deliveries |
| See prices and totals | Yes | Yes | No | Amount to collect only |
| Accept, start, ready | Yes | Yes | Yes | No |
| Out for delivery, delivered | Yes | Yes | No | Own deliveries |
| Cancel | Yes | Yes | No | No |
| Record payment | Yes | Yes | No | Cash collected on own deliveries |
| Refund | Yes | No | No | No |
| Manage catalog | Yes | Read | No | No |
| Reports and export | Yes | No | No | No |
| Team and settings | Yes | No | No | No |
| Assistant: quick entry | Yes | Yes | No | No |
| Assistant: insights and drafts | Yes | Drafts only | No | No |

The UI hides what a role cannot do; the database enforces it regardless.

## 5. Loading, empty, offline and error states

Every screen defines all four. **No spinners:** when the layout is known, a skeleton with the same shapes and spacing is shown.

| Screen | Loading skeleton | Empty state | Offline | Error |
|--------|------------------|-------------|---------|-------|
| Board | Column headers plus 4 card skeletons per column with real card height | "No open orders. New orders appear here." + New order | Banner "Offline. Changes are saved on this phone." Board shows last known state | "Couldn't refresh. Showing the last saved board." + Try again |
| New order | Item grid skeleton (same tile size) | Catalog empty: "Add your first item" | Works fully | Field-level messages; submit failure keeps the draft |
| Order detail | Header, items and timeline skeleton | Timeline always has "Created" | Works; shows pending marks | Friendly message with Back |
| Customers | Row skeletons | "No customers yet" | Works from local cache | Friendly message |
| Reports | Stat cards skeleton | "No orders in this period" | "Reports need a connection" with last cached numbers | Friendly message |
| Tracking | Stepper skeleton | n/a | "You're offline. Showing the last update." | Calm not-found message |

Feedback rules: every button responds in under 100 ms (pressed state, then optimistic change); long actions show progress text inside the button's area without changing its size; toasts name the action ("Order sent to kitchen") and offer Undo where possible; conflict messages are plain ("This order was just updated by someone else. Showing the latest.").

## 6. State diagram (order status, simplified)

```
 new -> accepted -> in_progress -> ready -> completed
   \        \          |  ^          |
    \        \         v  |          +-> out_for_delivery -> completed
     \        \--> waiting-+
      \--> cancelled (any open status, with reason)
```

## 7. Notifications and alerts (v1)

- New order or assignment: sound and vibration while the app is open, badge on the Board tab.
- Late order: card turns red; owner banner "2 orders are late".
- Web push when the app is closed: v1.1.

## 8. Language and formats

All text through message catalogs (English, Amharic, Afaan Oromo). Money in ETB. Time and dates in the shop timezone. Status words differ by template.
