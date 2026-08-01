-- Additive: timesheet sync tables only.
-- Paste into Supabase SQL Editor if full script already applied earlier.

create extension if not exists "pgcrypto";

create table if not exists public.crm_employees (
  id uuid primary key default gen_random_uuid(),
  crm_id bigint,
  full_name text not null,
  position text not null default 'официант',
  hourly_rate numeric(10,2) not null default 750,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_employees_full_name_idx on public.crm_employees (full_name);
create index if not exists crm_employees_crm_id_idx on public.crm_employees (crm_id);
create index if not exists crm_employees_deleted_at_idx on public.crm_employees (deleted_at);
create index if not exists crm_employees_updated_at_idx on public.crm_employees (updated_at desc);

create table if not exists public.crm_timesheet_shifts (
  id uuid primary key default gen_random_uuid(),
  crm_id bigint,
  employee_cloud_id uuid,
  employee_name text,
  work_date date not null,
  start_time text not null,
  end_time text not null,
  workplace text not null,
  hourly_rate numeric(10,2) not null default 750,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_timesheet_shifts_work_date_idx on public.crm_timesheet_shifts (work_date desc);
create index if not exists crm_timesheet_shifts_crm_id_idx on public.crm_timesheet_shifts (crm_id);
create index if not exists crm_timesheet_shifts_employee_idx on public.crm_timesheet_shifts (employee_cloud_id);
create index if not exists crm_timesheet_shifts_deleted_at_idx on public.crm_timesheet_shifts (deleted_at);
create index if not exists crm_timesheet_shifts_updated_at_idx on public.crm_timesheet_shifts (updated_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['crm_employees', 'crm_timesheet_shifts']
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

do $$ begin
  alter publication supabase_realtime add table public.crm_employees;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.crm_timesheet_shifts;
exception when duplicate_object then null;
end $$;
