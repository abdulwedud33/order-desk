-- 0003_catalog_customers.sql
-- Catalog categories, items, and customers.
-- Rules: docs/05-backend-schema.md, docs/security.md sections 4 and 5.

create table public.catalog_categories (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  unique (shop_id, name)
);
create index catalog_categories_shop_idx on public.catalog_categories (shop_id, sort);

create table public.catalog_items (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops on delete cascade,
  category_id  uuid references public.catalog_categories on delete set null,
  name         text not null check (char_length(name) between 1 and 120),
  kind         text not null default 'item' check (kind in ('item', 'service')),
  price        numeric(14,2) not null check (price >= 0),
  prep_minutes int not null default 10 check (prep_minutes between 0 and 600),
  available    boolean not null default true,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index catalog_items_shop_idx on public.catalog_items (shop_id, archived_at, available);
create index catalog_items_category_idx on public.catalog_items (category_id);

create table public.customers (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  phone      text check (char_length(phone) <= 30),
  note       text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_phone_uidx on public.customers (shop_id, phone) where phone is not null;
create index customers_name_idx on public.customers (shop_id, name text_pattern_ops);
create index customers_phone_idx on public.customers (shop_id, phone);

-- Triggers for updated_at
create trigger catalog_items_updated_at before update on public.catalog_items
  for each row execute function public.set_updated_at();

create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------- RLS: enabled on every table in this migration ----------
alter table public.catalog_categories enable row level security;
alter table public.catalog_items      enable row level security;
alter table public.customers          enable row level security;

-- catalog_categories: members can select, owners can insert/update/delete
create policy catalog_categories_select on public.catalog_categories for select to authenticated
  using (public.is_member(shop_id));
create policy catalog_categories_insert on public.catalog_categories for insert to authenticated
  with check (public.is_owner(shop_id));
create policy catalog_categories_update on public.catalog_categories for update to authenticated
  using (public.is_owner(shop_id)) with check (public.is_owner(shop_id));
create policy catalog_categories_delete on public.catalog_categories for delete to authenticated
  using (public.is_owner(shop_id));

-- catalog_items: members can select (kitchen sees available only); owner can insert/update
create policy catalog_items_select on public.catalog_items for select to authenticated
  using (
    public.is_member(shop_id)
    and (public.my_role(shop_id) <> 'kitchen' or available = true)
    and archived_at is null
  );
create policy catalog_items_insert on public.catalog_items for insert to authenticated
  with check (public.is_owner(shop_id));
create policy catalog_items_update on public.catalog_items for update to authenticated
  using (public.is_owner(shop_id)) with check (public.is_owner(shop_id));

-- customers: owner and staff only (kitchen & courier cannot read or write customer contacts)
create policy customers_select on public.customers for select to authenticated
  using (public.is_member(shop_id) and public.my_role(shop_id) in ('owner', 'staff'));
create policy customers_insert on public.customers for insert to authenticated
  with check (public.is_member(shop_id) and public.my_role(shop_id) in ('owner', 'staff'));
create policy customers_update on public.customers for update to authenticated
  using (public.is_member(shop_id) and public.my_role(shop_id) in ('owner', 'staff'))
  with check (public.is_member(shop_id) and public.my_role(shop_id) in ('owner', 'staff'));

-- ---------- Column Grants ----------
grant select on public.catalog_categories to authenticated;
grant insert (id, shop_id, name, sort), update (name, sort), delete on public.catalog_categories to authenticated;

grant select on public.catalog_items to authenticated;
grant insert (id, shop_id, category_id, name, kind, price, prep_minutes, available),
      update (category_id, name, kind, price, prep_minutes, available, archived_at) on public.catalog_items to authenticated;

grant select on public.customers to authenticated;
grant insert (id, shop_id, name, phone, note),
      update (name, phone, note) on public.customers to authenticated;
