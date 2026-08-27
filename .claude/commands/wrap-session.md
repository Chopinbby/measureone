---
description: Update docs/ and CLAUDE.md to reflect what actually shipped this session
---

Run after wrapping a session, before starting the next one cold. Fill in
[bracketed] parts from what actually happened — never invent details to fit
this template. **Run this after each pass, not batched across several** —
one pass's worth of doc updates is cheap; five bundled together is not.

Before writing anything:
- `git log --oneline -10` for the exact commit history
- `git status --short` for anything uncommitted or untracked

---

We just finished [passes/features worked on]. [Bug-fix rounds, diagnostic
findings, or reviewer-flagged issues resolved, in one line each.] Committed
as [hash(es)].

If the work is NOT committed, say so plainly — name exactly what's
uncommitted and what's untracked (untracked = what a stray `git clean`
would destroy). Don't fabricate a hash.

[If applicable] A known issue was surfaced but NOT fixed, deferred to
later: [what it is, why it wasn't fixed]. Log it as an open issue in
docs/Decisions.md — don't let it silently drop.

---

DOCS

Update docs so they reflect the code's *current* state, not its state at
session start. Every doc's own header has an "Update when:" trigger — that
line is the authority, not this list. Walk the directory plus CLAUDE.md,
check each trigger against what happened, update what fired.

**Keep additions tight — a sentence or short bullet, not a new prose
paragraph, unless the target doc's own existing style is already that
dense.** Don't add a passage just because a doc *could* mention this
session; add it only where a trigger actually fired.

Usual suspects, roughly in order of how often they fire:
- **CLAUDE.md** — auto-loads every session, so staleness here is the most
  expensive kind. Check the Roadmap paragraph and the every-session rules.
- **docs/Roadmap.md** — shipped work moves to Done; "Immediate next action"
  must not still name something already done.
- **docs/Decisions.md** — decisions made or reversed, open questions
  opened or closed. This is the one doc where writing the full reasoning
  out is worth the tokens — it's the permanent record.
- **docs/Architecture.md** — any file added, moved, renamed, deleted, or a
  component's actual behavior changed.
- **docs/Algorithms.md** — only if it already described the logic that
  changed; don't add a new section for a bug fix it never covered.
- **docs/Data-Model.md** — schema changes, or a new reader of an existing
  field worth noting.
- **docs/User-Flows.md** — a tab/step/screen added, removed, reordered, or
  a stated behavior ("X is required," "Y checks only Z") is now wrong.

Conditional, only if the trigger clearly fired — check but expect most to
be "no":
- **docs/AI-GUIDELINES.md** — only for a genuine surprise (a wrong
  assumption caught, a mistake, a non-obvious judgment call). Correctly
  following instructions is not itself a pattern worth recording.
- **docs/Repertoire-Lifecycle.md** (lifecycle stage or "learned" changed) ·
  **docs/Research.md** (new hand-picked tuning constant) ·
  **docs/README.md** (a doc file added/removed) ·
  **docs/UX-Principles.md** / **docs/Product-Principles.md** (a UI/product
  *pattern* established or reversed, not a passing mention) ·
  **docs/Vision.md** (rare).

For every doc you touch: also scan for passages your changes made *wrong*,
not just gaps to fill — a stale claim is worse than a missing one. That
includes cross-references and anchors, not just body text. Verify a
hand-typed anchor against actual existing usage elsewhere in the repo
before trusting it (`grep` the string) — don't compute it from the heading
and assume.

---

REPORT BACK

- One or two sentences per doc changed: what and why.
- Which docs you checked and left alone, and why the trigger didn't fire —
  a short list is fine, this doesn't need its own paragraph per doc.
- One line: would a fresh read of these docs, no other context, correctly
  explain the app's current state to someone starting cold? If anything
  would still mislead them, say what.
