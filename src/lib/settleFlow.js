// Pass 121 follow-up: the walk through ONE held piece's questions, as plain data.
//
// lib/accountSync.js makes the questions (planSettle / buildSettleQuestions) and does
// the applying (applyAccountMerge). This is the part in between that used to live in
// App.jsx where nothing can be tested: which screen comes next, what Back does, what
// the summary says before anything is applied, and what to do when the account moved
// on while the person was deciding. The component only draws what settleView says.
//
//   state = { stage, index, answers, notice }
//     stage    "question"  one question at a time (`index` is the position among the questions)
//              "recap"     what will be kept, and what will be removed, before anything is applied
//              "ready"     nothing left to decide; waits for the person to say go
//     answers  { [part]: option value }
//     notice   a sentence shown above the screen (why it is being asked again, a failure), or null
//
// Nothing here changes anything: choosing, Next and Back only move through the screens.
// The one moment something is applied is `settleNext(...).applies === true`, from the
// summary (or "ready") screen, and the caller then reads the account again first
// (rereadSettleItem) so the answers are never applied to a copy that has since moved on.
//
// (Until 2026-10-31 there was also a first screen, "bulk", for three or more practice records
// changed on both devices. Since Pass 126 the engine combines practice both devices logged, so
// no such question is ever asked and the screen was deleted on the owner's word.)

import { accountRowsToCandidates, planSettle, answeredAll, describeKept } from "./accountSync";

const hasOption = (q, value) => !!q && q.options.some((o) => o.value === value);
const upperFirst = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export function startSettle(item, notice = null) {
  return { stage: item.status !== "questions" ? "ready" : "question", index: 0, answers: {}, notice };
}

// Choose an option on the question that is showing. A value that is not one of its
// options changes nothing.
export function settleChoose(item, state, value) {
  if (state.stage !== "question") return state;
  const q = item.questions[state.index];
  if (!hasOption(q, value)) return state;
  return { ...state, answers: { ...state.answers, [q.part]: value } };
}

export function settleCanNext(item, state) {
  if (state.stage === "question") {
    const q = item.questions[state.index];
    return hasOption(q, state.answers[q && q.part]);
  }
  if (state.stage === "recap") return answeredAll(item.questions, state.answers);
  return state.stage === "ready";
}

// Where Back goes: the previous question, the last question from the summary, or nowhere
// (the same state comes back).
export function settleBack(item, state) {
  if (state.stage === "question") return state.index > 0 ? { ...state, index: state.index - 1, notice: null } : state;
  if (state.stage === "recap" && item.questions.length > 0) return { ...state, stage: "question", index: item.questions.length - 1, notice: null };
  return state;
}

export const settleCanBack = (item, state) => settleBack(item, state) !== state;

// The next screen, or (applies: true) the moment to apply. Moving to a screen never
// applies anything.
export function settleNext(item, state) {
  if (!settleCanNext(item, state)) return { state, applies: false };
  if (state.stage === "question") {
    return state.index + 1 < item.questions.length
      ? { state: { ...state, index: state.index + 1, notice: null }, applies: false }
      : { state: { ...state, stage: "recap", notice: null }, applies: false };
  }
  return { state, applies: true };
}

// What was kept, one phrase per question in the order asked ("this device's target date").
export function keptPhrases(item, state) {
  return describeKept(item.questions, state.answers);
}

// What the chosen answers throw away, in the words of the option that was chosen. Only
// answers flagged `removes` (the whole-piece question: the chunk layout changed on one
// device while the other logged practice or a reschedule, so one side's piece goes).
export function removalWarnings(item, state) {
  const out = [];
  item.questions.forEach((q) => {
    const chosen = q.options.find((o) => o.value === state.answers[q.part]);
    if (chosen && chosen.removes && chosen.hint) out.push(chosen.hint);
  });
  return out;
}

const INTRO_ASKING =
  "This piece was changed on both of your devices since you last synced. Nothing changes until the last step, and Decide later leaves it exactly as it is.";

// Everything the screen needs, nothing it has to work out:
//   stage, notice, intro, stepLabel (or null), primaryLabel, canNext, canBack, applies
//   question, answer   the question to draw and its chosen value (question stage)
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
  if (stage === "question") {
    const q = item.questions[state.index] || null;
    view.question = q;
    view.answer = q ? state.answers[q.part] || null : null;
    view.stepLabel = `Question ${state.index + 1} of ${item.questions.length}`;
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
// to one mean the same thing for the other only if so: a value in the wording of a question
// changes when the other device changes it again.
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
