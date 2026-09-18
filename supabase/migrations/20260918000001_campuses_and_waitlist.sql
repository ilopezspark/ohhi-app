-- OhHi v1 · migration 0001 · campuses and waitlist
--
-- Build step 1 of the technical brief: the waitlist the marketing site writes
-- to, and the campus table everything else hangs off. Multi-campus from day
-- one even though only CLC exists at launch.
--
-- Conventions (brief §3): every table has id uuid pk default gen_random_uuid()
-- and created_at timestamptz default now(); RLS is enabled on every table,
-- no exceptions. Tables with no policies are reachable only through the
-- service role (server-side) until a later migration adds policies.

create extension if not exists citext;
create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- campuses
-- ---------------------------------------------------------------------------

create type campus_status as enum ('live', 'coming_soon', 'waitlist');

create table campuses (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  name               text not null,                        -- "College of Lake County"
  slug               text not null unique,                 -- "clc", used in every analytics event
  city               text not null,
  state              text not null,
  email_domains      text[] not null default '{}',         -- accepted .edu domains; suffix-matched
  status             campus_status not null default 'waitlist',
  launch_date        date,
  -- Used only inside the tiering edge function. Never returned to a client.
  center_point       geography(point, 4326) not null,
  on_campus_radius_m integer not null default 800,
  nearby_radius_m    integer not null default 8000,
  -- The "county" tier (brief §4) needs a boundary the radii cannot express.
  -- Nullable until the polygon is loaded; the tiering function treats null as
  -- "no county tier for this campus".
  county_boundary    geography(multipolygon, 4326),
  county_label       text,                                 -- shown as "lake co."
  constraint campuses_slug_format check (slug ~ '^[a-z0-9-]+$'),
  constraint campuses_radii check (on_campus_radius_m > 0 and nearby_radius_m > on_campus_radius_m)
);

comment on table campuses is 'One row per campus. center_point and county_boundary are read only by the tiering function.';
comment on column campuses.email_domains is 'A signup email must end with one of these (exact domain or subdomain).';

alter table campuses enable row level security;

-- Anyone signed in can read the campus list, but never the geometry.
-- Geometry columns are excluded by granting column-level select only.
revoke all on campuses from anon, authenticated;
grant select (id, name, slug, city, state, email_domains, status, launch_date, county_label)
  on campuses to anon, authenticated;

create policy "campuses are readable by everyone"
  on campuses for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- waitlist
-- ---------------------------------------------------------------------------

create table waitlist (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  email             citext not null unique,
  email_domain      text not null,
  campus_guess      text,                                   -- campus slug if we could tell, else null
  source            text not null default 'site',           -- 'site', 'app', a referrer, a campaign tag
  confirmation_sent boolean not null default false
);

comment on table waitlist is 'Written by the marketing site (service role) and by the app for not-yet-live campuses. Read only by staff.';

alter table waitlist enable row level security;
-- No policies on purpose: the service role bypasses RLS; anon/authenticated get nothing.
revoke all on waitlist from anon, authenticated;

-- ---------------------------------------------------------------------------
-- seed: College of Lake County, Grayslake campus
-- ---------------------------------------------------------------------------

insert into campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label)
values (
  'College of Lake County',
  'clc',
  'Grayslake',
  'IL',
  array['clcillinois.edu'],
  'coming_soon',
  date '2027-01-01',
  -- Approximate centroid of the Grayslake campus, 19351 W Washington St.
  -- Verify against the campus map before launch; the on-campus radius is
  -- measured from this point.
  st_setsrid(st_makepoint(-88.0102, 42.3595), 4326)::geography,
  'lake co.'
);
