// Pass 121 follow-up (src/lib/settleFlow.js): the walk through one held piece's
// questions as plain data. Two halves: small hand-made questions for each rule of the
// walk (what comes next, what Back does, what the summary says, that NOTHING is
// applied before the summary), and real pieces for practice that is combined instead of
// asked about, and for the account moving on while the person decides.
// (The first screen for several practice records, and the question about one, were deleted
// on 2026-10-31: since Pass 126 the engine combines practice both devices logged.)
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

describe("where the walk starts (Pass 121 follow-up)", () => {
  test("the first question, or 'ready' when nothing is left to decide", () => {
    assert.equal(startSettle(itemOf([field("a", "A"), field("b", "B")])).stage, "question");
    assert.equal(startSettle(itemOf([wholePiece()])).stage, "question");
    assert.equal(startSettle(itemOf([], "ready")).stage, "ready");
    assert.equal(startSettle(itemOf([field("a", "A")]), "why").notice, "why");
    assert.deepEqual(startSettle(itemOf([field("a", "A")])), { stage: "question", index: 0, answers: {}, notice: null });
  });
});

describe("one question at a time, Back, and the summary (Pass 121 follow-up)", () => {
  const three = itemOf([field("targetDate", "Target date"), field("notes", "Notes"), field("name", "Name")]);

  test("Next needs an answer that is one of the question's own options; anything else does nothing", () => {
    let st = startSettle(three);
    assert.equal(settleCanNext(three, st), false, "the first question needs an answer");
    assert.equal(settleChoose(three, st, "maybe"), st);
    assert.equal(settleChoose(three, st, "both"), st, "'both' is not an option for anything now: it was only ever for a practice record");
    assert.deepEqual(settleNext(three, st), { state: st, applies: false });
    st = settleChoose(three, st, "local");
    assert.equal(settleCanNext(three, st), true);
    assert.equal(settleChoose(itemOf([], "ready"), startSettle(itemOf([], "ready")), "local").stage, "ready", "'ready' has nothing to choose");
  });

  test("Back: to the previous question, from the summary to the last question with its answer kept, and nowhere from the first question or 'ready'", () => {
    const two = itemOf([field("a", "A"), field("b", "B")]);
    let st = startSettle(two);
    assert.equal(settleCanBack(two, st), false, "nowhere to go from the first question");
    assert.equal(settleBack(two, st), st);
    st = settleNext(two, settleChoose(two, st, "local")).state;
    assert.equal(settleBack(two, st).index, 0);
    st = settleNext(two, settleChoose(two, st, "remote")).state;
    assert.equal(st.stage, "recap");
    assert.deepEqual([settleBack(two, st).stage, settleBack(two, st).index], ["question", 1], "back from the summary is the LAST question, answer kept");
    assert.equal(settleBack(two, st).answers.b, "remote");
    // 'ready' has nowhere to go back to either
    assert.equal(settleCanBack(itemOf([], "ready"), startSettle(itemOf([], "ready"))), false);
  });

  test("NOTHING is applied before the summary (or 'ready'): every earlier step says applies: false, on every path", () => {
    const items = [three, itemOf([wholePiece()]), itemOf([field("a", "A")]), itemOf([field("a", "A"), field("b", "B"), field("c", "C"), field("d", "D")])];
    items.forEach((item) => {
      let st = startSettle(item);
      let steps = 0;
      for (;;) {
        if (st.stage === "question") st = settleChoose(item, st, item.questions[st.index].options[0].value);
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
    const ready = itemOf([], "ready");
    assert.deepEqual(settleNext(ready, startSettle(ready)), { state: startSettle(ready), applies: true }, "'ready' is the screen that asks 'Bring it up to date?'");
    // a summary that is not fully answered does not apply (cannot happen through the buttons, but the rule is here)
    assert.equal(settleNext(three, { ...startSettle(three), stage: "recap" }).applies, false);
  });

  test("the summary names what is kept, and for the whole-piece question repeats what would be removed", () => {
    let st = startSettle(three);
    for (const value of ["remote", "local", "remote"]) st = settleNext(three, settleChoose(three, st, value)).state;
    assert.equal(st.stage, "recap");
    assert.deepEqual(keptPhrases(three, st), ["the other device's target date", "this device's notes", "the other device's name"]);
    const v = settleView(three, st);
    assert.deepEqual(v.recap.keeps, ["The other device's target date", "This device's notes", "The other device's name"]);
    assert.deepEqual(v.recap.warnings, [], "ordinary settings remove nothing");
    // the whole-piece question: each answer says plainly what goes with the side that is not kept
    const whole = itemOf([wholePiece()]);
    const w = settleNext(whole, settleChoose(whole, startSettle(whole), "local")).state;
    assert.deepEqual(removalWarnings(whole, w), ["Practice and changes made on your other device will be removed, from your account too. This can't be undone."]);
    assert.deepEqual(settleView(whole, w).recap.keeps, ["This device's whole piece"]);
    const w2 = settleNext(whole, settleChoose(whole, startSettle(whole), "remote")).state;
    assert.deepEqual(removalWarnings(whole, w2), ["Practice and changes made on this device will be removed. This can't be undone."]);
    assert.deepEqual(settleView(whole, w2).recap.warnings, removalWarnings(whole, w2), "the summary shows them");
  });

  test("what each screen shows: 'Question n of m', then the summary; or 'ready'", () => {
    let st = startSettle(three);
    let v = settleView(three, st);
    assert.equal(v.stage, "question");
    assert.equal(v.question.part, "targetDate");
    assert.equal(v.stepLabel, "Question 1 of 3");
    assert.equal(v.answer, null);
    assert.equal(v.primaryLabel, "Next");
    assert.equal(v.canNext, false);
    assert.equal(v.canBack, false);
    assert.equal(v.applies, false);
    st = settleChoose(three, st, "remote");
    assert.equal(settleView(three, st).answer, "remote");
    assert.equal(settleView(three, st).canNext, true);
    st = settleNext(three, st).state;
    assert.equal(settleView(three, st).stepLabel, "Question 2 of 3");
    assert.equal(settleView(three, st).question.part, "notes");
    assert.equal(settleView(three, st).canBack, true);
    // the summary
    for (const value of ["local", "local"]) st = settleNext(three, settleChoose(three, st, value)).state;
    v = settleView(three, st);
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
    [three, itemOf([wholePiece()]), itemOf([], "ready")].forEach((item) => {
      let st = startSettle(item);
      for (let i = 0; i < 12; i++) {
        const v = settleView(item, st);
        every.push(JSON.stringify(v));
        if (st.stage === "question") st = settleChoose(item, st, item.questions[st.index].options[0].value);
        const step = settleNext(item, st);
        if (step.applies) break;
        st = step.state;
      }
    });
    every.forEach((text) => assert.equal(/—/.test(text), false));
  });
});

describe("the same questions? (Pass 121 follow-up)", () => {
  const a = [field("targetDate", "Target date"), wholePiece()];
  const copy = () => JSON.parse(JSON.stringify(a));

  test("identical questions are the same; a different value, wording, flag, option or order is not", () => {
    assert.equal(sameSettleQuestions(a, copy()), true);
    assert.equal(sameSettleQuestions([], []), true);
    const changedValue = copy();
    changedValue[0].text = "Target date: Nov 2 on this device, b on your other device.";
    assert.equal(sameSettleQuestions(a, changedValue), false, "a value in the wording");
    const changedHint = copy();
    changedHint[1].options[1].hint = changedHint[1].options[1].hint.replace("this device", "that device");
    assert.equal(sameSettleQuestions(a, changedHint), false, "what an answer says it removes");
    const unflagged = copy();
    delete unflagged[1].options[1].removes;
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

describe("practice both devices logged is combined, so it is never asked about (Pass 126)", () => {
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

  test("four chunks practiced on both devices are not asked about: one question (the date, changed at the same moment on both), every session kept", () => {
    const planned = planSettle({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: heldRecord() });
    const item = planned.items[0];
    assert.deepEqual(item.questions.map((q) => q.part), ["targetDate"], "only the date: the four practice records are combined");
    assert.equal(item.questions.some((q) => q.kind === "progress"), false);
    let st = startSettle(item);
    assert.equal(st.stage, "question");
    st = settleNext(item, settleChoose(item, st, "local")).state;
    assert.equal(st.stage, "recap");
    const view = settleView(item, st);
    assert.deepEqual(view.recap.keeps, ["This device's target date"]);
    assert.deepEqual(view.recap.warnings, [], "nothing is removed: practice is combined, not chosen between");
    assert.equal(settleNext(item, st).applies, true);
    const out = applyAccountMerge({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: heldRecord(), selectedIds: ["p1"], includeTechnique: false, settle: { p1: st.answers } });
    assert.deepEqual(out.settledIds, ["p1"]);
    assert.deepEqual(out.unsettled, []);
    CHUNKS.forEach((id) => assert.deepEqual(durationsOf(out.pieces.p1, id), [60, 90, 120], `${id}: the first session and one from each device`));
    assert.equal(out.pieces.p1.targetDate, "2026-11-01");
    assert.equal(out.entries.p1.revision, 2);
  });

  test("whichever date is kept, no session goes with the other one", () => {
    const item = planSettle({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: heldRecord() }).items[0];
    const st = settleNext(item, settleChoose(item, startSettle(item), "remote")).state;
    const out = applyAccountMerge({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: heldRecord(), selectedIds: ["p1"], includeTechnique: false, settle: { p1: st.answers } });
    assert.deepEqual(out.settledIds, ["p1"]);
    CHUNKS.forEach((id) => assert.deepEqual(durationsOf(out.pieces.p1, id), [60, 90, 120], id));
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
    // (the same updatedAt: a later one would make the other device's change to the date the more recent one,
    // which settles it and leaves nothing to decide: a different case, below)
    const moved = validateAndMigratePiece({ ...viaJson(theirs), notes: "added on the other device since" });
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
      settle: { p1: { targetDate: "local" } },
    });
    assert.deepEqual(applied.settledIds, ["p1"]);
    assert.equal(applied.entries.p1.revision, 3);
    assert.equal(applied.pieces.p1.notes, "added on the other device since", "the change that did not conflict came with it");
    assert.deepEqual(durationsOf(applied.pieces.p1, "c1"), [60, 90, 120]);
  });

  test("another session was logged on the other device: practice is combined, not asked, so nothing the person decided on changed and the new session comes with it", () => {
    const more = practicedMore(theirs, ["c1"], 4, 150, { updatedAt: theirs.updatedAt });
    const out = reread([acctRow(more, 3)]);
    assert.equal(out.outcome, "apply");
    assert.equal(out.item.revision, 3);
    assert.deepEqual(out.item.questions.map((q) => q.part), ["targetDate"]);
    const applied = applyAccountMerge({
      candidates: { pieces: [out.item.candidate], deleted: [], unreadable: [], technique: { technique: null, revision: null, unreadable: false, skippedItems: 0 } },
      localPieces: { p1: mine },
      accountRecord: rec,
      selectedIds: ["p1"],
      includeTechnique: false,
      settle: { p1: { targetDate: "local" } },
    });
    assert.deepEqual(durationsOf(applied.pieces.p1, "c1"), [60, 90, 120, 150], "this device's, the first, and both of the other device's");
  });

  test("the other device changed the value being decided, at the same moment: asked again with the new value", () => {
    const again = validateAndMigratePiece({ ...viaJson(theirs), targetDate: "2026-12-24" });
    const out = reread([acctRow(again, 3)]);
    assert.equal(out.outcome, "again");
    assert.match(out.item.questions.find((q) => q.part === "targetDate").text, /Dec 24/);
  });

  test("the other device changed the value being decided, LATER than this device did: the more recent change settles it, nothing is left to ask, and the person is told", () => {
    const later = validateAndMigratePiece({ ...viaJson(theirs), targetDate: "2026-12-24", updatedAt: theirs.updatedAt + 500 });
    const out = reread([acctRow(later, 3)]);
    assert.equal(out.outcome, "again");
    assert.equal(out.item.status, "ready");
    assert.deepEqual(out.item.questions, []);
    assert.match(out.notice, /nothing is left to decide now/);
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
