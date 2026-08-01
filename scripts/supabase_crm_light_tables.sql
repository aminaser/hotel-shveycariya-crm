-- CRM lightweight tables mirrored to Supabase for multi-PC sync.
-- Run in Supabase SQL Editor if not applied automatically.

create extension if not exists "pgcrypto";

create table if not exists public.crm_banquets (
  id uuid primary key default gen_random_uuid(),
  crm_id bigint,
  event_date date not null,
  event_time text,
  guest_name text not null,
  phone text,
  venue text,
  people_count integer not null default 1,
  event_type text,
  prepayment numeric(12,2) not null default 0,
  payment_amount numeric(12,2) not null default 0,
  payment_status text not null default 'unpaid',
  payment_method text,
  payment_date date,
  dishes text,
  notes text,
  deleted_at timestamptz,
  created_by_name text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_banquets_event_date_idx on public.crm_banquets (event_date desc);
create index if not exists crm_banquets_crm_id_idx on public.crm_banquets (crm_id);
create index if not exists crm_banquets_deleted_at_idx on public.crm_banquets (deleted_at);

create table if not exists public.crm_takeaway_orders (
  id uuid primary key default gen_random_uuid(),
  crm_id bigint,
  order_date date not null,
  order_time text,
  guest_name text not null,
  phone text,
  prepayment numeric(12,2) not null default 0,
  payment_method text,
  payment_date date,
  dishes text,
  notes text,
  deleted_at timestamptz,
  created_by_name text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_takeaway_orders_order_date_idx on public.crm_takeaway_orders (order_date desc);
create index if not exists crm_takeaway_orders_crm_id_idx on public.crm_takeaway_orders (crm_id);
create index if not exists crm_takeaway_orders_deleted_at_idx on public.crm_takeaway_orders (deleted_at);

-- Allow CRM desktop (anon key) to read/write — same model as spa_bookings.
alter table public.crm_banquets enable row level security;
alter table public.crm_takeaway_orders enable row level security;

drop policy if exists "crm_banquets_all" on public.crm_banquets;
create policy "crm_banquets_all" on public.crm_banquets
  for all using (true) with check (true);

drop policy if exists "crm_takeaway_orders_all" on public.crm_takeaway_orders;
create policy "crm_takeaway_orders_all" on public.crm_takeaway_orders
  for all using (true) with check (true);

grant select, insert, update, delete on public.crm_banquets to anon, authenticated;
grant select, insert, update, delete on public.crm_takeaway_orders to anon, authenticated;

-- Safe upgrades if an earlier version of the table already exists.
alter table public.crm_banquets add column if not exists payment_amount numeric(12,2) not null default 0;
alter table public.crm_banquets add column if not exists payment_status text not null default 'unpaid';

-- Realtime so other CRM desktops refresh when someone adds a row.
do $$ begin
  alter publication supabase_realtime add table public.crm_banquets;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.crm_takeaway_orders;
exception when duplicate_object then null;
end $$;
