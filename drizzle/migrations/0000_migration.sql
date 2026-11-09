create type public.app_role as enum ('super_admin', 'approved');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique (user_id, role)
);
grant select, insert, delete on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid() or public.has_role(auth.uid(), 'super_admin'));
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "read own or admin roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'super_admin'));
create policy "admin grants approved" on public.user_roles for insert to authenticated with check (public.has_role(auth.uid(), 'super_admin') and role = 'approved');
create policy "admin revokes approved" on public.user_roles for delete to authenticated using (public.has_role(auth.uid(), 'super_admin') and role = 'approved' and user_id <> auth.uid());

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique,
  name text not null default 'Meu projeto',
  nodes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;
alter table public.projects enable row level security;
create policy "owner approved access" on public.projects for all to authenticated
  using (owner_id = auth.uid() and (public.has_role(auth.uid(), 'approved') or public.has_role(auth.uid(), 'super_admin')))
  with check (owner_id = auth.uid() and (public.has_role(auth.uid(), 'approved') or public.has_role(auth.uid(), 'super_admin')));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  if not exists (select 1 from public.user_roles where role = 'super_admin') then
    insert into public.user_roles (user_id, role) values (new.id, 'super_admin'), (new.id, 'approved');
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();