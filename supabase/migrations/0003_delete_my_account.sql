-- MeasureOne: "delete my account" done by the database (Pass 130).
-- Design: docs/Accounts-and-Backend.md (Phase 3, Design D).
--
-- Run once per Supabase project, in the dashboard's SQL editor, AFTER
-- 0001_accounts_backend.sql and 0002_revision_counter.sql: on the test project
-- first, then on the production project BEFORE the pass that uses it is merged
-- (otherwise the live site would show a "Delete my account" button that fails).
-- Safe to run twice. As with the first two files, this file is the record of
-- what was applied: change the database only by adding a new numbered file
-- here, never by hand.
--
-- Why a function at all: the app's public key can't delete a sign-in account,
-- not even the signed-in person's own (that takes Supabase's admin powers,
-- which never go in the app, the repo or Vercel). A function marked
-- `security definer` runs with the powers of whoever ran this file, which is
-- what lets it reach the sign-in table; everything below is about keeping that
-- power small.
--
-- What it can do, exactly:
-- * It takes NO arguments, so there is nowhere to pass someone else's id in. It
--   deletes the sign-in account whose id is `auth.uid()`: the id from the
--   signed-in person's own token, which the caller can't choose.
-- * Deleting that account removes everything that belongs to it, inside the
--   database: the pieces and technique rows (both tables reference the account
--   with `on delete cascade`, 0001), and Supabase's own sessions and sign-in
--   records for it. That cascade runs as the tables' owner, so the "nobody can
--   delete a row" rules in 0001 don't block it, and they stay as they are.
-- * Only signed-in accounts may call it. A signed-out visitor (the "anon" role)
--   has no permission to run it, and the public default is taken away below.
--   Supabase also grants new functions to `anon` directly, which is why the
--   revoke names it.
-- * `set search_path = ''` means every name in the body is spelled out in full
--   (auth.users), so nothing a caller could create in another schema can stand
--   in for a real table or function while this runs with extra powers.
--
-- What it does NOT do: it doesn't check a password (the database never sees
-- one). The app asks for the password again and signs in with it just before
-- calling this, which protects against an unlocked device; it is not something
-- the database enforces. It doesn't touch the owner's separate daily backup
-- copy of the database either (Pass 131 decides how long that keeps data).
--
-- A future migration that adds a table holding a person's data must reference
-- the account with `on delete cascade`, or this function will fail with a
-- foreign-key error for everyone (it fails closed: nothing is half-deleted,
-- because the whole statement is one transaction).
--
-- If the dashboard shows "This query includes destructive operations": the
-- only delete is the line inside the function below, which runs when a person
-- presses the button in the app, never when this file is run. Running the file
-- changes no account and no row.
--
-- To read it back afterwards (optional), in the SQL editor:
--   select has_function_privilege('anon', 'public.delete_my_account()', 'execute');          -- false
--   select has_function_privilege('authenticated', 'public.delete_my_account()', 'execute'); -- true
-- scripts/check-rls.mjs also tries it from the outside (it deletes one of its
-- two throwaway accounts on purpose, see its header).

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  delete from auth.users where id = caller;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
