-- MeasureOne: the account copy's tables and security rules (Pass 108).
-- Design: docs/Accounts-and-Backend.md (Design B, C, D, F).
--
-- Run once per Supabase project, in the dashboard's SQL editor (or with the
-- Supabase CLI). This file is the record of what was applied: change the
-- database only by adding a new numbered file here, never by hand.

-- ---------------------------------------------------------------------------
-- Pieces: one row per piece, the whole piece object as JSON, exactly as it's
-- stored in the browser (Design B). The server never looks inside `data`.
-- ---------------------------------------------------------------------------
create table public.pieces (
  user_id        uuid        not null references auth.users (id) on delete cascade,
  id             text        not null,              -- the piece's own id, e.g. "p_muli5877_a9y5yn6fwi"
  data           jsonb       not null,
  schema_version integer     not null default 1,
  revision       bigint      not null default 1,    -- Design C: an upload only succeeds at the revision it last saw
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,                       -- Design D: deleting a piece sets this; the row stays
  primary key (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Technique: one row per account, the whole technique object as JSON.
-- ---------------------------------------------------------------------------
create table public.technique (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  data       jsonb       not null,
  revision   bigint      not null default 1,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Security (Design F): the database itself enforces that a signed-in account
-- reaches only its own rows, so an app bug can't expose anyone else's data.
-- ---------------------------------------------------------------------------
alter table public.pieces    enable row level security;
alter table public.technique enable row level security;

-- Table permissions first, narrower than Supabase's defaults (which grant
-- every privilege, delete and truncate included). Signed-out visitors (the
-- "anon" role) get nothing at all; signed-in accounts ("authenticated") may
-- only read, add and change, never delete or empty a table. The policies
-- below then narrow those three to the account's own rows.
revoke all on table public.pieces    from anon, authenticated;
revoke all on table public.technique from anon, authenticated;
grant select, insert, update on table public.pieces    to authenticated;
grant select, insert, update on table public.technique to authenticated;

-- Signed-in accounts: read, add and change only rows whose user_id is their
-- own. `with check` on insert and update also stops a row being written with,
-- or moved to, someone else's user_id.
create policy "pieces: read own rows" on public.pieces
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "pieces: add own rows" on public.pieces
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "pieces: change own rows" on public.pieces
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "technique: read own row" on public.technique
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "technique: add own row" on public.technique
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "technique: change own row" on public.technique
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No delete policy, on purpose, and no delete permission (above): nobody using
-- the app's key can delete a row, including its owner. A piece is deleted by
-- setting deleted_at (Design D), so it can't reappear from another device and
-- can be recovered by hand. Rows go away only when the account itself is
-- deleted (the `on delete cascade` above; Pass 113). That cascade runs inside
-- the database as the tables' owner, not as the signed-in user, so these
-- rules don't block it.
