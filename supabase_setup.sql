create table pages (
  code text primary key,
  text text default '',
  photos jsonb default '[]',
  updated_at timestamp with time zone default now()
);

alter table pages enable row level security;

create policy "Allow anyone to read pages"
on pages for select
using (true);

create policy "Allow anyone to insert pages"
on pages for insert
with check (true);

create policy "Allow anyone to update pages"
on pages for update
using (true);
