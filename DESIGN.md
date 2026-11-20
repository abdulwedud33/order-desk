---
version: alpha
name: Order Desk
description: A calm, glanceable order board for counters, kitchens and workshops. Fast to tap, impossible to miss a late order.
colors:
  ink: "#161B22"
  paper: "#F4F6F8"
  surface: "#FFFFFF"
  line: "#DCE1E6"
  slate: "#5A6672"
  ember: "#C2500A"
  on-ember: "#FFFFFF"
  st-new: "#1D5FD1"
  st-progress: "#E0A030"
  st-progress-text: "#8A5600"
  st-waiting: "#6B4BC4"
  st-ready: "#0F7B5F"
  late: "#B3402F"
  dark:
    ink: "#E9EEF3"
    paper: "#0F1419"
    surface: "#18202A"
    line: "#2A3541"
    slate: "#9AA8B5"
    ember: "#F08A4B"
    on-ember: "#1A0E05"
    st-new: "#6FA2FF"
    st-progress: "#E0A030"
    st-progress-text: "#E0A030"
    st-waiting: "#A592F0"
    st-ready: "#3DBE97"
    late: "#F08070"
typography:
  heading:
    fontFamily: "Familjen Grotesk"
    fontWeight: 600
    letterSpacing: "-0.01em"
    lineHeight: 1.15
  body:
    fontFamily: "Public Sans"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tabular-nums"
  scale: [12, 14, 16, 20, 24, 32]
  order-number: { fontFamily: "Familjen Grotesk", fontWeight: 600, fontSize: 32px, fontFeature: "tabular-nums" }
rounded:
  control: 8px
  ticket: 12px
  sheet: 20px
spacing:
  unit: 4px
  steps: [4, 8, 12, 16, 24, 32]
components:
  button-primary:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.on-ember}"
    rounded: "{rounded.control}"
    height: 48px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.line}"
    rounded: "{rounded.control}"
    height: 48px
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.late}"
    borderColor: "{colors.late}"
    rounded: "{rounded.control}"
    height: 48px
  ticket:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.line}"
    rounded: "{rounded.ticket}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.line}"
    rounded: "{rounded.control}"
    height: 48px
  sheet:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sheet}"
---

# Order Desk design system

Read this before building or changing any screen. It is written for people and for coding agents. Behaviour rules (loading, feedback, errors, laws, psychology) live in `04-ui-ux-design-brief.md`; this file holds the visual system. Update both together.

## Overview

**Subject:** a busy counter, kitchen or workshop. **Audience:** staff on mid-range phones and tablets, often one-handed, in bright light or a hot kitchen, sometimes offline. **Job:** take an order fast, see what is next, never miss a late one.

**Feeling:** calm under pressure. Quiet surfaces, strong numbers, one loud thing at a time.

**Memorable element (one place only): the order ticket with an age timer.** The order number is the biggest thing on the ticket. Next to it, a small timer counts minutes since arrival. It is neutral by default, turns amber near the promised time, and red when late. Red is used for nothing else on the board.

**Taste dials:**

| Dial | Value | Meaning here |
|------|-------|--------------|
| DESIGN_VARIANCE | 3 / 10 | Conventional Kanban and ticket patterns (Jakob's Law) |
| MOTION_INTENSITY | 2 / 10 | Motion answers taps only; one orchestrated moment: a new ticket slides in with a brief highlight |
| VISUAL_DENSITY | 7 / 10 | Compact tickets so many orders fit; generous space around the primary action |

**Layout:** phone is one column with status tabs; tablet shows columns side by side (New, In progress, Ready), each scrolling on its own. Primary actions sit in the bottom 40% of the screen. Money and numbers are right-aligned or in fixed positions so digits line up.

**Spacing:** 4 px base; steps 4, 8, 12, 16, 24, 32. Page gutter 16. Related items 8, groups 16, sections 24 or 32.

**Voice:** plain counter words ("Ready", "Out for delivery"). Sentence case. Specific buttons ("Mark ready"). The same verb in the button, the toast and the timeline.

**Design sources applied:** Awesome DESIGN.md / Google Stitch format (this file), impeccable (six fixed sections, anti-generic rules), Taste Skill (dials and restraint), Web Interface Guidelines (review step), UI UX Pro Max (palette, pairing and pattern checks). See `04-ui-ux-design-brief.md` section 2.

## Colors

Cool neutrals, one confident primary (`ember`), and status colors that each mean one thing.

| Token | Light | Role |
|-------|-------|------|
| `ink` | `#161B22` | Text |
| `paper` | `#F4F6F8` | App background |
| `surface` | `#FFFFFF` | Tickets, sheets, inputs |
| `line` | `#DCE1E6` | Dividers, borders |
| `slate` | `#5A6672` | Secondary text |
| `ember` | `#C2500A` | Primary action (about 4.7:1 with white text) |
| `st-new` | `#1D5FD1` | New |
| `st-progress` / `st-progress-text` | `#E0A030` / `#8A5600` | In progress: fills and icons / small text |
| `st-waiting` | `#6B4BC4` | Waiting |
| `st-ready` | `#0F7B5F` | Ready |
| `late` | `#B3402F` | Late, errors, destructive |

**Rules**

1. One saturated filled element per screen: the primary action. Status colors appear as a thin left edge, a chip and an icon, not as large fills.
2. `late` is reserved for lateness and errors, so it stands out (Von Restorff).
3. Color is never the only signal: every status has an icon and a word.
4. Contrast: text 4.5:1, UI components and large text 3:1. `st-progress` (`#E0A030`) is for fills and icons only; use `st-progress-text` for text.
5. Dark mode (common in kitchens) uses the same hues with lighter values (front matter). Contrast is checked in CI for both schemes.
6. No gradient washes as decoration.

## Typography

- **Headings and order numbers:** Familjen Grotesk, weight 600, slight negative tracking.
- **Body and UI:** Public Sans, weights 400, 500, 600.
- **Numbers:** `font-variant-numeric: tabular-nums` for order numbers, timers, money and quantities.
- **Scale (px):** 12 metadata, 14 secondary, 16 body and inputs (minimum), 20, 24, 32 (order number, hero totals). Line height 1.4 body, 1.15 headings.
- **Fonts are self-hosted**, subset, `font-display: swap`, with metric-matched fallbacks to avoid layout shift. Noto Sans Ethiopic is bundled for Amharic; Latin fonts cover Afaan Oromo. Ge'ez text is set about 1 px larger with more line height. Kitchen mode raises sizes one step.
- **Avoid:** all-caps labels, an accent on one word of a headline, monospace for small labels.

## Elevation

Flat first. Hierarchy comes from spacing, size and weight, then borders, then shadow.

| Level | Use | Treatment |
|-------|-----|-----------|
| 0 | Page | `paper`, no border |
| 1 | Tickets, rows, inputs | `surface`, 1 px `line` border, no shadow; status shown by a 4 px left edge |
| 2 | Bottom navigation, action bars | `surface`, top border, very soft upward shadow |
| 3 | Sheets and dialogs | `surface`, 20 px top radius, scrim behind, soft shadow |

**Shape:** radius differs by hierarchy: 8 px controls, 12 px tickets, 20 px sheets. Pills only for status chips. A faint perforation line (dotted divider) separates the ticket header from its items; this is the ticket motif and is used nowhere else.

**Motion:** 120 to 180 ms ease-out, only in response to input: press, sheet open, a new ticket sliding in. Respect `prefers-reduced-motion` (replace movement with an instant change). No scroll-triggered effects, no hover-only effects.

## Components

All components define default, pressed, focused, disabled, loading (skeleton) and error states. Reuse; do not fork.

**Order ticket.** Left status edge (4 px). Header row: order number (32, tabular) and age timer (14, tabular, neutral/amber/red). Perforation divider. Items (max 3 lines, then "+N more"), note in italic slate. Footer: the one primary button (next step, `ember`) and a "more" icon button. A pending marker ("Saved on this phone") appears for unsynced orders.

**Status chip.** Icon plus word; color by status; pill shape.

**Status stepper.** The path for this order type; completed steps filled, current step outlined with its chip, future steps muted.

**Buttons.** Primary (`ember` fill; one per screen), secondary (bordered), danger (bordered `late`, separated from other actions). Specific verb labels. Pressed state within 100 ms. A disabled button says why in helper text.

**Inputs.** Visible label above (never placeholder only), 16 px text, correct mobile keyboard (numeric for money, quantity and phone), reserved space for the message line so layout never jumps.

**Item tile (New order).** Name 16/600, price 14 slate, quantity badge top-right when added. Minimum 96 x 72. Unavailable items are hidden from the grid.

**Bottom navigation.** Up to 5 items; center "New" is a raised round primary button. Active item uses `ember` text and icon.

**Skeleton loaders (whole app).** No spinners. When the content shape is known, show a skeleton with the same ticket height, column headers and spacing as the real screen, so nothing shifts. Low-contrast shimmer; static under reduced motion.

**Toasts.** Verb plus object ("Order sent to kitchen"), Undo where possible, announced to screen readers; never contain codes.

**Banners.** Offline ("Offline. Changes are saved on this phone."), sync problems that need action. Quiet unless the person must act.

**Onboarding screens.** Fixed layout: the progress bar and the Back/Next bar never move, resize or jump between steps; keyboard-safe; reserved message space.

**Empty states.** One sentence and one clear action.

**Kitchen mode.** One column, oldest first, type one step larger, only the primary button, sound toggle in the header, no money or contact details.

## Do's and Don'ts

**Do**

- Update the screen first and reconcile after (optimistic), then confirm or roll back clearly.
- Use smart defaults: last order type, last payment method, promised time from prep times.
- Show progress toward a goal (onboarding, repair stepper, daily completed orders).
- Frame warnings with real numbers ("2 orders are late").
- Keep one primary action per ticket and per screen, near the thumb.
- Group related things; chunk long lists by status and day.
- Use the same word for the same action everywhere.
- Test with 200% text, light and dark, offline, kitchen mode, and a screen reader.
- Run the Web Interface Guidelines review and an accessibility audit at the end of each UI milestone.

**Don't**

- Don't use spinning loaders where a layout-matched skeleton is possible.
- Don't show backend errors: no codes, SQL, stack traces, "500" or raw JSON.
- Don't move buttons during onboarding.
- Don't rely on color alone, hover-only information or tiny touch targets.
- Don't use identical soft-shadow cards everywhere, gradient washes, numbered labels without a real sequence, cream-and-terracotta or black-and-neon defaults, decorative blobs.
- Don't use fake urgency or guilt copy; psychology must help the user reach their own goal.
- Don't add a setting when removing a feature would do.
- Don't invent one-off components, colors or spacing; extend the tokens here first.
