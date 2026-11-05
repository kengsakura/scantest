-- ScanTest database schema for Supabase.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: it only creates what is missing and replaces functions/policies.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.app_role as enum ('admin', 'teacher', 'pending');
exception when duplicate_object or undefined_object then null; end $$;

-- One row per signed-in person. Created automatically on sign-up (see trigger).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '',
  role public.app_role not null default 'pending',
  created_at timestamptz not null default now()
);

-- Emails the admin has pre-approved. Signing up with one of these gets its role
-- straight away; anyone else waits as 'pending' until an admin approves them.
create table if not exists public.allowed_emails (
  email text primary key,
  name text,
  role public.app_role not null default 'teacher',
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  school_name text not null default 'โรงเรียนของฉัน',
  id_digits int not null default 5 check (id_digits between 3 and 10)
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.classrooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  number int not null,
  code text not null,
  name text not null,
  unique (classroom_id, code)
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  classroom_id uuid references public.classrooms (id) on delete set null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  sheet jsonb not null,          -- { questions, choices, labelStyle }
  id_digits int not null,
  key jsonb not null             -- { answers, points, free }
);
create index if not exists exams_owner_idx on public.exams (owner_id);

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  student_code text,             -- null when the ID bubbles could not be read
  answers jsonb not null,        -- marked choice indexes per question
  uncertain jsonb not null default '[]',
  scanned_at timestamptz not null default now(),
  scanned_by uuid references public.profiles (id) on delete set null,
  unique (exam_id, student_code) -- one sheet per student per exam (NULLs may repeat)
);
create index if not exists scans_exam_idx on public.scans (exam_id);

create or replace view public.exam_scan_counts with (security_invoker = on) as
  select exam_id, count(*)::int as n from public.scans group by exam_id;

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies can call them without recursion)
-- ---------------------------------------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher'))
$$;

-- New sign-up -> profile. The very first account becomes admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r app_role;
  n text;
  allowed_name text;
begin
  select a.role, a.name into r, allowed_name from allowed_emails a where lower(a.email) = lower(new.email);
  if not exists (select 1 from profiles where role = 'admin') then
    r := 'admin';
  elsif r is null then
    r := 'pending';
  end if;
  n := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    allowed_name,
    split_part(new.email, '@', 1)
  );
  insert into profiles (id, email, name, role) values (new.id, new.email, n, r)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.allowed_emails enable row level security;
alter table public.settings enable row level security;
alter table public.classrooms enable row level security;
alter table public.students enable row level security;
alter table public.exams enable row level security;
alter table public.scans enable row level security;

-- profiles: members see everyone, anyone sees themselves; only admins change roles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_member());
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (public.is_admin() and id <> auth.uid());

drop policy if exists allowed_emails_admin on public.allowed_emails;
create policy allowed_emails_admin on public.allowed_emails for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated using (public.is_member());
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists classrooms_select on public.classrooms;
create policy classrooms_select on public.classrooms for select to authenticated using (public.is_member());
drop policy if exists classrooms_admin on public.classrooms;
create policy classrooms_admin on public.classrooms for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists students_select on public.students;
create policy students_select on public.students for select to authenticated using (public.is_member());
drop policy if exists students_admin on public.students;
create policy students_admin on public.students for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- exams: teachers see and edit their own, admins see all
drop policy if exists exams_select on public.exams;
create policy exams_select on public.exams for select to authenticated
  using (public.is_admin() or (owner_id = auth.uid() and public.is_member()));
drop policy if exists exams_insert on public.exams;
create policy exams_insert on public.exams for insert to authenticated
  with check (owner_id = auth.uid() and public.is_member());
drop policy if exists exams_update on public.exams;
create policy exams_update on public.exams for update to authenticated
  using (public.is_admin() or (owner_id = auth.uid() and public.is_member()))
  with check (public.is_admin() or owner_id = auth.uid());
drop policy if exists exams_delete on public.exams;
create policy exams_delete on public.exams for delete to authenticated
  using (public.is_admin() or (owner_id = auth.uid() and public.is_member()));

-- scans follow their exam
drop policy if exists scans_all on public.scans;
create policy scans_all on public.scans for all to authenticated
  using (exists (select 1 from public.exams e where e.id = exam_id))
  with check (exists (select 1 from public.exams e where e.id = exam_id));

-- live updates of scans (results page refreshes while someone else scans)
do $$ begin
  alter publication supabase_realtime add table public.scans;
exception when duplicate_object or undefined_object then null; end $$;
