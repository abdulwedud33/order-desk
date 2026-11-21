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
