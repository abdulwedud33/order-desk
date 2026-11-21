# Production Launch Checklist

This checklist contains actions that **only the business owner and system administrator** can execute. The engineering and agent implementation for all milestones (M0 through M11) is complete, tested, and hardened in code.

---

## 1. Cloud Accounts & Hosting Infrastructure

- [ ] **Supabase Production Project**:
  - [ ] Create a production Supabase project (separate from local/staging development).
  - [ ] Set database password and store securely in your password manager.
  - [ ] Apply all migrations in order (`0001` through `0010`) via Supabase CLI:
    ```bash
    supabase db push
    ```
  - [ ] Verify `supabase_realtime` publication includes only `orders`, `order_items`, `order_money`, `order_events`.
  - [ ] Verify database connection pooling (`pgbouncer` on port 6543) is enabled for high concurrency.
- [ ] **Static CDN Hosting (Cloudflare Pages, Vercel, or Netlify)**:
  - [ ] Connect the git repository to your hosting provider.
  - [ ] Set build command to `npm run build` and publish directory to `out`.
  - [ ] Add public environment variables in the hosting dashboard:
    - `NEXT_PUBLIC_SUPABASE_URL`: Your production Supabase URL (`https://<project-ref>.supabase.co`).
    - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your production Supabase anon/public key.
  - [ ] Verify that `out/_headers` containing CSP hashes and security headers is deployed.
  - [ ] Configure custom production domain (e.g., `app.orderdesk.et`) with automated SSL/TLS certificates.

---

## 2. Secrets, API Keys & Edge Functions

- [ ] **Edge Function Secrets Configuration**:
  - [ ] Set production Edge Function secrets via Supabase CLI or dashboard:
    ```bash
    supabase secrets set AI_API_KEY="<your-model-api-key>"
    supabase secrets set AI_MODEL_FAST="gemini-1.5-flash"
    supabase secrets set AI_MODEL_SMART="gemini-1.5-pro"
    supabase secrets set AI_KILL_SWITCH="false"
    ```
  - [ ] Verify that the model provider account (e.g. Google Cloud / Gemini API or OpenAI) has billing enabled and zero data-training agreements active (zero data retention / non-training terms).
  - [ ] Deploy Edge Functions:
    ```bash
    supabase functions deploy ai-parse-order
    supabase functions deploy ai-status-draft
    supabase functions deploy ai-insights
    ```
  - [ ] Confirm no elevated keys (`service_role`, provider API keys) exist anywhere in client code or repositories.

---

## 3. Disaster Recovery & Backup Restore Drill

- [ ] **Point-In-Time Recovery (PITR)**:
  - [ ] Enable daily automated database backups and Point-In-Time Recovery (PITR) in the Supabase production dashboard.
  - [ ] **Conduct a Restore Drill**:
    1. Clone the production backup into a temporary test database.
    2. Run `select * from public.check_invariants();` against the restored database to confirm all 9 ledger invariants pass cleanly.
    3. Document total Recovery Time Objective (RTO) and Recovery Point Objective (RPO) in operational notes.

---

## 4. Native-Speaker Review (Amharic & Afaan Oromo)

- [ ] **Reviewer Session**:
  - [ ] Engage a native Amharic speaker to review UI strings and status templates in [src/i18n/am.ts](file:///c:/Users/abdul/OneDrive/Documents/order-desk/src/i18n/am.ts):
    - [ ] Order statuses and timeline wording
    - [ ] Financial terminology (Birr, cash collected, balances)
    - [ ] Polite, culturally appropriate customer update notifications
  - [ ] Engage a native Afaan Oromo speaker to review UI strings and status templates in [src/i18n/om.ts](file:///c:/Users/abdul/OneDrive/Documents/order-desk/src/i18n/om.ts):
    - [ ] Order statuses and timeline wording
    - [ ] Financial terminology (Qarshii, payments, balances)
    - [ ] Polite, culturally appropriate customer update notifications
  - [ ] Commit any phrasing refinements directly to translation catalogs.

---

## 5. Pilot Deployment (2 Weeks, 3–5 Businesses)

- [ ] **Select Pilot Businesses**:
  - [ ] 1–2 Food & Drinks businesses (café, fast food, or casual dining restaurant) for dine-in, takeaway, and kitchen display.
  - [ ] 1 Delivery/Courier shop to validate courier assignment, maps links, and cash-on-delivery flows.
  - [ ] 1 Repair & Workshop business to validate repair intake, estimate approvals, and 4-digit pickup code handovers.
- [ ] **Hardware & Setup in Shops**:
  - [ ] Counter tablet or smartphone running Chrome/Edge.
  - [ ] Kitchen counter device running Kitchen Display (`/kitchen`) with sound alert unmuted.
  - [ ] Test offline order creation on counter device in airplane mode; reconnect and confirm sync.
  - [ ] Confirm staff training: 3-step onboarding, Quick Entry paste, one-tap order advance.
- [ ] **Daily Monitoring during Pilot**:
  - [ ] Inspect automated nightly invariant check logs:
    ```sql
    select * from public.invariant_checks order by checked_at desc limit 7;
    ```
  - [ ] Review any 429 rate limit spikes or unexpected errors in `audit_log`.

---

## 6. Legal, Compliance & Local Regulations

- [ ] **Privacy Notice**:
  - [ ] Ensure public privacy notice reflects that customer phone numbers and delivery addresses are collected strictly for order fulfilment and tracking.
  - [ ] Confirm with a local legal advisor that operations comply with applicable Ethiopian data protection requirements and commercial regulations.
- [ ] **Payment Terms & Settlement**:
  - [ ] Document in shop agreements that Order Desk acts as an order ledger and records staff-confirmed payments (Cash, Telebirr, CBE Birr), but does not hold or transmit funds directly in v1.0.

---

## 7. Operational Incident Runbook & Kill Switches

- [ ] **Emergency Procedures**:
  - [ ] **Assistant Kill Switch**: If the model provider degrades or behaves unexpectedly, set `AI_KILL_SWITCH="true"` in Edge Function secrets. The app immediately falls back to deterministic local parsing and templates without interrupting manual ordering.
  - [ ] **Public Tracking Throttling**: The public tracking page is pre-configured with IP and token rate limiters (30/min per IP, 10/min per token). If scraping is detected, tighten limits via rate limiter RPC parameters.
  - [ ] **Key Rotation Drill**: Rehearse rotating the Supabase anon key and model API key without service downtime.
