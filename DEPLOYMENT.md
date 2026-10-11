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

### The live addresses (Pass 114)

**Three addresses serve the live site**, all assigned to the same deployment
(compared 2026-10-08 and again 2026-10-10: the same page and the same app
file):
- `https://measureone.vercel.app`
- `https://measureone-git-main-measure-one.vercel.app` (Vercel's branch
  address for `main`). **This is where the owner's real pieces are**, and it
  is the address set as the account Site URL in the production project.
- `https://measureone-measure-one.vercel.app`

The browser keeps the pieces **per address and per browser**, so the same app
at another address, or in another browser, starts empty. Nothing is lost:
open the address where the pieces are, or restore them from the account.
Which address to use is a choice, not a rule, but the account's Site URL
(where an invitation lands) should be the address where the pieces are; see
[Setup (production project)](docs/Accounts-and-Backend.md#setup-production-project).

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

### Custom Domain (Optional)

In Vercel project settings:
1. Go to "Domains"
2. Add your domain (e.g., `measureone.yoursite.com`)
3. Follow DNS instructions from your domain provider

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
a project (37 checks, two throwaway accounts); run it after any change to the
database's rules or sign-in settings. Only the project's **public** key is ever
in the app or in a setting, never the secret key.

---

## Support

- **Vercel Docs**: [vercel.com/docs](https://vercel.com/docs)
- **Vite Docs**: [vitejs.dev](https://vitejs.dev)
- **React Docs**: [react.dev](https://react.dev)
