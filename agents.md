# agents.md

Two audiences in one file:

- **Part A:** the in-app AI assistant (what it is allowed to do for the shop).
- **Part B:** instructions for coding agents that work on this repository.

Companions: `tools.md` (tool list), `prompts.md` (prompt text), `guardrails.md` (limits), `memory.md` (what is remembered), `evals.md` (tests), `security.md`.

---

# Part A. In-app assistant

## A1. Principles

1. **Propose, never commit.** The assistant drafts; people confirm. It cannot create, change, cancel, pay for or message anything by itself.
2. **Code does the math and the rules.** Totals, status changes, day numbers and balances come from the database. The assistant never invents them.
3. **Least data, least power.** Each agent gets only the tools it needs, scoped to the caller's shop and role by the server.
4. **Optional.** The shop works fully without it. If it fails or is switched off, the manual flow is unaffected.
5. **Respectful.** Customer messages are polite drafts a person sends; no pressure, no threats.

## A2. Agents

| Agent | Who can use it | Job | Output |
|-------|----------------|-----|--------|
| Order Intake | Owner, staff | Turn a pasted or typed message (phone note, Telegram or WhatsApp text) into a **draft order** | A draft card: type, items, quantities, label, channel, note, due time hint; or a clarification question with options |
| Status Writer | Owner, staff (drafts only) | Draft a short message to a customer about status (received, ready, delayed, estimate needs approval) | Text in the customer's language to copy or share |
| Insights Analyst | Owner | Daily or weekly summary: busiest hours, late orders and likely reasons, repeat items, jobs waiting too long | Short summary plus up to 5 suggestions, each tied to real numbers |

Kitchen and courier roles do not use the assistant.

### Order Intake details

- Input: one message up to 600 characters (longer messages are asked to be split).
- **Redaction before the model:** phone numbers are detected and replaced by placeholders (`[PHONE_1]`) by code. Addresses are passed as plain text data only when the order type is delivery. The final draft puts the real values back after the model returns.
- It must match items to the catalog by calling `search_catalog`. If two or more items fit, or none fit, it asks instead of guessing. Free-text lines are allowed only when the person confirms.
- Quantities and units are normalised ("half" is 0.5, "a dozen" is 12). A conflicting unit triggers a question.
- Output is a draft created by `propose_order`; the draft comes from the server-recorded tool result, never from model text.

### Status Writer details

- Facts come from `get_order_for_message` (order code, status, due time, shop name, customer first name). No phone, address or money unless the person asked for a payment reminder (not in v1).
- Tone options: friendly, neutral, formal. Length limit 60 words. No threats or pressure. Delays state the new time from the person's input, not a guess.
- The text is shown as a draft. The app never sends it.

### Insights Analyst details

- Calls report tools only. Every number in the output must appear in a tool result (checked in code).
- Reasons for lateness are given only when the data supports them (for example "most late orders were placed 12:00 to 13:00") and are phrased as observations.

## A3. Request lifecycle

1. Client calls the Edge Function with the user's session token and a small, validated body.
2. Function verifies the session, loads the user's shop and role, checks the kill switch, rate limits and daily budget.
3. Input is cleaned (length, control characters), phone numbers are redacted, and untrusted data is wrapped in marked blocks.
4. The model is called with the allow-listed tools for this agent and role; at most 6 tool calls and 3 turns.
5. Output passes the pipeline in `guardrails.md` section 4 (schema, grounding, recompute, limits, safety).
6. The client shows a draft card with Confirm and Discard. Confirm runs the normal order flow (local save, outbox, server RPC with all its rules).

## A4. Failure behaviour

| Situation | Behaviour |
|-----------|-----------|
| Provider down, slow or over budget | Friendly message and the manual screen; nothing blocked |
| Ambiguous message | Question with tappable options |
| Output fails validation | One retry at most, then a fallback (for Status Writer, a plain template filled by code) |
| Prompt injection attempt inside a pasted message | Treated as data; ignored; metric recorded |
| Rate limited | "Too many tries. Please wait a minute." |

## A5. Quality bar

Defined in `evals.md`: per-language intake accuracy, zero invented ids, zero leaked contact data in logs, zero threatening drafts, grounded numbers in insights. A language that misses its bar ships without the assistant.

---

# Part B. Instructions for coding agents

Read in this order before changing anything: `README.md`, `01-prd.md`, `02-technical-requirements.md`, `05-backend-schema.md`, `security.md`, `DESIGN.md`, `04-ui-ux-design-brief.md`.

## B1. Ground rules

1. **No code until the owner says "start building."** Work one milestone at a time (`06-implementation-plan.md`).
2. **Security first.** No secrets in client code or the bundle. RLS on every table with policies in the same migration. Validate all input. Rate limit every endpoint. Never show backend errors to users.
3. **The database is the judge.** Business rules live in SQL and RPC functions. UI checks are convenience.
4. **One action = one transaction = one RPC.** No client loops of dependent writes.
5. **Idempotent writes.** Client-generated ids; replays change nothing.
6. **Local first, optimistic UI.** Screens read the local database; actions update it first and sync after.
7. **No spinners.** Skeleton loaders that match the real layout, across the whole app.
8. **Honest reporting.** Say what was verified by a test or run and what was not.

## B2. Commands (to be created in M0)

```bash
npm run dev          # local app
npm run typecheck    # strict TypeScript
npm test             # unit tests (domain, i18n, guardrails)
npm run test:db      # pgTAP against the local Supabase stack
npm run build        # static export, per-page CSP, bundle secret scan
```

## B3. Conventions

- TypeScript strict; no `any` without a comment. Pure logic in `domain/` with no framework imports.
- Money as integer minor units (santim) in code, `numeric(14,2)` in SQL; quantities in hundredths or `numeric(10,2)`.
- Migrations: one file per milestone, forward-only, applied by CI.
- Every new table: enable RLS, write policies, add the matrix tests for all roles, revoke default privileges, add indexes for policy columns.
- Every new RPC: `security definer`, `set search_path = ''`, role check, rate limit, validation, idempotency, event, coded errors.
- All user-facing text through message catalogs (English, Amharic, Afaan Oromo); never concatenate sentences.
- Commit messages: imperative, scoped (`orders: add advance_order conflict check`). Pull requests describe behaviour and tests.

## B4. Design skills for coding agents

Read `DESIGN.md` first for any UI work, then `04-ui-ux-design-brief.md`. These community skills may be installed as extra checks. Commands below come from each project's public docs; confirm them against the current README and review any skill's contents before trusting it.

| Skill | Use it for | Install (from its docs) |
|-------|-----------|-------------------------|
| Awesome DESIGN.md (VoltAgent) | Reference DESIGN.md files for structure; adapt, do not copy | Clone `github.com/VoltAgent/awesome-design-md` |
| impeccable | Generating and auditing a DESIGN.md; anti-generic design commands | `/plugin install pbakaus-impeccable@pbakaus/impeccable` (Claude Code) |
| Taste Skill | Premium, non-generic frontend; keep dials at variance 3, motion 2, density 7 | `npx skills add https://github.com/Leonxlnx/taste-skill` |
| Web Interface Guidelines (`web-design-guidelines`) | Review UI code for accessibility, forms, focus, performance | `npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines` |
| UI UX Pro Max | Palette, font pairing and pattern checks | `npx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max` |

Rules: `DESIGN.md` wins over any skill's default taste; run the Web Interface Guidelines review and an accessibility pass at the end of every UI milestone; ignore suggestions that match the "Don't" list; check bundle budget and licence before adding generated assets or dependencies.

## B5. Definition of done for a task

Tests written and passing, RLS and role tests for new data, validation and rate limits in place, skeletons and instant feedback on new screens, strings in all three languages, accessibility check, docs updated, and a plain statement of what was and was not verified.
