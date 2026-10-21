// Pass 121 follow-up: the walk through ONE held piece's questions, as plain data.
//
// lib/accountSync.js makes the questions (planSettle / buildSettleQuestions) and does
// the applying (applyAccountMerge). This is the part in between that used to live in
// App.jsx where nothing can be tested: which screen comes next, what Back does, what
// the summary says before anything is applied, and what to do when the account moved
// on while the person was deciding. The component only draws what settleView says.
//
//   state = { stage, index, answers, bulk, notice }
//     stage    "bulk"      the first screen, only for a piece with BULK_MIN or more practice
//                          records that were changed on both devices (answer them all at once)
//              "question"  one question at a time (`index` is the position among the
//                          questions still to ask)
//              "recap"     what will be kept, and what will be removed, before anything is applied
//              "ready"     nothing left to decide; waits for the person to say go
//     answers  { [part]: option value }
//     bulk     null | "all" | "each"   the first screen's answer
//     notice   a sentence shown above the screen (why it is being asked again, a failure), or null
//
// Nothing here changes anything: choosing, Next and Back only move through the screens.
// The one moment something is applied is `settleNext(...).applies === true`, from the
// summary (or "ready") screen, and the caller then reads the account again first
// (rereadSettleItem) so the answers are never applied to a copy that has since moved on.

import { accountRowsToCandidates, planSettle, answeredAll } from "./accountSync";

// Fewer practice records than this are simply asked one by one.
export const BULK_MIN = 3;
export const BULK_PART = "__bulk__";

const hasOption = (q, value) => !!q && q.options.some((o) => o.value === value);
const upperFirst = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);

// The practice-record questions that offer "both devices' sessions": the ones the first
// screen can answer together.
export function bulkParts(questions) {
  return (questions || []).filter((q) => q.kind === "progress" && hasOption(q, "both")).map((q) => q.part);
}

export function hasBulkStep(item) {
  return !!item && bulkParts(item.questions).length >= BULK_MIN;
}

// The questions still to ask one at a time: all of them, less the ones the first screen
// answered for the whole group.
export function questionsToAsk(item, state) {
  if (!state || state.bulk !== "all") return item.questions;
  const grouped = new Set(bulkParts(item.questions));
  return item.questions.filter((q) => !grouped.has(q.part));
}

export function startSettle(item, notice = null) {
  const stage = item.status !== "questions" ? "ready" : hasBulkStep(item) ? "bulk" : "question";
  return { stage, index: 0, answers: {}, bulk: null, notice };
}

// Choose an option on the screen that is showing (the first screen's, or the current
// question's). A value that is not one of that screen's options changes nothing.
export function settleChoose(item, state, value) {
  if (state.stage === "bulk") {
    if (value !== "all" && value !== "each") return state;
    if (value === state.bulk) return state;
    const answers = { ...state.answers };
    bulkParts(item.questions).forEach((part) => {
      // "all" answers the whole group; going back to "each" clears what "all" filled in,
      // so nothing the person did not choose stays chosen
      if (value === "all") answers[part] = "both";
      else delete answers[part];
    });
    return { ...state, bulk: value, answers };
  }
  if (state.stage === "question") {
    const q = questionsToAsk(item, state)[state.index];
    if (!hasOption(q, value)) return state;
    return { ...state, answers: { ...state.answers, [q.part]: value } };
  }
  return state;
}

export function settleCanNext(item, state) {
  if (state.stage === "bulk") return state.bulk !== null;
  if (state.stage === "question") {
    const q = questionsToAsk(item, state)[state.index];
    return hasOption(q, state.answers[q && q.part]);
  }
  if (state.stage === "recap") return answeredAll(item.questions, state.answers);
  return state.stage === "ready";
}

// Where Back goes: the previous question, the first screen if there was one, or nowhere
// (the same state comes back).
export function settleBack(item, state) {
  if (state.stage === "question") {
    if (state.index > 0) return { ...state, index: state.index - 1, notice: null };
    return hasBulkStep(item) ? { ...state, stage: "bulk", notice: null } : state;
  }
  if (state.stage === "recap") {
    const rest = questionsToAsk(item, state);
    if (rest.length > 0) return { ...state, stage: "question", index: rest.length - 1, notice: null };
    return hasBulkStep(item) ? { ...state, stage: "bulk", notice: null } : state;
  }
  return state;
}

export const settleCanBack = (item, state) => settleBack(item, state) !== state;

// The next screen, or (applies: true) the moment to apply. Moving to a screen never
// applies anything.
export function settleNext(item, state) {
  if (!settleCanNext(item, state)) return { state, applies: false };
  if (state.stage === "bulk") {
    return { state: { ...state, stage: questionsToAsk(item, state).length > 0 ? "question" : "recap", index: 0, notice: null }, applies: false };
  }
  if (state.stage === "question") {
    const rest = questionsToAsk(item, state);
    return state.index + 1 < rest.length
      ? { state: { ...state, index: state.index + 1, notice: null }, applies: false }
      : { state: { ...state, stage: "recap", notice: null }, applies: false };
  }
  return { state, applies: true };
}

// What was kept, one phrase per question in the order asked ("this device's target
// date"). The questions the first screen answered together are one phrase. (accountSync's
// describeKept is the same without the group.)
export function keptPhrases(item, state) {
  const grouped = state.bulk === "all" ? new Set(bulkParts(item.questions)) : new Set();
  const out = [];
  let groupedDone = false;
  item.questions.forEach((q) => {
    if (grouped.has(q.part)) {
      if (!groupedDone) out.push(`both devices' sessions for all ${grouped.size} practice records`);
      groupedDone = true;
      return;
    }
    const phrase = q.kept && q.kept[state.answers[q.part]];
    if (phrase) out.push(phrase);
  });
  return out;
}

// What the chosen answers throw away, in the words of the option that was chosen. Only
// answers flagged `removes` (accountSync's removalHint and the whole-piece question).
export function removalWarnings(item, state) {
  const out = [];
  item.questions.forEach((q) => {
    const chosen = q.options.find((o) => o.value === state.answers[q.part]);
    if (!chosen || !chosen.removes || !chosen.hint) return;
    out.push(q.target ? `For ${q.target}: ${lowerFirst(chosen.hint)}` : chosen.hint);
  });
  return out;
}

const INTRO_ASKING =
  "This piece was changed on both of your devices since you last synced. Nothing changes until the last step, and Decide later leaves it exactly as it is.";

// The first screen, drawn like any other question.
function bulkQuestion(item) {
  const n = bulkParts(item.questions).length;
  return {
    part: BULK_PART,
    kind: "bulk",
    title: "Practice records",
    text: `You practiced ${n} parts of this piece on both devices since you last synced.`,
    options: [
      {
        value: "all",
        label: `Both devices' sessions for all ${n}`,
        recommended: true,
        hint: "Every session from both devices is kept. The rest of each record (tempo, stage, next review) follows whichever device practiced last.",
      },
      { value: "each", label: "Decide each one", hint: `You will be asked about the ${n} one at a time.` },
    ],
  };
}

// Everything the screen needs, nothing it has to work out:
//   stage, notice, intro, stepLabel (or null), primaryLabel, canNext, canBack, applies
//   question, answer   the question to draw and its chosen value (bulk and question stages)
//   recap              { keeps: [sentence], warnings: [sentence] } (recap stage)
export function settleView(item, state) {
  const stage = state.stage;
  const view = {
    stage,
    notice: state.notice || null,
    intro: INTRO_ASKING,
    stepLabel: null,
    primaryLabel: "Next",
    canNext: settleCanNext(item, state),
    canBack: settleCanBack(item, state),
    applies: stage === "recap" || stage === "ready",
    question: null,
    answer: null,
    recap: null,
  };
  if (stage === "bulk") {
    view.question = bulkQuestion(item);
    view.answer = state.bulk;
  } else if (stage === "question") {
    const rest = questionsToAsk(item, state);
    const q = rest[state.index] || null;
    view.question = q;
    view.answer = q ? state.answers[q.part] || null : null;
    view.stepLabel = `Question ${state.index + 1} of ${rest.length}`;
  } else if (stage === "recap") {
    view.intro = "Nothing has changed yet. Settle this piece applies these choices, and Decide later leaves everything exactly as it is.";
    view.stepLabel = "Last step";
    view.primaryLabel = "Settle this piece";
    view.recap = { keeps: keptPhrases(item, state).map(upperFirst), warnings: removalWarnings(item, state) };
  } else {
    view.intro = "Nothing is left to decide for this piece: the copy on this device and the copy in your account fit together now.";
    view.primaryLabel = "Bring it up to date";
  }
  return view;
}

/* ---- the account moved on while the person was deciding ---------------- */

// Are these the same questions, down to the numbers in their wording? The answers given
// to one mean the same thing for the other only if so: a hint that counts the sessions
// that would be removed changes when another session is logged.
export function sameSettleQuestions(a, b) {
  const plain = (questions) =>
    (questions || []).map((q) => ({
      part: q.part,
      kind: q.kind,
      title: q.title,
      text: q.text,
      detail: q.detail || null,
      options: q.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint || null, removes: !!o.removes })),
    }));
  return JSON.stringify(plain(a)) === JSON.stringify(plain(b));
}

// The account was read again (`fresh` is the piece planned afresh from that row and from
// the copies on this device right now, or null when it cannot be asked about any more):
//   "apply"  nothing the person decided on has changed: go ahead, with the fresh row
//   "again"  the questions are different now: ask from the start, saying why. Nothing was applied.
//   "gone"   the piece is no longer waiting to be settled
export function decideAfterReread(item, fresh) {
  if (!fresh || !fresh.candidate) return { outcome: "gone" };
  // (no separate check of "questions" against "ready": a piece with nothing to decide has no
  // questions, so the comparison below already tells them apart)
  if (sameSettleQuestions(item.questions, fresh.questions)) return { outcome: "apply", item: fresh };
  return {
    outcome: "again",
    item: fresh,
    notice:
      fresh.status === "ready"
        ? "Something changed while you were deciding, and nothing is left to decide now. Your earlier choices were cleared and nothing was changed."
        : "Something changed while you were deciding, so the questions are asked again. Your earlier choices were cleared and nothing was changed.",
  };
}

// Plans the one piece again from the account's row as it is NOW and the copies on this
// device as they are NOW, and decides (decideAfterReread). `rows` is what
// fetchChangedAccountRows returned: { pieces: [row], technique: null }. Pure.
export function rereadSettleItem({ item, rows, localPieces, accountRecord, now = Date.now() }) {
  const candidates = accountRowsToCandidates({ pieces: (rows && rows.pieces) || [], technique: null });
  const plan = planSettle({ candidates, localPieces, accountRecord, now, ids: [item.id] });
  const row = candidates.pieces.find((c) => c.id === item.id);
  const fresh = plan.items[0] && row ? { ...plan.items[0], candidate: row } : null;
  return decideAfterReread(item, fresh);
}
