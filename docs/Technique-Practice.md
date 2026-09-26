# Technique Practice

> **Purpose:** The canonical design brief for Technique practice — a daily
> list of scale and arpeggio work shown alongside piece practice, plus a
> Technique page for managing the scale library and practice methods.
> **Audience:** Anyone changing how technique tasks are chosen, shown, or
> stored (the brief Passes 99–104 were built from).
> **Scope:** What the feature does, where it appears, what it stores, and how
> each day's list is built. Not the reasoning behind each choice — see
> [Decisions.md](Decisions.md#technique-practice). Not the tuning status of
> its numbers — see
> [Research.md](Research.md#technique-practice-constants).
> **Related:** [Decisions.md](Decisions.md#technique-practice) ·
> [Research.md](Research.md#technique-practice-constants) ·
> [Data-Model.md](Data-Model.md#technique-practice-data-app-level) ·
> [Roadmap.md](Roadmap.md#priority-ordered-backlog) ·
> [Product-Principles.md](Product-Principles.md#recommend-the-highest-impact-next-action)
> **Update when:** Any pass from 99 onward builds part of this (mark what
> shipped, and move anything that turned out differently into
> [Decisions.md](Decisions.md#technique-practice)), or a decision below is
> revisited.

**Status: built (Passes 99–104).** Engine `src/lib/technique.js` (99), storage and
App wiring (100), the Technique page (101), the panel on Master Agenda and
Daily Practice (102), piece keys (103), backups (104). The brief below is
kept as written; where the build differs, the list below says so and
[Decisions.md](Decisions.md#technique-practice) has the reasoning.

**Shipped differently from the brief** (all confirmed with the user):
- Pace is a days-a-week target (starred ~3, repertoire ~4, both 3–4
  alternating weeks), not x2/x3/x5 multipliers — [Decided](#decided) item 4.
- Slow tier = slowest third of in-rotation items **by count**, not by tempo range.
- A check-off can be **undone**; adding a scale or putting one back in
  rotation **tops up today's list** at once; switching a scale off removes
  its unfinished task from today.
- Tempos are limited to 30–300.
- The walk hint shows only when the key of the day is on today's list, and
  keeps naming today's key after it's checked off.
- On Master Agenda and Daily Practice the panel is hidden when today's list
  is empty; a scales-only day reads "<tier> — technique only".
- Piece keys are matched **as written** (G♭ ≠ F♯), and the key lists show
  each enharmonic pair as one entry ("F♯/G♭ major") — see [Decided](#decided) item 1.
- Backups merge technique data and never remove anything here.

**Approved UI:** [`mockups/technique-practice.html`](mockups/technique-practice.html)
— a saved copy of the "Technique Practice Mockup" artifact. It uses sample
data (sample scales, sample pieces, sample status labels) and is a design
reference, not code to ship. Open it in a browser to click through. Where the
mockup and this brief disagree, see [Mockup vs brief](#mockup-vs-brief).

## What

A daily list of scale and arpeggio practice, with 3–4 varied practice methods
per scale, shown on the Master Agenda and in every piece's Daily Practice,
plus a Technique page for managing the library.

- **Self-assessed only** — no audio or MIDI input.
- **No streaks and never "behind."** Scales are per-day tasks and show only
  on the real today. Unfinished tasks carry over to the next day instead of
  piling up (see [How each day's list is built](#how-each-days-list-is-built)).
  This is what keeps the feature consistent with
  [No punishment mechanics](Product-Principles.md#no-punishment-mechanics).
- The per-scale practice methods are a **new build**, not a revival of the
  removed `suggestMethods()` — see
  [Product-Principles.md](Product-Principles.md#recommend-the-highest-impact-next-action).

## Where it shows up

- **Sidebar:** "Technique" directly under Master Agenda, with a hairline
  divider before the piece items and no group header.
- **Technique page:** eyebrow "Technique", h1 "Scales and arpeggios", an
  "Add scale or arpeggio" button top-right, and three tabs: **Today /
  Library / Methods**.
- **One shared "Technique" panel** (icon, heading, "N of M done", "about 5
  minutes each") appears in three places:
  - the Technique page's Today tab;
  - the Master Agenda, above the Learning/Maintenance/Revival subtabs;
  - each piece's Daily Practice, including during a revival.

  It shows on the **real today only** and is hidden when browsing another
  date. It is one shared list: checking a scale off anywhere shows it done
  everywhere.
- **Master Agenda "Total planned"** includes technique at 5 minutes per task
  on today's list (default, adjustable later). The Busy/Moderate thresholds
  are unchanged.

## The task card

- Title, then a meta line: "2 octaves · hands together".
- 3–4 practice methods, each with:
  - a **star** (favorite) — global per method, not per scale;
  - a **technique tag**: Rhythm, Dynamics, Articulation, Motion, Hand
    coordination, Fingering, Memory.
- A pill, **"Repertoire in this key"**, when an active piece is in that key.
  One label for all pieces, whether being learned or finished.
- A **check circle**. Done = filled teal checkmark plus a tinted card, no
  strikethrough. A **bare check-off** is allowed: it counts as done and
  practiced but does not change the saved tempo.
- **Expanded** card:
  - each method's instructions;
  - **"Recommended starting tempo"** = 85% of the last verified even tempo,
    with a hover tooltip on the number reading "85% of your last verified
    tempo (♩ = X)" and the line "Start here and work up while it stays
    clean.";
  - **"Finish with an even-rhythm check"**: "Play N octaves evenly, no
    rhythm variation" (N is plain text from the item's saved setting), a
    tempo field, and **Log check**;
  - a small **"Practice this scale more often"** star button (a star shows
    by the title when on).
- There is **no octave selector** on the card.
- Terminology: **"even rhythm"**, never "straight rhythm".

## Library and methods

### Library tab

- Every item, with: star, name, "Scale/Arpeggio · octaves · hands", even
  tempo with a bar relative to the user's own other items, last checked, and
  an in-rotation switch.
- Filter: **All / Scales / Arpeggios**. Sort: **rotation priority / circle of
  fifths / slowest first**.
- A note icon marks items in a repertoire key.
- Click a row to edit **octaves**, **hands** (together / a third apart / a
  sixth apart), and **even-rhythm check octaves** (1–4). Check octaves are
  also set in the Add form.
- **Changing check octaves on an item that has a saved tempo** asks: "Your ♩
  = X was measured over N octaves. Keep it as a starting point, or start
  fresh?" with **Keep as starting point** / **Start fresh**.
  - Leaving without choosing discards the change.
  - No prompt if there is no saved tempo.
  - Start fresh clears the tempo; the next check sets it.

### Methods tab

13 built-in methods grouped by technique, each with a star, an on/off switch,
and an "applies to" line, plus **"Add your own method"** (name, technique,
how to play it, applies to).

Built-ins:

1. Dotted rhythm, then its inverse
2. Every order of quarter-quarter-eighth-eighth
3. Half notes against quarter notes
4. Eighths against triplets
5. Subdivision ladder
6. One hand piano, the other forte
7. One hand staccato, the other legato
8. Contrary motion from opposite ends (hands together only)
9. Formula (Russian) pattern (scales only)
10. Staggered entry (hands together only)
11. Touch before the thumb crossing
12. Eyes closed
13. Chaining

The brief names the methods but not each one's tag or instructions; the
mockup supplies both (see [Mockup vs brief](#mockup-vs-brief)).

## Data

Technique data is **app-level, not inside any piece.** It has its own
`localStorage` key and its own update path, and it is included in backups.
It never goes through `setPieces` or `updatePiece`.

- **Items:** `form` (scale/arpeggio), key (tonic + major/minor + minor form),
  `octaves`, `hands`, `evenTempo` (nullable), `checkOctaves`,
  `lastCheckedDate` (tempo logged), `lastPracticedDate` (any check-off),
  `starred`, `inRotation`.
- **Methods:** built-ins live in code with stable ids; user state (`starred`,
  `enabled`) and custom methods are saved separately; a last-used date per
  item per method.
- **Today's list:** created once per day and saved, so it is stable across
  screens. Unfinished entries carry to the next day with the same methods.
- **Walk position** (0–23) and **settings**: scales per day (default 3),
  minutes per scale (default 5).
- **Piece:** new optional fields for the key of the piece and other keys it
  passes through (by key, not by specific scale — see [Decided](#decided)
  item 1).

Field names above are the brief's descriptive names, not a final schema; the
pass that builds storage fixes the exact shape and records it in
[Data-Model.md](Data-Model.md#technique-practice-data-app-level).

## How each day's list is built

At most **3 tasks**, filled in this priority order:

0. **Carried over.** Unfinished tasks from earlier days stay on the list and
   count toward the 3. Nothing piles up; there is no "behind".
1. **Repertoire-key and starred scales that are due.** Target pace:
   - a **starred** scale: about **3 days a week**;
   - a scale in a **repertoire key**: about **4 days a week**;
   - a scale that is **both**: **3–4 days a week, alternating weeks between
     3 and 4** (see [Decided](#decided) item 4).

   An item is due once the days since it was last practiced reach its target
   return interval (7 ÷ its days per week). Most overdue first.
2. **Slow scales.** The slowest third by even tempo, relative to the user's
   own range (no tempo yet counts as slowest), not practiced in the last 7
   days. Slowest first.
3. **The circle-of-fifths walk** fills whatever is left. The key of the day
   is a major key, then its relative minor the next day, then the next key
   around the circle:

   C, A minor, G, E minor, D, B minor, A, F♯ minor, E, C♯ minor, B, G♯ minor,
   F♯/G♭, D♯/E♭ minor, D♭, B♭ minor, A♭, F minor, E♭, C minor, B♭, G minor,
   F, D minor — **24 days per lap**.

   1–2 items from that key (a minor day gets 1–2 of its minor forms). Keys
   with no library items are skipped. The walk advances when any item in the
   key of the day is done, not by the calendar.

**Methods per scale:** 3–4 from the methods that fit the item (form/hands)
and are switched on. Longest since used on this item first; starred methods
count double; at most two of the same technique; skip the last session's
methods. A method counts as "used" only when the task is done.

**Hand-picked constants:** the numbers above (24-day lap, the days-a-week
pace targets, 85% starting tempo, 5 minutes per scale, 3 tasks per day, 3–4
methods per scale, slowest third, 7-day cooldown) are starting values, not
derived from any study. The canonical inventory is in
[Research.md](Research.md#technique-practice-constants).

## Not in v1

- Technique time in Progress, "time practiced", or the consistency heatmap.
- The "two different scales, one per hand" method.
- A settings UI for scales per day and minutes per scale (defaults only).
- Offering to add a missing key.
- Reaching Technique before a first piece exists (the sidebar only appears
  once a piece exists).

## Build notes for every pass

- Use `NumberInput` for numeric fields.
- Use the lucide `Star` icon, not text star characters (they render
  off-center).
- Put CSS in the `App.jsx` CSS string with the existing tokens.
- Route sidebar navigation through `guardLeavingActiveWork`.
- Technique data never goes through `setPieces` or `updatePiece`.

## Decided

Each item has its own entry, with the alternative it rules out, in
[Decisions.md](Decisions.md#technique-practice).

1. **Piece links are by key** ("Other keys in this piece"), not by specific
   scale. Keys are matched **as written** (Pass 103 follow-up, on direct
   request): a piece in G♭ major tags G♭ major scales, not F♯ major. The
   key lists never show two separate enharmonic choices: each pair is one
   entry, "F♯/G♭ major" and "D♯/E♭ minor" (24 keys).
2. **Slow-tier numbers** (slowest third, 7-day cooldown) stay as starting
   values, to tune after real use.
3. **If a user stars very many scales the walk can starve**; accepted.
4. **A scale that is both repertoire and starred comes up 3–4 days a week,
   alternating weeks between 3 and 4.** This replaces the brief's original
   x5 cap (about every 5 days on a 24-day lap); confirmed by the user when
   Pass 98 was run, together with moving the whole repertoire/starred pace
   from exposure multipliers to days-a-week targets.
5. **Crowding at 3 tasks a day is accepted**; the priority order stands.
   Levers kept for later: scales per day, or repertoire pace per key.

No open questions remain.

## Mockup vs brief

Known differences between [the mockup](mockups/technique-practice.html) and
this brief, recorded so later passes don't rediscover them. **The brief is the
source for behavior; where the mockup adds detail the brief lacks, the mockup
is the source for layout and copy.**

### Where the mockup adds detail (mockup wins for layout and copy)

1. **Walk hint.** The Technique page's Today tab shows a walk hint under the
   panel heading: "Circle of fifths: D major today, B minor next."
2. **No saved tempo.** A card with no saved tempo shows "No starting tempo
   yet" and "Your first even-rhythm check sets one."
3. **Even-rhythm check copy.** The check reads "Play N octaves evenly, no
   rhythm variation. Your cleanest tempo becomes the new baseline." After
   **Log check** it says "Baseline updated to ♩ = X." After a bare check-off
   it says "Checked off without a tempo." plus "Baseline stays at ♩ = X."
   when one exists. The tempo field rejects an empty value or one under 30.
4. **Master Agenda.** A small "includes Nm technique" line sits under the
   Total planned number, with the panel directly below that banner. On
   Master Agenda and Daily Practice the panel's sub-line reads "Today's
   scales and arpeggios, about 5 minutes each. Checking one off here counts
   everywhere it appears."
5. **Library "rotation priority" sort.** In-rotation items first, then
   starred and repertoire-key items, then a blend of slowness (70%) and days
   since last checked (30%, capped at 21 days). Display-only, separate from
   the engine's tiers.
6. **Methods tab copy and messages.** The header "Practice methods", the "N
   methods · M on" count, the "Applies to" choices (Scales and arpeggios /
   Scales only / Arpeggios only / Hands together only), "Enter a name
   first", and Added "name". The mockup also supplies each built-in
   method's technique tag and one-line instructions.

### Where the brief and decisions win over the mockup

a. **Piece links.** The mockup's Settings offers "Other scales and arpeggios
   in this piece" as chips of specific library scales. [Decided](#decided)
   item 1 says by key, so the real field is **"Other keys in this piece"**.

b. **Library pace sentence.** The mockup's Library sentence reads "Starred
   scales come up about 3 days a week, and scales in a key from a piece you
   are playing about 4 days a week." When the brief still used exposure
   multipliers (x2 starred, x3 repertoire, x5 cap on a 24-day lap), this did
   not match the engine and was not to be copied. With the days-a-week pace
   confirmed in Pass 98 ([Decided](#decided) item 4), the sentence now
   matches for starred and repertoire scales but leaves out the "both" case.
   Real copy: "Starred scales come up about 3 days a week, and scales in a
   key from a piece you are playing about 4 days a week. A scale that is
   both comes up 3 or 4 days a week. A note icon marks those keys."

c. **Sample-only content.** The sample scales and pieces, and the "On track"
   status on Master Agenda, are sample data. The app's real status labels
   are Busy day / Moderate / Light / Nothing scheduled.

d. **Not in the mockup**, so specified by the brief's words alone: the Add
   scale or arpeggio form, the Wizard's key field, and the settings for
   scales per day and minutes per scale.
