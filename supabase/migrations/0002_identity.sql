-- 0002_identity.sql
-- profiles, shops, shop_members, shop_invites, audit_log, helper functions, RLS, RPCs.
-- Rules: docs/05-backend-schema.md, docs/security.md sections 4 and 5.

create table public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  full_name  text check (char_length(full_name) <= 100),
  phone      text check (char_length(phone) <= 30),
  locale     text not null default 'en' check (locale in ('en', 'am', 'om')),
  created_at timestamptz not null default now()
);

create table public.shops (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references auth.users,
  name                 text not null check (char_length(name) between 1 and 80),
  business_type        public.business_type not null default 'food',
  currency             char(3) not null default 'ETB' check (currency ~ '^[A-Z]{3}$'),
  locale               text not null default 'en' check (locale in ('en', 'am', 'om')),
  timezone             text not null default 'Africa/Addis_Ababa',
  default_delivery_fee numeric(14,2) not null default 0 check (default_delivery_fee >= 0),
  late_grace_minutes   int not null default 0 check (late_grace_minutes >= 0),
  require_pickup_code  boolean not null default true,
  created_at           timestamptz not null default now()
);

create table public.shop_members (
  shop_id      uuid not null references public.shops on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         public.member_role not null,
  display_name text check (char_length(display_name) <= 60),
  created_at   timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create index shop_members_user_idx on public.shop_members (user_id);
create index shops_owner_idx on public.shops (owner_id);

create table public.shop_invites (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops on delete cascade,
  code_hash  bytea not null unique,
  role       public.member_role not null check (role <> 'owner'),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users,
  used_at    timestamptz,
  used_by    uuid references auth.users,
  created_at timestamptz not null default now()
);
create index shop_invites_shop_idx on public.shop_invites (shop_id);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  shop_id    uuid not null references public.shops on delete cascade,
  actor      uuid,
  action     text not null,
  entity     text,
  entity_id  uuid,
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_shop_idx on public.audit_log (shop_id, created_at desc);

-- ---------- Helper functions (security definer to avoid recursion) ----------
create function public.my_role(p_shop uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select role from public.shop_members where shop_id = p_shop and user_id = (select auth.uid());
$$;

create function public.is_member(p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shop_members where shop_id = p_shop and user_id = (select auth.uid())
  );
$$;

create function public.is_owner(p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shop_members where shop_id = p_shop and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

create function public.has_role(p_shop uuid, p_roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shop_members
    where shop_id = p_shop and user_id = (select auth.uid()) and role = any (p_roles)
  );
$$;

create function public.has_role(p_shop uuid, p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role(p_shop, array[p_role::public.member_role]);
$$;

create function public.has_role(p_shop uuid, p_role public.member_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role(p_shop, array[p_role]);
$$;

create function public.can_see_order(p_shop uuid, p_assigned uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.my_role(p_shop)
           when 'owner' then true
           when 'staff' then true
           when 'kitchen' then true
           when 'courier' then p_assigned = (select auth.uid())
           else false end;
$$;

create function public.can_see_sensitive(p_shop uuid, p_assigned uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.my_role(p_shop)
           when 'owner' then true
           when 'staff' then true
           when 'courier' then p_assigned = (select auth.uid())
           else false end;
$$;

revoke all on function public.my_role(uuid), public.is_member(uuid), public.is_owner(uuid),
                       public.has_role(uuid, public.member_role[]),
                       public.has_role(uuid, text),
                       public.has_role(uuid, public.member_role),
                       public.can_see_order(uuid, uuid), public.can_see_sensitive(uuid, uuid) from public, anon;
grant execute on function public.my_role(uuid), public.is_member(uuid), public.is_owner(uuid),
                          public.has_role(uuid, public.member_role[]),
                          public.has_role(uuid, text),
                          public.has_role(uuid, public.member_role),
                          public.can_see_order(uuid, uuid), public.can_see_sensitive(uuid, uuid) to authenticated;

-- Internal audit writer
create function public.write_audit(p_shop uuid, p_action text, p_entity text, p_entity_id uuid, p_meta jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (shop_id, actor, action, entity, entity_id, meta)
  values (p_shop, (select auth.uid()), p_action, p_entity, p_entity_id, p_meta);
$$;
revoke all on function public.write_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- ---------- Row Level Security ----------
alter table public.profiles     enable row level security;
alter table public.shops        enable row level security;
alter table public.shop_members enable row level security;
alter table public.shop_invites enable row level security;
alter table public.audit_log    enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy shops_select on public.shops for select to authenticated
  using (public.is_member(id));
create policy shops_update on public.shops for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

create policy members_select on public.shop_members for select to authenticated
  using (public.is_member(shop_id));
create policy members_delete on public.shop_members for delete to authenticated
  using (public.is_owner(shop_id) and role <> 'owner');

create policy invites_select on public.shop_invites for select to authenticated
  using (public.is_owner(shop_id));

create policy audit_select on public.audit_log for select to authenticated
  using (public.is_owner(shop_id));

-- ---------- Column Grants ----------
grant select on public.profiles to authenticated;
grant insert (id, full_name, phone, locale) on public.profiles to authenticated;
grant update (full_name, phone, locale) on public.profiles to authenticated;

grant select on public.shops to authenticated;
grant update (name, locale, timezone, default_delivery_fee, late_grace_minutes, require_pickup_code) on public.shops to authenticated;

grant select, delete on public.shop_members to authenticated;
grant select (id, shop_id, role, expires_at, created_by, used_at, created_at) on public.shop_invites to authenticated;
grant select on public.audit_log to authenticated;

-- ---------- Triggers ----------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, locale)
  values (
    new.id,
    left(new.raw_user_meta_data ->> 'full_name', 100),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'en')
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.audit_member_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.shop_deletion', true) = 'on' then return old; end if;
  perform public.write_audit(old.shop_id, 'member_removed', 'shop_member', null,
                             jsonb_build_object('user_id', old.user_id, 'role', old.role));
  return old;
end $$;
create trigger shop_members_audit_delete after delete on public.shop_members
  for each row execute function public.audit_member_delete();

-- ---------- RPC Functions ----------
create function public.create_shop(
  p_name          text,
  p_business_type public.business_type default 'food',
  p_locale        text default 'en',
  p_timezone      text default 'Africa/Addis_Ababa'
)
returns public.shops
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_shop public.shops;
  v_name text := btrim(coalesce(p_name, ''));
  v_cat_id uuid;
begin
  if v_uid is null then raise exception 'SESSION_EXPIRED' using errcode = '42501'; end if;
  perform public.rate_limit_hit('create_shop:' || v_uid, 5, 3600);
  if char_length(v_name) not between 1 and 80
     or p_locale not in ('en', 'am', 'om')
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception 'VALIDATION' using errcode = '22023';
  end if;

  insert into public.shops (owner_id, name, business_type, locale, timezone)
  values (v_uid, v_name, p_business_type, p_locale, p_timezone)
  returning * into v_shop;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop.id, v_uid, 'owner');

  -- When catalog tables are created in M2, seed sample catalog automatically
  if to_regclass('public.catalog_categories') is not null and to_regclass('public.catalog_items') is not null then
    if p_business_type = 'food' then
      execute 'insert into public.catalog_categories (shop_id, name, sort) values ($1, $2, 1) returning id'
        into v_cat_id using v_shop.id, 'Main Dishes';
      execute 'insert into public.catalog_items (shop_id, category_id, name, kind, price, prep_minutes) values ' ||
              '($1, $2, ''Shiro Tegamino'', ''item'', 150.00, 15), ' ||
              '($1, $2, ''Special Tibs'', ''item'', 320.00, 20), ' ||
              '($1, $2, ''Beyeaynetu'', ''item'', 180.00, 15)'
        using v_shop.id, v_cat_id;
    elsif p_business_type = 'repair' then
      execute 'insert into public.catalog_categories (shop_id, name, sort) values ($1, $2, 1) returning id'
        into v_cat_id using v_shop.id, 'Diagnostics & Repairs';
      execute 'insert into public.catalog_items (shop_id, category_id, name, kind, price, prep_minutes) values ' ||
              '($1, $2, ''Screen Replacement'', ''service'', 1200.00, 60), ' ||
              '($1, $2, ''Battery Replacement'', ''service'', 650.00, 30), ' ||
              '($1, $2, ''Diagnostics Fee'', ''service'', 200.00, 20)'
        using v_shop.id, v_cat_id;
    elsif p_business_type = 'delivery' then
      execute 'insert into public.catalog_categories (shop_id, name, sort) values ($1, $2, 1) returning id'
        into v_cat_id using v_shop.id, 'Delivery Services';
      execute 'insert into public.catalog_items (shop_id, category_id, name, kind, price, prep_minutes) values ' ||
              '($1, $2, ''Standard Delivery'', ''service'', 100.00, 30), ' ||
              '($1, $2, ''Express Delivery'', ''service'', 200.00, 15)'
        using v_shop.id, v_cat_id;
    end if;
  end if;

  perform public.write_audit(v_shop.id, 'shop_created', 'shop', v_shop.id, jsonb_build_object('business_type', p_business_type));
  return v_shop;
end $$;

-- Owner creates a single-use, 48h expiring invite code. Only the SHA-256 hash is stored.
create function public.create_invite(
  p_shop uuid,
  p_role public.member_role
)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_code text;
begin
  if not public.is_owner(p_shop) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.rate_limit_hit('invite_create:' || v_uid, 10, 3600);
  if p_role = 'owner' then raise exception 'VALIDATION' using errcode = '22023'; end if;

  if (select count(*) from public.shop_invites i
      where i.shop_id = p_shop and i.used_at is null and i.expires_at > now()) >= 10 then
    raise exception 'LIMIT_EXCEEDED' using errcode = 'P0001';
  end if;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  insert into public.shop_invites (shop_id, code_hash, role, expires_at, created_by)
  values (p_shop, sha256(convert_to(v_code, 'UTF8')), p_role, now() + interval '48 hours', v_uid);

  perform public.write_audit(p_shop, 'invite_created', 'shop_invite', null, jsonb_build_object('role', p_role));
  return v_code;
end $$;

-- Signed-in user joins a shop with invite code. Generic failure so codes cannot be probed.
create function public.accept_invite(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_inv  public.shop_invites;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if v_uid is null then raise exception 'SESSION_EXPIRED' using errcode = '42501'; end if;
  perform public.rate_limit_hit('invite_accept:' || v_uid, 10, 900);
  if v_code !~ '^[0-9A-F]{16}$' then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  select * into v_inv from public.shop_invites i
   where i.code_hash = sha256(convert_to(v_code, 'UTF8'))
     and i.used_at is null
     and i.expires_at > now()
   for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_inv.shop_id, v_uid, v_inv.role)
  on conflict (shop_id, user_id) do nothing;

  update public.shop_invites set used_at = now(), used_by = v_uid where id = v_inv.id;
  perform public.write_audit(v_inv.shop_id, 'invite_accepted', 'shop_invite', v_inv.id, null);
  return v_inv.shop_id;
end $$;

-- Delete shop: owner cascade deletes everything in the shop.
create function public.delete_shop(p_shop uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner(p_shop) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.rate_limit_hit('delete_shop:' || (select auth.uid()), 3, 3600);
  perform set_config('app.shop_deletion', 'on', true);
  delete from public.shops where id = p_shop;
end $$;

revoke all on function public.create_shop(text, public.business_type, text, text),
                       public.create_invite(uuid, public.member_role),
                       public.accept_invite(text),
                       public.delete_shop(uuid) from public, anon;
grant execute on function public.create_shop(text, public.business_type, text, text),
                          public.create_invite(uuid, public.member_role),
                          public.accept_invite(text),
                          public.delete_shop(uuid) to authenticated;
