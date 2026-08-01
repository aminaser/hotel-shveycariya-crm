-- Menu docs for multi-PC sync (restaurant + takeaway JSON snapshots).
-- Paste into Supabase SQL Editor.

create table if not exists public.crm_menu_docs (
  id text primary key, -- 'restaurant' | 'takeaway'
  tabs jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by_name text
);

alter table public.crm_menu_docs enable row level security;
drop policy if exists crm_menu_docs_all on public.crm_menu_docs;
create policy crm_menu_docs_all on public.crm_menu_docs
  for all using (true) with check (true);
grant select, insert, update, delete on public.crm_menu_docs to anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.crm_menu_docs;
exception when duplicate_object then null;
end $$;
