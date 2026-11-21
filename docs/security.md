# security.md

Security baseline for Order Desk (working title). This file is the single source of truth for security rules. Every milestone in `06-implementation-plan.md` must meet it before it is "done".

**Status:** planning. Rules apply from the first line of code.

---

## 1. What we protect

| Asset | Why it matters | Who must never see it |
|-------|----------------|-----------------------|
| Orders, items, status history | The business's day-to-day | Other businesses, anonymous users |
| Customer phone numbers and addresses | Personal data | Kitchen role, other shops, logs, the AI model, public pages |
| Prices, totals, payments, balances | Business-sensitive | Kitchen role, other shops |
| Repair pickup codes and tracking tokens | Grant access to a handover or a status view | Anyone but the shop team and the intended customer |
| Auth sessions and tokens | Account takeover | Anyone but the user |
| Service-role key, model API key | Full access / money | The browser, git, logs |

## 2. Non-negotiables

| # | Rule | Where enforced |
|---|------|----------------|
| 1 | **No secrets or keys in the frontend or inside the app.** Only the public project URL and public (anon) key may ship | Section 3, CI bundle scan |
| 2 | **Users access only authorized data**, decided by the server from the verified session and role | Sections 4, 5 |
| 3 | **Backend and database rules are enforced.** UI checks are convenience; RLS, constraints, the status machine and RPC checks are the real rules | Sections 5, 6 |
| 4 | **All user and AI input is validated** on the client and again on the server | Section 6, `guardrails.md` |
| 5 | **Row level security on every table, with policies in the same migration** | Section 5 |
| 6 | **Rate limiting on all APIs**, including the public tracking endpoint and the assistant | Section 7 |
| 7 | **No backend errors shown to users** | Section 8 |

## 3. Secrets management

**Allowed in the client:** project URL, public anon key, public config (feature flags, app version).
**Never in the client or git:** service-role key, model API key, database password, JWT secret, webhook secrets, real `.env` files.

| Practice | Detail |
|----------|--------|
| Where secrets live | Edge Function secrets, CI secret store, hosting dashboard (public build vars only) |
| Local development | `.env.local` git-ignored; committed `.env.example` has placeholders only |
| Scanning | Secret scan on every pull request and weekly on full history |
| Bundle check | CI fails the build if the static output contains a service-role key, a model key, or a JWT whose role is not `anon` |
| Model calls | Only from Edge Functions; the browser never calls the provider |
| Service role | Only for the rate limiter, usage log and the tracking lookup; never to answer a user request on user data |
| Rotation | On staff change, suspected leak, and at least every 6 months; steps in the runbook |
| Logs | Never log tokens, keys, pasted messages, phone numbers, addresses or raw prompts |

If a secret is ever committed: revoke and rotate first, then clean history.

## 4. Authentication, sessions and roles

- Supabase Auth with email and password; passwords never handled by our code. Minimum length 10, checked against common-password lists.
- Sign-in, sign-up and reset are rate limited; responses never reveal whether an account exists.
- Short-lived access token with refresh; sign out wipes local data (section 10).
- Roles (`owner`, `staff`, `kitchen`, `courier`) are stored in `shop_members`, never in client-editable token metadata. A role change takes effect on the next request.
- Invites: single-use, expiring (48 h), owner only, role fixed at creation; only the hash of the code is stored.
- Sensitive owner actions (refund, override, role change, member removal, price change) are written to `audit_log`.
- Optional later: owner MFA; app PIN lock on shared counter devices.

## 5. Authorization and row level security

**Every table has RLS enabled. A migration that adds a table without RLS and policies fails review and CI.**

1. Default deny. `anon` has no policies on any table.
2. Never `using (true)` or `with check (true)` on shop data.
3. Policies use helper functions (`my_role`, `is_member`, `has_role`, `can_see_order`, `can_see_sensitive`) with `(select auth.uid())` so the user id is evaluated once per query. Policy columns are indexed.
4. Security-definer functions set `search_path = ''`, use qualified names and re-check the caller's role inside.
5. Views use `security_invoker = true` unless a view is deliberately a role-filtered projection, in which case the filter is inside the view and tested.
6. **Separation of sensitive data:** contacts in `order_contacts`; money in `order_money`, `order_item_prices`, `order_payments`. The kitchen role can read none of these.
7. **Courier scoping:** couriers read only orders assigned to them and the sensitive rows for those orders, including through realtime.
8. Business tables allow no direct client writes; all writes are RPC functions. Append-only tables (`order_events`, `order_payments`) block UPDATE and DELETE by privilege and trigger.
9. A guard trigger prevents status changes outside the status-machine RPC.
10. Realtime publishes only tables whose rows are safe under their RLS for every subscriber.
11. The client never sends `shop_id`, `user_id` or `role` to an assistant tool; the server derives them.

**Required test matrix** (CI, blocking): for every table and action, actors anonymous, outsider, owner, staff, kitchen, courier assigned, courier other. Cross-shop reads and writes always fail.

## 6. Input validation and output encoding

| Layer | Mechanism |
|-------|-----------|
| Client | Zod schemas shared with Edge Functions |
| Edge Functions | Parse every request; reject unknown fields; body size limit |
| RPC functions | Argument shape, range, length and enum checks; coded errors |
| Database | `CHECK` constraints, `NOT NULL`, foreign keys, unique keys |
| AI input and output | `guardrails.md`; AI output is untrusted input and passes the same validators |

Specific rules:

- **Money and quantities** bounded and precise; the server recomputes totals; client totals are never trusted.
- **IDs** are UUIDs and must belong to the caller's shop (RLS and lookups).
- **Text** (names, notes, addresses, labels) has length limits, Unicode normalisation, control-character stripping, and is treated as untrusted everywhere, including pasted chat messages and AI prompts.
- **Phone numbers** normalised and length-checked; stored only in `order_contacts` and `customers`.
- **XSS:** React escaping only; no `dangerouslySetInnerHTML`; strict CSP.
- **CSV export:** cells beginning with `=`, `+`, `-` or `@` are prefixed with `'`.
- **SQL:** parameterised only; no string-built SQL in functions.
- **Links** (map and call links) are built from validated fields with encoding; never from raw model text.

## 7. Rate limiting (all APIs)

Every endpoint has a limit. "No limit" is not allowed, including reads, auth, tracking and the assistant.

| Surface | Starting limit | Key | Enforced by |
|---------|----------------|-----|-------------|
| Sign-in, sign-up, reset | 5 per 15 min per IP and per identifier | IP, identifier | Auth limits plus CDN rule |
| Invite create and accept | 10 per hour; accept 10 per 15 min | user | RPC limiter |
| Write RPCs (create, advance, payment, assign, cancel) | 240 per minute per user | user | RPC limiter, CDN rule |
| Read RPCs and lists | 300 per minute per user; page size at most 50 | user | PostgREST max rows, limiter |
| Reports | 30 per minute per user | user | RPC limiter |
| Realtime connections | 5 concurrent per user | user | Platform limits and monitoring |
| Public tracking | 30 per minute per IP; 10 per minute per token | IP, token | CDN/WAF plus function limiter |
| Assistant | 10 per minute and 200 per day per user; token cap per shop per day | user, shop | Edge limiter |
| Export | 5 per hour per shop | shop | Edge limiter |
| Anything unauthenticated | 60 per minute per IP | IP | CDN/WAF |

Notes: layered limits (CDN, function, database, max rows). Limits return 429 with `Retry-After`; the UI shows a calm message; the offline queue backs off with jitter so reconnecting devices never flood the API. Alerts on sustained 429 spikes and repeated auth failures.

## 8. Error handling: never show backend errors

1. Users never see stack traces, SQL, table or column names, status codes, request ids or raw JSON.
2. Server errors carry short internal codes; one translation module maps each to a plain localized sentence and a next step; unknown codes map to a generic message.
3. Details go to logs with a request id; no personal data in logs.
4. Permission errors are generic and never confirm that a record exists.
5. Conflicts and invalid transitions are explained in human terms ("This order was just updated by someone else").
6. CI includes a failure-fuzz test asserting no code, SQL or stack text ever reaches the DOM.

## 9. Public tracking page (special attention)

- Token: 128-bit random, base64url, stored in `order_contacts`; looked up only by the Edge Function with the service role.
- Response contains only: shop name, business type, order code, status, due time, last update. No phone, address, names, items or money.
- Unknown, expired or cancelled-too-long-ago tokens return the same generic answer with similar timing.
- Rate limited per IP and per token; no user enumeration; `noindex` and `Referrer-Policy: no-referrer` on the page.
- Tokens expire (configurable; default 60 days after completion). The owner can disable tracking links for the shop.
- The page ships as a separate tiny bundle with no third-party scripts.

## 10. Transport, browser and device

- HTTPS only; HSTS; TLS 1.2+.
- Security headers generated per page: CSP with script hashes (no `unsafe-inline` for scripts), `connect-src` limited to our API origins, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- CORS on functions: allow-list of our own origins.
- Third-party scripts: none by default; any addition needs review and Subresource Integrity.
- Service worker caches static files only; never API responses. Shop data is cached in IndexedDB under our control.
- **Data on the device:** sign out wipes the local database and caches; no tokens or keys in IndexedDB; kitchen sessions never receive money or contacts, so they are never cached; optional app PIN lock for shared counter devices; honest limit: browser storage is not a vault, so we store as little as possible.

## 11. Privacy and personal data

- Collect only what is needed: customer name and phone, delivery address, staff email.
- Contact data belongs to the shop; owners can export and delete it. Account deletion removes the shop's data after a short grace window.
- AI: phone numbers are redacted before the model call and never appear in logs; minimum fields only; provider settings must disable training on our data (verify current terms).
- Analytics and error reports exclude names, phones, addresses and amounts tied to a person.
- Confirm applicable local data-protection requirements with a qualified advisor before public launch; this document is an engineering baseline, not legal advice.

## 12. Supply chain and build

- Lockfile committed; reproducible installs; weekly dependency updates; audit and licence checks on every pull request (high severity blocks merge).
- CI actions pinned to commit SHAs; least-privilege tokens; branch protection with required reviews and checks.
- Production migrations applied by CI only.
- Few dependencies, each justified (also protects the bundle budget).

## 13. Monitoring and incident response

| Signal | Alert when |
|--------|-----------|
| Auth failures | Spike per IP or account |
| 429 responses | Sustained spike (including tracking) |
| RPC errors by code | Above baseline; `FORBIDDEN` spikes |
| Invariant job | Any mismatch |
| Realtime reconnects | Above baseline |
| Assistant cost, schema failures, redaction misses | Above budget or any redaction miss |
| Secret scan | Any finding |

**Incident steps:** contain (kill switches), assess (what data, which shops), restore (backups and point-in-time recovery), notify affected owners plainly, write a blameless post-mortem and add a test.

Kill switches (server-side flags): assistant, tracking links, exports, new sign-ups, read-only mode.

## 14. Security testing

| Test | Frequency | Blocking |
|------|-----------|----------|
| RLS matrix (every table, every role) | Every PR | Yes |
| Status machine and permission tests | Every PR | Yes |
| Invariants | Nightly and on PR | Yes |
| Secret scan and bundle grep | Every PR | Yes |
| Dependency and licence audit | Every PR | High severity |
| Failure-fuzz (no backend text in UI) | Every PR | Yes |
| Rate-limit tests including tracking | Every PR | Yes |
| Assistant adversarial suite | Prompt, tool or model change | Yes |
| DAST baseline against staging | Weekly | Reviewed |
| Manual review against OWASP Top 10 and ASVS-style checklist | Before launch, each major release | Yes |

Abuse cases to test by hand: IDOR on every id; forged `shop_id`; kitchen calling contact or money RPCs and tables directly; courier reading unassigned orders (direct and realtime); replayed requests; stale sessions after role change; invite reuse; guessing tracking tokens; tracking page scraping; mass export; huge payloads; Unicode edge cases; pasted-message injection; two-device race on status and payment.

## 15. Launch security checklist

- [ ] RLS enabled on every table; matrix tests green for all roles
- [ ] No table readable or writable by `anon`
- [ ] Kitchen cannot read contacts, money, payments, events or customers (tables, views, realtime)
- [ ] Courier sees only assigned orders (tables and realtime)
- [ ] Append-only tables reject UPDATE and DELETE; status guard trigger works
- [ ] Secret scan and bundle scan clean; service-role and model keys only in server secrets
- [ ] Validation on every input; RPC and database constraints in place
- [ ] Rate limits live and tested on every endpoint, including tracking
- [ ] Error translation covers all codes; failure-fuzz green
- [ ] Tracking page returns minimal data; unknown tokens generic; tokens expire
- [ ] Security headers and CSP deployed and verified
- [ ] Sign out wipes local data
- [ ] Backups and point-in-time recovery tested with a restore drill
- [ ] Kill switches tested
- [ ] Incident runbook written; key rotation rehearsed
- [ ] Dependency audit clean; branch protection on
- [ ] Privacy notice and data export and delete working

## 16. Requirement traceability

| Requirement | Enforced here | Also see |
|-------------|---------------|----------|
| No secrets in frontend or app | Section 3 | `02-technical-requirements.md` section 7 |
| Users access only authorized data | Sections 4, 5 | `05-backend-schema.md` |
| Backend and DB rules enforced | Sections 5, 6 | `06-implementation-plan.md` Definition of Done |
| User and AI input validated | Section 6 | `guardrails.md` |
| RLS on every table with policies | Section 5 | `05-backend-schema.md` |
| Rate limiting on all APIs | Section 7 | `guardrails.md` section 6 |
| No backend errors shown | Section 8 | `04-ui-ux-design-brief.md` section 7 |
