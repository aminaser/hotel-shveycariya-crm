-- Additive: extra bedding flag on stays.
alter table public.crm_stays add column if not exists extra_bedding boolean not null default false;
