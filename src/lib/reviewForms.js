import { loggedSessions } from "./utils";
import { sessionOutcome } from "./confidence";
import { HALF_PASS_CREDIT, PASS_TABLE_STAGES, addHalfPass } from "./ladder";

// Review model v2, rule 4 (Pass 141): transitions and combos stop being tasks of
// their own. For a piece on review model 2 a base chunk's RETURN takes a form in
// rotation: the chunk itself, a join (a transition) with a neighbour, and, for a
// Difficult chunk only, a combo. docs/Algorithms.md#review-model-v2-planned.
//
// Everything here is pure and reads only the piece's progress and the chunk set:
// the form of the next return is a derivation from what was logged, never a
// stored counter, so there is no new field on a chunk's progress entry. What IS
// stored is on the SESSION a return logs: `form` ("chunk", "join" or "combo"),
// and for a join or combo `partnerIds` (the neighbour chunks the form covers) and
// `partnerCredits` (what each neighbour was given, so Undo can take it back).
// A session logged before this pass has none of them and is never read as a return.

export const REVIEW_FORMS = ["chunk", "join", "combo"];

// A Difficult chunk goes chunk, join, combo; every other chunk goes chunk, join,
// chunk (the owner's rule, 2026-11-16).
export function reviewFormRotation(chunk) {
  return chunk && chunk.difficultyLabel === "hard" ? ["chunk", "join", "combo"] : ["chunk", "join", "chunk"];
}

// A return is a judged session logged from a review card on the new plan, which
// is the one kind of session that carries a `form`.
function returnSessions(entry) {
  return loggedSessions(entry && entry.sessions).filter((s) => REVIEW_FORMS.includes(s.form));
}

// Whether a chunk has been learned: anything logged, or a ladder stage. A
// neighbour must be introduced before a join or a combo can use it (a chunk with
// no ladder state could not be given credit anyway).
export function defaultIsIntroduced(progress) {
  return (id) => {
    const e = progress && progress[id];
    return !!e && (e.stage != null || loggedSessions(e.sessions).length > 0);
  };
}

// A chunk set with the three lists a form needs. Some callers hand over only
// `{ all }` (Daily Practice's due list and Week view build one from the chunk list
// they were given), and a function that reads `practiceChunks` from such a set finds
// nothing: Pass 141's first version did, and a piece on the new plan was told it had
// no review due. Any list that is missing is cut from `all` by kind; a complete set
// is returned as it is.
export function completeChunkSet(chunkSet) {
  if (!chunkSet) return chunkSet;
  if (chunkSet.practiceChunks && chunkSet.transitions && chunkSet.combos) return chunkSet;
  const all = chunkSet.all || [];
  return {
    ...chunkSet,
    all,
    practiceChunks: chunkSet.practiceChunks || all.filter((c) => c.kind === "section"),
    transitions: chunkSet.transitions || all.filter((c) => c.kind === "transition"),
    combos: chunkSet.combos || all.filter((c) => c.kind === "combo"),
  };
}

// Neighbours by measure boundary, never by array position: a rescheduled
// remainder's chunk list is a filtered subsequence with gaps (the lesson of
// Pass 89 in docs/AI-GUIDELINES.md).
export function neighbourChunks(chunk, practiceChunks) {
  const list = practiceChunks || [];
  return {
    prev: list.find((c) => c.end + 1 === chunk.start) || null,
    next: list.find((c) => c.start === chunk.end + 1) || null,
  };
}

// Where a chunk is in its rotation, replayed from its logged returns. The rotation
// moves only with Full passes, and a return that was not a Full pass is REPEATED as
// the plain chunk: that repeat is a make-up, not a step, so it does not move the
// rotation either way (a failed join leaves the join still to come, after the chunk
// has been played again).
//   pos       how many rotation steps have been passed
//   owed      the last return was not a Full pass, so the next one is the repeat
//   joinsDone how many join steps were passed (decides which side the next join uses)
export function rotationState(returns) {
  let pos = 0;
  let joinsDone = 0;
  let owed = false;
  returns.forEach((s) => {
    const passed = sessionOutcome(s) === "pass";
    if (owed) {
      // A repeat of the step that was not passed.
      if (passed) owed = false;
      return;
    }
    if (passed) {
      pos++;
      if (s.form === "join") joinsDone++;
    } else {
      owed = true;
    }
  });
  return { pos, owed, joinsDone };
}

// The form the chunk's NEXT return takes.
//
//   { form: "chunk" }
//   { form: "join",  partnerIds: [neighbourId], formChunk: <the transition>, side: "next" | "prev" }
//   { form: "combo", partnerIds: [prevId?, nextId?], formChunk: <the combo> }
//
// The sides of a join alternate, starting with the next chunk; a side with no
// neighbour, or whose neighbour is not introduced, gives way to the other side, and
// with neither the return is the chunk. A combo needs every neighbour it covers to be
// introduced, and the combo has to exist (two hard chunks with one range share one).
export function nextReviewForm(chunk, chunkSet, progress, isIntroduced = defaultIsIntroduced(progress)) {
  const plain = { form: "chunk", partnerIds: [], formChunk: chunk };
  if (!chunk || chunk.kind !== "section" || !chunkSet) return plain;
  chunkSet = completeChunkSet(chunkSet);
  const returns = returnSessions(progress && progress[chunk.id]);
  const { pos, owed, joinsDone } = rotationState(returns);
  if (owed) return plain;
  const rotation = reviewFormRotation(chunk);
  const wanted = rotation[pos % rotation.length];
  if (wanted === "chunk") return plain;

  const { prev, next } = neighbourChunks(chunk, chunkSet.practiceChunks);
  const transitions = chunkSet.transitions || [];
  if (wanted === "join") {
    const order = joinsDone % 2 === 0 ? ["next", "prev"] : ["prev", "next"];
    for (const side of order) {
      const other = side === "next" ? next : prev;
      if (!other || !isIntroduced(other.id)) continue;
      const id = side === "next" ? `t_${chunk.id}_${other.id}` : `t_${other.id}_${chunk.id}`;
      const join = transitions.find((t) => t.id === id);
      if (join) return { form: "join", partnerIds: [other.id], formChunk: join, side };
    }
    return plain;
  }
  // combo
  const combo = (chunkSet.combos || []).find((c) => c.id === `x_${chunk.id}`);
  if (!combo) return plain;
  const neighbours = [prev, next].filter(Boolean);
  if (neighbours.some((n) => !isIntroduced(n.id))) return plain;
  return { form: "combo", partnerIds: neighbours.map((n) => n.id), formChunk: combo };
}

// What a logged return does to the ladders (rule 4 and the owner's answers of
// 2026-11-21):
//  - chunk: nothing new, the ordinary session.
//  - join, a Full pass: the visiting chunk gets half a pass and its clock is
//    restarted like any return, but it cannot move up (a join is never a chunk's
//    own turn: only half of each chunk is played); its neighbour gets half a pass.
//  - join, anything else: no credit and no demotion, the ladder is not run at all
//    (one session cannot tell which of the two chunks it was).
//  - combo: the whole chunk is played, so for the visiting chunk it is an ordinary
//    session (it may move up, a Partial pass starts its count over, Needs rework
//    steps it back); each neighbour, only half played, gets half a pass on a Full
//    pass and nothing otherwise.
// Half credit goes through `addHalfPass` and so never promotes anyone.
export function formCreditPlan(form, result) {
  if (form === "join") {
    if (result !== "pass") return { runLadder: false, visitorMaxCredit: null, visitorCanPromote: null, partnerCredit: 0 };
    return { runLadder: true, visitorMaxCredit: HALF_PASS_CREDIT, visitorCanPromote: false, partnerCredit: HALF_PASS_CREDIT };
  }
  if (form === "combo") {
    return { runLadder: true, visitorMaxCredit: null, visitorCanPromote: null, partnerCredit: result === "pass" ? HALF_PASS_CREDIT : 0 };
  }
  return { runLadder: true, visitorMaxCredit: null, visitorCanPromote: null, partnerCredit: 0 };
}

// The ladder context for the visiting chunk's own session, with the form's
// limits laid over what ladderContextFor gave (null stays null: a piece on
// today's plan never reaches here with a form).
export function contextForForm(ladderContext, plan) {
  if (!ladderContext) return ladderContext;
  return {
    ...ladderContext,
    ...(plan.visitorMaxCredit != null ? { maxCredit: ladderContext.maxCredit != null ? Math.min(ladderContext.maxCredit, plan.visitorMaxCredit) : plan.visitorMaxCredit } : {}),
    ...(plan.visitorCanPromote === false ? { canPromote: false } : {}),
  };
}

// Gives each partner chunk its half pass. Returns the new progress map and the
// credits actually given (a partner with no ladder state, or in Holding, is given
// nothing and listed nowhere, so Undo never takes back what was not added).
export function applyPartnerCredits(progress, partnerIds, credit) {
  const next = { ...progress };
  const given = [];
  (partnerIds || []).forEach((id) => {
    const entry = next[id];
    if (!entry || credit <= 0) return;
    if (!PASS_TABLE_STAGES.includes(entry.stage)) return;
    const updated = addHalfPass({ stage: entry.stage, consecutivePasses: entry.consecutivePasses }, credit);
    if (updated.consecutivePasses === (entry.consecutivePasses || 0)) return;
    next[id] = { ...entry, consecutivePasses: updated.consecutivePasses };
    given.push({ id, credit });
  });
  return { progress: next, given };
}

// Undo of a join or combo: takes back what that session gave each neighbour, but
// only where the neighbour has logged nothing since (its count may since have been
// spent on a move up or reset by a Partial pass, and rewinding it would then undo
// work that is not this session's). A neighbour that has moved on keeps its credit.
// Returns the new progress map and the ids it could not take back.
export function reversePartnerCredits(progress, session) {
  const next = { ...progress };
  const kept = [];
  const credits = (session && session.partnerCredits) || [];
  credits.forEach(({ id, credit }) => {
    const entry = next[id];
    if (!entry) return;
    const movedOn = loggedSessions(entry.sessions).some((s) => (s.loggedAt || 0) > (session.loggedAt || 0));
    if (movedOn) {
      kept.push(id);
      return;
    }
    next[id] = { ...entry, consecutivePasses: Math.max(0, (entry.consecutivePasses || 0) - credit) };
  });
  return { progress: next, kept };
}

// Price of the chunk's next return, as an effort: the form's own measures, the
// way a join's first appearance is priced as a review and not as new material
// (decided 2026-11-16). Used by the plan's day totals, the due list and the card.
export function nextReturnEffort(chunk, chunkSet, progress) {
  const form = nextReviewForm(chunk, chunkSet, progress);
  const e = form.formChunk && Number(form.formChunk.effort);
  return Number.isFinite(e) && e > 0 ? e : chunk.effort;
}

// Whether a review card for this chunk on `date` is a RETURN (on or after the
// earliest day of its window) rather than the next-day touch, which sits before
// it. Only a return takes a form; the touch is always the plain chunk.
export function isReturnDue(entry, date) {
  return !!entry && entry.stage != null && !!entry.nextDueDate && !!date && date >= entry.nextDueDate;
}

// Everything a session handler needs to know about the form a return was logged
// in, in one pure function so the app and the simulation harness share it: the
// form (null unless the piece is on review model 2 and a known form was sent),
// what the ladders do about it (`plan`), the neighbours it covers, the progress
// map with their half passes already added, and the fields the session record
// carries. `progress` is the map before this session; it is not changed.
export function prepareReturn({ onModelTwo, chunkId, progress, outcome, sentForm, sentPartnerIds }) {
  const form = onModelTwo && REVIEW_FORMS.includes(sentForm) ? sentForm : null;
  const plan = formCreditPlan(form, outcome);
  const partnerIds = form && form !== "chunk" ? (sentPartnerIds || []).filter((id) => id !== chunkId && progress[id]) : [];
  const credited = applyPartnerCredits(progress, partnerIds, plan.partnerCredit);
  const formFields = form
    ? { form, ...(form !== "chunk" ? { partnerIds, ...(credited.given.length ? { partnerCredits: credited.given } : {}) } : {}) }
    : {};
  return { form, plan, partnerIds, progress: credited.progress, formFields };
}
