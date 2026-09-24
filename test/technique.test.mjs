// Tests for src/lib/technique.js — the Technique practice engine (Pass 99).
// Design: docs/Technique-Practice.md. Mechanics:
// docs/Algorithms.md#technique-practice-engine-pass-99.
//
// TZ pinned to a DST-observing zone, same reason as utils.test.mjs: the
// week-parity and days-since math go through local-midnight date strings.
process.env.TZ = "America/Denver";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BUILT_IN_METHODS,
  resolveMethods,
  methodFitsItem,
  pitchClass,
  sameKey,
  WALK_KEYS,
  walkKeyOfDay,
  effectiveWalkPosition,
  paceDaysPerWeek,
  paceStatus,
  slowItems,
  pickMethods,
  buildDayList,
  completeTask,
  startingTempo,
  changeCheckOctaves,
} from "../src/lib/technique.js";
import {
  TECHNIQUE_TASKS_PER_DAY,
  TECHNIQUE_WALK_LAP_DAYS,
} from "../src/lib/constants.js";
import { addDaysISO, startOfWeekISO } from "../src/lib/utils.js";

/* ------------------------------- Fixtures ------------------------------- */

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const keyName = (k) => `${NAMES[k.pc]} ${k.quality}`;

function item(id, tonic, quality, extra = {}) {
  return {
    id, form: "scale", tonic, quality, minorForm: quality === "minor" ? "harmonic" : null,
    octaves: 2, hands: "together", evenTempo: 120, checkOctaves: 2,
    lastCheckedDate: null, lastPracticedDate: null, practicedDates: [],
    starred: false, inRotation: true, ...extra,
  };
}

// 36 items: one scale for every one of the 24 walk keys, plus a major
// arpeggio for each of the 12 majors, with tempos spread 128-160.
function bigLibrary() {
  const items = [];
  WALK_KEYS.forEach((k, i) => {
    items.push(item(`s${i}`, NAMES[k.pc], k.quality, { evenTempo: 130 + (i % 6) * 6 }));
    if (k.quality === "major") {
      items.push(item(`a${i}`, NAMES[k.pc], "major", { form: "arpeggio", evenTempo: 128 + (i % 5) * 8 }));
    }
  });
  return items;
}

const methods = resolveMethods();
const MONDAY = "2025-01-06"; // a Monday, week parity even or odd is computed, not assumed

function simulate(items, repertoireKeys, days, start = MONDAY, opts = {}) {
  let state = { items, methods, methodLastUsed: {}, walkPosition: 0, previousList: null, repertoireKeys };
  const log = [];
  for (let d = 0; d < days; d++) {
    const today = addDaysISO(start, d);
    const list = buildDayList(state, today);
    const keyOfDay = walkKeyOfDay(state.items, state.walkPosition);
    let st = { ...state, dayList: list };
    if (!opts.completeNothing) {
      for (const t of list.tasks) st = completeTask(st, t.itemId, today);
    }
    log.push({ today, list, walkPos: keyOfDay?.today.position ?? null });
    state = { ...st, previousList: st.dayList };
  }
  return { state, log };
}

/* ------------------------------- Key math ------------------------------- */

describe("key math", () => {
  test("enharmonic spellings share a pitch class", () => {
    assert.equal(pitchClass("F#"), pitchClass("Gb"));
    assert.equal(pitchClass("F♯"), pitchClass("G♭"));
    assert.equal(pitchClass("D#"), pitchClass("Eb"));
    assert.equal(pitchClass("B#"), pitchClass("C"));
    assert.equal(pitchClass("Cb"), pitchClass("B"));
    assert.ok(sameKey("Gb major", { tonic: "F#", quality: "major" }));
    assert.ok(!sameKey("G major", "G minor"));
  });

  test("walk order is the 24-key list, each major followed by its relative minor (+9 semitones)", () => {
    const expected = [
      "C major", "A minor", "G major", "E minor", "D major", "B minor", "A major", "F# minor",
      "E major", "C# minor", "B major", "Ab minor", "F# major", "Eb minor", "C# major", "Bb minor",
      "Ab major", "F minor", "Eb major", "C minor", "Bb major", "G minor", "F major", "D minor",
    ];
    // Ab minor = G# minor, C# major = Db major, Eb minor = D# minor — same pitch classes.
    assert.deepEqual(WALK_KEYS.map(keyName), expected);
    assert.equal(WALK_KEYS.length, TECHNIQUE_WALK_LAP_DAYS);
    for (let i = 0; i < 24; i += 2) {
      assert.equal(WALK_KEYS[i + 1].pc, (WALK_KEYS[i].pc + 9) % 12);
    }
    assert.ok(sameKey({ tonic: "G#", quality: "minor" }, keyName(WALK_KEYS[11])));
    assert.ok(sameKey({ tonic: "Db", quality: "major" }, keyName(WALK_KEYS[14])));
    assert.ok(sameKey({ tonic: "D#", quality: "minor" }, keyName(WALK_KEYS[13])));
  });
});

/* ------------------------------ Walk helper ----------------------------- */

describe("walkKeyOfDay", () => {
  test("wraps across the end of the lap: D minor today, C major next", () => {
    const h = walkKeyOfDay(bigLibrary(), 23);
    assert.equal(keyName(h.today), "D minor");
    assert.equal(keyName(h.next), "C major");
    assert.equal(h.next.position, 0);
  });

  test("skips keys with no in-rotation items, for both today and next", () => {
    const items = [
      item("d", "D", "major"),
      item("b", "B", "minor", { inRotation: false }), // out of rotation → skipped
      item("fs", "F#", "minor"),
      item("c", "C", "major"),
    ];
    const h = walkKeyOfDay(items, 3); // E minor has nothing → D major today
    assert.equal(keyName(h.today), "D major");
    assert.equal(keyName(h.next), "F# minor"); // B minor, A major skipped
    const wrap = walkKeyOfDay(items, 8); // nothing from E major to D minor → wraps to C
    assert.equal(keyName(wrap.today), "C major");
    assert.equal(keyName(wrap.next), "D major");
    assert.equal(walkKeyOfDay([], 0), null);
  });
});

/* ------------------------------- The walk ------------------------------- */

describe("the circle-of-fifths walk", () => {
  test("advances on completion, not by date", () => {
    // "g" is the slowest third (1 of 3 items), so tier 2 takes it and the
    // walk's own picks are easy to read.
    const items = [item("c", "C", "major"), item("am", "A", "minor"), item("g", "G", "major", { evenTempo: 60 })];
    const base = { items, methods, methodLastUsed: {}, walkPosition: 0, previousList: null, repertoireKeys: [] };
    // Different dates, nothing completed: still C major every day.
    const walkIds = (list) => list.tasks.filter((t) => t.tier === "walk").map((t) => t.itemId);
    for (const d of [0, 1, 5, 30]) {
      assert.deepEqual(walkIds(buildDayList(base, addDaysISO(MONDAY, d))), ["c"], `day +${d}`);
    }
    // Complete it: walk moves to A minor.
    const list = buildDayList(base, MONDAY);
    const done = completeTask({ ...base, dayList: list }, "c", MONDAY);
    assert.equal(done.walkPosition, 1);
    const next = buildDayList({ ...done, previousList: done.dayList }, addDaysISO(MONDAY, 1));
    assert.deepEqual(walkIds(next), ["am"]);
  });

  test("with everything completed daily, every key with items is visited in order, keys with none skipped", () => {
    // Drop all E-major-side keys to prove skipping (E major, C# minor).
    const items = bigLibrary().filter((it) => !(sameKey(it, "E major") || sameKey(it, "C# minor")));
    const { log } = simulate(items, [], 120);
    const visited = [];
    for (const { walkPos } of log) if (visited[visited.length - 1] !== walkPos) visited.push(walkPos);
    const expectedLap = WALK_KEYS.map((_, i) => i).filter((i) => i !== 8 && i !== 9);
    for (let i = 0; i < visited.length; i++) {
      assert.equal(visited[i], expectedLap[i % expectedLap.length], `visit ${i}`);
    }
    assert.ok(visited.length >= expectedLap.length, "at least one full lap");
  });
});

/* -------------------------- Priority and the list ------------------------ */

describe("buildDayList", () => {
  test("priority order: pace (repertoire/starred), then slow, then walk", () => {
    const items = [
      item("walk", "C", "major", { evenTempo: 150 }),
      item("slow", "Eb", "major", { evenTempo: 60 }),
      item("rep", "G", "minor", { evenTempo: 150 }),
      item("fast", "B", "major", { evenTempo: 160 }),
    ];
    const list = buildDayList({ items, methods, walkPosition: 0, repertoireKeys: ["G minor"] }, MONDAY);
    assert.deepEqual(list.tasks.map((t) => [t.itemId, t.tier]), [["rep", "pace"], ["slow", "slow"], ["walk", "walk"]]);
  });

  test("never more than the daily cap, and pace can fill it on its own", () => {
    const items = [1, 2, 3, 4].map((n) => item(`st${n}`, "D", "major", { starred: true }));
    const list = buildDayList({ items, methods, walkPosition: 0, repertoireKeys: [] }, MONDAY);
    assert.equal(list.tasks.length, TECHNIQUE_TASKS_PER_DAY);
    assert.ok(list.tasks.every((t) => t.tier === "pace"));
  });

  test("carry-over keeps unfinished tasks with the same methods; done tasks drop out", () => {
    const items = bigLibrary();
    const state = { items, methods, methodLastUsed: {}, walkPosition: 0, previousList: null, repertoireKeys: ["G minor"] };
    const day1 = buildDayList(state, MONDAY);
    assert.equal(day1.tasks.length, 3);
    const done = completeTask({ ...state, dayList: day1 }, day1.tasks[0].itemId, MONDAY);
    const day2 = buildDayList({ ...done, previousList: done.dayList }, addDaysISO(MONDAY, 1));
    assert.equal(day2.tasks.length, 3);
    assert.deepEqual(day2.tasks.slice(0, 2).map((t) => t.itemId), day1.tasks.slice(1).map((t) => t.itemId));
    assert.deepEqual(day2.tasks.slice(0, 2).map((t) => t.methodIds), day1.tasks.slice(1).map((t) => t.methodIds));
    assert.ok(day2.tasks.slice(0, 2).every((t) => t.tier === "carried"));
    assert.ok(!day2.tasks.some((t) => t.itemId === day1.tasks[0].itemId && t.tier === "carried"));
  });

  test("carry-over never exceeds the daily cap", () => {
    const items = bigLibrary();
    const prev = { date: MONDAY, tasks: ["s0", "s1", "s2", "s3"].map((id) => ({ itemId: id, methodIds: ["eyes"], done: false, tier: "walk" })) };
    const list = buildDayList({ items, methods, walkPosition: 0, previousList: prev, repertoireKeys: ["G minor"] }, addDaysISO(MONDAY, 1));
    assert.deepEqual(list.tasks.map((t) => t.itemId), ["s0", "s1", "s2"]);
  });

  test("today's list is returned unchanged once built; same inputs give the same list", () => {
    const state = { items: bigLibrary(), methods, methodLastUsed: {}, walkPosition: 5, previousList: null, repertoireKeys: ["D major"] };
    const a = buildDayList(state, MONDAY);
    const b = buildDayList(state, MONDAY);
    assert.deepEqual(a, b);
    assert.equal(buildDayList({ ...state, previousList: a }, MONDAY), a);
  });

  test("no scale appears twice in a day, over a long run", () => {
    const { log } = simulate(bigLibrary(), ["G minor", "D major"], 240);
    for (const { today, list } of log) {
      const ids = list.tasks.map((t) => t.itemId);
      assert.equal(new Set(ids).size, ids.length, today);
      assert.ok(ids.length <= TECHNIQUE_TASKS_PER_DAY, today);
    }
  });
});

/* --------------------------------- Pace --------------------------------- */

describe("pace (days-a-week targets)", () => {
  test("targets: repertoire 4, starred 3, both alternate 4/3 by calendar week, ordinary 0", () => {
    const rep = item("r", "G", "minor");
    const star = item("s", "C", "major", { starred: true });
    const both = item("b", "G", "minor", { starred: true });
    const plain = item("p", "E", "major");
    const keys = ["G minor"];
    assert.equal(paceDaysPerWeek(rep, keys, MONDAY), 4);
    assert.equal(paceDaysPerWeek(star, keys, MONDAY), 3);
    assert.equal(paceDaysPerWeek(plain, keys, MONDAY), 0);
    const w1 = paceDaysPerWeek(both, keys, MONDAY);
    const w2 = paceDaysPerWeek(both, keys, addDaysISO(MONDAY, 7));
    const w1sun = paceDaysPerWeek(both, keys, addDaysISO(MONDAY, 6));
    assert.deepEqual([w1, w2].sort(), [3, 4]);
    assert.equal(w1sun, w1, "parity holds for the whole Monday–Sunday week");
  });

  test("not offered two days running unless the week can't hold its remaining days otherwise", () => {
    const tue = addDaysISO(MONDAY, 1);
    const rep = item("r", "G", "minor", { lastPracticedDate: MONDAY, practicedDates: [MONDAY] });
    assert.equal(paceStatus(rep, ["G minor"], tue).due, false);
    // Sunday with one day still owed: forced even though practiced Saturday.
    const sat = addDaysISO(MONDAY, 5);
    const sun = addDaysISO(MONDAY, 6);
    const behindNot = item("r2", "G", "minor", { lastPracticedDate: sat, practicedDates: [MONDAY, addDaysISO(MONDAY, 2), sat] });
    assert.equal(paceStatus(behindNot, ["G minor"], sun).due, true);
  });

  test("simulation: 238 days (34 full weeks), everything completed", () => {
    // Fixture: bigLibrary() = 36 items (24 walk-key scales + 12 major
    // arpeggios). Repertoire keys D major and G minor → 3 repertoire items
    // (D major scale, D major arpeggio, G minor scale); the G minor scale
    // is also starred ("both"); Eb major scale starred only. Tier-1 demand
    // ≈ 4 + 4 + 3.5 + 3 = 14.5 of 21 weekly slots, so pace does not fill
    // every day on its own; the slowest third (12 items) competes for the
    // rest with the walk. Tolerance: ±0.35 days a week on each average.
    const items = bigLibrary().map((it) => {
      if (sameKey(it, "G minor")) return { ...it, starred: true };
      if (sameKey(it, "Eb major") && it.form === "scale") return { ...it, starred: true };
      return it;
    });
    const weeks = 34;
    const { log } = simulate(items, ["D major", "G minor"], weeks * 7);
    const perWeek = (id) => {
      const counts = Array(weeks).fill(0);
      log.forEach(({ list }, d) => { if (list.tasks.some((t) => t.itemId === id)) counts[Math.floor(d / 7)]++; });
      return counts;
    };
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const id = (k, form = "scale") => items.find((it) => sameKey(it, k) && it.form === form).id;

    const repScale = avg(perWeek(id("D major")));
    const repArp = avg(perWeek(id("D major", "arpeggio")));
    const starred = avg(perWeek(id("Eb major")));
    const bothWeeks = perWeek(id("G minor"));
    const both = avg(bothWeeks);
    const ordinaryIds = items.filter((it) => !it.starred && !sameKey(it, "D major")).map((it) => it.id);
    const ordinary = avg(ordinaryIds.map((i) => avg(perWeek(i))));

    assert.ok(Math.abs(repScale - 4) <= 0.35, `repertoire scale ${repScale}`);
    assert.ok(Math.abs(repArp - 4) <= 0.35, `repertoire arpeggio ${repArp}`);
    assert.ok(Math.abs(starred - 3) <= 0.35, `starred ${starred}`);
    assert.ok(Math.abs(both - 3.5) <= 0.35, `both ${both}`);
    // Alternation: split weeks by the item's own target that week.
    const bothItem = items.find((it) => it.id === id("G minor"));
    const byTarget = { 3: [], 4: [] };
    bothWeeks.forEach((c, w) => byTarget[paceDaysPerWeek(bothItem, ["G minor"], addDaysISO(MONDAY, w * 7))].push(c));
    assert.ok(Math.abs(avg(byTarget[4]) - 4) <= 0.35, `both, 4-day weeks ${avg(byTarget[4])}`);
    assert.ok(Math.abs(avg(byTarget[3]) - 3) <= 0.35, `both, 3-day weeks ${avg(byTarget[3])}`);
    assert.ok(ordinary < 1, `ordinary ${ordinary}`);
    // Printed for the record (node:test shows diagnostics).
    console.log(JSON.stringify({ repScale, repArp, starred, both, both4: avg(byTarget[4]), both3: avg(byTarget[3]), ordinary }));
  });
});

/* ------------------------------ Slow tier ------------------------------- */

describe("slow tier", () => {
  test("slowest third of the user's own items, no tempo counts as slowest, 7-day cooldown", () => {
    // 12 items → the slowest 4: none, 90, 91, 92. "recent" (91) was
    // practiced 6 days ago, so the cooldown drops it; "aged" (92), 7 days
    // ago, stays. The 8 fast items never qualify.
    const items = [
      item("none", "C", "major", { evenTempo: null }),
      item("slow", "G", "major", { evenTempo: 90 }),
      item("recent", "E", "major", { evenTempo: 91, lastPracticedDate: addDaysISO(MONDAY, -6) }),
      item("aged", "B", "major", { evenTempo: 92, lastPracticedDate: addDaysISO(MONDAY, -7) }),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => item(`fast${n}`, "D", "major", { evenTempo: 120 + n })),
    ];
    assert.deepEqual(slowItems(items, MONDAY).map((i) => i.id), ["none", "slow", "aged"]);
  });

  test("a new library with no tempos saved: only a third counts as slow", () => {
    const items = bigLibrary().map((it) => ({ ...it, evenTempo: null }));
    assert.equal(slowItems(items, MONDAY).length, 12);
  });
});

/* -------------------------------- Methods ------------------------------- */

describe("pickMethods", () => {
  const byId = Object.fromEntries(BUILT_IN_METHODS.map((m) => [m.id, m]));

  test("catalog: 13 methods, every tag known", () => {
    assert.equal(BUILT_IN_METHODS.length, 13);
    assert.equal(new Set(BUILT_IN_METHODS.map((m) => m.id)).size, 13);
  });

  test("filtered by fit (form/hands) and by the on/off switch", () => {
    const arp = item("a", "C", "major", { form: "arpeggio", hands: "sixths" });
    const allowed = methods.filter((m) => methodFitsItem(m, arp)).map((m) => m.id);
    assert.ok(!allowed.includes("formula") && !allowed.includes("contrary") && !allowed.includes("stagger"));
    for (let d = 0; d < 20; d++) {
      const picked = pickMethods(arp, methods, {}, MONDAY);
      assert.ok(picked.every((id) => allowed.includes(id)));
    }
    const offAll = resolveMethods(Object.fromEntries(["dotted", "qqee", "halfq", "eighthtrip"].map((id) => [id, { enabled: false }])));
    const picked = pickMethods(item("s", "C", "major"), offAll, {}, MONDAY);
    assert.ok(!picked.some((id) => ["dotted", "qqee", "halfq", "eighthtrip"].includes(id)));
  });

  test("3-4 methods, at most two per technique", () => {
    let used = {};
    const it = item("s", "C", "major");
    for (let d = 0; d < 30; d++) {
      const today = addDaysISO(MONDAY, d);
      const picked = pickMethods(it, methods, used, today);
      assert.ok(picked.length >= 3 && picked.length <= 4);
      const perTag = {};
      for (const id of picked) perTag[byId[id].technique] = (perTag[byId[id].technique] || 0) + 1;
      assert.ok(Object.values(perTag).every((n) => n <= 2), JSON.stringify(perTag));
      used = { ...used, ...Object.fromEntries(picked.map((id) => [id, today])) };
    }
  });

  test("the last session's methods are skipped", () => {
    const it = item("s", "C", "major");
    const first = pickMethods(it, methods, {}, MONDAY);
    const used = Object.fromEntries(first.map((id) => [id, MONDAY]));
    const second = pickMethods(it, methods, used, addDaysISO(MONDAY, 1));
    assert.ok(second.every((id) => !first.includes(id)), `${first} then ${second}`);
  });

  test("starred methods are favored (count double)", () => {
    const it = item("s", "C", "major");
    const today = addDaysISO(MONDAY, 20);
    // Everything used 10 days ago except "chain", used 6 days ago; the
    // last session (yesterday) used nothing on this list.
    const used = Object.fromEntries(methods.map((m) => [m.id, addDaysISO(today, -10)]));
    used.chain = addDaysISO(today, -6);
    used.halfq = addDaysISO(today, -1); // last session
    assert.ok(!pickMethods(it, methods, used, today).includes("chain"));
    const starred = resolveMethods({ chain: { starred: true } });
    assert.equal(pickMethods(it, starred, used, today)[0], "chain"); // 6 × 2 = 12 > 10
  });

  test("only completed tasks count as used", () => {
    const state = { items: bigLibrary(), methods, methodLastUsed: {}, walkPosition: 0, previousList: null, repertoireKeys: [] };
    const list = buildDayList(state, MONDAY);
    const [t0, t1] = list.tasks;
    const after = completeTask({ ...state, dayList: list }, t0.itemId, MONDAY);
    assert.deepEqual(Object.keys(after.methodLastUsed[t0.itemId]).sort(), [...t0.methodIds].sort());
    assert.equal(after.methodLastUsed[t1.itemId], undefined);
  });
});

/* ------------------------ Completing, tempo, octaves -------------------- */

describe("completeTask, startingTempo, changeCheckOctaves", () => {
  const setup = () => {
    const items = [item("c", "C", "major", { evenTempo: 100, lastCheckedDate: "2024-12-01" })];
    const state = { items, methods, methodLastUsed: {}, walkPosition: 0, previousList: null, repertoireKeys: [] };
    return { ...state, dayList: buildDayList(state, MONDAY) };
  };

  test("a bare check-off counts as done and practiced but keeps the saved tempo", () => {
    const s = completeTask(setup(), "c", MONDAY);
    const it = s.items[0];
    assert.equal(s.dayList.tasks[0].done, true);
    assert.equal(it.lastPracticedDate, MONDAY);
    assert.equal(it.evenTempo, 100);
    assert.equal(it.lastCheckedDate, "2024-12-01");
  });

  test("a check with a tempo sets the new baseline", () => {
    const s = completeTask(setup(), "c", MONDAY, 112);
    assert.equal(s.items[0].evenTempo, 112);
    assert.equal(s.items[0].lastCheckedDate, MONDAY);
    assert.equal(s.dayList.tasks[0].tempo, 112);
  });

  test("starting tempo is 85% of the last verified tempo, null when there is none", () => {
    assert.equal(startingTempo({ evenTempo: 120 }), 102);
    assert.equal(startingTempo({ evenTempo: null }), null);
  });

  test("check-octave change: prompt only with a saved tempo; keep / start fresh", () => {
    const withTempo = item("x", "C", "major", { evenTempo: 100, checkOctaves: 2 });
    assert.equal(changeCheckOctaves(withTempo, 2).status, "unchanged");
    const ask = changeCheckOctaves(withTempo, 4);
    assert.equal(ask.status, "needs-prompt");
    assert.equal(ask.item.checkOctaves, 2);
    const keep = changeCheckOctaves(withTempo, 4, "keep");
    assert.deepEqual([keep.item.checkOctaves, keep.item.evenTempo], [4, 100]);
    const fresh = changeCheckOctaves(withTempo, 4, "fresh");
    assert.deepEqual([fresh.item.checkOctaves, fresh.item.evenTempo], [4, null]);
    const noTempo = changeCheckOctaves({ ...withTempo, evenTempo: null }, 3);
    assert.deepEqual([noTempo.status, noTempo.item.checkOctaves], ["applied", 3]);
  });

  test("effectiveWalkPosition sanity: position with no items moves forward", () => {
    assert.equal(effectiveWalkPosition(1, [item("g", "G", "major")]), 2);
    assert.equal(startOfWeekISO(MONDAY), MONDAY);
  });
});
