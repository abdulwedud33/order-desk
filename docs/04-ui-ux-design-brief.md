# 04. UI/UX Design Brief

**Product:** Order Desk (working title). **Status:** Draft v0.1.
**Companion:** `DESIGN.md` (machine-readable tokens and component rules). Keep both in sync.

---

## 1. Design intent

**Feeling:** calm under pressure. A busy counter or kitchen is loud; the screen should be the quiet, trustworthy part. Glanceable from an arm's length, usable one-handed, readable in bright light and a hot kitchen.

**Memorable element (one only): the order ticket with an age timer.** Each order is a ticket: big order number, items, and a small timer showing minutes since it arrived. The timer is neutral until the promised time is near, then it turns amber, then red when late. Because red appears only on late orders, a glance tells the whole story (Von Restorff).

**What it is not:** a generic dashboard of equal cards, gradient washes, decorative illustrations, or a dark neon "tech" look.

## 2. Design sources and how they are applied

| Source | What it is | How it is applied here |
|--------|------------|------------------------|
| Awesome DESIGN.md (VoltAgent collection, based on Google Stitch's format) | Plain-text design systems that coding agents read | `DESIGN.md` at the repo root with YAML tokens plus prose; agents read it before touching UI |
| impeccable | Design skill with a six-section DESIGN.md (Overview, Colors, Typography, Elevation, Components, Do's and Don'ts) and anti-generic rules | Same six sections; consistent spacing; no decoration without a job |
| Taste Skill | Anti-"AI slop" frontend skill with three dials (variance, motion, density) | Dials set to 3 / 2 / 7 in `DESIGN.md` (density is higher than project 1 because a board shows many orders); restraint and one memorable move |
| Web Interface Guidelines (Vercel) | Review rules for accessibility, forms, focus, animation, performance | Run as a review step at the end of every UI milestone |
| UI UX Pro Max | Searchable design intelligence (styles, palettes, font pairings, UX guidelines by product type) | Used to sanity-check palette contrast, font pairing and mobile and dashboard patterns |
| Also used | WCAG 2.2 AA, platform touch-target guidance, Kanban and ticketing conventions | Sections 5, 9, 10 |

How coding agents use these is in `agents.md` section B. The skills are checks, not a template.

## 3. Design tokens (summary; full list in `DESIGN.md`)

| Token | Light | Role |
|-------|-------|------|
| `ink` | `#161B22` | Text |
| `paper` | `#F4F6F8` | Page background |
| `surface` | `#FFFFFF` | Tickets, sheets, inputs |
| `line` | `#DCE1E6` | Dividers, borders |
| `slate` | `#5A6672` | Secondary text |
| `ember` | `#C2500A` | Primary action (one per screen) |
| `st-new` | `#1D5FD1` | New status |
| `st-progress` | `#8A5600` text, `#E0A030` fill | In progress |
| `st-waiting` | `#6B4BC4` | Waiting |
| `st-ready` | `#0F7B5F` | Ready |
| `late` | `#B3402F` | Late, errors, destructive |

Status colors are always paired with an icon and a word. Dark mode keeps the same hues with lighter values (kitchen screens often run dark).

Type: headings Familjen Grotesk (600), body Public Sans, tabular numerals for numbers and timers; Noto Sans Ethiopic fallback for Amharic. Scale 12, 14, 16, 20, 24, 32. Spacing base 4. Radius 8 (controls), 12 (tickets), 20 (sheets).

## 4. Layout and hierarchy

- **Phone:** one column; the board is a row of status tabs with a count on each (swipe between); bottom navigation; the primary action is the center **New** button.
- **Tablet and kitchen screen:** columns side by side (New, In progress, Ready), each scrolling on its own; larger type.
- **Order ticket (hierarchy, top to bottom):** order number and age timer (largest), items and quantities, note, then one primary button (next step). Secondary actions live behind a "more" button.
- **Order detail:** status stepper, items, customer, payment, timeline.

## 5. The five UX laws (applied where useful)

| Law | Rule in this product |
|-----|----------------------|
| Jakob's Law (written "Kabob's law" in the request) | Use familiar patterns: Kanban columns, ticket cards, a chat-like timeline, the phone's share sheet, `tel:` call links, standard form controls |
| Hick's Law | One primary action per ticket (the next step); other actions hidden behind "more"; New order screen shows the item grid first and everything else collapsed |
| Proximity | Group items with their quantities, customer with contact, payment with totals; larger gaps between groups than within them |
| Miller's Law | At most 5 bottom tabs; at most 5 visible status columns; long order lists chunked by status and by day; item grid groups by category |
| Von Restorff | The only red on the board is lateness; the only filled orange button on a screen is the primary action; new orders get a brief highlight |

(Fitts's Law is also used: frequent actions are large and near the thumb.)

## 6. UX psychology (used honestly)

| Pattern | Where | Guardrail |
|---------|-------|-----------|
| Smart defaults | Last-used order type and payment method; promised time from prep times; delivery fee from settings; sample catalog by business type; today's date | Defaults never hide costs or share data |
| Goal gradient | Onboarding progress bar; a repair job stepper showing how close it is to Ready; a daily "orders completed" progress on the Today view | Progress reflects real state only |
| Reciprocity | Give value first: sample catalog before asking for setup; a free tracking link customers love; daily summary without asking | No gating of basic features behind actions |
| Endowment effect | "Your menu" and "Your customers" are shown as the owner's own assets; customer history and regulars are visible; export is always one tap | Never lock data in; deletion and export are easy |
| Loss aversion | Real numbers about what is at risk: "2 orders are late", "3 jobs waiting for approval for 2 days", "Item X is 86'd and 5 customers asked for it today" | Never exaggerate; no fake urgency or guilt copy |

## 7. Standing UX rules (apply across the whole app)

1. **No spinners.** When the content shape is known, show a skeleton that matches the real layout (same ticket height, same column headers, same row spacing) so nothing shifts when data arrives. A small inline progress hint is allowed only for waits of unknown shape inside a button.
2. **Instant feedback.** Every button shows a pressed state within 100 ms and the screen updates optimistically even if the server takes longer. Failures roll back with a clear message and a way to retry.
3. **Onboarding is stable.** No buttons move, resize or appear and disappear between steps. Progress bar and action bar stay fixed; space for messages is reserved.
4. **No backend errors.** Users never see codes, SQL, stack traces, status numbers or raw JSON. Plain sentence plus next step. Examples: "This order was just updated by someone else. Showing the latest." / "You're offline. Your work is saved on this phone."
5. **Simplicity.** Fewer screens, fewer settings. Remove before adding. Most orders should need only item taps and one confirm.
6. **Consistency.** Same word for the same action everywhere (the button, the toast, the timeline line). One component per job.
7. **Visual hierarchy.** Order number and timer first; items second; actions third; metadata last.
8. **Speed is a feature.** Optimistic updates, local reads, small bundles, no layout shift.

## 8. Key components (behaviour; visuals in `DESIGN.md`)

| Component | Behaviour |
|-----------|-----------|
| Order ticket | Number, age timer, items (max 3 lines then "+2 more"), note, primary next-step button; long-press or "more" for secondary actions. Pending marker for unsynced orders |
| Status chip | Icon plus word, color by status; template-specific wording |
| Status stepper | Shows the path for this order type with the current step highlighted |
| Item grid | Tiles with name, price; tap adds one; badge shows quantity; long-press or tap badge opens quantity |
| Quick-add bar | Duration chips (+10, +20, +30 min) for promised time |
| Customer lookup | Type phone or name; suggestions after 2 characters; regulars first |
| Payment sheet | Amount prefilled with balance, method chips, clear overpayment message |
| Courier card | Address, call and map buttons, amount to collect, one big status button |
| Timeline | Chat-like list: who, what, when |
| Skeletons | One per screen, same dimensions as real content |
| Banners | Offline, sync problems that need action |
| Toasts | Verb plus object, Undo where possible, announced to screen readers |

## 9. Accessibility

- WCAG 2.2 AA: 4.5:1 text contrast, 3:1 for UI components; focus always visible; targets at least 48 px with 8 px gaps.
- Status never by color alone (icon and word).
- Screen reader labels for all icon buttons; live region for new orders and conflicts.
- Supports 200% text scaling, reduced motion (movement replaced by instant change), and both light and dark schemes.
- Sound alerts always have a visual counterpart and can be muted.

## 10. Content and tone

- Plain words used at the counter ("Ready", "Out for delivery", "Customer approved"). No jargon.
- Sentence case. Specific verbs on buttons ("Send to kitchen", "Mark ready", "Record payment").
- Errors say what happened and what to do, in one or two short sentences.
- Amharic and Afaan Oromo copy written natively, reviewed by speakers; money and status terms checked first.

## 11. Anti-template checklist (Taste Skill style)

Before shipping any screen confirm it does not use: identical rounded cards with the same soft shadow everywhere, gradient wash backgrounds, numbered 01/02/03 section labels without a real sequence, an accent on one word of a headline, cream-and-terracotta or black-and-neon default palettes, decorative blobs or stock illustrations, hover-only information.

## 12. Review gates

At the end of each UI milestone: run the Web Interface Guidelines review, an axe accessibility pass, a manual keyboard and screen reader pass on the critical flows, and a throttled-network performance check. Fix findings or record why not.
