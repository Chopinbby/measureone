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

**When the logic genuinely can't move to `lib/` — a per-piece `try`/`catch`
loop in a component is inherently about the render loop, not a pure
function — verify it by actually reproducing the failure, not by reading
the code and reasoning it should work.** Worked example (Pass 42): a review
flagged that `AllPiecesTab` had no error isolation between pieces, unlike
`MasterAgendaTab`'s established pattern for the same "loop over every piece"
shape. Adding the `try`/`catch` and confirming it *read* correctly wasn't
treated as done — instead, a piece with `measureDifficulty: null` (a
realistic corruption `validateAndMigratePiece` doesn't guard against) was
injected directly into `localStorage`, the page reloaded, and the console
checked for the actual error message. Only that — watching the malformed
piece get skipped with a logged error while the good piece still rendered —
counted as verification. The browser-testing equivalent of "verify a
regression test can actually fail" above, for the one category of defensive
code the lib-only suite can't reach.

**A test's own hand-computed expected value needs the same rigor as the
code it's testing — prefer deriving it from the same primitives, not a
second hand-typed formula.** Worked example (Pass 39 follow-up): a new
`planRescheduleForPieces` test asserted `plan.extend.daysToLearn` against
`20 - 1 + requiredDays`, hand-computing the piece's elapsed-day count from
the test's own `startedDaysAgo(20)` setup call. The real value was
`elapsedDay(piece) - 1 + requiredDays` — off by one, because
`daysBetweenInclusive` counts the start date itself as day 1, which the
hand-typed `20` silently didn't account for. Caught immediately by running
the suite (`22 !== 21`), not by inspection — fixed by importing `elapsedDay`
and computing the expected value the same way the code under test does,
removing the second, drift-prone calculation entirely rather than just
correcting its arithmetic once.

## Manually testing a stateful fix against data your own earlier testing already mutated can hide whether it works

When verifying a fix that depends on a piece of data's *history* (not just
its current values — a reschedule marker, a ladder stage, anything written
by an earlier action rather than freshly computed), don't reuse test data
you already exercised with different — especially pre-fix — code earlier in
the same session. The data can be left in a state that produces a
misleading result for the new test, and it will look identical to a real
bug in the new code until you trace it back.

Worked example (Pass 39 follow-up, bulk-reschedule-extend fix): verifying
the new fix against three pieces that real manual testing, earlier in the
very same session, had already run "Reschedule all" against — using the
*pre-fix* code — produced an empty result with zero explanation from the
console. The new fix looked broken. It wasn't: those three pieces had been
left, by that earlier click, in a state where `computeScheduleStatus`'s
"is this missed" check could never read true again (see
[Decisions.md](Decisions.md#open-questions) for the mechanism — a real,
independent bug this testing surfaced, not one the new fix caused).
Re-running the exact same fix against a freshly seeded piece — never
touched by any earlier action — confirmed it worked correctly on the first
try. The lesson isn't "that bug exists" (that's a product finding, logged
separately); it's the testing discipline: when a fix's behavior depends on
what a piece has already been through, verify against data with a *known*,
clean history, not whatever happens to already be sitting in the
environment from earlier in the session.

## A markdown anchor you compute from a heading is a guess, not a fact — verify it

GitHub-flavored anchors are generated from heading text by a specific,
easy-to-get-wrong set of rules (lowercase, spaces to hyphens, most
punctuation stripped). When linking to a heading elsewhere in `docs/`,
don't hand-derive the anchor from the heading text and trust it — grep the
target file (or other existing links to the same heading) for the anchor
string that's actually already in use, and reuse that exact string. The
failure mode is silent: a wrong anchor doesn't error, the link just resolves
to nowhere in particular, and nothing in the normal edit-and-move-on flow
surfaces that.

Worked example (Pass 39): a new cross-reference to Repertoire-Lifecycle.md's
Stage 3 heading — "Stage 3 — 'Learned' (defined; not yet implemented)" —
was written as `#stage-3--learned`, a plausible-looking shortened guess.
The real anchor, already in use by several pre-existing links elsewhere in
the same docs set, was the full
`#stage-3--learned-defined-not-yet-implemented` (the heading was
deliberately left unrenamed specifically *because* changing it would break
every one of those). Caught by grepping the whole `docs/` tree for the
literal anchor string before trusting it, which surfaced the mismatch
against the pre-existing links immediately.

## An immediate post-action check is not the same as verifying persistence

When manually testing anything that writes to `localStorage`, check it
survives an actual page reload, not just that it reads back correctly right
after the click. React state can be completely correct in memory while the
write to disk silently failed or never happened — the two only look
identical if you never reload.

Worked example (Pass 29 follow-up): discarding a provisional Interleaved
session while switching pieces looked fine every time it was checked
immediately after the click — `pieces` state genuinely was updated
correctly. It was only reloading the page afterward that revealed the
discard hadn't actually reached `localStorage` at all, because `App.jsx`'s
save effect had been scoped to "persist only the active piece," and by the
time it re-ran, `activePieceId` already pointed at the *new* piece. A
purely in-memory check would have called this done and shipped a real,
silent data-loss bug. See
[Decisions.md](Decisions.md#spaced-repetition--maintenance) for the fix.

**A second, distinct way to hit the same underlying trap: the write can
genuinely reach `localStorage` correctly and still get silently clobbered
afterward, by separate logic that recomputes the same field on every
load.** The Pass 29 case above was a write that never landed; this one is
a write that landed, then got overwritten by something else entirely.
Worked example (reschedule "extend the plan" feature): extending a
`scheduleMode: "minutes"` piece's `daysToLearn` via the reschedule dialog
worked immediately — checked `localStorage` right after the click and the
extended value was genuinely there. It was only reloading the page that
revealed `reconcileMinutesPerDaySchedule` (`lib/scheduling.js`, called on
every load to keep `daysToLearn` honest against `minutesPerDay`) had
silently recomputed it right back down, because that function had no way
to know the extension was deliberate rather than stale. No error at any
point, and the "behind schedule" banner gave no symptom either, since it
correctly waits for a day to actually lapse before flagging anything — a
purely in-memory-plus-immediate-`localStorage` check would have called
this done. The general lesson: when a field is *derived* on load (not just
saved), verifying the save isn't enough — verify what the load-time
derivation does to it too, which usually means an actual reload, same as
the first case. See [Decisions.md](Decisions.md#scheduling) for the fix.

## A visual "disabled" treatment can silently break in ways only a real hover reveals

Pairing a disabled control's grayed styling with `pointer-events: none`
(often reached for to also suppress a hover-color CSS rule that isn't
itself gated on `:disabled`) removes the element from hit-testing
entirely — including for the native `title` tooltip, which depends on the
browser detecting a real hover. Reading `element.title` (or the JSX)
confirms the attribute is present; it does not confirm the browser will
ever actually show it.

Worked example (same session as Pass 43/45): a disabled "Archive piece"
button was styled `{ opacity: 0.45, cursor: "not-allowed", pointerEvents:
"none" }` with a `title` explaining why it was locked. A first
verification pass read `button.title` via script and called the tooltip
"present" — true of the attribute, not of what a user would ever see. A
later, more skeptical review actually dispatched a real hover and checked
`button.matches(':hover')` — false, meaning the tooltip could never
trigger. Fixed by dropping `pointerEvents: "none"`: the native `disabled`
attribute already blocks clicks and keyboard activation on its own, so
pointer-events was never load-bearing for that half of the requirement,
only for the cosmetic hover-color suppression. Re-verified the same way —
hover then registered `:hover` correctly. The general lesson: for any
disabled-with-tooltip or disabled-with-hover-dependent UI, verify by
actually hovering and checking the resulting state (`:hover` match,
whether a listener fires), not by reading an attribute off the element and
assuming the browser will honor it the way the element's other properties
suggest.

## A dispatched synthetic event that doesn't bubble the way you assume will silently no-op

When verifying UI in-browser via script (`dispatchEvent` rather than a real
click/keypress), some event types don't behave the way `{ bubbles: true }`
implies. `blur`/`focus` don't bubble natively — React's synthetic
`onBlur`/`onFocus` handling depends on the browser's own focus-change
machinery, not just event delegation — so a scripted
`el.dispatchEvent(new Event('blur', { bubbles: true }))` can silently fail
to trigger a commit-on-blur handler while returning no error at all. The
element just keeps showing the uncommitted value, which looks identical to
"the fix doesn't work" until you check with a real interaction instead.

Worked example (session covering Pass 53 and Pass 55's follow-up BPM-field
conversion): testing whether a `NumberInput` correctly clamped an
out-of-range value on blur, a script set the field's value and dispatched
a synthetic `input` then `blur` event. The field kept showing the
unclamped number afterward — looked like a real clamping bug. It wasn't:
driving the exact same interaction through the `computer` tool (a real
click to focus, real keystrokes, a real Tab key to blur) clamped correctly
on the first try. The `input` event worked as scripted; only `blur` was
the unreliable half, because dispatching it doesn't reproduce the actual
focus-change the browser performs on a real Tab press or click-away.

The generalizable habit: prefer real `computer`-tool interactions (click,
type, Tab, real mouse-driven focus changes) over `dispatchEvent` for
anything that depends on `blur`/`focus`/`change` firing correctly.
`dispatchEvent` is fine for read-only inspection or events you've already
confirmed round-trip correctly (plain `input` events generally do); when a
scripted interaction produces a surprising "it didn't work" result for
anything touching commit-on-blur, changing the *input method* is worth
trying before concluding the code is broken.

## A guard added for one navigation path needs auditing everywhere that path exists

When you add a confirmation/guard before a state transition (leaving a
screen, switching context, anything with "are you sure"), don't stop once
the specific buttons you built the feature around are covered. Grep every
call site of the state setter the guard is meant to protect, not just the
ones you happened to exercise while building and testing.

Worked example (Pass 29 follow-up): a "warn before leaving Interleaved mode
with unresolved data" guard was built and verified against three routes —
the view-mode buttons, the sidebar nav list, the piece switcher. A later
review pass grepped every `setActiveTab`/`setActivePieceId` call site in
`App.jsx` and found two more the sidebar can trigger ("Edit piece,"
finishing the "Add new piece" wizard) that had simply never been
considered, let alone tested, because they weren't part of the three
routes the feature was scoped around while building it. Not a subtle bug —
a `grep` would have caught it in seconds, if it had been run before calling
the feature done rather than after.

## Two features built in the same session that read the same underlying signal still need a joint test, not just two separate ones

Verifying each feature against its own intended scenario, right after
building it, proves that feature works in isolation. It doesn't prove
anything about what happens when a user's actual path runs through both —
and a session that ships more than one feature touching the same
data/state is exactly where that gap tends to hide, because each pass's
own testing never has a reason to put the *other* pass's changes in front
of it.

Worked example (Pass 47/48, same session): a "jump to the earliest
incomplete day" button (Pass 47) and a "collapse a day whose tasks were
all moved by a reschedule" display fix (Pass 48) both read from the same
underlying signal — which days are genuinely still behind after a
reschedule — built and each verified correctly on its own. Pass 47's own
test used a piece with no reschedule marker at all; Pass 48's own test
navigated days directly, never through the button. Neither test ever
exercised the other feature. Asked afterward to critically review "the
files changed this session" as a skeptical second reviewer — not to re-run
either pass's own checks — surfaced the gap immediately: the button's day
search had no idea Pass 48's collapse existed, so after any reschedule it
reliably pointed at day 1 (the earliest *original* behind day, unaware
it had since collapsed to a bare "Tasks rescheduled" line) — a functioning
button leading to a dead end, confirmed live by reproducing the exact
click. Fixed by having the button's search reuse the same collapse check
and skip a day it applies to. The general lesson: when a session's own
passes touch the same signal, "does each pass work" is not the same
question as "does using one lead correctly into the other" — the second
one needs its own explicit pass, ideally before calling either feature
done, not only when a later review happens to ask for it.

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
- **Confirmed wrong, but that wasn't the end of it (Pass 42):** a pass's own
  instructions claimed a specific line on Overview ("N movements, N plans")
  showed a piece's work title twice. Checking it against the actual Pass 38
  commit and live rendering showed that line has never contained title text
  at all — the claim, as literally stated, was false. The easy stopping
  point would have been "nothing to fix here." Instead, the underlying
  complaint the claim was gesturing at — the work title genuinely does show
  twice on that screen — turned out to be real, just one card down
  (`PartSwitcher`'s own heading, not the line named). Disproving the literal
  claim isn't the same as confirming there's nothing to the complaint behind
  it; when a claim about *where* something is wrong turns out false, check
  whether the *what* is still true somewhere else before reporting back that
  there's nothing there.

Trusting the first claim without checking would have been fine by luck.
Trusting the second would have meant asserting something false to the user
and potentially building on a wrong premise. The third would have meant
telling the user their actual complaint was imaginary. Check all three kinds
the same way.

**The same risk applies to a claim written in a code comment, not just in
`docs/`.** A comment asserting "X still happens, it's just harmless" is
exactly as unverified as a doc saying the same thing — it just lives in a
different file.

Worked example (Pass 85): a `SettingsTab.jsx` comment claimed that a
disabled `.ghost-btn` still shows the brass `:hover` tint (since
`.ghost-btn:hover`, unlike `.primary-btn`/`.danger-btn`'s hover rules,
isn't guarded with `:not(:disabled)`), calling it "a minor, harmless
cosmetic quirk." That comment was about to be deleted anyway as part of an
unrelated cleanup (removing a now-redundant inline style once
`.ghost-btn:disabled` finally got a shared CSS rule) — rather than just
trusting and discarding the claim, a real mouse hover (`computer` tool,
not a scripted `dispatchEvent` — see the entry above on why that
distinction matters) on an actual disabled button in the test browser
showed no visual change at all, despite `:hover` technically matching
(`el.matches(':hover')` → `true`). Cross-checked against hovering an
*enabled* ghost-btn in the same session to rule out "the hover tool isn't
working" as the explanation — it worked correctly there (border and
background both changed as expected), so the disabled button's lack of
change was real, not a tooling artifact. The claim, at least in the one
browser tested, didn't hold up. Not treated as a universal fact either —
only one browser engine was checked, and nothing was changed as a result
(the un-guarded hover rule was out of this pass's scope regardless) — but
worth knowing before citing that old "harmless quirk" claim again. See
[Decisions.md](Decisions.md#ux) for the full writeup.

## Your own hedged claim in a review is a claim too — verify it, don't just state it more carefully

When a self-review turns up a risk you didn't fully check ("I believe X
prevents this, but I didn't verify" / "reasonably confident, not certain,
because..."), the honest hedge is the right call in the moment, but it
isn't a substitute for going back and actually checking once there's time
to. Stating uncertainty carefully is not the same discipline as resolving
it, and the two are easy to conflate because the hedged version already
*feels* rigorous.

Worked example (Pass 51 review cycle): a critical review of a new Progress
panel flagged, as a P2, that a section with a backwards measure range
(`end < start`) would make the estimate math produce `NaN` — but noted
"never manufactured or observed, just reasoned about" and "I believe
existing section-editing code prevents this," rating overall confidence
"reasonably confident" specifically because of that unverified belief.
Asked to show the issue live rather than just describe it, checking the
actual `SectionsEditor.jsx` code (not reasoning about what it probably
did) took under a minute and found the belief was flatly wrong — nothing
validated `start <= end` at all, and the failure was trivially reachable
through completely ordinary use. The `NaN` reproduced exactly as
predicted, plus a worse detail the reasoning-only pass hadn't
surfaced: it poisoned *both* bars for that item, including the
otherwise-valid one, via a shared `Math.max` denominator. The fix that
followed was root-cause (normalize the editor), not a patch on the
symptom only — available specifically because the actual mechanism, not
just its existence, had by then been confirmed.

The generalizable habit: when a review produces a hedge, treat "not yet
verified" as a to-do, not a finished answer — go check it before the
confidence rating is final, the same instinct as checking a doc's claim
against the actual code rather than trusting the prose.

## A conditionally-`null`-returning component still carries its state across every re-appearance

When a component's own function body decides whether to render anything
(`if (someCondition == null) return null;`), that's not the same as
unmounting. Its parent usually still renders the same `<Component />` on
every pass regardless of what it's about to return, so React keeps the
same instance — and every `useState` in it — alive the whole time,
including through however many renders it spent returning `null`. Any
local state that should logically "start fresh" the next time the
component has something to show needs an explicit reset tied to the
condition that makes it reappear; it will not reset on its own just
because nothing was on screen for a while.

Worked example (Pass 56 review): `ColdStartPanel` shows a due/not-due
panel driven by `coldStartDueThreshold(piece)`, returning `null` when
nothing's due. A note typed into its free-text field but never
submitted survived a "goes quiet, becomes due again days later" cycle
untouched — since the component never actually unmounted between those
two due windows, the stale draft would silently reappear pre-filled the
next time the panel had something to show. Fixed with a `useEffect` keyed
on the due-condition itself, clearing the field whenever the panel newly
has something new to render. A related timing hazard came up designing
the fix for a follow-up in the same area (Pass 58's post-log "rate the
piece" prompt): an *automatic* write meant to record "the user has now
seen this" would trigger a re-render whose very next computation reads
its own just-written state and immediately hides what it had only just
decided to show — invisible to a human tester despite technically
rendering for one commit. Both are the same root cause (conditional
`null` rendering keeps state alive across visibility toggles) surfacing
in opposite directions — one where state should have reset and didn't,
one where an automatic reset would have fired too eagerly — so when
adding logic like this, trace both directions before considering it done.

The same "still the same mounted instance" fact has a sharper failure mode
than stale state: it means you cannot move a hook call itself behind a
new conditional early return, even when a spec asks for exactly that.
Worked example (Pass 68): the task described gating
`SectionRunThroughPanel` by adding `if (!isRealToday) return null;`
*before* its existing `useMemo(...)` call — textually the same shape as
the component's other early return, just checked first. Implemented
literally, this calls `useMemo` on some renders and skips it on others,
for the *same mounted component instance* (this panel never unmounts when
the learner changes days — it's a fixed, unconditional child of
`TodayTab`), which is exactly the "fewer hooks than expected" crash React
throws for a component's hook count differing between renders. The
existing entry above covers the same instance-persistence fact producing
a stale-state bug; this is that same fact producing a crash instead. Fixed
by keeping the `useMemo` call unconditional and short-circuiting to `[]`
*inside* its callback based on the new condition, with the early return
placed after it — same "skip the real computation" outcome the task
asked for, no hook-order risk. Before implementing an early return a spec
describes as going "before" an existing hook call in an
always-rendered-but-sometimes-null component, check whether the condition
gating it can flip on a live, mounted instance — if it can, the hook call
itself cannot become conditional; only what happens inside it can.

## Cleaning up manually-injected test data needs a reload, not just a storage write

When verifying a fix by writing a scratch piece directly into
`localStorage` (bypassing the UI), removing it the same way
(`localStorage.removeItem(...)`) only clears the on-disk copy. If the app
is still open in the same tab, its own state (`pieces`, held in React,
loaded once from storage) still has the old data in memory — and this
app's auto-save effect (see [Architecture.md](Architecture.md#state-management))
writes every entry in that in-memory state back to `localStorage`
whenever it changes, for any reason, including one that has nothing to do
with the piece you just tried to delete. The next such write silently
resurrects the "removed" test piece.

Worked example (same session, Pass 57/58 browser verification): a test
piece was removed via `removeItem` and confirmed gone via
`Object.keys(localStorage)` immediately after. Several tool calls later —
none of them touching that piece deliberately — `Object.keys(localStorage)`
showed it back, restored by the app's own save effect reacting to
something unrelated. The fix is procedural, not a code fix: after removing
manually-injected test data, reload the page before trusting the cleanup,
the same way [verifying any write requires an actual reload](#an-immediate-post-action-check-is-not-the-same-as-verifying-persistence) —
this is that same lesson applied to deletions instead of writes.

## Adding a new per-chunk ladder field is a checklist, not a single edit — this codebase has already proven that twice

When `computeLadderAdvance` (or any pure function whose result gets
persisted through a stateful React component with no test harness) gains a
new field, the pure function being correct is not the same as the feature
working. Two more things are load-bearing, and both are easy to skip
because nothing errors when you do:

1. **The stateful caller has to actually thread the field through.**
   `App.jsx`'s session handlers (`handleLogSession`, `handleUnlogSession`,
   `handleConfirmProvisionalSession`) read/write every ladder field through
   explicit, hand-maintained lists, not a wholesale object spread — a new
   field added to the pure function's input/output shape does not
   automatically reach these lists. Skip it and the pure function computes
   and returns the correct value every time (fully provable by unit tests,
   since those call the pure function directly), while the real app
   persists nothing — `prevEntry.newField` is never read in,
   `advance.newField` is never written back out.
2. **A "no data yet" backfill must default to `null`, not a materialized
   value** (`0`, `false`, whatever the field's "empty" state looks like).
   `storage.js`'s migration backfill, and anywhere a snapshot captures the
   field for undo, gets compared against a raw, unmigrated import via
   `!==` (`ladderStateDiffers`/`LADDER_STATE_FIELDS`). A migrated piece
   carrying a real `0` where an old export has no key at all reads as
   genuine disagreement, forcing the import-conflict picker on an
   otherwise byte-identical re-import.

Worked example, twice over: `tempoRatchetK` (Pass 59) hit **both** of these
— found and fixed in the same session it was added, once each.
`holdingReviewCount` (Pass 61), a completely different field added two
passes later in the same broader session, hit **the exact same two bugs**,
independently rediscovered rather than avoided by the first one already
having been fixed. Both were caught only because the user explicitly
requested a skeptical second-engineer review of the diff before
committing — nothing in either original implementation, or either pure
function's own thorough unit tests, surfaced either bug on its own.

The checklist, going forward, for any new field on
`chunkLadderState`/`computeLadderAdvance`'s return shape: (a) all three
`App.jsx` session handlers — the snapshot capture, the function's own
input, and the persisted output, in each of the three handlers that touch
ladder state; (b) `storage.js`'s `backfillProgressLadderState`,
`LADDER_STATE_FIELDS`, and `mergeProgress`'s explicit field list; (c) the
backfill/snapshot default is `null`, never a materialized value, unless
the pure function's own resolution point already treats the two
identically (confirm this, don't assume it — it happens to be true for
both fields above, which is exactly why the wrong default never crashed
anything and stayed hidden). See
[Decisions.md](Decisions.md#spaced-repetition--maintenance) for both
incidents' full detail.

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

## A dirty working tree may not be entirely yours to commit

This project is sometimes worked on from more than one session at once (the
user may have another chat open against the same clone). Before running
`git add`/`git commit`, check whether `git status`/`git diff` shows changes
you didn't make — compare against what the working tree looked like when
your session started, not just against what you personally just edited.
Don't assume unfamiliar diffs are stray artifacts to clean up or, worse,
silently fold them into your own commit.

Worked example (Pass 24/38): a two-line copy fix was ready to commit, but
`git diff` showed six modified files, four of which were untouched by this
session — another session's in-progress work sitting in the same working
tree, including further edits to the very file being committed. Committing
everything would have shipped unreviewed code under this session's name;
committing nothing would have lost the approved fix in the noise. The fix:
build a patch containing only the hunks actually authored this session and
apply it with `git apply --cached` (stages just those hunks, working tree
untouched), then commit — leaving the other session's changes exactly as
they were, uncommitted, for it to handle. See
[CLAUDE.md](../CLAUDE.md)'s Pass 38 note for what that other session's
changes turned out to be.

## A blocking native dialog isn't a dead end in the automated browser — read the console instead

The in-session browser tool suppresses native `window.alert`/`window.confirm`
dialogs rather than letting them block the page — a click that triggers one
returns immediately, with no visible change on screen and no dialog to
interact with. That looks like the click did nothing. It didn't: the
suppressed call, including its full argument string, is written to the
console as a warning (`"Page dialog suppressed (alert): "<the exact
text>"..."`). Reading it back via the console-messages tool confirms not
just that the code path ran, but the literal string it produced — useful
whenever the thing you're verifying is copy, not just a code path
(confirming a renamed string reached every `window.alert` call site,
for instance).

Worked example (Pass 84): three `window.alert` calls (a single-piece
reschedule dialog and both halves of a bulk "stuck pieces" message) had a
tab name renamed inside their template strings. Rather than trusting the
source-level rename, two of the three were fired for real — a throwaway
piece was seeded directly into the exact state each alert's `if` branch
requires (every practice chunk and connector logged, but the piece pushed
behind schedule via a backdated `startDate`, cross-checked beforehand
against the real `computeScheduleStatus`/`computeRemainingConnectorIds`/
`isPlanActuallyComplete` functions to confirm the branch would actually
fire) — and the console's suppressed-dialog warning was read back to
confirm the new tab name was actually in the string the running app
produced, not just in the source line that was edited. The console output
is truncated past roughly 200 characters, so a long message needs its tail
confirmed separately (here, by having already read the exact source line)
rather than assumed complete from the console alone.

## When you're not sure

If a request seems to conflict with something documented here (a principle,
a past decision, a stated non-goal), say so explicitly and ask, rather than
either silently complying or silently refusing. The goal is for this
documentation to make disagreements visible and resolvable, not to be cited
as an unquestionable authority.
