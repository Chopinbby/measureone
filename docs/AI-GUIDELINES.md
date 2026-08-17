# AI Guidelines

> **Purpose:** How an AI assistant (Claude Code or otherwise) should work
> within this project — process and judgment, not technical reference.
> **Audience:** AI assistants, primarily. Written in second person for that
> reason.
> **Scope:** Collaboration process: what to read before acting, when to record
> a decision, when to update docs, how to weigh extending vs. inventing. For
> *technical* operating instructions (commands, gotchas, code conventions),
> see `../CLAUDE.md` instead — that file is auto-loaded into Claude Code's
> context every session; this one is a deliberate read.
> **Related:** every other document in this directory — this one tells you
> when to consult them.
> **Update when:** A recurring pattern of AI mistakes or good judgment calls
> emerges that future sessions should know about.

## Before proposing a product change

Read [Vision.md](Vision.md) and [Product-Principles.md](Product-Principles.md)
first. "Does this fit MeasureOne" is usually answerable from those two
documents alone. In particular:

- If a proposed feature involves streaks, "days since last practiced,"
  or any mechanic that frames a missed day as a loss — it's already been
  rejected as permanent policy. Don't re-propose it; point to
  [Product-Principles.md](Product-Principles.md#no-punishment-mechanics)
  instead.
- If it adds a computed/automated value the user might disagree with, it
  needs a manual override, per
  [Product-Principles.md](Product-Principles.md#always-provide-a-manual-escape-hatch).

## Before adding a feature

Check [Roadmap.md](Roadmap.md) — it may already be planned (in which case,
follow its stated scope rather than inventing your own), explicitly
deprioritized (in which case, say so rather than building it unprompted),
or it may touch an area with an open question in
[Decisions.md](Decisions.md) that should be resolved with the user first.

## Preserve terminology unless intentionally refactoring it project-wide

"Practice chunk" vs. "section" vs. "transition" (shown as "Review") vs.
"combo" (shown as "Focus block") vs. "section run-through" — these have
precise, distinct meanings documented in
[Data-Model.md](Data-Model.md#practice-chunks-vs-sections-vs-transitions-vs-combos-vs-run-throughs).
Don't introduce a new casual synonym for an existing concept, and don't use
an existing term for a new concept that isn't actually the same thing. If a
term is genuinely wrong (like the `kind: "section"` naming collision), that's
a tracked refactor item, not license to improvise a new name inline.

## Update documentation alongside implementation

If you change scheduling, confidence, chunking, or the data model, update
the corresponding section of [Algorithms.md](Algorithms.md) or
[Data-Model.md](Data-Model.md) in the same change. A code change without a
doc update is exactly how the drift this documentation set was built to fix
happens again — the last audit found a scheduler algorithm change, two new
functions, and an entire feature (section run-throughs) that had shipped
without any documentation update at all.

## Record significant product decisions

If you make (or the user makes, in conversation with you) a decision with
lasting rationale — especially one that overturns existing behavior or
resolves an open question — add it to [Decisions.md](Decisions.md): the
decision, why, and alternatives considered if any were discussed. Don't wait
to be asked; this is the mechanism that keeps future sessions from
re-litigating settled questions.

## Prefer extending existing systems over creating parallel systems

Before adding a new "how good is this" metric, a new scheduling pass, or a
new persisted field that overlaps with something already in
[Data-Model.md](Data-Model.md), check whether it can extend what's there.
This project already has one instance of two parallel, disagreeing scores
(`computeConfidence` vs. `computeProgressTier` — see
[Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them)).
That happened because a metric was added for one screen without checking
whether an existing one already answered the same question. Don't repeat
it without at least raising the question to the user.

## A guard that stops an exception is not automatically a correct fix

When you fix a crash, "it no longer throws" is evidence that it no longer
throws — nothing more. Check what the code now *does* against data you
actually understand, before calling it fixed.

The worked example (Pass 20): Progress crashed because a logged id couldn't
be found in the current chunk set. The obvious fix — guard the lookup, label
anything unresolvable as leftover from an older version of the plan —
stopped the crash completely and looked finished. It was wrong. Two quite
different things land in "unresolvable," and the common one
(`sr_<sectionId>` section run-throughs, which are valid and current but
deliberately never in the chunk set) was being relabelled as stale junk.
Nothing failed; no test went red; the tab rendered. It was caught only by
reading the rendered output against a piece whose history was already known.

The generalizable habit: when a fix hinges on a case you just discovered,
ask whether that case is really one case. If an error path lumps together
"expected but unusual" and "genuinely broken," the fix has to tell them
apart — see
[Data-Model.md](Data-Model.md#pieceprogress-keys-are-not-guaranteed-to-exist-in-the-chunk-set)
for the three-way split this particular one needed.

## Verify a regression test can actually fail

After writing a test that guards a bug, re-introduce the bug and confirm the
test goes red. Then revert. A test that asserts nothing and a test that
guards everything look identical when both are green.

This costs a couple of minutes and it has already earned its place: in Pass
20 the two deliberate re-breaks failed exactly the expected tests (8 for the
unguarded lookup, 3 for the mislabelling) and nothing else, which is what
established that the suite actually covered both distinct failure modes
rather than only the one that crashed.

Related, and worth knowing before you decide something "can't be tested":
the suite is **lib-level only** — `node:test` against `src/lib/*`, with no
harness for rendering components. If logic that needs protecting is sitting
in a component, the answer is to move it into `lib/`, not to skip the test.
`lib/history.js` exists for exactly that reason.

## A doc's claim about existing behavior is a claim, not a fact — check it

When a doc states that something already works a certain way ("X and Y are
shared between A and B," "this field is keyed by Z"), verify that against
the actual code before writing new work on top of it, especially if the
claim reads as "by design" or otherwise authoritative. Docs drift, and
sometimes what's written down was always aspirational — a stated intention
that the code never caught up to — rather than a description of what
shipped.

Two instances from the same session (Pass 23–24), with opposite outcomes,
both worth the few minutes it took to check:

- **Confirmed correct:** a pass's instructions assumed `piece.memoryAnchors`
  was keyed by chunk id, matching Data-Model.md's description. Checked
  against the actual `App.jsx`/`storage.js` code before writing anything —
  it was accurate, so the pass proceeded as planned.
- **Confirmed wrong:** `CLAUDE.md`, `Architecture.md`, and
  `Product-Principles.md` all stated that `BpmZonesEditor` and
  `RecordingsEditor` were "shared, used in both Wizard and Settings." A
  user's question ("shouldn't these already be in the wizard?") prompted
  checking the actual git history of `Wizard.jsx` — neither component, nor
  even the wizard's own tempo-target field, had *ever* been rendered there.
  The claim wasn't a regression to fix; it was documentation that had
  outrun the code from the start. Knowing this changed the answer given to
  the user (not "this broke," but "this was never true") and shaped how the
  eventual fix was scoped (relocate what's genuinely shared into the shared
  component; render what would otherwise duplicate directly in the wizard
  instead — see [Decisions.md](Decisions.md#data-model)).

Trusting the first claim without checking would have been fine by luck.
Trusting the second would have meant asserting something false to the user
and potentially building on a wrong premise. Check both kinds the same way.

## Avoid duplicate documentation

Each concept has exactly one canonical home in this `docs/` set (see
[README.md](README.md) for the map). If you need to reference a concept from
another document, link to its canonical section rather than re-explaining
it. If you find duplicated explanations while working, that's worth fixing
opportunistically (see below), not worth preserving "to be safe."

## Improve documentation opportunistically

Whenever you're working in a part of the codebase these docs describe,
spend a moment checking whether the relevant doc still matches what you just
read in the code. If it doesn't, fix it — small, in-passing corrections are
exactly how this documentation set is meant to stay trustworthy rather than
becoming another stale artifact like the one that prompted the last audit.

## When you're not sure

If a request seems to conflict with something documented here (a principle,
a past decision, a stated non-goal), say so explicitly and ask, rather than
either silently complying or silently refusing. The goal is for this
documentation to make disagreements visible and resolvable, not to be cited
as an unquestionable authority.
