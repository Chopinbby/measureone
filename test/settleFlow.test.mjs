// Pass 121 follow-up (src/lib/settleFlow.js): the walk through one held piece's
// questions as plain data. Two halves: small hand-made questions for each rule of the
// walk (what comes next, what Back does, what the summary says, that NOTHING is
// applied before the summary), and real pieces for the first screen and for the
// account moving on while the person decides.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateAndMigratePiece } from "../src/lib/storage.js";
import {
  accountRecordFor,
  accountRowsToCandidates,
  applyAccountMerge,
  pieceFingerprint,
  piecePartFingerprints,
  planSettle,
  withPieceHeld,
  withAccountCopyRecorded,
  answeredAll,
} from "../src/lib/accountSync.js";
import { planPieceMerge } from "../src/lib/pieceMerge.js";
import {
  BULK_MIN,
  BULK_PART,
  bulkParts,
  hasBulkStep,
  questionsToAsk,
  startSettle,
  settleChoose,
  settleCanNext,
  settleBack,
  settleCanBack,
  settleNext,
  keptPhrases,
  removalWarnings,
  settleView,
  sameSettleQuestions,
  decideAfterReread,
  rereadSettleItem,
} from "../src/lib/settleFlow.js";

/* ------------------------------------------------------------------ */
/*  Hand-made questions                                                */
/* ------------------------------------------------------------------ */

const field = (part, label) => ({
  part,
  kind: "field",
  title: label,
  text: `${label}: a on this device, b on your other device.`,
  options: [
    { value: "local", label: "This device's" },
    { value: "remote", label: "The other device's" },
  ],
  kept: { local: `this device's ${label.toLowerCase()}`, remote: `the other device's ${label.toLowerCase()}` },
});
const REMOVE_OTHER = "The 2 sessions logged on your other device will be removed, from your account too. This can't be undone.";
const REMOVE_THIS = "The session logged on this device will be removed. This can't be undone.";
const practice = (n) => {
  const target = `chunk ${n}`;
  return {
    part: `progress:c${n}`,
    kind: "progress",
    title: `Practice record: ${target}`,
    target,
    text: `You practiced ${target} on both devices since you last synced.`,
    options: [
      { value: "both", label: "Both devices' sessions", recommended: true, hint: "Every session is kept." },
      { value: "local", label: "This device's", hint: REMOVE_OTHER, removes: true },
      { value: "remote", label: "The other device's", hint: REMOVE_THIS, removes: true },
    ],
    kept: { local: `this device's record of ${target}`, remote: `the other device's record of ${target}`, both: `both devices' sessions for ${target}` },
  };
};
// a practice record that does NOT offer "both" (only one device added sessions)
const practiceOneSided = (n) => ({ ...practice(n), options: practice(n).options.filter((o) => o.value !== "both") });
const wholePiece = () => ({
  part: "__whole_piece__",
  kind: "whole-piece",
  title: "Chunk layout and practice",
  text: "The chunk layout was changed on one device, while practice was recorded on the other.",
  options: [
    { value: "local", label: "This device's piece", hint: "Practice and changes made on your other device will be removed, from your account too. This can't be undone.", removes: true },
    { value: "remote", label: "The other device's piece", hint: "Practice and changes made on this device will be removed. This can't be undone.", removes: true },
  ],
  kept: { local: "this device's whole piece", remote: "the other device's whole piece" },
});
const itemOf = (questions, status = "questions") => ({ id: "p1", name: "Etude", revision: 2, status, questions, reason: "conflicts" });

describe("when the first screen is offered (Pass 121 follow-up)", () => {
  test("only for three or more practice records changed on both devices, and only for a piece with questions", () => {
    assert.equal(BULK_MIN, 3);
    assert.equal(hasBulkStep(itemOf([practice(1), practice(2)])), false, "two are simply asked");
    assert.equal(hasBulkStep(itemOf([practice(1), practice(2), practice(3)])), true);
    assert.equal(hasBulkStep(itemOf([practice(1), practice(2), practice(3), field("targetDate", "Target date")])), true);
    assert.equal(hasBulkStep(itemOf([practice(1), practice(2), practiceOneSided(3), field("notes", "Notes"), field("name", "Name")])), false, "a record that does not offer 'both', and ordinary fields, do not count");
    assert.equal(hasBulkStep(itemOf([], "ready")), false);
    assert.deepEqual(bulkParts([practice(1), practiceOneSided(2), field("a", "A"), practice(3)]), ["progress:c1", "progress:c3"]);
    // only a practice record can be answered "both" (the engine refuses it for anything else), so a
    // question of another kind that happened to offer it is never swept up by the first screen
    const oddField = { ...field("odd", "Odd"), options: [{ value: "both", label: "Both" }, { value: "local", label: "L" }, { value: "remote", label: "R" }] };
    assert.deepEqual(bulkParts([practice(1), practice(2), oddField]), ["progress:c1", "progress:c2"]);
    assert.equal(hasBulkStep(itemOf([practice(1), practice(2), oddField])), false);
  });

  test("where the walk starts: the first screen, the first question, or 'ready'", () => {
    assert.equal(startSettle(itemOf([practice(1), practice(2), practice(3)])).stage, "bulk");
    assert.equal(startSettle(itemOf([practice(1), practice(2)])).stage, "question");
    assert.equal(startSettle(itemOf([wholePiece()])).stage, "question");
    assert.equal(startSettle(itemOf([], "ready")).stage, "ready");
    assert.equal(startSettle(itemOf([field("a", "A")]), "why").notice, "why");
    assert.deepEqual(startSettle(itemOf([field("a", "A")])), { stage: "question", index: 0, answers: {}, bulk: null, notice: null });
  });
});

describe("the first screen, one question at a time, Back, and the summary (Pass 121 follow-up)", () => {
  const four = itemOf([field("targetDate", "Target date"), practice(1), practice(2), practice(3), practice(4)]);
  const onlyPractice = itemOf([practice(1), practice(2), practice(3)]);

  test("'all' answers the whole group with 'both' and the group is not asked again", () => {
    let st = startSettle(four);
    st = settleChoose(four, st, "all");
    assert.equal(st.bulk, "all");
    assert.deepEqual(st.answers, { "progress:c1": "both", "progress:c2": "both", "progress:c3": "both", "progress:c4": "both" });
    assert.deepEqual(questionsToAsk(four, st).map((q) => q.part), ["targetDate"]);
    const step = settleNext(four, st);
    assert.equal(step.applies, false);
    assert.equal(step.state.stage, "question");
    assert.equal(settleView(four, step.state).stepLabel, "Question 1 of 1", "the group counts as answered");
  });

  test("when 'all' leaves nothing to ask, the first screen goes straight to the summary", () => {
    let st = settleChoose(onlyPractice, startSettle(onlyPractice), "all");
    assert.deepEqual(questionsToAsk(onlyPractice, st), []);
    st = settleNext(onlyPractice, st).state;
    assert.equal(st.stage, "recap");
    assert.equal(answeredAll(onlyPractice.questions, st.answers), true);
  });

  test("'each' asks every question; going from 'all' to 'each' clears what 'all' filled in", () => {
    let st = settleChoose(four, startSettle(four), "all");
    st = settleChoose(four, st, "each");
    assert.deepEqual(st.answers, {}, "nothing the person did not choose stays chosen");
    assert.equal(questionsToAsk(four, st).length, 5);
    assert.equal(settleCanNext(four, startSettle(four)), false, "the first screen needs an answer");
  });

  test("choosing 'each' again after answering some does not wipe those answers", () => {
    let st = settleChoose(four, startSettle(four), "each");
    st = settleNext(four, st).state; // first question: the date
    st = settleChoose(four, st, "remote");
    st = settleNext(four, st).state; // chunk 1
    st = settleChoose(four, st, "both");
    st = settleBack(four, settleBack(four, st)); // back to the date
    st = settleBack(four, st); // and to the first screen
    assert.equal(st.stage, "bulk");
    const again = settleChoose(four, st, "each");
    assert.equal(again, st, "the same choice again changes nothing");
    assert.deepEqual(again.answers, { targetDate: "remote", "progress:c1": "both" });
  });

  test("Next needs an answer that is one of the screen's own options; anything else does nothing", () => {
    let st = settleChoose(four, startSettle(four), "each");
    assert.equal(settleChoose(four, st, "maybe"), st);
    st = settleNext(four, st).state; // the date: no 'both' for a date
    assert.equal(settleCanNext(four, st), false);
    assert.equal(settleChoose(four, st, "both"), st, "'both' is not an option for a date");
    assert.deepEqual(settleNext(four, st), { state: st, applies: false });
    st = settleChoose(four, st, "local");
    assert.equal(settleCanNext(four, st), true);
    assert.equal(settleChoose(itemOf([], "ready"), startSettle(itemOf([], "ready")), "all").stage, "ready");
  });

  test("Back: to the previous question, from the first question to the first screen (if there was one), from the summary to the last question", () => {
    const noBulk = itemOf([field("a", "A"), field("b", "B")]);
    let st = startSettle(noBulk);
    assert.equal(settleCanBack(noBulk, st), false, "nowhere to go from the first question when there is no first screen");
    assert.equal(settleBack(noBulk, st), st);
    st = settleNext(noBulk, settleChoose(noBulk, st, "local")).state;
    assert.equal(settleBack(noBulk, st).index, 0);
    st = settleNext(noBulk, settleChoose(noBulk, st, "remote")).state;
    assert.equal(st.stage, "recap");
    assert.deepEqual([settleBack(noBulk, st).stage, settleBack(noBulk, st).index], ["question", 1], "back from the summary is the LAST question, answer kept");
    assert.equal(settleBack(noBulk, st).answers.b, "remote");
    // with a first screen
    let b = settleChoose(four, startSettle(four), "each");
    assert.equal(settleCanBack(four, b), false, "the first screen is the start");
    b = settleNext(four, b).state;
    assert.equal(settleBack(four, b).stage, "bulk");
    // all answered through 'all', summary, Back: the first screen (no question is left to go back to)
    const done = settleNext(onlyPractice, settleChoose(onlyPractice, startSettle(onlyPractice), "all")).state;
    assert.equal(done.stage, "recap");
    assert.equal(settleBack(onlyPractice, done).stage, "bulk");
    // 'ready' has nowhere to go back to either
    assert.equal(settleCanBack(itemOf([], "ready"), startSettle(itemOf([], "ready"))), false);
  });

  test("NOTHING is applied before the summary (or 'ready'): every earlier step says applies: false, on every path", () => {
    const items = [four, onlyPractice, itemOf([wholePiece()]), itemOf([field("a", "A"), practice(1), practice(2)]), itemOf([practice(1), practice(2), practice(3), practice(4)])];
    items.forEach((item) => {
      [null, "all", "each"].forEach((bulkChoice) => {
        let st = startSettle(item);
        let steps = 0;
        for (;;) {
          if (st.stage === "bulk") st = settleChoose(item, st, bulkChoice || "each");
          else if (st.stage === "question") st = settleChoose(item, st, questionsToAsk(item, st)[st.index].options[0].value);
          const step = settleNext(item, st);
          if (step.applies) {
            assert.equal(st.stage, "recap", "the moment to apply is the summary");
            assert.equal(answeredAll(item.questions, st.answers), true, "and only once everything is answered");
            break;
          }
          assert.notEqual(step.state, st, "each Next moves on");
          st = step.state;
          assert.ok(++steps < 20, "the walk ends");
        }
      });
    });
    const ready = itemOf([], "ready");
    assert.deepEqual(settleNext(ready, startSettle(ready)), { state: startSettle(ready), applies: true }, "'ready' is the screen that asks 'Bring it up to date?'");
    // a summary that is not fully answered does not apply (cannot happen through the buttons, but the rule is here)
    assert.equal(settleNext(four, { ...startSettle(four), stage: "recap" }).applies, false);
  });

  test("the summary names what is kept (the group as ONE line) and repeats what would be removed, by the record's name", () => {
    let st = startSettle(four);
    st = settleChoose(four, st, "all");
    st = settleNext(four, st).state;
    st = settleNext(four, settleChoose(four, st, "remote")).state;
    assert.equal(st.stage, "recap");
    assert.deepEqual(keptPhrases(four, st), ["the other device's target date", "both devices' sessions for all 4 practice records"]);
    const v = settleView(four, st);
    assert.deepEqual(v.recap.keeps, ["The other device's target date", "Both devices' sessions for all 4 practice records"]);
    assert.deepEqual(v.recap.warnings, [], "keeping both removes nothing");
    // each one separately, with answers that remove sessions
    const each = settleChoose(four, startSettle(four), "each");
    let st2 = settleNext(four, each).state;
    for (const value of ["local", "both", "local", "remote", "both"]) st2 = settleNext(four, settleChoose(four, st2, value)).state;
    assert.equal(st2.stage, "recap");
    assert.deepEqual(removalWarnings(four, st2), [
      `For chunk 2: the 2 sessions logged on your other device will be removed, from your account too. This can't be undone.`,
      `For chunk 3: the session logged on this device will be removed. This can't be undone.`,
    ]);
    assert.equal(settleView(four, st2).recap.keeps[0], "This device's target date");
    assert.equal(settleView(four, st2).recap.keeps.length, 5);
    // the whole-piece question has no record to name: the sentence is as written
    const whole = itemOf([wholePiece()]);
    const w = settleNext(whole, settleChoose(whole, startSettle(whole), "local")).state;
    assert.deepEqual(removalWarnings(whole, w), ["Practice and changes made on your other device will be removed, from your account too. This can't be undone."]);
    assert.deepEqual(settleView(whole, w).recap.keeps, ["This device's whole piece"]);
  });

  test("what each screen shows: the first screen as an ordinary question, then 'Question n of m', then the summary", () => {
    let st = startSettle(four);
    let v = settleView(four, st);
    assert.equal(v.stage, "bulk");
    assert.equal(v.question.part, BULK_PART);
    assert.equal(v.question.text, "You practiced 4 parts of this piece on both devices since you last synced.");
    assert.deepEqual(v.question.options.map((o) => [o.value, o.label, !!o.recommended]), [["all", "Both devices' sessions for all 4", true], ["each", "Decide each one", false]]);
    assert.equal(v.stepLabel, null);
    assert.equal(v.primaryLabel, "Next");
    assert.equal(v.canNext, false);
    assert.equal(v.applies, false);
    st = settleNext(four, settleChoose(four, st, "each")).state;
    v = settleView(four, st);
    assert.equal(v.stepLabel, "Question 1 of 5");
    assert.equal(v.question.part, "targetDate");
    assert.equal(v.answer, null);
    assert.equal(v.canBack, true);
    st = settleChoose(four, st, "remote");
    assert.equal(settleView(four, st).answer, "remote");
    // the summary
    let all = settleNext(onlyPractice, settleChoose(onlyPractice, startSettle(onlyPractice), "all")).state;
    v = settleView(onlyPractice, all);
    assert.deepEqual([v.stage, v.stepLabel, v.primaryLabel, v.applies, v.canNext, v.canBack, v.question], ["recap", "Last step", "Settle this piece", true, true, true, null]);
    assert.match(v.intro, /^Nothing has changed yet\./);
    // nothing left to decide
    const ready = itemOf([], "ready");
    v = settleView(ready, startSettle(ready));
    assert.deepEqual([v.stage, v.primaryLabel, v.applies, v.canNext, v.canBack], ["ready", "Bring it up to date", true, true, false]);
    assert.match(v.intro, /fit together now/);
  });

  test("a notice stays while the person chooses, and goes when they move on", () => {
    let st = startSettle(itemOf([field("a", "A"), field("b", "B")]), "Something changed.");
    const item = itemOf([field("a", "A"), field("b", "B")]);
    assert.equal(settleView(item, st).notice, "Something changed.");
    st = settleChoose(item, st, "local");
    assert.equal(settleView(item, st).notice, "Something changed.");
    st = settleNext(item, st).state;
    assert.equal(settleView(item, st).notice, null);
  });

  test("nothing in anything the person reads has an em dash", () => {
    const every = [];
    [four, onlyPractice, itemOf([wholePiece()]), itemOf([], "ready")].forEach((item) => {
      let st = startSettle(item);
      for (let i = 0; i < 12; i++) {
        const v = settleView(item, st);
        every.push(JSON.stringify(v));
        if (st.stage === "bulk") st = settleChoose(item, st, "each");
        else if (st.stage === "question") st = settleChoose(item, st, questionsToAsk(item, st)[st.index].options[0].value);
        const step = settleNext(item, st);
        if (step.applies) break;
        st = step.state;
      }
    });
    every.forEach((text) => assert.equal(/—/.test(text), false));
  });
});

describe("the same questions? (Pass 121 follow-up)", () => {
  const a = [field("targetDate", "Target date"), practice(1)];
  const copy = () => JSON.parse(JSON.stringify(a));

  test("identical questions are the same; a different value, number, flag, option or order is not", () => {
    assert.equal(sameSettleQuestions(a, copy()), true);
    assert.equal(sameSettleQuestions([], []), true);
    const changedValue = copy();
    changedValue[0].text = "Target date: Nov 2 on this device, b on your other device.";
    assert.equal(sameSettleQuestions(a, changedValue), false, "a value in the wording");
    const changedCount = copy();
    changedCount[1].options[1].hint = changedCount[1].options[1].hint.replace("2 sessions", "3 sessions");
    assert.equal(sameSettleQuestions(a, changedCount), false, "the number of sessions that would be removed");
    const unflagged = copy();
    delete unflagged[1].options[2].removes;
    assert.equal(sameSettleQuestions(a, unflagged), false, "whether an answer removes anything");
    const fewer = copy().slice(0, 1);
    assert.equal(sameSettleQuestions(a, fewer), false, "a question gone");
    assert.equal(sameSettleQuestions(a, copy().reverse()), false, "the order");
    const detail = copy();
    detail[0].detail = "Days to learn follows the target date you keep.";
    assert.equal(sameSettleQuestions(a, detail), false, "the line under it");
    // what the screen does not show does not count
    const quiet = copy();
    quiet[0].kept.local = "something else";
    quiet[1].recommended = false;
    assert.equal(sameSettleQuestions(a, quiet), true);
  });

  test("deciding after the account was read again: apply, ask again (saying why), or give up", () => {
    const item = itemOf(a);
    const freshSame = { ...itemOf(copy()), revision: 3, candidate: { id: "p1", revision: 3 } };
    assert.deepEqual(decideAfterReread(item, freshSame), { outcome: "apply", item: freshSame });
    const freshDifferent = { ...itemOf([field("targetDate", "Target date")]), candidate: { id: "p1" } };
    const again = decideAfterReread(item, freshDifferent);
    assert.equal(again.outcome, "again");
    assert.equal(again.item, freshDifferent);
    assert.equal(again.notice, "Something changed while you were deciding, so the questions are asked again. Your earlier choices were cleared and nothing was changed.");
    const freshReady = { ...itemOf([], "ready"), candidate: { id: "p1" } };
    const ready = decideAfterReread(item, freshReady);
    assert.equal(ready.outcome, "again", "nothing left to decide is a different screen, and the person is told");
    assert.match(ready.notice, /nothing is left to decide now/);
    assert.deepEqual(decideAfterReread(item, null), { outcome: "gone" });
    assert.deepEqual(decideAfterReread(item, { ...freshSame, candidate: undefined }), { outcome: "gone" });
    // 'ready' stays 'ready'
    assert.equal(decideAfterReread(itemOf([], "ready"), freshReady).outcome, "apply");
    [again.notice, ready.notice].forEach((t) => assert.equal(/—/.test(t), false));
  });
});

/* ------------------------------------------------------------------ */
/*  Real pieces                                                        */
/* ------------------------------------------------------------------ */

const USER = "u1";
const viaJson = (v) => JSON.parse(JSON.stringify(v));
function reorder(v) {
  if (Array.isArray(v)) return v.map(reorder);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reorder(v[k])]));
  return v;
}
const acctRow = (p, revision = 1, extra = {}) => ({ id: p.id, revision, deleted_at: null, data: reorder(viaJson(p)), ...extra });
const syncedAs = (p, revision = 1) => ({ revision, fingerprint: pieceFingerprint(p), parts: piecePartFingerprints(p) });
const CHUNKS = ["c1", "c5", "c9", "c13"];
const session = (day, durationSeconds, loggedAt) => ({ day, loggedDate: `2026-09-${String(day + 1).padStart(2, "0")}`, reps: 3, bpm: 60 + day, durationSeconds, loggedAt });
const baseProgress = () => Object.fromEntries(CHUNKS.map((id, i) => [id, { sessions: [session(1, 60, 1000 + i)], doneDays: [1], currentBPM: 61 }]));
const makePiece = (over = {}) =>
  validateAndMigratePiece({
    id: "p1",
    name: "Etude",
    totalMeasures: 32,
    startDate: "2026-09-01",
    createdAt: 1000,
    updatedAt: 1000,
    sortOrder: 1,
    measureDifficulty: Array(32).fill(1),
    sections: [{ id: "s1", name: "A", start: 1, end: 32 }],
    status: "active",
    scheduleMode: "days",
    daysToLearn: 21,
    minutesPerDay: 30,
    chunkMode: "auto",
    targetDate: "2026-10-20",
    progress: baseProgress(),
    ...over,
  });
// the same piece with one more session per listed chunk, from one device
const practicedMore = (p, ids, day, durationSeconds, extra = {}) =>
  validateAndMigratePiece({
    ...viaJson(p),
    updatedAt: (p.updatedAt || 0) + 1000,
    ...extra,
    progress: Object.fromEntries(
      Object.entries(viaJson(p).progress).map(([id, e]) => [id, ids.includes(id) ? { ...e, sessions: [...e.sessions, session(day, durationSeconds, 5000 + day * 100 + CHUNKS.indexOf(id))], doneDays: [...e.doneDays, day] } : e])
    ),
  });
const durationsOf = (p, id) => (p.progress[id].sessions || []).map((s) => s.durationSeconds).sort((a, b) => a - b);

describe("the first screen with real pieces (Pass 121 follow-up)", () => {
  const base = makePiece();
  const mine = practicedMore(base, CHUNKS, 2, 90, { targetDate: "2026-11-01" });
  const theirs = practicedMore(base, CHUNKS, 3, 120, { targetDate: "2026-11-15" });
  const heldRecord = () => {
    const record = { pieces: { p1: syncedAs(base, 1) }, technique: null, checkedAt: 1000, syncedAt: null };
    const plan = planPieceMerge({ local: mine, remote: theirs, base: record.pieces.p1.parts });
    return accountRecordFor(
      withPieceHeld({ version: 1, accounts: { [USER]: record } }, USER, "p1", plan.conflicts.map((c) => ({ part: c.part, kind: c.kind, local: c.localFingerprint, remote: c.remoteFingerprint, base: c.baseFingerprint }))),
      USER
    );
  };
  const candidatesOf = (remote = theirs, revision = 2) => accountRowsToCandidates({ pieces: [acctRow(remote, revision)], technique: null });

  test("four chunks practiced on both devices make one first screen, and the answers apply to every one of them", () => {
    const planned = planSettle({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: heldRecord() });
    const item = planned.items[0];
    assert.equal(item.questions.length, 5, "the date and four practice records");
    assert.equal(hasBulkStep(item), true);
    let st = startSettle(item);
    assert.equal(st.stage, "bulk");
    st = settleNext(item, settleChoose(item, st, "all")).state;
    assert.equal(settleView(item, st).question.part, "targetDate");
    st = settleNext(item, settleChoose(item, st, "local")).state;
    assert.equal(st.stage, "recap");
    const view = settleView(item, st);
    assert.deepEqual(view.recap.keeps, ["This device's target date", "Both devices' sessions for all 4 practice records"]);
    assert.deepEqual(view.recap.warnings, []);
    // the summary's button applies: these answers, through the one apply step
    assert.equal(settleNext(item, st).applies, true);
    const out = applyAccountMerge({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: heldRecord(), selectedIds: ["p1"], includeTechnique: false, settle: { p1: st.answers } });
    assert.deepEqual(out.settledIds, ["p1"]);
    assert.deepEqual(out.unsettled, []);
    CHUNKS.forEach((id) => assert.deepEqual(durationsOf(out.pieces.p1, id), [60, 90, 120], `${id}: the first session and one from each device`));
    assert.equal(out.pieces.p1.targetDate, "2026-11-01");
    assert.equal(out.entries.p1.revision, 2);
  });

  test("'Decide each one' with real pieces: the removal warnings name the records and count the sessions", () => {
    const item = planSettle({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: heldRecord() }).items[0];
    let st = settleNext(item, settleChoose(item, startSettle(item), "each")).state;
    const picks = { targetDate: "remote", "progress:c1": "local", "progress:c5": "both", "progress:c9": "remote", "progress:c13": "both" };
    while (st.stage === "question") {
      const q = questionsToAsk(item, st)[st.index];
      st = settleNext(item, settleChoose(item, st, picks[q.part])).state;
    }
    assert.equal(st.stage, "recap");
    const warnings = settleView(item, st).recap.warnings;
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /^For mm\. 1.4: the session logged on your other device will be removed, from your account too\. This can't be undone\.$/);
    assert.match(warnings[1], /^For mm\. 9.12: the session logged on this device will be removed\. This can't be undone\.$/);
    const out = applyAccountMerge({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: heldRecord(), selectedIds: ["p1"], includeTechnique: false, settle: { p1: st.answers } });
    assert.deepEqual(out.settledIds, ["p1"]);
    assert.deepEqual(durationsOf(out.pieces.p1, "c1"), [60, 90], "this device's record: the other device's session is gone");
    assert.deepEqual(durationsOf(out.pieces.p1, "c5"), [60, 90, 120]);
    assert.deepEqual(durationsOf(out.pieces.p1, "c9"), [60, 120], "the other device's record: this device's session is gone");
    assert.equal(out.pieces.p1.targetDate, "2026-11-15");
  });
});

describe("the account moved on while the person was deciding (Pass 121 follow-up)", () => {
  const base = makePiece();
  const mine = practicedMore(base, ["c1"], 2, 90, { targetDate: "2026-11-01" });
  const theirs = practicedMore(base, ["c1"], 3, 120, { targetDate: "2026-11-15" });
  const recordFor = (local, remote) => {
    const record = { pieces: { p1: syncedAs(base, 1) }, technique: null, checkedAt: 1000, syncedAt: null };
    const plan = planPieceMerge({ local, remote, base: record.pieces.p1.parts });
    return accountRecordFor(
      withPieceHeld({ version: 1, accounts: { [USER]: record } }, USER, "p1", plan.conflicts.map((c) => ({ part: c.part, kind: c.kind, local: c.localFingerprint, remote: c.remoteFingerprint, base: c.baseFingerprint }))),
      USER
    );
  };
  const rec = recordFor(mine, theirs);
  const asked = () => {
    const item = planSettle({ candidates: accountRowsToCandidates({ pieces: [acctRow(theirs, 2)], technique: null }), localPieces: { p1: mine }, accountRecord: rec }).items[0];
    return { ...item, candidate: accountRowsToCandidates({ pieces: [acctRow(theirs, 2)], technique: null }).pieces[0] };
  };
  const reread = (rows, extra = {}) => rereadSettleItem({ item: asked(), rows: { pieces: rows, technique: null }, localPieces: { p1: mine }, accountRecord: rec, ...extra });

  test("the account has not moved: go ahead, with the same questions", () => {
    const out = reread([acctRow(theirs, 2)]);
    assert.equal(out.outcome, "apply");
    assert.equal(out.item.revision, 2);
    assert.equal(sameSettleQuestions(out.item.questions, asked().questions), true);
    assert.ok(out.item.candidate && out.item.candidate.piece, "the row it would apply is attached");
  });

  test("the account moved, but nothing the person decided on changed: go ahead, with the NEW revision (not the one read earlier)", () => {
    const moved = validateAndMigratePiece({ ...viaJson(theirs), notes: "added on the other device since", updatedAt: theirs.updatedAt + 500 });
    const out = reread([acctRow(moved, 3)]);
    assert.equal(out.outcome, "apply");
    assert.equal(out.item.revision, 3);
    assert.equal(out.item.candidate.revision, 3);
    // applying the same answers against the fresh row records revision 3, so the upload that follows is not refused
    const applied = applyAccountMerge({
      candidates: { pieces: [out.item.candidate], deleted: [], unreadable: [], technique: { technique: null, revision: null, unreadable: false, skippedItems: 0 } },
      localPieces: { p1: mine },
      accountRecord: rec,
      selectedIds: ["p1"],
      includeTechnique: false,
      settle: { p1: { targetDate: "local", "progress:c1": "both" } },
    });
    assert.deepEqual(applied.settledIds, ["p1"]);
    assert.equal(applied.entries.p1.revision, 3);
    assert.equal(applied.pieces.p1.notes, "added on the other device since", "the change that did not conflict came with it");
    assert.deepEqual(durationsOf(applied.pieces.p1, "c1"), [60, 90, 120]);
  });

  test("another session was logged on the other device: the numbers in the warnings changed, so the question is asked again, with a reason", () => {
    const more = practicedMore(theirs, ["c1"], 4, 150);
    const out = reread([acctRow(more, 3)]);
    assert.equal(out.outcome, "again");
    assert.equal(out.item.revision, 3);
    assert.match(out.notice, /^Something changed while you were deciding/);
    const chunk = out.item.questions.find((q) => q.part === "progress:c1");
    assert.match(chunk.options.find((o) => o.value === "local").hint, /^The 2 sessions logged on your other device will be removed/);
    const restarted = startSettle(out.item, out.notice);
    assert.deepEqual([restarted.stage, restarted.answers, restarted.notice], ["question", {}, out.notice], "from the start, nothing answered");
  });

  test("the other device changed a value that is being decided: asked again", () => {
    const again = validateAndMigratePiece({ ...viaJson(theirs), targetDate: "2026-12-24", updatedAt: theirs.updatedAt + 500 });
    const out = reread([acctRow(again, 3)]);
    assert.equal(out.outcome, "again");
    assert.match(out.item.questions.find((q) => q.part === "targetDate").text, /Dec 24/);
  });

  test("the other device went back to what it was: nothing is left to decide, and the person is told", () => {
    const out = reread([acctRow(base, 3)]);
    assert.equal(out.outcome, "again");
    assert.equal(out.item.status, "ready");
    assert.match(out.notice, /nothing is left to decide now/);
    assert.equal(startSettle(out.item, out.notice).stage, "ready");
  });

  test("this device changed meanwhile (another tab): asked again with the new question", () => {
    const moved = validateAndMigratePiece({ ...viaJson(mine), notes: "typed in another window", updatedAt: mine.updatedAt + 500 });
    const remoteNotes = validateAndMigratePiece({ ...viaJson(theirs), notes: "typed on the other device", updatedAt: theirs.updatedAt + 500 });
    const out = rereadSettleItem({ item: asked(), rows: { pieces: [acctRow(remoteNotes, 3)], technique: null }, localPieces: { p1: moved }, accountRecord: rec });
    assert.equal(out.outcome, "again");
    assert.ok(out.item.questions.some((q) => q.part === "notes"), "a question nobody was asked");
  });

  test("the piece is gone: the row is marked deleted or missing, or it is no longer held", () => {
    assert.deepEqual(reread([acctRow(theirs, 3, { deleted_at: "2026-10-20T00:00:00Z" })]), { outcome: "gone" });
    assert.deepEqual(reread([]), { outcome: "gone" });
    const settledElsewhere = withAccountCopyRecorded({ version: 1, accounts: { [USER]: { ...rec } } }, USER, { entries: { p1: syncedAs(theirs, 2) } });
    assert.deepEqual(reread([acctRow(theirs, 2)], { accountRecord: accountRecordFor(settledElsewhere, USER) }), { outcome: "gone" });
  });

  test("only the piece being settled is read again, even when other pieces are held too", () => {
    const other = makePiece({ id: "p2", name: "Nocturne" });
    const otherMine = practicedMore(other, ["c1"], 2, 90, { notes: "here" });
    const otherTheirs = practicedMore(other, ["c1"], 3, 120, { notes: "there" });
    let device = { version: 1, accounts: { [USER]: { pieces: { p1: syncedAs(base, 1), p2: syncedAs(other, 1) }, technique: null, checkedAt: 1000, syncedAt: null } } };
    [["p1", mine, theirs], ["p2", otherMine, otherTheirs]].forEach(([id, l, r]) => {
      const plan = planPieceMerge({ local: l, remote: r, base: device.accounts[USER].pieces[id].parts });
      device = withPieceHeld(device, USER, id, plan.conflicts.map((c) => ({ part: c.part, kind: c.kind, local: c.localFingerprint, remote: c.remoteFingerprint, base: c.baseFingerprint })));
    });
    const both = accountRecordFor(device, USER);
    const rows = { pieces: [acctRow(theirs, 2), acctRow(otherTheirs, 2)], technique: null };
    const local = { p1: mine, p2: otherMine };
    const items = planSettle({ candidates: accountRowsToCandidates(rows), localPieces: local, accountRecord: both }).items;
    assert.deepEqual(items.map((i) => i.id), ["p1", "p2"]);
    const second = items[1];
    const out = rereadSettleItem({ item: second, rows, localPieces: local, accountRecord: both });
    assert.equal(out.outcome, "apply");
    assert.equal(out.item.id, "p2", "the second piece, not the first");
    assert.equal(out.item.candidate.id, "p2");
  });

  test("asking again changes nothing: not the record, not the pieces, not the rows it was handed", () => {
    const rows = [acctRow(practicedMore(theirs, ["c1"], 4, 150), 3)];
    const local = { p1: mine };
    const snapshot = JSON.stringify({ rows, local, rec });
    rereadSettleItem({ item: asked(), rows: { pieces: rows, technique: null }, localPieces: local, accountRecord: rec });
    assert.equal(JSON.stringify({ rows, local, rec }), snapshot);
    assert.equal(local.p1, mine);
  });
});
