-- CRM multi-PC sync tables (SQLite mirrors ↔ Supabase).
-- Run in Supabase SQL Editor if MCP apply fails.

create extension if not exists "pgcrypto";

-- ─── Banquets ───────────────────────────────────────────────────────────────
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
create index if not exists crm_banquets_updated_at_idx on public.crm_banquets (updated_at desc);

alter table public.crm_banquets add column if not exists payment_amount numeric(12,2) not null default 0;
alter table public.crm_banquets add column if not exists payment_status text not null default 'unpaid';

-- ─── Takeaway ───────────────────────────────────────────────────────────────
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
create index if not exists crm_takeaway_orders_updated_at_idx on public.crm_takeaway_orders (updated_at desc);

-- ─── Clients ────────────────────────────────────────────────────────────────
create table if not exists public.crm_clients (
  id uuid primary key default gen_random_uuid(),
  crm_id bigint,
  full_name text not null,
  phone text,
  iin text,
  bin text,
  client_type text not null default 'individual',
  age integer,
  date_of_birth date,
  document_number text,
  notes text,
  deleted_at timestamptz,
  created_by_name text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_clients_full_name_idx on public.crm_clients (full_name);
create index if not exists crm_clients_crm_id_idx on public.crm_clients (crm_id);
create index if not exists crm_clients_updated_at_idx on public.crm_clients (updated_at desc);

-- ─── Rooms ──────────────────────────────────────────────────────────────────
create table if not exists public.crm_rooms (
  id uuid primary key default gen_random_uuid(),
  crm_id bigint,
  number text not null,
  floor integer,
  room_type text,
  price_per_night numeric(12,2),
  status text not null default 'free',
  notes text,
  status_updated_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (number)
);

create index if not exists crm_rooms_crm_id_idx on public.crm_rooms (crm_id);
create index if not exists crm_rooms_updated_at_idx on public.crm_rooms (updated_at desc);

-- ─── Stays (journal) ────────────────────────────────────────────────────────
create table if not exists public.crm_stays (
  id uuid primary key default gen_random_uuid(),
  crm_id bigint,
  client_cloud_id uuid,
  room_cloud_id uuid,
  room_number text,
  client_name text,
  record_date date not null,
  stay_type text not null,
  check_in date,
  planned_check_out date,
  check_out date,
  people_count integer not null default 1,
  payment_amount numeric(12,2) not null default 0,
  prepayment numeric(12,2) not null default 0,
  payment_status text not null default 'unpaid',
  payment_method text,
  payment_date date,
  group_id text,
  notes text,
  checked_in_at timestamptz,
  deleted_at timestamptz,
  created_by_name text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_stays_record_date_idx on public.crm_stays (record_date desc);
create index if not exists crm_stays_crm_id_idx on public.crm_stays (crm_id);
create index if not exists crm_stays_updated_at_idx on public.crm_stays (updated_at desc);
create index if not exists crm_stays_deleted_at_idx on public.crm_stays (deleted_at);

-- ─── Guest services (laundry etc.) ──────────────────────────────────────────
create table if not exists public.crm_guest_services (
  id uuid primary key default gen_random_uuid(),
  crm_id bigint,
  service_date date not null,
  service_type text not null,
  item_count integer not null default 1,
  unit_price numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,
  stay_cloud_id uuid,
  client_cloud_id uuid,
  room_cloud_id uuid,
  guest_name text not null,
  room_number text,
  payment_status text not null default 'unpaid',
  payment_method text,
  payment_date date,
  notes text,
  deleted_at timestamptz,
  created_by_name text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_guest_services_service_date_idx on public.crm_guest_services (service_date desc);
create index if not exists crm_guest_services_crm_id_idx on public.crm_guest_services (crm_id);
create index if not exists crm_guest_services_updated_at_idx on public.crm_guest_services (updated_at desc);

-- ─── RLS + grants ───────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_banquets', 'crm_takeaway_orders', 'crm_clients',
    'crm_rooms', 'crm_stays', 'crm_guest_services'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format(
      'create policy %I on public.%I for all using (true) with check (true)',
      t || '_all', t
    );
    execute format(
      'grant select, insert, update, delete on public.%I to anon, authenticated',
      t
    );
  end loop;
end $$;

-- Realtime
do $$ begin
  alter publication supabase_realtime add table public.crm_banquets;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.crm_takeaway_orders;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.crm_clients;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.crm_rooms;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.crm_stays;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.crm_guest_services;
exception when duplicate_object then null;
end $$;
