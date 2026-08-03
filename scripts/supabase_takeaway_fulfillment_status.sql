-- Takeaway pickup status (waiting / picked_up).
-- Run in Supabase SQL Editor.

alter table public.crm_takeaway_orders
  add column if not exists fulfillment_status text not null default 'waiting';

create index if not exists crm_takeaway_orders_fulfillment_status_idx
  on public.crm_takeaway_orders (fulfillment_status);
