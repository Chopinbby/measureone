# Scope of Work: User Accounts, Backend, and Sync

**Status:** Planning document — no code has been written against this yet.
**Written for:** a non-technical reader making product decisions. Technical
terms are explained the first time they're used.
**Last updated:** 2026-08-18.

---

## Why this document exists

Every other item on MeasureOne's roadmap has been a self-contained feature
you could add to the app running on one device. This one isn't — it changes
where the app's data *lives* and *who* can access it. Because that touches
almost everything downstream (backup safety, letting other people use the
app, eventually selling it, and a deferred idea for in-app PDF editing),
this document lays out the full shape of the change before any of it gets
built, so you can make the calls that matter with the full picture in front
of you.

This is a **planning document, not an implementation plan with a
timeline** — it tells you what has to happen and in roughly what order, not
how many days each piece will take.

---

## 1. Plain-language summary

Right now, MeasureOne keeps all of your data — every piece you're learning,
every practice session you've logged, every setting — in your web browser's
own local storage on whatever one device you're using. Nothing is sent
anywhere. That's simple and has zero ongoing cost, but it has a serious
downside: if you clear your browser data, switch computers, or your browser
profile gets corrupted, everything is gone, permanently, with no way to get
it back except a manual backup file you'd have had to remember to export
beforehand. The app already nags you to do that export — which is really a
sign the team building it (you and me) already knows this is the weak
point.

This change replaces that with a real **backend** — a server, somewhere on
the internet, that stores your data in a proper database instead of your
browser — plus **accounts**, so the app knows *whose* data is whose. Once
that exists, your practice data survives losing a device, works the same
way whether you open the app on your laptop or your phone, and — because
data is finally tied to a person rather than a browser — other people (like
students) can have their own separate accounts on the same app. It's also
the thing that has to exist before selling the app to anyone makes sense,
and before a deferred idea (editing PDF sheet music inside the app) becomes
technically possible, since that needs files to live somewhere more durable
than one browser.

This is the single biggest architectural change on the roadmap, but the
good news from looking at the current code is that the part of the app that
touches storage today is small and unusually well-contained — this isn't a
rewrite of MeasureOne, it's a focused replacement of one layer plus the new
pieces (accounts, security, data transfer) that layer needs to talk to a
server safely.

---

## 2. Current state — what's actually in the codebase today

*(Full investigation detail available on request; this is the summary
relevant to planning the migration.)*

- **Storage mechanism:** the browser's built-in `localStorage` — a simple
  key/value storage area every browser gives a website, with no server
  involved at all. There is no database, no file storage, no backend of any
  kind today.
- **How much of the app touches it:** very little, directly. Only one file
  (`src/lib/storage.js`) ever talks to `localStorage`, and only one other
  file (`App.jsx`, the app's main file) calls it. That's a good sign — it
  means swapping the storage mechanism is a contained change, not something
  scattered across dozens of files.
- **How saving works today:** there's no explicit "Save" button. Every time
  you change anything — log a practice session, edit a setting — the app
  immediately rewrites your data to `localStorage` in the background. A
  backend version of this can't work exactly the same way (writing to a
  server over the internet takes time and can fail in ways local storage
  can't), so this behavior will need to be redesigned, not just relocated.
- **No concept of "who owns this data" exists anywhere.** There's no user
  ID, account ID, or owner field on any piece of data in the app today.
  Data just belongs to whichever browser it's sitting in. This is the most
  fundamental thing that has to be added — every single piece of stored
  data needs a new "which account does this belong to" field, and every
  place the app reads or writes data needs to be taught to check that
  field.
- **IDs used today aren't guaranteed unique across devices.** New pieces
  get an ID based on the current timestamp (e.g., "created at this exact
  millisecond"). On one device, that's fine. Across multiple devices or
  accounts, two pieces could theoretically get the same ID. This is a
  known, fixable gap, not a five-alarm problem — but it needs addressing
  before multiple devices are writing data that ends up in the same place.
- **There's already a manual backup/restore feature, and it's revealing.**
  You can export your data to a file and re-import it (including on a
  different device). The code and the internal documentation for this
  feature are unusually blunt about *why* it exists: because there's no
  server-side backup at all today, this file is described internally as
  "the only backup mechanism" and losing local storage without one means
  **total, permanent data loss.** The app also has a recurring on-screen
  reminder nudging you to export a backup, and it deliberately won't let
  you permanently dismiss it if your last backup is old — both signs this
  gap has already been treated as a real risk worth designing around, not
  a theoretical one.
- **A genuine asset already exists: conflict-resolution logic.** The
  import feature already has real logic for reconciling two versions of
  the same piece from two different backup files — deciding which one is
  "newer," and asking you to manually choose when it can't tell. This
  logic was built for one-time file imports, not live multi-device sync,
  but it's a real head start: a decent chunk of the hard thinking a proper
  sync system needs has already been done once, for a simpler case.

**Bottom line:** the plumbing that needs replacing is small and isolated.
The work isn't "rewire the whole app" — it's "design and build the concept
of an account and a server-side home for data that doesn't exist at all
today," and then connect the app's one storage module to it.

---

## 3. Target state — what "done" looks like

- You can create an account (and, eventually, so can other people) with a
  standard sign-up/sign-in flow, including the ability to reset a
  forgotten password.
- Your data lives on a server, not in one browser. Opening MeasureOne on a
  different device and logging in shows the same pieces, same progress,
  same everything.
- Changes made on one device show up on your other devices without you
  doing anything manual (no more export/import as your primary workflow).
- Losing a device, clearing browser data, or reinstalling your browser no
  longer means losing your practice history — the server is the durable
  copy.
- The manual export/import feature can step back from being "the only
  safety net" to being an optional extra (e.g., a personal archive, or a
  way to move data into the new system in the first place).
- Every piece of data is clearly tied to one account, and one account can
  never see or affect another account's data.
- Basic account-security expectations are met before any real stranger is
  trusted with an account: password reset works, passwords are stored
  safely (never in plain text — see §4E), and there's a privacy policy /
  terms of service if the app becomes public.

**Not required for "done," per your answer:** live sync working from day
one. You've indicated it's fine for accounts + durable server-side storage
to ship first, with automatic multi-device sync following as a later
phase — see §7 (Phases).

---

## 4. What has to change

Grouped by concern, so this stays organized rather than turning into one
long list. Each group is a distinct kind of work with its own decisions and
its own risks.

### A. Authentication & accounts

*"Authentication" just means "proving you are who you say you are" —
logging in.*

- Sign-up and log-in screens.
- Password reset ("forgot password") flow — an email-based process to
  regain access. This is a **hard requirement before any public user**
  relies on the app, not a nice-to-have — without it, one typo or forgotten
  password permanently locks someone out of their own data.
- Session handling — keeping you logged in between visits without asking
  for your password every time, in a way that's still secure.
- Optionally, "log in with Google" or similar — convenient, not required.
- Basic account settings (change email, change password, delete account).

### B. Data storage & sync

*A "database" is the server-side equivalent of what `localStorage` does
today — a structured place to store data — but built to be safely shared
by many accounts at once and to survive far more than a browser can. An
"API" (application programming interface) is the defined way the app on
your device asks the server to read or write data — think of it as the
server's front desk: the app doesn't touch the database directly, it makes
a request through the API, and the API decides what's allowed.*

- Design a database schema (the structure the data is organized into) that
  mirrors the current piece/progress data model, plus the new "which
  account owns this" field on everything.
- Build the API the app will talk to instead of `localStorage`.
- Redesign the "save on every change" behavior for a world where saving
  means a network request, not an instant local write — including what the
  app should show you if a save fails because you're offline or the
  network is slow (today's "your last change couldn't be saved" banner is
  a reasonable starting point, but the causes and recovery are different
  over a network).
- Multi-device sync logic — deciding what happens when the same piece was
  changed on two devices before they talked to each other. This builds
  directly on the existing import/merge logic described in §2, adapted
  from "reconcile two backup files" to "reconcile two devices that are
  usually connected."
- A decision on whether the app needs to keep working with no internet
  connection (you might practice somewhere without wifi) and sync once
  you're back online, or whether it's acceptable to require a connection.
  This is flagged as an open decision in §5.

### C. Migrating existing local data

This is its own group because it's the single highest-risk part of this
change — see §6 (Risks) — and deserves to be planned separately rather than
folded into "storage" work.

- A one-time flow for existing local data: when you (or an existing user)
  first log in on a device that already has pieces sitting in local
  storage, that data needs to be uploaded to the new account.
- The upload must be **verified** before anything local is treated as
  disposable — i.e., confirm the server copy matches before relying on it
  as the only copy. Standard best practice here is: never delete or
  overwrite the only existing copy of someone's data until a second,
  independent copy is confirmed intact. For irreplaceable personal data
  like months of practice history, that verification step isn't optional
  polish — skipping it is how "we migrated your data" turns into "we lost
  your data."
- Handling the case where the *same* browser/device already has multiple
  local pieces and the account being logged into already has data too
  (e.g., you test this on a second device that already has some pieces on
  it) — this reuses the existing merge logic from §2 rather than requiring
  new design from scratch.

### D. App changes to support multi-user

- Every read and write of data anywhere in the app needs to be scoped to
  "the logged-in account" — this is the practical, code-level consequence
  of adding ownership described in §2.
- Replace timestamp-based IDs with IDs that are safe across many
  accounts and devices generating data independently (a standard,
  well-understood fix, not a design problem).
- Decide what a logged-out state looks like — does the app still work at
  all without an account (e.g., a "try it locally first" mode), or does it
  require an account up front? This affects how gentle the transition is
  for you as the very first "migrating" user, and is called out as an open
  decision in §5.

### E. Security basics

*Security has a floor below which the app shouldn't go live to real
strangers, whatever else is still in progress.*

- Passwords are never stored as plain, readable text — they're run through
  one-way scrambling (hashing) so even if the database were somehow
  exposed, passwords aren't recoverable from it. If you use a managed
  service for authentication (see §5), this is handled for you
  automatically and correctly, which is one of the main reasons that
  option is attractive for a solo, non-specialist maintainer.
- All traffic between the app and the server is encrypted in transit
  (HTTPS) — standard, and provided automatically by virtually every
  hosting option available today.
- The database must enforce that account A's requests can never read or
  write account B's data, even if there's a bug elsewhere in the app —
  this is usually done as a rule enforced by the database itself, not just
  trusted to the app's own code, precisely because app code is where bugs
  happen.
- If the app becomes public, a basic privacy policy and terms of service
  become necessary — not because of unusual data sensitivity here, but
  because collecting any account/email data from the public generally
  requires disclosing what you collect and why.

---

## 5. Open decisions

These are choices only you can make, laid out with trade-offs rather than
as open-ended questions. Where you already answered one during scoping,
it's noted and kept here for reference so the full decision record lives
in one place.

### 5.1 Backend hosting approach

*"Managed service" or "BaaS" (backend-as-a-service) means a company runs
the server, the database, and often the login system for you, and you pay
them a fee that scales with usage — you configure it, you don't operate
it. The alternative is renting a bare server and running all of that
software yourself.*

**Recommendation: a managed service**, specifically one built around a
real relational database (Postgres) with built-in authentication and file
storage — **Supabase** is the concrete recommendation. Reasoning:

- It gives you accounts/login, the database, and file storage (relevant
  later for the PDF-editing idea) as one connected package, rather than
  three separate services to wire together.
- Its database is a genuine, standard database (not a proprietary format),
  which matters if you ever want to move providers later — your data isn't
  locked into a format only one company understands.
- It has a free tier suitable for personal use and early testing, with
  paid tiers that scale as usage grows.
- The alternative — renting your own server and running the database and
  login system yourself — hands you meaningfully more ongoing
  responsibility for essentially no benefit at your current scale. See
  §5.4 for what that responsibility actually looks like day to day.

**The trade-off to be aware of:** you're depending on that company staying
in business, keeping prices reasonable, and not changing terms in ways you
dislike. This is a real but manageable risk — it's the standard trade-off
every small software product accepts today, and it's a much smaller risk
than "I personally am the entire on-call security team for a database with
real people's passwords in it."

**Firebase** (Google's equivalent) is a reasonable alternative with the
same basic shape (managed database + auth + file storage) — worth a brief
comparison before committing, but not laid out in full detail here since
Supabase's relational-database style is a closer fit to the current
piece/progress data model. Current pricing on either platform should be
checked directly on their websites before committing, since published
free-tier limits change over time and shouldn't be taken from this
document as current fact.

### 5.2 Build auth yourself, or use the managed service's built-in version

You indicated no strong preference and asked for a recommendation:
**use the managed service's built-in authentication** rather than building
your own login system. Building your own means personally getting right —
and keeping right, forever, as attacks evolve — password storage, reset
emails, session security, and account-takeover protections. That's a deep,
specialized area where mistakes are easy to make and can be serious (a
leaked user database is a genuinely bad outcome, not a cosmetic bug). A
managed service gives you a battle-tested version of all of that as part
of the same package from §5.1, for no extra integration cost.

### 5.3 Is live multi-device sync required on day one?

**Already decided:** no — accounts and durable server-side storage ship
first; automatic multi-device sync is a later phase. See §7 for how this
shapes the phase order. (If this changes before work starts, flag it — it
meaningfully affects §4B's scope.)

### 5.4 What "ongoing maintenance" actually means, concretely

You asked what "manual upkeep" looks like in practice, since the term
alone doesn't convey much — worth spelling out concretely rather than
leaving it abstract, since it's the real substance behind the managed-vs-
self-hosted choice in §5.1.

**If you self-host** (rent a bare server and run everything yourself),
ongoing upkeep concretely means things like:

- Applying security updates to the server's operating system and database
  software yourself, on some regular cadence, forever.
- Setting up and personally verifying your *own* server-side backups of
  the database (yes — even with a "real backend," if you're the one
  running the database, you're still the one responsible for making sure
  *it* has backups, which is a second, separate backup system from
  anything discussed above).
- Noticing if the server goes down (nobody does this for you) — typically
  via a monitoring tool you'd also need to set up — and fixing it,
  possibly at an inconvenient time, since a server going down means the
  app is down for every user.
- Renewing/rotating the encryption certificate that makes HTTPS work (some
  hosts automate this, some don't).
- Handling growth yourself — if usage grows, you notice the server
  struggling and manually give it more capacity.

**If you use a managed service** (the recommendation in §5.1), all of the
above is the provider's job, not yours, as part of what you're paying for.
Your ongoing responsibility shrinks to something much closer to: keeping
the app's own code up to date, watching a dashboard occasionally, and
paying the monthly bill as usage grows. This is the concrete basis for the
recommendation above — for a solo, non-specialist maintainer, the time and
risk difference between these two columns is large, and it grows every
year attacks get more sophisticated.

---

## 6. Risks and things that could go wrong

Ordered roughly by severity.

1. **Losing someone's existing local data during migration.** This is the
   single biggest risk in this entire project, because unlike almost any
   other kind of bug, it's not something you can fix after the fact — the
   data is just gone. Mitigation, per standard practice for this kind of
   migration: never delete or stop relying on local data until the
   server-side copy has been positively verified to match, keep the
   existing manual export feature available as a personal safety net
   through the transition period (not removed the moment the new system
   ships), and test the migration path thoroughly — including on data
   that's old, unusual, or partially corrupted — before anyone relies on
   it for real.
2. **Auth/security mistakes.** Getting login security wrong can mean
   exposed passwords or one account accessing another's data. This is the
   core reason §5.1/§5.2 recommend a managed service over building it
   yourself — it moves this risk to a company whose entire job is getting
   it right.
3. **A live-sync conflict silently corrupting practice history.** If two
   devices disagree about a piece's state and the app picks the wrong
   version automatically, that's just as much data loss as §1, only
   quieter. The existing merge logic (§2) is a real head start, but it was
   built and tested for one-time file imports, not continuous live sync —
   it needs real testing in that new context, not just reuse.
4. **Cost creep.** A managed service's free tier not applying forever is
   expected and fine at small scale, but if this app becomes public and
   grows, cost scales with usage in ways worth monitoring rather than
   discovering via a surprise bill.
5. **Scope creep during a change this large.** Because this touches so
   much of the app, it's an easy place for "while we're in here, let's
   also..." to sneak in extra work. The phased approach in §7 and the
   explicit non-goals in §8 exist specifically to guard against that.
6. **Vendor dependency.** Depending on a managed service means depending
   on that company. Addressed in §5.1's trade-off note — mitigated
   somewhat by choosing a provider (like Supabase) built on a standard,
   portable database rather than a proprietary format.

---

## 7. Suggested phases

Rough order of operations. No time estimates are attached, per your
instructions — this is sequencing, not scheduling.

**Phase 0 — Finalize the design**
Resolve the open decisions in §5 (confirm hosting provider, confirm
whether logged-out/local-only mode survives at all), and design the final
database schema (the piece/progress structure plus the new ownership
field).

**Phase 1 — Accounts + durable server-side storage (no live sync yet)**
Build sign-up/log-in/password-reset. Move data storage from
`localStorage` to the new backend. Build and thoroughly test the
migration flow for existing local data, including the verification step
from §4C. At the end of this phase, your data is durably backed up on a
server and tied to an account — the core data-loss problem this whole
project exists to solve is fixed, even before sync exists.

**Phase 2 — Multi-device sync**
Build automatic syncing of changes across devices, adapting the existing
merge logic from a one-time-import tool into a live-sync mechanism, plus a
decision and implementation for offline behavior if you want the app to
keep working without a connection.

**Phase 3 — Ready for other people**
Harden everything needed before a stranger, not just you, can safely use
the app: confirm password reset is solid, add a privacy policy and terms
of service, decide what a public sign-up flow looks like, add basic
monitoring so you find out about problems before users report them.

**Not in this SOW (future work this unlocks):** real file storage for the
PDF-editing idea, and anything related to selling the app (pricing,
payment processing) — see §8.

---

## 8. Explicit non-goals for this pass

Called out clearly so they don't quietly creep into scope, since they're
easy to reach for while this work is already touching accounts and
storage:

- **PDF editing.** This project makes it *possible* (by giving files a
  durable server-side home instead of one browser), but building the
  actual editing feature is separate work, out of scope here.
- **Payments/subscriptions/billing.** "Eventually selling it" is a stated
  long-term goal that this work is a precondition for, but no payment or
  pricing system is part of this scope.
- **Teacher/student shared or linked accounts.** Multiple independent
  accounts are in scope; any notion of one account seeing or managing
  another's data (e.g., a teacher viewing a student's progress) is a
  distinct, separate feature.
- **Mobile native apps.** This is about the existing web app working
  correctly with accounts and sync — not building iOS/Android apps.
- **Real-time collaborative editing** (two people editing the same piece
  at the same moment) — sync here means "your own data follows you across
  your own devices," not live collaboration between different accounts.

---

## Related documents

- [`docs/Roadmap.md`](Roadmap.md) — where this item sits relative to
  everything else on the backlog.
- [`docs/Decisions.md`](Decisions.md) — history of the local-storage /
  backup-reminder decisions this project directly replaces.
- [`docs/Data-Model.md`](Data-Model.md) — the current piece/progress
  schema this project's database design needs to mirror.
- [`docs/User-Flows.md`](User-Flows.md) — the current manual
  export/import flow, referenced throughout §2 and §4C.
