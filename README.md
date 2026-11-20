# Order Desk (working title): planning package

Project 2 of 3 (General Projects): order management for restaurants, cafés, delivery businesses and repair shops. Planning only. **No code is written until the owner says "start building".**

## Files

| File | Purpose |
|------|---------|
| `01-prd.md` | Product requirements: problem, users, goals, scope, requirements with acceptance criteria, metrics, risks |
| `02-technical-requirements.md` | Architecture, stack, data flow, status machine, speed rules, security summary, testing |
| `03-app-flow.md` | Screens, flows per role, onboarding, states (loading, empty, offline, error) |
| `04-ui-ux-design-brief.md` | Look and behaviour: laws, psychology, standing UX rules, components |
| `DESIGN.md` | Machine-readable design system (tokens plus prose) |
| `05-backend-schema.md` | Tables, role-aware RLS matrix, RPC functions, triggers, invariants |
| `06-implementation-plan.md` | Milestones M0 to M11, definition of done, risks |
| `agents.md` | In-app assistant (part A) and coding-agent instructions (part B) |
| `tools.md` | Allow-listed assistant tools and safety principles |
| `memory.md` | What the assistant may and may not remember |
| `evals.md` | Tests and thresholds, per language |
| `guardrails.md` | Input, injection, output, privacy and ethical limits |
| `prompts.md` | Versioned prompts and output schemas |
| `security.md` | Security baseline and launch checklist |

Suggested reading order: `01`, `02`, `05`, `security.md`, `03`, `04`, `DESIGN.md`, `06`.

## Assumptions to confirm

1. Installable web app (PWA), statically hosted, on Supabase.
2. Currency ETB; languages English, Amharic, Afaan Oromo (same as project 1).
3. Roles: owner, staff, kitchen, courier. Food template first, then repair, then delivery extras.
4. Customer messages are drafted by the app and sent by a person; no messaging provider in v1.
5. Chat-app intake by paste in v1; a Telegram bot is v1.1. Web push is v1.1.
6. Order numbers assigned by the server per day; offline orders show a temporary reference.

Open questions are listed in `01-prd.md` section 11.

## Where each standing requirement lives

| Requirement | Files |
|-------------|-------|
| No secrets in frontend or app | `security.md` s3, `02` s7, `guardrails.md` s9 |
| Users access only authorized data | `security.md` s4-5, `05` (matrix), `tools.md` |
| Backend and DB rules enforced | `security.md` s5-6, `05`, `06` DoD |
| User and AI input validated | `security.md` s6, `guardrails.md` s2 and s4 |
| Five UX laws (Jakob, Hick, Proximity, Miller, Von Restorff) | `04` s5, `DESIGN.md` |
| Skeleton loaders, no spinners | `04` s7, `DESIGN.md` Components, `03` s5 |
| Instant feedback, optimistic rendering | `04` s7, `02` s6 |
| No moving buttons in onboarding | `03` s2, `04` s7, `DESIGN.md` |
| No backend errors shown | `security.md` s8, `guardrails.md` s8, `04` s7 |
| UX psychology (defaults, goal gradient, reciprocity, endowment, loss aversion) | `04` s6, `guardrails.md` s10 |
| Simplicity, consistency, visual hierarchy | `04` s7, `DESIGN.md` |
| Speed rules (compressed JSON, sane DB writes, no single bottleneck, optimistic, static hosting) | `02` s6 |
| RLS on every table with policies | `security.md` s5, `05` |
| Rate limiting on all APIs | `security.md` s7, `guardrails.md` s6 |

## Design sources

Awesome DESIGN.md (format), impeccable (structure and anti-generic rules), Taste Skill (dials), Web Interface Guidelines (review step), UI UX Pro Max (palette and pattern checks). Principles are applied in `DESIGN.md` and `04`; no files were copied. Install notes for coding agents are in `agents.md` part B.
