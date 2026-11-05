-- ScanTest database schema for Supabase (v3: terms, enrollments, presets, admin-made accounts).
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run, and upgrades databases created by earlier versions of this file
-- without losing data.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.app_role as enum ('admin', 'teacher', 'pending');
exception when duplicate_object or undefined_object then null; end $$;

-- One row per person who can sign in. Created automatically for every auth user.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '',
  role public.app_role not null default 'pending',
  created_at timestamptz not null default now()
);
-- sign-in name for accounts the admin creates (they sign in with it instead of an email)
alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key on public.profiles (lower(username)) where username is not null;

-- Emails pre-approved for self sign-up (kept from v2; accounts are now usually made by the admin).
create table if not exists public.allowed_emails (
  email text primary key,
  name text,
  role public.app_role not null default 'teacher',
  created_at timestamptz not null default now()
);

-- Academic terms: ภาคเรียน 1-3 of a ปีการศึกษา (Buddhist year).
create table if not exists public.terms (
  id uuid primary key default gen_random_uuid(),
  year int not null check (year between 2400 and 2800),
  semester int not null check (semester between 1 and 3),
  created_at timestamptz not null default now(),
  unique (year, semester)
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  school_name text not null default 'โรงเรียนของฉัน',
  id_digits int not null default 4 check (id_digits between 3 and 10)
);
alter table public.settings add column if not exists current_term_id uuid references public.terms (id) on delete set null;
alter table public.settings add column if not exists logo text;          -- small image data URL printed on sheets
alter table public.settings add column if not exists sheet_header text;  -- line printed above the exam title
insert into public.settings (id) values (1) on conflict do nothing;

-- A class in one term, e.g. ม.1 / 2 in 1/2569.
create table if not exists public.classrooms (
  id uuid primary key default gen_random_uuid(),
  term_id uuid references public.terms (id) on delete cascade,
  grade text,
  room text,
  created_at timestamptz not null default now()
);

-- A student as a person; which class they are in each term lives in enrollments.
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  code text not null,                       -- เลขประจำตัว
  prefix text not null default '',          -- คำนำหน้า
  first_name text not null default '',
  last_name text not null default '',
  status text not null default 'active',    -- active | graduated | left
  created_at timestamptz not null default now()
);
-- tables created by v1/v2 don't have the new columns yet
alter table public.classrooms add column if not exists term_id uuid references public.terms (id) on delete cascade;
alter table public.classrooms add column if not exists grade text;
alter table public.classrooms add column if not exists room text;
alter table public.students add column if not exists prefix text not null default '';
alter table public.students add column if not exists first_name text not null default '';
alter table public.students add column if not exists last_name text not null default '';
alter table public.students add column if not exists status text not null default 'active';
alter table public.students add column if not exists created_at timestamptz not null default now();

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms (id) on delete cascade,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  number int not null default 0,            -- เลขที่
  unique (term_id, student_id)              -- one class per student per term
);
create index if not exists enrollments_classroom_idx on public.enrollments (classroom_id);

-- Answer-sheet presets the admin prepares for teachers.
create table if not exists public.sheet_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  questions int not null check (questions between 1 and 200),
  choices int not null check (choices between 2 and 6),
  label_style text not null default 'thai',
  use_student_id boolean not null default true,
  default_points numeric not null default 1,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
insert into public.sheet_presets (name, questions, choices, label_style, sort)
select * from (values
  ('20 ข้อ 4 ตัวเลือก', 20, 4, 'thai', 1),
  ('30 ข้อ 4 ตัวเลือก', 30, 4, 'thai', 2),
  ('40 ข้อ 4 ตัวเลือก', 40, 4, 'thai', 3),
  ('50 ข้อ 5 ตัวเลือก', 50, 5, 'thai', 4),
  ('ถูก/ผิด 20 ข้อ', 20, 2, 'truefalse', 5)
) as d (name, questions, choices, label_style, sort)
where not exists (select 1 from public.sheet_presets);

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
-- restrict: a term that still has exams can't be deleted
alter table public.exams add column if not exists term_id uuid references public.terms (id) on delete restrict;
alter table public.exams add column if not exists preset_id uuid references public.sheet_presets (id) on delete set null;
create index if not exists exams_owner_idx on public.exams (owner_id);
create index if not exists exams_term_idx on public.exams (term_id);

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
alter table public.scans add column if not exists name_image text; -- small picture of the handwritten name

create or replace view public.exam_scan_counts with (security_invoker = on) as
  select exam_id, count(*)::int as n from public.scans group by exam_id;

-- ---------------------------------------------------------------------------
-- Upgrade from v1/v2 (classrooms had a "name"; students belonged to one classroom)
-- ---------------------------------------------------------------------------

-- Thai school year: semester 1 runs May-October, semester 2 November-April.
create or replace function public.current_thai_term(out year int, out semester int)
language sql stable as $$
  select case when extract(month from now()) <= 4 then extract(year from now())::int + 542
              else extract(year from now())::int + 543 end,
         case when extract(month from now()) between 5 and 10 then 1 else 2 end
$$;

do $$
declare
  t uuid;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'students' and column_name = 'classroom_id') then
    insert into public.terms (year, semester) select year, semester from public.current_thai_term()
      on conflict (year, semester) do nothing;
    select id into t from public.terms order by year desc, semester desc limit 1;

    update public.classrooms set term_id = t where term_id is null;
    update public.classrooms
       set grade = trim(split_part(name, '/', 1)),
           room = coalesce(nullif(trim(split_part(name, '/', 2)), ''), '1')
     where grade is null;
    alter table public.classrooms drop column if exists name;

    -- split old one-field names ("ด.ช. สมชาย ใจดี") into prefix / first / last name
    update public.students s
       set prefix = p.prefix,
           first_name = split_part(p.rest, ' ', 1),
           last_name = trim(substr(p.rest, length(split_part(p.rest, ' ', 1)) + 1))
      from (select id,
                   coalesce(substring(name from '^(ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|นางสาว|น\.ส\.|นาย|นาง)'), '') as prefix,
                   trim(regexp_replace(name, '^(ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|นางสาว|น\.ส\.|นาย|นาง)\s*', '')) as rest
              from public.students) p
     where p.id = s.id and s.first_name = '';
    -- the same code in two old classrooms becomes one person, enrolled once
    insert into public.enrollments (term_id, classroom_id, student_id, number)
      select distinct on (s.code) t, s.classroom_id, s.id, s.number
        from public.students s order by s.code, s.number
      on conflict (term_id, student_id) do nothing;
    delete from public.students s where not exists (select 1 from public.enrollments e where e.student_id = s.id);
    alter table public.students drop column classroom_id cascade;
    alter table public.students drop column if exists number;
    alter table public.students drop column if exists name;

    update public.exams e set term_id = c.term_id from public.classrooms c where e.classroom_id = c.id and e.term_id is null;
    update public.exams set term_id = t where term_id is null;
  end if;
end $$;

-- every install has at least one term, and a current one
insert into public.terms (year, semester)
  select year, semester from public.current_thai_term() where not exists (select 1 from public.terms);
update public.settings set current_term_id = (select id from public.terms order by year desc, semester desc limit 1)
  where id = 1 and current_term_id is null;

alter table public.classrooms alter column term_id set not null;
alter table public.classrooms alter column grade set not null;
alter table public.classrooms alter column room set not null;
create unique index if not exists classrooms_term_grade_room_key on public.classrooms (term_id, grade, room);
create unique index if not exists students_code_key on public.students (code);

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

-- New auth user -> profile. The very first account becomes admin; self sign-ups wait as pending.
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
-- Accounts made by the admin (username + password, no e-mail or sign-up needed)
-- ---------------------------------------------------------------------------

-- Usernames sign in as <username>@scantest.local (the app adds the domain).
create or replace function public.login_email(p_username text) returns text
language sql immutable as $$
  select lower(case when position('@' in p_username) > 0 then trim(p_username) else trim(p_username) || '@scantest.local' end)
$$;

create or replace function public.admin_create_user(p_username text, p_password text, p_name text, p_role public.app_role default 'teacher')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := gen_random_uuid();
  em text := public.login_email(p_username);
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบ' using errcode = '42501';
  end if;
  if position('@' in p_username) = 0 and lower(trim(p_username)) !~ '^[a-z0-9._-]{3,40}$' then
    raise exception 'ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ ตัวเลข . _ - ยาว 3-40 ตัว' using errcode = '22023';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = em) then
    raise exception 'ชื่อผู้ใช้ % มีอยู่แล้ว', p_username using errcode = '23505';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_name), now(), now(),
          '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true), 'email', now(), now(), now());

  -- the trigger made the profile; give it the requested role, name and username
  update profiles set role = p_role, name = p_name,
         username = case when position('@' in p_username) > 0 then null else lower(trim(p_username)) end
   where id = uid;
  return uid;
end $$;

create or replace function public.admin_set_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบ' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' using errcode = '22023';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user;
end $$;

create or replace function public.admin_delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบ' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'ลบบัญชีของตัวเองไม่ได้' using errcode = '22023';
  end if;
  if exists (select 1 from exams where owner_id = p_user) then
    raise exception 'ครูคนนี้มีข้อสอบอยู่ ให้ปิดการใช้งานแทนการลบ' using errcode = '23503';
  end if;
  delete from auth.users where id = p_user; -- profile goes with it
end $$;

revoke all on function public.admin_create_user(text, text, text, public.app_role) from public, anon;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_create_user(text, text, text, public.app_role) to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Helper calls are wrapped in (select ...) so Postgres evaluates them once per
-- query instead of once per row.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.allowed_emails enable row level security;
alter table public.terms enable row level security;
alter table public.settings enable row level security;
alter table public.classrooms enable row level security;
alter table public.students enable row level security;
alter table public.enrollments enable row level security;
alter table public.sheet_presets enable row level security;
alter table public.exams enable row level security;
alter table public.scans enable row level security;

-- profiles: members see everyone, anyone sees themselves; only admins change them
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_member()));
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using ((select public.is_admin()) and id <> (select auth.uid()));

drop policy if exists allowed_emails_admin on public.allowed_emails;
create policy allowed_emails_admin on public.allowed_emails for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- reference data: every member reads it, only admins change it
do $$
declare tbl text;
begin
  foreach tbl in array array['terms', 'classrooms', 'students', 'enrollments', 'sheet_presets'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', tbl);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using ((select public.is_member()))', tbl);
    execute format('drop policy if exists %1$s_admin on public.%1$s', tbl);
    execute format('create policy %1$s_admin on public.%1$s for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', tbl);
  end loop;
end $$;

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated using ((select public.is_member()));
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- exams: teachers see and edit their own, admins see all
drop policy if exists exams_select on public.exams;
create policy exams_select on public.exams for select to authenticated
  using ((select public.is_admin()) or (owner_id = (select auth.uid()) and (select public.is_member())));
drop policy if exists exams_insert on public.exams;
create policy exams_insert on public.exams for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_member()));
drop policy if exists exams_update on public.exams;
create policy exams_update on public.exams for update to authenticated
  using ((select public.is_admin()) or (owner_id = (select auth.uid()) and (select public.is_member())))
  with check ((select public.is_admin()) or owner_id = (select auth.uid()));
drop policy if exists exams_delete on public.exams;
create policy exams_delete on public.exams for delete to authenticated
  using ((select public.is_admin()) or (owner_id = (select auth.uid()) and (select public.is_member())));

-- scans follow their exam: the list of visible exams is computed once per query
drop policy if exists scans_all on public.scans;
create policy scans_all on public.scans for all to authenticated
  using (exam_id in (select e.id from public.exams e))
  with check (exam_id in (select e.id from public.exams e));

-- live updates of scans (results page refreshes while someone else scans)
do $$ begin
  alter publication supabase_realtime add table public.scans;
exception when duplicate_object or undefined_object then null; end $$;
