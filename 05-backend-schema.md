# 05. Backend Schema

**Product:** Order Desk (working title). **Status:** Draft v0.1. Postgres (Supabase) with row level security.
**Reads with:** `02-technical-requirements.md` (status machine, flows), `security.md` (rules), `06-implementation-plan.md` (milestone order).

---

## 1. Principles

1. **Row level security is on for every table, and policies are written in the same migration.** Default privileges give the API roles nothing; each migration grants exactly what is needed.
2. **Sensitive data lives in separate tables** so roles that do not need it cannot read it: contact details in `order_contacts`, money in `order_money` and `order_item_prices`. Kitchen staff can read what to make, never who or how much.
3. **All business writes go through RPC functions** (one action = one transaction). The functions are `security definer`, set `search_path = ''`, and re-check the caller's role inside. Clients have no direct INSERT, UPDATE or DELETE on orders, items, money, payments or events.
4. **Append-only history.** `order_events` and `order_payments` can never be updated or deleted (privileges revoked and triggers block it). Corrections are new rows.
5. **Idempotency.** Every write carries a client-generated UUID (`id` or `client_id`). A replay returns the stored result and changes nothing.
6. **The server decides.** Totals, order numbers, status changes and paid amounts are computed in the database from trusted data.
7. **Optimistic concurrency.** Status changes pass the status the client saw (`expected_from`); edits pass `version`. A mismatch raises `CONFLICT`.
8. Money is `numeric(14,2)` (birr and santim). Quantities are `numeric(10,2)` (half portions allowed).

## 2. Enumerations

```sql
create type member_role    as enum ('owner', 'staff', 'kitchen', 'courier');
create type business_type  as enum ('food', 'delivery', 'repair');
create type order_type     as enum ('dine_in', 'takeaway', 'delivery', 'repair');
create type order_status   as enum ('new', 'accepted', 'in_progress', 'waiting', 'ready',
                                    'out_for_delivery', 'completed', 'cancelled');
create type order_channel  as enum ('walk_in', 'phone', 'telegram', 'whatsapp', 'instagram', 'other');
create type pay_method     as enum ('cash', 'mobile_money', 'bank', 'other');
create type payment_kind   as enum ('payment', 'deposit', 'refund');
create type event_type     as enum ('created', 'edited', 'status_changed', 'payment', 'assigned',
                                    'cancelled', 'estimate_approved', 'handed_over', 'note');
```

## 3. Tables

### 3.1 Identity and shop

```sql
profiles      (id uuid pk -> auth.users, full_name text, locale text)
shops         (id uuid pk, owner_id uuid, name text, business_type business_type,
               currency char(3) default 'ETB', locale text default 'en',
               timezone text default 'Africa/Addis_Ababa',
               default_delivery_fee numeric(14,2) default 0,
               late_grace_minutes int default 0, require_pickup_code boolean default true,
               created_at timestamptz)
shop_members  (shop_id, user_id, role member_role, display_name text, created_at, pk(shop_id, user_id))
shop_invites  (id, shop_id, code_hash bytea unique, role member_role check (role <> 'owner'),
               expires_at, created_by, used_at, used_by)           -- only the hash of the code is stored
audit_log     (id bigint, shop_id, actor, action, entity, entity_id, meta jsonb, created_at)
rate_limits   (key text, window_start timestamptz, hits int, pk(key, window_start))   -- no client access
order_counters(shop_id, order_date date, last_no int, pk(shop_id, order_date))        -- no client access
shop_memory   (id, shop_id, kind in ('alias','preference','fact'), key, value, unique(shop_id, kind, key))
ai_usage      (id bigint, shop_id, user_id, agent, input_tokens, output_tokens, ok, created_at)
```

### 3.2 Catalog and customers

```sql
catalog_categories (id, shop_id, name, sort int, unique(shop_id, name))
catalog_items      (id, shop_id, category_id null, name text, kind in ('item','service'),
                    price numeric(14,2) >= 0, prep_minutes int default 10 check (between 0 and 600),
                    available boolean default true, archived_at, created_at, updated_at)
customers          (id, shop_id, name text, phone text, note text, created_at, updated_at,
                    unique(shop_id, phone) where phone is not null)
```

`customers` is readable by owner and staff only (it holds phone numbers).

### 3.3 Orders (what to make: visible to kitchen)

```sql
orders (
  id uuid primary key,                         -- generated on the device (idempotency key)
  shop_id uuid not null references shops on delete cascade,
  order_date date not null,                    -- shop-local date at creation
  order_no int not null,                       -- per shop per day, assigned by the server
  order_code text not null,                    -- display code such as 'A-023'
  type order_type not null,
  status order_status not null default 'new',
  label text,                                  -- call-out name or table, shown to kitchen (max 40)
  channel order_channel not null default 'walk_in',
  note text,                                   -- max 500
  customer_id uuid references customers,
  assigned_to uuid references auth.users,      -- courier (delivery) or technician (repair)
  due_at timestamptz,                          -- promised time
  settle_later boolean not null default false,
  version int not null default 1,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz, ready_at timestamptz, completed_at timestamptz,
  cancelled_at timestamptz, cancel_reason text check (char_length(cancel_reason) <= 200),
  unique (shop_id, order_date, order_no),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'completed') = (completed_at is not null))
);

order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders on delete cascade,
  shop_id uuid not null references shops on delete cascade,
  item_id uuid references catalog_items,       -- null for free-text lines (repair parts, special requests)
  name text not null check (char_length(name) between 1 and 120),   -- snapshot
  qty numeric(10,2) not null check (qty > 0 and qty <= 10000),
  note text check (char_length(note) <= 200)
);
```

### 3.4 Money and contact (separate, protected)

```sql
order_item_prices (order_item_id uuid pk -> order_items on delete cascade,
                   shop_id, order_id, unit_price numeric(14,2) not null check (unit_price >= 0))
order_money  (order_id uuid pk -> orders on delete cascade, shop_id,
              subtotal numeric(14,2), delivery_fee numeric(14,2) default 0,
              total numeric(14,2), paid_amount numeric(14,2) default 0,   -- paid_amount maintained by trigger only
              check (total = subtotal + delivery_fee), check (paid_amount >= 0))
order_contacts (order_id uuid pk -> orders on delete cascade, shop_id,
              phone text check (char_length(phone) <= 30),
              address text check (char_length(address) <= 300),
              address_note text check (char_length(address_note) <= 200),
              tracking_token text unique not null)       -- 128-bit random, base64url; never shown to kitchen
order_payments (id uuid pk, order_id, shop_id, kind payment_kind, amount numeric(14,2) check (amount > 0),
              method pay_method, note text, client_id uuid, created_by, created_at,
              unique (shop_id, client_id))               -- append-only
```

### 3.5 Timeline and repair

```sql
order_events (id bigint identity pk, order_id, shop_id, type event_type, from_status order_status,
              to_status order_status, actor uuid, client_id uuid, meta jsonb, created_at,
              unique (shop_id, client_id) where client_id is not null)   -- append-only
repair_jobs  (order_id uuid pk -> orders, shop_id, device text not null, problem text not null,
              serial text, approved_total numeric(14,2), approved_at timestamptz, approved_by uuid,
              diagnosis text, pickup_code_hash bytea not null,
              handed_over_at timestamptz, handover_override boolean default false)
order_transitions (order_type, from_status, to_status, roles member_role[], pk(order_type, from_status, to_status))
```

`order_transitions` is seeded in the migration from the table in `02-technical-requirements.md` section 5. A test asserts the seed equals `domain/status.ts`.

## 4. Helper functions (used by policies and RPCs)

```sql
create function public.my_role(p_shop uuid) returns member_role
language sql stable security definer set search_path = '' as $$
  select role from public.shop_members where shop_id = p_shop and user_id = (select auth.uid());
$$;
create function public.is_member(p_shop uuid) returns boolean ...      -- exists membership
create function public.has_role(p_shop uuid, p_roles member_role[]) returns boolean ...
create function public.can_see_order(p_shop uuid, p_assigned uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.my_role(p_shop)
           when 'owner' then true when 'staff' then true when 'kitchen' then true
           when 'courier' then p_assigned = (select auth.uid())
           else false end;
$$;
create function public.can_see_sensitive(p_shop uuid, p_assigned uuid) returns boolean   -- contact, money
language sql stable security definer set search_path = '' as $$
  select case public.my_role(p_shop)
           when 'owner' then true when 'staff' then true
           when 'courier' then p_assigned = (select auth.uid())
           else false end;                                   -- kitchen: false
$$;
```

Policies call these helpers with `(select auth.uid())` so the user id is evaluated once per query. Every column used in a policy (`shop_id`, `assigned_to`) is indexed.

## 5. Row level security matrix

Actors: **anon** (not signed in), **outsider** (signed in, not in this shop), **owner**, **staff**, **kitchen**, **courier (assigned)**, **courier (other)**. R = select, W = no direct write (RPC only).

| Table | anon | outsider | owner | staff | kitchen | courier (assigned / other) |
|-------|------|----------|-------|-------|---------|----------------------------|
| profiles | none | self | self | self | self | self |
| shops | none | none | R, update settings | R | R | R |
| shop_members | none | none | R, remove non-owner | R | R | R |
| shop_invites | none | none | R | none | none | none |
| audit_log | none | none | R | none | none | none |
| catalog_categories / catalog_items | none | none | R, insert, update | R | R (available items) | R / R |
| customers | none | none | R, insert, update | R, insert, update | none | none |
| orders | none | none | R | R | R | R assigned / none |
| order_items | none | none | R | R | R | R assigned / none |
| order_item_prices | none | none | R | R | **none** | none |
| order_money | none | none | R | R | **none** | R assigned / none |
| order_contacts | none | none | R | R | **none** | R assigned / none |
| order_payments | none | none | R | R | none | R assigned / none |
| order_events | none | none | R | R | none | R assigned / none |
| repair_jobs | none | none | R | R | R (device, problem; no codes) via view | R assigned / none |
| order_transitions | none | R | R | R | R | R |
| shop_memory | none | none | R, W | R | none | none |
| ai_usage | none | none | R | none | none | none |
| rate_limits, order_counters | none | none | none | none | none | none |

"W" for every business table is **no direct client write**: all inserts, updates and deletes happen inside RPC functions. Direct writes allowed by policy and column grants: catalog (owner), customers (owner, staff), shop settings (owner), shop_memory (owner), profile (self).

`repair_jobs` stores the pickup code hash; kitchen reads a view `repair_jobs_kitchen` (device, problem, diagnosis only).

## 6. RPC functions (one transaction each)

All validate arguments, check the caller's role, call `rate_limit_hit`, are idempotent, and write an event. Errors are short codes (`FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `INVALID_TRANSITION`, `OVERPAYMENT`, `RATE_LIMITED`).

| Function | Who | What it does |
|----------|-----|--------------|
| `create_order(shop, id, type, label, channel, note, due_at, items jsonb, contact jsonb, delivery_fee, customer, repair jsonb)` | owner, staff | Validates; prices lines from the catalog (owner or staff may enter free-text prices; only the owner may override a catalog price); assigns `order_no` and `order_code` through `next_order_no`; inserts order, items, prices, money, contact (with tracking token), repair job (with pickup code hash), `created` event; returns the order. Replay with the same `id` returns it unchanged |
| `edit_order(shop, order, client_id, expected_version, items, note, due_at, contact, settle_later)` | owner, staff | Allowed until `ready`. Replaces lines, recomputes money, stores the previous version in the event meta. Raises `OVERPAYMENT` if paid exceeds the new total; for repair, a total above `approved_total` moves the order to `waiting` |
| `advance_order(shop, order, to_status, expected_from, client_id)` | by transition table | Checks transition and role; courier only on assigned orders; delivery needs `assigned_to` before `out_for_delivery`; `completed` needs balance zero or `settle_later`; sets timestamps and bumps `version`; appends a `status_changed` event. Raises `CONFLICT` when the current status is not `expected_from` |
| `assign_order(shop, order, user, client_id)` | owner, staff | Assignee must be a courier (delivery) or staff/owner (repair); event |
| `cancel_order(shop, order, reason, client_id)` | owner, staff | Not for final statuses; reason 3 to 200 characters; event records money paid so far |
| `record_payment(shop, order, client_id, kind, amount, method, note)` | owner, staff; courier for assigned delivery (kind `payment`, cash) | Locks the order; `OVERPAYMENT` if above balance; refunds owner only with a note and at most the paid amount; inserts payment; trigger updates `order_money.paid_amount`; event |
| `approve_estimate(shop, order, client_id, total)` | owner, staff | Repair only; sets `approved_total`, time and user; event |
| `handover_order(shop, order, code, override, client_id)` | owner, staff | Repair only; checks the code hash or owner override (recorded); requires balance zero or `settle_later`; completes the order |
| `create_invite(shop, role)` / `accept_invite(code)` | owner / signed-in user | One-time code, hash stored, 48 h expiry |
| `create_shop(name, business_type, locale, timezone)` | signed-in user | Creates shop, owner membership, sample catalog by type |
| `delete_shop(shop)` | owner | Removes the shop and all data (sets a transaction flag so append-only triggers allow cascade) |
| `dashboard_summary`, `top_items`, `orders_by_hour`, `late_orders`, `repair_turnaround` | owner (summary also staff without profit) | Read-only reports from ledgers |
| `track_order(token)` | **service role only** (called by the tracking Edge Function) | Returns shop name, business type, order code, status, due time, last update. Nothing else |

`next_order_no(shop, date)` is internal: an atomic upsert on `order_counters` returning the next number.

Sample sketch of the central function:

```sql
create function public.advance_order(p_shop uuid, p_order uuid, p_to public.order_status,
                                     p_expected_from public.order_status, p_client_id uuid)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare v_o public.orders; v_role public.member_role := public.my_role(p_shop); v_uid uuid := (select auth.uid());
begin
  if v_role is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.rate_limit_hit('rpc:' || v_uid, 240, 60);
  if exists (select 1 from public.order_events where shop_id = p_shop and client_id = p_client_id) then
    select * into v_o from public.orders where id = p_order and shop_id = p_shop; return v_o;      -- replay
  end if;
  select * into v_o from public.orders where id = p_order and shop_id = p_shop for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_o.status <> p_expected_from then raise exception 'CONFLICT'; end if;
  if not exists (select 1 from public.order_transitions t
                  where t.order_type = v_o.type and t.from_status = v_o.status
                    and t.to_status = p_to and v_role = any (t.roles)) then
    raise exception 'INVALID_TRANSITION';
  end if;
  if v_role = 'courier' and v_o.assigned_to is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
  -- delivery needs a courier; completion needs balance zero or settle_later (read from order_money)
  ...
  update public.orders set status = p_to, version = version + 1, updated_at = now(),
         accepted_at = case when p_to = 'accepted' then now() else accepted_at end,
         ready_at = case when p_to = 'ready' then now() else ready_at end,
         completed_at = case when p_to = 'completed' then now() else completed_at end
   where id = v_o.id returning * into v_o;
  insert into public.order_events (order_id, shop_id, type, from_status, to_status, actor, client_id)
  values (v_o.id, p_shop, 'status_changed', p_expected_from, p_to, v_uid, p_client_id);
  return v_o;
end $$;
```

## 7. Triggers and constraints

| Trigger | Purpose |
|---------|---------|
| `order_payments_apply` (after insert) | The only code that writes `order_money.paid_amount` (payments and deposits add, refunds subtract) |
| `immutable` on `order_events`, `order_payments` | Block UPDATE and DELETE (allowed only inside `delete_shop`) |
| `orders_updated_at` | Keeps `updated_at` honest |
| `orders_guard` (before update) | Blocks changes to `shop_id`, `order_no`, `order_date`, `created_by`; status changes allowed only when the RPC sets a transaction flag, so direct updates cannot bypass the status machine |
| `audit_*` | Price changes, role changes, member removal, refunds, overrides |

Privileges: `revoke all` on every table from `anon` and `authenticated`, then grant select where the matrix allows and column-level insert/update only for catalog, customers, shop settings, shop_memory and profile.

## 8. Indexes

```sql
create index orders_open_idx       on orders (shop_id, status, due_at) where status not in ('completed','cancelled');
create index orders_recent_idx     on orders (shop_id, created_at desc);
create index orders_courier_idx    on orders (shop_id, assigned_to, status) where assigned_to is not null;
create index order_items_order_idx on order_items (order_id);
create index order_events_order_idx on order_events (order_id, created_at);
create index order_payments_order_idx on order_payments (order_id);
create index customers_phone_idx   on customers (shop_id, phone);
create index customers_name_idx    on customers (shop_id, name text_pattern_ops);
create index shop_members_user_idx on shop_members (user_id);
```

## 9. Realtime

`orders`, `order_items`, `order_money`, `order_events` are in the realtime publication. Clients subscribe filtered by `shop_id`. Realtime applies the same RLS, so kitchen receives no money or contact rows and couriers receive only their assigned orders. Tables are never published if they contain data a role must not see.

## 10. Invariants (checked nightly and in tests)

1. Every order has exactly one `created` event.
2. `order_money.paid_amount` equals payments plus deposits minus refunds.
3. `order_money.total` equals the sum of line totals plus the delivery fee.
4. `(shop_id, order_date, order_no)` is unique and day numbers have no duplicates.
5. Every status in the timeline follows a legal transition for that order type.
6. Completed orders have `completed_at`; cancelled orders have a reason.
7. Completed orders have a zero balance unless `settle_later` is set.
8. Repair orders in `completed` have a handover event (code or recorded override).
9. No role can read a table the matrix denies (RLS test).

## 11. Retention and deletion

- Orders and events are kept while the shop exists. History pulls to devices are limited to recent orders; older history is fetched on demand.
- Deleting a shop removes everything (cascade). Deleting a customer clears the link and personal fields on their orders' contacts when the owner requests it; the money history stays.
- Tracking tokens stop working when the order is cancelled for more than 30 days or completed for more than 60 days (configurable).

## 12. Migration plan

| Migration | Contents |
|-----------|----------|
| 0001 | Enums, privileges default, helpers, rate limiter, immutability trigger |
| 0002 | profiles, shops, members, invites, audit, create_shop, invites, delete_shop |
| 0003 | catalog, customers |
| 0004 | orders, items, prices, money, contacts, counters, transitions, create_order, edit_order |
| 0005 | events, status machine, advance_order, assign_order, cancel_order, conflicts |
| 0006 | payments, record_payment, refunds |
| 0007 | repair_jobs, approve_estimate, handover_order |
| 0008 | reports |
| 0009 | memory, ai_usage, track_order |
| 0010 | realtime publication, lockdown, invariants job |
