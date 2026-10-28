# Accounts and Backend

> **Purpose:** The technical design for optional accounts: signing in, and
> keeping a copy of every piece and the technique library in the account, on
> Supabase. The plain-language case for doing this at all, and the risks it
> has to guard against, is [SOW-Accounts-and-Sync.md](SOW-Accounts-and-Sync.md).
> **Audience:** Anyone building or changing Passes 106–118 (and the Phase 2
> passes after them), and anyone asking "where does my data live once I sign in?"
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

**Status: designed (Pass 105, 2026-09-27); Phase 1 built, and live since
Pass 114 (2026-10-10); Phase 2 well under way (Passes 115 to 123 live between
2026-10-14 and 2026-10-28).** Passes 106–113 built Phase 1 and Pass 114 put it live, see
[Pass plan](#pass-plan). Since Pass 108 a **test** Supabase project exists with
the tables and security rules, connected to preview sites and local
development (see [Setup](#setup-test-project)), and since Pass 114 a separate
**production** project is connected to the live site (see
[Setup (production project)](#setup-production-project)). **Since Pass 109, on
sites connected to a project, a person can sign in and out** (see
[Sign-in behavior](#sign-in-behavior-pass-109)), but signing in alone moves no
data. **Since Pass 110 a signed-in person can
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
**Since Pass 114 (2026-10-10) the live site is connected to the production
project**: a person with an account (invitation only, so far just the owner) gets
everything above there, and a signed-out visitor sees the app exactly as before.
**Phase 2 began with groundwork.** Pass 115 made "the same" and "changed"
trustworthy; Pass 116 made the app **notice**, quietly, that another device
changed something; and Passes 117 and 118 built the two engines that merge a piece
and the technique library part by part (see [Merging by part](#merging-by-part-pass-117)
and [The technique library by part](#the-technique-library-by-part-pass-118)).
**Since Pass 119 every tab of one browser stays in step and only one does the account
work** (see [Several tabs of one browser](#several-tabs-of-one-browser-pass-119)).
**Since Pass 120 changes from other devices can arrive by themselves, behind a
switch that is OFF by default** ("Update automatically from other devices" in the
Account panel; see [Changes from other devices arrive by
themselves](#changes-from-your-other-devices-arrive-by-themselves-pass-120)). With it
off the app behaves exactly as after Pass 116: it notices, and "Get changes" and
Review are the way in, still merging with the import path's own functions. With it
on, pieces that need no decision are brought in by themselves using the two engines;
a piece with a conflicting part is held, and Review (Pass 121) asks about each conflicting
part, one plain question at a time. **Since Pass 122 a piece deleted on one device is
deleted on every device, practice included, with a 30-day way back** (see [A piece deleted on
one device is deleted everywhere](#a-piece-deleted-on-one-device-is-deleted-everywhere-with-a-way-back-pass-122)).
**Pass 122b (live since 2026-10-27) makes the app remember what a person said no to, lets the most recent
reorder win as a whole list, and gives a piece held by a refused upload Review's plain
questions** (see [What the person said no to is remembered, and order follows
them](#what-the-person-said-no-to-is-remembered-and-order-follows-them-pass-122b)).
**Decided 2026-10-15, only partly built:** "the most recent change wins item by item"
(Decided 6 below) is built for a deletion and for a piece's place in the list; for a conflicting
part of a piece it is not: Pass 120 holds it and Pass 121 asks the person about it instead. See
[Pass plan](#pass-plan).

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
6. **Added 2026-10-15, for Phase 2: when two copies disagree, the most recent
   change wins, item by item, and other devices' changes are applied
   automatically** when the app is opened or returned to. Practice sessions and
   scales logged on either device are always kept (added together, never chosen
   between); a deletion is still marked, never erased. This **reverses** the
   2026-10-03 rule that disagreements are never settled by a clock (Pass 112). **It is
   only partly built (2026-10-26):** a whole-piece deletion wins (Pass 122) and the most
   recent reorder wins (Pass 122b); for a conflicting part of a piece the code still holds
   it (Pass 120) and asks (Pass 121). The
   reasoning, the cost accepted and four open questions are in
   [Decisions.md](Decisions.md#open-questions) ("When two copies disagree").

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
connected only at go-live (Pass 114, 2026-10-10); until then Vercel's
Production environment had no Supabase settings. So testing never touches
the account copy of anyone's real data, and accounts reached the live site in
one deliberate step rather than as soon as sign-in code was merged. (The design
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
  *Re-read 2026-10-10:* an older Supabase changelog and troubleshooting page
  still say 90 days, so treat the deadline the dashboard shows for the paused
  project as the truth.
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
  messages), and give Vercel's Production environment its two settings.
  Before this pass the live site had no backend. Built 2026-10-10; see
  [Setup (production project)](#setup-production-project). The security
  checks of Pass 108 became a script, `scripts/check-rls.mjs`, run against
  the test project and then production. **The production project stays on
  Supabase's Free plan** (decided by the user, 2026-09-29). That means it
  pauses after a week without use, and there are no automatic backups; see
  [Free-plan consequences](#free-plan-consequences).

Manual export and the export reminder stay throughout Phase 1
([SOW §6](SOW-Accounts-and-Sync.md#6-risks-and-things-that-could-go-wrong),
risk 1).

**Phase 2 — multi-device sync, and what happens offline** (begun; since Pass 120
changes can arrive by themselves, behind a switch that is off by default):
- **115** "Same" and "changed" you can trust: a lost confirmation no longer reads
  as a conflict, sessions are compared by content, the technique library's
  last-changed time is not a change, and the status line shows both messages.
  Built; see [Same and changed you can trust](#same-and-changed-you-can-trust-pass-115).
- **116** Notice, quietly, that another device changed something (one added line
  in the Account panel; nothing is applied). Built; see
  [Noticing that another device changed something](#noticing-that-another-device-changed-something-pass-116).
- **117** The merge-by-part engine for a piece, and `parts` in the device record.
  Built; **used by tabs of one browser (119), the automatic update (120) and Review's
  questions (121)**; see [Merging by part](#merging-by-part-pass-117).
  Shipped with it: a scheduler fix (a chunk done earlier than the day a
  reschedule places it on is not owed there).
- **118** The same for the technique library. Built; **used by the automatic update where
  the device record holds a base for the library (120)**. "Get changes" and Review still merge
  the library the older way (`mergeImportedTechnique`). See
  [The technique library by part](#the-technique-library-by-part-pass-118).
- **119** Keep every tab of one browser in step, and let only one do the account
  work. Built; see [Several tabs of one browser](#several-tabs-of-one-browser-pass-119).
  Nothing is applied from the account; it is the same-browser half of the problem.
- **120** Changes from your other devices arrive by themselves, **switched off by
  default**. Built; see [Changes from other devices arrive by
  themselves](#changes-from-your-other-devices-arrive-by-themselves-pass-120). Uses the
  busy test and the lease Pass 119 built, and the two engines; also made the check run
  every minute (decided 2026-10-15). **What it does not do** (deferred): ask about a
  conflicting part (121), deletions, remembered answers and combines (122), turning the
  switch on by default (124), live push. **The 2026-10-15 decision "the most recent
  change wins, item by item" is therefore not built yet:** a conflicting part is held.
- **121** A piece held with a recorded list of conflicting parts asks one plain question per
  part in Review, instead of the whole-piece picker. Built; see [Settling a held piece, one
  question at a time](#settling-a-held-piece-one-question-at-a-time-pass-121). It asks; it does
  not decide: **the 2026-10-15 "most recent wins" decision is still not built.**
- **122** A piece deleted on one device is deleted everywhere, with a way back. Built; see [A piece
  deleted on one device is deleted everywhere](#a-piece-deleted-on-one-device-is-deleted-everywhere-with-a-way-back-pass-122).
  It was split in two when its card was edited (2026-10-24): this is the deletions half.
  **122b** Built, live since 2026-10-27; see [What the person said no to is remembered, and order follows
  them](#what-the-person-said-no-to-is-remembered-and-order-follows-them-pass-122b): a remembered
  "no" for a declined combine or a new piece left unticked (and one button to take it back), the
  blank-composer "maybe the same piece" row, piece order that follows the person with no
  question, and plain questions for a piece held by a refused upload.
- **123** What happens offline: opening the app with no connection. Built, live since 2026-10-28; see [Opening the app with
  no connection](#opening-the-app-with-no-connection-pass-123): a small service worker
  (`public/sw.js`), the status wording "Working offline", and a documented way to turn the worker
  off everywhere.
- **124** Turning the automatic switch on by default, after a real-use trial on the owner's own
  two devices. Scoped, not built, and only on the owner's word. **On 2026-10-28 the owner chose to wait with
  the flip until Phase 3.** When it is built, the device record must remember an explicit OFF as well as an
  ON (today only an ON is stored: `autoUpdateOn`, `withAutoUpdate`, `changeAccount`), so it is more than one
  line; see [Decisions.md](Decisions.md#accounts-and-backend), "Pass 124 re-scoped".
- **126** The most recent change wins, item by item: the rest of the owner's 2026-10-15 decision (a part both
  devices changed differently is settled by recency instead of held and asked about; practice is combined,
  never chosen between). Scoped 2026-10-28, not built; its first step is the owner's choice of how "most
  recent" is measured. Placed ahead of 124's flip.

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
  two settings missing (a fresh checkout, `npm test`, the live site before
  Pass 114) no panel,
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
  Applied to production at go-live (Pass 114, 2026-10-10). It was checked in a real Postgres
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
  out, on a site with no account service (the live site until Pass 114), or
  before the first backup, nothing here runs: no
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
  that and is never retried (**one exception since Pass 122:** a *deletion* refused
  because the row has moved on is tried once more at the newer revision, see
  [Pass 122](#a-piece-deleted-on-one-device-is-deleted-everywhere-with-a-way-back-pass-122)).
  The status code of each answer is kept
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
  (3) ~~A held piece's `deletedHere` mark can be held too ("a piece deleted
  here"), and the status says so without a name.~~ **Gone in Pass 122:** a deletion
  refused because the row moved on is tried once more at the newer revision, and
  if that is refused too it stays waiting, so a piece deleted here is never held
  any more. (4) The refusal judge and the
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
  **Pass 115 settled (6) and (7)**, see
  [Same and changed you can trust](#same-and-changed-you-can-trust-pass-115).
  **After Pass 112:** (1) was decided and built (a piece that comes from the
  account keeps the account's created date). (2) and (4) are built: Review reads
  the account's copy of a held piece, and comparing uses `samePiece` /
  `sameTechnique`. (3), (5), (6) and (7) were not part of Pass 112's card and are
  unchanged: a held piece's false hold is still possible (Review settles it, with
  a picker that isn't really needed), and the status line still shows one message
  at a time (both as of Pass 112; **Pass 115 fixed both**, see above).

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
  is never brought back by a restore. **Since Pass 122** the window also has a
  **Keep it** button (a duplicate that a combine marked deleted gets only "Delete it
  here too"), and with the automatic switch on a deletion from the last 30 days is
  removed by itself instead of listed; see
  [Pass 122](#a-piece-deleted-on-one-device-is-deleted-everywhere-with-a-way-back-pass-122).
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
  pass's file list doesn't include; see "For later passes" below. **Fixed in Pass
  115:** `mergeSessionArrays` compares sessions by content and
  `withComparableSessions` is deleted, see
  [Same and changed you can trust](#same-and-changed-you-can-trust-pass-115).
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
  configuration before go-live): nothing changes.
- **For later passes** (found here, not decided): (1) ~~**the two items left from
  Pass 111**: a false hold is still possible, and the status line still shows one
  message at a time.~~ **Fixed in Pass 115.** (2) ~~**`mergeSessionArrays` should
  compare sessions by content, not by JSON text** (`lib/storage.js`).~~ **Fixed in
  Pass 115.** (3) **Two devices that both
  use the app will often hold each other's technique library**: its last-changed
  time and today's list are per device but are part of the shared row, so each
  device's upload can be refused by the other's. Review settles it with no
  question, since the merge never removes anything, but the banner will appear
  often; the real fix is to leave the per-device parts out of the comparison
  (since Pass 115 the last-changed time no longer counts; today's list and the
  walk position still do). **Seen live on 2026-10-15** (a phone left open during
  the Pass 118 deploy): it cleared with nothing to merge and did not clear by
  itself, see [Decisions.md](Decisions.md#open-questions), Pass 118 open item 9.
  (4) **A merge clears the piece's reschedule marker** (the import path does, for
  every merged piece), so a piece that was rescheduled on one device re-derives
  its schedule from scratch after "ask" or "combine" merges; "take" keeps it.
  (5) **A name match with a blank composer combines two different pieces that
  share a name** and marks one row deleted; the modal shows "Same piece, other
  copy" and the box can be unticked, but it's easy to miss. **Fixed in Pass 122b:** a
  match where either side has no composer is "Maybe the same piece" and starts unticked. (6) ~~**There's no way
  to keep a piece the account marks deleted** (an "undelete"); Review offers only
  "Delete it here too".~~ **Fixed in Pass 122:** a **Keep it** button, and a "Recently
  deleted" list that restores for 30 days. (7) **The other row is marked deleted before
  the combined piece has uploaded** (a few seconds, once the first backup is done); the
  row's data stays, so it can be put back by hand (**since Pass 122 the row also carries
  a `mergedInto` note**, so it is no longer mistaken for a deletion). (8) The account code is now about
  13 KB compressed (Passes 110 to 112) in everyone's download, signed in or not.
  (9) **A combine that's declined (box unticked) comes back on every "Get
  changes".** Nothing remembers that two same-named rows are different pieces, so
  the window opens each time until the extra copy is combined (or marked deleted by
  hand), and the quiet path (no window) can't happen meanwhile. On a restore,
  unticking leaves that copy out of the new device altogether, so two genuinely
  different pieces that share a name (and share a composer, or have none) can't
  both be restored. Found in the owner's own checks of this pass (2026-10-05),
  where it made a step that expected no window open one. A "these are different
  pieces" answer, remembered on the device, would fix both. **Fixed in Pass 122b.**

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

Whoever runs the project does these, in the Supabase dashboard (the test project,
and the production project since go-live), under **Authentication → Users**.

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

**Not yet rehearsed: test this before relying on it.** These five steps are written
from how each part behaves (an invitation, the first backup, deleting a user), but the
whole sequence has never been run start to finish. The invitation also opens the
project's Site URL, so the warning under [Setup (test project)](#setup-test-project)
applies (if that preview address is ever removed, change the Site URL before inviting).
**To rehearse it, on the test project, use two throwaway addresses and never your own
account:** step 5 deletes the old account and everything in it. A plus address
(`yourname+old@gmail.com`, `yourname+new@gmail.com`) reaches the same inbox. The
built-in email sender allows only a couple of messages an hour, so space the
invitations out. In a private window, with a small piece on the device: sign in to the
"old" address and back the device up, then run the five steps with the "new" address.
Then check that (a) the Account panel says "Signed in as" the new address; (b) **Get
changes from your account** says everything matches; (c) in the Table Editor, `pieces`
holds one row per piece for the new User UID; and (d) once the old account is deleted,
`select count(*) from pieces where user_id = '<the old User UID>';` says 0 while the new
account's rows are untouched. Delete the second throwaway account afterwards.

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
  configuration before go-live): no Account panel anywhere, no request to the account service, the
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
  password" until then. Left **off** on both projects at go-live (production read 2026-10-10), since the app sends no current password. (3) **Not
  checked on the real service:** whether Supabase ends other devices' sessions when a
  password is changed (the app says nothing about other devices on a password change);
  the stand-in doesn't model it. (4) After "Sign out of all devices" other devices work
  for up to the token's remaining life (above); a shorter JWT expiry is a project
  setting, not done. (5) **`lib/backend.js` has no tests**; a `test/backend.test.mjs`
  would cover these helpers and the older ones (`signInErrorMessage`,
  `setPasswordErrorMessage`, `parseAuthLink`). (6) `CLAUDE.md` had no "Since Pass 113"
  note when this pass was written (it wasn't on the card's file list); added
  with the Pass 114 docs. (7) The ordinary sign-out still uses a
  browser pop-up for an unexpected failure (`handleSignOut`); the new handler never
  does. (8) The leaked-password check is Pro-plan only (read 2026-10-05), so it can't
  be turned on while the project is on the Free plan. (9) **To test later: the
  email-change "replace the account" steps** have never been run start to finish; see
  "Not yet rehearsed" above for how (two throwaway addresses, never your own account).
  Do it once on the test project before relying on them; still not done at go-live (2026-10-10). From the
  review before this pass was merged, three smaller things, logged and not fixed:
  (10) **"Signed out of all devices" can be reported wrongly** if the service rejects
  this device's own sign-in: the library counts the service's "I don't recognise this
  sign-in" answers (401, 403, 404) as "already signed out" and reports success, so
  nothing was ended elsewhere. Needs this device's own sign-in to be rejected (for
  example a clock that is badly wrong), so it is unlikely. A fix would ask the service
  to confirm the sign-in (`getUser`) before ending everything. (11) **The "sign in
  again first" prompt has only been seen against a stand-in.** The setting is off on
  the test project and Supabase counts a sign-in as recent for 24 hours. To see it for
  real: switch on "Secure password change", use a Pass 113 window signed in more than a
  day earlier, press Change password, then switch the setting off again. If the wording
  differed from what the app looks for, the person would get the generic "Couldn't
  save your password" instead. (12) **The new buttons aren't on the welcome screen** (a
  device with no pieces can only do the plain Sign out, since Settings isn't reachable
  there), and a very long password (Supabase caps the length) probably gets the same
  generic message.

## Same and changed you can trust (Pass 115)

Three fixes to what "the same" and "changed" mean, made before any device
fetches changes by itself. Nothing here fetches or applies the account's
changes.

- **The false hold is fixed.** Before each upload attempt, the device record
  entry for that item (a piece or the technique library) gets the fingerprint
  of what's about to be sent, in a short list `sent` (the last 5, oldest
  dropped, no duplicates). A confirmed revision (`withPieceUploaded`,
  `withTechniqueUploaded`) replaces the whole entry, which clears it.
  `cleanEntry` (`lib/accountSync.js`) was taught `sent` and nothing else. When
  a refusal is read back (`judgeRefusal`), a row that matches this device's
  current copy OR any fingerprint in `sent` is this device's own earlier
  upload: its revision is adopted. If it matches only an earlier send, the
  record is written with the ROW's content fingerprint, so the piece stays
  waiting at that revision and what was logged since goes up. A row matching
  none of them is held, as before. Same rule for the technique row. One
  addition beyond the card: after adopting an earlier send, that one item is
  tried again straight away (once), because App.jsx doesn't reschedule a run
  that ended without a failure, so it would otherwise wait for the next change.
- **Sessions are compared by content.** `mergeSessionArrays` (`lib/storage.js`,
  now exported) compares sessions with key order ignored. The workaround
  `withComparableSessions` in `lib/accountSync.js` is deleted; the account-merge
  tests pass without it. **File import gets the same fix, so one thing changes:**
  two sessions that are identical except for key order used to both be kept and
  are now merged into one. A backup written by this app has a consistent key
  order, so this should be rare in practice.
- **The technique library's `updatedAt` is not a change** (`techniqueForComparison`,
  used by `sameTechnique` and `techniqueFingerprint` only). It stays in the row
  and in the app (`updateTechnique` stamps it on every change). **Nothing reads
  it to decide which side is newer** (grepped `lib/` and `App.jsx`: it's written
  in `updateTechnique`, passed through `validateAndMigrateTechnique`, and that's
  all). Today's list (`dayList`) and the walk position still count as changes,
  on purpose: Pass 118 decided how those merge (an engine only, not yet used;
  [below](#the-technique-library-by-part-pass-118)). Piece fingerprints are
  unchanged, so no piece re-uploads. **The technique fingerprint changes once,
  so each device uploads its library once after this ships** (the library's
  revision rises by one), then stays still (tested, including a new stamp).
- **The Account status line shows the held message and the normal line
  together** (`describeSyncStatus`): "1 piece changed on another device:
  Ballade No. 1. Everything else backed up 3 hours ago." With changes waiting:
  "... Ballade No. 1. 2 changes waiting to back up." "The account service isn't
  answering" still replaces both.

## Noticing that another device changed something (Pass 116)

The first piece of Phase 2: the app now **notices**, quietly, that the account
holds something this device hasn't got. It never applies anything. "Get changes
from your account" works exactly as in Pass 112, and is still the only way a
change arrives.

- **A light read** (`checkAccountChanges`, `lib/accountSync.js`). From `pieces`
  only `id, revision, deleted_at`, paged 50 at a time exactly the way
  `countLiveAccountPieces` pages; from `technique` only `revision`. It never
  selects the `data` column, so it costs a few hundred bytes however big the
  pieces are. It never throws and reports the same stopped reasons the other
  reads do (`connection`, `signed-out`, `other`). A 5xx, a 408/429 or no answer
  at all is `connection` (it reuses the uploads' `failureKind`), because the
  service answering with an error looks the same as it not answering.
- **A pure sorter** (`classifyAccountChanges({ rows, accountRecord,
  localPieceIds })`). Every piece lands in at most one list:
  `held` (already held as "changed on another device": known, shown by its own
  message, never counted again, whether or not it is also newer or deleted);
  `newer` (the account holds a live row at a higher revision than the record
  says this device last saw); `added` (a live row this device has neither a
  piece nor a record entry for); `deleted` (a row marked deleted that this
  device still holds); `needsReview` (this device holds it, the account has a
  live row, and the record has no revision for it: Pass 110's "different at
  first backup"). Plus `techniqueNewer` / `techniqueHeld` for the technique row.
  **A device's own upload is never newer**: the record takes the revision the
  moment the account confirms an upload, so the row and the record agree
  (tested end to end with a real upload through the stand-in database). A piece
  this device deleted (a record entry, no piece) is never "added", and a row
  *behind* the record's revision is never "newer". `needsReview` is worked out
  but not shown anywhere yet.
- **When it runs.** Only while signed in AND once this device's first backup is
  checked (the same gate as the uploads); never while the page is hidden; never
  while an upload run, a manual backup or "Get changes" is running (it looks
  again two seconds later). Triggers: at startup once sign-in is known (4
  seconds after, so an upload that is waiting goes first); the window regaining
  focus or the page becoming visible, **at most once a minute** (a return to
  the window fires both events; they make one request); the browser's online
  event, at once; and **every minute** while the page is visible (the page asks
  every 15 seconds whether one is due, which is only a look at the clock; **Pass 116
  shipped five minutes and a minute-long look, Pass 120 changed both**).
  The throttle lives in `createAccountChecker`, so every trigger meets the same
  rule and two checks never run at once; `checkIsDue` is the rule. Signed out,
  or on a build with no account service, no timer starts any request and the
  account library isn't loaded.
- **Rows read while this device was writing are not believed.** A check that
  overlaps an upload could read the row *after* the upload landed but sort it
  *before* the record knows, which would read as "newer". So the result is
  thrown away if an upload, a backup or "Get changes" is running when it
  returns, or the device record changed while it read (`checkRowsUsable`). The
  next trigger simply tries again.
- **A failed check is not an error.** It counts toward the same "isn't
  answering" count the uploads use (after two in a row the status line says so;
  it shows no error of its own), and a good one starts the count again, as a
  good upload does. Without that reset, a count raised by checks alone (nothing
  waiting to upload) could never clear.
- **The line.** One added status line in the Account panel, under the
  backed-up line: **"Changes from another device: 3 pieces. Press Get
  changes."** (or "...: 1 piece and the technique library." / "...: the
  technique library."). It counts `newer` + `added` + `deleted`; held and
  needs-review pieces have their own messages. No banner, no sidebar mark. The
  last light read is kept, and **re-sorted against the device record every
  time the status is refreshed** (`syncSnapshot({ accountRows })`), so the line
  goes away on its own once uploads or "Get changes" bring the record up to date,
  without another request.
- **Where the code is.** The read, sorter, throttle, outcome and wording are in
  `lib/accountSync.js` with tests (`test/accountSync.test.mjs`). `App.jsx` has
  only the scheduling ("Noticing that another device changed something (Pass
  116)", beside the upload scheduler), and `SettingsTab.jsx` the extra line.
- **Found, not fixed** (for the passes that follow): (1) **A lost confirmation
  can flash the line.** If an upload lands but its confirmation is lost, the
  record is one revision behind the row until the next upload attempt adopts it
  (Pass 115), so the line can say "1 piece" for up to a retry gap. It corrects
  itself. (2) **The technique library will often read "newer".** Each device
  rebuilds today's list and moves the walk position on its own and uploads, so
  two devices in use keep bumping each other's revision. That is the
  per-device-parts problem Pass 118's engine settles part by part (not yet used;
  Pass 120 wires it in). (3) **A piece the person declines
  in "Get changes" (an unticked new piece) is noticed again on every check**,
  the same family as the declined combine; it needs the remembered "no" of Pass
  122b (the second half of Pass 122's card). **Fixed in Pass 122b:** a piece left
  unticked is remembered and no longer counted. (4) ~~**A piece deleted here and
  changed elsewhere** (a record entry marked deleted here, a live row at a newer
  revision) is not reported; deletions are Pass 122.~~ **Fixed in Pass 122:** the
  deletion is tried again at the newer revision and goes through (a deletion wins), so
  there is nothing left to report. (5) The light read is paged by offset, so a row inserted between two
  pages can be missed or repeated for one check; the next check corrects it.
- **Checked** (my own runs; the owner's checks on the preview are in the pull
  request): unit tests for each rule above; four deliberate breakages, each
  caught (the check also selecting `data`, a device's own confirmed upload
  counted as newer, no one-minute throttle on focus, a held piece also counted
  as newer); and in a browser, the real app and library against a throwaway
  local stand-in for the database (not committed): a page that is hidden makes
  no request in over two minutes; a return to the window makes exactly one
  check (`select=id,revision,deleted_at`, then `select=revision`) and two more
  focus events seconds later make none; a piece edited, a piece added, a piece
  deleted and the technique row bumped "elsewhere" each show in the line; "Get
  changes" shrinks the line without another request (and a piece left unticked
  keeps being noticed, see above); the device's own uploads never show; the
  service stopped shows "isn't answering" after the second failed check and no
  error line of its own, and coming back clears it; with no account service
  configured, even with a saved session and device record present, no request
  at all. **Not seen on the real test project**: that needs the owner's sign-in
  and a second window.

## Merging by part (Pass 117)

The engine for merging two copies of one piece part by part, **and nothing else**:
no merge uses it yet ("Get changes" and Review still go through Phase 1's whole-piece
import merge; Pass 120 wires the engine in, Pass 121 asks the question; **since
2026-10-15 Pass 120 also applies it automatically and the most recent change wins
instead of a question**, see Decided 6 above). How it
works, the rules, and the simulation that checks it are in
[Algorithms.md](Algorithms.md#merging-by-part-pass-117). What this pass changes
about the account code:

- **The device record's entry for each piece gains `parts`**: `{ part: fingerprint }`,
  one for every top-level field except `progress`/`updatedAt`/`lastLoggedAt`, and one
  per progress entry (`progress:<id>`), **as last synced with the account**. No copy of
  the piece is kept, only labels. `cleanEntry` reads it back only beside a recorded
  revision, and only text values (an unreadable `parts` is dropped, which makes the
  piece "ask", never wrong).
- **Written wherever the record already records a piece:** a confirmed upload
  (`withPieceUploaded`, the parts of exactly what was sent), the first backup
  (`backUpDevice`), a restore or "Get changes" (`applyAccountMerge` ->
  `withAccountCopyRecorded`: the parts of the **account's copy**, not of whatever this
  device holds on top of it, because that is the state this device is synced to), and a
  refusal adopted as "the same" (the current copy). **One deliberate gap:** an adopted
  row that is only an *earlier version of this device's own piece* (Pass 115's `sent`
  match) is recorded with its content fingerprint but **no `parts`**, since they would
  describe a copy this device no longer holds; the immediate retry that follows records
  them when it confirms.
- **Pieces recorded before this pass have no `parts`.** A quiet step at startup
  (`withPartsRecorded`, `App.jsx`, once when pieces have loaded and accounts are on,
  no network) records them for every piece whose fingerprint still equals its
  record's: nothing has changed since the last sync, so this device's copy IS the
  synced state. A piece with changes waiting is left alone and gets its parts at its
  next confirmed upload; until then the engine answers `"ask"` for it. It works for
  every account in the record. Nothing about what's waiting changes (tested).
- **The comparing primitives moved.** `fingerprint`, `canonicalPiece` and the helpers
  under them now live in `lib/pieceMerge.js`, which the account code imports and never
  the other way round (the engine must not import the network code, and Pass 120 will
  make the account code import the engine); `lib/accountSync.js` re-exports them, so
  nothing that imported them changed. `canonicalPiece` now caches its result per piece
  object (like the fingerprint cache, relying on pieces never being edited in place);
  treat what it returns as read-only.
- **Size.** For the owner's 25 real pieces (the 2026-10-10 export): the device record
  was **2,201 bytes** and is **49,978 bytes** with parts (+47,777; 36 to 86 parts a piece,
  41 on average, 1,032 in all). It is written whole on every confirmed upload and read
  on every status refresh: reading it costs about 0.17 ms, and the startup step for all
  25 pieces about 9 ms. If it ever matters, a part's label could be one 53-bit hash
  instead of two (31 per cent smaller on these pieces); not done, because a false "unchanged" in
  a merge decision is the worse error.
- **Checked on the real export** (counts only, no piece data printed; nothing is
  uploaded or stored): each of the 25 pieces, run through the engine as `local` and as a
  copy with one session added to a different chunk on each side: merged cleanly, every
  session present, no conflict, unchanged by `validateAndMigratePiece`, and the same with
  the two sides swapped (25 of 25 each). As a control, one session added to the **same**
  chunk on both sides is a conflict for that chunk only (25 of 25).
- **Not built, on purpose** (see the pass's deferred list): using the engine from "Get
  changes" or anything automatic (120), the question the person is asked (121; since
  2026-10-15 reduced to what "most recent wins" can't settle), the technique library
  (118), deletions (122).

## The technique library by part (Pass 118)

The engine for merging two copies of the technique library part by part, **and
nothing else**: no merge uses it yet (backups, "Restore" and "Get changes" still use
`mergeImportedTechnique`, unchanged; Pass 120 wires the engine in). How it works, the
rules, the walk and the simulation are in
[Algorithms.md](Algorithms.md#merging-the-technique-library-by-part-pass-118); what
people will see of it is in [Technique-Practice.md](Technique-Practice.md#on-more-than-one-device-pass-118).
What this pass changes about the account code:

- **The technique entry in the device record gains `parts`**: `{ part: fingerprint }`,
  as last synced with the account, exactly as a piece's entry does since Pass 117 (no
  copy of the library is kept, only labels; `cleanEntry` reads it back only beside a
  recorded revision, and only text values). The parts are listed in
  [Algorithms.md](Algorithms.md#parts-1): per scale (its settings, its tempo check, its
  practiced dates one by one, the date each method was last used on it), per method, the two settings, the
  walk, and per task on today's list (by date and scale).
- **Written wherever the record already records the library:** a confirmed upload
  (`withTechniqueUploaded`, the parts of exactly what was sent), the first backup
  (`backUpDevice`), and a restore or "Get changes" (`applyAccountMerge` ->
  `withAccountCopyRecorded`: the parts of **the account's copy**, not of whatever this
  device holds on top of it). **The same deliberate gap as for a piece:** an adopted
  row that is only an *earlier version of this device's own library* is recorded
  without `parts` (they would describe a copy this device no longer holds); the
  immediate retry that follows records them when it confirms.
- **A library recorded before this pass has no `parts`.** `withTechniquePartsRecorded(record,
  technique)` (pure, `lib/accountSync.js`) records them for every account whose entry
  still equals this device's library (nothing has changed since the last sync, so this
  copy IS the synced state), for every account in the record, and leaves a library
  with changes waiting alone. **`App.jsx` does not call it yet**: that one line belongs
  beside the startup step for pieces (`withPartsRecorded`), and `App.jsx` was outside
  this pass's list, so it is for Pass 120. Until then such an entry gets its parts at
  its next confirmed upload, and the engine answers `"ask"` (and the caller falls back
  to `mergeImportedTechnique`) for it. Nothing about what's waiting changes (tested).
- **`canonicalTechnique` moved** to `lib/techniqueMerge.js`, which the account code
  imports and never the other way round (as for `canonicalPiece`); `accountSync.js`
  re-exports it, so nothing that imported it changed. It is **not cached** (a library is
  small, and a caller may change an object between calls); a test pins that
  `accountSync.canonicalTechnique` is the one function.
- **"The same by parts" is not "the same fingerprint".** A method switched on and off
  again leaves an entry holding the defaults; the parts call that the same as no entry
  (so two such libraries are `"identical"`), but the whole-library fingerprint
  (`techniqueFingerprint`) still tells them apart. **Pass 120 reads `"identical"` as
  in sync** (record the account's revision, don't upload) rather than expect the
  fingerprints to match; a test pins the difference so it can't be missed. **Pass 120
  first shipped without this** (found in its own review, 2026-10-19): `applyAccountMerge`
  recorded the account's fingerprint, so the device's own library read as a change
  waiting, uploaded, and the other device did the same: the account's revision went 2 to
  10 in eight rounds with nothing changing. Now an automatic apply records the
  fingerprint of the library it keeps when that equals the account's by parts
  (`inSyncByParts`); three tests pin it, two of which fail without the line.
- **Size.** For the owner's real library (48 scales, the 2026-10-10 export): **260
  parts, 14,805 bytes** in the device record, on top of the pieces' 50 KB (Pass 117).
  Computing them takes about 1 ms and one merge about 2 ms. The main download grew
  by about 2.5 KB (0.8 kB gzipped); the separate sign-in library file is unchanged.
- **The library's whole fingerprint changes once.** Every scale gains `lastCheckedAt`
  (the exact time a tempo was logged, empty for one saved before this), so
  `techniqueFingerprint` reads every existing library as changed and **each device
  uploads its library once after this ships** (the same one-off as Pass 115's
  `updatedAt` change). `lastCheckedAt` is part of the `check` part, so nothing else about
  the parts changes (still 260 for the real library). A device running the previous build
  drops the field when it loads a library (its loader doesn't know it), so the "later
  logged tempo wins" rule has nothing to compare for a tempo that device logged; the
  site is one build, so this only lasts until its page reloads.
- **Checked on the real export** (counts only; no scale, tempo or date printed;
  nothing uploaded or stored): the technique block merged with a copy where one scale is
  starred on one side and a different scale is checked off, at a tempo, on the other:
  merged with no notice and nothing to decide, all 48 scales kept, starred 0 to 1, done
  0 to 1, tempos 10 to 11, practiced dates 10 to 11, methods last used 40 to 44, nothing
  went backwards, unchanged by `validateAndMigrateTechnique`, the same library whichever
  device does the merge, merging the result again changes nothing, and a remote equal to
  the base returns this device's library untouched. The walk, on the same library: the
  same key-of-the-day task done on both devices steps it once (not twice), and an undo on
  one device travels (the walk goes back with it). That library's list has only one task
  that steps the walk, so "two different tasks in the key, one on each device" was
  exercised by the tests and the simulation, not on this data.
- **Not built, on purpose** (see the pass's deferred list): using the engine from "Get
  changes" or anything automatic (120), showing the notices (120), a per-device setting
  for scales per day, trimming a merged list down to `scalesPerDay`, combining two
  scales added apart for the same key, and any change to how backups merge the library.

## Several tabs of one browser (Pass 119)

Every tab of one browser shares one `localStorage` but keeps its own copy of the pieces
in memory. Until this pass nothing noticed another tab's writes, and two tabs on the
account's sign-in each ran the automatic upload and the look at what other devices
changed. This is the same-browser half of "two copies disagree"; it touches nothing in the
account.

**Confirmed first (2026-10-16), before any change.** (1) By reading the code: nothing in
`src/` listened for the `storage` event (the only listeners were `online`, `focus` and
`visibilitychange`). (2) By a scratch reproduction, using the real `loadPiecesFromStorage`
and `savePieceChanges` against a fake in-memory storage (no real data): two tabs open the
same piece; one logs a session; the other, not told, logs a session on another chunk;
storage then held only the second tab's session, the first was gone. And: one tab deletes
the piece; the other logs on its stale copy; the deleted piece was written back into
storage. Both are the failures the rest of this pass closes.

**What was built** (`lib/tabSync.js`, plain functions; `App.jsx` only schedules them):

- **The decision, `reconcileFromStorage({ inMemory, inStorage, lastSaved })`**, for
  pieces and for the technique library. `lastSaved` is what this tab last saved or loaded
  (`lastSavedPiecesRef`, and a new `lastSavedTechniqueRef`). "Unsaved change" always means
  different **content** (Pass 117's parts), never a different object, so a no-op update
  that only moved `updatedAt` is not a change. Per piece:
  - storage as this tab left it: nothing to do;
  - changed in storage, nothing unsaved here: **reload** it, through
    `validateAndMigratePiece` as a normal load does;
  - gone from storage (another tab deleted it): **remove** it here too, and never write it
    back. This holds even when this tab has an unsaved change to it;
  - new in storage: **add** it;
  - changed in both: **merge** by part with Pass 117's engine, **base = the copy this tab
    last saved**; this tab's value wins where both changed the same part (it keeps its
    copy), and the conflict is listed in the result;
  - this tab deleted a piece that another tab changed (the delete not written yet): **the
    delete wins**, nothing resurrects it;
  - an entry in storage that can't be read, or isn't a usable piece, is never treated as a
    deletion; **nor is storage that can't be read at all** (found in the pre-commit review:
    it would have removed every piece from the screen).
- **Two tabs logging on the SAME chunk would have lost a session.** Pass 117's engine treats
  one chunk's whole progress entry, its sessions included, as one part, so the same chunk
  logged in both tabs is a conflict and the engine keeps one side's entry whole. For a
  conflicted progress entry `tabSync.js` therefore keeps this tab's entry **and adds the
  sessions, done days and focus-spot sessions the other tab added since the last save**
  (compared by content, ordered by `loggedAt`). Anything one side removed since then stays
  removed (an undo is not undone). The entry's ladder state (stage, due date, tempo) stays
  this tab's: it is derived from the sessions, and rebuilding it is not this pass's job.
  Found by reading the engine's result for the pass's own scenario; **Pass 120 meets the same
  thing** (see "For later passes").
- **The technique library** uses `planTechniqueMerge` with the roles swapped (storage as
  "local", this tab as "remote"), because that engine keeps the *remote* side's value where
  both changed the same thing and here this tab's unsaved choice is the one to keep.
- **The write-time guard: built (the recommended option), not the cheap one.** Before a tab
  writes a piece, `guardPieceWrites` runs the same decision on the pieces about to be written;
  anything that would reload, remove, merge or be deferred is **held**: not written, and the
  tab reconciles instead. The storage event alone leaves a gap of a few milliseconds (an
  event not yet delivered, or never delivered to a tab that was frozen in the background)
  in which the second tab's write would overwrite the first's. **What it costs, measured:**
  a first version parsed, migrated and fingerprinted the stored piece on every save, which
  took about **4.5 ms** for a heavy piece (180 KB, 1,600 sessions), not the 0.1 ms an earlier
  pass measured for a normal one. Almost every save finds storage exactly as this tab wrote it,
  and then the stored text is byte-for-byte `JSON.stringify` of the copy last saved, so that
  is checked first (**0.22 ms** for the same piece, about what the save's own `stringify`
  costs) and the full comparison runs only when the text differs: another tab wrote, or the
  copy was loaded rather than saved (once). It is the same decision as the event handler's, so
  the two can't disagree. The technique library has the same guard (`guardTechniqueWrite`).
  **Two direct writers go through it too:** importing a backup and "Reschedule all" write
  piece keys straight to storage before their state is set; both now go through one small
  helper (`writePieceDirect`, `App.jsx`), which leaves the write to the save effect (and so
  to the merge) when another tab changed that piece.
- **How a result is applied (`App.jsx`, `runTabSync`).** One function, whoever asks: another
  tab's `storage` event, the guard holding a write, a piece that was in use becoming idle,
  or this tab taking the lease (a full catch-up). It reads storage, asks the library, and
  applies the answer through the usual setters; it never writes: the save effects do, after
  the result has landed, and a copy adopted as-is is not written back. Two details that
  matter: the "last saved" copy only moves when the committed state really holds the new
  copy (`settleBaselines`: a promise per piece, kept until it is true), so a result that
  couldn't be applied can't let a later write slip past; and a result is applied only to a
  copy that is still the one it was worked out from (`applyPiecesResult`), so an update React
  hadn't applied yet is never overwritten. A piece the other tab deleted takes its screens
  with it (the open piece switches to another, or the welcome screen); a piece that arrives
  on the welcome screen becomes the open piece.
- **The busy test (`isPieceBusy`, `busyPieceIds`), built once in `lib/tabSync.js` for Pass 120
  to import.** A piece is in use while: an unconfirmed Interleaved attempt exists
  (`interleaveRisk`), a reassessment timer is running (`assessmentTimerRisk`), or the Edit
  piece settings draft is open for it (`settingsEditing` with `editDraft.id`). The first two
  belong to the active piece. **Nothing is applied to a busy piece, whatever it would be**
  (reload, merge, removal): the change is remembered (`deferredTabSyncRef`) and applied when
  it is idle (an effect on those states). **Its write is held too** while storage has moved
  under it, because writing would overwrite the other tab's change and merging would be
  applying. The cost: if this tab closes or crashes while a piece is busy and storage has
  moved, what was changed on that piece in the meantime (provisional attempts, in
  practice) was never saved. Nothing of the other tab's is lost.
- **The lease: one tab does the account work.** `createTabLease`: a record in `localStorage`
  (`measureone-tab-lease`, `{ tabId, at }`). The holder writes a heartbeat **every 10
  seconds**; any tab may take it over once it has gone **30 seconds** without one; a closing
  tab removes it at once (`pagehide`). Every tab looks every **2 seconds** (a takeover is
  never later than 30 + 2 + 0.25 seconds). `localStorage` has no atomic "create if absent",
  so a tab claims (writes its id), waits 250 ms and looks again; only if the record still
  names it does it believe it holds the lease (two tabs that claim at once: the last write
  stands). **A look that arrives during the wait (a storage event, the tab becoming visible)
  does not cut it short**: found in the pre-commit review, where it let two tabs briefly
  believe they both held the lease. A lease stamped in the future (a clock set back) is not honored. The Web Locks API
  is not used (not in Safari 14, the build target). **Only while signed in to an account
  service**: signed out, or in a build with no connection settings, there is no lease key, no
  timer and nothing else changes.
  - **What a tab without the lease does not do:** the automatic upload (`runSync`, and
    `isCancelled` between items so a run in flight stops when the lease is lost) and the look
    at what other devices changed (`requestCheck`). Both re-check the lease at the moment they
    run (`holdsNow`), not a flag. **It still reloads what the holder saves** (the `storage`
    listener is in every tab).
  - **Taking the lease** first catches up with storage (a full `runTabSync`, because this tab
    may have missed events), then starts the upload and the look again. Losing it stops what
    this tab had going.
  - **Not gated, on purpose:** the buttons a person presses (Back up this device, Get changes,
    Review) work in any tab: they asked for them. And two small writes to the device record
    stay in every tab: noting a deletion (`noteLocalDeletions`: a tab without the lease that
    deletes a piece must still record it, or a later Get changes would bring the piece back)
    and the startup `withPartsRecorded`. Both are a read and a write in one synchronous step.
- **Pass 120 reads `holdsLease()` and the busy test.** Pass 120's automatic apply must run only
  in the tab that holds the lease and must skip busy pieces; both are in place for it.

**Checked.** `test/tabSync.test.mjs`, 72 tests: the busy test; every decision above (including
a deletion, a change in both, the same chunk in both, a grid change against progress and a busy
piece); applying and settling; the guard; two tabs sharing one storage through the real
`savePieceChanges` (a model of the few lines of glue `App.jsx` runs); a seeded run of two tabs
logging on random chunks with events arriving at once, late or never (200 seeds committed, 6,000
run: no logged session is ever lost and both tabs and storage end up the same); and the lease
against a fake clock (one holder, a takeover only at 30 seconds, an old holder that wakes late, a
claim at the same moment, a release on close, a clock set back, storage that throws). **Re-broken on
purpose, and each caught:** the reconcile keeping the older copy and writing it back (17 tests fail, the
two tabs rewrite each other forever); two tabs able to hold the lease at once (4 fail). In the
browser (the real app, two tabs of one browser on a scratch origin, real clicks): a session logged in
one tab appeared in the other without a reload, with the ladder state; a session logged in the second
right after kept the first's; a real race (the second tab's event listener switched off, then the
same chunk logged in both) left all three sessions in storage and 22 minutes in both tabs; a piece
deleted in one tab left the other (its settings draft open, so it waited, then left when the draft
was discarded) and did not come back when the other tab wrote; a piece added in one tab appeared in
the other; a scale added to the technique library appeared in the other tab. With a local stand-in for the
account service (a made-up saved session, nothing typed): the first tab took the lease and uploaded;
a second tab made no account request in 25 seconds; a session logged in the second tab was uploaded
by the first ("only if still at revision 1"); with the holder gone without releasing, the second tab
took over **30.6 seconds after the last heartbeat** and then looked and uploaded itself; a holder that
navigated away handed it over in 0.5 seconds. Signed out (account build) and with no account
service: tabs stay in step, no lease key, no account request. **Not seen on the real test project.**

**For later passes** (found here, not decided):

1. **Pass 117's engine merges one chunk's whole progress entry as one part, so two devices that
   log on the same chunk conflict.** That is the common case on a real two-device day, not an
   edge. Pass 120's "most recent wins, item by item" applied to that part would drop one side's
   sessions, which the same decision says must always be kept. `foldConflictedProgress`
   (`lib/tabSync.js`, not exported) does the right thing for tabs; Pass 120 needs the same fold,
   so it should be moved into `lib/pieceMerge.js` (not touched here) or exported.
2. **A grid change in one tab against progress in the other can't be put together**
   (the engine's "travel together" case, Decisions.md open item (i)). For tabs this tab's copy is
   kept, so the other side's sessions (keyed by the old chunk ids) are dropped; it is reported in
   the console only (a visible notice is deferred). It needs a window of a few milliseconds
   (a save of Settings' structure fields in one tab against an undelivered log in the other),
   but the answer is not settled.
3. **The technique engine's conflict rule is "the account's value wins".** Pass 120's "most recent
   wins" replaces it; tabs already use the swapped roles.
4. **No catch-up when a tab regains focus.** A tab frozen in the background that missed events
   catches up at its next write (the guard) or when it takes the lease. Adding one on
   `visibilitychange` would be a few lines; it was left out of this pass's list.
5. **The write guard still has a gap** of the cross-process delay of `localStorage` itself
   (a tab can read a copy a few milliseconds old); the event, the guard and the next catch-up
   shrink it, they don't close it. It was the "rare same-piece race" the cheaper option accepts;
   this one is rarer.
6. **Writes to the device record in a tab without the lease** (noting a deletion, the startup
   parts) are a read and a write in one synchronous step, so a clash with the holder's write is
   very unlikely, not impossible. Gating them would make a deletion in a follower tab depend on
   the holder noticing it by event.
7. **A dead holder is waited out** (30 seconds); only a page that fires `pagehide` hands it on
   at once. A page closed by a test harness doesn't fire it.

## Changes from your other devices arrive by themselves (Pass 120)

A switch in the Account panel, **"Update automatically from other devices"**, **off by
default**. With it off nothing in this section happens and the app behaves exactly as
after Pass 116 (it notices, and Get changes is the way in). With it on, what the check
finds is brought in without a button, in about a minute. The deciding is in
`lib/accountSync.js` (tested); `App.jsx` schedules it.

**What was built**

- **The switch is on this device only.** It lives in the device record, per account
  (`accounts[userId].autoUpdate`, kept only while on, so an old record and a switched-off
  one read the same), never in the account. `autoUpdateOn` / `withAutoUpdate`. **Every
  function that rebuilds an account's entry must carry it over** (`changeAccount`,
  `withBackupRecorded`): every upload goes through them, and one that forgot it would
  switch the person's choice off on the next upload. A test updates the record every way
  there is and checks it stays. The switch is offered once this device's first backup is
  checked (the check that drives it only runs then).
- **The check runs every minute** (decided by the owner, 2026-10-15): `CHECK_EVERY_MS`
  60 s (was 5 minutes) and `CHECK_TICK_MS` 15 s (was a minute; a look every minute would,
  with timer drift, space checks one to two minutes apart). Focus and the online event
  keep their rules (at most once a minute; always). It applies with the switch on or off,
  since the same check drives Pass 116's line. Cost, checked 2026-10-15 on
  supabase.com/pricing: a check reads only ids, revision numbers and deleted dates, about
  3 KB; the Free plan lists unlimited API requests and 5 GB of data out a month, so a
  device open and visible for hours a day uses well under 1%, and the Free plan never bills.
- **One apply step.** After a usable check `runAutoUpdate` (App.jsx) works out the targets
  (`autoUpdateTargets`: the pieces the account holds at a higher revision, the ones it
  holds that this device doesn't, and the technique row if newer; **never** a held piece,
  or one with no recorded revision; **a piece deleted elsewhere was never a target in
  Pass 120 and since Pass 122 is one when the deletion is from the last 30 days**), fetches **only those rows'
  data** (`fetchChangedAccountRows`: `id in (...)`, 50 ids a page; the technique row only if
  newer) and calls **`applyAccountFlow({ automatic: true })`, the same function Get changes
  uses** (there is no second one). It saves the device record BEFORE any piece changes
  (Pass 112). It runs only in the tab that holds the lease (the check does).
- **What applies by itself, and what never does** (`applyAccountMerge`, `automatic`):

  | the piece is | result |
  |---|---|
  | only in the account | added |
  | already the same | recorded |
  | unchanged here, newer in the account (the Pass 112 no-ask rule) | the account's copy is taken |
  | changed on both sides and **every part merges cleanly** (Pass 117's engine, base = the recorded `parts`) | merged; the account's copy is recorded and what is held beyond it goes up as an ordinary change |
  | changed on both sides with a **conflicting part** (or a grid change against progress) | **held**: this device's copy untouched, the conflicting parts kept in the record entry (`conflicts`, fingerprints only) for Pass 121; the red banner and **Review work exactly as today** |
  | changed on both sides, but the engine can't tell (no recorded base) | left for the person (Get changes) |
  | the same piece under another name | **never by itself**: a combine is always asked |
  | already held | left for Review |
  | deleted elsewhere | **Pass 120: listed as today** ("Changes from another device: 1 piece. Press Get changes."); nothing was removed. **Since Pass 122:** removed by itself when the deletion is from the last 30 days, even with practice here that was never backed up; an older deletion and a combine's duplicate are listed with "Delete it here too" and "Keep it", and nothing is removed |
  | the technique library | merged by Pass 118's engine where a base is recorded, the import merge (which never asks) where not; a held library waits for Review |

  **Get changes and Review do not use the engines** (the `automatic` flag is off), so
  they ask exactly what they always asked.
- **Merge before upload.** With the switch on, an upload run (`runSync`) first takes **one
  fresh light look** at the account, and if that brings anything in, stops there: the
  merged result goes up in the next run, after the usual quiet period. Then a piece that
  still has a change waiting here and a newer copy in the account (`needsMergeBeforeUpload`)
  is left out of the run instead of being sent to be refused (`syncWaitingChanges` takes
  `skipPieceIds`), and the rest go up. A refusal is still judged and held, as the last
  safety net. **Why a fresh look and not only "the latest check":** that check can be a minute
  old. Two devices that log within a few seconds of each other would then upload without
  knowing, the second would be refused and held, and the "merges quietly" case would end
  in a red banner. With the fresh look the second device sees the first's upload, merges,
  and uploads the merged result once (seen in the browser, below). **Cost:** one extra
  3 KB read per upload run while the switch is on (an upload run follows a quiet period
  after a change, not a timer).
- **Safe moments.** A piece **in use** is not touched, using Pass 119's shared busy test
  (`isPieceBusy`): an unconfirmed Interleaved attempt, a running reassessment timer, an open
  Edit piece settings draft for that piece. Its change is **deferred**: not applied, and
  **not recorded**, so the next run finds it again. It is applied when the person is done
  (an effect on those states). **A running practice timer and half-typed reps and BPM on
  that piece's checklist cards survive the piece being replaced** (checked in the browser;
  cards are keyed by chunk and role, so a card that keeps its place keeps its own state,
  also when the other tab logged that very chunk), so they are **not** in the busy test.
  What was not tried: a change that moves a card (a reschedule, a role change), which would
  remount it.
- **A plan that went stale** (the piece was replaced between planning and applying, which
  Pass 119's tab sync can cause) is redone against the copy that is there now
  (`reapplyOnto`): a clean merge is used; anything else leaves the current copy alone and
  holds the piece. A newer change is never overwritten.
- **Telling the person.** The Account panel says **"Updated from another device: Ballade
  No. 1, and the technique library."** (dismissible; never a page-wide banner, unlike Get
  changes' result). Only if the piece that is OPEN changed, one quiet line at the top of
  the page: **"This piece was updated from another device."** (dismissible; it goes when
  another piece is opened). While a change waits for a piece in use, the panel says
  **"Changes to Ballade No. 1 will be applied when you're done with it."** **Proposed in the
  card, to be confirmed by the owner.**
- **Pieces left for the person are not re-fetched every minute:** they are remembered at the
  account revision they were left at.
- **Startup records the technique library's parts too** (`withTechniquePartsRecorded`: Pass
  118 built the step and left the call for this pass), so there is a base to merge from.

**Checked.** `test/accountSync.test.mjs`, 208 tests (33 new): the switch (default off,
per account, kept through every record update, round trip, junk reads as off); held
conflicts kept and dropped; which rows are targets (switch off: none); each kind of item
(taken, merged, held, left for the person, a combine, deferred while in use and applied when
free); the technique library with and without a base; merge before upload end to end through
the fake database (one upload, at the account's revision, with both sides' sessions, never
held, and the same piece uploaded without merging first IS refused and held); the skip
list; the stale plan; fetching only the named rows; the words; and, with a fake clock, an
interval check due after one minute and not five, a visible page making about one check a
minute (with timer drift) and a hidden one none. **Re-broken on purpose, and each caught:**
applying while a piece is in use (1 test fails), uploading before merging (2 fail), and the
switch ignored (1 fails); the review re-broke 20 rules one at a time and 19 were caught (the
one that was not: the account's created date on a merged piece, a cosmetic gap). In the browser (the real app against a throwaway local stand-in
for the account service, two different browser addresses as two devices, a made-up saved
session, nothing typed): the switch is off on a restored device and on after the panel's
checkbox; **a change on one device arrived on the other by itself, with no button, after 62
and 79 seconds** (the design bound is about 80: a 5 s quiet period, a 60 s interval and a
15 s tick), fetching only `id=in.(p1)` and not the other piece, with both notes shown; **two
devices logging different chunks within a second of each other merged quietly (no refusal,
no hold, one upload each) and both ended with identical stored data** (compared as data, key
order aside; there is no committed "compare script" from Pass 112 to use); **the same chunk
on both was held with `progress:c9` kept as the conflict, nothing lost on either side, and
Review then worked as before** (all three sessions, uploaded); **a piece deleted on one
device was only listed on the other, nothing removed** (Pass 120 as built; Pass 122 changed
this); **a piece with its settings draft
open did not change (and was not recorded) until the draft was discarded, then arrived within
6 seconds**; **with the switch off the other device only noticed, fetched no data, and Get
changes still worked**; signed out, and with no account service: no request, no lease key,
no switch. **Not seen on the real preview with the real test project** (the card's "Yours"
checks) and **not tried: an unconfirmed Interleaved attempt** (it needs two graduated
chunks), so the "in use" state exercised was the settings draft (all three go through the
same test).

**For later passes** (found here, not decided):

1. **The "will be applied when you're done" line cannot be seen for the one busy state
   that is easy to cause.** While a settings draft is open the Settings tab shows the edit
   form, not the Account panel, and the other busy states stop the person leaving Daily
   Practice without a prompt that ends them. The line is built and tested, but it is
   effectively reachable only briefly. The owner may want it somewhere else (on the edit
   page, or as the quiet line at the top).
2. **A piece held by a REFUSAL (Pass 111) is not settled automatically**; only a piece the
   update itself found conflicting is held with `conflicts`. The fresh look before an upload
   makes a refusal a millisecond-wide race, so this should be rare. If it isn't, held-by-
   refusal pieces could go through the same engine. **Review settles one since Pass 122b**
   (questions, with its recorded base); the automatic update still does not.
3. **Pass 121 starts from a recorded list:** `accounts[userId].pieces[id].conflicts`
   (`{ part, kind, local, remote, base }`, fingerprints). The values are read again from the
   account's copy when the question is asked. **Built in Pass 121** (the list decides which
   pieces are asked about; the questions themselves are made again from the two copies).
4. **The fold Pass 119 wrote** (same chunk logged on two devices) is not used here: that case
   is a conflict and is held. If Pass 121 decides "most recent wins" for a chunk entry, it
   must move `foldConflictedProgress` (`lib/tabSync.js`) into `lib/pieceMerge.js`, or
   sessions would be dropped. **Pass 121 did not move it** (`tabSync.js` was outside its
   list): it wrote `unionProgressEntries` in `lib/pieceMerge.js` for the "both devices'
   sessions" answer, so there are now two implementations of "keep both".
5. **A grid change in one place against practice in the other is held too** (the card
   doesn't say; it is the engine's whole-piece conflict, and holding is the only safe
   answer), listed as "chunk layout and practice".
6. **A "Get changes" click in the fraction of a second an automatic run is reading does
   nothing** (the run holds the same busy flag). Not seen outside a test.
7. **Pass 117 open items 1 (a resize against a difficulty edit) and 3 (revival) are now
   reachable on a real account**, not only between tabs. A resize against a difficulty
   edit is a conflict on `measureDifficulty`, so it is held, never merged into an
   inconsistent piece; a revival start against practice on another device merges part by
   part and has never been run through the engine.
8. **`docs/Research.md`** (not on this pass's list) still says "every 5 minutes" and "every
   60 seconds" for the check and the clock look.
9. **The technique engine's conflict rule is unchanged** ("the account's value wins" for
   octaves, hands and settings): Pass 120 only calls it. **Its notices are dropped** (Pass
   118 open item 7): when both devices changed the same octaves, hands or setting, this
   device's value is replaced by the account's and nothing says so. Pass 121 did not build
   "most recent wins" (it asks about pieces), so this rule and the missing notice are as they were.

**Found in Pass 120's own review (2026-10-19), P2, not fixed:**

10. **A page that is hidden skips the fresh look before an upload.** The look is a check, and
    checks never run hidden. Log a session and switch tabs within the 5 s quiet period and
    the upload goes out on the last check's knowledge (up to a minute old). If the other
    device uploaded in that minute the upload is refused and the piece is held (safe, nothing
    lost, Review settles it). Rare: it needs both devices busy on one piece within a minute.
11. **Two upload runs can overlap during the fresh look.** `syncRunningRef` is set after the
    look, so a second trigger in that gap (the window regaining focus, the browser coming
    back online) starts a second run that passes the guard too. Expected to be harmless (the
    revision rule refuses the second upload, and `sent` adopts it as this device's own), but
    not run. A re-check of `syncRunningRef` after the look would close it.
12. **A piece that waits because it is in use is downloaded again every minute** until it is
    free (only the deferred piece, not the account): only a piece left for the person is
    remembered at its revision (`autoLeftForYouRef`), a deferred one is not. An hour-long
    Interleaved session is about 60 downloads of one piece. **Pass 122 saw it faster than
    that:** with a settings draft open on a piece the account had marked deleted, the
    stand-in's request log showed one light look and one download of that piece **every 5
    seconds** (8 of each in the 35 seconds read), not every minute. See Pass 122's found
    item 1.
13. **A failed automatic update leaves only a console line.** The Account panel's "Changes
    from another device... Press Get changes" line stays (it is recomputed from the last
    check), so it is not invisible, but nothing says the automatic path failed. A piece
    whose data cannot be read is fetched every minute for the same reason.
14. **A stale plan that ends in a conflict is held a moment late.** If a log lands in the
    same instant as an apply (`prev[id] !== localPieces[id]`) and the redo finds a conflict,
    the record says "synced" until the effect that holds the piece runs. An upload starting
    in that gap would send this device's copy over the account's. Needs the log, the
    conflict and an upload start inside the same ~100 ms. `reapplyOnto` itself is unit-tested;
    this gap is not, and was never seen. A fix is to write the hold with the record when the
    plan is made, which needs the stale check to move before the record is saved.
15. **App.jsx's wiring has no automated test** (nothing in `components/` or `App.jsx` can be
    run by `npm test`): the fresh look, the idle re-run, the late hold and the switch's
    effects were seen in a browser against a stand-in service, not on the real preview.

## Settling a held piece, one question at a time (Pass 121)

A piece the automatic update held because **both devices changed the same thing** (Pass 120
records which parts, in the device record) used to be settled in Review with the whole-piece
picker. It now asks one plain question per conflicting part. Everything else about Review is
as before.

**What was built**

- **Which pieces.** Held, with a recorded list (`heldConflicts` / `heldIdsWithConflicts`). A
  piece held **without** a list (a refused upload, an import), a file import, and the technique
  library keep the whole-piece picker (`ImportPiecesModal`), exactly as before. `planSettle`
  also hands back `fallbackIds`: pieces with a list it can't ask about (the account's row is
  gone, deleted or unreadable, or there is no recorded base), which go to the picker too. When
  both kinds are held the questions run first, then the picker opens for the rest
  (`finishSettleFlow`, `restrictCandidatesToHeld(..., exclude)`): a piece that had its turn,
  "Decide later" included, is never shown in the picker, and what was settled stays at the top
  of the result (`leadLines`).
- **The questions are made again when Review opens.** `planSettle` (pure, in
  `lib/accountSync.js`) runs Pass 117's engine on this device's copy and the account's copy as
  they are now, against the base recorded when the piece was last synced. The recorded list
  only decides **which pieces** are asked about, so a conflict that has since gone is not asked
  and one that appeared is. **Every conflict becomes exactly one question**, in a steady order
  (ordinary fields by name, then practice records in the order of the piece), with one
  exception, below.
- **The wording** (`buildSettleQuestions`). A chunk's practice record: "You practiced mm. 1–4
  on both devices since you last synced." with **Both devices' sessions** (recommended) / This
  device's / The other device's. Any other part: "Target date: Nov 1 on this device, Nov 15 on
  your other device." with This device's / The other device's. Devices have no names, so always
  "this device" and "your other device". **Proposed in the card, to be confirmed.** Additions
  to it: a line under each answer that would remove sessions, saying so (below), a "Recommended" tag, a note when
  the two sides of a practice record are not both "new practice" ("The practice record for
  mm. 1–4 was changed differently on the two devices.", no "both" answer), the year on a date
  when it isn't this year, a line each for long values, readable names for fields nobody
  labelled, and "...on both devices, but the two plans differ in detail" for two values that
  read alike (a reschedule "on day 3" on both). The whole-piece conflict (a grid change on one
  device, practice or a reschedule on the other) is one question with two answers: this
  device's whole piece or the other device's; each says what it removes.
- **What each answer does** (`planPieceMerge`'s new `choices` input, `lib/pieceMerge.js`).
  "This device's" keeps this device's value; "the other device's" takes theirs; "both devices'
  sessions" (`unionProgressEntries`) keeps every session from both sides, a session both hold
  counted once (compared by content, key order ignored: Pass 115's comparison), puts them back
  in the order they were logged, unions the days practiced and the focus spots' own sessions,
  and takes **everything else in the chunk's record** (the ladder state, the tempo, but also a
  rating or a flag) from the side whose **latest judged session is later**. A skipped or
  unconfirmed attempt doesn't move the ladder, so it doesn't count; a tie, or no dated
  session on either side, goes to this device. **It does not replay the sessions to rebuild the
  ladder** (deliberately deferred), and **a session one side had undone comes back** if the
  other side still holds it: there is no "before" copy to tell an undo from a session the other
  side never saw. Without `choices` the engine's result is exactly what it was.
- **Numbers worked out from the target date follow it** (`DATE_LINKED_FIELDS`). Found in the
  browser, not in the card: in a days-mode schedule the target date is the one thing a person
  sets; days to learn and minutes per day are worked out from it, and the reschedule marker is
  taken fresh, whenever it is saved. So a date changed differently on two devices conflicts on
  **all of them**, and an answer about the date alone gave a piece that didn't add up (this
  device's date with the other device's days: reproduced). So when the **date** is in
  conflict (days mode only) these go with the date the person keeps and are **not asked
  about**; the date's question says so ("Days to learn and reschedule follow the target date
  you keep."). With no answer, or no conflict over the date, they are ordinary parts, and a
  reschedule made on purpose with no date change is untouched. **This is a judgement call
  beyond the card and the one place a conflict does not become its own question.**
- **One apply step, again.** An answer goes through `applyAccountFlow({ mode: "settle", settle:
  { [id]: answers } })` -> `applyAccountMerge({ settle })` -> `planPieceMerge({ choices })`
  (there is no second apply step). The device record is saved first with the account's copy
  as read, which takes the held mark and its list with it; whatever this device then holds
  beyond that copy goes up as an ordinary change, "only if still at revision N". **Only when
  the answers settle every conflict is anything applied.** If an answer is missing, or a new
  conflict appeared while the person was deciding, the piece and the record are exactly as
  they were (`unsettled`, with a `reason`; see "Failures say which it was" below).
- **Nothing happens until the summary's button.** Opening Review, choosing an option, Next,
  Back, Decide later and the close button change nothing (the lib's planning is pure; apply with
  missing answers returns the very same piece and an empty record change; in the browser the
  stored data was byte-for-byte identical, apart from the tab lease's heartbeat). **Decide later**
  leaves the piece held and moves on to the next piece, and the next Review asks again. The
  rule is in `lib/settleFlow.js` now (`settleNext(...).applies` is true only from the summary,
  or from the "ready" screen), with a test that walks every path and checks no earlier step
  applies.
- **The walk is plain data** (`lib/settleFlow.js`, new in the follow-up, tested in
  `test/settleFlow.test.mjs`). `state = { stage, index, answers, bulk, notice }` and pure
  functions: `startSettle`, `settleChoose`, `settleNext`, `settleBack`, `settleView`. `App.jsx`
  only calls them and `SettleConflictModal` only draws what `settleView` returns (it used to
  decide the order itself, where nothing could be tested).
- **The first screen** (`BULK_MIN` = 3). When three or more practice-record questions offer
  "both devices' sessions", the walk starts with one question for all of them: "You practiced N
  parts of this piece on both devices since you last synced." with **Both devices' sessions for
  all N** (recommended) and **Decide each one**. "All" answers each of them "both" and they are
  not asked again; "each" asks every one. Switching back from "all" to "each" clears what "all"
  filled in (nothing the person didn't choose stays chosen); choosing "each" again after
  answering some keeps those answers. It is only a shortcut to the same answers, so it goes
  through the same apply step. Agreed 2026-10-21 ("I think a first screen is fine").
- **The summary before anything is applied.** After the last question (or the first screen, if
  that answered everything) the window shows "You are keeping:" (one line per answer, the
  first screen's group as ONE line) and, in a red box, what the chosen answers **remove** ("For
  mm. 1–4: the session logged on your other device will be removed, from your account too. This
  can't be undone."), taken from the options flagged `removes`. Its button, **Settle this
  piece**, is the one moment anything is applied.
- **The wording of what is removed** (agreed 2026-10-21, "removed is fine"). An answer that
  would throw sessions away says so, with the number, and is flagged `removes`: keeping this
  device's record removes the sessions only the other device has, **from the account too** (the
  next upload replaces its copy); keeping the other device's removes the sessions only this
  device has (the account never had them). An answer that removes no session says nothing (the
  other side only changed the rest of the record, or has none). The whole-piece answers are
  always flagged: "Practice and changes made on your other device will be removed, from your
  account too. This can't be undone." / "...on this device will be removed. This can't be
  undone." Counted by content, so a session both sides hold is not counted.
- **The account is read again at the last step** (`rereadSettleItem`, `decideAfterReread`).
  Found in the review: the questions were made when Review opened and the account's copy was
  recorded when the last answer was given, so another device uploading in between made the
  settled piece's upload refused and the piece held again with no list (reproduced with the
  app's own functions). Now the summary's button first reads just that row again
  (`fetchChangedAccountRows`, one id) and plans the piece afresh from the row and from this
  device's copy as they are NOW. **The same questions (`sameSettleQuestions`: the wording down to
  the numbers in the hints) means the answers still mean what they meant: they are applied to
  the NEW row, so the record takes the new revision.** Different questions mean the walk starts
  over with a note and nothing is applied; "nothing left to decide" is a different screen, also
  with a note; a row that is gone or no longer held is "gone". **If the account can't be read at
  that moment nothing is applied** (the copy this device holds might be out of date) and the
  window stays on the summary and says so; pressing the button again retries. (The plan said to
  carry on with the copy already held; stopping is the safer of the two and costs one more
  press.)
- **Settling acts only on what it was asked about.** `applyAccountMerge({ settle })` skips any
  piece whose walk kind isn't a settle, "same" (already matching, now reported as `upToDateIds`,
  not "settled") or "take": it never adds a piece this device no longer has (found: a piece
  deleted in another tab while its questions were open was brought back by "Settle" and
  reported as settled), never combines two pieces by name and so never marks a row in the
  account deleted. A requested piece that wasn't reached is reported as `unsettled` with reason
  "gone", never silently dropped.
- **Failures say which it was.** `unsettled` entries carry a `reason`: "changed" ("...changed
  again while you were deciding, so nothing was changed and it is still held. Press Review to
  look at it again."), "gone" ("...is no longer waiting to be settled here (it may have been
  deleted, or settled in another window), so nothing was changed.") or "error" ("Something went
  wrong while settling ..., so nothing was changed and it is still held. Press Review to try
  again."); everything used to say "changed again". `planSettle` never throws: a piece whose
  questions can't be built goes to the whole-piece picker (`fallbackIds`) and is named in
  `errored`, and the page says "... couldn't be asked about one question at a time, so it went
  through the whole-piece choice instead." (`planSettle` takes an optional `build` so a test can
  make one fail.) `unionProgressEntries` and the question builder treat a `sessions` that isn't a
  list as having none instead of throwing; "1 difficult measure" is singular.
- **The screen** (`components/SettleConflictModal.jsx`, driven by `settleView`): the piece's name
  with "Question 2 of 5" / "Last step" and "Piece 1 of 2", a note when there is one, the first
  screen, a question with its answers as radio rows, or the summary; **Decide later**, **Back**
  (not on the first screen, or on a first question with no first screen before it) and **Next**
  (**Settle this piece** on the summary). A piece with nothing left to decide shows "Bring it up
  to date?" with **Bring it up to date**. After settling, the page says, for example: "Settled
  Etude No. 3: kept the other device's target date and both devices' sessions for all 6
  practice records." and "Anything here that your account doesn't have yet goes up by itself
  in a few seconds." Settings' account panel got matching wording (the switch's help text and a
  line under Review).

**Checked.** `test/pieceMerge.test.mjs` (56 tests), `test/accountSync.test.mjs` (243) and
`test/settleFlow.test.mjs` (26, new in the follow-up), 1406 in all. Each answer for a chunk (both: sessions and days unioned, the ladder from the later
session, a tie to this device; this device's; the other's), an ordinary field, partial and
stale answers, the whole-piece conflict, the date-linked numbers (days, minutes, marker; not in
minutes mode), 150 seeded pairs of copies settled a random valid way (every answer applied
exactly as given, only the answered parts changed, stable after a reload), every conflict one
question with the wording word for word, "Decide later" changing nothing, and an end-to-end
run through the fake database (the settled piece goes up once, at the account's revision,
with every session, and is never held). **Re-broken on purpose, 44 ways, all caught,** once
five weak tests were tightened or added (a side with no judged session, focus spots when the
leading side has fewer, two schedule-mode cases, and the date rule outside days mode). Required
by the card: taking the ladder state from the **earlier** session under "both" fails 5 tests. In the
browser (the real app against a throwaway local stand-in for the account service with a
"pretend it's down" switch, two browser addresses as two devices, a made-up saved sign-in,
both devices offline while they changed things): the same chunk logged differently and the
target date changed differently on each device was held on the second device with its list
recorded; **Review opened on a question and changed nothing; settled with "both devices'
sessions", "this device's" and "the other device's" (each with the date either way), the
storage of the settling device held exactly that side's sessions (or every session under
"both"), the account's row got the same, and the other device picked it up by itself and ended
identical (the whole piece compared as data: every key, three copies, revision 11)**; Back kept
its answers; **Decide later and the close button left storage byte-identical, the piece still
held with its three recorded conflicts, and the next Review asked again**; a piece held
**without** a list opened the old picker; a piece with a list **and** one without went
questions first, then the picker's quiet "Cleared..." with "Settled..." kept on top; signed
out, and a build with no account service configured: nothing changes (no Account panel, no
"Sign in", no banner, no sync keys, no console errors). The console showed only the pretend
outage's 503s. **Not seen:** the card's "Yours" checks on the real preview with the real test
project; and signing out in the middle of the questions, in a browser (unit-tested or simple).
The "ready" step was seen in the follow-up's browser run (below).

**Follow-up checks (2026-10-21, after the review below).** Everything in "The first screen" to
"Failures say which it was" above is covered by tests: `test/settleFlow.test.mjs` walks every
path (the first screen's thresholds, "all"/"each", Back from every screen, that no step before
the summary applies, the summary's two lists, the screens' labels, a notice that stays while
choosing and goes on moving, the re-read's outcomes with real pieces: unchanged, moved without
touching what was decided, a session logged elsewhere, a value changed again, the other side
back to what it was, this device changed, the piece gone, one piece among several held), and the
new account-sync tests cover the removal wording (counts, singular and plural, which side's
sessions are counted, flagged or not), the "gone"/"changed"/"error" messages, the guard against
re-adding, combining or marking anything deleted, a clean newer copy, a failed question build,
and the plural. **Re-broken on purpose, 74 more ways, all caught** (40 in `settleFlow.js`,
30 in `accountSync.js`, 4 in `pieceMerge.js`); six were first not caught: four because a test
was missing (now added: the first screen sweeping up a question of another kind, a clean newer
copy, a piece outside the request, a conflict that appeared being called "gone") and two because
the code was redundant (a status check that the question comparison already implies, and the
same check in the first screen's condition), which were removed. In the browser, again with two
addresses as two devices against the throwaway stand-in service, on a piece with FOUR chunks
practiced on both devices and different target dates: **the first screen appeared with "Next"
grey until a choice was made; "all" left only the date to ask; the summary changed nothing
(storage and record byte-identical, still held with five conflicts recorded) and Back kept the
answers; with the account moved on by one session while the summary was open, "Settle this
piece" started over with the note and changed nothing; after answering again with the account
moved on in the notes only, it applied, recorded revision 4 (not 2 or 3), the account got one
upload (revision 5) holding every session from both devices and this device's date, and the
piece was not held again** (the case that used to end in a refused upload and a hold with no
list). "Decide each one" with answers this device's / both / the other device's / both showed
the summary's two warnings, naming mm. 1–4 and mm. 9–12; **with the service down at "Settle this
piece" nothing was applied and the window said so and stayed**; once it was up the same button
applied exactly what was warned (mm. 1–4 lost the other device's session, mm. 9–12 lost this
device's, the other two kept both, in storage and in the account). A single conflict skipped the
first screen and showed no Back on the first question; with the account's row marked deleted
the last step said "no longer waiting to be settled here..." and changed nothing; with the row
put back to what this device last synced, Review showed "Bring it up to date?" and it
reported "...is up to date with your other device." and the device's own sessions went up. Console: only the
pretend outage's 503s. **Not seen in a browser:** a failed question build falling back to the
picker (unit-tested with an injected failure), the "error" message, and several held pieces in
a row with the new walk (one line of `App.jsx`: `advanceSettleFlow`).

**Found, for decisions** (none acted on beyond what is said above):

1. **A date edit rewrites more than the date**, see above. The rule built here is the narrow
   one (only when the date itself is in conflict, days mode only). The wider question, whether
   days to learn and minutes per day should be derived rather than stored parts at all, is
   Pass 117's engine design and was not touched.
2. **A piece held by a refused upload gets no questions.** In my own browser run one of seven
   conflicts was held that way (no recorded list) and fell through to the old picker. It is
   Pass 120's for-later item 2; it is now more visible, because the questions only help
   automatic holds. Routing refusal-held pieces through the engine would give them questions
   too. **Fixed in Pass 122b** for a piece that still knows what it last synced.
3. **Pass 117 open item 2 is untouched:** `sortOrder` and `createdAt` can conflict (two devices
   that each reorder the piece list), and the person would now be asked "Place in your piece
   list: 2 on this device, 4 on your other device". The engine never conflicting on those two,
   as proposed there, would remove that question. **Done in Pass 122b** (`SOFT_PARTS`).
4. **"Both" is not "most recent wins".** It is a choice the person makes for a chunk; nothing
   decides for them, and nothing is remembered ("always keep both" was named as Pass 122's;
   when 122 was split on 2026-10-24 it was deferred again, with no owner yet).
5. **The whole-piece question is lossy by nature** (the other side's changes go with it), and
   re-homing progress by measure position, as Settings does on one device, is still open
   (Decisions.md, "When two copies disagree", open item (i)).
6. **`docs/Decisions.md` was not on this pass's list**, so its decisions are recorded here and in
   CLAUDE.md only; it needs an entry for: the questions and their wording, the "both" rule
   (later judged session, tie to this device, no replay), the date-linked numbers, and the
   fallback to the picker.

**Found in Pass 121's own review (2026-10-21), P2** (no P1 was found; nothing here loses
practice history, and every one needs an unusual moment or unusual data). **Fixed the same day
after the owner agreed ("removed is fine. I think a first screen is fine. go ahead and do it"):
7, 9 for the many-chunks case, 10, 11 and 12, described above. Still open: 8, and the
remembered "always keep both" half of 9.**

7. **The account can move on while someone is answering.** *Fixed:* the summary's button reads the
   row again and asks again if the questions changed ("The account is read again at the last
   step"). Originally: the settled piece's upload was refused and the piece held again without a
   list, so the next Review opened the old picker (reproduced with the app's own functions; the
   account's newer copy untouched, nothing lost).
8. **The date's relatives are not handled. STILL OPEN, proposed as its own pass** (it was not
   part of the batch the owner approved). The Settings schedule screen works out days to
   learn and minutes per day from the target date **and** from practice days per week, and the
   measure count rewrites the difficulty list and the sections together. Only the target date
   is handled here. **A resize on one device against a difficulty edit on the other (Pass 117
   open item 1) gives a piece whose measure count and difficulty list disagree even when every
   question is answered the same way** (reproduced: 36 measures, 32 ratings; the app keeps
   running, the extra measures read as easy and a reload does not repair it). Answers about
   practice days per week and minutes per day could disagree in the same way (read from the
   code, not run). Fix idea: the Pass 117 proposal, size travels as a unit, and the same for the
   schedule numbers (a question about the group, not about each field).
9. **One question per conflicting chunk, and no "same answer for all".** *Fixed for the many-chunks
   case:* three or more practice records changed on both devices start with one first screen
   ("Both devices' sessions for all N" / "Decide each one"). Originally 40 conflicting chunks gave
   40 questions (a probe; building them took 6 ms). **Remembered answers ("always keep both")
   were named as Pass 122's and are deferred again, with no owner yet.**
10. **"Left out" understated the choice.** *Fixed:* the answers say "removed", with the number of
    sessions, "from your account too" where that is true, and "This can't be undone", and the
    summary repeats them. Unchanged and by design: after "both", the chunk's stage and next
    review date come from one side and do not reflect the other side's sessions (the ladder is
    not replayed), and the account keeps no earlier version of a removed session.
11. **Failures with a poor message.** *Fixed:* a failed question build falls back to the picker and
    says so; "changed" / "gone" / "error" read differently; a piece deleted in another tab is no
    longer brought back; `unionProgressEntries` tolerates a `sessions` that is not a list; "1
    difficult measure".
12. **No recap before applying.** *Fixed:* the summary.

## A piece deleted on one device is deleted everywhere, with a way back (Pass 122)

Until this pass a piece deleted on one device was only *listed* on the others ("Delete it here
too", Pass 112), and a deletion made while another device had logged practice was refused by
the account and **held** ("a piece deleted here"). The owner decided on 2026-10-23: **"If a
piece is deleted on another device, it should be deleted everywhere so the practice should be
lost."** She also said yes to a way back. This pass builds both. **Pass 122's card was split in
two on 2026-10-24** (her choice): this is the deletions half. **122b, the other half, was built
afterwards:** see [What the person said no to is remembered, and order follows
them](#what-the-person-said-no-to-is-remembered-and-order-follows-them-pass-122b).

**The rule and its safety net.** A deletion always wins, over practice logged on another
device before or after it. It is an exception to the 2026-10-15 "practice sessions are always
kept", for whole-piece deletions only. The net is Design D, unchanged: a deleted piece only has
`deleted_at` set in the account, its data stays, and for **30 days** (`RECENTLY_DELETED_DAYS`,
tracked in [Research.md](Research.md#account-sync-timings)) it can be brought back from
Settings. What can't come back is practice a device logged and **never backed up** before the
deletion reached it.

**What was built**

- **What a device does with a piece it still holds that the account marks deleted** (the
  first column is the deletion's age, `isRecentlyDeleted`):

  | the deletion is | "Update automatically" switch | result |
  |---|---|---|
  | from the last 30 days | on | **removed by itself**, even with practice here that was never backed up; a quiet line says so |
  | from the last 30 days | off | listed, nothing removed: the Account panel and one quiet banner, each with **Delete it here too** and **Keep it** |
  | older than 30 days | either | listed the same way; never removed by itself |
  | a combine's duplicate (`mergedInto`, below) | either | never removed by itself; "Get changes" offers only **Delete it here too** |
  | a piece this device **never synced** (below) | either | listed the same way; never removed by itself, however recently it was deleted |

  Nothing is removed unless the switch is on, the deletion is recent **and this device synced
  the piece before**, or the person presses **Delete it here too**. A piece this device deleted
  itself (`deletedHere`) is not one of these.
- **A piece this device never synced is never removed by itself** (added at the owner's request,
  2026-10-25, after the pre-commit review found it: "fix so that imports can't be removed").
  `wasSyncedHere(entry)` (`lib/recentlyDeleted.js`) is true when the device record holds a
  **recorded revision** for the piece (an upload the account confirmed, or the account's copy
  taken here), and it is the one test used in both places that decide: `deletionsElsewhere`
  puts a recent deletion of a never-synced piece in its own `unsynced` bucket instead of
  `recent` (so it is not fetched to be removed, and the person is told about it), and
  `applyAccountMerge` checks it again before removing (a second line of defence, like the
  30-day check). **Why this is the right test:** a file import keeps a piece's own id, so a piece
  you deleted and then imported again matches the account's deleted row; once the deletion has
  gone up the device record keeps nothing for it, and the refused re-upload leaves only a bare
  hold (`{ held: true }`, no revision). A piece that really lives on your devices always has a
  revision, even when it is held for a conflict (`withPieceHeld` keeps the old entry), so the
  deletion still reaches it. It also covers a piece on a device that has never synced it (a
  copy from before it signed in, one the first backup found already in the account). **What it
  does not cover:** an import that is merged into a piece this device had already synced is an
  ordinary change to that piece, and a deletion made elsewhere still wins over it (the owner's
  rule); there is no "imported by hand" mark on a piece, because that would change the stored
  format.
- **Automatic removal is the same single apply step** (`applyAccountFlow({ automatic: true })`
  -> `applyAccountMerge`; there is no second one). `autoUpdateTargets` now takes the deleted
  pieces that are `recent` (`deletionsElsewhere`, `lib/recentlyDeleted.js`), so they are fetched
  with the changed rows. For each deleted row of a piece this device holds: a combine's
  duplicate, a deletion past the window or a piece this device never synced goes to
  `leftDeleted` (listed, remembered per
  revision in `autoLeftForYouRef` so it is not fetched again); a piece in use goes to
  `deferred` (**not recorded**, so the next run finds it again, as in Pass 120); the rest are
  `removed`. **The record's entry is dropped first** (`withPieceDropped`, no upload counted),
  so this device never sends a second "deleted", **and a piece held as "changed on another
  device" because its upload was refused by the deletion is removed the same way** (the hold
  goes with the entry). Then the piece leaves `pieces`. **Get changes and Review never remove
  anything by this route** (the `automatic` flag is off there).
- **A piece that is open.** If the removed piece is the open one, the app moves to another
  piece and closes any settings draft, the way "Delete it here too" does
  (`setActivePieceId`, `setEditDraftState(null)`, `setSettingsEditing(false)`, the Overview tab,
  no day override). A piece in use (`isPieceBusy`: an unconfirmed Interleaved attempt, a running
  reassessment timer, an open settings draft) is never removed: it waits, and the existing
  "applied when you're done" effect brings the removal in when it is free.
- **The notices follow the owner's choice** (2026-10-23): a **red page banner only when
  practice was lost**, otherwise a quiet line. `sessionsOnlyHere(localPiece, deletedRowData)`
  counts the sessions this device holds that the deleted row does not (compared by content, key
  order ignored, Pass 115's comparison, and counting focus spots' own sessions). The words:
  *Quiet line, Account panel:* "Removed because it was deleted on another device: Nocturne."
  *Red banner, only if sessions were lost:* "Nocturne was deleted on another device, so it was
  removed here too. 1 session you logged here since your last backup went with it. You can
  bring the piece back from Recently deleted in Settings for 30 days, but not that session."
  *Plain line, only if the removed piece was the open one:* "Nocturne was deleted on another
  device, so it was removed here too." (`describeAutoUpdate`, `describeAutoRemoved`.)
- **Listed cases** (switch off, older than 30 days, or a duplicate). One quiet banner, in the
  export-reminder style (not red), says "Nocturne was deleted on another device." and, for one
  piece, "It's still on this device. Delete it here too, or keep it: it comes back in your
  account and on every device." with **Delete it here too** and **Keep it**. For several pieces
  it names them and has an **Open Settings** button (through `guardLeavingActiveWork`). The
  Account panel in Settings lists each one with the same two buttons, under "Deleted on another
  device. These are still on this device, and nothing removes them unless you choose to." The
  "Get changes" window got **Keep it** beside its existing button (`onKeepHere`). Built from the
  light look (`deletedElsewhere` in `refreshSyncInfo`: ids, revisions and deleted dates only).
  **The banner warns when "Delete it here too" would throw away changes the account never got**
  (found in the pre-commit review, 2026-10-25; the Account panel's list and the "Get changes"
  window already said so): for one piece, "It's still on this device, and it has changes your
  account never got. If you delete it here too, those changes are lost. If you keep it, the
  piece comes back in your account and on every device, with those changes."; for several,
  "... some have changes your account never got." (`describeDeletedBanner`'s `unsynced`).
- **Keep it** (and **Restore**, below) is `bringBackDeletedPiece`: it reads the row, then answers
  `gone` (no such row), `live` (not deleted any more: already back), `combined` (its data says
  `mergedInto`: never brought back on its own), `moved` (the row's revision is not the one the
  person was looking at: **refused, nothing changed**), or clears `deleted_at` with
  `restorePieceRow` **only if the row is still at the revision read** and answers `kept`; or
  `stopped` (no connection, signed out). Nothing but `deleted_at` is written, and no migration is
  needed: the update rule ("change own rows") checks only that the row is the person's, and the
  revision trigger only raises the count (`supabase/migrations/`; **read, not run against the
  real project**). A `kept` row then goes through **the one apply step again**
  (`applyAccountFlow`, mode "changes", this piece only, with the "Kept ..." line first), so a
  piece this device still holds that differs from the account's copy is merged by the Pass 112
  rules, **never replaced**, and a piece this device no longer holds arrives as a new piece. The
  device record is saved first, as always. Before that, `bringBackThroughApply` corrects the
  last light look's row for this one piece (`deleted_at: null`, the new revision), because the
  banner and the "Changes from another device" line are computed from that look and would
  otherwise go on showing a deletion that is no longer true (**found in the browser, fixed**).
  The piece then reappears on the other devices through the ordinary routes (the automatic
  update, or Get changes).
- **A deletion is not held up by practice elsewhere** (`syncWaitingChanges`). A device's own
  deletion that is refused because the row is live but has moved on (`judgeRefusal`: a delete
  against a live row is "differs") is **tried once more against the revision just read**, setting
  only `deleted_at`. If that succeeds the revision is adopted; if the connection drops the run
  stops; **if it is refused again, or fails, the deletion stays waiting (not held)** and the next
  run reads the row again. This is **the one exception to "a refusal is never retried"**. Why it
  is safe: nothing is erased, and what the other device logged stays in the row's data, so the
  piece can be restored from Recently deleted with that practice. A deletion against a row that
  is already marked deleted is "same" (the revision is adopted), against a missing row there is
  nothing to delete, both as before. **A deleted piece can therefore no longer be held.**
- **Recently deleted** (a button under Account in Settings, `RecentlyDeletedModal`). It reads
  only the rows marked deleted at or after the cutoff (`fetchDeletedPieces`: `deleted_at` >=
  30 days ago, with each row's data so a name and counts can be shown) and lists them newest
  first (`recentlyDeletedList`): the name, "Deleted today / yesterday / 3 days ago", the number
  of measures and sessions the **account's copy** has, and **Restore**. A combine's duplicate is
  never listed, and a row whose data can't be read is left out rather than offered. Opening the
  list changes nothing. **Restore is the same step as Keep it**, so the piece comes back on every
  device as the account last held it, and a restored piece is a new piece on a device that no
  longer has it.
- **A combine records where its duplicate went** (`markOtherCopiesDeleted` ->
  `markPieceRowCombined`). The extra row is still only marked deleted, "only if it is still at
  the revision it was read at", and its saved data is sent back **exactly as read plus one key,
  `mergedInto: <the surviving piece's id>`**. Without it a combine's duplicate was
  indistinguishable from a deletion the person made, so the automatic path would have removed
  it from a device that held practice the combine never saw, and Recently deleted would have
  listed it. With it: `accountRowsToCandidates` carries `mergedInto` (and `deletedAt` and the
  saved data) on each deleted row; the automatic path leaves it; Recently deleted leaves it out;
  Keep it answers `combined` ("... was combined into another piece, so it can't be kept on its
  own."). **This is the first time the app writes into the data of a deleted row anything other
  than a piece's own copy.** A combine made before this pass carries no note (found item 3).
- **The delete window** (`DeletePieceModal`, words in `deleteWindowCopy`, tested). Signed in
  with a checked first backup: "Are you sure you want to delete this piece and all its progress?
  This removes "Nocturne" (every chunk, session log, and revival history) from this device and
  from every other device on your account. You can bring it back from Recently deleted in
  Settings for 30 days, without any practice that was never backed up." with **Delete
  everywhere**. Signed out, or signed in with no checked backup: what it always said ("...from
  this browser, permanently. It can't be undone."), with **Delete permanently**.
- **Files.** `lib/recentlyDeleted.js` and `components/RecentlyDeletedModal.jsx` (new);
  `lib/accountSync.js`, `App.jsx`, `components/tabs/SettingsTab.jsx`,
  `components/ImportPiecesModal.jsx`, `components/DeletePieceModal.jsx`; tests; docs.
  `lib/recentlyDeleted.js` is pure and never imports `accountSync.js`.

**Not changed:** the merge engines, tab sync, the stored format, the device record's fields,
and the database. A piece is still only ever marked deleted (Design D); nothing in the account
is erased by this pass or by anything the app does.

**Checked.** `test/recentlyDeleted.test.mjs` (24 tests, new) and `test/accountSync.test.mjs`
(289, was 243), 1476 in all (1406 before). They cover: the window's edge (exactly 30 days is
outside), an unreadable or future time; which pieces count as deleted elsewhere (a piece this
device deleted, a piece it doesn't hold, a held piece); what the person is told about with the
switch on and off; counting lost sessions by content, including a focus spot's own log;
automatic removal (only with the switch on, only inside the window, never a combine's duplicate,
waits for a piece in use, does not touch a piece this device doesn't hold, Get changes never
removes); the targets; the retried deletion (at the new revision, refused again, no connection,
against an already deleted row); Keep it and Restore (every answer, refused when the row moved,
no write when it is not deleted, never a combine's duplicate); the list (fetches only the last 30
days, newest first, no duplicates); the combine note (added, the data otherwise untouched, read
back by the candidates) and end to end through the fake database (A deletes, B removes, the
account row keeps its data, Recently deleted lists it, Restore brings it back with every session
the account had); the words, none with an em dash; the banner's warning about changes the account
never got; and a piece this device never synced (no record, or a bare hold) being listed and never
removed or fetched to be removed, down to a whole chain through the fake database (delete, import
the file again, refused and held, switch on, left alone). **Re-broken on purpose, 51 ways (30 in
`accountSync.js`, 21 in `recentlyDeleted.js`), all caught.** The five the card names: no 30-day
limit (also on the list), removal with the switch off (two ways: by hand through Get changes, and
the switch ignored when choosing what to fetch), Keep it without the revision check (the check,
and the write not being conditional), no retry (a deletion held, never retried), and a combine's
duplicate shown in the list (and removed by itself).

**In a browser** (2026-10-24; the real app against a throwaway local stand-in for the account
service with a "pretend it's down" switch, two or more browser addresses as devices, a made-up
saved sign-in; the stand-in cannot test the real database's rules): with the switch on in both,
the delete window said the new words and **Delete everywhere** removed the piece on A (the row
got `deleted_at`, kept its data, revision 2) and **B removed it within a second of its next look,
said so only in the Account panel, and sent nothing back**; **Recently deleted** on A listed it
("Deleted today · 32 measures, 1 session") and **Restore** brought it back on A and on B (account
revision 3, then 5 after B's own Restore); with a **settings draft open on B** the piece stayed
for the 40 seconds watched, then **was removed about a second after the draft was discarded,
the open piece moved to another one and the plain line said so**; **with the service down B
logged a session that never reached the account, A deleted, and B then removed the piece with the
red banner "...1 session you logged here since your last backup went with it..."**, and the
quiet line alone appeared when nothing was lost; **A deleted while B had uploaded a newer
session (the account row was at revision 8, A at 7): the stand-in's log shows the write at
revision 7 refused and the retry at revision 8 accepted, nothing held, no red banner, and the
restored piece held B's session**; with **B's switch off** the piece stayed, the banner and the
Account panel group listed it with the two buttons, **Keep it** cleared the mark (account
revision 12), A got the piece back on its own, and a **Delete it here too** (the other round)
removed it with no write from B; **a deletion back-dated to 31 days ago was not removed with the
switch on (watched for 7 seconds after a fresh look; the unit tests hold the boundary), was
listed with the two buttons, and Recently deleted said "Nothing was deleted in the last 30
days."** (the list's request carried the 30-day filter); **a combine's duplicate
(two devices that each held "Etude") was marked deleted with `mergedInto` and its data intact,
stayed on the other device, was not in Recently deleted, and Keep it answered "...combined into
another piece, so it can't be kept on its own." with the account unchanged**; signed out, the
delete window said "...from this browser, permanently" with **Delete permanently** and the
Account panel offered only "Sign in"; **a build with no account service configured** had no
Account panel, no banner and the permanent wording, and the console showed no errors.
**After the pre-commit review (2026-10-25), again in the real app:** with a piece holding changes
the account never got, the banner warned in the new words; **Keep it** on a copy that differed
merged both sides' sessions, put it back in the account (revision 4, two sessions) and cleared
the hold; and the re-import case: a piece **deleted through the app's own window and then
imported again through the real Import window, with automatic updates on, was left alone** (the
app looked at the account, listed it with the two buttons, kept it on the device, and nothing
was removed or sent), and **Keep it** then brought it back (account revision 3, hold cleared).
**Not seen in a browser:** the real preview with the real test project (the card's "Yours" checks,
which need a push); the several-pieces form of the banner (its **Open Settings** button; the
wording is unit-tested); a deletion arriving while an Interleaved attempt is unconfirmed;
Restore after the row moved (unit-tested: `moved`); a hidden page.

**Found, for decisions** (none acted on beyond what is said above):

1. **A piece in use is looked at and downloaded every 5 seconds, not every minute.** With a
   settings draft open on a piece the account had marked deleted, the stand-in's request log
   showed one light look and one download of that piece's row every 5 seconds (8 of each in the
   35 seconds read) until the draft was closed. Read from the code, the likely path: with the
   switch on, every upload round starts with a fresh look and then the automatic update; a
   piece left waiting because it is in use is not remembered (`autoLeftForYouRef` holds only
   pieces left for the person), and while the piece also has a change that cannot be sent yet
   the round repeats after the 5-second quiet period. **It is Pass 120's left-open item 12
   (stated there as "every minute"), made more reachable here** because a recent deletion is
   one more thing to wait for. Harmless to the data (about 3 KB and one piece each time) and
   not fixed (it is Pass 120's wiring, outside this card). **Proposed:** remember a deferred
   piece by revision until it is idle, the way a piece left for the person is; the idle effect
   already re-runs the update when the piece is free.
2. **The banner and the Account panel offer "Keep it" on a combine's duplicate.** They are built
   from the light look, which never reads a row's data, so they cannot know it is a duplicate;
   "Get changes" fetches the data and offers only "Delete it here too". Pressing Keep it on a
   duplicate is safe: it answers "... can't be kept on its own" and changes nothing (seen in a
   browser). **Proposed if it matters:** one extra read of the deleted rows when they are
   listed, or leave it.
3. **A combine made before this pass carries no `mergedInto` note**, so it looks like a
   deletion: with the switch on, such a duplicate under 30 days old is removed by itself and is
   listed in Recently deleted, and any practice only that duplicate held is lost with it. The
   owner is the only account. **Asked and answered 2026-10-25: she has not combined two copies
   ("Same piece, other copy") on the real site in the last 30 days**, so nothing in her account
   is affected today and no check of old duplicates is needed before the switch is turned on.
   The gap stays for any older combine that shows up later.
4. **A card being typed into or timed is not "in use".** Pass 120's busy test (an unconfirmed
   Interleaved attempt, a running reassessment timer, an open settings draft) leaves out typed
   reps and a practice timer on Daily Practice, which was fine when the piece was only
   *replaced* (the card survives, cards are keyed by chunk and role). **A removal does not
   survive it**: if the piece is open and the deletion arrives mid-card, the card goes with the
   piece, and the plain line is all that says why. Under the owner's rule that is accepted;
   mentioned because the old reasoning no longer covers it.
5. **The 30 days are counted on this device's clock** against the account's `deleted_at`. A
   clock that is ahead makes a deletion look older (listed, safe); a clock that is behind makes
   an old one look recent (removed by itself, and listed in Recently deleted by the same
   clock). Nothing is erased in either case. This is the "wrong device clock" of Decisions.md
   open item (iv); not guarded here.
6. **Once the switch is on there is no "remove from just this phone".** A piece lives on every
   device or on none (deleting is global; "Delete it here too" exists only while the switch is
   off or the deletion is older than 30 days). Stated in the card; recorded so it is not rediscovered.
7. **Restore is "as the account last had it".** Practice a device logged and never uploaded
   before the deletion reached it is gone (the owner's rule), and the red line says how many
   sessions; the window and the Recently deleted text both say it can't come back. There is no
   way to restore a device's local-only practice, because it was never in the account.
8. **`docs/Research.md` still says the check runs "every 5 minutes"** (Pass 120 left-open item 8;
   the real values are 60 s and 15 s). Not touched: it is another pass's slip and outside this
   card. The 30-day row was added to the same table.

**Found in the pre-commit review (2026-10-25), none of it losing data for good.** Two were fixed
(the banner warning, above, and item 9, at the owner's request); the rest were logged. 9 to 11
were run with the real library functions.

9. **A piece you deleted and then re-imported from a backup file was treated as "deleted on
   another device". FIXED the same day, at the owner's request** ("fix so that imports can't be
   removed"; see "A piece this device never synced is never removed by itself" above). A file
   import keeps the piece's original id (`handleConfirmImport` makes a new one only if the id is
   still here), and once your own deletion has gone up the device record has no entry for it, so
   the piece read as one whose account row is marked deleted. With the switch on it was a target
   and **was removed again within a minute** (the probe: removed, with the file's newer sessions
   counted as lost); with it off it was listed under the banner. Nothing was lost for good (the
   file and Recently deleted still hold it), but it looked like the app undoing the import. Now
   a piece with no recorded sync is only ever listed, whatever the switch. **Still true, and the
   owner's rule:** an import that is merged into a piece this device had already synced is an
   ordinary change to it, and a deletion made elsewhere still wins. The banner's words for such a
   piece still say "deleted on another device" although it may have been this one; the app
   can't tell which.
10. **Restore (or Keep it) next to a same-named piece combines instead of restoring.** The apply
    step matches by name when the id isn't here, so restoring "Etude" while another "Etude"
    exists merges the restored copy into it and marks the restored row deleted again
    (`mergedInto`); the page says "Restored ..." and then "Combined the two copies of Etude."
    The sessions are merged, not lost, but that row can't be restored on its own afterwards.
    Same rule as every other flow (a name match is the same piece); the wording is what is off.
11. **A deletion that was already held before this change stays held.** The retry covers a
    refusal from now on; a device record that already holds "a piece deleted here" (Passes 111
    to 121) is never re-queued. Rare, and I have not looked at the owner's record. A small
    change in `computeWaiting` would re-queue it.
12. **A deletion refused twice in a row counts as a failure, not a refusal** (`result.failed`),
    so after two such runs the status line says the service "isn't answering". It needs another
    device to write between the re-read and the retry, twice; wording only. Pressing **Keep it** or
    **Restore** in the second or so an automatic update holds the busy flag does nothing and says
    nothing; pressing again works.
13. **The delete window says "every other device on your account"**, which is true for a device
    with the switch on; one with it off (the default) keeps the piece and asks. The words were
    in the approved card. **Proposed:** "... and your other devices remove it or ask you."

**Left open:** items 1 to 3, 10 and 11 above; the app's own
`App.jsx` wiring for Keep it, Restore and the banners has no automated test (checked in a
browser, as above); no "always keep both" (deferred, no owner); and the real-project checks.
(122b, a piece held by a refused upload getting questions in Review, was built afterwards and is
described in its own section below.)

## What the person said no to is remembered, and order follows them (Pass 122b)

Pass 122's card was split in two on 2026-10-24 and this is the other half. Four things the app
should neither decide alone nor ask twice, all logged as open before (Pass 112 later-passes
items 5 and 9, Pass 116 found item 3, Pass 117 open item 2, Pass 120 for-later item 2):

1. A combine the person declined (two same-named pieces with different ids) was offered again on
   every Get changes, and a new piece they left unticked was counted again by every check.
2. A name match where one of the two pieces has no composer was offered as if it were certain.
3. Two devices that each reordered the piece list conflicted on a display-only field, and Pass
   121 would have asked about it.
4. A piece held because an upload was refused went to the old whole-piece picker, not to Pass
   121's plain questions.

**The owner's answers (2026-10-25)**, given on the backlog card: **a new piece she leaves
unticked is remembered too** (Pass 116 found item 3, which these docs had handed to this pass);
**one button, "Ask me again about what I said no to"**, is the way back (not a list, and not
"only a backup file"); and **piece order follows her between devices**. **One thing was not
answered before she left, and was first built as the card proposed it:** when both devices
reordered the list differently before they synced, **the order already in the account wins**,
silently. **She answered it the same day, with the pull request open: "it should remember the
most recent reorder."** That is built (see "The most recent reorder wins" below). It needed a
small dated note stored in the pieces a drag changes, which is why the card had left it out; the
account-wins default now only decides what nothing can date.

**What was built**

- **What leaving a row unticked means** (`planDeclines`, lib/accountSync.js; the window is
  `ImportPiecesModal.jsx`, the one Get changes and Restore always used). It is said in the window,
  under the intro and on each combine row, so it is never a surprise:

  | the row | unticked means | remembered |
  |---|---|---|
  | **New here** | not on this device | the piece (`pieces`) |
  | **Same piece, other copy** (Get changes, Review) | these are different pieces, and this copy stays off | the pair and the piece |
  | **Same piece, other copy** (Restore) | different pieces, so **both are restored**, when the copy it would have been combined with is coming too; if that one isn't coming either, this one is left off | the pair (and arrives), or the piece |
  | **Maybe the same piece** | the same as the row above; it **starts unticked** | the same |
  | Newer in your account, Changed in both places | nothing: the piece is here, and it keeps being noticed as before | nothing |

  Ticked rows say nothing. Closing the window (Cancel) remembers nothing. "Select none" is a
  lot of unticking, so it leaves everything off; the window says what that means. The confirm
  button is there even with nothing ticked ("Leave these off"), or a person could never say no
  to a single piece (found item 2).
- **The answers live in the device record** (`accounts[userId].declined = { pieces, pairs }`,
  lib/accountSync.js `cleanDeclined`): per account, on this device only (never in the account),
  kept only while something is in it, at most 500 of each (the newest are kept), pairs stored
  sorted so either way round is the same. It sits beside `autoUpdate` and is carried over by
  every function that rebuilds an account's entry (`changeAccount`, `withBackupRecorded`,
  `readDeviceRecord`); a test goes through every kind of update. A record from before this pass
  has none and reads exactly as it did.
- **Every flow honors them from one place, `walkAccountCandidates`:** a piece they left off, that
  is not here, is skipped (`skippedDeclined`): not offered, not brought in, not counted, whether
  the flow is Get changes, Restore, Review or the automatic update. A piece that IS here is an
  ordinary piece again (a stale answer never hides a piece's updates). A pair is never matched by
  name (`matchPoolFor`), so the other copy is an ordinary new piece, not a combine. The automatic
  update still never combines anything.
- **The check stops counting a piece they left off** (`classifyAccountChanges`: it is not in
  `added`), so "Changes from another device" and the automatic update's fetch leave it alone.
- **"Ask me again about what I said no to"** (Settings, Account; shown only while something is
  remembered, with a line saying what it holds): forgets every answer for this account on this
  device (`withDeclinedCleared`), changes nothing else, makes **no request**, and the last look at
  the account is sorted against the record again, so the line that counts changes shows the
  pieces again at once. It also brings the combine question back, because the pair goes with it.
- **Asking for a piece by name beats an old no** (`withDeclinedRemoved`, in
  `bringBackThroughApply`): "Keep it" and "Restore" forget any answer about that piece first.
  **A restore starts afresh** (`openAccountFlow("restore")` forgets earlier answers first): it is
  only offered on the welcome screen, which has no Settings, so an earlier "no" there would leave a
  person with no way to see those pieces again.
- **A name match with no composer on either side is "maybe the same piece"** (`uncertain` on a
  combine; `composerBlank`). The row starts unticked and says why. A match where both have a
  composer (and they agree) is exactly as before. **File import is unchanged** (`findMatchingPiece`
  was not touched; the window's own piece-order question stays for a file).
- **Piece order follows the person; nobody is asked.**
  - *Engine* (`lib/pieceMerge.js`): `SOFT_PARTS` (`sortOrder`, `createdAt` and, since the most
    recent reorder wins, `switcherOrder`) are never a conflict. Changed on one side only they
    travel like any part. Changed on both to different values, `planPieceMerge` settles them
    itself, lists it in `softSettled` and never in `conflicts`: the rank and the reorder note go
    to the side holding the MORE RECENT reorder; where the notes cannot tell (no note on either
    side, or the same one) and for `createdAt`, to the side `softWins` names. The default is
    `"remote"`, the other copy (the account's), so the merged piece holds exactly what the
    account holds and nothing about order is left waiting to go up.
  - *Tabs of one browser* (`lib/tabSync.js`): `softWins: "local"`, so with nothing to date the two
    reorders this tab keeps its own order exactly as it did when the two were listed as
    conflicts; when a note dates them, the more recent reorder wins here too. **Two rules for
    one engine, on purpose:** the person is working in this tab; the account is the shared copy.
  - *The window and Get changes / Review* (a piece changed in both places, merged through the
    import merge, which has no base): `orderChoiceFor` decides, and the account's flows pass
    `orderChoice: "follow"`. The more recent reorder (the dated note) wins when either side
    holds one. Otherwise: same order on both sides, nothing to choose; only this device
    reordered since it last synced (the recorded base says so), this device's; else the
    account's. Two copies being combined keep the place of the one that is here. The "Piece
    order" question is gone from the account's window.
  - *The list* (`compareSwitcherOrder`, used by `App.jsx`'s switcher): merging a reorder piece by
    piece can leave two pieces with the same rank (seen in the browser); the old sort left such a
    tie to the order the pieces were loaded in, which can differ between devices. Ties are now
    broken by date added, then id, so two devices holding the same pieces show the same list. It
    orders exactly as the old sort wherever there is no tie (a test compares them).
- **The most recent reorder wins (the owner, 2026-10-25), as a whole list.** Pieces are saved one
  row each, so no single place holds "the order". Every drag in the switcher therefore leaves the
  same small note in the pieces it changes: `piece.switcherOrder = { at, ids }`, the moment of the
  drag and the WHOLE arrangement (every piece's id, in order). `planSwitcherMove`
  (`lib/pieceMerge.js`) decides what a drag writes and `App.jsx`'s `moveGroupTo` writes it; the
  ranks are written as they always were.
  - **What is shown** is a pure function of the pieces (`sortPiecesForSwitcher`): the arrangement
    of the LATEST note held by any piece; a piece the note does not list (added after it) follows
    the listed ones by the old rule; no note anywhere is exactly the old order. So it does not
    matter which rows of a drag reach a device first, or that a drag left some pieces' rows
    untouched: one changed row carries the whole list. (The stored ranks can then disagree with
    the list for a piece or two. That is harmless: the list decides, and the next drag writes
    fresh ranks.)
  - **What a merge does** is keep the later of two notes (`compareOrderNotes`; the same moment is
    settled by the arrangement's text, so it is one answer on every device), and the rank with
    it, never as a question. `orderChoiceFor` and the account's import merge (`mergeInto`) apply
    the same rule; two copies being combined keep the note of the piece that is here.
  - **A new reorder is stamped after every reorder the device has already SEEN**
    (`nextOrderStamp`: the later of now and one past the latest note it holds, its own or another
    device's), so a device whose clock runs behind still wins when it reorders after receiving
    the other's. Only two reorders made without either device having seen the other are judged by
    the clocks, which is the one place a wrong clock can pick the wrong winner.
  - **Nothing extra is saved or uploaded for a drag:** the note goes into the pieces whose rank
    changed and the one dragged, as the rank always did. Stamping every piece was considered and
    not built (every piece would upload on every drag, and every piece the other device had
    changed meanwhile would be held); so was a time per piece with the later winning piece by
    piece (two drags made apart would blend into a list neither device showed).
  - **A backup file never brings a note in** (`handleConfirmImport` drops it: it dates from
    another day and lists pieces that may be gone). Choosing "Use the imported order" is a reorder
    of its own, stamped now, so it is the most recent one.
  - **Old data and old devices:** a piece nobody has dragged since this existed has no note and
    behaves exactly as before. A device on the previous version keeps writing ranks and no note;
    its reorder is dated by nothing, so a noted reorder beats it (found item 17).
- **A piece held by a refused upload that still knows what it last synced** (its record entry keeps
  the fingerprint of every part as last agreed) **is asked about like any held piece**
  (`heldIdsToSettle`, used by `planSettle`): Pass 121's one-question-at-a-time flow, with the
  engine run against that recorded base. One with no recorded base (a first upload that was refused,
  an import) goes to the whole-piece picker exactly as before. The automatic update still treats it
  as "needs a person". Nothing about how an answer is applied changed.
- **The words** (`describeUntickedNote`, `describeCombineRow`, `describeCombineBadge`,
  `describeLeftOff`, `describeAskMeAgainHint`, `describeAskMeAgain`, `ASK_ME_AGAIN_LABEL`) are
  tested functions, and a result says what stayed off ("1 piece you said no to stays off this
  device. "Ask me again" in Settings, under Account, brings it back.") so "everything matches" is
  never read as "nothing is held back".

**Not changed:** the stored format of a piece, the account database, the merge engine's other
rules, how an answer to a question is applied, file import, a deletion (Pass 122), the technique
library, the check's timing. The device record gains one optional field.

**Checked.** `npm test`: 1,519 pass, 43 new (26 in `test/accountSync.test.mjs`, 15 in
`test/pieceMerge.test.mjs`, 2 in `test/tabSync.test.mjs`); `npm run build` succeeds. **30
deliberate breakages, each caught by a test** (23 in the account code, 6 in the engine and the
list order, 1 in tab sync), including the card's five: forget the remembered pair, remember it one
way only, let order conflict again, let each device keep its own order on a conflict, and give a
piece with no recorded base one anyway. **The merge simulations run wider than the card's seeds**
(every kind of edit now includes a reorder and a date change, and a seventh invariant: order and
date added are never a conflict and the other copy wins): seeds 1 to 3,000 (35,994 syncs) every
kind of edit, 1 to 1,000 (12,025 syncs) everyday mix, and a new convergence run of 3,000 seeds in
which two devices reorder at random and, after a full exchange, hold the same order and date
added (6,796 order or date conflicts settled by the engine). **That wider run found something
(found item 1).** **In a real browser** (2026-10-25; the real app against a throwaway local
stand-in for the account service, several addresses as devices): declining a combine then pressing
Get changes three times opens no window; "Ask me again" brings the combine back at once with no
request; a new piece left unticked stops being counted and comes back the same way; combining
still works and the other row carries `mergedInto`; a restore with a same-named copy left unticked
restores both while a piece left unticked is left off and nothing in the account changes; a
"maybe" row starts unticked with its words and a matching-composer row is unchanged; a reorder
made with the app's own drag handler reached the other device with no question; two devices
reordering differently while offline, the automatic switch off: the two real pieces' uploads were
refused and held, Review settled them with "nothing is left to decide" and both devices ended
with the same ranks for the pieces they share; with the
switch on: nothing held, no window, "Updated from another device"; a piece held by a refused
upload with the same field changed on both devices was asked as a plain question ("Notes: ... on
this device, ... on your other device") and the answer applied; signed out and with no account
service the app shows no account surface and the file import still asks about piece order. **Not
seen:** the real preview with the real test project (the card's "Yours" checks).

**Checked again after "the most recent reorder wins" was added** (same day). `npm test`: 1,554 pass
(35 more than above: 30 in `test/pieceMerge.test.mjs`, 4 in `test/accountSync.test.mjs`, 1 in
`test/tabSync.test.mjs`); `npm run build` succeeds. **24 more deliberate breakages, each caught
by a test** (19 in the note, the list and the drag; 5 in the account code), for example: the
earlier note wins, the list ignores the note, the first note found instead of the latest, a new
reorder stamped at plain "now", the engine settling by the fixed side, a drag that does not write
the piece it moved, one shared note object, a combine that takes the other copy's note. **A new
simulation of the whole property:** two or three devices with 3 to 6 pieces drag pieces around
while apart (some drags before the device has seen the others', some after, device clocks up to
0.4 s off), log practice so real merges happen, and sync in random orders; after a full exchange
every device shows the SAME list and it is exactly the arrangement of the latest note, not a
blend. 300 runs (3,030 drags, 990 rounds with two or more drags made apart, 4,568 order parts
settled by the engine) and, wider, 3,000 runs (30,760 drags, 10,045 such rounds, 48,365 order
parts settled), all green; so are the earlier simulations at seeds 1 to 3,000 and 1 to 1,000. **In
a real browser** (the real app against a local stand-in for the account service, two addresses as
devices, the real drag handler, 2026-10-25): with the automatic switch off, the earlier drag
uploads first and the later drag's device is held, Review says "Nothing is left to decide", and
BOTH devices end showing the later drag's list; the reverse (the later drag uploads first, the
earlier drag's device is held) ends with the later list too and re-uploads nothing; with the
switch on nothing is held and both end with the later list (the stored ranks of one piece
disagreed with the list at that moment, which is the case the note exists for); a file import
whose pieces carry a later-dated note leaves the list alone, and "Use the imported order" changes
it and the other device follows; dragging a multi-movement work moves it as a block; signed out,
a drag survives a reload with no account surface. **Not seen:** the real preview with the real
test project.

**After the build (2026-10-27).** The owner merged the pass (pull request 75, merge commit
`0b53445`) and it is live on both addresses (the deployed bundle contains the new "Ask me again
about what I said no to" button). Of the card's preview checks she had reported only the first
(2026-10-26), and that is where the unexplained banner under "Found" came from; results for the
others were not reported in the conversation that built the pass, so treat it as unseen on a real
account beyond that first check unless the owner says otherwise.

**Found, for decisions** (none acted on beyond what is said):

1. **The wider simulation found an over-strict check, on `main` too.** Seed 311 failed before this
   pass, and seed 1352 after it, with the same message ("unchanged part daysToLearn"). In a
   minutes-per-day schedule `daysToLearn` is worked out from the other schedule parts on every
   load, so after a merge it can differ from both copies even when neither changed it (one side
   changed minutes per day, the other split a chunk). The engine reconciles it so a reload gives
   the same piece (invariant 4, which held); the check that called it a lost part was the thing
   that was wrong. Relaxed for that one part in a minutes-mode piece, with the reason in the
   test, and the wide run re-done green. Nothing in the engine changed for it.
2. **The window's confirm button was disabled with nothing ticked**, so a person could not say no
   to a single piece. Fixed ("Leave these off").
3. **A first version of the rule opened a window again.** With a declined combine remembered only
   as a pair, the other copy became a "new piece" and the next Get changes offered it. The card
   says no window opens again, so in Get changes the copy is also kept off. (The pair still
   matters: it is what lets a restore bring the other copy in as its own piece instead of
   combining it again, and it is what "Ask me again" clears, so the question is a combine again.)
4. **Piece ranks tie** after merging a reorder piece by piece: the list got a deterministic
   tie-break (above). The next drag gives every piece a fresh rank and ends the tie for good.
5. **"Keep it" and "Restore" had to beat an old no**, or restoring a piece the person once left
   off would have cleared its deletion in the account and then silently not brought it here.
6. **"Select none" leaves everything off and remembers it.** Said in the window, and "Ask me
   again" undoes it, but a person who wanted "just these now, the rest later" has no such choice.
   Proposed, if it matters: leave a row alone when it was never touched by hand.
7. **The answers are this device's.** Another device asks once for itself. They are not in the
   account (that would be a stored change and a decision about whose "no" counts).
8. **A tab or phone still on the previous version rewrites the device record without them** the
   next time it saves it, and they are lost (the previous code drops fields it doesn't know). Like
   Pass 119's old-version warning: reload old tabs after this deploys.
9. **Answers are not pruned.** A piece that is deleted or gone from the account stays in the list
   until "Ask me again" (500 at most, the newest kept).
10. **"The most recent reorder wins" was not built at first, only the account's order. Built the
    same day**, when the owner chose it (above); items 16 to 21 are what came with it.
11. **Old and unchanged: the "Changes from another device" line stays after a combine until the next
    check**, because the last look at the account still shows the other row live. It clears by itself.
12. **In a restore, leaving both a piece and its "other copy" unticked restores neither**, which is
    what the ticks say, but the other copy's row reads "both are restored".
13. ~~**`docs/Algorithms.md` (the merge-by-part section) was not updated:** it is not in the card's
    file list, and it does not say that order and date added are settled by the engine.~~
    **Fixed in the 2026-10-26 docs wrap-up** (the section was also stale about the engine being
    unused; see [Algorithms.md](Algorithms.md#merging-by-part-pass-117)).
14. **The every-minute check did not fire in the embedded browser pane**, with or without the
    page in front (checks ran on "online", on the buttons, on load). Checked by hand, not a change.
15. ~~**`MAX_DECLINED` (500) is a hand-picked bound** and is not in `docs/Research.md`.~~
    Nothing depends on the number; it only stops the record growing without end. **Now listed in
    [Research.md](Research.md#account-sync-timings)** (2026-10-26 docs wrap-up).

**Found while building "the most recent reorder wins":**

16. **A plain drag can still make the other device's pieces "changed on another device".** Pieces
    are uploaded only if the account row is still at the revision this device knows, and a drag
    changes the rank of every piece between the old and new place. If the other device had changed
    any of those pieces meanwhile (practice logged on the phone, say), the upload is refused and
    the piece is held, with the switch off; Review then says "Nothing is left to decide" and the
    most recent reorder wins. This is the rule from Pass 111 and was the same before; it is not
    new, but a reorder makes it easy to see (seen in the browser: a drag on one device with the
    other device's reorder already uploaded).
17. **A device on the previous version** (a phone left open) writes ranks and no note, so its
    reorder is dated by nothing and a noted reorder, however old, beats it. Reload old tabs after
    this deploys (as for Pass 122b's remembered answers).
18. **The clock.** Two reorders made without either device having seen the other are judged by
    their clocks (a device seconds off is harmless; one that is days off could pick the wrong
    winner). A reorder made after receiving the other's is always later (`nextOrderStamp`), so
    only a real clash can go wrong, and the cost is that one list wins instead of the other.
19. **The note lives in the pieces the drag changed (at least two).** If every one of them is later
    deleted, the arrangement falls back to the stored ranks, which can disagree with each other
    after two devices dragged apart (a tie, ordered by date added). The next drag fixes it.
20. **A piece added after the latest drag goes to the end** of the list, as a new piece always did.
    A piece brought in from a backup file while a note exists now also goes to the end (it used to
    sit where the file's own rank put it).
21. ~~**`docs/Algorithms.md`'s merge section** does not yet mention the reorder note.~~ **Fixed in
    the 2026-10-26 docs wrap-up** (same as item 13).
22. **An unexplained "N pieces changed on another device" banner on the owner's first preview run
    (2026-10-26), not reproduced and not fixed.** In short: part-way through several short drags in
    one window, with the automatic switch off, that window showed the held banner for two pieces
    and (she thinks) no "Backed up just now"; the other window then showed the right order after Get
    changes. Four local attempts to reproduce it (a long list with leftover pieces, drags timed to an
    upload run, a slow service, two tabs of one window) all uploaded cleanly. The full account, the
    candidates and the two facts that would decide it are in
    [Decisions.md](Decisions.md#open-questions) (the Pass 122b entry, item 1).

**Left open:** items 6 to 9, 12, 17 to 20 and 22 above; a piece held by a refused upload with no
recorded base still goes to the picker; "always keep both" (deferred, no owner); size and schedule
travelling together (proposed as its own pass); the automatic update's "applied when you're done"
line; and the real-project checks.

## Opening the app with no connection (Pass 123)

**What it does.** Practice has always worked offline once the app is open: the working copy is on
the device, and Pass 111 keeps changes waiting until the connection comes back. What did not work
was *opening* the app with no connection (a closed tab, a phone in a practice room with no wifi):
the browser had nothing to open. Since Pass 123 a small service worker, `public/sw.js`, keeps a
copy of the page and of the app's own files in the browser, so a device that has opened the app
once with a connection opens it again without one. It does this for everyone, signed in or not,
and in a build with no account service too.

**The decision (the owner, 2026-10-28): a small hand-written worker.** The card's three options
were A, a few dozen lines of hand-written code with no new dependency; B, `vite-plugin-pwa`
(more features, such as an install prompt and a file list, but a new dependency and its
configuration); and C, nothing (opening still needs a connection). She chose A and confirmed
the wording "Working offline. Everything is saved on this device and will back up when you're
connected." The risk A carries is the one the card named: a worker lives on the live address and
keeps the app's code, so a mistake could leave a browser stuck on an old version. That is why the
page is always asked of the network first, and why there is a way back
([DEPLOYMENT.md](../DEPLOYMENT.md#the-offline-worker-and-turning-it-off-pass-123)) that was
tried before the pass was handed over.

**The rules `public/sw.js` follows, and must keep following**

- **The page** (`/`, a navigation): ask the network first. A good answer is shown and also saved.
  If the network fails, the saved copy is shown. With nothing saved, the browser shows its own
  offline page, exactly as it would with no worker. So while there is a connection a new
  version always shows, and the app can never be stuck on an old page.
- **The app's own files** (`/assets/...`, whose names change whenever their content does): the
  saved copy if there is one, otherwise fetch and save. The on-demand account library file is an
  ordinary file under `/assets/`, so it is saved the first time the app asks for it while the
  worker is in charge.
- **Everything else is left alone**, so the browser handles it as if the worker did not exist:
  every request to another website (the account service, Google Fonts), every request that is not
  a GET, a request with a `Range` header, and any other path (including `/sw.js` itself).
  **Never handle an account-service request**: the revision rule ("save only if still at revision
  N") must see the real answer every time, and a saved answer would hide it.
- **When it is installed** it saves the page and the files the page names straight away (the
  "warm-up"), so the app opens offline from the very next visit and not the one after; anything
  that cannot be fetched then is saved the first time it is asked for, and a failed warm-up never
  fails the install. It then takes over at once (`skipWaiting`, `clients.claim`).
- **Versions and size.** `VERSION` at the top of the file names the saved copies; **change it
  whenever the file changes**, and caches made by other versions are deleted when the new one
  takes over. At most 60 saved `/assets/` copies are kept (dozens of versions of the app, each
  adding about one file), oldest first, so the store cannot grow without end; whatever is missing
  is saved again at the next visit that needs it.
- **Only built versions register it** (`src/main.jsx`, `import.meta.env.PROD`), after the page has
  loaded, and every visit asks the browser to look for a changed worker (`update()`, with
  `updateViaCache: "none"`). That request is also how the way back reaches a device. A browser
  that refuses a worker (some private windows, older browsers) keeps working as it always did.
- **Plain ES5.** Files in `public/` are copied into the build untouched, so nothing rewrites newer
  syntax for the Safari 14 build target; `test/browser-compat.test.mjs` now checks `public/` for
  the two things it checks `src/` for (regex lookbehind, `randomUUID`).

**The status line.** `describeSyncStatus` (`lib/accountSync.js`) takes `offline`, which
`App.jsx` keeps as `browserOffline` from the browser's own `online` and `offline` events (only on a
site with an account service). When the browser says there is no connection and an attempt has
failed (one failure is enough: the browser has already said why), the Account line reads
`OFFLINE_STATUS_TEXT`, "Working offline. Everything is saved on this device and will back up
when you're connected." It sits in the same place as "isn't answering": quiet tone, and it
replaces the held message too. With no failure yet, or with the browser saying it is online, nothing
changes: a plain failed check still says "The account service isn't answering." The `online` event
already retried at once and forgot the back-off; the line goes back to normal with it.

**Not built, on purpose** (the card): installing to the home screen (a manifest and icons),
background sync and push, and saving the account service's answers.

**Checked.** `npm test` 1,576 pass (two new: the wording rule and the `public/` compatibility
guard), `npm run build` succeeds. Eight deliberate breakages of the wording rule, each caught by a
test (needing the not-answering count, firing before any failure, treating any truthy value as
offline, removing the line, ignoring the browser, changing the words, the wrong tone, "not
answering" saying offline); the compatibility guard fails when a lookbehind or `randomUUID` is put
in `public/sw.js`. In the Browser pane (Chromium), with built versions served from a local folder
by a small server that sends the live host's cache headers (the page revalidated every time,
hashed files immutable) and a local stand-in for the account service:

1. **A clean first visit**: the worker registered, activated and took control, and had already
   saved `/` and the entry file.
2. **Opened with the server stopped** (no build with an account service, nothing signed in): the
   page opened, served by the worker, after exactly one earlier visit.
3. **A new build on the same address, with a connection**: the next open showed the new version
   and loaded only its files; the old file stayed saved but was not used.
4. **What the worker handles**, from a throwaway instrumented copy that recorded every request
   a controlled page made (not committed): the page and `/assets/` files were handled; five GETs
   and a POST to the account service, Google Fonts, `/sw.js`, another path and a POST to `/` were
   all left to the browser.
5. **Signed in, opened with both the web server and the account service stopped**: it opened with
   its pieces, and the account library file had been saved the first time it was asked for. A change made
   offline read "1 change waiting to back up", then (the browser still saying online) "The account
   service isn't answering. Everything is still saved on this device.", then (the browser saying
   offline too) "Working offline. ...". With both servers started again the change reached the
   account by itself and the line read "Backed up just now".
6. **The way back**: the self-removing worker, extracted from DEPLOYMENT.md and served as `/sw.js`,
   left no registration and no saved copy after one visit with a connection, did not loop on the
   next, and with the server stopped the app no longer opened.
7. **`npm run dev`**: no worker, nothing saved.
8. **On a real preview address** (https, the live host): `/sw.js` is served as
   `application/javascript` with `cache-control: public, max-age=0, must-revalidate` (the page the
   same; the hashed files too, so the host does not mark them immutable, and the worker's
   "saved copy first" saves those revalidations), and a file that does not exist is a real 404,
   not the page. The worker registered, took control and saved `/` and the entry file on a first
   visit. **The way back was rehearsed there** on a throwaway branch's preview: the real worker
   registered at that address, a second commit replaced `public/sw.js` with the self-removing worker
   from DEPLOYMENT.md, and the next visit with a connection left no registration and no saved copy
   within about two seconds. (The throwaway branch was deleted afterwards.)

**Seen by the owner (2026-10-28, on the preview of pull request 79, before it merged):** on the laptop, signed in with a first backup made, Wi-Fi off, the app reopened with her pieces, and the Account line read "Working offline. Everything is saved on this device and will back up when you're connected." (it replaced the red held message for the technique library, as designed); after Wi-Fi came back the line read "Backed up 1 minute ago", so the offline change went up by itself. On the phone, Safari opened the app offline after one visit. Pull request 79 was merged that morning (merge commit `038f256`, 10:51 her time) and the three live addresses serve `index-78o7whRf.js` and `/sw.js`. **Not seen by anyone:** the "new version shows" check on a preview (done locally only), and the signed-out look after a long offline spell (found item 1) in her browser. Her laptop run also showed what the first backup of a fresh browser does to a test account that already has a technique library: the library is held ("changed on another device") until Review.

**Calls made while building it, for the owner to overrule**

- **The warm-up at install** is not on the card. Without it the app would open offline only from the
  visit after next (a first visit saves nothing the page had already fetched), against the card's
  "from the following visit".
- **One failure is enough** for the offline wording while "isn't answering" still needs two, because
  the browser's own flag is not a guess.
- **`skipWaiting` and `clients.claim`**: a changed worker takes over at once, including in tabs
  that are already open. The way back needs that. The cost is that an old page can find its saved
  files replaced under it, which online only means fetching them again.
- **A cap of 60 saved files** and `update()` on every visit (one tiny request) are mine.
- **The way back deletes only caches whose names start with `measureone-app-`.**
- **`test/browser-compat.test.mjs` was extended** to `public/`, as proposed in the hand-off; it is
  not on the card's file list.
- **`docs/Architecture.md`** also had a paragraph still saying changes "never arrive by themselves"
  (true before Pass 120); it is corrected.

**Found, for decisions** (none acted on beyond what is said)

1. **Opened offline when the sign-in's hour has run out: the Account section looks signed out.**
   This is the card's "confirm and report". With a stored session whose access token has expired
   (the app has not been online for more than about an hour), a cold open with no connection
   **does not sign the person out**: the stored session, the device record and every piece are
   untouched, the app opens and practice works. But the account library cannot refresh the token
   while offline, so for up to about a minute the Account section says "Checking your account..."
   and then shows the signed-out view ("Sign in ...") until the connection returns. There is no
   "Working offline" line then, because that line belongs to a signed-in session. Seen against
   the stand-in: when it came back and the window was visible, the library refreshed the token
   within seconds and the section read "Signed in as ..." again with nothing pressed. (By the
   design in "Keeping the backup current", a change made meanwhile is found by comparing and goes
   up once the session is back; not tried in this state.) While the token is still good (the
   first hour after it was issued) a cold open offline shows the signed-in view and the "Working
   offline" line, which is what was tried above. **Proposed, not built:** while offline with a stored session, show the stored account
   (its email) as signed in with the offline line, for display only, leaving `authSession` (which
   gates all syncing) alone. Needs the owner's call because it changes what "signed in" shows.
2. **A connected but dead network** (wifi with no internet) is not "offline" to the browser, so
   the page open waits for the browser's own timeout before the saved copy is used, and the
   status says "isn't answering", not "Working offline". A short timeout before falling back would
   fix the wait, at the cost of sometimes showing a one-visit-old page on a slow connection.
3. **A device signed in before Pass 123 may not have saved the account library file yet.** The
   file is saved the first time the app asks for it while the worker is in charge, which is the
   second visit. An offline open before then cannot load it, the app looks signed out, and
   nothing asks for it again when the connection returns (a reload does). Reasoned from
   `attachAuthListener` and `loadBackend`, not tried. The warm-up could also save the files the
   entry file names; not done.
4. **Fonts.** The app takes its fonts from Google Fonts over the network, so by the card's rule the
   worker leaves them alone, and offline the app uses the system's fallback fonts and looks a
   little different. Seen in the requests, not on screen.
5. **Browsers and storage.** A browser that refuses a worker (some private windows) cannot open
   offline, and Safari removes a site's saved data, the worker's copies included, after about a
   week without a visit (the same rule that already applies to the pieces).
6. **No automated test of the worker's routing is committed**: it is not on the card's file
   list, and a throwaway check of the same behavior was run instead (item 4 above). A small test
   that loads `public/sw.js` with a fake `self`, `caches` and `fetch` would pin it; offered.

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
  succeeded on a later attempt. **If the dashboard reports a deadlock (on
  production too), run the file again; if it keeps happening, run it in three
  parts, each on its own: the function, then the `pieces` trigger, then the
  `technique` trigger.** Each part touches one table, so it can't collide.
  Future changes go in new numbered files, applied to the test project first
  and then to production, by hand in its SQL Editor (the app can't).
- **Where the two settings come from:** Project Settings → **Data API** (the
  project URL; the page shows the address ending `/rest/v1/`, and the setting
  is the address without that ending) and → **API Keys** (the
  **publishable** key, `sb_publishable_…`). The secret key was never copied.

**Accounts:** one, the owner's own, invited from the dashboard on 2026-09-30
(Authentication → Users → Add user → Send invitation). Nobody else has one
(Phase 1, see [Open questions](#open-questions)).

**Vercel:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` added under the
project's Settings → Environment Variables as type **Config** (neither is a
secret), **Preview only**. Production and Development had none then;
Production got its own two at go-live (see
[Setup (production project)](#setup-production-project)). Vercel applies them
from the next build, so a branch pushed after that picks them up.

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
  dashboard (Supabase's current guide says up to a year after the pause, an
  older page says 90 days; the dashboard shows the real deadline).
- **No automatic backups.** The account copy is a second copy of the data,
  next to this browser's copy and any exported backup files. If Supabase lost
  the database, nothing would restore the account copies. The manual export
  and the export reminder stay for that reason. **The Free plan has no
  dashboard backup or download either** (an earlier version of this page said
  to export from the dashboard; that was wrong). Supabase's own advice for
  free projects is to export regularly with its command-line tool
  (`supabase db dump`) and keep copies off-site (read 2026-10-10). **The owner
  raised on 2026-10-10 that this undercuts the point of accounts; it is open,
  see [Decisions.md](Decisions.md#open-questions).** Pro (from $25 a month,
  read 2026-10-10 on [pricing](https://supabase.com/pricing)) keeps daily
  backups for 7 days and never pauses a project. **Since 2026-10-12 a free daily
  copy exists** (see [Backups of the account copy](#backups-of-the-account-copy-2026-10-12)),
  so this is no longer the only protection; Pro is deferred until the app earns.

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

## Setup (production project)

Done in Pass 114 (the go-live, 2026-10-10). The dashboard steps were done by
the user. The security checks were run against the project itself, with
`scripts/check-rls.mjs`, not read off the settings pages.

**Supabase: one project, `measureone-prod`**, Free plan, at
`https://tqamtwdraqsvejvhiptz.supabase.co` (the test project is
`devbzzbtinzxspmiatba`). It started empty and has no accounts until the
owner's own is invited.
- **Tables and security rules:** `supabase/migrations/0001_accounts_backend.sql`
  and then `0002_revision_counter.sql`, each run once in the SQL Editor on
  2026-10-10. Both ended with "Success. No rows returned." (no deadlock; the
  notes under [Setup (test project)](#setup-test-project) apply if one ever
  appears).
- **Authentication → Sign In / Providers:** "Allow new users to sign up"
  **off** (invitation only, Decided 4), "Allow anonymous sign-ins" off,
  "Allow manual linking" off, "Confirm email" on. The Email provider's own
  settings, read from the dashboard on 2026-10-10, match the test project:
  secure email change on, secure password change off, "require current
  password when updating" off, leaked-password check off (Pro plan only),
  minimum length 6, no character requirements. **Email OTP expiration is 3600
  seconds, so an invitation link or a reset link stops working after one
  hour.** Send an invitation only when its person can open the email at once;
  a late link opens the sign-in window with the plain "expired" note, and a
  fresh one is sent. The sign-up and anonymous settings were also tested
  directly: the script's checks 36 and 37 tried both against this project and
  were refused.
- **Authentication → URL Configuration:** Site URL
  `https://measureone-git-main-measure-one.vercel.app`, and one Redirect URL,
  `https://measureone-git-main-measure-one.vercel.app/**`, nothing else. That
  is the address where the owner's pieces live (see **Addresses** below). An
  invitation always opens the Site URL, so it opens where the pieces are; a
  reset link returns to the address that asked (the app sends
  `window.location.origin`), which has to be on the list, and any other
  address falls back to the Site URL. **Changing it later (for example a
  domain of your own) is one setting, and nothing else in the app or in Vercel
  changes:** set the new address as the Site URL and add `https://<new
  address>/**` to the list, keeping the old one while both are used. The app
  has no address built in, and the two Vercel settings name the project, not
  the address. A new address opens as an empty copy of the app (the browser
  keeps pieces per address), so sign in there and press Restore.
- **Where the two settings come from:** the same two pages as the test project
  (Project Settings → Data API and → API Keys, the **publishable** key). The
  secret key was never copied; the script asks for the key hidden for the same
  reason.

**Vercel:** `VITE_SUPABASE_URL` (this project's address) and
`VITE_SUPABASE_ANON_KEY` (its publishable key) added under the project's
Settings → Environment Variables as type **Config**, **Production only**.
Preview keeps the test project's two, and local development its `.env.local`.
Vercel applies a setting from the next build, so the merge of Pass 114 was the
build that picked them up. How to see which project a deployed site talks to,
and the way back, are in [DEPLOYMENT.md](../DEPLOYMENT.md#rolling-back).

**Addresses.** The live site is served at three addresses, all assigned to the
same deployment: `measureone.vercel.app`,
`measureone-git-main-measure-one.vercel.app` and
`measureone-measure-one.vercel.app` (the same page and app file, compared
2026-10-08 and 2026-10-10). **The browser keeps pieces per address and per
browser**, so each address is its own copy. Found on 2026-10-08, when the
owner opened `measureone.vercel.app` and saw an empty app: **the owner's real
pieces are at `measureone-git-main-measure-one.vercel.app`**, so that is the
live address for every setting above, and the one to open on a phone (the owner
has not used the app on a phone yet, so it starts empty and restores from the
account). Signing in works at any of the three, since the build is the same,
but an invitation lands on the Site URL.

**The rollback point** (noted 2026-10-07, before anything changed): the
deployment of commit `8636cfa`, created 2026-10-07 05:51 UTC, app file
`index-B11FjqLP.js`, no account backend. The two ways back, and how to check
the result, are in [DEPLOYMENT.md](../DEPLOYMENT.md#rolling-back).

**Re-running the security checks.** `node scripts/check-rls.mjs` (for the test
project, `node --env-file=.env.local scripts/check-rls.mjs`). It asks for the
project's address, its **public** key (typed hidden; it refuses a secret key)
and two **throwaway** accounts: create them in the dashboard (Authentication →
Users → Add user → Create new user, with "Auto Confirm User" ticked) and
**delete them afterwards** (their rows go with them). It refuses any account
that already holds data, so it can't write into a real account. Run it after
any new migration and after any change to the project's sign-in settings. Its
37 checks, in six groups: your own rows work (8), nobody else's rows (9),
nobody can delete a row (4), signed out nothing at all (8), the database keeps
the revision count (6), sign-ups and anonymous sign-ins refused (2). It is not
part of the app or of `npm test`.

**Checked for real (Pass 114):**
- 37 of 37 passed on the test project and 37 of 37 on this project, both on
  2026-10-10, each with two throwaway accounts. They are Pass 108's by-hand
  checks rebuilt as a script, plus the revision rule (migration 0002) and the
  two sign-in settings. (That deleting an account removes its rows, the
  cascade, is not in the script; Pass 108 checked it by hand, and the counts
  below show it again.)
- Both pairs of throwaway accounts were deleted afterwards and the counts read
  in each project's SQL Editor: the test project had 1 account (the owner's)
  and 0 leftover `rls-check-` rows; this project had 0 accounts, 0 pieces and
  0 technique rows.
- **After the merge (2026-10-10, 9:23 pm in the owner's time zone):** the live
  build was checked from outside. All four addresses (the three above and the
  deployment's own) serve the same new app file. It holds the production
  project's address and not the test one, no secret key, and a public key that
  production's auth service accepts (it answers that sign-ups are disabled). It
  is byte-identical to a clean build of the merged code with only that address
  and key. A signed-out visitor downloads only the page and the app file and
  makes no request to the account service (and sees one new thing, a quiet
  "Sign in" link). A preview built after the Production settings were added
  still holds the test project's address.
- **The owner's own account (reported by the owner, 2026-10-10):** invited from
  the dashboard, then **Back up this device** on the real address. The SQL
  Editor then read 1 account, 25 pieces, 0 deleted, 1 technique row, and, after
  one logged session, a highest revision of 2 (the automatic upload works). On
  the owner's phone (Safari, the same address) the pieces came from the account
  and the owner opened one. It is the only account.

The [Free-plan consequences](#free-plan-consequences) above apply to this
project too: an idle project pauses after a week (restore it from the
dashboard; practice on any device is unaffected) and there are no automatic
backups, so the manual export and the export reminder stay.

**Found in the review before the merge, left as they are (P2):**
1. The script's key prompt is hidden, so a stray space or line break pasted
   along with the key is refused as "doesn't look like the public key" instead
   of being trimmed (the visible prompt used to trim it). Harmless, since
   nothing is checked, but confusing. The fix is one line: trim the key after
   reading it.
2. The script's own tests (a stand-in database that follows the rules, thirteen
   deliberately broken versions, a terminal test of the hidden prompts) were
   run from a scratch folder and are **not committed**, and the script is not
   part of `npm test`. A later edit to it has nothing to catch a mistake.
3. The script knows only the two tables. **A migration that adds a table needs
   that table's checks added to the script**, or "run it after any migration"
   would pass without testing the new table.
4. In "Changing it later" above, "nothing else in Vercel changes" means the two
   settings. The domain itself is still added under Vercel → Domains.
5. Not verified before the merge, checked after it (2026-10-10): the two
   Vercel Production values (the live build holds production's address and a
   key its auth service accepts) and that an invitation works on this project
   (the owner's did). **Still untested:** how Vercel's Instant Rollback and
   Redeploy treat the branch address. An ordinary new deployment, the Pass 114
   merge, moved it together with the other addresses; DEPLOYMENT.md says how
   to check after a rollback.

## Backups of the account copy (2026-10-12)

The Free plan keeps no backups of the production project (see
[Free-plan consequences](#free-plan-consequences)), so a free scheduled job
makes them. **Where:** a separate **private** GitHub repository,
`Chopinbby/measureone-backups`. **It must never be this repository's:** this
one is public, and Supabase's own guide says never to back up data to a public
repository.

- **What runs.** A GitHub Actions workflow (`.github/workflows/backup.yml` in the
  backups repository) is set to run every day at about 09:17 UTC (3:17 am Mountain
  time, 2:17 in winter) and can be run by hand from the Actions tab. **GitHub's
  timer is best effort:** the first run it started by itself (2026-10-12) began
  about 9 hours 40 minutes late, and GitHub says some runs can be dropped when it
  is busy. It uses Supabase's own command-line `db dump` (pinned, with GitHub's
  checkout, to exact versions). Cost: nothing (a private repository and about a
  minute a day of GitHub's free allowance).
- **What it saves** (folder `backup/`, a commit per day, so every day stays in the
  history): `data.sql` (every row of **only the app's two tables**, `pieces` and
  `technique`, as INSERT statements), `schema.sql` and `roles.sql`, `users.csv`
  (account id, email, joined, last sign-in: **no passwords**), `counts.csv`, and
  one **importable file per person**, `app-files/<account id>.json`, in the app's
  own backup format (what **Import a backup** reads). `LAST_BACKUP.txt` says when
  it last ran and the counts.
- **What it deliberately does not save: Supabase's own sign-in tables.** Found on
  the first real run: a data-only dump also includes the `auth` tables (password
  scrambles, live session tokens). The job now dumps only the `public` schema, and
  a guard fails the run (and removes `data.sql`) if sign-in or storage tables ever
  appear. **The first backup commit, made before that fix, still contains them in
  the private repository's history.** The owner signed out of all devices on
  2026-10-12 (which cancels the saved session tokens) and, on Claude's
  recommendation, decided **not** to rewrite the history: GitHub's own guide says a
  rewrite alone is not a full erase, and that once keys are cancelled it may not be
  warranted. What sign-out can't cancel is the scrambled password in that commit;
  changing the account password retires it, and the owner reports having done that
  the same evening (not verifiable from outside).
- **The one secret.** `SUPABASE_DB_URL`, a GitHub secret in the backups repository:
  the **session pooler** connection string (it must be that one: GitHub's runners
  can't reach Supabase's IPv6-only direct address) with the database password in it.
  That password opens the whole database, so it is the most sensitive secret in the
  project; it can't be read back, and resetting it (Database, Settings, Reset
  database password) changes nothing for the app, which doesn't use it. The job's
  first step checks the string's shape and says what is wrong **without ever
  printing the password** (tested for eight kinds of wrong string). The string must
  be copied with Supabase's Copy button: the first attempt contained a "..." from an
  example in a message, and the check named exactly that.
- **How failure shows.** A failed run emails the owner **only once the owner has
  switched on GitHub's Actions notifications** (Settings, Notifications, System,
  Actions: GitHub's own page shows it as "Don't notify"). **Found 2026-10-12: it
  appeared to be off:** GitHub held no web notification for any of the five failed
  test runs, so "GitHub emails the owner" was unverified. **Confirmed the same
  evening:** after the owner switched it on, a deliberate failure (the second check run
  by hand with a limit of 0) raised a GitHub notification and an email, which landed in
  the **Updates** tab of the owner's Gmail, not the main inbox. A run
  fails on purpose if the number of pieces, technique libraries or accounts **goes
  down** (the app never deletes rows, so that would mean something is wrong; the new
  copy is saved first, so yesterday's stays in the history), if an importable file
  isn't valid, if there isn't one per account, or if a dump file is empty. A project
  the Free plan has **paused** also fails the run until it is restored.
- **A day GitHub skips sends no email, so a second check watches for it.** If the
  timer skips a day nothing runs and nothing fails. A separate workflow in the
  backups repository (`check-backup-is-recent.yml`, "Check the backup is recent":
  read-only, no secrets, once a day at about 21:43 UTC) reads `LAST_BACKUP.txt` and
  **fails (so an email follows, if the notifications are on) when the newest backup
  is over 36 hours old or its date can't be read**. A backup that is only a few
  hours late doesn't trip it; a day that never arrives does, within a day or two.
  Run by hand with a limit of **0** it always fails on purpose, which is also how the
  email is tested (a limit of 1 fails only if the newest backup is over an hour old,
  so it passes right after a backup: the owner's own first try said "successful").
  It uses the same GitHub timer, so it can't warn of GitHub itself being down
  for days. One skipped day costs little (each backup is a complete copy, and the
  browser and the account still hold the pieces); the danger is backups stopping
  unnoticed for weeks.
- **Getting things back** (`RESTORE.md` in the backups repository): a lost device
  needs no backup (sign in and press Restore); to look at an earlier day, download
  that day's importable file from the history and import it in a private window
  (import merges, it never wipes); a lost project is rebuilt from the importable
  file or exactly from `data.sql` (new project, both migration files, invite the
  person again, **swap their old account id for the new one in a copy of
  `data.sql`**, run it in the SQL Editor). Skipping the swap gives no error: the
  rows load but nobody can see them.
- **Checked for real (2026-10-12).** First run in GitHub: 25 pieces, 1 technique
  library, 1 account, as the owner's SQL check had said; all 25 pieces in the
  importable file are identical to the owner's own export; `data.sql` holds exactly
  the 25 + 1 rows. The job's shell logic (35 checks), the SQL that writes the
  importable file (run on made-up awkward pieces in a real Postgres engine, with four
  deliberately broken copies that are each caught) and a **restore fire drill** (the
  latest real backup restored into a clean database built from this repository's
  migration files: every piece identical, the new account sees them all) are kept
  in the backups repository's `tests/` folder; the drill is meant to be re-run now
  and then. The second check has its own 74 tests (the checker case by case with a
  fixed clock, the workflow file, and 11 deliberately broken copies of the checker
  and 7 of the workflow, each caught); on GitHub it passed with the default limit and
  failed on purpose, with the plain-English message, when run with a limit of 1 (and
  later with 0, the reliable form: 1 passes within an hour of a backup).
- **Not checked (as of 2026-10-12).** A restore inside a real Supabase project
  (whether the SQL Editor takes a 200 KB paste and the `SET session_replication_role`
  line the dump starts with); the drill uses a scratch copy of the same database
  engine.
- **Upkeep.** GitHub's notices on the runs (2026-10-12): the `ubuntu-latest` label
  moves to Ubuntu 26 from 2026-10-19, so **both workflows are now pinned to
  `ubuntu-24.04`**, the system the job had been passing on (tests fail if either goes
  back to "latest"; both ran green on it by hand). The pinned `actions/checkout` and
  `supabase/setup-cli` also target Node.js 20, which GitHub is retiring (they are
  being forced onto 24 for now; nothing has broken); updating those two pins on
  purpose is logged in [Decisions.md](Decisions.md#open-questions) and not done.
  After any such change, run the tests there and both jobs once by hand.
- **Things to remember.** The backups repository holds real people's practice data
  and emails: keep it private, keep two-factor sign-in on for the GitHub account,
  and when other people get accounts (Phase 3) the privacy policy has to cover this
  copy. The Free plan's pause also stops the job's reads, not the app.

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
