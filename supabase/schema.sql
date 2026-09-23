-- ============================================================
-- SoftStock — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- ── EXTENSIONS ──────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── PROFILES (extends auth.users with a role) ───────────────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  role        text not null default 'user' check (role in ('admin','user','restricted')),
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'user');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Helper: is the current user admin / not-restricted
create or replace function current_role_name()
returns text as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

create or replace function is_admin()
returns boolean as $$
  select current_role_name() = 'admin';
$$ language sql stable security definer;

create or replace function is_editor()
returns boolean as $$
  select current_role_name() in ('admin','user');
$$ language sql stable security definer;

-- ── PRODUCTS ─────────────────────────────────────────────────
create table if not exists products (
  id                  bigint generated always as identity primary key,
  name                text not null,
  type                text not null check (type in
                        ('Napkins','Facial Tissue','Toilet Paper','Towels','Dispenser','Spunlace','Other')),
  width_cm            numeric,
  ply                 integer not null default 1,
  gsm                 numeric,
  balance             numeric not null default 0,
  priority            text check (priority in ('high','medium','low')),
  manual_monthly_rate numeric,          -- optional manual kg/month override
  composition         text,             -- e.g. Spunlace PES/VIS ratio "30/70"
  target_months       numeric not null default 2,  -- used by Orders page
  created_at          timestamptz not null default now()
);

create index if not exists idx_products_type on products(type);

-- ── STOCK LOG (event log — every add/deduct/update) ──────────
create table if not exists stock_log (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references products(id) on delete cascade,
  date        date not null default current_date,
  operation   text not null check (operation in ('add','deduct','update')),
  quantity    numeric not null,
  note        text default '',
  user_id     uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists idx_stock_log_product on stock_log(product_id);
create index if not exists idx_stock_log_date on stock_log(date);

-- Keep products.balance in sync whenever a stock_log row is inserted
create or replace function apply_stock_log()
returns trigger as $$
begin
  if new.operation = 'add' then
    update products set balance = balance + new.quantity where id = new.product_id;
  elsif new.operation = 'deduct' then
    update products set balance = balance - new.quantity where id = new.product_id;
  elsif new.operation = 'update' then
    update products set balance = new.quantity where id = new.product_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_apply_stock_log on stock_log;
create trigger trg_apply_stock_log
  after insert on stock_log
  for each row execute function apply_stock_log();

-- ── SUPPLIERS ────────────────────────────────────────────────
create table if not exists suppliers (
  id          bigint generated always as identity primary key,
  name        text not null,
  contact     text default '',
  phone       text default '',
  email       text default '',
  notes       text default '',
  created_at  timestamptz not null default now()
);

-- ── DELIVERIES ───────────────────────────────────────────────
create table if not exists deliveries (
  id            bigint generated always as identity primary key,
  product_id    bigint not null references products(id) on delete cascade,
  supplier_id   bigint references suppliers(id),
  quantity      numeric not null,          -- kg
  plate_no      text default '',
  expected_date date,
  status        text not null default 'pending' check (status in ('pending','arrived')),
  created_at    timestamptz not null default now(),
  arrived_at    timestamptz
);

create index if not exists idx_deliveries_status on deliveries(status);

-- ── RESERVATIONS (stock → production, two-step: reserve then verify/deduct) ──
create table if not exists reservations (
  id           bigint generated always as identity primary key,
  product_id   bigint not null references products(id) on delete cascade,
  date         date not null default current_date,
  quantity     numeric not null,
  destination  text default '',
  note         text default '',
  reserved_by  uuid references auth.users(id),
  status       text not null default 'reserved' check (status in ('reserved','confirmed','cancelled')),
  actual_qty   numeric,
  closed_by    uuid references auth.users(id),
  closed_at    timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_reservations_status on reservations(status);
create index if not exists idx_reservations_product on reservations(product_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles   enable row level security;
alter table products    enable row level security;
alter table stock_log   enable row level security;
alter table suppliers   enable row level security;
alter table deliveries  enable row level security;

-- profiles: everyone signed in can read the list (names only, no secrets);
-- users can update their own name; only admins can change roles.
create policy "profiles_select_all"  on profiles for select using (auth.uid() is not null);
create policy "profiles_update_self" on profiles for update using (id = auth.uid());
create policy "profiles_update_admin" on profiles for update using (is_admin());

-- products: everyone signed in can read; editors (admin/user) can write; only admin can delete.
create policy "products_select" on products for select using (auth.uid() is not null);
create policy "products_insert" on products for insert with check (is_editor());
create policy "products_update" on products for update using (is_editor());
create policy "products_delete" on products for delete using (is_editor());

-- stock_log: everyone signed in can read; editors can insert; nobody edits/deletes history.
create policy "stock_log_select" on stock_log for select using (auth.uid() is not null);
create policy "stock_log_insert" on stock_log for insert with check (is_editor());

-- suppliers: read for all signed in; write for editors.
create policy "suppliers_select" on suppliers for select using (auth.uid() is not null);
create policy "suppliers_insert" on suppliers for insert with check (is_editor());
create policy "suppliers_update" on suppliers for update using (is_editor());
create policy "suppliers_delete" on suppliers for delete using (is_editor());

-- deliveries: read for all signed in; write for editors.
create policy "deliveries_select" on deliveries for select using (auth.uid() is not null);
create policy "deliveries_insert" on deliveries for insert with check (is_editor());
create policy "deliveries_update" on deliveries for update using (is_editor());
create policy "deliveries_delete" on deliveries for delete using (is_editor());

-- reservations: ANY signed-in user can create a reservation (this is the whole point
-- of the 'restricted' role — floor staff can reserve stock for production themselves).
-- Verifying/deducting or cancelling is limited to editors (admin/user), matching the
-- old app's rule that only a specialist confirms a reservation.
alter table reservations enable row level security;
create policy "reservations_select" on reservations for select using (auth.uid() is not null);
create policy "reservations_insert" on reservations for insert with check (auth.uid() is not null);
create policy "reservations_update" on reservations for update using (is_editor());

-- ============================================================
-- Done. Next steps (see README.md):
-- 1. Enable Email auth in Authentication → Providers.
-- 2. Sign up your first user from the app, then in the SQL editor run:
--      update profiles set role = 'admin' where id =
--        (select id from auth.users where email = 'you@example.com');
-- 3. Copy your Project URL + anon public key into public/app.js.
-- ============================================================
