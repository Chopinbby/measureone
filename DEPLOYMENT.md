# Deployment Guide: MeasureOne to Vercel

## Pre-Deployment Audit Summary ✅

All checks passed:

### 1. **Security Audit** ✅
- No hardcoded API keys, secrets, or passwords found
- No external API dependencies
- All localStorage operations have error handling
- No sensitive data exposure vectors

### 2. **Build Configuration** ✅
- `package.json`: Minimal, production-ready dependencies (React 18, lucide-react only)
- `vite.config.js`: Optimized for React; no unnecessary plugins
- Build output targets modern browsers
- No build secrets needed

### 3. **localStorage Safety** ✅
- Enhanced with migration/validation layer
- Old data formats gracefully handled with defaults
- Schema version field supports future migrations
- Backup format includes version metadata
- All storage operations wrapped in try/catch for private browsing support

### 4. **.gitignore** ✅
- `node_modules`, `dist`, `.DS_Store` properly ignored
- `.claude/settings.local.json` excluded
- Backup files excluded
- Ready for GitHub/Vercel

### 5. **Production Build** ✅
Run locally on your machine:
```bash
npm run build
```
This will:
- Create a `dist/` folder with optimized static files
- Minify all code and CSS
- Generate source maps for debugging
- Output file sizes

The build should complete with no errors or TypeScript issues.

---

## Step-by-Step Deployment to Vercel

### Step 1: Create a GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Create a new public or private repository named `measureone` (or your preferred name)
3. Do **not** initialize with README/gitignore (you already have them)

### Step 2: Push Your Code to GitHub

On your local machine, run:

```bash
git remote add origin https://github.com/YOUR_USERNAME/measureone.git
```

Replace `YOUR_USERNAME` with your GitHub username.

Then push:

```bash
git branch -M main
git push -u origin main
```

### Step 3: Sign Up / Log In to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Sign up with GitHub (recommended) or your email
3. Authorize Vercel to access your GitHub account

### Step 4: Import Your Repository into Vercel

1. Click "Add New..." → "Project"
2. Select "Import Git Repository"
3. Paste your GitHub repo URL or search for it: `https://github.com/YOUR_USERNAME/measureone`
4. Click "Import"

### Step 5: Configure Build Settings

Vercel should auto-detect these, but verify:

- **Project Name**: `measureone` (or your preferred name)
- **Framework Preset**: `Vite`
- **Build Command**: `npm run build` (auto-detected)
- **Output Directory**: `dist` (auto-detected)
- **Install Command**: `npm ci` (auto-detected)
- **Environment Variables** (Pass 108): two, both optional, for the account
  backend. With both empty the app runs exactly as it did before accounts:
  no sign-in offered, everything saved in the browser only.
  - `VITE_SUPABASE_URL`: the Supabase project's URL (`https://<ref>.supabase.co`).
  - `VITE_SUPABASE_ANON_KEY`: the project's **public** key, called
    "publishable" (starts `sb_publishable_`) or, on older projects, "anon".

  **Where to find them:** Supabase dashboard → the project → **Project
  Settings**: the URL under **Data API**, the public key under **API Keys**.

  **Which environment gets which project** (Vercel → the project → Settings →
  Environment Variables, choosing the environment for each variable, so each
  name is listed twice, once per project):
  - **Preview** (every branch's preview site) and **local development**
    (`.env.local`, copied from `.env.example`, never committed): the **test**
    project, `measureone-test`.
  - **Production** (the live site): the **production** project,
    `measureone-prod` (`https://tqamtwdraqsvejvhiptz.supabase.co`), since
    go-live (Pass 114, 2026-10-10). Both settings are ticked for **Production
    only** (type Config): one ticked for Preview as well would point every
    preview site at real accounts. Before go-live this environment had none
    and the live site had no account backend at all; deleting both Production
    settings and redeploying brings that state back (see "Rolling back"
    below).

  The public key is safe in the browser: the database's row-level security
  rules decide what each signed-in account can read and write (see
  `supabase/migrations/`). **Never add the secret key** (starts `sb_secret_`,
  or the older `service_role` key) anywhere: not in Vercel, not in
  `.env.local`, not in the repo. It bypasses those rules entirely.

  These values are built into the app when Vercel builds it, so after adding
  or changing one, redeploy (or push a new commit) for it to take effect.

  - `VITE_TURNSTILE_SITE_KEY` (Pass 135, optional): the bot check's **public**
    site key (Cloudflare Turnstile). With it empty the app never loads the bot
    check and never offers "Create an account": it behaves exactly as it did
    before open sign-up. **Preview** and local development get Cloudflare's
    published test key `1x00000000000000000000AA` (it works on any address and
    always passes); **Production** gets the real site key of the owner's widget,
    ticked for Production only. The bot check's **secret** key is typed only
    into Supabase's dashboard, never here. See "Open sign-up (Pass 135)" below.

Click "Deploy"

### Step 6: Wait for Deployment

Vercel will:
1. Clone your repo
2. Install dependencies
3. Run `npm run build`
4. Deploy the static files globally

This takes 2-5 minutes. You'll see a progress screen.

### Step 7: Access Your Deployed App

Once deployment completes:
- Your app gets a unique URL like `https://measureone-abc123.vercel.app`
- This link is shareable with anyone
- You can also assign a custom domain (Settings → Domains)

### Step 8: Share Your App

Copy and share the Vercel URL. Anyone can now:
- Use MeasureOne online without installing anything
- Their data stays in their browser's localStorage
- Each user has completely separate data

---

## Post-Deployment

### Updating Your App

Never commit or push straight to `main`: whatever is on `main` is the live
site. Every change goes through a branch and a pull request instead:

1. Make the change on its own branch, commit it, and push the branch.
2. Open a pull request into `main`. Vercel builds a **preview** of that
   branch at its own address (the link appears in the pull request) and
   leaves the live site alone.
3. Try the change on the preview. The preview is a different address, so
   it starts with no pieces: export a backup from the live site and import
   it there to test with real data. Nothing done on a preview touches the
   live site's data.
4. Merge the pull request once it's right. Vercel then updates the live
   site automatically, usually within a minute or two.

Merge one change at a time, oldest first, and export a backup from the live
site before merging anything that changes how data is saved. If a merge
breaks something, Vercel's dashboard can switch the live site back to the
previous deployment in one click (Deployments → the previous one → Promote
to Production / Instant Rollback) while the fix is made.

With accounts on (since Pass 114, below) the live site also talks to real
accounts, so read "The live addresses" and "Rolling back" below before relying
on that one click.

### The live addresses (Pass 114, and Pass 128)

**Since 2026-11-01 (Pass 128) the app has its own address, `https://measureone.app`.**
The owner bought the name through Vercel (registered 2026-11-01, renews
2027-11-01) and attached it to this project's **Production** environment;
`https://www.measureone.app` forwards to it with a permanent redirect (308).
HTTPS is a free Let's Encrypt certificate that Vercel issues and renews (read
2026-11-01: issued by Let's Encrypt, valid to 2027-01-30). It serves the same deployment as the three
addresses below (compared 2026-11-01: the page, the app file and `sw.js`
byte for byte). **It is the account Site URL** in the production project, with
`https://measureone.app/**` on the redirect list beside the older entry (below).

**Three older addresses still serve the live site**, all assigned to the same
deployment (compared 2026-10-08 and again 2026-10-10: the same page and the same
app file):
- `https://measureone.vercel.app`
- `https://measureone-git-main-measure-one.vercel.app` (Vercel's branch
  address for `main`). **This is where the owner's real pieces were before Pass
  128.** They are brought to `measureone.app` by signing in there and pressing
  Restore on each device; the old copy at this address is left as it is.
- `https://measureone-measure-one.vercel.app`

They are **not redirected** (Phase 3 Design H): the browser keeps the pieces
**per address and per browser**, so a signed-out person's pieces exist only at
the address they were made on, and a redirect would strand them. Instead, on
exactly these three addresses, the app shows one quiet, dismissible note
("MeasureOne has moved to measureone.app", with an Export button when a signed-out
device holds pieces; `src/lib/address.js`). It never shows on `measureone.app`,
on a preview address or on localhost. **If a fourth address is ever added to the
live site, or one of these three is removed, change `OLD_ADDRESSES` in that file.**

The browser keeps the pieces **per address and per browser**, so the same app
at another address, or in another browser, starts empty. Nothing is lost:
open the address where the pieces are, or restore them from the account.
The account's Site URL (where an invitation lands) is `https://measureone.app`;
see [Setup (production project)](docs/Accounts-and-Backend.md#setup-production-project).

### Rolling back

**The go-live rollback point**, noted 2026-10-07 before anything changed: the
deployment of commit `8636cfa` (the Pass 113 merge),
`https://measureone-jjwajut3k-measure-one.vercel.app`, created
2026-10-07 05:51 UTC (the evening of 6 October in the owner's time zone),
serving the app file `index-B11FjqLP.js`. It has no account backend. The
owner confirmed on 2026-10-10 that its **Domains** list includes
`measureone-git-main-measure-one.vercel.app`.

Two ways back from accounts being on, in order of preference. Nothing on any
device is lost either way: practice is saved on the device first, and the
account copy stays in Supabase.
1. **The sure way:** Settings → Environment Variables: delete the two
   **Production** settings (leave Preview alone). Then Deployments → the
   latest Production deployment → ⋯ → **Redeploy**. It rebuilds `main` as it
   is, without the settings, so there is no account backend again, and as a
   new Production deployment it should move all three live addresses (the
   Pass 114 merge, an ordinary new deployment, moved all of them together;
   whether a Redeploy does is untested, so check afterwards that all three
   serve the new file and print no Supabase address, as below). (The account
   code is in `main` already: accounts exist on a site only while the two
   settings do, so no revert is needed.)
2. **The fast way:** Deployments → the `8636cfa` deployment → ⋯ → **Instant
   Rollback**, then delete the two Production settings so the next build
   doesn't turn accounts back on. Vercel may stop moving the live addresses
   to new deployments after an instant rollback until one is promoted (the
   Deployments page says so). **Check afterwards** that
   `measureone-git-main-measure-one.vercel.app` serves `index-B11FjqLP.js`
   (below): it is a branch address, and whether an instant rollback moves it
   was never tested.

**The address change (Pass 128) and the way back.** None of the above changes: a
rollback or a redeploy moves `measureone.app` together with the other Production
addresses (it is attached to the Production environment; whether an Instant
Rollback moves it was not tried, so check as for the branch address, by reading the
app file name off the page). Deleting the two Production settings takes accounts off
all four addresses. Two things stand apart from the code. **The account's Site URL**
(Supabase, production project, Authentication, URL Configuration) is a dashboard
setting, so no rollback changes it: to go back to the old address, set it to
`https://measureone-git-main-measure-one.vercel.app` again (that redirect entry was
kept, so nothing else is needed). **The "moved" note** is code: reverting the Pass 128
merge removes it. Nothing about either touches a piece, the technique library or an
account's rows. The domain itself can stay attached while any of this is done.

**Rollback points since go-live (added 2026-10-15, extended 2026-11-09).** Every merge
to `main` makes an ordinary Production deployment, so earlier ones stay listed in
Vercel (for as long as Vercel keeps them). The app code changed three times between
go-live and 2026-10-15: the deployment of `92e6282` (PR 62) is the last one before
Pass 115 (app file `index-BquOI88d.js`, accounts on); `b877140` (PR 63) is Pass 115
alone; `8eae8fd` (PR 67) is Passes 116 to 118. **It has changed twelve more times
since, one merge each:** `9864612` (PR 71) is Pass 119 (tabs of one browser),
`847fada` (PR 72) Pass 120 (changes from other devices arriving by themselves,
behind a switch that is off by default), `951a640` (PR 73) Pass 121 (Review asks one
question per conflicting part), `69dbebe` (PR 74) Pass 122 (a piece deleted on one
device is deleted everywhere), `0b53445` (PR 75) Pass 122b (what the person said
no to is remembered, the most recent reorder wins; app file `index-YBQquKJp.js`),
`3fccc8c` (PR 76) Pass 125 (the piece list scrolls while a piece is dragged; app file
`index-OJehj1yX.js`), `038f256` (PR 79) Pass 123 (the app opens with no connection; app file
`index-78o7whRf.js`, live 2026-10-28), `0a9d1a7` (PR 83) Pass 126 (the most recent change wins;
app file `index-CqYGi2T6.js`, live 2026-10-31; missing from this list until 2026-11-01) and
`c4af6bf` (PR 86) Pass 128 (the "moved" note and its phone layout; app file `index-IY8CdtWw.js`, live
2026-11-01) and `ab7916f` (PR 90) Pass 130 (change email, delete my account, the Danger zone; app file `index-BQl7BE2O.js`, live
2026-11-06) and `a9835db` (PR 94) Pass 132 (the "Report a problem" link; app file `index-CYcwBRHX.js`, live 2026-11-08) and
`94e93c4` (PR 96) Pass 133 (the privacy policy and terms pages, the short addresses, the links to them, one sentence in Choose a password
and the delete window's backup sentence), **the current app code, live since 2026-11-09 (app file `index-CJNfVn4Z.js`)**. **Rolling back
across Pass 133 takes all of that out** (the pages and `vercel.json` go with the code; no stored data format and no database changed; once
the email footer is pasted into the dashboards, the emails' `/privacy` and `/terms` links would point at nothing).
**Rolling back across Pass 132 only removes the link** (no stored data format and no
database changed; Pass 131 changed no app code). **Rolling back across Pass 130 only
removes the new buttons;** migration `0003` and its database function stay on both Supabase projects, unused and
harmless, and no stored data format changed, so devices don't upload anything extra either way. The file
names of the four before 122b were not recorded when they went live; read one off a
deployment's page in Vercel before relying on it. The merges `8c8d637`, `209d77a` and `d3a0fa0` (and
every later documentation-only one) change no app code. **A rollback across Pass 115
or Pass 118 changes how the technique library is fingerprinted** (Pass 115: its
last-changed time stopped counting; Pass 118: a new scale field), so expect each
device to upload its library once more afterwards, and a second device left open to
show "The technique library changed on another device". Review clears it and nothing
is lost. **A rollback across Pass 120 or Pass 122b leaves fields in the device record
that the older app does not know**: across Pass 120, the automatic-update switch and a
held piece's list of conflicting parts; across Pass 122b, the pieces and pairs the
person said no to. The older app drops what it does not know the next time it saves
the record, so the switch reads off, or the "no" answers are forgotten and those
pieces are offered again. Nothing in the account is erased. A rollback across Pass
125 only takes the scrolling back; it changes no stored data. **A rollback across Pass
123 serves no worker file, but a device that already has the worker keeps it** (what a
browser does when its worker file is missing was not tried), so use the way back below,
not a rollback, to take the worker off. These notes are reasoned from the code, not
rehearsed.

### The offline worker, and turning it off (Pass 123)

Since Pass 123 the app registers a small service worker, `public/sw.js`, so that it can
open with no connection. It saves the page and the app's own files in the browser, asks
the network first for the page (so a new version always shows while there is a
connection), and leaves everything else alone: the account service, fonts, any other
site and every request that is not a GET. Only built versions register it, never
`npm run dev`. Pieces, the technique library and the device record are never in its
storage. Design and what was seen:
[Accounts-and-Backend.md](docs/Accounts-and-Backend.md#opening-the-app-with-no-connection-pass-123).

**Changing it.** Change `VERSION` at the top of `public/sw.js` whenever that file
changes (saved copies made by other versions are deleted when the new one takes
over), try the change on a preview address first, and remember that a merge to `main`
puts it on the live addresses.

**Turning it off everywhere (the way back).** If the worker ever causes trouble:

1. Replace the whole of `public/sw.js` with the self-removing worker below. The file
   name and place must not change: browsers look for changes to that exact address.
2. Merge it like any change (a branch and a pull request).
3. Each device that has the worker picks the change up the next time the app is opened
   with a connection (the page asks on every visit), clears the saved copies and
   removes the worker. Pieces, technique data, the device record and the account are
   not touched. A device that stays offline keeps the old worker until it is online
   and the app has been opened once.
4. Optional, later: remove the registration block at the end of `src/main.jsx`. Until
   then every visit installs the self-removing worker once more and it removes itself
   again, which does no harm.

```js
/* MeasureOne offline worker, switched off (Pass 123, the way back). Replaces public/sw.js. */
self.addEventListener("install", function () {
  self.skipWaiting();
});
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (name) {
              return name.indexOf("measureone-app-") === 0;
            })
            .map(function (name) {
              return caches.delete(name);
            })
        );
      })
      .then(function () {
        return self.registration.unregister();
      })
  );
});
// No fetch handler: every request goes straight to the network.
```

**To see that it worked,** once a device has opened the new version online: in Safari
(Develop menu on), Develop, Service Workers lists nothing for the address; or turn the
connection off and open the app, which no longer opens, as before Pass 123. Rehearsed
during Pass 123 (2026-10-28), locally and on a preview address: after one visit with a
connection the device had no worker and no saved copies.

### Checking which project a site talks to

The project's address is built into the app file, so a deployed site can be
checked from outside:

```bash
curl -s https://measureone-git-main-measure-one.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

then, with that file name in place of `index-XXXX.js`:

```bash
curl -s https://measureone-git-main-measure-one.vercel.app/assets/index-XXXX.js | grep -o 'https://[a-z0-9]*\.supabase\.co' | sort -u
```

The live addresses should print the production project's address
(`https://tqamtwdraqsvejvhiptz.supabase.co`), a preview site the test
project's (`https://devbzzbtinzxspmiatba.supabase.co`), and a site with no
account backend nothing at all.

### Monitoring

- Check deployments at [vercel.com/dashboard](https://vercel.com/dashboard)
- View build logs if a deploy fails
- Enable email notifications for deployment status
- **The uptime check (Pass 132):** two UptimeRobot keyword monitors, kept in the owner's UptimeRobot account (not in this
  repository): `https://measureone.app/` expecting the word `MeasureOne`, and the account service's health address expecting
  `GoTrue`. If the live address changes, or the production Supabase project is rebuilt (a new address), edit the matching
  monitor, or it will report an outage that is not one. To turn it off, pause the monitors in UptimeRobot; nothing in the app
  depends on it. Details: [`docs/Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#alarms-pass-132).

### Custom Domain

Done in Pass 128 (2026-11-01): `measureone.app`, bought through Vercel and attached to
Production, with `www` forwarding to it; see "The live addresses" above. To add a domain
to a project in general: in Vercel project settings, go to "Domains", add the domain
and, if it was bought elsewhere, follow the DNS instructions from the registrar. With
"Include apex and www variants" ticked Vercel should add the `www` name and make it forward to
the bare name by itself. On 2026-11-01 `www` was already forwarding (307) before anything was
added by hand, which points to exactly that, though the adding itself was not watched. So
nothing more is needed; trying to add
`www` by hand with the box ticked and the bare name as its target gets "A domain cannot
redirect to itself", because the box adds the bare name to the same group. To change the
redirect's type (307 to 308), use Edit on the existing `www` row. A new address opens
as an empty copy of the app (the browser keeps pieces per address): sign in there and
press Restore. The domain's email records (Resend, ImprovMX) were added in Pass 129: see
"Sign-in email" below.

### Sign-in email (Pass 129)

Sign-in emails (invitation, password reset and so on) are written by Supabase and delivered
by **Resend** from `hello@measureone.app`; `hello@measureone.app` forwards to the owner's inbox
through **ImprovMX**. The domain's DNS is at Vercel (Domains, `measureone.app`, DNS Records):
Resend's four records (`resend._domainkey` TXT, `rsend` and `send` CNAMEs, `_dmarc` TXT) and
ImprovMX's (two MX and the ONE root SPF TXT). **Never add a second root SPF record:** it breaks
both services. Full detail: [`docs/Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#email-service-pass-129).

- **Pass 129 changed no app code,** so there is nothing to roll back in Vercel: merging it (PR #88,
  `87065bc`) made Vercel redeploy `main`, but all four addresses kept serving the same app file,
  `index-IY8CdtWw.js` (checked 2026-11-06). It is not a rollback point.
- **Where the live settings are:** each Supabase project's dashboard (Authentication, Email, SMTP
  Settings; Authentication, Emails, Templates; Authentication, Sign In / Providers, Email, Email
  OTP expiration). The repository's `supabase/templates/` is the record of the template text, not
  the live copy: change the file, then paste into **both** projects.
- **The key:** one Resend API key per project, pasted only into Supabase's SMTP password box.
  Never put it in Vercel, `.env.local` or this repository. A leaked key lets someone send as
  `hello@measureone.app`: delete it in Resend and paste a new one into Supabase.
- **The way back:** switch "Enable custom SMTP" off in a project. Supabase's built-in sender
  returns (the project's own team only, about 2 messages an hour), the templates stay, and the
  app is untouched.
- **Check after any change to email:** ask for a password reset for your own account at
  `https://measureone.app`, and read the message's "Show original" for SPF, DKIM and DMARC all
  passing. Click **Not now** at Choose a password.

### The privacy policy and terms (Pass 133)

The two pages are plain files in `public/` (`privacy.html`, `terms.html`), served as they are. `vercel.json`, the repository's only Vercel
config, adds two rewrites so `/privacy` and `/terms` work too: the app links to the `.html` names and the sign-in emails use the short
ones. Full detail: [`docs/Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#privacy-policy-and-terms-pass-133).

- **Merged 2026-11-09 (PR #96, `94e93c4`), live as `index-CJNfVn4Z.js`.** Read from outside that day: `/privacy`, `/terms`,
  `/privacy.html` and `/terms.html` answer 200 with the right page on `measureone.app`, and `/privacy` answers on the three older addresses.
- **The way back:** reverting PR #96 takes out the whole pass (pages, rewrites, links, the Choose a password sentence). Deleting only
  `vercel.json` drops the short addresses and leaves the `.html` pages, but the sign-in emails (once the footer is pasted) use the short
  ones and would point at nothing.
- **Not done yet (the owner's):** the footer in `supabase/templates/` is not yet pasted into either Supabase project. (The old backups
  repository was deleted on 2026-11-10, so the pages' "about 30 days" is true.)
- **After any change to the pages:** change the "Last updated" date and the change history at the bottom of the page, and the matching row
  of the table in `docs/Accounts-and-Backend.md`, together.

### Inviting people (Pass 134)

The routine for adding someone to the real site. **Prepared 2026-11-11; no one has been invited yet.** The checklist that must read as satisfied
first, who read each row and what it said are in
[`docs/Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#inviting-people-pass-134). Only the owner decides when to send the first one.

1. **Before each invitation:** the newest backup is under 24 hours old (`LAST_BACKUP.txt` in the private backups repository), both uptime
   monitors are green, and the Supabase project is not paused.
2. **Production only** (the dashboard's project header reads `measureone-prod`): Authentication, Users, **Add user, Send invitation**, to the
   person's address. Never "Create new user" for a real person: it is for the security script's throwaway accounts, it sends nothing and it sets
   a password by hand.
3. **The email** comes from `MeasureOne <hello@measureone.app>`. Its link works once and lasts 24 hours (Authentication, Sign In / Providers, Email,
   Email OTP expiration, 86400 seconds; **read it again before each go-live and after any migration**, because a Supabase issue reports it
   going back to 3600 after a production migration). The link opens `measureone.app` at Choose a password.
4. **Sending another** (the link ran out, was used, or never came): **not yet tried.** Rehearse it once on the test project with a spare address
   before the first real invitation, and write what really worked in the Accounts-and-Backend section. The expected way: if the person's line in
   the second SQL query (Accounts-and-Backend, "Counts") shows neither an `accepted` date nor a `last_sign_in` date, delete that one Users row and
   send a fresh invitation. **Never delete a row that shows either one**: that deletes a real account and all of its pieces.
5. **Limits:** Supabase sends at most 30 emails an hour with custom SMTP, and a second email to the same person within a minute is not sent;
   Resend's free plan allows 100 a day. Groups of 3 to 5, a week apart, are far under both.
6. **A mail scanner can use up the link** (some systems open every link in a message, which spends a link that works once; the person sees
   "Token has expired or is invalid"). Nothing is built for it. Ask the first person which mail service they use; if it happens, send another and
   write it down.
7. **The way back:** stop inviting. A person can delete their own account (Settings, Danger zone), and the daily backup keeps copies for about
   30 days. Turning the email service off ("Enable custom SMTP" off) would stop every invitation and reset, so it is not a way back from a
   problem with one person. The wider rollback points are under "Rolling back" above.
8. **Do not put names or email addresses of invited people in this repository** (it is public). The list of who was invited, which is also the
   list for emailing account holders about changes that matter, is the owner's, kept outside it.

### Open sign-up (Pass 135)

How people create their own accounts, and the order to switch it on. **Built 2026-11-12; nothing is switched on, and switching it on is only
the owner's.** What was built, what was seen and what was not: [`docs/Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#open-sign-up-pass-135).

**Three switches, and what each does.**
- **The site key in Vercel** (`VITE_TURNSTILE_SITE_KEY`, Step 5 above). Without it the merged app is exactly the app before this pass: no bot
  check, no "Create an account", no new request to anyone.
- **The bot check in Supabase** ("Enable CAPTCHA protection", in the project's Authentication settings; Supabase's guide lists it under "Bot
  and Abuse Protection", and the page was not seen while building). **It is not only for sign-up:** once on, Supabase asks for the bot check's
  code on every sign up, every password sign-in and every "forgot password". The app sends it from all of those windows, and from the
  password check before Delete my account. A device that is already signed in is not affected.
- **"Allow new users to sign up"** in Supabase (Authentication, Sign In / Providers). The app reads this, and shows "Create an account" only
  while it is on, "Confirm email" is on, and the site key is present. It is read once per page load, so a change shows after a reload.

**Cloudflare (the owner's, free).** Create a Turnstile widget in the Cloudflare dashboard, mode Managed, with these hostnames: `measureone.app`
and the three older addresses (`measureone.vercel.app`, `measureone-git-main-measure-one.vercel.app`, `measureone-measure-one.vercel.app`).
The free plan allows 10 hostnames per widget and has no limit on checks. **An address missing from that list cannot sign in once the
bot check is on** (the widget refuses to run there), so add every address people really use before step 4 below. It gives a **site key** (public: it goes in Vercel, Production only)
and a **secret key** (it goes only into Supabase's production dashboard; never Vercel, `.env.local`, this repository or a chat).

**The test project and previews use Cloudflare's published test keys**, so no real widget is involved and the script can run there:
site key `1x00000000000000000000AA` (Vercel, Preview only, and `.env.local`), and in the TEST project's Supabase dashboard the test secret
`1x0000000000000000000000000000000AA` (both are printed in Cloudflare's own docs, so neither is a secret). A test key always passes, which
means a preview proves the app's side of the bot check, not Cloudflare's judgment; the owner's phone sign-up on production is the real proof.

**Trying it on the test project (before any of this reaches production).**
1. TEST project dashboard: switch the bot check on with provider Turnstile and the test secret above; switch "Allow new users to sign up" on;
   read that "Confirm email" is on (Authentication, Sign In / Providers, Email); read Authentication, Rate Limits and write the numbers down;
   add this branch's preview address to the Redirect URLs (Authentication, URL Configuration), as for a reset link.
2. Vercel: add `VITE_TURNSTILE_SITE_KEY` = `1x00000000000000000000AA`, ticked **Preview only**, and redeploy the preview.
3. The security script, with two new throwaway accounts whose addresses start `rls-check`:
   `node scripts/check-rls.mjs --dummy-token`. Expect 43 of 43 and the last line "Bot check: ON". Delete the account left over.
4. On the preview: Create an account with a spare address, open the email, press the button, arrive signed in with the welcome line. Sign up
   the same address again: the same "Check your email" answer. Switch sign-ups off in the test dashboard and reload: the form is gone.

**Going live on production, in this order, each step only on the owner's word.**
1. The pass is merged and live. Nothing has changed for anyone yet (no site key in Production).
2. Add the **real site key** to Vercel, ticked **Production only**, and redeploy. Check in a private window at `measureone.app`: Sign in still
   works. (The app now sends the bot check's code; Supabase ignores it until step 4.)
3. **The full security script on production, while the bot check is still off:** `node scripts/check-rls.mjs` with two throwaway accounts.
   Expect 43 of 43, and the last line "Bot check: NOT ON" (check 36 passes here because sign-ups are off). Delete the account left over. Read
   back the 24-hour link setting (Email OTP expiration 86400) and Authentication, Rate Limits.
4. Switch the **bot check on** in the production project (provider Turnstile, the real secret, Save). **Straight away**, in a private window,
   sign in at `measureone.app`. If it fails, switch the bot check off again: that is the way back, and nothing is lost.
5. `node scripts/check-rls.mjs --bot-check` (it asks only for the URL and the public key, uses no account and writes nothing). Both lines must
   pass: a sign-in and a sign-up without the code are refused by the bot check.
6. Switch **"Allow new users to sign up" on.** Reload `measureone.app` in a private window: "Create an account" is there.
7. From a phone, sign up a fresh address of the owner's, confirm it from the email, arrive signed in, then delete that account in the app
   (Settings, Danger zone, or the link on the first screen).

**The way back is instant:** switch "Allow new users to sign up" off. The form disappears at each person's next reload, and a sign-up sent
from a page still open is refused by Supabase. The bot check can stay on.

**Things that follow from the bot check being on.**
- **The full security script cannot sign in on production** (a real code can only be made in a browser). To run it there again (after a
  migration, say): switch sign-ups off, switch the bot check off, run the script, switch the bot check on, run `--bot-check`, switch sign-ups
  on. For those few minutes nobody can create an account; signing in keeps working.
- **A tab or phone still on a version from before this pass cannot sign in** until it is reloaded (it sends no code; the message says the
  bot check didn't pass and to reload). Devices already signed in carry on.
- **If Cloudflare is down or blocked on someone's network**, they cannot sign in, sign up or reset a password until it is back; signed-in
  devices and practice are unaffected. Switching the bot check off in Supabase lets everyone in again (switch sign-ups off first).

**Limits (read from Supabase's and Resend's pages, 2026-11-12).** Sign-ups and sign-ins: 30 requests per 5 minutes from one network. One
confirmation email per address per 60 seconds. Emails: the project's hourly number (30 with custom SMTP as last read; the owner reads it
again). Resend's free plan: 100 emails a day and 3,000 a month, shared by every confirmation, reset, invitation and email change, so it is
the real daily ceiling; its first paid plan is $20 a month for 50,000. The owner's decision (2026-11-12): stay on the free plans of both.

---

## Troubleshooting

### Build Fails with "command not found: npm"
- Ensure `node_modules/` is not tracked in git (check `.gitignore`)
- Vercel will install fresh dependencies automatically

### Build Fails with "vite not found"
- Verify `devDependencies` in `package.json` includes `vite`
- Delete local `node_modules/` and `package-lock.json`, run `npm install` again, then push

### App Works Locally but Blank on Vercel
- Check browser console (F12) for errors
- Verify `index.html` is in the repo root
- Check that build output is `dist/`

### localStorage Data Not Persisting
- This is normal and expected — each user's data is isolated to their own browser
- **It is isolated per web address too:** the same app at another address
  (`measureone.vercel.app` and `measureone-git-main-measure-one.vercel.app`
  serve the same build) is a separate, empty copy. Nothing is lost: open the
  address where the pieces are, or restore them from the account.
- Users can export/import backups manually if switching devices
- This is not a Vercel issue; it's how browser localStorage works

---

## Security Reminders

Before going live:
1. ✅ No API keys in code
2. ✅ No hardcoded credentials
3. ✅ All external data properly validated
4. ✅ Ready for public access (if deployed as public)

Your pieces are stored in the browser first. Since go-live (Pass 114) an
optional, invitation-only account holds a second copy in a Supabase project,
protected by row-level security: nobody can read or change another account's
rows, and nobody can delete a row. `scripts/check-rls.mjs` checks that against
a project (43 checks since Pass 130, two throwaway accounts whose addresses must start `rls-check`; the last
group deletes account A, so only B is left to delete); run it after any change to the
database's rules or sign-in settings. Only the project's **public** key is ever
in the app or in a setting, never the secret key. A daily copy of the account
database is saved by a scheduled job into a separate **private** repository
(`Chopinbby/measureone-backups-v2` since Pass 131, where each day's copy is an artifact
that expires after 30 days; the older `Chopinbby/measureone-backups` was deleted on 2026-11-10; this repository is public,
so backups never go here): see [Accounts-and-Backend.md](docs/Accounts-and-Backend.md#other-peoples-data-backups-that-expire-pass-131).

---

## Support

- **Vercel Docs**: [vercel.com/docs](https://vercel.com/docs)
- **Vite Docs**: [vitejs.dev](https://vitejs.dev)
- **React Docs**: [react.dev](https://react.dev)
