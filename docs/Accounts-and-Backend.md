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
[Keeping the backup current](#keeping-the-backup-current-pass-111)). Nothing
is downloaded into a device until Pass 112. The live site has no backend at
all: it saves everything to the browser only, as it always has.

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
- **112** Restore onto a new device.
- **113** Account settings (change email or password, sign out). **No
  in-app "delete my account" in Phase 1** (decided by the user,
  2026-09-29): the app's public key can't delete a sign-in account, and
  that needs code running inside Supabase with its admin powers. Until
  then, anyone who wants their account deleted asks, and the project owner
  deletes it in the Supabase dashboard (Authentication → Users). Their rows
  go with it automatically (checked in Pass 108).
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
