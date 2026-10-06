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
but signing in alone moves no data. **Since Pass 110 a signed-in person can
press "Back up this device"** to copy this browser's pieces and technique
library to their account, checked by reading it back (see
[First backup behavior](#first-backup-behavior-pass-110)). **Since Pass 111,
once that first backup has been checked, every later change is sent to the
account by itself** (see
[Keeping the backup current](#keeping-the-backup-current-pass-111)). **Since
Pass 112 a signed-in person can bring things back from the account**: restore
onto a new device, "Get changes from your account", and Review for a piece
held as "changed on another device" (see
[Restore, get changes and settle](#restore-get-changes-and-settle-pass-112)).
Changes still don't arrive by themselves (Phase 2). The live site has no
backend at all: it saves everything to the browser only, as it always has.

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
rule is a new migration file, `0002_revision_counter.sql`, built in Pass 110,
the first pass that saves rows.

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
land in the wrong account by surprise. Built in Pass 110: asked the first time
a device backs up to an account (see
[First backup behavior](#first-backup-behavior-pass-110)).

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
  project, like the first, and on production at go-live. Built; see
  [First backup behavior](#first-backup-behavior-pass-110).
- **111** Keep the backup current after every change, with a quiet status
  line and automatic retry. Built; see
  [Keeping the backup current](#keeping-the-backup-current-pass-111).
- **112** Restore from your account, get changes from it, and settle a
  piece changed on another device. Built; see
  [Restore, get changes and settle](#restore-get-changes-and-settle-pass-112).
- **113** Account settings: **change password** and **sign out of all
  devices**, both in the Account panel. Built; see
  [Account settings](#account-settings-pass-113). **No in-app "delete my
  account" and no in-app change of email in Phase 1.** The delete was
  decided by the user, 2026-09-29: the app's public key can't delete a
  sign-in account, and that needs code running inside Supabase with its
  admin powers. The email change was moved to Phase 3 when the card for this
  pass was written: it needs a real email provider (Supabase's built-in
  sender allows only a couple of messages an hour). Until then, anyone who
  wants either asks, and the project owner does it in the Supabase dashboard
  (Authentication → Users), as described under Account settings. A deleted
  account's rows go with it automatically (checked in Pass 108).
- **114** Go-live (added in Pass 108): create the production project, apply
  the same migration files to it (see the notes under
  [Setup](#setup-test-project) on the deadlock and "destructive operations"
  messages), and give Vercel's Production environment
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
  simply expires later. (Pass 113 adds a separate "Sign out of all devices",
  where a connection problem is not a normal sign-out: see
  [Account settings](#account-settings-pass-113).)
- **Choose a password.** Twice, at least 6 characters (Supabase's default
  minimum, a dashboard setting); if the dashboard's minimum is higher, the
  service's own message is shown. "Not now" closes the window and leaves the
  person signed in without a new password (they can use "Forgot password?"
  later). (Pass 113 adds a third, "change" mode of the same window, reached
  from the Account panel.)
- **The password is never logged or stored by the app.** It lives in the
  window's state only while the form is open and is cleared on success or
  close; the library keeps its session, never the password.
- **Invitation links open the project's Site URL**; reset links return to the
  site that asked (the current address, which has to be on the redirect list).

## First backup behavior (Pass 110)

What was built, and the small choices made building it (docs/User-Flows.md,
flow 11, has the screen-by-screen version):

- **Where it lives.** `src/lib/accountSync.js` has no React and gets the
  client only from `loadBackend()`, so the library is still downloaded on
  demand (the main download grew by about 3.3 KB compressed; the library's own
  file is unchanged). `App.jsx` holds the button's handler
  (`handleBackUpDevice`) and the last result (`backup`); the button and the
  result lines are in the Account panel (`SettingsTab.jsx`).
- **The revision rule is in the database.**
  `supabase/migrations/0002_revision_counter.sql` puts a rule (a trigger) on
  both tables: revision is 1 on insert and the old revision plus one on every
  update, and updated-at is set, whatever the app sent (Design C). Run it once
  on the test project, after the first file; running it twice is harmless.
  Production gets it at go-live (Pass 114). It was checked in a real Postgres
  engine: the app's own value is overridden, a save "only if still at revision
  N" at a stale N changes nothing, the first migration's security rules still
  hold, and nobody can call the rule by hand.
- **A press does five things, in order:** reads every row the account holds;
  adds a row for each piece, and the technique library, that the account
  lacks; reads everything back; compares it with what this device held;
  records on this device only what matched.
- **It only ever adds.** Nothing in this pass changes or deletes a row the
  account already holds. A piece whose id already has a row is compared:
  matching counts as backed up; different, or marked deleted, is listed as
  "Already in your account and different, left as it is" and not touched
  (settling those is Pass 112). The technique row follows the same rule. If
  another device adds the same id in the gap between the read and the add, the
  database refuses the duplicate and it's treated the same way. "Save only if
  still at revision N" (`changePieceRow`, `changeTechniqueRow`) is built and
  tested but nothing calls it until Pass 111. A piece deleted on this device
  is not uploaded as a deletion (Pass 111).
- **Compared as data, never as text.** The database reorders an object's keys
  and JSON drops undefined fields, so two copies of one piece are never the
  same text (`sameData`, `lib/accountSync.js`). Checked on real backups through
  a real JSON column, including older-format ones: every piece matched as
  data, and none would have as text.
- **It uploads what the app holds**: the in-memory pieces, after
  `validateAndMigratePiece`, not the raw stored text (the Pass 105 to 106
  follow-up in [Decisions.md](Decisions.md#open-questions)). They are read
  once, when the button is pressed, so what's uploaded and compared is what
  this device held at that moment, even if something changes while it runs.
- **The first backup to an account asks first (Design J); later ones don't.**
  The question appears in the Account panel itself, with **Back up** and
  **Not now** buttons: "Back up the 12 pieces and the technique library on
  this device to name@example.com?" It's asked unless this device's record
  already shows a checked backup to that account, in which case pressing again
  goes straight through, since all it can do is add what's missing. A
  different account signing in on this browser has no record, so it's asked
  again. The asking lives in `handleBackUpDevice`, not in `backUpDevice`.
  **It is deliberately not a browser pop-up** (`window.confirm`): the first
  version was, and on the first real try the button did nothing at all, most
  likely because the browser blocked the pop-up (some browsers block or
  auto-dismiss them, and a blocked pop-up reads as "No"). The symptom was
  reproduced in the browser by making the pop-up answer "No" (which browser
  behavior it really was wasn't confirmed). Fixed by moving the question into
  the page, and re-checked with a page that throws if any pop-up is attempted.
- **The device record** (`measureone-account-sync`, stays on this device,
  Design E) is filed under the signed-in account's user id: for each piece and
  for the technique row, the revision this device last saw and a fingerprint
  of what it uploaded, and when the backup was last checked. It's written only
  once the read-back matches. **A piece that differs gets no entry, on
  purpose** (an entry it already had is kept as it was): recording the
  revision it has now would let a later pass write over it. Pass 111 must
  treat "a row exists but this device has no entry for it" as held.
- **The result is plain words**: "Backed up and checked: 12 of 12 pieces and
  the technique library.", then which pieces were already there, which are
  different, which didn't match when read back or couldn't be sent, and when it
  was checked. When the account already holds a copy of every piece and none
  match (a second browser, say) it says "Nothing was added: your account
  already has a copy of each of these pieces." rather than "Nothing was
  backed up", which reads like a failure; names are separated by semicolons
  (piece names contain commas) and a long list is cut after five. If it can't finish (no connection, signed out, anything
  unexpected) it says so and records nothing; pressing again is safe, because
  anything already added is found and counted as backed up. The library
  retries a failed read three times first, so a down service takes several
  seconds to report.
- **It never changes this device.** The only thing written here is the device
  record. Checked in the browser, with the real app and library against a local
  stand-in for the database: every piece, the technique library and the
  open-piece setting were byte-for-byte identical before and after the first
  press, a second press, a press with one account row changed by hand, and a
  press with no connection. **Checked on the real test project (2026-10-01,
  the owner's account, read-only through the signed-in preview tab):** 25
  piece rows and the technique row, all at revision 1 (so the revision rule
  works there), none deleted, uploaded in a three-second window that falls
  between the owner's two exports (15:01:44 and 15:02:24); every row identical
  as data (a SHA-256 of its key-sorted JSON) to both exported files, and the
  two exports identical to each other, so the backup round-tripped the real
  database exactly and changed nothing on the device. A second browser (the
  built-in one in the Claude app) that imported the same file then pressed the
  button: the app left all 25 pieces alone, listing each as "already in your
  account and different". The result then began "Nothing was backed up.",
  which read like a failure, so it was reworded to "Nothing was added..." (see
  the Pass 110 follow-ups in [Decisions.md](Decisions.md#open-questions), item
  10, for why those copies differ). **Hand-edit check (2026-10-02):** changing
  one account row in the SQL editor took it from revision 1 to 2 (the rule
  works there). Pressing the button afterwards in that second browser left it
  exactly as edited: revision 2, the edited text still in the account, no
  row's change time later than the hand edit, the other 24 rows still at
  revision 1 (nothing uploaded twice) and the technique row untouched, while
  the device's own copy was unchanged. Not yet seen on the real project: the
  "24 of 25 backed up" display for that case in a browser whose copy matches
  the account (covered by the unit tests and the local browser run).
- **A running backup survives leaving Settings**, and both buttons are
  disabled while it runs. A result is shown only to the account that asked for
  it.
- **Logged, not fixed:** the review's follow-ups are in
  [Decisions.md](Decisions.md#open-questions) ("Accounts first backup (Pass
  110)"): a paused project reads as a generic failure, "ask first" isn't
  enforced inside `backUpDevice`, the result's detail line counts pieces only,
  and the failure-path checks aren't committed as tests.

## Keeping the backup current (Pass 111)

What was built, and the small choices made building it:

- **When it runs.** Only while signed in, and only once this device's first
  backup to that account has been checked (Pass 110), because the first backup
  asks first (Design J) and nothing automatic may skip that question. Signed
  out, on the live site, or before the first backup, nothing here runs: no
  timer is started, the account library isn't downloaded and no request is
  made (checked on a production build, with and without the connection
  settings).
- **What counts as waiting** (`computeWaiting`, `lib/accountSync.js`, pure and
  tested): a piece whose fingerprint differs from the one in this device's
  record; a piece the record has but this device no longer holds, **if this
  session saw it deleted**; the technique library if its fingerprint differs;
  and a piece with no entry at all (a new piece, or one the first backup left as
  "different"), which goes up as an *add*. It's worked out at startup (once the
  sign-in is known), after every save, when the browser comes back online and
  when the window regains focus.
- **App.jsx only schedules.** The block after the technique save effect
  ("Keeping the backup current (Pass 111)", `App.jsx`): `refreshSyncInfo`
  (reads what's waiting, no network), `scheduleSync`, `runSync` and
  `noteLocalDeletions`, plus four effects. **The hook that watches for changes
  is declared after both save effects** (the `pieces` one and the technique
  one), so what it looks at has already been written to this device; it runs on
  `[pieces, technique, loaded]`. Everything a timer or listener needs lives in
  refs (`syncLatestRef` holds the newest pieces, technique and account), so a
  callback that fires later never sees stale state. `syncGenRef` is bumped
  whenever the account changes or signs out, which makes a run still in flight
  stop at its next item.
- **A quiet period, then each item "only if still at revision N".** A run
  starts 5 seconds after the last change, and never more than a minute after the
  first unsent one (so logging several things in a row is one upload). Each item
  goes through Pass 110's `changePieceRow`/`changeTechniqueRow`, or
  `addPieceRow` for an add (which now also returns the new row's revision), or
  the new `deletePieceRow`. The revision the database returns goes into the
  device record along with the new fingerprint. The app still never sends a
  revision of its own.
- **A deleted piece is sent as deleted, never removed** (Design D): the row gets
  `deleted_at` and stays, at the next revision. **Only a deletion this session
  saw counts** (`noteLocalDeletions` marks `deletedHere` in the record when a
  piece leaves `pieces`). A piece that is merely missing from `pieces`, because
  a load failed, say, is never treated as deleted: the first version of this
  rule would have marked the account's copy of everything deleted after one bad
  load. A deleted piece that comes back (an import, an undo) clears the mark.
- **Retrying.** A failed attempt (no connection, a server that isn't answering
  or is busy, a 5xx, a timeout, or something else the database objected to)
  leaves the item waiting. The next attempt is 30 seconds later, then 2 minutes,
  then every 10 minutes (`RETRY_GAPS_MS`), and the browser's online event retries
  at once and forgets the backoff. After two failed attempts in a row the status
  says "The account service isn't answering. Everything is still saved on this
  device." (a paused project looks exactly like no connection). Any success
  starts the count again. **A refusal is not a failure**: it never counts toward
  that and is never retried. The status code of each answer is kept
  (`status`), because Supabase's errors carry none of their own: a 5xx, 408, 429
  or no answer at all counts as "the service isn't answering"; anything else
  that isn't a refusal leaves that one item waiting while the others still go.
- **A refusal is checked before it is believed.** "Save only if still at
  revision N" being refused doesn't always mean another device changed
  something. The row is read again and judged (`judgeRefusal`): if it is
  **the same** as this device's copy (another tab of this browser got there
  first, or this device's own earlier upload landed but its note of it didn't),
  the row's revision is adopted and nothing is held; if the row is **gone** (a
  table wiped in the dashboard) it's put back, or for a deletion there's
  nothing left to delete; if it **differs**, or the account marks it deleted,
  the piece is **held**: marked "changed on another device" in the device
  record, never uploaded again (by this pass), this device's own copy left
  exactly as it is. The other pieces keep uploading. **The technique library can
  be held the same way.** Settling a held piece is Pass 112.
- **One banner, only for a held piece**, in the storage-error banner's style
  (`.storage-error-banner`): "1 piece changed on another device", the name(s),
  and "This device's copy is unchanged and hasn't been uploaded over the
  account's. Everything else keeps backing up. Settling this comes in a later
  update." It shows on every screen until Pass 112 can settle it. Nothing else
  shows in the sidebar or as a banner; the storage-error banner, manual export
  and the export reminder are untouched.
- **A quiet status line in the Account panel** (`describeSyncStatus`, first
  match wins): "The account service isn't answering...", else the held message
  ("1 piece changed on another device: Ballade No. 1"), else "N changes waiting
  to back up", else "Backed up just now" / "Backed up 3 hours ago". **While a
  piece is held its line replaces the backed-up one**, so "Backed up just now"
  isn't shown beside a piece that wasn't; to confirm other pieces are still
  going up, look at their revision in the account. Hidden before the first
  backup. The main button is disabled while an automatic run is going, and an
  automatic run waits for a manual backup instead of overlapping it.
- **Signing out stops uploads** (a run in flight stops at its next item, the
  timer is cleared, the status is hidden) and **leaves the device record alone**,
  so signing back in as the same account compares and finds what's waiting; a
  different account has no record on this browser and starts at Pass 110's
  question. Sign out is still this device only, and still leaves every piece
  and the technique library where they are.
- **"The same" means the same after a reload** (found in the browser, not
  planned). The app doesn't always hold a piece in the exact shape a reload
  gives it. A chunk's first practice record is created without `tier1Done` and
  `troubleSpots` (loading adds them as false and null), and a technique task is
  built without a `tempo` (loading adds null); the real technique block in the
  owner's own backups shows the second one. Compared as they stand, a piece
  uploaded and then simply reloaded looked changed and went up again: the next
  open of the app after most days of practice cost an extra revision with
  nothing changed (reproduced in the browser: revision 8 became 9 on a reload).
  Once a second device exists that would also have shown up as a false
  "changed on another device". So pieces and the technique library are
  **fingerprinted and compared in the form loading would give them**
  (`canonicalPiece`, `canonicalTechnique`: the same `validateAndMigratePiece`
  and `validateAndMigrateTechnique` the load uses, after the same trip through
  JSON), in "what's waiting", after an upload, when judging a refusal and in
  Pass 110's comparison with the account. **What is sent is unchanged: the app's
  own copy.** The first backup's read-back check stays strict for a row it has
  just written (it must be identical as stored, so a field quietly dropped on
  the way still counts as a mismatch, `exact` in `compareWithAccount`), while a
  row that was already there only has to match. Cost: about a tenth of a
  millisecond per piece (25 real pieces: 2.3 ms), worked out once per object.
  One difference this can't see: a field that loading would *drop* from the
  technique library (its own migration keeps only the fields it knows) isn't
  noticed as a change. Re-checked in the browser after the fix: a first log on
  a never-logged chunk uploads once and a reload uploads nothing; adding a scale
  uploads the technique once and a reload uploads nothing.
- **Size.** The main download grew by about 4.1 KB compressed (150,936 bytes
  here against 146,859 for `main` at the time, both built the same way); the
  library's own file is byte-identical (same name, 59,211 bytes) and is still
  downloaded only when needed. A signed-out visitor still downloads no library,
  but does download the sync code (it can't be left out of the main file
  without a second on-demand file; see the pull request).
- **Checked in the browser** (the real app and library against a local
  stand-in for the database, which behaves like it: the revision rule, the
  refusal on a stale revision and the "already exists" answer; rows the test
  could change by hand): nothing uploads before the first backup is checked;
  after it, a logged session goes up about 5 seconds later "only if still at
  revision N" and the row's revision rises by one; a pretend-paused service
  (every request answers 503) shows "isn't answering" after the second failed
  attempt, the attempts come at 30 seconds and 2 minutes, and the browser's
  online event uploads at once; changes made while the service is down survive
  closing and reopening the page and go up by themselves at the next retry; a
  deleted piece's row gets `deleted_at` and stays; a row changed by hand then a
  change to the same piece in the app is refused, read again, held, the banner
  names it, the account's row and this device's copy are untouched and the
  other pieces keep uploading (and the held one isn't tried again, also after a
  reload); signing out stops a run that was about to start, signing back in
  uploads what was waiting; a different account on this browser makes no
  request and sees Pass 110's panel. **Not yet seen on the real test project**:
  that needs the owner's sign-in (the checks are listed in the pass's pull
  request).
- **For Pass 112** (found here, not decided): (1) **Importing a backup
  re-stamps each piece's `createdAt`** (`handleConfirmImport`: `importedAt +
  index`), so a second browser that imports the same file holds pieces that
  differ from the account's copies by that field alone, and every one reads
  "different". Settling needs to decide whether that field counts. (2) The
  held list is only in the device record and the status/banner; settling needs
  the account's copy of a held piece, which this pass reads only to compare.
  (3) A held piece's `deletedHere` mark can be held too ("a piece deleted
  here"), and the status says so without a name. (4) The refusal judge and the
  "same after a reload" rule are the only places that decide two copies are
  the same; settling should reuse `samePiece`/`sameTechnique` rather than
  compare raw. (5) Two other things stay as they were: about fifteen native
  `window.confirm`/`alert` pop-ups elsewhere share the weakness described under
  Pass 110, and the first backup's "ask first" still lives in the handler.
  (6) **A false hold** (found after the browser checks and confirmed with a
  test; **left for this pass on purpose, decided by the user on 2026-10-03**,
  because nobody can reach accounts until Pass 114 and only the owner on test
  sites until then). If an upload reaches the account but its confirmation is
  lost (the connection drops, the laptop sleeps or the tab closes at that
  moment), this device's record still says the old revision and the next
  attempt is refused. If nothing changed on this device since, the row equals
  this device's copy and the revision is adopted (built and tested). **If more
  was logged in between, the row is this device's own earlier version, which
  differs from the current copy, so the piece is held as "changed on another
  device" by mistake.** Nothing is lost (the account keeps the earlier version,
  this device keeps everything), but the piece stops backing up until it's
  settled. Settling needs "the account's copy is an earlier version of this
  device's own data" anyway, to settle some held pieces without asking, so the
  same detection should prevent this false hold, for example by remembering a
  fingerprint of what each attempt sent since the last confirmed revision and
  adopting a row that matches one. (7) **The Account status line shows one
  message at a time** (not answering, else held, else waiting, else backed up),
  so while a piece or the technique library is held it hides both "N changes
  waiting" and "Backed up just now". It got in the owner's way three times in
  the preview checks. Also left for this pass on purpose (2026-10-03): show the
  held message and the normal line together when the Account panel is reworked
  for settling.
  **After Pass 112:** (1) was decided and built (a piece that comes from the
  account keeps the account's created date). (2) and (4) are built: Review reads
  the account's copy of a held piece, and comparing uses `samePiece` /
  `sameTechnique`. (3), (5), (6) and (7) were not part of Pass 112's card and are
  unchanged: a held piece's false hold is still possible (Review settles it, with
  a picker that isn't really needed), and the status line still shows one message
  at a time.

## Restore, get changes and settle (Pass 112)

What was built, and the small choices made building it. It's one flow with
three ways in, and it adds nothing to the account except marking a duplicate
copy deleted.

- **Three ways in** (`openAccountFlow`, `App.jsx`): (1) the welcome screen,
  when signed in and the account holds pieces, shows **Restore 12 pieces from
  your account** (the count comes from a light read that downloads no piece
  data, `countLiveAccountPieces`); (2) the Account panel, any time, has **Get
  changes from your account**; (3) the held banner and the Account panel show
  **Review** while anything is held as "changed on another device", and it looks
  only at what's held.
- **The flow.** It reads the account's rows (`fetchAccountCopy`), skips rows
  marked deleted, runs every other row through `validateAndMigratePiece`
  (`accountRowsToCandidates`), and hands them to the import path's own functions:
  `findMatchingPiece`, `mergeImportedPiece` and, for the technique row,
  `mergeImportedTechnique`. The same import modal shows what needs a decision,
  with the wording saying "your account" instead of "this file" where it has to.
  The decisions are made in `lib/accountSync.js` (`planAccountMerge`,
  `applyAccountMerge`, both pure and tested); `App.jsx` only runs it.
- **What each piece is** (the kinds, `walkAccountCandidates`): **new** (not here),
  **same** (already matches; also "same except for its created date", see
  below), **take** (the no-ask rule), **ask** (changed on both sides, or this
  device can't vouch for its copy) and **combine** (the same piece under a
  different id, matched by name).
- **The no-ask rule** (`canTakeAccountCopyWithoutAsking`; confirmed by the
  user 2026-10-03). A piece matched by id is replaced by the account's copy
  without a question only when **both** hold: this device has nothing waiting to
  upload for it (its fingerprint matches the device record) **and** the account
  has changed it since this device last synced it, **judged by the account's
  revision, not by either device's clock**. Nothing here can be lost, because
  nothing here was waiting. Everything else that differs gets the picker, even
  where the import path would have settled it by last-changed time: a piece that
  changed on both sides is always asked about. A re-break test (let the rule
  apply even with a change waiting) fails eight tests.
- **When there's no modal.** If nothing needs a decision (clean takes, pieces
  that already match, the technique library), "Get changes" and Review just
  apply it and say what happened in the page. A new piece, a piece changed on
  both sides, two copies to combine, or a piece deleted elsewhere opens the
  modal. Restore always opens it. The technique library gets a row in the modal
  only when merging it would change something here; otherwise it's merged
  quietly.
- **Created date** (confirmed by the user 2026-10-03). A piece that comes from or
  matches the account **keeps the account's created date**, so a restore matches
  the account exactly and nothing goes back up. A piece that matches the account
  except for its created date (what a file import leaves behind, since import
  re-stamps it) counts as the same: its date is set to the account's, quietly,
  and the result says so ("Matched the created date of 25 pieces to your
  account"). Importing from a file is unchanged: it still re-stamps.
- **After merging** (`applyAccountFlow`): the device record is saved FIRST, with
  each merged piece (and the technique library) at the revision the account was
  read at and the fingerprint of the account's copy (`withAccountCopyRecorded`);
  only then do pieces change. Whatever this device holds beyond the account's
  copy is therefore an ordinary change waiting, sent "only if still at revision
  N" by Pass 111, and a "changed on another device" mark is gone. **The order is
  load-bearing**: with state first, the automatic upload would see the merged
  pieces with no record, take them for new pieces, and hold each one.
- **The held mark clears when the merge is done**, not after the merged result
  has uploaded (the card's wording was "once its merged result has uploaded").
  The result uploads a few seconds later through the ordinary path, and a refusal
  then simply holds it again. Waiting for the upload would leave the mark on a
  piece with nothing to upload (one that already matched the account).
- **Restoring onto an empty device** opens a piece and brings up the regular app
  (sidebar included), and **counts as this device's first, checked backup**
  (decided by the user 2026-10-03, an exception to Design J's question, because
  everything on the device just came from that account), so what's changed there
  uploads by itself. A device that already holds pieces is not marked: the
  first-backup question still comes first.
- **Two copies of one piece** (a name match with a different id, `findMatchingPiece`):
  merged into this device's piece, which keeps its own id; the account's other
  row is then **marked deleted, never erased** (`markOtherCopiesDeleted`: only
  `deleted_at` is sent, only if the row is still at the revision it was read at).
  The result says "Combined the two copies of Ballade No. 1." Two safeguards
  beyond the card: the other row is **not** marked until this device has made its
  first backup (until then the combined piece can't go up to replace it; the
  result says so and a later "Get changes" tidies it), and **a piece here that the
  account marks deleted is never what another copy is combined into** (it is the
  extra copy that was marked deleted when two were combined elsewhere, so the
  surviving copy comes in as a new piece and the stale one is offered "Delete it
  here too"; found in the browser, the first version would have marked the
  surviving row deleted too).
- **Deleted on another device**: a piece the account marks deleted that's still
  here is listed in the modal with a **Delete it here too** button (and a note when
  it has changes the account never got). Nothing is removed unless that's
  clicked. The device forgets the piece first (`withPieceDropped`, without
  counting it as an upload), so no second "deleted" is sent. Deleting the open
  piece goes through `guardLeavingActiveWork` like every other way of leaving
  unfinished work. A piece this device deleted whose deletion hasn't gone up yet
  is never brought back by a restore.
- **Results show in the page**, never as a browser pop-up: the Account panel on
  Settings, and a dismissible banner elsewhere (including the welcome screen). The
  file import's `window.alert` is unchanged. A restore, "Get changes" and Review
  also pause the automatic upload and a manual backup while they read and apply.
- **Sessions would have been doubled.** `mergeImportedPiece` drops a session both
  sides hold by comparing its JSON text, which depends on key order; the
  database returns its rows with keys reordered, so every session in a merge was
  kept twice (caught by the first test). `withComparableSessions`
  (`lib/accountSync.js`) puts both sides' sessions in one key order before
  merging. The real fix is in `mergeSessionArrays` (`lib/storage.js`), which this
  pass's file list doesn't include; see "For later passes" below.
- **Checked** (my own runs; the owner's checks are in the pull request): unit
  tests for each rule above; the five breakages (the no-ask rule with a change
  waiting, the no-ask rule without the account having changed, no mark-deleted
  step for a name match, sessions not made comparable, deleted rows becoming
  candidates), each caught; and in the browser, against a local stand-in for the
  database and two separate browser origins as two devices: a restore onto an empty device
  (regular app, created dates kept, nothing re-uploaded, automatic backup on);
  a session logged on one device arrives on the other without a question; the
  same piece changed on both sides before either uploaded, the second upload
  refused and held, Review showing the picker, the merged piece (three sessions,
  no duplicates) uploading and the mark clearing; a piece with the same name made
  separately on each, combined, the extra row marked deleted and kept; a piece
  deleted on one device (and one marked deleted by a combine) listed on the other
  as "Deleted on another device" and removed only by the click; the technique
  library merged quietly and a held one settled by Review; imported-and-held
  pieces settled in one click; every piece's stored data identical on both
  devices (compared in the browser as data, key order aside, not through an
  export file; the technique library differed only in its own last-changed time);
  signed out, and a build with no account service configured (the live site's
  configuration): nothing changes.
- **For later passes** (found here, not decided): (1) **the two items left from
  Pass 111**: a false hold is still possible, and the status line still shows one
  message at a time. (2) **`mergeSessionArrays` should compare sessions by
  content, not by JSON text** (`lib/storage.js`). (3) **Two devices that both
  use the app will often hold each other's technique library**: its last-changed
  time and today's list are per device but are part of the shared row, so each
  device's upload can be refused by the other's. Review settles it with no
  question, since the merge never removes anything, but the banner will appear
  often; the real fix is to leave the per-device parts out of the comparison.
  (4) **A merge clears the piece's reschedule marker** (the import path does, for
  every merged piece), so a piece that was rescheduled on one device re-derives
  its schedule from scratch after "ask" or "combine" merges; "take" keeps it.
  (5) **A name match with a blank composer combines two different pieces that
  share a name** and marks one row deleted; the modal shows "Same piece, other
  copy" and the box can be unticked, but it's easy to miss. (6) **There's no way
  to keep a piece the account marks deleted** (an "undelete"); Review offers only
  "Delete it here too". (7) **The other row is marked deleted before the combined
  piece has uploaded** (a few seconds, once the first backup is done); the row's
  data stays, so it can be put back by hand. (8) The account code is now about
  13 KB compressed (Passes 110 to 112) in everyone's download, signed in or not.
  (9) **A combine that's declined (box unticked) comes back on every "Get
  changes".** Nothing remembers that two same-named rows are different pieces, so
  the window opens each time until the extra copy is combined (or marked deleted by
  hand), and the quiet path (no window) can't happen meanwhile. On a restore,
  unticking leaves that copy out of the new device altogether, so two genuinely
  different pieces that share a name (and share a composer, or have none) can't
  both be restored. Found in the owner's own checks of this pass (2026-10-05),
  where it made a step that expected no window open one. A "these are different
  pieces" answer, remembered on the device, would fix both.

## Account settings (Pass 113)

What was built, and the small choices made building it (docs/User-Flows.md,
flow 13, has the screen-by-screen version):

- **Where it lives.** Signed in, the Account panel (Settings) has a group of its
  own at the bottom, under a thin line: **Change password** and **Sign out of all
  devices**, then one plain line: "Changing your email or deleting your account
  isn't available in the app yet." Nothing else in the panel changed (compared as
  rendered structure against the previous version: the same except for that group;
  signed out, identical). The handlers are in `App.jsx` (`openChangePassword`,
  `handleSignOutAll`), the window is `ChoosePasswordModal.jsx` in a third mode,
  and the words are in `lib/backend.js`. Nothing here touches a piece, the
  technique library or the device record.
- **Change password** is the choose-a-password window with `mode="change"`: the
  new password twice, at least 6 characters (Supabase's minimum on the test
  project is 6), the same "too short" and "don't match" messages, the service's own
  message if its minimum is higher, and "Choose a different password from your
  current one." for the same password. **No current password is asked for.** Two
  differences from the other modes, both because there is no link to arrive from:
  the button says **Cancel**, not "Not now", and saving doesn't just close the
  window. It says "Your password is changed. You're still signed in on this
  device." and waits for **Done**. Saving changes only this account's password; this
  device stays signed in.
- **"Secure password change".** The Email provider has a setting by that name
  (Authentication → Sign In / Providers → Email). When it's on, Supabase refuses a
  password change unless the session was created within the last 24 hours, and
  answers `reauthentication_needed` ("Password update requires reauthentication").
  The app then says "For your security, sign in again before changing your
  password." with a **Sign in again** button, which closes the window and opens the
  ordinary sign-in window with the note "Sign in again to change your password. Then
  choose Change password once more." (the sign-in window itself is unchanged).
  Signing in creates a fresh session, so the second try goes through. Supabase's
  other route (a code sent by email, `reauthenticate()`) isn't used: it needs an
  email every time, and the built-in sender allows only a couple an hour. **The
  setting is off on the test project** (read 2026-10-05), so the owner's own check
  goes straight through; the prompt was checked against a stand-in only. The same
  button appears when the session has already ended elsewhere ("You're not signed in
  any more. Sign in again to change your password."), and a lost connection gets the
  usual "Couldn't reach the account service..." with no sign-in button.
- **Sign out of all devices** asks first, in the panel (never a pop-up): "This signs
  you out on every device, including this one. Nothing is deleted from any
  device." with **Sign out of all devices** and **Cancel**. Confirmed, it calls the
  library's `signOut({ scope: "global" })`. Like the ordinary sign-out it leaves this
  device's pieces, technique data and device record exactly as they are, and stops
  the automatic backup here (the account changed to signed out).
- **A lost connection is not a normal sign-out here.** The ordinary sign-out treats
  one as success (the library signs this device out first). For "all devices" that
  would be a lie: the library (the installed version) removes this device's sign-in
  even when it couldn't tell the service, so the other devices were never signed out.
  `handleSignOutAll` reads back from the library whether this device is still signed
  in and `describeSignOutAll` (`lib/backend.js`) says which case it is: done; signed
  out here but the service couldn't be reached or didn't confirm, so other devices may
  still be signed in; or nothing changed and this device is still signed in. The
  result shows in the Account panel, signed in or out, with a Dismiss link, and is
  cleared by signing in again.
- **It isn't instant on the other devices.** The service ends every session at once,
  but a device that's already signed in keeps working on its current access token
  (valid for an hour at Supabase's default, a project setting) until that runs out.
  The installed library keeps a session whose refresh was refused for as long as
  the access token is still valid, and signs the device out at the next refresh
  after it expires. Seen against the stand-in with a 100-second token: the other
  device stayed signed in until its token ran out, then showed signed out with all
  its pieces still there. **Until then it can probably still read and write the
  account's rows**, including Pass 111's automatic upload: Supabase's database rules
  go by the token's signature and expiry, not by whether its session still exists
  (a general property of these tokens; not tested here, since the stand-in doesn't
  check them). The notice says "Other devices can stay signed in for up to an
  hour." For anything quicker (a lost device), shorten the project's JWT expiry or
  ban or delete the user in the dashboard.
- **The email and delete line** is the proposed wording, used as given.

### Doing both by hand in the dashboard (Phase 1)

Whoever runs the project does these, in the Supabase dashboard (the test project
today, the production project after go-live), under **Authentication → Users**.

**Deleting an account and its rows**
1. Authentication → Users. Click the person's row. A panel opens on the right, headed
   by their address, with their **User UID**.
2. At the bottom of that panel, under **Danger zone**, press **Delete user** and
   confirm. It can't be undone.
3. Their rows go with it automatically: `pieces` and `technique` both reference the
   account with `on delete cascade` (checked in Pass 108), and the cascade runs inside
   the database, so the "nobody can delete a row" rules don't block it. This is the
   only way rows are ever really removed: the app only marks a piece deleted.
4. To check, in the SQL Editor: `select count(*) from pieces where user_id = '<the
   User UID>';` should say 0, and the same for `technique`.
5. Nothing on the person's own devices is touched. A device that's still signed in
   keeps working until its current sign-in runs out (up to an hour), then shows signed
   out, with its pieces still there.

**Changing an account's email.** The dashboard has no button for this (checked
2026-10-05 on the test project: the panel offers Reset password → Send password
recovery, Send magic link and, under Danger zone, Remove MFA factors, Ban user and
Delete user). Editing the address by hand in the database's `auth` tables isn't
described here: it isn't tested, and Supabase's own tools don't offer it. So an email
change is a **replacement of the account**, which loses nothing because the person's
pieces and technique library already live on their devices (the account is the
backup):
1. On the person's device, signed in to the old account, press **Get changes from
   your account** (Settings → Account), so anything only the account holds is on the
   device first.
2. Authentication → Users → **Add user** → **Send invitation**, to the new address.
3. The person opens the invitation and chooses a password. That signs them in to the
   new account on that device, replacing the old sign-in there. Nothing is moved.
4. On that device: Settings → Account → **Back up this device**. It's the first
   backup to this account, so it asks first, then copies the device's pieces and
   technique library to the new account. On each of their other devices: sign out of
   the old account, sign in to the new one, then Back up this device.
5. When the new account holds everything (**Get changes from your account** on a
   device says everything matches), delete the old account as above.

- **Checked** (my own runs; the owner's checks are in the pull request): against a
  local stand-in for the account service that answers sign-in, token refresh,
  password change and sign-out the way Supabase does, with the real app in the
  browser and two separate addresses as two devices: the new group and line appear;
  Change password with a too-short password, with the current password (refused,
  same words as the other modes), and with a new one (saved, still signed in, the old
  password refused at sign-in and the new one accepted); the "sign in again" route
  (the service asked for a recent sign-in, the window said so, Sign in again opened
  the sign-in window with the note, and the second try saved); a session the service
  no longer knew; no connection (usual message, no sign-in button); the sign-out
  question (Cancel sent nothing; confirming ended every session, the notice showed,
  and signing in cleared it); the other device staying signed in until its token ran
  out and then showing signed out with its pieces; no connection during "all devices"
  (this device signed out, the other sessions not, and the notice said so); the
  invitation window unchanged (same title, words, buttons and closing). The three new
  helpers in `lib/backend.js` were also checked with a scratch script, and broken
  seven ways on purpose, each caught. Signed in, the Account panel's rendered
  structure matches the previous version's apart from the new group; signed out it is
  identical. A build with no account service configured (the live site's
  configuration): no Account panel anywhere, no request to the account service, the
  library file never fetched. **There is no test file for this pass** (none is on its
  card, and `lib/backend.js` has none today), so these checks are not in `npm test`.
  `npm test` 1020/1020; `npm run build` succeeds; the main download is about 1.5 KB
  larger compressed (158.2 KB against 156.7 KB), the library file is unchanged.
- **For later passes** (found here, not decided): (1) **Changing an email and deleting
  an account in the app** stay Phase 3 (a real email provider; a "delete my
  account" database function). (2) **"Require current password when updating"** is a
  second setting on the Email provider (off on the test project, read 2026-10-05):
  when on, Supabase wants the current password with every change, so Change password
  would need a "current password" field (`updateUser` with `current_password`) and
  wording for its errors, and would fail with the generic "Couldn't save your
  password" until then. Decide before go-live whether to turn it on. (3) **Not
  checked on the real service:** whether Supabase ends other devices' sessions when a
  password is changed (the app says nothing about other devices on a password change);
  the stand-in doesn't model it. (4) After "Sign out of all devices" other devices work
  for up to the token's remaining life (above); a shorter JWT expiry is a project
  setting, not done. (5) **`lib/backend.js` has no tests**; a `test/backend.test.mjs`
  would cover these helpers and the older ones (`signInErrorMessage`,
  `setPasswordErrorMessage`, `parseAuthLink`). (6) `CLAUDE.md` has no "Since Pass 113"
  note (it isn't on the card's file list). (7) The ordinary sign-out still uses a
  browser pop-up for an unexpected failure (`handleSignOut`); the new handler never
  does. (8) The leaked-password check is Pro-plan only (read 2026-10-05), so it can't
  be turned on while the project is on the Free plan.

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
  run once in the SQL Editor. Then `0002_revision_counter.sql` (Pass 110), the
  rule that keeps each row's revision count: run once, after the first file.
  Applied to the test project on 2026-10-01. Two messages to expect when
  running it (also noted at the top of the file): the dashboard warns that it
  "includes destructive operations", which is a false alarm (the two `drop
  trigger if exists` lines drop only the rules the file itself creates; no
  table, column or row is touched); and the first attempt on the test project
  failed with a deadlock error (`40P01`), a collision with another process
  using the same two tables, because the file changes both in one go. It
  succeeded on a later attempt. **If the dashboard reports a deadlock (at
  go-live too), run the file again; if it keeps happening, run it in three
  parts, each on its own: the function, then the `pieces` trigger, then the
  `technique` trigger.** Each part touches one table, so it can't collide.
  Future changes go in new numbered files, applied to the test project first
  and to production at go-live.
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
