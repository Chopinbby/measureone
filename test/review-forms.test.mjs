// Pass 141: transitions and combos become review forms (review model 2, rule 4).
// docs/Algorithms.md#review-model-v2-planned. The rotation, the credit each form
// gives, Undo, and what no longer reads transitions and combos for a piece on the
// new plan. A piece on today's plan is checked byte for byte by the recorded
// timelines in test/review-windows.test.mjs (Pass 140) and the recorded ladder
// cases in test/ladder-table.test.mjs (Pass 139).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateAllChunks } from "../src/lib/chunking.js";
import { computeTimeline, computeRemainingConnectorIds, isPlanActuallyComplete } from "../src/lib/scheduling.js";
import { computeDueReviews, computeDueOnDate } from "../src/lib/maintenance.js";
import { addHalfPass } from "../src/lib/ladder.js";
import {
  nextReviewForm,
  reviewFormRotation,
  formCreditPlan,
  contextForForm,
  prepareReturn,
  applyPartnerCredits,
  reversePartnerCredits,
  nextReturnEffort,
  isReturnDue,
  neighbourChunks,
} from "../src/lib/reviewForms.js";
import { unionProgressEntries } from "../src/lib/pieceMerge.js";
import { completeChunkSet } from "../src/lib/reviewForms.js";
import { START, dateOfDay, makePiece, logSession } from "./review-sim-helper.mjs";

// A piece on the new plan with every chunk learned on day 1 (so every neighbour is introduced).
function learnedPiece({ N = 48, mix = "balanced (50/25/25)", D = 30, reviewModel = 2 } = {}) {
  let p = makePiece({ N, mix, D, reviewModel });
  const cs = generateAllChunks(p);
  cs.practiceChunks.forEach((c) => {
    p = logSession(p, generateAllChunks(p), c.id, 1, dateOfDay(1));
  });
  return p;
}

// One return of a chunk in whatever form the rotation says, logged as the app logs it.
// `day` is far enough on that the return is on or after its window opened.
function doReturn(p, id, day, result = "pass") {
  const cs = generateAllChunks(p);
  const chunk = cs.practiceChunks.find((c) => c.id === id);
  const f = nextReviewForm(chunk, cs, p.progress);
  return { p: logSession(p, cs, id, day, dateOfDay(day), { result, form: f.form, partnerIds: f.partnerIds }), f };
}

function middleChunk(cs, label) {
  const list = cs.practiceChunks;
  for (let i = 1; i < list.length - 1; i++) if (!label || list[i].difficultyLabel === label) return list[i];
  return null;
}
function middleNotHard(cs) {
  const list = cs.practiceChunks;
  for (let i = 1; i < list.length - 1; i++) if (list[i].difficultyLabel !== "hard") return list[i];
  return null;
}

describe("[Pass 141] the rotation", () => {
  test("a Difficult chunk goes chunk, join, combo; any other goes chunk, join, chunk", () => {
    assert.deepEqual(reviewFormRotation({ difficultyLabel: "hard" }), ["chunk", "join", "combo"]);
    assert.deepEqual(reviewFormRotation({ difficultyLabel: "medium" }), ["chunk", "join", "chunk"]);
    assert.deepEqual(reviewFormRotation({ difficultyLabel: "easy" }), ["chunk", "join", "chunk"]);
  });

  test("the forms a Difficult chunk's returns take, in order, and a non-Difficult chunk's", () => {
    let p = learnedPiece();
    const cs = generateAllChunks(p);
    const hard = middleChunk(cs, "hard");
    const other = middleNotHard(cs);
    assert.ok(hard && other, "setup: both kinds of chunk have two neighbours");
    const seen = { hard: [], other: [] };
    let day = 40;
    for (let i = 0; i < 6; i++) {
      const a = doReturn(p, hard.id, day);
      p = a.p;
      seen.hard.push(a.f.form);
      const b = doReturn(p, other.id, day);
      p = b.p;
      seen.other.push(b.f.form);
      day += 40;
    }
    assert.deepEqual(seen.hard, ["chunk", "join", "combo", "chunk", "join", "combo"]);
    assert.deepEqual(seen.other, ["chunk", "join", "chunk", "chunk", "join", "chunk"]);
  });

  test("the sides of a join alternate, starting with the next chunk, and the join is the transition between the two", () => {
    let p = learnedPiece();
    const cs = generateAllChunks(p);
    const c = middleNotHard(cs);
    const { prev, next } = neighbourChunks(c, cs.practiceChunks);
    const sides = [];
    let day = 40;
    for (let i = 0; i < 6; i++) {
      const r = doReturn(p, c.id, day);
      p = r.p;
      if (r.f.form === "join") {
        sides.push(r.f.side);
        assert.deepEqual(r.f.partnerIds, [r.f.side === "next" ? next.id : prev.id]);
        assert.equal(r.f.formChunk.kind, "transition");
        assert.equal(r.f.formChunk.id, r.f.side === "next" ? `t_${c.id}_${next.id}` : `t_${prev.id}_${c.id}`);
      }
      day += 40;
    }
    assert.deepEqual(sides, ["next", "prev"]);
  });

  test("a chunk at the edge of the piece joins with the one neighbour it has", () => {
    let p = learnedPiece();
    const cs = generateAllChunks(p);
    const first = cs.practiceChunks[0];
    const sides = [];
    let day = 40;
    for (let i = 0; i < 9; i++) {
      const r = doReturn(p, first.id, day);
      p = r.p;
      if (r.f.form === "join") sides.push(r.f.side);
      day += 40;
    }
    assert.ok(sides.length >= 2);
    assert.ok(sides.every((s) => s === "next"), "the first chunk has no previous neighbour");
  });

  test("a neighbour that is not introduced yet gets no join: the return is the chunk", () => {
    let p = makePiece({ N: 48, mix: "balanced (50/25/25)", D: 30, reviewModel: 2 });
    const cs = generateAllChunks(p);
    const c = middleNotHard(cs);
    p = logSession(p, cs, c.id, 1, dateOfDay(1)); // only this chunk was ever logged
    const a = doReturn(p, c.id, 40);
    assert.equal(a.f.form, "chunk");
    const b = doReturn(a.p, c.id, 80);
    assert.equal(b.f.form, "chunk", "its turn for a join, but neither neighbour is introduced");
    assert.deepEqual(b.f.partnerIds, []);
  });

  test("a combo needs every neighbour it covers to be introduced", () => {
    let p = makePiece({ N: 48, mix: "balanced (50/25/25)", D: 30, reviewModel: 2 });
    const cs = generateAllChunks(p);
    const hard = middleChunk(cs, "hard");
    const { prev } = neighbourChunks(hard, cs.practiceChunks);
    // The chunk and ONE neighbour are learned: a join is possible, the combo is not.
    p = logSession(p, cs, hard.id, 1, dateOfDay(1));
    p = logSession(p, generateAllChunks(p), prev.id, 1, dateOfDay(1));
    let r = doReturn(p, hard.id, 40);
    assert.equal(r.f.form, "chunk");
    r = doReturn(r.p, hard.id, 80);
    assert.equal(r.f.form, "join");
    assert.deepEqual(r.f.partnerIds, [prev.id], "the next chunk is not introduced, so the previous one is used");
    r = doReturn(r.p, hard.id, 120);
    assert.equal(r.f.form, "chunk", "third return would be a combo, but the next chunk is not introduced");
  });

  test("a return that was not a Full pass is repeated as the plain chunk, and the rotation moves only with Full passes", () => {
    let p = learnedPiece();
    const c = middleChunk(generateAllChunks(p), "hard");
    let r = doReturn(p, c.id, 40); // chunk, pass
    assert.equal(r.f.form, "chunk");
    r = doReturn(r.p, c.id, 80, "soft-miss"); // join, Partial pass
    assert.equal(r.f.form, "join");
    r = doReturn(r.p, c.id, 120); // repeated as the chunk
    assert.equal(r.f.form, "chunk");
    r = doReturn(r.p, c.id, 160); // a Full pass moves the rotation: the join comes round again
    assert.equal(r.f.form, "join");
  });

  test("a chunk with no return yet, and a session logged before this pass, are plain chunk returns", () => {
    const p = learnedPiece();
    const cs = generateAllChunks(p);
    const c = middleChunk(cs);
    assert.equal(nextReviewForm(c, cs, p.progress).form, "chunk");
    assert.equal(nextReviewForm(c, cs, {}).form, "chunk");
    assert.equal(nextReviewForm(cs.transitions[0], cs, p.progress).form, "chunk", "only a base chunk takes a form");
  });

  test("the next-day touch is not a return: only on or after the window's earliest day", () => {
    assert.equal(isReturnDue(null, "2026-01-10"), false);
    assert.equal(isReturnDue({ stage: null, nextDueDate: "2026-01-05" }, "2026-01-10"), false);
    assert.equal(isReturnDue({ stage: "stabilizing", nextDueDate: "2026-01-05" }, "2026-01-04"), false);
    assert.equal(isReturnDue({ stage: "stabilizing", nextDueDate: "2026-01-05" }, "2026-01-05"), true);
  });
});

describe("[Pass 141] what each form credits", () => {
  const credit = (form, result) => formCreditPlan(form, result);

  test("the plan: chunk is as it was; a Full pass join credits half each and cannot promote; a join that is not a Full pass runs no ladder; a combo is the chunk's own turn", () => {
    assert.deepEqual(credit("chunk", "pass"), { runLadder: true, visitorMaxCredit: null, visitorCanPromote: null, partnerCredit: 0 });
    assert.deepEqual(credit("join", "pass"), { runLadder: true, visitorMaxCredit: 0.5, visitorCanPromote: false, partnerCredit: 0.5 });
    assert.equal(credit("join", "soft-miss").runLadder, false);
    assert.equal(credit("join", "fail").runLadder, false);
    assert.deepEqual(credit("combo", "pass"), { runLadder: true, visitorMaxCredit: null, visitorCanPromote: null, partnerCredit: 0.5 });
    assert.equal(credit("combo", "soft-miss").partnerCredit, 0);
    assert.equal(credit("combo", "fail").partnerCredit, 0);
  });

  test("a Full pass on a join gives the chunk and its neighbour half a pass each and records it on the session", () => {
    let p = learnedPiece();
    const cs = generateAllChunks(p);
    const c = middleNotHard(cs);
    p = doReturn(p, c.id, 40).p; // the chunk return
    const before = JSON.parse(JSON.stringify(p.progress));
    const r = doReturn(p, c.id, 80);
    assert.equal(r.f.form, "join");
    const partner = r.f.partnerIds[0];
    const e = r.p.progress[c.id];
    assert.equal(e.consecutivePasses, (before[c.id].consecutivePasses || 0) + 0.5);
    assert.equal(e.stage, before[c.id].stage, "a join never moves a chunk up");
    assert.equal(r.p.progress[partner].consecutivePasses, (before[partner].consecutivePasses || 0) + 0.5);
    assert.equal(r.p.progress[partner].stage, before[partner].stage);
    assert.equal((r.p.progress[partner].sessions || []).length, (before[partner].sessions || []).length, "the neighbour gets credit, not a session");
    assert.notEqual(e.nextDueDate, before[c.id].nextDueDate, "the visiting chunk's clock restarts like any return");
    assert.equal(r.p.progress[partner].nextDueDate, before[partner].nextDueDate, "the neighbour's dates are untouched");
    const s = e.sessions[e.sessions.length - 1];
    assert.equal(s.form, "join");
    assert.deepEqual(s.partnerIds, [partner]);
    assert.deepEqual(s.partnerCredits, [{ id: partner, credit: 0.5 }]);
  });

  test("[regression, Pass 141] a join never moves a chunk up, even with enough passes; its next own turn does", () => {
    // Re-break this on purpose by letting a join promote (formCreditPlan's visitorCanPromote).
    let p = learnedPiece();
    const c = middleNotHard(generateAllChunks(p));
    p = doReturn(p, c.id, 40).p; // chunk
    const stage = p.progress[c.id].stage;
    // Give it far more passes than its stage needs.
    p = { ...p, progress: { ...p.progress, [c.id]: { ...p.progress[c.id], consecutivePasses: 9 } } };
    let r = doReturn(p, c.id, 80);
    assert.equal(r.f.form, "join");
    assert.equal(r.p.progress[c.id].stage, stage, "held back");
    assert.equal(r.p.progress[c.id].consecutivePasses, 9.5);
    r = doReturn(r.p, c.id, 120); // the chunk's own turn
    assert.equal(r.f.form, "chunk");
    assert.notEqual(r.p.progress[c.id].stage, stage, "moved up on its own turn");
  });

  test("a join that was a Partial pass or Needs rework gives no credit and demotes nothing: no ladder field changes", () => {
    for (const result of ["soft-miss", "fail"]) {
      let p = learnedPiece();
      const c = middleNotHard(generateAllChunks(p));
      p = doReturn(p, c.id, 40).p;
      const before = JSON.parse(JSON.stringify(p.progress));
      const r = doReturn(p, c.id, 80, result);
      assert.equal(r.f.form, "join");
      const partner = r.f.partnerIds[0];
      const was = before[c.id];
      const now = r.p.progress[c.id];
      for (const k of ["stage", "consecutivePasses", "consecutiveStabilizingFails", "practiceBPM", "nextDueDate", "dueByDate", "needsRelearning", "tempoRatchetK", "holdingReviewCount"]) {
        assert.deepEqual(now[k], was[k], `${result}: ${k} unchanged`);
      }
      assert.deepEqual(JSON.parse(JSON.stringify(r.p.progress[partner])), before[partner], `${result}: the neighbour is untouched`);
      assert.equal(now.sessions.length, was.sessions.length + 1, "the session is still recorded");
      assert.ok(now.doneDays.includes(80));
      const s = now.sessions[now.sessions.length - 1];
      assert.equal(s.form, "join");
      assert.equal(s.partnerCredits, undefined);
    }
  });

  test("a combo is the chunk's own turn (it can move up) and gives each neighbour half a pass", () => {
    let p = learnedPiece();
    const cs = generateAllChunks(p);
    const hard = middleChunk(cs, "hard");
    const { prev, next } = neighbourChunks(hard, cs.practiceChunks);
    p = doReturn(p, hard.id, 40).p; // chunk
    p = doReturn(p, hard.id, 80).p; // join
    const stage = p.progress[hard.id].stage;
    // One short of what the stage needs: the combo's full pass is what tips it over.
    p = { ...p, progress: { ...p.progress, [hard.id]: { ...p.progress[hard.id], consecutivePasses: 9 } } };
    const before = JSON.parse(JSON.stringify(p.progress));
    const r = doReturn(p, hard.id, 120);
    assert.equal(r.f.form, "combo");
    assert.deepEqual(r.f.partnerIds, [prev.id, next.id]);
    assert.notEqual(r.p.progress[hard.id].stage, stage, "a combo can move the chunk up");
    for (const n of [prev, next]) {
      assert.equal(r.p.progress[n.id].consecutivePasses, (before[n.id].consecutivePasses || 0) + 0.5);
      assert.equal(r.p.progress[n.id].stage, before[n.id].stage, "the neighbours are only credited");
    }
    const s = r.p.progress[hard.id].sessions.slice(-1)[0];
    assert.deepEqual(s.partnerCredits.map((x) => x.id).sort(), [prev.id, next.id].sort());
  });

  test("a combo that was a Partial pass is judged as the chunk's own session and credits no neighbour", () => {
    let p = learnedPiece();
    const cs = generateAllChunks(p);
    const hard = middleChunk(cs, "hard");
    const { prev, next } = neighbourChunks(hard, cs.practiceChunks);
    p = doReturn(p, hard.id, 40).p;
    p = doReturn(p, hard.id, 80).p;
    const before = JSON.parse(JSON.stringify(p.progress));
    const r = doReturn(p, hard.id, 120, "soft-miss");
    assert.equal(r.f.form, "combo");
    assert.equal(r.p.progress[hard.id].consecutivePasses, 0, "a Partial pass starts the count over");
    for (const n of [prev, next]) assert.deepEqual(JSON.parse(JSON.stringify(r.p.progress[n.id])), before[n.id]);
  });

  test("half credit never promotes: addHalfPass only adds to the count, in Stabilizing and Settling", () => {
    assert.deepEqual(addHalfPass({ stage: "stabilizing", consecutivePasses: 3 }), { stage: "stabilizing", consecutivePasses: 3.5 });
    assert.deepEqual(addHalfPass({ stage: "holding", consecutivePasses: 1 }), { stage: "holding", consecutivePasses: 1 });
    assert.equal(addHalfPass({ stage: null, consecutivePasses: 0 }).consecutivePasses, 0);
  });

  test("a neighbour with no ladder state, or in Holding, is given nothing and nothing is recorded for it", () => {
    const progress = {
      a: { stage: null, consecutivePasses: 0, sessions: [] },
      b: { stage: "holding", consecutivePasses: 2 },
      c: { stage: "settling", consecutivePasses: 1 },
    };
    const r = applyPartnerCredits(progress, ["a", "b", "c", "missing"], 0.5);
    assert.deepEqual(r.given, [{ id: "c", credit: 0.5 }]);
    assert.equal(r.progress.a.consecutivePasses, 0);
    assert.equal(r.progress.b.consecutivePasses, 2);
    assert.equal(r.progress.c.consecutivePasses, 1.5);
    assert.equal(progress.c.consecutivePasses, 1, "the input is not changed");
  });

  test("a form sent for a piece on today's plan, or an unknown form, is ignored", () => {
    const progress = { x: { stage: "stabilizing", consecutivePasses: 1 }, y: { stage: "stabilizing", consecutivePasses: 1 } };
    const off = prepareReturn({ onModelTwo: false, chunkId: "x", progress, outcome: "pass", sentForm: "join", sentPartnerIds: ["y"] });
    assert.equal(off.form, null);
    assert.deepEqual(off.formFields, {});
    assert.equal(off.progress.y.consecutivePasses, 1);
    assert.equal(off.plan.runLadder, true);
    const odd = prepareReturn({ onModelTwo: true, chunkId: "x", progress, outcome: "pass", sentForm: "wat", sentPartnerIds: ["y"] });
    assert.equal(odd.form, null);
    const own = prepareReturn({ onModelTwo: true, chunkId: "x", progress, outcome: "pass", sentForm: "join", sentPartnerIds: ["x", "y", "nope"] });
    assert.deepEqual(own.partnerIds, ["y"], "never the chunk itself, never a chunk that has no entry");
  });

  test("contextForForm lays the form's limits over the ladder context, and leaves null alone", () => {
    assert.equal(contextForForm(null, credit("join", "pass")), null);
    const ctx = { passesNeeded: 2, canPromote: true, maxCredit: null, reviewWindow: { planDays: 30, holdingMaxDays: 30 } };
    assert.deepEqual(contextForForm(ctx, credit("join", "pass")), { ...ctx, canPromote: false, maxCredit: 0.5 });
    assert.deepEqual(contextForForm(ctx, credit("combo", "pass")), ctx);
    assert.equal(contextForForm({ ...ctx, maxCredit: 1 }, credit("join", "pass")).maxCredit, 0.5, "the smaller cap wins");
  });
});

describe("[Pass 141] Undo", () => {
  test("taking a join back takes back what the neighbour was given", () => {
    let p = learnedPiece();
    const c = middleNotHard(generateAllChunks(p));
    p = doReturn(p, c.id, 40).p;
    const r = doReturn(p, c.id, 80);
    const partner = r.f.partnerIds[0];
    const session = r.p.progress[c.id].sessions.slice(-1)[0];
    const rev = reversePartnerCredits(r.p.progress, session);
    assert.deepEqual(rev.kept, []);
    assert.equal(rev.progress[partner].consecutivePasses, p.progress[partner].consecutivePasses);
  });

  test("a neighbour that has logged since keeps its credit: its count may have been spent or reset", () => {
    let p = learnedPiece();
    const c = middleNotHard(generateAllChunks(p));
    p = doReturn(p, c.id, 40).p;
    const r = doReturn(p, c.id, 80);
    const partner = r.f.partnerIds[0];
    const session = r.p.progress[c.id].sessions.slice(-1)[0];
    const later = logSession(r.p, generateAllChunks(r.p), partner, 90, dateOfDay(90));
    // logSession stamps loggedAt from the date, so the neighbour's later session is after the join's.
    const rev = reversePartnerCredits(later.progress, session);
    assert.deepEqual(rev.kept, [partner]);
    assert.equal(rev.progress[partner].consecutivePasses, later.progress[partner].consecutivePasses);
  });

  test("a count never goes below zero", () => {
    const session = { loggedAt: 5, partnerCredits: [{ id: "p", credit: 0.5 }] };
    const rev = reversePartnerCredits({ p: { stage: "settling", consecutivePasses: 0, sessions: [] } }, session);
    assert.equal(rev.progress.p.consecutivePasses, 0);
  });

  test("a session with no credits changes nothing", () => {
    const progress = { p: { stage: "settling", consecutivePasses: 2 } };
    assert.deepEqual(reversePartnerCredits(progress, { loggedAt: 1 }).progress, progress);
  });
});

describe("[Pass 141] a piece on the new plan has no transitions or combos to do", () => {
  test("the timeline places none, on any day, and prices a return at its form", () => {
    const p = learnedPiece({ D: 45 });
    const cs = generateAllChunks(p);
    assert.ok(cs.transitions.length && cs.combos.length, "setup: the piece has both");
    const t = computeTimeline(p, cs, { asOfDay: 20 });
    t.days.forEach((d) => {
      assert.deepEqual(d.specialChunkIds, []);
      [...cs.transitions, ...cs.combos].forEach((x) => assert.ok(!d.reviewChunkIds.includes(x.id)));
    });
    [...cs.transitions, ...cs.combos].forEach((x) => assert.equal(t.introducedDay[x.id], undefined));
  });

  test("progress a transition or combo already holds is kept as history and never listed as due", () => {
    let p = learnedPiece({ D: 45 });
    const cs = generateAllChunks(p);
    const t0 = cs.transitions[0];
    p = { ...p, progress: { ...p.progress, [t0.id]: { doneDays: [3], stage: "stabilizing", consecutivePasses: 1, nextDueDate: dateOfDay(5), sessions: [] } } };
    const due = computeDueReviews(p, cs, dateOfDay(30));
    assert.ok(!due.some((i) => i.chunkId === t0.id), "not listed");
    assert.ok(p.progress[t0.id], "still there");
    const oldPlan = { ...p, reviewModel: null };
    assert.ok(computeDueReviews(oldPlan, cs, dateOfDay(30)).some((i) => i.chunkId === t0.id), "today's plan still lists it");
    assert.ok(!computeDueOnDate(p, cs, dateOfDay(5)).some((i) => i.chunkId === t0.id));
  });

  test("a due item carries its form and is priced at the form's measures; a piece on today's plan gets neither", () => {
    let p = learnedPiece({ D: 45 });
    const cs = generateAllChunks(p);
    const c = middleNotHard(cs);
    p = doReturn(p, c.id, 40).p; // the next return is a join
    const due = computeDueReviews(p, cs, dateOfDay(200)).find((i) => i.chunkId === c.id);
    assert.ok(due, "setup: it is due");
    assert.equal(due.form, "join");
    assert.equal(due.formChunk.kind, "transition");
    assert.equal(due.partnerIds.length, 1);
    assert.equal(due.minutes, Math.round(due.formChunk.effort * 2.5));
    assert.equal(nextReturnEffort(c, cs, p.progress), due.formChunk.effort);
    const oldPlan = { ...p, reviewModel: null };
    const oldDue = computeDueReviews(oldPlan, cs, dateOfDay(200)).find((i) => i.chunkId === c.id);
    assert.ok(oldDue && !("form" in oldDue) && !("formChunk" in oldDue) && !("partnerIds" in oldDue));
    assert.equal(oldDue.minutes, Math.round(c.effort * 2.5));
  });

  test("nothing is left to reschedule or to complete for a connector: remaining connectors are none and the plan can finish", () => {
    // Re-break this on purpose by dropping the model check in isPlanActuallyComplete.
    const make = (reviewModel) => {
      let p = makePiece({ N: 40, mix: "balanced (50/25/25)", D: 10, reviewModel });
      generateAllChunks(p).practiceChunks.forEach((c) => {
        p = logSession(p, generateAllChunks(p), c.id, 1, dateOfDay(1));
      });
      return p;
    };
    const next = make(2);
    const csNext = generateAllChunks(next);
    assert.deepEqual(computeRemainingConnectorIds(next, csNext), []);
    assert.equal(isPlanActuallyComplete(next, csNext, computeTimeline(next, csNext)), true, "every practice chunk is done, no connector is owed");
    const old = make(null);
    const csOld = generateAllChunks(old);
    assert.ok(computeRemainingConnectorIds(old, csOld).length > 0, "today's plan still counts them");
    assert.equal(isPlanActuallyComplete(old, csOld, computeTimeline(old, csOld)), false);
  });
});

describe("[Pass 141] sessions that carry a form", () => {
  test("a session record holds form, partnerIds and partnerCredits only when it was a join or a combo", () => {
    let p = learnedPiece();
    const cs = generateAllChunks(p);
    const hard = middleChunk(cs, "hard");
    const log = [];
    let day = 40;
    for (let i = 0; i < 3; i++) {
      p = doReturn(p, hard.id, day).p;
      log.push(p.progress[hard.id].sessions.slice(-1)[0]);
      day += 40;
    }
    assert.deepEqual(log.map((s) => s.form), ["chunk", "join", "combo"]);
    assert.ok(!("partnerIds" in log[0]) && !("partnerCredits" in log[0]));
    assert.ok(log[1].partnerIds.length === 1 && log[1].partnerCredits.length === 1);
    assert.ok(log[2].partnerIds.length === 2 && log[2].partnerCredits.length === 2);
    // The learning session, logged before any form existed, carries none.
    assert.ok(!("form" in p.progress[hard.id].sessions[0]));
  });
});

describe("[Pass 141] merging two devices' copies of a chunk that carries forms", () => {
  test("a join logged on each device is kept on both, with its form, partners and credits intact", () => {
    let base = learnedPiece();
    const c = middleNotHard(generateAllChunks(base));
    base = doReturn(base, c.id, 40).p;
    const a = doReturn(base, c.id, 80).p.progress[c.id]; // a join on device A
    const b = doReturn(base, c.id, 81).p.progress[c.id]; // another return on device B, a day later
    const merged = unionProgressEntries(a, b);
    const forms = merged.sessions.filter((s) => s.form).map((s) => s.form);
    assert.equal(forms.length, 3, "the chunk return and both devices' returns");
    const joins = merged.sessions.filter((s) => s.form === "join");
    assert.ok(joins.length >= 1 && joins.every((s) => s.partnerIds && s.partnerCredits), "tags survive the union");
  });
});

describe("[Pass 141] a caller that hands over only `{ all }`", () => {
  // Daily Practice builds its set as `{ all: chunks }` (TodayTab) and Week view as a `chunkSetShim`
  // of the same shape. Pass 141's first version read `practiceChunks` for a piece on the new plan,
  // found nothing there and listed no review due. Found by the independent review of the pass.
  test("[regression, Pass 141] the due list is the same when only `all` is given, for a piece on the new plan", () => {
    // Re-break this on purpose by dropping completeChunkSet from computeDueReviews: this test fails.
    let p = learnedPiece({ D: 45 });
    const cs = generateAllChunks(p);
    const c = middleNotHard(cs);
    p = doReturn(p, c.id, 40).p; // the next return is a join
    const date = dateOfDay(200);
    const full = computeDueReviews(p, cs, date);
    const onlyAll = computeDueReviews(p, { all: cs.all }, date);
    assert.ok(full.length > 0, "setup: something is due");
    assert.deepEqual(onlyAll.map((i) => i.chunkId), full.map((i) => i.chunkId));
    const item = onlyAll.find((i) => i.chunkId === c.id);
    assert.equal(item.form, "join", "and its form is found too, not just the chunk");
    assert.equal(item.minutes, full.find((i) => i.chunkId === c.id).minutes);
  });

  test("[regression, Pass 141] computeDueOnDate with only `all` lists the same chunks", () => {
    let p = learnedPiece({ D: 45 });
    const cs = generateAllChunks(p);
    const day = p.progress[cs.practiceChunks[0].id].nextDueDate;
    const full = computeDueOnDate(p, cs, day);
    const onlyAll = computeDueOnDate(p, { all: cs.all }, day);
    assert.ok(full.length > 0, "setup: something opens that day");
    assert.deepEqual(onlyAll.map((i) => i.chunkId), full.map((i) => i.chunkId));
  });

  test("a piece on today's plan is the same with `{ all }` only, as it always was", () => {
    const p = learnedPiece({ D: 45, reviewModel: null });
    const cs = generateAllChunks(p);
    const date = dateOfDay(200);
    assert.deepEqual(computeDueReviews(p, { all: cs.all }, date).map((i) => i.chunkId), computeDueReviews(p, cs, date).map((i) => i.chunkId));
  });

  test("completeChunkSet cuts the three lists out of `all` by kind and leaves a complete set alone", () => {
    const cs = generateAllChunks(learnedPiece());
    const made = completeChunkSet({ all: cs.all });
    assert.equal(made.practiceChunks.length, cs.practiceChunks.length);
    assert.equal(made.transitions.length, cs.transitions.length);
    assert.equal(made.combos.length, cs.combos.length);
    assert.equal(completeChunkSet(cs), cs, "the same object back");
    assert.equal(completeChunkSet(null), null);
  });

  test("the form lookup itself copes with a set that has only `all`", () => {
    let p = learnedPiece();
    const cs = generateAllChunks(p);
    const c = middleNotHard(cs);
    p = doReturn(p, c.id, 40).p;
    assert.equal(nextReviewForm(c, { all: cs.all }, p.progress).form, "join");
  });
});
