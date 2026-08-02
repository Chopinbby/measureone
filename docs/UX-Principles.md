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

The Overview tab answers "where do things stand right now" in about three
seconds — four stat cards, a progress bar, a preview of the first week. It
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
Piece Map, Progress charts, Analytics bars, and the practice-progress tier
bar — a color should never be repurposed to mean something different in a
new panel just because it's visually convenient.

## Editors are shared, so the UI can't drift from itself

Because `BasicsFields`, `SectionsEditor`, `DifficultyEditor`,
`RecurringEditor`, `ScheduleFields`, `BpmZonesEditor`, and `RecordingsEditor`
render identically in the Wizard and in Settings
(see [Product-Principles.md](Product-Principles.md#shared-editors-not-divergent-flows)),
a user's mental model of "how do I set the tempo target" never has to be
relearned between setup and editing. Treat any visual or behavioral
divergence between the two as a bug, not a stylistic choice.
