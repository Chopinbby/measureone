-- MeasureOne: the database keeps each row's revision count (Pass 110).
-- Design: docs/Accounts-and-Backend.md (Design C).
--
-- Run once per Supabase project, in the dashboard's SQL editor, AFTER
-- 0001_accounts_backend.sql: on the test project in Pass 110, on the
-- production project at go-live (Pass 114). Safe to run twice. As with the
-- first file, this file is the record of what was applied: change the
-- database only by adding a new numbered file here, never by hand.
--
-- Design C: an upload succeeds only if the row is still at the revision the
-- device last saw ("save only if still at 5"). That check is only as good as
-- the count, so the database keeps the count, not the app: a rule (trigger)
-- sets the revision and updated-at on every insert and update, whatever the
-- app sent. A later app bug can't make the count wrong.
--
-- No grants or revokes are needed here. The function below is a trigger
-- function, which the database refuses to run any other way, and a trigger
-- runs whenever its table is written, whoever the signed-in account is.
--
-- Two messages the dashboard may show when you run this:
-- * "This query includes destructive operations": a false alarm. It's the two
--   `drop trigger if exists` lines below, which drop only the rules this same
--   file creates (and do nothing on a first run). No table, column or row is
--   touched.
-- * "deadlock detected" (40P01): the file changes both tables in one go, and
--   another process using the same tables at that moment (seen once, on the
--   test project, in Pass 110) can collide with it. Run the file again. If it
--   keeps happening, run it in three parts, each on its own: the function,
--   then the pieces trigger, then the technique trigger. Each part touches
--   one table, so it can't collide.

create or replace function public.keep_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := old.revision + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pieces_keep_revision on public.pieces;
create trigger pieces_keep_revision
  before insert or update on public.pieces
  for each row execute function public.keep_revision();

drop trigger if exists technique_keep_revision on public.technique;
create trigger technique_keep_revision
  before insert or update on public.technique
  for each row execute function public.keep_revision();
