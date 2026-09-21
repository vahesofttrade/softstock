-- Adds the Reservations feature (stock → production, two-step reserve/verify).
-- Safe to run once.

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

alter table reservations enable row level security;

drop policy if exists "reservations_select" on reservations;
create policy "reservations_select" on reservations for select using (auth.uid() is not null);

drop policy if exists "reservations_insert" on reservations;
create policy "reservations_insert" on reservations for insert with check (auth.uid() is not null);

drop policy if exists "reservations_update" on reservations;
create policy "reservations_update" on reservations for update using (is_editor());
