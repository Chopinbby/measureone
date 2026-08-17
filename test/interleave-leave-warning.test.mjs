// Tests for the "leave Interleaved mode with an unresolved provisional
// log" warning (user-directed follow-up to Pass 30's provisional-logging
// feature): App.jsx's confirmAndDiscardProvisional and
// guardLeavingInterleaved.
//
// Both are closures inside the App component, not exported pure
// functions, and this repo has no React render harness — same constraint
// documented in session-undo.test.mjs and the other interleave-*.test.mjs
// files. The mirrors below are line-for-line copies of App.jsx's actual
// bodies as of this pass. `window.confirm` doesn't exist in Node's test
// runner either way, so both mirrors take the confirm implementation as a
// parameter instead of calling the global directly — what's under test is
// the branching logic (when to prompt, when to discard, when to skip
// both), not a reimplementation of the browser dialog.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const WARNING_TEXT = "Practice data is tracked but not logged. Are you sure you want to leave before logging your progress?";

// Mirrors App.jsx's confirmAndDiscardProvisional, with `confirmImpl` standing
// in for `window.confirm` and `discardImpl` standing in for
// handleDiscardProvisionalSession.
function makeConfirmAndDiscardProvisional(confirmImpl, discardImpl) {
  return (chunkIds, day) => {
    if (!chunkIds || chunkIds.length === 0) return true;
    const ok = confirmImpl(WARNING_TEXT);
    if (ok) chunkIds.forEach((id) => discardImpl(id, day));
    return ok;
  };
}

// Mirrors App.jsx's guardLeavingInterleaved.
function makeGuardLeavingInterleaved(interleaveRisk, confirmAndDiscardProvisional) {
  return () => {
    if (!interleaveRisk) return true;
    return confirmAndDiscardProvisional(interleaveRisk.chunkIds, interleaveRisk.day);
  };
}

describe("confirmAndDiscardProvisional", () => {
  test("with no pending chunk ids, returns true immediately without prompting or discarding anything", () => {
    let confirmCalls = 0;
    const discardCalls = [];
    const fn = makeConfirmAndDiscardProvisional(
      () => {
        confirmCalls++;
        return true;
      },
      (id, day) => discardCalls.push([id, day])
    );
    assert.equal(fn([], 5), true);
    assert.equal(fn(null, 5), true);
    assert.equal(fn(undefined, 5), true);
    assert.equal(confirmCalls, 0, "no reason to prompt when nothing is pending");
    assert.deepEqual(discardCalls, []);
  });

  test("prompts with the exact requested wording", () => {
    let promptedWith = null;
    const fn = makeConfirmAndDiscardProvisional(
      (msg) => {
        promptedWith = msg;
        return true;
      },
      () => {}
    );
    fn(["c1"], 5);
    assert.equal(promptedWith, WARNING_TEXT);
  });

  test("on confirm, discards every pending chunk id against the given day, and returns true", () => {
    const discardCalls = [];
    const fn = makeConfirmAndDiscardProvisional(
      () => true,
      (id, day) => discardCalls.push([id, day])
    );
    const result = fn(["c1", "c2", "c3"], 7);
    assert.equal(result, true);
    assert.deepEqual(discardCalls, [
      ["c1", 7],
      ["c2", 7],
      ["c3", 7],
    ]);
  });

  test("on cancel, discards NOTHING and returns false — a cancelled leave must not lose data", () => {
    const discardCalls = [];
    const fn = makeConfirmAndDiscardProvisional(
      () => false,
      (id, day) => discardCalls.push([id, day])
    );
    const result = fn(["c1", "c2"], 7);
    assert.equal(result, false);
    assert.deepEqual(discardCalls, [], "cancelling must leave every provisional session exactly as it was");
  });
});

describe("guardLeavingInterleaved", () => {
  test("with no risk (null), returns true without ever calling confirmAndDiscardProvisional", () => {
    let called = false;
    const guard = makeGuardLeavingInterleaved(null, () => {
      called = true;
      return true;
    });
    assert.equal(guard(), true);
    assert.equal(called, false);
  });

  test("with risk present, delegates to confirmAndDiscardProvisional with the risk's chunkIds and day", () => {
    let receivedArgs = null;
    const guard = makeGuardLeavingInterleaved({ chunkIds: ["c1", "c2"], day: 9 }, (chunkIds, day) => {
      receivedArgs = [chunkIds, day];
      return true;
    });
    assert.equal(guard(), true);
    assert.deepEqual(receivedArgs, [["c1", "c2"], 9]);
  });

  test("propagates a cancel (false) straight through, so the caller knows not to navigate", () => {
    const guard = makeGuardLeavingInterleaved({ chunkIds: ["c1"], day: 3 }, () => false);
    assert.equal(guard(), false);
  });
});
