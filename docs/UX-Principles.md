# UX Principles

> **Purpose:** The presentation-level philosophy — how the product's principles
> ([Product-Principles.md](Product-Principles.md)) show up in layout, interaction,
> and visual language.
> **Audience:** Anyone designing or reviewing UI changes — future Claude Code
> sessions especially, since "does this fit the existing feel" is otherwise
> unanswerable from code alone.
> **Scope:** Interaction patterns and visual-language intent. The literal design
> tokens (CSS variables, fonts) live in [Architecture.md](Architecture.md); this
> doc explains *why* those tokens are used the way they are.
> **Related:** [Product-Principles.md](Product-Principles.md) ·
> [User-Flows.md](User-Flows.md) · [Architecture.md](Architecture.md) ·
> [Decisions.md](Decisions.md)
> **Update when:** A new recurring UI pattern is established, or an existing one
> is deliberately reversed (log the reversal in [Decisions.md](Decisions.md)).

## Glanceable state vs. diagnostic trend are different screens

The Piece Overview tab answers "where do things stand right now" in about
three seconds — four stat cards, a progress bar, a preview of the first
week. It
deliberately does **not** try to also show trend, history, or diagnosis.
That's the Progress tab's job: rolling-window consistency, a consistency
heatmap, tempo trend sparklines, effectiveness calibration, actual-vs-planned
progress, and a projected finish date.

Don't add trend/diagnostic content to Overview, and don't add point-in-time
summary stats to Progress that duplicate Overview — each screen should stay
legible for the question it's meant to answer. See
[Algorithms.md](Algorithms.md) for what each panel actually computes.

## Visual language is never punitive

This is the visual expression of
[the "no punishment mechanics" product principle](Product-Principles.md#no-punishment-mechanics).
The consistency heatmap uses **teal for practiced, neutral paper-background
for untouched** — never red, never a "warning" grey scale that reads as
accusatory. If a future stat needs a "bad" state color, reach for `--brick`
(already used for "hard" / "needs work") rather than inventing a harsher one,
and ask whether the stat itself is one this product principle would allow at
all.

## Direct manipulation over confirmation ceremony

Where a second confirmation step doesn't protect against a real mistake, skip
it:

- The practice-log checkbox **submits the log directly** once reps, BPM, and
  feel are all filled in — it doesn't just toggle a "done" flag and wait for
  a separate "Log practice" button. Both actions call the same `submitLog()`
  path; users kept reaching for the checkbox out of habit, so the checkbox
  was made to actually work that way rather than fighting the habit.
- The Reassess-difficulty panel's "Apply" both commits the change and closes
  the panel in one action — it used to be two separate steps and that read
  as unfinished rather than deliberate.

The test for "should this collapse into one action": would a second step
ever change the user's mind, or is it just friction restating what they
already did?

That test cuts both ways — it's also the bar a *new* confirmation has to
clear before adding one. **Since Pass 29 follow-up**, leaving Interleaved
mode (switching view, tab, or piece) with an unresolved provisional log
prompts a `window.confirm` first. This isn't an exception to the
principle, it's what the test looks like when it says "keep the
confirmation": the learner may not have realized a rough attempt was still
sitting unresolved, so the prompt can genuinely change what they do next
(go back and deal with it) rather than just restating a choice they
already made on purpose. It's scoped narrowly for exactly this reason —
only while a provisional is actually pending, never on ordinary
navigation with nothing at stake — so the common case still gets zero
friction. See
[Decisions.md](Decisions.md#spaced-repetition--maintenance).

## Detail-on-demand uses a real modal, not inline expansion

Piece Map chunk detail (BPM inputs, manual-confidence override) opens in a
modal. It used to render inline below the grid, which put it below the fold
and made it easy to miss entirely. If you're building a similar
"click a tile/row to see more" interaction, default to a modal — inline
expansion has already caused a real usability bug once in this app.

## Numbers are typographically distinct from prose

Every quantitative value — measure numbers, BPM, day counts, percentages —
renders in the monospace type (IBM Plex Mono), while headings use Fraunces
and body/UI text uses Inter. This isn't decorative: it lets a user's eye find
"the number that matters" on a page without reading the surrounding prose,
which matters more here than in most apps because so much of the UI is
numeric (measure ranges, tempo, percentages, day counts) sitting next to
short labels.

## Color carries consistent meaning, not just decoration

`--teal` always means easy / confident / positive. `--brick` always means
hard / needs-work / danger. `--brass` is the neutral primary accent (medium
difficulty, primary actions). This mapping is used identically across the
Piece Map, every Progress chart (including the confidence-by-difficulty and
outcome-breakdown bars), and the practice-progress tier bar — a color should
never be repurposed to mean something different in a new panel just because
it's visually convenient.

## Editors are shared, so the UI can't drift from itself

Because `BasicsFields`, `SectionsEditor`, `DifficultyEditor`,
`RecurringEditor`, `ScheduleFields`, `BpmZonesEditor`, `RecordingsEditor`,
and `DocumentsEditor` render identically in the Wizard and in Settings
(see [Product-Principles.md](Product-Principles.md#shared-editors-not-divergent-flows)),
a user's mental model of "how do I set the tempo target" never has to be
relearned between setup and editing — target tempo lives on the "Piece"
step/panel in both places (moved there from "Schedule" in Pass 24; see
[Decisions.md](Decisions.md#data-model) for why). Treat any visual or
behavioral divergence between the two as a bug, not a stylistic choice.

**Worked example of treating divergence as a bug:** the Wizard already
blocked "Next" on a blank piece name; Settings' "Save changes" never had
the equivalent check for a blank work title once "Multiple movements" is
selected. Fixed in two passes (Wizard first, Settings as an explicit,
separate follow-up once the divergence was noticed) rather than leaving
Settings unguarded — see
[Decisions.md](Decisions.md#multi-movement-works). The reverse gap still
exists, tracked, not silently accepted: Settings still doesn't require
piece name or total measures the way the Wizard does — see
[Decisions.md](Decisions.md#open-questions).

**One deliberate exception, not a violation of this:** Tempo zones,
Recordings, and Documents are reachable from the Wizard's first step too
(Pass 24), using the same editor components Settings uses — but they're
rendered directly in `Wizard.jsx`, not folded into the shared `BasicsFields`
wrapper the way target tempo was. Folding them into `BasicsFields` would
have made them render a second time inside Settings' "Piece" panel, on top
of Settings' own dedicated panels for each. The component is still shared
(same `{draft, set}` editor, same behavior); only which screen chooses to
mount it differs by design, for this specific case.

## A browsed day is not "now" — live, unscoped state must not leak onto it

Several features answer a "what's true right now" question off live,
un-dated totals — computed fresh on every call, with no day parameter,
because that's the correct shape for what they're actually asked (see
[Algorithms.md](Algorithms.md#section-run-throughs) for one such function).
That's fine as long as the *only* place they're read from is real "today."
The recurring mistake is reading one of them from a component that also
renders a browsed past or future day, which shows today's live answer
relabeled as that day's own status — and, if the surface also logs data,
can silently attribute it to the wrong day.

This has now surfaced three times, in three different features, always
fixed the same way — scope the *display* (and any write path through it)
to real "today," never add a day parameter to the underlying live
computation:

- Pass 22: Week view is read-only specifically because a session logged
  from a non-today cell would be keyed to the wrong day.
- Pass 66: `mergeLiveDueReviews` only folds live-due reviews into real
  "today" — a date-picker/day-nav browse to a different day is unaffected.
- Pass 68: `SectionRunThroughPanel` only renders when `isRealToday` —
  `sectionRunThroughGate`/`computeSectionRunThroughs` stay day-agnostic on
  purpose.

Treat a fourth instance of this exact shape (a live, un-dated "is this due
right now" function whose result gets rendered somewhere a browsed day is
also possible) as a strong prior that the fix is a display-layer gate on
`isRealToday`, not a new parameter threaded into the computation itself.
See [Decisions.md](Decisions.md#ux) (Pass 22, Pass 68) and
[Decisions.md](Decisions.md#spaced-repetition--maintenance) (Pass 66) for
the three writeups.

**Since Pass 74, a related but mechanically different trap surfaced next
door.** `handleReschedule`/`ScheduleBanner` were never day-agnostic — they
already took a day argument — but `App.jsx` was passing `currentDay`
(`dayOverride || realCurrentDay`: whichever day is being *browsed*) where
`realCurrentDay` (always the real day) was needed, so browsing to a past or
future day could shift *when rescheduling itself considers a chunk
overdue*, not just what got rendered. Same root principle — a browsed day
must not stand in for "now" — but the failure mode is different: not a
day-agnostic function leaking today's answer everywhere, but two
same-shaped day values that look interchangeable and aren't. Worth
checking for on any future change in this neighborhood, alongside the
three above. See [Architecture.md](Architecture.md#state-management) and
[Decisions.md](Decisions.md#scheduling).

**Since Pass 84, the same `isRealToday`-gates-a-display-element idiom got
reused proactively, not to fix a leak.** Daily Practice's own `<h1>` now
renders only when `isRealToday`, disappearing entirely on a browsed day —
but unlike the three instances above, there was no live-computation-leaking-
onto-a-browsed-day bug being fixed here; it's a plain heading, not a due-
status query, and the request was cosmetic (stop restating "which tab this
is" on every browsed day once the day-count line already says which day is
showing). Worth knowing the idiom now has two different uses in this
codebase — as the fix for the specific bug shape above, and as a general
"only show this on real today" tool for ordinary display decisions — so
finding it somewhere doesn't by itself imply a leak was being fixed there.
See [Decisions.md](Decisions.md#ux).
