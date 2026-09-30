# Accounts and Backend

> **Purpose:** The technical design for optional accounts: signing in, and
> keeping a copy of every piece and the technique library in the account, on
> Supabase. The plain-language case for doing this at all, and the risks it
> has to guard against, is [SOW-Accounts-and-Sync.md](SOW-Accounts-and-Sync.md).
> **Audience:** Anyone building or changing Passes 106–114, and anyone asking
> "where does my data live once I sign in?"
> **Scope:** What was decided, how the account copy works (its shape on the
> server, conflicts, deletes, security, connection settings), known limits of
> the service, and the pass plan. Not the reasoning behind each choice — see
> [Decisions.md](Decisions.md#accounts-and-backend). Not the piece schema
> itself — see [Data-Model.md](Data-Model.md#the-piece-object), which the
> server keeps unchanged.
> **Related:** [SOW-Accounts-and-Sync.md](SOW-Accounts-and-Sync.md) ·
> [Decisions.md](Decisions.md#accounts-and-backend) ·
> [Roadmap.md](Roadmap.md#priority-ordered-backlog) ·
> [Data-Model.md](Data-Model.md#the-piece-object) ·
> [Architecture.md](Architecture.md#state-management) ·
> [Algorithms.md](Algorithms.md#import-merge)
> **Update when:** Any pass from 106 onward builds part of this (mark what
> shipped, and move anything that turned out differently into
> [Decisions.md](Decisions.md#accounts-and-backend)), a decision below is
> revisited, or Supabase's terms change in a way [Known limits](#known-limits)
> depends on.

**Status: designed (Pass 105, 2026-09-27); Phase 1 being built.** Passes
106–113 build it and Pass 114 puts it live — see [Pass plan](#pass-plan).
Since Pass 108 a **test** Supabase project exists with the tables and
security rules, connected to preview sites and local development only (see
[Setup](#setup-test-project)). **Since Pass 109, on those sites only, a
person can sign in and out** (see [Sign-in behavior](#sign-in-behavior-pass-109)),
but signing in moves no data yet: nothing is uploaded or downloaded until
Passes 110–112. The live site has no backend at all: it saves everything to
the browser only, as it always has.

## Decided

Decided by the user on 2026-09-27. Each item has its own entry, with the
alternative it rules out, in [Decisions.md](Decisions.md#accounts-and-backend).

1. **Supabase:** one managed service for sign-in, the database (Postgres)
   and, later, file storage. Firebase was the alternative
   ([SOW §5.1](SOW-Accounts-and-Sync.md#51-backend-hosting-approach)).
2. **Sign-in uses Supabase's built-in email-and-password accounts**, not a
   login system of our own
   ([SOW §5.2](SOW-Accounts-and-Sync.md#52-build-auth-yourself-or-use-the-managed-services-built-in-version)).
   No "sign in with Google" in Phase 1.
3. **Accounts are optional.** Signed out, the app is exactly today's app,
   saving to this browser only. Signing in adds a copy in the account.
4. **New accounts are by invitation only until Phase 3:** open sign-up is
   switched off in the Supabase dashboard, people are invited from there,
   and the app has no "create account" form. During Phase 1 the only
   account is the owner's own, because Supabase's built-in email sender
   reaches only the project's own team (decided 2026-09-29; see
   [Open questions](#open-questions)).
5. **No live multi-device sync in Phase 1**
   ([SOW §5.3](SOW-Accounts-and-Sync.md#53-is-live-multi-device-sync-required-on-day-one),
   decided earlier).

## Design

Recommended while scoping, and recorded here as the design Phase 1 builds
to. Each item has its own entry, with the alternative it rules out, in
[Decisions.md](Decisions.md#accounts-and-backend).

**A. Local first.** This browser's copy stays the working copy, signed in or
not: the app reads and writes it exactly as today, so it stays instant and
keeps working with no connection. While signed in, changes are also sent to
the account in the background, and the account copy is the durable one.
Ruled out: reading and writing only the server while signed in (every action
would need a connection, and a failed request would lose the change).

**B. Shape on the server.**
- **One row per piece**, holding the whole piece object as JSON, exactly
  what `localStorage` holds today, plus its owner, schema version, a
  revision number, updated-at and deleted-at.
- **One row per account for the technique data.**
- **Everything read back goes through `validateAndMigratePiece` /
  `validateAndMigrateTechnique`** (`lib/storage.js`), the same as a local
  load.

Ruled out: splitting a piece across many tables (sessions, progress and so
on). Much more work, every new piece field (this app adds them often) would
need a database change, and the server never needs to look inside a piece.

**C. Never overwrite silently.** A device remembers the revision it last saw
for each row, and an upload only succeeds if the row is still at that
revision. If another device changed it in between, the upload is refused and
the piece is held as "changed on another device" for the person to settle
with the existing import picker (`diffImportedPiece` / `mergeImportedPiece`,
see [Algorithms.md](Algorithms.md#import-merge)). Nothing is ever decided by
"last save wins". **The database keeps the count, not the app** (decided by
the user, 2026-09-29): a database rule raises a row's revision by one and
sets its updated-at on every change, so the app only says which revision it
expects ("save only if still at 5") and can't get the counting wrong. The
rule is a new migration file in Pass 110, the first pass that saves rows.

**D. Deleting a piece marks its row deleted** (deleted-at) instead of erasing
it, so it can't reappear from another device and can be recovered by hand.
Deleting the account erases everything. During Phase 1 that's done by the
project owner from the Supabase dashboard, on request; in the app before
Phase 3 (see the pass plan).

**E. Stays on the device, not in the account:** which piece is open
(`activePieceId`), the export-reminder dates, the technique corrupt-copy key,
and view state.

**F. The database itself enforces that an account can read and write only
its own rows** (row-level security), so an app bug can't expose someone
else's data. The app holds only the public key; the secret (`service_role`)
key never goes in the app, the repo or Vercel.

**G. Connection settings** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
live in `.env.local` for local development (never committed) and in Vercel's
environment settings. When they're missing the app runs exactly as today
with no sign-in offered, so tests and a fresh checkout need no account.
**Two projects, not one** (changed in Pass 108, on the user's decision): a
**test** project for Vercel's **Preview** environment and local development,
and a separate **production** project for the live site, created and
connected only at go-live (Pass 114). Until then Vercel's Production
environment has no Supabase settings. So testing never touches the account
copy of anyone's real data, and accounts reach the live site in one
deliberate step rather than as soon as sign-in code is merged. (The design
as first written had one project, connected to the live site too.)

**H. New records get ids with a random part** (Pass 107); existing ids are
never rewritten.

**I. Sign-in lives in an Account panel on the Settings landing page** and as
a link on the welcome screen (a new device has no sidebar until a piece
exists).

**J. The first upload from a device always asks first** ("Back up the N
pieces on this device to name@example.com?"), so one browser's pieces never
land in the wrong account by surprise.

**K. The account code is downloaded only when it's needed** (decided by the
user, 2026-09-29, for Pass 109). The Supabase library is about 59 KB
compressed, on top of the app's 139 KB. It loads only when someone opens the
Account panel to sign in, or on a device that already has a signed-in
session. A signed-out visitor downloads exactly what they do today (Decided
3). Supabase keeps a signed-in session in this browser's storage, so the app
can check for one without loading the library first. `src/lib/backend.js`
imports the library directly today (nothing uses it yet), so Pass 109 changes
that to load it on demand. Ruled out: including it in every visitor's
download (simpler, but about 42% more for everyone, including people who
never sign in).

## Known limits

The design brief listed these and said to check Supabase's current terms
rather than take them from the brief. They were checked against Supabase's
own pages on 2026-09-27. Terms change, so check again before relying on
them (Pass 108 sets up the project).

- **The free tier pauses idle projects.** The brief: Supabase's free tier
  has paused projects after about a week without activity. With the
  local-first design nothing is lost while paused; backups wait until the
  project is resumed from the dashboard.
  *Checked 2026-09-27:* still true. Free projects are paused after a week of
  low activity ([pricing](https://supabase.com/pricing)), and a paused
  project can be restored from the dashboard for up to a year after it was
  paused ([project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)).
- **The built-in email sender is for testing only.** The brief: Supabase's
  built-in email sender is rate-limited and meant for testing; fine for
  invitations and the odd password reset; Phase 3 needs a real email
  provider.
  *Checked 2026-09-27:* the rate limit and testing-only purpose still hold
  (2 messages an hour). But the built-in sender also **refuses to send to
  any address that isn't a member of the Supabase project's own team**:
  anyone else gets an "Email address not authorized" error
  ([custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)). So it is
  not fine for inviting anyone except the project owner. See
  [Open questions](#open-questions).

## Pass plan

**Phase 0 — finalize the design:** Pass 105 (recording this design in the
docs).

**Phase 1 — accounts and a durable account copy, no live sync**
([SOW §7](SOW-Accounts-and-Sync.md#7-suggested-phases)):
- **106** Save only what changed.
- **107** Ids that can't collide.
- **108** The **test** Supabase project, tables, security rules, and its
  connection to preview sites and local development (see
  [Setup](#setup-test-project)).
- **109** Sign in, sign out, invite and reset links (built; see
  [Sign-in behavior](#sign-in-behavior-pass-109)). In Phase 1 only the
  owner's own account is invited (the built-in email sender reaches only
  the project team), and the test project's Site URL moves to this pass's
  preview address while it's tested. No data moves.
- **110** First backup, verified by reading it back. Also adds the second
  migration file: the database rule that raises each row's revision and sets
  its updated-at on every change (Design C). It's run once on the test
  project, like the first, and on production at go-live.
- **111** Keep the backup current after every change, with a quiet status
  line and automatic retry.
- **112** Restore onto a new device.
- **113** Account settings (change email or password, sign out). **No
  in-app "delete my account" in Phase 1** (decided by the user,
  2026-09-29): the app's public key can't delete a sign-in account, and
  that needs code running inside Supabase with its admin powers. Until
  then, anyone who wants their account deleted asks, and the project owner
  deletes it in the Supabase dashboard (Authentication → Users). Their rows
  go with it automatically (checked in Pass 108).
- **114** Go-live (added in Pass 108): create the production project, apply
  the same migration files to it, and give Vercel's Production environment
  its two settings. Until this pass the live site has no backend. **The
  production project stays on Supabase's Free plan** (decided by the user,
  2026-09-29). That means it pauses after a week without use, and there are
  no automatic backups; see [Free-plan consequences](#free-plan-consequences).

Manual export and the export reminder stay throughout Phase 1
([SOW §6](SOW-Accounts-and-Sync.md#6-risks-and-things-that-could-go-wrong),
risk 1).

**Phase 2:** multi-device sync, and what happens offline.

**Phase 3:** open sign-up, privacy policy and terms, a real email provider,
monitoring, and an in-app "delete my account", which must exist before
strangers can sign up. The likely way is a "delete my account" database
function in a new migration file: it only ever deletes the caller's own
account, and it has nothing to deploy separately. A Supabase Edge Function
is the alternative. Either one is a small, deliberate exception to "no
server code of our own".

## Sign-in behavior (Pass 109)

What was built, and the small choices made building it (docs/User-Flows.md,
flow 10, has the screen-by-screen version):

- **Where it lives.** `src/lib/backend.js` is the only file that touches the
  Supabase library. `App.jsx` holds who's signed in (`authSession`, just
  `{ email, userId }`; the library keeps the real session) and listens for
  sign-in changes. `SignInModal.jsx` and `ChoosePasswordModal.jsx` are the
  two windows; the Account panel is in `SettingsTab.jsx` (after "Backup &
  restore"); the welcome screen has a quiet "Sign in" link (Design I).
- **Off unless connected.** `isBackendConfigured()` gates everything: with the
  two settings missing (the live site, a fresh checkout, `npm test`) no panel,
  link or window renders anywhere and the library is never loaded.
- **Design K, built.** The library is a separate download (about 59 KB
  compressed), fetched only when needed: at startup if this device already
  holds a saved sign-in (its key, `sb-<project>-auth-token`, is checked
  without the library) or the person arrived from an invite or reset link,
  and otherwise when someone opens sign-in. The main app grew by about 3.6 KB
  compressed for the new windows and helpers. If a supabase-js upgrade ever
  changed that key name, a signed-in device would look signed out until
  sign-in is opened: check `authStorageKeyFor` against the library's own
  `client.auth.storageKey` after upgrading.
- **An invitation link is read from the address, not from the library.** The
  library announces a password reset by name (`PASSWORD_RECOVERY`) but reports
  an invitation only as an ordinary "signed in", so the app reads the link's
  `type` from the address before the library removes it (`parseAuthLink`,
  `authLink`). An expired or already-used link arrives as an error in the
  address; the app shows a plain note in the sign-in window and clears the
  address.
- **Forgot password always gets the same answer**: "If that address has an
  account, a reset link is on its way." Only a failed connection says
  something different. Unknown address, service-side error and rate limit all
  look alike, so the form can't be used to find out who has an account. The
  cost: a real person who's rate-limited (the built-in email sender allows
  about 2 messages an hour) is told a link is on its way when none was sent.
- **Wrong email and wrong password get one message**, for the same reason.
- **Sign out signs out this device only** (`scope: "local"`). The library's
  default signs the account out of every device. It removes nothing from this
  device's pieces or technique data. With no connection it still signs this
  device out (the library removes the saved sign-in first, then reports that
  the service couldn't be told), so the app treats a connection problem there
  as a normal sign-out, not a failure; the service's own copy of the session
  simply expires later.
- **Choose a password.** Twice, at least 6 characters (Supabase's default
  minimum, a dashboard setting); if the dashboard's minimum is higher, the
  service's own message is shown. "Not now" closes the window and leaves the
  person signed in without a new password (they can use "Forgot password?"
  later).
- **The password is never logged or stored by the app.** It lives in the
  window's state only while the form is open and is cleared on success or
  close; the library keeps its session, never the password.
- **Invitation links open the project's Site URL**; reset links return to the
  site that asked (the current address, which has to be on the redirect list).

## Setup (test project)

Done in Pass 108 (2026-09-29). The dashboard steps were done by the user; the
checks were run against the project itself, not read off the settings pages.

**Supabase: one project, `measureone-test`**, Free plan.
- **Authentication → Sign In / Providers:** "Allow new users to sign up"
  switched **off** (invitation only, Decided 4). The Email provider stays on.
  Confirmed from the project's own auth settings: sign-up disabled, email on.
- **Authentication → URL Configuration:**
  - Site URL `https://measureone-git-claude-pass-109-sign-in-measure-one.vercel.app`
    (the Pass 109 branch's preview address; it was `http://localhost:5173`
    until Pass 109, changed 2026-09-30). A dashboard invitation opens the Site
    URL, so with the preview address invitation links work on any device, not
    only on the Mac running the development server. Reset links don't use it:
    they return to the site that asked. **If that branch's preview is ever
    removed, change the Site URL before sending another invitation.**
  - Redirect URLs `http://localhost:5173/**` and
    `https://*-measure-one.vercel.app/**` (every preview address ends in
    `-measure-one.vercel.app`; `*` matches one address label, `**` any path).
- **Tables and security rules:** `supabase/migrations/0001_accounts_backend.sql`,
  run once in the SQL Editor. Future changes go in new numbered files, applied
  to the test project first and to production at go-live.
- **Where the two settings come from:** Project Settings → **Data API** (the
  project URL; the page shows the address ending `/rest/v1/`, and the setting
  is the address without that ending) and → **API Keys** (the
  **publishable** key, `sb_publishable_…`). The secret key was never copied.

**Accounts:** one, the owner's own, invited from the dashboard on 2026-09-30
(Authentication → Users → Add user → Send invitation). Nobody else has one
(Phase 1, see [Open questions](#open-questions)).

**Vercel:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` added under the
project's Settings → Environment Variables as type **Config** (neither is a
secret), **Preview only**. Production and Development have none. Vercel
applies them from the next build, so a branch pushed after that picks them up.

**Local development:** the same two settings in `.env.local` (git ignores it;
`.env.example` shows the shape). It lives in each checkout, so a second
checkout needs its own copy.

**Checked for real (Pass 108):**
- 27 of 27 checks passed, signed in as two throwaway test accounts. Each could
  add, read and change its own rows. A could not read B's rows, add rows in
  B's name, change B's rows, or move its own row to B. Nobody could delete a
  row, not even its owner (Design D). Signed out, every read, add, change and
  delete was refused.
- Both tables have row-level security on, and signed-out visitors ("anon")
  have no table permissions at all.
- Deleting the two test accounts removed every row they owned: the same
  cascade that deleting someone's account from the dashboard relies on in
  Phase 1, and that in-app deletion will rely on later. No test accounts
  remain.

### Free-plan consequences

The production project stays on the Free plan (decided 2026-09-29; revisit if
paused projects or the lack of backups ever cause a real problem, since the
paid Pro plan doesn't pause projects and takes daily backups; check its
current price and terms then):
- **A pause stops the account copy updating, not practice.** The app always
  works from this browser's copy first (Design A), so a paused project only
  means changes wait to be uploaded until someone restores it from the
  dashboard (up to a year after the pause).
- **No automatic backups.** The account copy is a second copy of the data,
  next to this browser's copy and any exported backup files. If Supabase lost
  the database, nothing would restore the account copies. The manual export
  and the export reminder stay for that reason. Take a manual export of the
  database before each release (Supabase dashboard).

**Free-plan limits, checked 2026-09-29** on Supabase's
[pricing](https://supabase.com/pricing) page (check again before relying on
them):
- **2 active projects.** Test plus production uses both.
- Paused after **1 week** without activity (restorable from the dashboard;
  see [Known limits](#known-limits)). The test project will pause between
  testing sessions, so wake it before testing.
- **500 MB** database, **50,000** monthly active users, **1 GB** file
  storage.
- **No automatic backups** on the Free plan.
- Built-in email: see [Known limits](#known-limits).

## Where this differs from the SOW

The SOW was written before these choices were made and is kept as written.
Where the two disagree, this doc is the current plan:

- **This browser's copy isn't replaced.** The SOW talks about moving storage
  from `localStorage` to the backend (§1, §4B, §7 Phase 1). The design keeps
  this browser's copy as the working copy and adds the account copy beside
  it (Design A).
- **No API of our own.** The SOW's "API" (§4B) is Supabase's: the app talks
  to Supabase directly with the public key, and the database's own rules
  decide what each account may read and write (Design F).
- **Pieces don't gain an owner field.** The SOW says every stored record
  needs a "which account owns this" field (§2, §4D). In the design, the
  owner is recorded on the server row, beside the piece, and the piece
  object itself is stored unchanged (Design B).
- **No sign-up screen, and no "sign in with Google", in Phase 1** (§4A),
  per Decided 2 and 4.

## Open questions

These are unresolved. Don't treat the absence of a decision as an oversight
to silently fix; surface it instead.

- ~~**How do invited people get their invitation and password-reset emails
  in Phase 1?**~~ **Resolved 2026-09-29 (the user's call): nobody else, for
  now.** During Phase 1 the only account is the owner's own, invited from
  the dashboard; other people get accounts once email is sorted out (by
  hand-made accounts, or a real email provider, at the latest in Phase 3).
  **Confirmed in Pass 109 (2026-09-30):** the owner's own invitation
  arrived, and its link opened the app signed in, so the built-in sender does
  deliver to the owner's own address (the one used for the Supabase login).
  The original question, kept for the record: found
  while checking [Known limits](#known-limits) in Pass 105. Decided 4 has people invited from the Supabase dashboard, but the
  built-in email sender only delivers to members of the Supabase project's
  own team. The owner's own account should work only if it uses the same
  email address as the owner's Supabase login (inferred from that rule,
  not confirmed in Supabase's docs; check before Pass 109). Anyone else's
  invitation and
  password-reset emails would fail. Needs a decision before Pass 109 (invite
  and reset links). Options at the time (the first two remain the ways to
  add other people later):
  - set up a real email provider in Phase 1 instead of Phase 3;
  - create each account by hand in the Supabase dashboard with a starting
    password (no email needed to create it), accepting that the person's
    password-reset emails still won't arrive until Phase 3;
  - add each person to the Supabase project's team, which also gives them
    access to the dashboard (probably not wanted).
