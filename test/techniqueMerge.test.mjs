// Pass 118: merging the technique library by part (src/lib/techniqueMerge.js).
// The engine only: pure functions, nothing wired into the app. Two halves:
// small hand-made libraries for each rule, and a seeded, deterministic
// simulation of two devices that start from one library, edit it offline in
// random ways (shaped like the app's own handlers) and sync in random orders,
// checking the invariants after every merge.
//
// TZ pinned to a DST-observing zone, same reason as technique.test.mjs: the
// engine's date math goes through local-midnight date strings.
process.env.TZ = "America/Denver";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { validateAndMigrateTechnique, normalizeTechniqueItem, mergeImportedTechnique } from "../src/lib/storage.js";
import {
  resolveMethods,
  buildDayList,
  completeTask,
  uncompleteTask,
  topUpDayList,
  removeUnfinishedTask,
  changeCheckOctaves,
  nextWalkPosition,
  effectiveWalkPosition,
  walkStepPast,
  pitchClass,
  WALK_KEYS,
} from "../src/lib/technique.js";
import {
  planTechniqueMerge,
  techniqueParts,
  techniquePartFingerprints,
  techniquePartKey as K,
  canonicalTechnique,
  techniqueItemTitle,
  stampChangedTechnique,
} from "../src/lib/techniqueMerge.js";
import { fingerprint as pieceMergeFingerprint } from "../src/lib/pieceMerge.js";
import { partTime } from "../src/lib/settingTimes.js";
import { fingerprint as accountFingerprint, canonicalTechnique as accountCanonicalTechnique } from "../src/lib/accountSync.js";
import { itemTitle } from "../src/components/tabs/technique/format.js";
import { addDaysISO } from "../src/lib/utils.js";

/* ------------------------------------------------------------------ */
/*  Helpers: libraries, the app's own handlers, a seeded random source */
/* ------------------------------------------------------------------ */

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => isDeepStrictEqual(clone(a), clone(b));
const reload = (t) => validateAndMigrateTechnique(clone(t));

const DAY1 = "2026-10-05"; // a Monday
const DAY2 = "2026-10-06";
const DAY3 = "2026-10-07";

function scale(id, tonic, quality, extra = {}) {
  return normalizeTechniqueItem({ id, form: "scale", tonic, quality, minorForm: quality === "minor" ? "harmonic" : null, ...extra });
}
const task = (itemId, extra = {}) => ({ itemId, methodIds: ["eyes", "dotted", "pf"], done: false, tier: "walk", tempo: null, ...extra });

// Six scales in six neighbouring keys of the walk: C, A minor, G, E minor, D, B minor
// (walk positions 0 to 5), so a step of the walk always lands on a key with a scale.
function library(over = {}) {
  return validateAndMigrateTechnique({
    schemaVersion: 1,
    items: [scale("c", "C", "major"), scale("a", "A", "minor"), scale("g", "G", "major"), scale("e", "E", "minor"), scale("d", "D", "major"), scale("b", "B", "minor")],
    walkPosition: 0,
    settings: { scalesPerDay: 3, minutesPerScale: 5 },
    updatedAt: 1,
    ...over,
  });
}
const withList = (over = {}) => library({ dayList: { date: DAY1, tasks: [task("c"), task("a"), task("g")] }, ...over });

let stamp = 1000;
const stamped = (t) => reload({ ...t, updatedAt: ++stamp });
const engineState = (t) => ({
  items: t.items,
  methods: resolveMethods(t.methodState, t.customMethods),
  methodLastUsed: t.methodLastUsed,
  walkPosition: t.walkPosition,
  previousList: t.dayList,
  repertoireKeys: [],
});
const withTopUp = (t) => (t.dayList ? { ...t, dayList: topUpDayList(engineState(t), t.dayList, t.dayList.date, t.settings.scalesPerDay) } : t);

// Each of these does what App.jsx's handler of the same name does.
const complete = (t, id, tempo = null) => {
  const o = completeTask({ items: t.items, dayList: t.dayList, methodLastUsed: t.methodLastUsed, walkPosition: t.walkPosition }, id, t.dayList.date, tempo, ++stamp);
  return stamped({ ...t, items: o.items, dayList: o.dayList, methodLastUsed: o.methodLastUsed, walkPosition: o.walkPosition });
};
const uncheck = (t, id) => {
  const o = uncompleteTask({ items: t.items, dayList: t.dayList, methodLastUsed: t.methodLastUsed, walkPosition: t.walkPosition }, id);
  return stamped({ ...t, items: o.items, dayList: o.dayList, methodLastUsed: o.methodLastUsed, walkPosition: o.walkPosition });
};
const toggleStar = (t, id) => stamped({ ...t, items: t.items.map((it) => (it.id === id ? { ...it, starred: !it.starred } : it)) });
const toggleRotation = (t, id) => {
  const next = { ...t, items: t.items.map((it) => (it.id === id ? { ...it, inRotation: !it.inRotation } : it)) };
  const nowOn = next.items.find((it) => it.id === id).inRotation;
  return stamped(withTopUp(nowOn ? next : { ...next, dayList: removeUnfinishedTask(next.dayList, id) }));
};
const editItem = (t, id, patch) => stamped({ ...t, items: t.items.map((it) => (it.id === id ? normalizeTechniqueItem({ ...it, ...patch }) || it : it)) });
const setCheckOctaves = (t, id, n, choice) => {
  const r = changeCheckOctaves(t.items.find((it) => it.id === id), n, choice);
  return r.status === "applied" ? stamped({ ...t, items: t.items.map((it) => (it.id === id ? r.item : it)) }) : t;
};
const addScale = (t, id, tonic, quality, extra = {}) => stamped(withTopUp({ ...t, items: [...t.items, scale(id, tonic, quality, extra)] }));
const setSetting = (t, name, value) => stamped({ ...t, settings: { ...t.settings, [name]: value } });
const toggleMethodStar = (t, mid) => {
  const cur = t.methodState[mid] || { starred: false, enabled: true };
  return stamped({ ...t, methodState: { ...t.methodState, [mid]: { ...cur, starred: !cur.starred } } });
};
const toggleMethodOn = (t, mid) => {
  const cur = t.methodState[mid] || { starred: false, enabled: true };
  return stamped({ ...t, methodState: { ...t.methodState, [mid]: { ...cur, enabled: !cur.enabled } } });
};
const addCustomMethod = (t, id, name) =>
  stamped({ ...t, customMethods: [...t.customMethods, { id, name, technique: "Rhythm", description: "", appliesTo: "both", custom: true }] });
// A new day: the list the app's effect builds, carrying unfinished tasks over.
const newDay = (t, date) => stamped({ ...t, dayList: buildDayList(engineState(t), date, t.settings.scalesPerDay) });
const onDay = (t, date, tasks) => stamped({ ...t, dayList: { date, tasks } });

const merge = (local, remote, base) => planTechniqueMerge({ local, remote, base: techniquePartFingerprints(base) });
// Runs a merge with each of the two libraries as "this device".
function bothWays(base, a, b, check) {
  check(merge(a, b, base), "this device holds A");
  check(merge(b, a, base), "this device holds B");
}
const sameParts = (a, b) => same(techniquePartFingerprints(a), techniquePartFingerprints(b));
const item = (t, id) => t.items.find((it) => it.id === id);
const taskOf = (t, id) => (t.dayList ? t.dayList.tasks.find((x) => x.itemId === id) : undefined);

// mulberry32: a small seeded generator, so a run is a pure function of its seed.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickOf = (rng, list) => list[Math.floor(rng() * list.length)];
const intIn = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

/* ------------------------------------------------------------------ */
/*  The parts of a library                                             */
/* ------------------------------------------------------------------ */

describe("parts of the technique library (Pass 118)", () => {
  const rich = () => {
    let t = withList({
      methodState: { eyes: { starred: true, enabled: true }, pf: { starred: false, enabled: false }, dotted: { starred: false, enabled: true } },
      customMethods: [{ id: "m_x", name: "Mine", technique: "Rhythm", description: "", appliesTo: "both", custom: true }],
    });
    t = toggleStar(t, "a");
    t = complete(t, "c", 90);
    return t;
  };

  test("every kind of part is there for a library that uses it, and a part holding its default is left out", () => {
    const parts = techniqueParts(rich());
    [
      K.scale("c"), K.octaves("c"), K.hands("c"), K.check("c"), K.lastPracticed("c"), K.practicedOn("c", DAY1), K.usedOn("c", "eyes"), K.usedOn("c", "dotted"), K.usedOn("c", "pf"),
      K.starred("a"), K.methodStarred("eyes"), K.methodOn("pf"), K.customMethod("m_x"), K.setting("scalesPerDay"), K.setting("minutesPerScale"), K.walk,
      K.taskDone(DAY1, "c"), K.taskPlan(DAY1, "c"), K.taskPlan(DAY1, "a"), K.taskPlan(DAY1, "g"),
    ].forEach((k) => assert.ok(k in parts, `has ${k}`));
    assert.equal(K.starred("c") in parts, false, "a scale that isn't starred");
    assert.equal(K.rotation("c") in parts, false, "a scale that's switched on");
    assert.equal(K.lastPracticed("g") in parts, false, "a scale never practiced");
    assert.equal(K.usedOn("g", "eyes") in parts, false, "nothing used on it yet");
    assert.equal(K.taskDone(DAY1, "a") in parts, false, "a task that isn't done");
    assert.equal(K.methodStarred("dotted") in parts, false, "a method with an entry that holds the defaults is the same as no entry");
    assert.equal(K.methodOn("eyes") in parts, false);
    assert.equal(parts[K.walk], 1, "the walk stepped when c was done");
  });

  test("stamps are not parts, and the walk, the settings and each task's plan are", () => {
    const keys = Object.keys(techniqueParts(rich()));
    assert.equal(keys.some((k) => /updatedAt|schemaVersion/.test(k)), false);
    assert.ok(keys.includes("walk"));
  });

  test("a fingerprint is the same label fingerprint() gives the same value (one hash, defined once)", () => {
    const lib = rich();
    const fp = techniquePartFingerprints(lib);
    assert.equal(fp[K.walk], pieceMergeFingerprint(1));
    assert.equal(fp[K.walk], accountFingerprint(1));
    assert.equal(fp[K.octaves("c")], pieceMergeFingerprint(2));
    const c = item(lib, "c");
    assert.equal(typeof c.lastCheckedAt, "number", "a tempo logged through the app's handler saves the exact time");
    assert.equal(fp[K.check("c")], pieceMergeFingerprint({ evenTempo: 90, lastCheckedDate: DAY1, lastCheckedAt: c.lastCheckedAt, checkOctaves: 2 }));
  });

  test("the parts are the same after a reload and whatever order the keys come in", () => {
    const t = rich();
    const shuffled = (v) =>
      Array.isArray(v) ? v.map(shuffled) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, shuffled(v[k])])) : v;
    assert.deepEqual(techniquePartFingerprints(reload(t)), techniquePartFingerprints(t));
    assert.deepEqual(techniquePartFingerprints(shuffled(clone(t))), techniquePartFingerprints(t));
    // and a task the app has just built (no tempo yet) is the same as after a reload
    const inSession = clone(t);
    delete inSession.dayList.tasks[1].tempo;
    assert.deepEqual(techniquePartFingerprints(inSession), techniquePartFingerprints(t));
  });

  test("changing one thing changes exactly the parts it should", () => {
    const t = withList();
    const changed = (a, b) => {
      const x = techniquePartFingerprints(a);
      const y = techniquePartFingerprints(b);
      return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]).sort();
    };
    assert.deepEqual(changed(t, toggleStar(t, "e")), [K.starred("e")]);
    assert.deepEqual(changed(t, editItem(t, "e", { octaves: 3 })), [K.octaves("e")]);
    assert.deepEqual(changed(t, editItem(t, "e", { hands: "thirds" })), [K.hands("e")]);
    assert.deepEqual(changed(t, setSetting(t, "scalesPerDay", 4)), [K.setting("scalesPerDay")]);
    assert.deepEqual(changed(t, toggleMethodStar(t, "eyes")), [K.methodStarred("eyes")]);
    assert.deepEqual(changed(t, addCustomMethod(t, "m1", "New")), [K.customMethod("m1")]);
    // a bare check-off: the task, the practice of that scale, the methods used, the walk
    assert.deepEqual(changed(t, complete(t, "c")), [K.lastPracticed("c"), K.practicedOn("c", DAY1), K.taskDone(DAY1, "c"), K.usedOn("c", "eyes"), K.usedOn("c", "dotted"), K.usedOn("c", "pf"), K.walk].sort());
    // a check with a tempo also changes the tempo check
    assert.ok(changed(t, complete(t, "c", 80)).includes(K.check("c")));
    assert.deepEqual(changed(t, t), []);
  });

  test("a library with no list and no scales still has a few parts, so a recorded base is never empty", () => {
    const parts = techniquePartFingerprints(validateAndMigrateTechnique({ schemaVersion: 1, items: [] }));
    assert.deepEqual(Object.keys(parts).sort(), [K.setting("minutesPerScale"), K.setting("scalesPerDay"), K.walk].sort());
  });

  test("the title used in a notice is the app's own wording", () => {
    [
      scale("1", "D", "major"),
      scale("2", "G", "minor"),
      scale("3", "F#", "major", { form: "arpeggio" }),
      scale("4", "Eb", "minor", { form: "arpeggio" }),
      scale("5", "Bb", "major"),
      scale("6", "C#", "minor", { minorForm: "melodic" }),
    ].forEach((it) => assert.equal(techniqueItemTitle(it), itemTitle(it)));
  });

  test("canonicalTechnique is the one the account code uses (defined once, re-exported)", () => {
    assert.equal(accountCanonicalTechnique, canonicalTechnique);
    assert.equal(canonicalTechnique(null), null);
    assert.deepEqual(canonicalTechnique([1]), [1]);
  });
});

/* ------------------------------------------------------------------ */
/*  What a merge says about itself                                     */
/* ------------------------------------------------------------------ */

describe("merging the technique library: the statuses (Pass 118)", () => {
  test("identical libraries: nothing to do, this device's library comes back untouched", () => {
    const a = withList();
    const b = reload(a);
    const r = merge(a, b, a);
    assert.equal(r.status, "identical");
    assert.equal(r.merged, a);
    assert.deepEqual(r.notices, []);
  });

  test("two libraries that differ only in updatedAt are identical (a stamp is not a change)", () => {
    const a = withList();
    assert.equal(merge(a, { ...a, updatedAt: 99999 }, a).status, "identical");
  });

  test("a library with no recorded parts asks (it can't tell who changed what), and says why", () => {
    const a = withList(), b = toggleStar(a, "c");
    ["no-base"].forEach((reason) => {
      [undefined, null, {}].forEach((base) => {
        const r = planTechniqueMerge({ local: a, remote: b, base });
        assert.equal(r.status, "ask");
        assert.equal(r.reason, reason);
        assert.equal(r.merged, a);
      });
    });
  });

  test("something that isn't a library never merges", () => {
    const a = withList();
    [null, undefined, "x", [1]].forEach((bad) => {
      assert.equal(planTechniqueMerge({ local: a, remote: bad, base: {} }).reason, "not-libraries");
      assert.equal(planTechniqueMerge({ local: bad, remote: a, base: {} }).reason, "not-libraries");
    });
  });

  test("when the remote library is what the base was, this device's library comes back untouched", () => {
    const base = withList();
    const mine = complete(toggleStar(base, "e"), "c", 85);
    const r = merge(mine, reload(base), base);
    assert.equal(r.status, "local-only");
    assert.equal(r.merged, mine, "the very same object");
    assert.deepEqual(r.notices, []);
  });

  test("when this device hasn't changed anything, the remote's changes are simply taken", () => {
    const base = withList();
    const theirs = complete(toggleStar(base, "e"), "c", 85);
    const r = merge(reload(base), theirs, base);
    assert.equal(r.status, "merged");
    assert.ok(sameParts(r.merged, theirs));
    assert.deepEqual(r.notices, []);
    assert.deepEqual(r.fromLocal, []);
  });

  test("the inputs are never changed, and the result shares nothing with them", () => {
    const base = withList();
    const a = complete(base, "c", 80), b = toggleStar(base, "e");
    const inputs = { local: clone(a), remote: clone(b), base: clone(techniquePartFingerprints(base)) };
    const r = planTechniqueMerge({ local: a, remote: b, base: techniquePartFingerprints(base) });
    assert.ok(same(a, inputs.local) && same(b, inputs.remote));
    r.merged.items[0].starred = true;
    r.merged.dayList.tasks[0].methodIds.push("zzz");
    assert.ok(same(a, inputs.local) && same(b, inputs.remote), "changing the result changes neither input");
  });

  test("the merged library is already in the form a reload gives it, with the later updatedAt", () => {
    const base = withList();
    const a = complete(base, "c", 80), b = toggleStar(base, "e");
    const r = merge(a, b, base);
    assert.ok(same(r.merged, validateAndMigrateTechnique(clone(r.merged))));
    assert.equal(r.merged.updatedAt, Math.max(a.updatedAt, b.updatedAt));
  });

  test("the same inputs give the same result", () => {
    const base = withList();
    const a = complete(base, "c", 80), b = editItem(toggleStar(base, "e"), "c", { octaves: 3 });
    assert.ok(same(merge(a, b, base), merge(clone(a), clone(b), base)));
  });
});

/* ------------------------------------------------------------------ */
/*  Rule 1: scales are never removed                                   */
/* ------------------------------------------------------------------ */

describe("scales and methods are never removed by a merge (Pass 118)", () => {
  test("a scale added on either side is added", () => {
    const base = withList();
    const a = addScale(base, "x1", "F", "major");
    const b = addScale(base, "x2", "Bb", "major");
    bothWays(base, a, b, (r, who) => {
      const ids = r.merged.items.map((i) => i.id);
      assert.ok(ids.includes("x1") && ids.includes("x2"), who);
      assert.equal(new Set(ids).size, ids.length, "no id twice");
      assert.equal(r.merged.items.length, base.items.length + 2, who);
    });
  });

  test("the same scale added independently on both devices stays as two (they have different ids; nothing is combined or lost)", () => {
    const base = withList();
    const a = addScale(base, "x1", "F", "major");
    const b = addScale(base, "y9", "F", "major");
    const r = merge(a, b, base);
    assert.equal(r.merged.items.filter((i) => i.tonic === "F").length, 2);
  });

  test("a scale one side doesn't have is kept even if the base had it (nothing removes one)", () => {
    const base = withList();
    const lacking = { ...base, items: base.items.filter((i) => i.id !== "e") };
    const bothWaysCheck = (r) => assert.ok(r.merged.items.some((i) => i.id === "e"));
    bothWays(base, lacking, toggleStar(base, "e"), bothWaysCheck);
    bothWays(base, lacking, base, (r) => assert.ok(r.merged.items.some((i) => i.id === "e") || r.status === "local-only"));
    // and its values are the side's that has it
    const r = merge(lacking, toggleStar(base, "e"), base);
    assert.equal(item(r.merged, "e").starred, true);
  });

  test("switching a scale off is a setting: it travels, and the other side's unrelated change stays", () => {
    const base = withList();
    const off = toggleRotation(base, "e");
    const other = toggleStar(base, "e");
    bothWays(base, off, other, (r, who) => {
      assert.equal(item(r.merged, "e").inRotation, false, who);
      assert.equal(item(r.merged, "e").starred, true, who);
    });
  });

  test("an unfinished task of a scale switched off on one side leaves today's list; a done one stays as a record", () => {
    const base = withList();
    const off = toggleRotation(base, "g"); // g has an unfinished task
    const other = complete(base, "a"); // the other device did something else
    bothWays(base, off, other, (r, who) => {
      assert.equal(taskOf(r.merged, "g"), undefined, who);
      assert.equal(taskOf(r.merged, "a").done, true, who);
    });
    // a done task stays
    const done = complete(base, "g");
    const offAfter = toggleRotation(done, "g");
    assert.ok(taskOf(offAfter, "g").done, "the app keeps a done task of a scale switched off");
    bothWays(done, offAfter, toggleStar(done, "e"), (r) => assert.ok(taskOf(r.merged, "g").done));
  });

  test("custom methods are added from either side; method stars and switches merge by part", () => {
    const base = withList();
    const a = toggleMethodStar(addCustomMethod(base, "m_a", "Alpha"), "eyes");
    const b = toggleMethodOn(addCustomMethod(base, "m_b", "Beta"), "pf");
    bothWays(base, a, b, (r, who) => {
      const m = r.merged;
      assert.deepEqual(m.customMethods.map((x) => x.id).sort(), ["m_a", "m_b"], who);
      assert.equal(m.methodState.eyes.starred, true, who);
      assert.equal(m.methodState.pf.enabled, false, who);
      assert.deepEqual(r.notices, [], "nothing of either was dropped");
    });
  });

  test("the same method starred on both sides is agreement, and one side unstarring what the other left alone travels", () => {
    const base = toggleMethodStar(withList(), "eyes"); // starred in the base
    const both = merge(toggleMethodStar(toggleMethodStar(base, "eyes"), "chain"), toggleMethodStar(toggleMethodStar(base, "eyes"), "chain"), base);
    assert.ok(both.status === "identical");
    const a = toggleMethodStar(base, "eyes"); // unstarred here
    const r = merge(a, toggleMethodStar(base, "chain"), base);
    assert.equal(r.merged.methodState.eyes.starred, false);
    assert.equal(r.merged.methodState.chain.starred, true);
  });
});

/* ------------------------------------------------------------------ */
/*  Rule 2: a scale's settings                                         */
/* ------------------------------------------------------------------ */

describe("a scale's settings merge by part (Pass 118)", () => {
  test("different settings of the same scale changed on the two sides are both kept, with no notice", () => {
    const base = withList();
    const a = editItem(toggleStar(base, "d"), "d", { hands: "sixths" });
    const b = editItem(base, "d", { octaves: 3 });
    bothWays(base, a, b, (r, who) => {
      const d = item(r.merged, "d");
      assert.equal(d.starred, true, who);
      assert.equal(d.hands, "sixths", who);
      assert.equal(d.octaves, 3, who);
      assert.deepEqual(r.notices, [], who);
    });
  });

  test("a setting changed on one side only is taken, whichever side this device is", () => {
    const base = withList();
    bothWays(base, editItem(base, "d", { octaves: 4 }), base, (r) => assert.equal(item(r.merged, "d").octaves, 4));
    bothWays(base, editItem(base, "d", { octaves: 4 }), toggleStar(base, "e"), (r) => assert.equal(item(r.merged, "d").octaves, 4));
  });

  test("a setting changed on both sides to the same value is agreement, not a conflict", () => {
    const base = withList();
    const r = merge(editItem(toggleStar(base, "e"), "d", { octaves: 3 }), editItem(base, "d", { octaves: 3 }), base);
    assert.equal(item(r.merged, "d").octaves, 3);
    assert.deepEqual(r.notices, []);
    assert.deepEqual(r.resolved, []);
    assert.ok(r.agreed.includes(K.octaves("d")));
  });

  test("changed on both to different values: the MORE RECENT change is kept (Pass 126), with a notice and no question", () => {
    const base = withList();
    const a = editItem(base, "d", { octaves: 3 }); // made first
    const b = editItem(base, "d", { octaves: 4 }); // made later
    // this device holds A, the account holds B, which is later: 4
    const r = merge(a, b, base);
    assert.equal(r.status, "merged");
    assert.equal(item(r.merged, "d").octaves, 4);
    assert.deepEqual(r.notices.map((n) => n.text), ["Your other device's change to D major was kept (it was made later)."]);
    assert.deepEqual(r.notices[0], { kind: "kept-more-recent", side: "remote", part: "scale", id: "d", title: "D major", fields: ["octaves"], text: "Your other device's change to D major was kept (it was made later)." });
    assert.deepEqual(r.resolved.map((x) => [x.part, x.kept, x.local, x.remote]), [[K.octaves("d"), "remote", 3, 4]]);
    // and the other way round, this device holds B, the later one: now THIS device's 4 is kept
    const back = merge(b, a, base);
    assert.equal(item(back.merged, "d").octaves, 4, "the later change wins whichever side holds it");
    assert.deepEqual(back.notices.map((n) => n.text), ["This device's change to D major was kept (it was made later)."]);
    assert.deepEqual(back.resolved.map((x) => x.kept), ["local"]);
  });

  test("at the same moment nothing says which is later: the account's value, as before", () => {
    const base = withList();
    const a = reload({ ...editItem(base, "d", { octaves: 3 }), updatedAt: 5000 });
    const b = reload({ ...editItem(base, "d", { octaves: 4 }), updatedAt: 5000 });
    assert.equal(item(merge(a, b, base).merged, "d").octaves, 4);
    assert.equal(item(merge(b, a, base).merged, "d").octaves, 3);
  });

  test("a dated note on the part beats the library's updatedAt: logging later does not win a setting that was changed earlier", () => {
    const base = withList();
    // this device changed the octaves at 2000 and then checked off tasks until 9000; the account's copy
    // changed them at 3000 and did nothing after. The octaves were last changed on the account's copy.
    const a = reload({ ...editItem(base, "d", { octaves: 3 }), updatedAt: 9000, partTimes: { [K.octaves("d")]: 2000 } });
    const b = reload({ ...editItem(base, "d", { octaves: 4 }), updatedAt: 3000, partTimes: { [K.octaves("d")]: 3000 } });
    const r = merge(a, b, base);
    assert.equal(item(r.merged, "d").octaves, 4);
    assert.equal(r.merged.partTimes[K.octaves("d")], 3000, "the merged library carries the moment that decided it");
    // without the notes the library's updatedAt stands in, and the later logging wins
    const plainA = reload({ ...editItem(base, "d", { octaves: 3 }), updatedAt: 9000 });
    const plainB = reload({ ...editItem(base, "d", { octaves: 4 }), updatedAt: 3000 });
    assert.equal(item(merge(plainA, plainB, base).merged, "d").octaves, 3);
    assert.equal(merge(plainA, plainB, base).merged.partTimes[K.octaves("d")], 9000, "the winner's updatedAt is written as its note");
  });

  test("two settings of one scale in conflict make one notice naming it once", () => {
    const base = withList();
    const a = editItem(base, "d", { octaves: 3, hands: "thirds" });
    const b = editItem(base, "d", { octaves: 4, hands: "sixths" });
    const r = merge(a, b, base);
    assert.equal(r.notices.length, 1);
    assert.deepEqual(r.notices[0].fields, ["hands", "octaves"]);
    assert.equal(item(r.merged, "d").hands, "sixths");
  });

  test("the notice says arpeggio and minor form the way the app does", () => {
    const base = library({ items: [scale("r", "Eb", "minor", { form: "arpeggio" })], walkPosition: 0 });
    const r = merge(editItem(base, "r", { octaves: 3 }), editItem(base, "r", { octaves: 4 }), base);
    assert.equal(r.notices[0].text, "Your other device's change to E♭ minor arpeggio was kept (it was made later).");
  });

  test("changing the check octaves keeps its tempo with them: one side only travels", () => {
    const base = complete(withList(), "c", 80);
    const keep = setCheckOctaves(base, "c", 3, "keep");
    const r = merge(toggleStar(base, "e"), keep, base);
    const c = item(r.merged, "c");
    assert.equal(c.checkOctaves, 3);
    assert.equal(c.evenTempo, 80);
  });
});

/* ------------------------------------------------------------------ */
/*  Rule 3: tempos, practiced dates, methods last used                 */
/* ------------------------------------------------------------------ */

describe("tempos, practiced dates and last-used methods (Pass 118)", () => {
  test("two checks of the same scale on different days: the newer check's tempo wins, from either side", () => {
    const base = withList();
    const a = complete(base, "c", 80); // DAY1
    const b = complete(onDay(base, DAY2, [task("c")]), "c", 90); // DAY2
    bothWays(base, a, b, (r, who) => {
      const c = item(r.merged, "c");
      assert.equal(c.evenTempo, 90, who);
      assert.equal(c.lastCheckedDate, DAY2, who);
      assert.deepEqual(c.practicedDates, [DAY1, DAY2], `both days were practiced (${who})`);
      assert.equal(c.lastPracticedDate, DAY2, who);
      assert.deepEqual(r.notices, [], "a newer check is the rule, not a dropped change");
    });
  });

  test("an empty tempo never replaces a real one, even from a newer check (a 'start fresh' keeps its date)", () => {
    const base = withList();
    const real = complete(base, "c", 80); // DAY1, 80
    const fresh = setCheckOctaves(complete(onDay(base, DAY2, [task("c")]), "c", 90), "c", 3, "fresh"); // DAY2, cleared
    assert.equal(item(fresh, "c").evenTempo, null);
    assert.equal(item(fresh, "c").lastCheckedDate, DAY2);
    bothWays(base, real, fresh, (r, who) => {
      const c = item(r.merged, "c");
      assert.equal(c.evenTempo, 80, who);
      assert.equal(c.lastCheckedDate, DAY1, who);
      assert.equal(c.checkOctaves, 2, "the octaves the kept tempo was measured over");
    });
  });

  test("on the same check date a real tempo beats an empty one", () => {
    const base = complete(withList(), "c", 70);
    const fresh = setCheckOctaves(base, "c", 3, "fresh"); // (null, DAY1, 3)
    const redone = complete(uncheck(base, "c"), "c", 95); // (95, DAY1, 2)
    bothWays(base, fresh, redone, (r, who) => assert.equal(item(r.merged, "c").evenTempo, 95, who));
  });

  test("a 'start fresh' on one side only travels (nothing changed the other side)", () => {
    const base = complete(withList(), "c", 80);
    const fresh = setCheckOctaves(base, "c", 3, "fresh");
    bothWays(base, fresh, toggleStar(base, "e"), (r, who) => {
      assert.equal(item(r.merged, "c").evenTempo, null, who);
      assert.equal(item(r.merged, "c").checkOctaves, 3, who);
    });
  });

  test("two different tempos on the same scale on the same day: the one logged LATER is kept, by the exact time saved with it", () => {
    const base = withList();
    const earlier = complete(base, "c", 80); // logged first
    const later = complete(base, "c", 90); // logged after it, on the other device
    assert.ok(item(later, "c").lastCheckedAt > item(earlier, "c").lastCheckedAt);
    // this device holds the earlier one: the later one is the account's, kept, with a notice
    const a = merge(earlier, later, base);
    assert.equal(item(a.merged, "c").evenTempo, 90);
    assert.deepEqual(a.notices.map((n) => [n.part, n.text]), [["tempo", "Your other device's tempo for C major was kept."]]);
    // this device holds the later one: it wins, nothing of this device's was dropped, so no notice
    const b = merge(later, earlier, base);
    assert.equal(item(b.merged, "c").evenTempo, 90);
    assert.deepEqual(b.notices, []);
    assert.equal(item(b.merged, "c").lastCheckedAt, item(later, "c").lastCheckedAt, "the time goes with the tempo it belongs to");
    assert.equal(item(a.merged, "c").lastCheckedAt, item(later, "c").lastCheckedAt);
    // whichever device logged later, not whichever synced first
    const flipped = merge(complete(base, "c", 95), earlier, base);
    assert.equal(item(flipped.merged, "c").evenTempo, 95);
  });

  test("a tempo with a saved time beats one saved before times existed; where neither has a time the account's is kept", () => {
    const base = withList();
    const noTime = (t) => stamped({ ...t, items: t.items.map((it) => (it.id === "c" ? { ...it, lastCheckedAt: null } : it)) });
    const timed = complete(base, "c", 90);
    const old80 = noTime(complete(base, "c", 80));
    const old70 = noTime(complete(base, "c", 70));
    assert.equal(item(old80, "c").lastCheckedAt, null);
    bothWays(base, timed, old80, (r, who) => assert.equal(item(r.merged, "c").evenTempo, 90, who));
    assert.equal(item(merge(old80, old70, base).merged, "c").evenTempo, 70, "nothing says which is later: the account's");
    assert.equal(item(merge(old70, old80, base).merged, "c").evenTempo, 80);
  });

  test("the same tempo on the same day on both sides: nothing was dropped, so no notice; the later time is kept", () => {
    const base = withList();
    const a = complete(base, "c", 88), b = complete(base, "c", 88);
    const r = merge(a, b, base);
    assert.equal(item(r.merged, "c").evenTempo, 88);
    assert.equal(item(r.merged, "c").lastCheckedAt, item(b, "c").lastCheckedAt);
    assert.deepEqual(r.notices, []);
  });

  test("a different check octaves on the same date with the same tempo is a plain notice about the scale", () => {
    const base = complete(withList(), "c", 80);
    const r = merge(setCheckOctaves(base, "c", 3, "keep"), setCheckOctaves(base, "c", 4, "keep"), base);
    assert.equal(item(r.merged, "c").checkOctaves, 4);
    assert.deepEqual(r.notices.map((n) => n.text), ["Your other device's change to C major was kept."]);
  });

  test("a practiced date added on either side is kept, and the last practiced date is the later one", () => {
    const base = withList();
    const a = complete(base, "c");
    const b = complete(onDay(base, DAY2, [task("c")]), "c");
    bothWays(base, a, b, (r, who) => {
      assert.deepEqual(item(r.merged, "c").practicedDates, [DAY1, DAY2], who);
      assert.equal(item(r.merged, "c").lastPracticedDate, DAY2, who);
    });
  });

  test("a date undone on one side only is gone, while a date the other side added is kept", () => {
    const base = complete(withList(), "c", 80); // DAY1 practiced in the base
    const undone = uncheck(base, "c");
    const later = complete(onDay(base, DAY2, [task("c")]), "c"); // adds DAY2, keeps DAY1
    bothWays(base, undone, later, (r, who) => {
      assert.deepEqual(item(r.merged, "c").practicedDates, [DAY2], `DAY1 was undone on one side only (${who})`);
      assert.equal(item(r.merged, "c").lastPracticedDate, DAY2, who);
    });
  });

  test("the last-used dates of methods: the later date for each method when both sides used them, and one side's change otherwise", () => {
    const base = withList();
    const a = complete(base, "c"); // eyes, dotted, pf on DAY1
    const b = complete(onDay(base, DAY2, [task("c", { methodIds: ["eyes", "chain", "cross"] })]), "c"); // DAY2
    bothWays(base, a, b, (r, who) => {
      assert.deepEqual(r.merged.methodLastUsed.c, { eyes: DAY2, dotted: DAY1, pf: DAY1, chain: DAY2, cross: DAY2 }, who);
    });
    bothWays(base, a, toggleStar(base, "e"), (r, who) => assert.deepEqual(r.merged.methodLastUsed.c, { eyes: DAY1, dotted: DAY1, pf: DAY1 }, who));
  });

  test("each method's last-used date is its own change: two devices that each undid a different use of the same scale lose both, and merging again changes nothing", () => {
    // found by the wide simulation (seed 2446): as one list per scale, the two sides' lists folded back
    // into exactly the base, so a second merge with the same remote flipped it again
    const used = (methods) => ({ c: Object.fromEntries(methods.map((m) => [m, DAY1])) });
    const base = withList({ methodLastUsed: used(["dotted", "qqee", "halfq", "pf"]) });
    const a = stamped({ ...base, methodLastUsed: used(["halfq", "pf"]) }); // this device undid the use of dotted and qqee
    const b = stamped({ ...base, methodLastUsed: used(["dotted", "qqee"]) }); // the other undid the use of halfq and pf
    bothWays(base, a, b, (r, who) => {
      assert.deepEqual(r.merged.methodLastUsed, {}, `both undone uses are gone (${who})`);
      const again = planTechniqueMerge({ local: r.merged, remote: who === "this device holds A" ? b : a, base: techniquePartFingerprints(base) });
      assert.ok(sameParts(again.merged, r.merged), `merging again changes nothing (${who})`);
    });
    // a use added on each side is kept, and a use undone on one side while the other adds another is gone
    const added = merge(stamped({ ...base, methodLastUsed: used(["dotted", "qqee", "halfq", "pf", "chain"]) }), stamped({ ...base, methodLastUsed: used(["dotted", "qqee", "halfq", "pf", "cross"]) }), base);
    assert.deepEqual(Object.keys(added.merged.methodLastUsed.c).sort(), ["chain", "cross", "dotted", "halfq", "pf", "qqee"]);
    const mixed = merge(stamped({ ...base, methodLastUsed: used(["qqee", "halfq", "pf"]) }), stamped({ ...base, methodLastUsed: used(["dotted", "qqee", "halfq", "pf", "cross"]) }), base);
    assert.deepEqual(Object.keys(mixed.merged.methodLastUsed.c).sort(), ["cross", "halfq", "pf", "qqee"]);
  });

  test("the methods' last-used dates follow an undo on one side only", () => {
    const base = complete(withList(), "c");
    bothWays(base, uncheck(base, "c"), toggleStar(base, "e"), (r, who) => assert.deepEqual(r.merged.methodLastUsed, {}, who));
  });
});

/* ------------------------------------------------------------------ */
/*  Rule 4: the settings                                               */
/* ------------------------------------------------------------------ */

describe("the settings merge by part (Pass 118)", () => {
  test("scales per day and minutes per scale are separate parts: one side's each", () => {
    const base = withList();
    bothWays(base, setSetting(base, "scalesPerDay", 4), setSetting(base, "minutesPerScale", 8), (r, who) => {
      assert.deepEqual(r.merged.settings, { scalesPerDay: 4, minutesPerScale: 8 }, who);
      assert.deepEqual(r.notices, []);
    });
  });

  test("the same setting changed to different values: the more recent change, with a notice", () => {
    const base = withList();
    const early = setSetting(base, "scalesPerDay", 4);
    const late = setSetting(base, "scalesPerDay", 2);
    const r = merge(early, late, base);
    assert.equal(r.merged.settings.scalesPerDay, 2);
    assert.deepEqual(r.notices.map((n) => n.text), ["Your other device's change to the number of scales a day was kept (it was made later)."]);
    const back = merge(late, early, base);
    assert.equal(back.merged.settings.scalesPerDay, 2, "whichever side holds the later change");
    assert.deepEqual(back.notices.map((n) => n.text), ["This device's change to the number of scales a day was kept (it was made later)."]);
    const m = merge(setSetting(base, "minutesPerScale", 7), setSetting(base, "minutesPerScale", 9), base);
    assert.equal(m.merged.settings.minutesPerScale, 9);
    assert.deepEqual(m.notices.map((n) => n.text), ["Your other device's change to the minutes per scale was kept (it was made later)."]);
  });
});

/* ------------------------------------------------------------------ */
/*  Rule 5: today's list                                               */
/* ------------------------------------------------------------------ */

describe("today's list (Pass 118)", () => {
  test("a task done on one side only is done, from either side", () => {
    const base = withList();
    bothWays(base, complete(base, "c", 80), toggleStar(base, "e"), (r, who) => {
      assert.equal(taskOf(r.merged, "c").done, true, who);
      assert.equal(taskOf(r.merged, "c").tempo, 80, who);
      assert.equal(r.list, "same-date");
    });
  });

  test("two different tasks done, one on each side: both are done", () => {
    const base = withList();
    bothWays(base, complete(base, "a"), complete(base, "g"), (r, who) => {
      assert.equal(taskOf(r.merged, "a").done && taskOf(r.merged, "g").done, true, who);
      assert.equal(taskOf(r.merged, "c").done, false, who);
    });
  });

  test("an undo on one side travels: done at the base, undone on one, untouched on the other", () => {
    const base = complete(withList(), "c", 80);
    const undone = uncheck(base, "c");
    bothWays(base, undone, toggleStar(base, "e"), (r, who) => {
      const m = r.merged;
      assert.equal(taskOf(m, "c").done, false, who);
      assert.equal(taskOf(m, "c").tempo, null, who);
      assert.equal(taskOf(m, "c").undo, undefined, who);
      const c = item(m, "c");
      assert.equal(c.evenTempo, null, who);
      assert.equal(c.lastCheckedDate, null, who);
      assert.deepEqual(c.practicedDates, [], who);
      assert.equal(c.lastPracticedDate, null, who);
      assert.equal(m.walkPosition, 0, `the walk went back with it (${who})`);
      assert.deepEqual(m.methodLastUsed, {}, who);
      assert.equal(item(m, "e").starred, true, `the other side's change stays (${who})`);
    });
  });

  test("done on both sides is done, keeping the details of the tempo logged later; the same bare check-off on both is agreement", () => {
    const base = withList();
    const a = complete(base, "c", 80), b = complete(base, "c", 90);
    bothWays(base, a, b, (r, who) => {
      assert.equal(taskOf(r.merged, "c").done, true, who);
      assert.equal(taskOf(r.merged, "c").tempo, 90, `the later tempo, whichever device this is (${who})`);
      assert.equal(item(r.merged, "c").evenTempo, 90, `and the scale agrees with the task (${who})`);
    });
    // one logged a tempo and the other only checked it off: the one with the tempo
    bothWays(base, complete(base, "c"), complete(base, "c", 70), (r, who) => assert.equal(taskOf(r.merged, "c").tempo, 70, who));
    const x = merge(complete(base, "c"), complete(base, "c"), base);
    assert.equal(x.status, "identical");
  });

  test("a completion one side undid and the other did again: whichever device's library changed most recently decides", () => {
    const base = complete(withList(), "c", 80);
    // the redo is the more recent change: the completion stands, with the redo's tempo
    const undone1 = uncheck(base, "c");
    const redone1 = complete(uncheck(base, "c"), "c", 100);
    bothWays(base, undone1, redone1, (r, who) => {
      assert.equal(taskOf(r.merged, "c").done, true, who);
      const c = item(r.merged, "c");
      assert.equal(c.evenTempo, 100, who);
      assert.ok(c.practicedDates.includes(DAY1) && c.lastPracticedDate === DAY1, `the scale shows it was practiced (${who})`);
      assert.deepEqual(Object.keys(r.merged.methodLastUsed.c).sort(), ["dotted", "eyes", "pf"], who);
      assert.equal(r.merged.walkPosition, 1, `and the walk stepped for it (${who})`);
    });
    // the device that lost is told, the one that won is not
    assert.deepEqual(merge(undone1, redone1, base).notices.map((n) => n.text), ["Your other device's change to C major was kept."]);
    assert.deepEqual(merge(redone1, undone1, base).notices, []);
    // the undo is the more recent change: the completion goes, and the tempo it logged goes with it
    const redone2 = complete(uncheck(base, "c"), "c", 100);
    const undone2 = uncheck(base, "c");
    bothWays(base, undone2, redone2, (r, who) => {
      assert.equal(taskOf(r.merged, "c").done, false, who);
      const c = item(r.merged, "c");
      assert.deepEqual([c.evenTempo, c.lastCheckedDate, c.lastCheckedAt], [null, null, null], `the tempo and its time go back (${who})`);
      assert.deepEqual([c.practicedDates, c.lastPracticedDate], [[], null], who);
      assert.deepEqual(r.merged.methodLastUsed, {}, who);
      assert.equal(r.merged.walkPosition, 0, `and the walk steps back (${who})`);
    });
    assert.deepEqual(merge(redone2, undone2, base).notices.map((n) => n.text), ["Your other device's change to C major was kept."]);
    assert.deepEqual(merge(undone2, redone2, base).notices, []);
    // merging the result with the same remote again changes nothing
    const first = merge(redone2, undone2, base);
    assert.ok(sameParts(planTechniqueMerge({ local: first.merged, remote: undone2, base: techniquePartFingerprints(base) }).merged, first.merged));
  });

  test("a tie in 'most recent' keeps the completion", () => {
    const base = complete(withList(), "c", 80);
    const undone = { ...uncheck(base, "c"), updatedAt: 5000 };
    const redone = { ...complete(uncheck(base, "c"), "c", 100), updatedAt: 5000 };
    bothWays(base, undone, redone, (r, who) => assert.equal(taskOf(r.merged, "c").done, true, who));
  });

  test("a task that is only on one list is kept (a scale added on one side topped up that list)", () => {
    const base = library({ items: [scale("c", "C", "major"), scale("e", "E", "minor")], dayList: { date: DAY1, tasks: [task("c")] } });
    const a = addScale(base, "x1", "C", "major", { form: "arpeggio" }); // tops up the list: it is in the key of the day
    assert.ok(taskOf(a, "x1"), "the app's top-up added a task");
    bothWays(base, a, complete(base, "c"), (r, who) => {
      assert.ok(taskOf(r.merged, "x1"), who);
      assert.equal(taskOf(r.merged, "c").done, true, who);
    });
  });

  test("two lists built apart on the same day are put together (every task kept), which can be more than scalesPerDay", () => {
    const base = withList({ dayList: null });
    const a = onDay(base, DAY1, [task("c"), task("a"), task("g")]);
    const b = onDay(base, DAY1, [task("e"), task("d"), task("b")]);
    bothWays(base, a, b, (r, who) => {
      assert.equal(r.merged.dayList.tasks.length, 6, who);
    });
  });

  test("a task done on one side and fresh on the other, on a list built independently for a new day, is done", () => {
    const base = withList();
    const a = complete(onDay(base, DAY2, [task("c"), task("a")]), "c");
    const b = onDay(base, DAY2, [task("c"), task("a")]);
    bothWays(base, a, b, (r, who) => {
      assert.equal(taskOf(r.merged, "c").done, true, who);
      assert.equal(taskOf(r.merged, "a").done, false, who);
    });
  });

  test("lists for different days: the later day's list wins whole, and what the earlier day did is in the scales' own parts", () => {
    const base = withList();
    const early = complete(base, "c", 80); // DAY1
    const late = onDay(base, DAY2, [task("g"), task("d")]);
    bothWays(base, early, late, (r, who) => {
      assert.equal(r.merged.dayList.date, DAY2, who);
      assert.deepEqual(r.merged.dayList.tasks.map((t) => t.itemId).sort(), ["d", "g"], who);
      assert.equal(item(r.merged, "c").evenTempo, 80, who);
      assert.deepEqual(item(r.merged, "c").practicedDates, [DAY1], who);
    });
    assert.equal(merge(early, late, base).list, "remote-later");
    assert.equal(merge(late, early, base).list, "local-later");
  });

  test("a library with a list on one side only has that list", () => {
    const base = library();
    const withIt = onDay(base, DAY1, [task("c")]);
    const other = toggleStar(base, "e"); // the side with no list changed something else
    const r = merge(other, withIt, base);
    assert.equal(r.merged.dayList.date, DAY1);
    assert.equal(r.list, "remote");
    assert.equal(merge(withIt, other, base).list, "local");
    assert.equal(item(r.merged, "e").starred, true);
  });
});

/* ------------------------------------------------------------------ */
/*  Rule 6: the walk                                                   */
/* ------------------------------------------------------------------ */

describe("the walk follows the day (Pass 118)", () => {
  const keys = () =>
    withList({
      items: [scale("c", "C", "major"), scale("c2", "C", "major", { form: "arpeggio" }), scale("a", "A", "minor"), scale("g", "G", "major")],
      dayList: { date: DAY1, tasks: [task("c"), task("c2"), task("a")] },
    });

  test("both devices did the day's task: the walk steps once, not twice", () => {
    const base = keys();
    // different tasks in the key of the day, one on each device
    bothWays(base, complete(base, "c"), complete(base, "c2"), (r, who) => {
      assert.equal(r.merged.walkPosition, 1, who);
      assert.equal(taskOf(r.merged, "c").done && taskOf(r.merged, "c2").done, true, who);
      assert.equal(r.derived.includes("walk"), false, `nothing had to be repaired (${who})`);
    });
    // the very same task on both devices
    bothWays(base, complete(base, "c", 80), complete(base, "c", 80), (r, who) => assert.equal(r.merged.walkPosition, 1, who));
  });

  test("one device did the day's task, the other did nothing: the walk stepped, from either side", () => {
    const base = keys();
    bothWays(base, complete(base, "c"), toggleStar(base, "g"), (r, who) => assert.equal(r.merged.walkPosition, 1, who));
  });

  test("a task that is not in the key of the day doesn't step the walk, and the other device's step is kept", () => {
    const base = keys();
    const notInKey = complete(base, "a"); // A minor is not the key of the day (C major)
    assert.equal(notInKey.walkPosition, 0);
    bothWays(base, notInKey, complete(base, "c"), (r, who) => {
      assert.equal(r.merged.walkPosition, 1, who);
      assert.equal(taskOf(r.merged, "a").done && taskOf(r.merged, "c").done, true, who);
    });
  });

  test("an undo on one side moves the walk back with it", () => {
    const base = complete(keys(), "c");
    assert.equal(base.walkPosition, 1);
    bothWays(base, uncheck(base, "c"), toggleStar(base, "g"), (r, who) => assert.equal(r.merged.walkPosition, 0, who));
  });

  test("one device stepped twice (two keys), the other once: the walk lands on the two steps whichever side holds it", () => {
    const base = keys();
    const twice = complete(complete(base, "c"), "a"); // C major (0 -> 1), then A minor (1 -> 2)
    assert.equal(twice.walkPosition, 2);
    const once = complete(base, "c");
    bothWays(base, twice, once, (r, who) => {
      assert.equal(r.merged.walkPosition, 2, who);
      assert.equal(taskOf(r.merged, "a").done, true, who);
    });
  });

  test("a step lost in the merge is taken once, with the engine's own advance (it skips a key with no scales)", () => {
    // C (0), G (2) and D (4) have scales; A minor (1) and E minor (3) don't. The walk is stored at 1,
    // so the key of the day is G (2), and the step after completing it is 3, not 2.
    const start = library({
      items: [scale("c", "C", "major"), scale("g", "G", "major"), scale("d", "D", "major")],
      walkPosition: 1,
      dayList: { date: DAY1, tasks: [task("g"), task("c")] },
    });
    assert.equal(effectiveWalkPosition(1, start.items), 2);
    const base = complete(start, "g"); // done in the base, on both devices
    assert.equal(base.walkPosition, 3, "completing the task steps it past G");
    assert.equal(base.walkPosition, nextWalkPosition(start.items, 1));
    assert.equal(base.walkPosition, walkStepPast(2));
    // one device undoes it (the walk goes back to 1); the other undoes it and does it again with a tempo
    // (the walk is back at 3, which is what the base had, so it looks unchanged to the merge)
    const undone = uncheck(base, "g");
    const again = complete(uncheck(base, "g"), "g", 100);
    assert.equal(undone.walkPosition, 1);
    assert.equal(again.walkPosition, 3);
    bothWays(base, undone, again, (r, who) => {
      assert.equal(taskOf(r.merged, "g").done, true, `the completion that stands wins (${who})`);
      assert.equal(r.merged.walkPosition, 3, `its step is taken once, past the key of the day, not to 2 (${who})`);
      assert.deepEqual(r.derived.filter((x) => x === "walk"), ["walk"], who);
    });
    // merging the result with the same account copy again does not step it again
    const first = merge(undone, again, base);
    const second = planTechniqueMerge({ local: first.merged, remote: again, base: techniquePartFingerprints(base) });
    assert.equal(second.merged.walkPosition, 3);
    assert.equal(second.derived.includes("walk"), false);
  });

  test("two walks that conflict: the account's is taken, then any step of this device's that it lacks is added once", () => {
    const base = keys();
    const twice = complete(complete(base, "c"), "a"); // C major (0 -> 1), then A minor (1 -> 2)
    const once = complete(base, "c2"); // C major arpeggio (0 -> 1)
    bothWays(base, twice, once, (r, who) => {
      assert.equal(r.merged.walkPosition, 2, who);
      assert.equal(taskOf(r.merged, "a").done && taskOf(r.merged, "c").done && taskOf(r.merged, "c2").done, true, who);
    });
    // only the device that held the shorter walk (the account's) needed the repair
    assert.equal(merge(twice, once, base).derived.includes("walk"), true);
    assert.equal(merge(once, twice, base).derived.includes("walk"), false);
  });

  test("when both devices already agree on the walk it is never stepped again, even with steps that go round in a circle", () => {
    // two keys with scales: D minor (23) and G major (2); finishing both in a day takes the walk all the way round
    const start = library({
      items: [scale("s1", "D", "minor"), scale("s4", "G", "major")],
      walkPosition: 3,
      dayList: { date: DAY1, tasks: [task("s1"), task("s4")] },
    });
    const a = complete(complete(start, "s1"), "s4"); // 3 -> 0 -> 3
    const b = complete(start, "s4"); // the key of the day is D minor, so this doesn't step it: 3
    assert.equal(a.walkPosition, 3);
    assert.equal(b.walkPosition, 3);
    bothWays(start, a, b, (r, who) => {
      assert.equal(r.merged.walkPosition, 3, who);
      assert.equal(r.derived.includes("walk"), false, who);
    });
  });

  test("a library with one key doesn't move on a merge: its steps go round in a circle, so they say nothing about where the walk should be", () => {
    const base = library({
      items: [scale("c", "C", "major"), scale("c2", "C", "major", { form: "arpeggio" })],
      walkPosition: 0,
      dayList: { date: DAY1, tasks: [task("c"), task("c2")] },
    });
    const both = complete(complete(base, "c"), "c2");
    const r = merge(both, toggleStar(base, "c"), base);
    assert.equal(r.merged.walkPosition, both.walkPosition);
    assert.equal(r.derived.includes("walk"), false);
  });

  test("a library where a day's tasks go all the way round (two keys, three tasks) is left as it is", () => {
    const base = library({
      items: [scale("c", "C", "major"), scale("g", "G", "major"), scale("c2", "C", "major", { form: "arpeggio" })],
      walkPosition: 0,
      dayList: { date: DAY1, tasks: [task("c"), task("g"), task("c2")] },
    });
    const all = complete(complete(complete(base, "c"), "g"), "c2");
    const r = merge(all, toggleStar(base, "g"), base);
    assert.equal(r.merged.walkPosition, all.walkPosition);
  });

  test("the walk is one of the two sides' own when nothing needed repairing", () => {
    const base = keys();
    const cases = [
      [complete(base, "c"), complete(base, "c2")],
      [complete(complete(base, "c"), "a"), complete(base, "c2")],
      [uncheck(complete(base, "c"), "c"), complete(base, "c")],
    ];
    cases.forEach(([a, b]) =>
      bothWays(base, a, b, (r) => assert.ok([a.walkPosition, b.walkPosition].includes(r.merged.walkPosition), `${r.merged.walkPosition} is one of the two sides' own`))
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Taking a task off the list, and the engine's other edges           */
/* ------------------------------------------------------------------ */

describe("a task taken off the list, and other edges (Pass 118)", () => {
  test("a task the other side took off (its scale switched off) and this side left alone is taken off here too", () => {
    const base = withList();
    bothWays(base, toggleRotation(base, "g"), toggleStar(base, "e"), (r, who) => {
      assert.equal(taskOf(r.merged, "g"), undefined, who);
      assert.equal(taskOf(r.merged, "a") !== undefined, true, who);
    });
  });

  test("a task the other side took off but this side did (done) stays, as a record, while the scale is off", () => {
    const base = withList();
    bothWays(base, toggleRotation(base, "g"), complete(base, "g"), (r, who) => {
      assert.equal(taskOf(r.merged, "g").done, true, who);
      assert.equal(item(r.merged, "g").inRotation, false, who);
    });
  });

  test("an unfinished task of a switched-off scale is left alone (the app itself leaves one when a done task of such a scale is undone)", () => {
    const base = withList();
    const done = complete(base, "g");
    const offAndUndone = uncheck(toggleRotation(done, "g"), "g");
    assert.ok(taskOf(offAndUndone, "g") && !taskOf(offAndUndone, "g").done && !item(offAndUndone, "g").inRotation, "the app can hold this");
    const r = merge(toggleStar(done, "e"), offAndUndone, done);
    assert.ok(taskOf(r.merged, "g") && !taskOf(r.merged, "g").done);
  });

  test("a method switched on and off again (the app keeps its entry) is the same library by parts, though the whole-library fingerprint still tells them apart", () => {
    const plain = withList();
    const toggled = toggleMethodStar(toggleMethodStar(plain, "eyes"), "eyes");
    assert.deepEqual(toggled.methodState.eyes, { starred: false, enabled: true });
    assert.equal(merge(plain, toggled, plain).status, "identical");
    assert.notEqual(accountFingerprint(plain), accountFingerprint(toggled), "so Pass 120 must not read 'identical by parts' as 'same fingerprint'");
  });

  test("a library the engine can't make sense of in places still merges: unreadable scales are left out, as the load does", () => {
    const base = withList();
    const odd = { schemaVersion: 1, items: [{ id: "z" }, scale("c", "C", "major")], dayList: { date: "not a date", tasks: [] }, walkPosition: 99, settings: { scalesPerDay: "x" } };
    const r = merge(toggleStar(base, "e"), odd, base);
    assert.equal(r.status, "merged");
    assert.ok(r.merged.items.some((i) => i.id === "e"));
  });

  test("a library saved before undo notes and exact times existed (a done task with no undo note, no lastCheckedAt) merges with a current one", () => {
    const old = {
      items: [{ id: "a", tonic: "C", quality: "major", evenTempo: 100, lastCheckedDate: "2026-09-01" }, { id: "b", tonic: "G", quality: "major" }],
      dayList: { date: DAY1, tasks: [{ itemId: "a", methodIds: ["eyes"], done: true, tier: "walk" }, { itemId: "b", methodIds: [], done: false, tier: "walk" }] },
      walkPosition: 1,
    };
    const base = validateAndMigrateTechnique(old);
    assert.equal(item(base, "a").lastCheckedAt, null, "an old tempo has no time, and reads as unknown rather than being guessed");
    assert.equal(taskOf(base, "a").undo, undefined);
    const mine = validateAndMigrateTechnique({ ...old, items: old.items.map((i) => (i.id === "a" ? { ...i, octaves: 3 } : i)) });
    const theirs = validateAndMigrateTechnique({ ...old, items: old.items.map((i) => (i.id === "b" ? { ...i, starred: true } : i)) });
    bothWays(base, mine, theirs, (r, who) => {
      assert.equal(r.status, "merged", who);
      assert.equal(item(r.merged, "a").octaves, 3, who);
      assert.equal(item(r.merged, "b").starred, true, who);
      assert.equal(item(r.merged, "a").evenTempo, 100, `the old tempo is kept (${who})`);
      assert.equal(taskOf(r.merged, "a").done, true, who);
      assert.equal(r.derived.includes("walk"), false, `a done task with no step note has no step to repair (${who})`);
    });
    // and on the same day a tempo logged now (with a time) beats one with none, from either device
    const noTime = (t) => stamped({ ...t, items: t.items.map((it) => (it.id === "a" ? { ...it, lastCheckedAt: null } : it)) });
    const legacyToday = noTime(complete(onDay(base, DAY1, [task("a")]), "a", 90));
    const timedToday = complete(onDay(base, DAY1, [task("a")]), "a", 120);
    assert.equal(item(legacyToday, "a").lastCheckedAt, null);
    bothWays(base, legacyToday, timedToday, (r, who) => assert.equal(item(r.merged, "a").evenTempo, 120, who));
  });

  test("a big library merges quickly", () => {
    const items = Array.from({ length: 160 }, (_, i) => scale(`s${i}`, ["C", "G", "D", "A", "E", "B"][i % 6], i % 2 ? "minor" : "major", { practicedDates: [DAY1, DAY2, DAY3], lastPracticedDate: DAY3 }));
    const base = library({ items, dayList: { date: DAY3, tasks: [task("s0"), task("s1"), task("s2")] } });
    const t0 = Date.now();
    const r = merge(toggleStar(base, "s5"), complete(base, "s0", 100), base);
    assert.equal(r.status, "merged");
    assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
  });

  test("the walk's advance step is exposed once, and completing a task takes exactly that step when (and only when) it is in the key of the day", () => {
    const rng = seeded(7);
    const names = [["C", "major"], ["A", "minor"], ["G", "major"], ["E", "minor"], ["D", "major"], ["B", "minor"], ["F#", "major"], ["Bb", "major"], ["F", "minor"]];
    let stepped = 0;
    let notInKey = 0;
    for (let run = 0; run < 200; run++) {
      const items = [];
      for (let i = 0, n = intIn(rng, 1, 6); i < n; i++) {
        const [tonic, quality] = pickOf(rng, names);
        items.push(scale(`i${i}`, tonic, quality, { form: pickOf(rng, ["scale", "arpeggio"]) }));
      }
      const walkPosition = intIn(rng, 0, 23);
      const t = library({ items, walkPosition, dayList: { date: DAY1, tasks: items.map((it) => task(it.id)) } });
      const keyPos = effectiveWalkPosition(walkPosition, t.items);
      const keyOfDay = WALK_KEYS[keyPos];
      assert.equal(nextWalkPosition(t.items, walkPosition), walkStepPast(keyPos), `run ${run}`);
      items.forEach((it) => {
        const after = complete(t, it.id).walkPosition;
        if (pitchClass(it.tonic) === keyOfDay.pc && it.quality === keyOfDay.quality) {
          assert.equal(after, nextWalkPosition(t.items, walkPosition), `run ${run}: in the key of the day, it takes the engine's one step`);
          stepped += 1;
        } else {
          assert.equal(after, walkPosition, `run ${run}: not in the key of the day, the walk stays`);
          notInKey += 1;
        }
      });
    }
    assert.ok(stepped > 100 && notInKey > 100, "both cases were exercised");
    assert.equal(nextWalkPosition([], 5), 5, "no scales, no step");
  });
});

/* ------------------------------------------------------------------ */
/*  Backups keep using the old merge                                   */
/* ------------------------------------------------------------------ */

describe("backups still merge the library the old way (Pass 118)", () => {
  test("mergeImportedTechnique needs no base, never removes, and gives the same answer as before", () => {
    const here = withList();
    const there = library({ walkPosition: 7, items: [scale("c", "C", "major", { evenTempo: 99, lastCheckedDate: DAY2 }), scale("z", "F", "major")] });
    const out = mergeImportedTechnique(here, there);
    assert.equal(out.technique.items.length, here.items.length + 1);
    assert.equal(out.stats.itemsAdded, 1);
    assert.equal(out.stats.temposUpdated, 1);
    assert.equal(out.technique.walkPosition, here.walkPosition, "the walk stays where it is on a library that wasn't empty");
  });
});

/* ------------------------------------------------------------------ */
/*  Two simulated devices                                              */
/* ------------------------------------------------------------------ */

describe("two simulated devices (Pass 118)", () => {
  // SIM_RUNS=3000 npm test runs the wider check CLAUDE.md asks for before trusting an engine change.
  const RUNS = Number(process.env.SIM_RUNS) || 300;
  const ROUNDS = 6;
  const START = "2026-10-05";
  const MAJORS = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"];
  const MINORS = ["A", "E", "B", "F#", "C#", "G#", "D#", "Bb", "F", "C", "G", "D"];
  const METHODS = ["dotted", "qqee", "halfq", "eighthtrip", "ladder", "pf", "stac", "contrary", "formula", "stagger", "cross", "eyes", "chain"];
  const dateOf = (clock) => addDaysISO(START, clock.day);

  function randomScale(rng, id, extra = {}) {
    const minor = rng() < 0.4;
    return scale(id, pickOf(rng, minor ? MINORS : MAJORS), minor ? "minor" : "major", { form: rng() < 0.3 ? "arpeggio" : "scale", octaves: pickOf(rng, [1, 2, 2, 3]), ...extra });
  }

  function startingLibrary(rng) {
    const items = [];
    for (let i = 0, n = intIn(rng, 4, 11); i < n; i++) {
      const tempo = rng() < 0.5;
      const dates = rng() < 0.5 ? [addDaysISO(START, -intIn(rng, 1, 6))] : [];
      items.push(
        randomScale(rng, `s${i + 1}`, {
          evenTempo: tempo ? intIn(rng, 60, 160) : null,
          lastCheckedDate: tempo ? addDaysISO(START, -intIn(rng, 1, 6)) : null,
          practicedDates: dates,
          lastPracticedDate: dates[0] || null,
          starred: rng() < 0.2,
        })
      );
    }
    const base = validateAndMigrateTechnique({
      schemaVersion: 1,
      items,
      walkPosition: intIn(rng, 0, 23),
      settings: { scalesPerDay: pickOf(rng, [2, 3, 3, 4]), minutesPerScale: 5 },
      methodState: rng() < 0.5 ? { [pickOf(rng, METHODS)]: { starred: true, enabled: true } } : {},
      updatedAt: 1,
    });
    return stamped({ ...base, dayList: buildDayList(engineState(base), START, base.settings.scalesPerDay) });
  }

  // How often each kind of edit is made. EVERY_KIND gives each of the spec's
  // edits a real share (so every rule is exercised often); EVERYDAY is mostly
  // check-offs and tempos, closer to how the app is used.
  const EVERY_KIND = [["complete", 14], ["tempo", 14], ["undo", 12], ["star", 7], ["rotation", 7], ["octaves", 5], ["hands", 3], ["checkOctaves", 6], ["addScale", 5], ["methodStar", 3], ["methodOn", 3], ["addMethod", 2], ["setting", 3]];
  const EVERYDAY = [["complete", 36], ["tempo", 36], ["undo", 4], ["star", 2], ["rotation", 1], ["octaves", 1], ["hands", 1], ["checkOctaves", 2], ["addScale", 1], ["methodStar", 1], ["methodOn", 1], ["addMethod", 1], ["setting", 1]];

  // Every kind of edit the spec names, each shaped like the app's own handler.
  function edit(d, rng, ctx) {
    const t = d.t;
    let roll = rng() * ctx.weights.reduce((n, [, w]) => n + w, 0);
    let kind = "complete";
    for (const [k, w] of ctx.weights) {
      if ((roll -= w) < 0) {
        kind = k;
        break;
      }
    }
    const tasks = t.dayList ? t.dayList.tasks : [];
    const open = tasks.filter((x) => !x.done);
    const finished = tasks.filter((x) => x.done);
    const anyId = () => pickOf(rng, t.items).id;
    let next = null;
    if (kind === "complete" && open.length) next = complete(t, pickOf(rng, open).itemId, null);
    else if (kind === "tempo" && open.length) next = complete(t, pickOf(rng, open).itemId, intIn(rng, 40, 200));
    else if (kind === "undo" && finished.length) next = uncheck(t, pickOf(rng, finished).itemId);
    else if (kind === "rotation" && t.items.length) next = toggleRotation(t, anyId());
    else if (kind === "octaves" && t.items.length) next = editItem(t, anyId(), { octaves: intIn(rng, 1, 4) });
    else if (kind === "hands" && t.items.length) next = editItem(t, anyId(), { hands: pickOf(rng, ["together", "thirds", "sixths"]) });
    else if (kind === "checkOctaves" && t.items.length) next = setCheckOctaves(t, anyId(), intIn(rng, 1, 4), pickOf(rng, ["keep", "fresh"]));
    else if (kind === "addScale") {
      const s = randomScale(rng, `${d.name}${ctx.next()}`);
      next = addScale(t, s.id, s.tonic, s.quality, { form: s.form, octaves: s.octaves });
    } else if (kind === "methodStar") next = toggleMethodStar(t, pickOf(rng, METHODS));
    else if (kind === "methodOn") next = toggleMethodOn(t, pickOf(rng, METHODS));
    else if (kind === "addMethod") next = addCustomMethod(t, `m_${d.name}${ctx.next()}`, `Method ${d.name}${ctx.next()}`);
    else if (kind === "setting") {
      const name = pickOf(rng, ["scalesPerDay", "minutesPerScale"]);
      next = setSetting(t, name, name === "scalesPerDay" ? intIn(rng, 2, 5) : intIn(rng, 3, 10));
    }
    if (!next || next === t) next = t.items.length ? toggleStar(t, anyId()) : t;
    // Pass 126: like App.jsx's updateTechnique, a change to octaves, hands or a setting leaves a dated note
    // on it; one edit in four is made as a device on the previous version would (no note), so the
    // library's updatedAt stands in.
    if (next !== t && rng() < 0.75) next = reload(stampChangedTechnique(t, next, next.updatedAt));
    return next;
  }

  // What each merge is checked against: facts read straight off the two
  // libraries and the base the device remembers, never from the merge engine's own
  // fingerprints or helpers. (The one thing shared is the app's own walk advance,
  // `nextWalkPosition`, which completeTask uses too: it is what a step IS.)
  const threeWay = (b, l, r, onConflict) => {
    const cl = !same(l, b);
    const cr = !same(r, b);
    if (!cl && !cr) return l;
    if (cl && !cr) return l;
    if (!cl && cr) return r;
    if (same(l, r)) return l;
    return onConflict(l, r);
  };
  const later = (a, b) => (!a ? b || null : !b ? a : a >= b ? a : b);
  const tripleOf = (it) => ({ evenTempo: it.evenTempo, lastCheckedDate: it.lastCheckedDate, lastCheckedAt: it.lastCheckedAt, checkOctaves: it.checkOctaves });
  const byId = (T) => new Map(T.items.map((it) => [it.id, it]));
  const taskState = (task) => (task && task.done ? { tempo: task.tempo, undo: task.undo } : null);

  function runOne(seed, tally, weights) {
    const rng = seeded(seed);
    let counter = 0;
    const ctx = { next: () => ++counter, weights };
    const clock = { day: 0 };
    const start = startingLibrary(rng);
    const account = { t: start };
    const devices = ["A", "B"].map((name) => ({ name, t: start, date: START, baseLib: start, base: techniquePartFingerprints(start) }));
    // The app's new-day effect: the list for today, carrying unfinished tasks over.
    const open = (d) => {
      if (d.date < dateOf(clock)) {
        d.date = dateOf(clock);
        d.t = newDay(d.t, d.date);
      }
    };

    const sync = (d, where) => {
      const local = d.t;
      const remote = account.t;
      const input = { local: clone(local), remote: clone(remote), base: clone(d.base) };
      const r = planTechniqueMerge({ local, remote, base: d.base });
      tally.merges += 1;
      tally[r.status] = (tally[r.status] || 0) + 1;
      tally.notices += r.notices.length;
      tally.walkRepairs += r.derived.includes("walk") ? 1 : 0;
      tally.practiceRepairs += r.derived.filter((x) => x.startsWith("practiced:")).length;
      if (r.list) tally.lists[r.list] = (tally.lists[r.list] || 0) + 1;

      assert.ok(same(local, input.local) && same(remote, input.remote) && same(d.base, input.base), `inputs unchanged (${where})`);
      const L = canonicalTechnique(clone(local));
      const R = canonicalTechnique(clone(remote));
      const B = canonicalTechnique(clone(d.baseLib));
      const fpL = techniquePartFingerprints(local);
      const fpR = techniquePartFingerprints(remote);
      const identical = same(fpL, fpR);
      const remoteIsBase = same(fpR, d.base);
      const localIsBase = same(fpL, d.base);
      if (identical) assert.equal(r.status, "identical", `identical (${where})`);
      else if (remoteIsBase) assert.equal(r.status, "local-only", `remote equals base (${where})`);
      else assert.equal(r.status, "merged", `there is always a base here, and the answer is never "ask" (${where})`);

      // merging when the remote equals the base returns this device's library untouched
      const probe = planTechniqueMerge({ local, remote: clone(d.baseLib), base: d.base });
      assert.ok(probe.status === "local-only" || probe.status === "identical", `remote = base is local-only or identical (${where})`);
      assert.equal(probe.merged, local, `untouched (${where})`);
      // the same inputs again give the same result
      assert.ok(same(planTechniqueMerge({ local: input.local, remote: input.remote, base: input.base }), r), `deterministic (${where})`);

      const M = canonicalTechnique(clone(r.merged));
      if (r.status !== "merged") {
        assert.equal(r.merged, local, `${r.status} returns this device's library untouched (${where})`);
      } else {
        assert.ok(same(r.merged, validateAndMigrateTechnique(clone(r.merged))), `already in the form a reload gives (${where})`);
        assert.equal(r.merged.updatedAt, Math.max(local.updatedAt || 0, remote.updatedAt || 0) || null, `updatedAt is the later of the two (${where})`);

        // merging twice gives the same result
        const again = planTechniqueMerge({ local: r.merged, remote: clone(remote), base: d.base });
        assert.ok(sameParts(again.merged, r.merged), `merging the result with the same remote again changes nothing (${where})`);
        // when this device hasn't changed anything, the remote's changes are simply taken
        if (localIsBase) assert.ok(sameParts(M, R), `unchanged here: the remote's library, exactly (${where})`);
        // a merge that brings the remote's changes in leaves nothing that a reload would still change

        /* ---- a completion one side undid and the other did again: the more recent change decides ---- */
        // (judged from the real libraries: both sides changed the task, one done and one not; the side whose
        // library was changed last wins, a tie keeps the completion. undoWon: scale id -> the side that undid it.)
        const undoWon = new Map();
        const checkSide = new Map(); // scale id -> the side its tempo check was taken from (filled in as the scales are checked)
        if (L.dayList && R.dayList && L.dayList.date === R.dayList.date) {
          const lT0 = new Map(L.dayList.tasks.map((x) => [x.itemId, x])), rT0 = new Map(R.dayList.tasks.map((x) => [x.itemId, x]));
          const bT0 = new Map(B.dayList && B.dayList.date === L.dayList.date ? B.dayList.tasks.map((x) => [x.itemId, x]) : []);
          lT0.forEach((lt0, id) => {
            const rt0 = rT0.get(id);
            if (!rt0) return;
            const sl0 = taskState(lt0), sr0 = taskState(rt0), sb0 = taskState(bT0.get(id));
            if (same(sl0, sb0) || same(sr0, sb0) || same(sl0, sr0) || !!sl0 === !!sr0) return;
            const undoneSide = sl0 ? "remote" : "local";
            const undoneAt = (undoneSide === "local" ? L : R).updatedAt || 0;
            const doneAt = (undoneSide === "local" ? R : L).updatedAt || 0;
            if (undoneAt > doneAt) undoWon.set(id, undoneSide);
          });
        }

        /* ---- scales ---- */
        const lI = byId(L), rI = byId(R), bI = byId(B), mI = byId(M);
        assert.equal(mI.size, M.items.length, `no scale twice (${where})`);
        [...lI.keys(), ...rI.keys()].forEach((id) => assert.ok(mI.has(id), `scale ${id} is not lost (${where})`));
        const doneIn = (id, date) => !!(M.dayList && M.dayList.date === date && (M.dayList.tasks.find((x) => x.itemId === id) || {}).done);
        mI.forEach((m, id) => {
          const li = lI.get(id), ri = rI.get(id), bi = bI.get(id);
          if (!li || !ri) {
            // on one side only: kept whole (a done task on the merged list may add that day to its practice)
            const only = li || ri;
            const { practicedDates: pd, lastPracticedDate: lp, ...rest } = m;
            const { practicedDates: opd, lastPracticedDate: olp, ...restOnly } = only;
            assert.ok(same(rest, restOnly), `${id} is kept whole (${where})`);
            assert.ok(opd.every((x) => pd.includes(x)) && pd.every((x) => opd.includes(x) || doneIn(id, x)), `${id} dates (${where})`);
            return;
          }
          if (!bi) return; // not in the base on a side that has it: nothing to compare with
          ["starred", "inRotation"].forEach((f) => {
            assert.equal(m[f], threeWay(bi[f], li[f], ri[f], (l, r) => r), `${id}.${f} (${where})`);
          });
          assert.equal(m.hands, threeWay(bi.hands, li.hands, ri.hands, (l, r) => (partTime(L, `hands:${id}`) > partTime(R, `hands:${id}`) ? l : r)), `${id}.hands (${where})`);
          // octaves and hands: the more recent change (the dated note, else updatedAt), the account's on a tie
          const recent = (key) => (l, r) => (partTime(L, key) > partTime(R, key) ? l : r);
          assert.equal(m.octaves, threeWay(bi.octaves, li.octaves, ri.octaves, recent(`octaves:${id}`)), `${id}.octaves (${where})`);
          assert.ok(same({ f: m.form, t: m.tonic, q: m.quality }, { f: li.form, t: li.tonic, q: li.quality }), `${id} is the same scale (${where})`);

          // the tempo check: one side's change, the newer check, a real tempo over an empty one, then the
          // one logged later by its exact time; and a completion's undo that was the more recent change takes
          // the tempo it logged back with it
          const lt = tripleOf(li), rt = tripleOf(ri), bt = tripleOf(bi), mt = tripleOf(m);
          const cl = !same(lt, bt), cr = !same(rt, bt);
          let expCheck;
          if (undoWon.has(id)) expCheck = undoWon.get(id) === "local" ? lt : rt;
          else if (!cl && !cr) expCheck = lt;
          else if (cl && !cr) expCheck = lt;
          else if (!cl && cr) expCheck = rt;
          else if (same(lt, rt)) expCheck = lt;
          else {
            if (lt.evenTempo != null || rt.evenTempo != null) assert.notEqual(mt.evenTempo, null, `no tempo is lost: ${id} (${where})`);
            if (lt.lastCheckedDate !== rt.lastCheckedDate) {
              // the newer check date wins, but an empty tempo never replaces a real one
              const [newer, older] = (lt.lastCheckedDate || "") > (rt.lastCheckedDate || "") ? [lt, rt] : [rt, lt];
              expCheck = newer.evenTempo == null && older.evenTempo != null ? older : newer;
            } else if ((lt.evenTempo == null) !== (rt.evenTempo == null)) {
              expCheck = lt.evenTempo != null ? lt : rt; // a real tempo over an empty one
            } else {
              // the same date, both real or both empty: the one logged later by its exact time, a time over none, else the account's
              const lat = lt.lastCheckedAt, rat = rt.lastCheckedAt;
              expCheck = lat != null && (rat == null || lat > rat) ? lt : rt;
            }
          }
          assert.ok(same(mt, expCheck), `${id} check (${where})`);
          // which side the scale's tempo came from, for the task below (null when both sides hold the same)
          if (!same(lt, rt)) checkSide.set(id, same(expCheck, lt) ? "local" : same(expCheck, rt) ? "remote" : null);

          // practiced dates: each date is a three-way change; a done task puts its day back
          const all = new Set([...li.practicedDates, ...ri.practicedDates, ...bi.practicedDates, ...m.practicedDates]);
          all.forEach((date) => {
            const b = bi.practicedDates.includes(date), l = li.practicedDates.includes(date), rr = ri.practicedDates.includes(date);
            const expected = (b ? l && rr : l || rr) || doneIn(id, date);
            assert.equal(m.practicedDates.includes(date), expected, `${id} practiced on ${date} (${where})`);
          });
          assert.deepEqual(m.practicedDates, [...m.practicedDates].sort(), `${id} dates in order (${where})`);
          let lastExpected = threeWay(bi.lastPracticedDate, li.lastPracticedDate, ri.lastPracticedDate, later);
          if (M.dayList && (M.dayList.tasks.find((x) => x.itemId === id) || {}).done) lastExpected = later(lastExpected, M.dayList.date);
          assert.equal(m.lastPracticedDate, lastExpected, `${id} last practiced (${where})`);
        });

        /* ---- the date each method was last used, on each scale (one three-way change each) ---- */
        const usedPairs = new Set();
        [L, R, B, M].forEach((T) => Object.keys(T.methodLastUsed).forEach((id) => Object.keys(T.methodLastUsed[id]).forEach((mid) => usedPairs.add(JSON.stringify([id, mid])))));
        usedPairs.forEach((pair) => {
          const [id, mid] = JSON.parse(pair);
          const get = (T) => (T.methodLastUsed[id] || {})[mid];
          let expected = threeWay(get(B), get(L), get(R), (l, r) => later(l, r) || undefined);
          const t = M.dayList && M.dayList.tasks.find((x) => x.itemId === id && x.done);
          if (t && t.methodIds.includes(mid)) expected = later(expected, M.dayList.date);
          assert.equal(get(M), expected || undefined, `${mid} last used on ${id} (${where})`);
        });

        /* ---- methods, settings ---- */
        const stateOf = (T, mid) => ({ starred: !!(T.methodState[mid] || {}).starred, enabled: (T.methodState[mid] || {}).enabled !== false });
        sortedIds(L.methodState, R.methodState, M.methodState).forEach((mid) => {
          const exp = { starred: threeWay(stateOf(B, mid).starred, stateOf(L, mid).starred, stateOf(R, mid).starred, (l, r) => r), enabled: threeWay(stateOf(B, mid).enabled, stateOf(L, mid).enabled, stateOf(R, mid).enabled, (l, r) => r) };
          assert.ok(same(stateOf(M, mid), exp), `method ${mid} (${where})`);
        });
        const customIds = new Set([...L.customMethods, ...R.customMethods].map((x) => x.id));
        assert.ok(same(new Set(M.customMethods.map((x) => x.id)), customIds) && M.customMethods.length === customIds.size, `custom methods are the union (${where})`);
        ["scalesPerDay", "minutesPerScale"].forEach((name) =>
          assert.equal(M.settings[name], threeWay(B.settings[name], L.settings[name], R.settings[name], (l, r) => (partTime(L, `setting:${name}`) > partTime(R, `setting:${name}`) ? l : r)), `setting ${name} (${where})`)
        );

        /* ---- today's list ---- */
        const LL = L.dayList, RL = R.dayList;
        if (LL && RL && LL.date !== RL.date) {
          const win = LL.date > RL.date ? LL : RL;
          assert.equal(M.dayList.date, win.date, `the later day's list (${where})`);
          assert.ok(same(M.dayList.tasks.map((x) => [x.itemId, x.done]), win.tasks.filter((x) => mI.has(x.itemId)).map((x) => [x.itemId, x.done])), `the later list's tasks (${where})`);
        } else if (LL && RL) {
          const lT = new Map(LL.tasks.map((x) => [x.itemId, x])), rT = new Map(RL.tasks.map((x) => [x.itemId, x]));
          const bT = new Map(B.dayList && B.dayList.date === LL.date ? B.dayList.tasks.map((x) => [x.itemId, x]) : []);
          const ids = new Set([...lT.keys(), ...rT.keys()]);
          const mT = new Map(M.dayList.tasks.map((x) => [x.itemId, x]));
          assert.equal(mT.size, M.dayList.tasks.length, `no task twice (${where})`);
          ids.forEach((id) => {
            const lt = lT.get(id), rt = rT.get(id), bt = bT.get(id);
            const mt = mT.get(id);
            if (!lt || !rt) {
              // on one list only: the other side took it off if the base had it, and that travels unless this side changed it
              const only = lt || rt;
              const tookOff = !!bt && same(only, bt);
              if (!tookOff) {
                assert.ok(mt, `a task on one list only is kept unless it was taken off: ${id} (${where})`);
                assert.equal(mt.done, only.done, `${id} (${where})`);
              } else assert.equal(mt, undefined, `a task taken off by the other side (and left alone here) is gone: ${id} (${where})`);
              return;
            }
            const sl = taskState(lt), sr = taskState(rt), sb = taskState(bt);
            const cl = !same(sl, sb), cr = !same(sr, sb);
            let expected;
            if (!cl && !cr) expected = !!sl;
            else if (cl && !cr) expected = !!sl;
            else if (!cl && cr) expected = !!sr;
            else if (same(sl, sr)) expected = !!sl;
            else if (!!sl !== !!sr) expected = !undoWon.has(id); // one undid it, the other did it again: the more recent change decides, a tie keeps it
            else expected = true; // done on both, in different ways
            assert.ok(mt, `${id} is on the list (${where})`);
            assert.equal(mt.done, expected, `${id} done (${where})`);
            // a completion survives unless it was undone on ONE side only, or the undo was the more recent change
            [[lt, rt, cl, cr], [rt, lt, cr, cl]].forEach(([x, y, cx, cy]) => {
              if (x.done && !mt.done) assert.ok((!cx && cy && !y.done) || (cx && cy && !y.done && undoWon.has(id)), `a completion of ${id} was lost without a one-sided undo or a more recent one (${where})`);
            });
            // done on both in different ways: the one that logged a tempo; of two, the side the scale's tempo came from, else the one logged later, else the account's
            if (lt.done && rt.done && cl && cr && !same(sl, sr)) {
              const lHas = lt.tempo != null, rHas = rt.tempo != null;
              let expectedTempo;
              if (lHas !== rHas) expectedTempo = lHas ? lt.tempo : rt.tempo;
              else if (lHas) {
                const side = checkSide.get(id);
                if (side) expectedTempo = side === "local" ? lt.tempo : rt.tempo;
                else {
                  const lat = (lI.get(id) || {}).lastCheckedAt, rat = (rI.get(id) || {}).lastCheckedAt;
                  expectedTempo = lat != null && (rat == null || lat > rat) ? lt.tempo : rt.tempo;
                }
              } else expectedTempo = rt.tempo;
              assert.equal(mt.tempo, expectedTempo, `${id} done on both: the details of the right one (${where})`);
            }
            if (expected) tally.completionsKept += 1;
            if (cl !== cr && !expected && sb) tally.undosTravelled += 1;
            if (lt.done && rt.done) tally.doneOnBoth += 1;
          });
        }
        // a done task means its scale was practiced that day
        if (M.dayList) {
          M.dayList.tasks.forEach((x) => {
            const it = mI.get(x.itemId);
            assert.ok(it, `a task's scale exists (${where})`);
            if (x.done) assert.ok(it.practicedDates.includes(M.dayList.date) && it.lastPracticedDate >= M.dayList.date, `a done task's scale shows the practice (${where})`);
          });
        }

        /* ---- the walk: a side's own, or reached by taking each step note once, and once for one day ---- */
        const w0 = B.walkPosition;
        const wl = L.walkPosition, wr = R.walkPosition;
        if (wl === wr) assert.equal(M.walkPosition, wl, `the sides agree on the walk (${where})`);
        if (!r.derived.includes("walk")) assert.ok([wl, wr].includes(M.walkPosition), `the walk is one of the two sides' own when nothing had to be repaired (${where})`);
        // Whatever the walk is, it is a side's own, or a position reached from the base or from a
        // side's own walk by chaining the done tasks' step notes (on either side) at most once each.
        // Two devices that did the day's task both hold a step from the same place, and only one of
        // them can be used.
        const stepsOf = (T) =>
          (T.dayList ? T.dayList.tasks : [])
            .filter((x) => x.done && x.undo && Number.isInteger(x.undo.advancedTo) && Number.isInteger(x.undo.walkPosition))
            .map((x) => ({ id: x.itemId, pre: x.undo.walkPosition, adv: x.undo.advancedTo }));
        const steps = [...stepsOf(L), ...stepsOf(R)];
        const reach = new Set([w0, wl, wr]);
        const explore = (at, used) => {
          reach.add(at);
          steps.forEach((st, i) => {
            if (used.has(i) || st.pre !== at) return;
            [st.adv, nextWalkPosition(M.items, at)].forEach((to) => explore(to, new Set([...used, i])));
          });
        };
        [w0, wl, wr].forEach((from) => explore(from, new Set()));
        assert.ok(reach.has(M.walkPosition), `the walk is reachable by taking each step at most once (${where})`);
        if (wl !== w0 && wr !== w0 && wl === wr) tally.walkBothAdvanced += 1;
      }

      // the person's device takes the merged library, and the account holds it
      d.t = r.merged;
      account.t = d.t;
      d.baseLib = d.t;
      d.base = techniquePartFingerprints(d.t);
    };

    const sortedIds = (...maps) => [...new Set(maps.flatMap((m) => Object.keys(m)))].sort();

    for (let round = 0; round < ROUNDS; round++) {
      if (rng() < 0.45) clock.day += 1;
      // offline: each device works on its own copy
      devices.forEach((d) => {
        if (rng() < 0.9) open(d);
        if (rng() < 0.85) for (let i = 0, n = intIn(rng, 1, 4); i < n; i++) d.t = edit(d, rng, ctx);
      });
      // then they sync, in a random order; a device may skip a round (a longer gap) or sync twice
      (rng() < 0.5 ? devices : [...devices].reverse()).forEach((d) => {
        if (rng() < 0.85) {
          if (rng() < 0.7) open(d);
          sync(d, `seed ${seed}, round ${round}, device ${d.name}`);
        }
        if (rng() < 0.15) sync(d, `seed ${seed}, round ${round}, device ${d.name} again`);
      });
    }
    // with nothing more to do, a few more syncs bring both devices to the account's library
    clock.day += 1;
    for (const d of [devices[0], devices[1], devices[0], devices[1]]) {
      sync(d, `seed ${seed}, final sync of ${d.name}`);
    }
    assert.ok(sameParts(devices[0].t, devices[1].t) && sameParts(devices[0].t, account.t), `seed ${seed}: both devices and the account end holding the same library`);
    tally.converged += 1;
  }

  function simulate(label, weights, runs) {
    const tally = { merges: 0, notices: 0, walkRepairs: 0, practiceRepairs: 0, lists: {}, completionsKept: 0, undosTravelled: 0, doneOnBoth: 0, walkBothAdvanced: 0, converged: 0 };
    const t0 = Date.now();
    for (let seed = 1; seed <= runs; seed++) runOne(seed, tally, weights);
    console.log(
      `techniqueMerge simulation (${label}): ${runs} runs (seeds 1 to ${runs}, ${ROUNDS} rounds each), ${tally.merges} syncs ` +
        `[nothing to bring in: local-only ${tally["local-only"] || 0}, identical ${tally.identical || 0}; merged ${tally.merged || 0}, with ${tally.notices} notices in all]. ` +
        `Lists merged: ${Object.keys(tally.lists).sort().map((k) => `${k} ${tally.lists[k]}`).join(", ")}. ` +
        `Done tasks kept ${tally.completionsKept}, undos that travelled ${tally.undosTravelled}, tasks done on both ${tally.doneOnBoth}, walks both devices advanced ${tally.walkBothAdvanced}, ` +
        `walk repairs ${tally.walkRepairs}, practice repairs ${tally.practiceRepairs}. ${tally.converged} of ${runs} runs ended with both devices and the account on one library. ${Date.now() - t0} ms`
    );
    return tally;
  }

  test(`${RUNS} seeded runs of ${ROUNDS} rounds, every kind of edit: the invariants hold after every merge`, () => {
    const tally = simulate("every kind of edit", EVERY_KIND, RUNS);
    assert.ok(tally.merges > RUNS, "the simulation really merged");
    assert.ok((tally.merged || 0) > 0 && tally.notices > 0, "clean merges and notices were exercised");
    assert.ok(tally.undosTravelled > 0 && tally.doneOnBoth > 0 && tally.walkBothAdvanced > 0, "undos, completions on both sides and a walk both advanced were exercised");
    assert.equal(tally.converged, RUNS);
  });

  test("100 more runs with an everyday mix (mostly check-offs and tempos): the same invariants", () => {
    const runs = Number(process.env.SIM_RUNS) ? Math.ceil(Number(process.env.SIM_RUNS) / 3) : 100;
    const tally = simulate("everyday mix", EVERYDAY, runs);
    assert.ok((tally.merged || 0) > 0);
    assert.equal(tally.converged, runs);
  });
});
