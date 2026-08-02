# MeasureOne Documentation

This directory is the canonical, long-term knowledge base for MeasureOne —
product vision, design philosophy, algorithms, data model, architecture, and
decision history. It's written to serve four audiences: future Claude Code
sessions, human developers, future-you months or years from now, and any
collaborator who joins the project cold.

For code-level operating instructions (how to run the app, conventions to
follow while editing, gotchas) see [`../CLAUDE.md`](../CLAUDE.md) at the repo
root — that file is what Claude Code auto-loads every session. This
directory is the deeper reference it points into.

## Reading order

**If you're new to the project**, read in this order:
[Vision.md](Vision.md) → [Product-Principles.md](Product-Principles.md) →
[UX-Principles.md](UX-Principles.md) → [User-Flows.md](User-Flows.md).
That's the "what and why" layer. Go to [Data-Model.md](Data-Model.md) and
[Algorithms.md](Algorithms.md) when you need the "how."

**If you're an AI assistant about to make a change**, read
[AI-GUIDELINES.md](AI-GUIDELINES.md) first — it tells you which of the other
documents to consult for which kind of change.

**If you just want to know what to work on next**, go straight to
[Roadmap.md](Roadmap.md).

## Document map

| Document | Answers |
|---|---|
| [Vision.md](Vision.md) | What is MeasureOne for, and what is it deliberately not? |
| [Product-Principles.md](Product-Principles.md) | What rules govern whether a feature belongs? |
| [UX-Principles.md](UX-Principles.md) | How should things look, feel, and behave? |
| [User-Flows.md](User-Flows.md) | What does a user actually click through, end to end? |
| [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md) | What happens to a piece over its full life in the app — including the parts not built yet? |
| [Data-Model.md](Data-Model.md) | What data exists, and what does each field/concept mean? |
| [Algorithms.md](Algorithms.md) | How is each computed value actually calculated? |
| [Research.md](Research.md) | Which numbers are hand-tuned vs. evidence-backed, and what's still unknown? |
| [Architecture.md](Architecture.md) | How is the code organized, and how should it be split up? |
| [Decisions.md](Decisions.md) | Why were things built this way, and what was rejected? |
| [Roadmap.md](Roadmap.md) | What's done, what's next, in what order? |
| [AI-GUIDELINES.md](AI-GUIDELINES.md) | How should an AI assistant work in this project? |

## How this is meant to stay useful

Every document above states its own purpose, audience, scope, and related
documents at the top, and says when it should be updated. Each concept has
exactly one canonical home — if you find the same explanation in two places,
that's a bug in the documentation; collapse it to one and link from the
other. See [AI-GUIDELINES.md](AI-GUIDELINES.md#avoid-duplicate-documentation).

## Provenance note

This `docs/` set was created from a documentation audit (see
[Decisions.md](Decisions.md#documentation)) that found two prior sources of
truth: `CLAUDE.md` (implementation-focused, in-repo) and a
`measureone-context-summary.md` file that held real product-decision history
but lived outside the repository entirely, in a local Downloads folder,
invisible to anyone working from the repo alone. Its content has been folded
into this directory — primarily [Decisions.md](Decisions.md) and
[Roadmap.md](Roadmap.md) — and should be treated as superseded going
forward; nothing should be assumed to live only in that external file
anymore.
