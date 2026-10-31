// Pass 126: "the most recent change wins". The dated note a single-value setting gets when it
// changes (src/lib/settingTimes.js), how it is loaded, and what the technique library keeps.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  RECENCY_FIELDS,
  cleanSettingTimes,
  settingTime,
  hasSettingNote,
  compareRecency,
  nextSettingStamp,
  stampChangedSettings,
  pieceWithChange,
  isRecencyField,
  cleanPartTimes,
  isTimedTechniquePart,
  partTime,
  nextPartStamp,
} from "../src/lib/settingTimes.js";
import { validateAndMigratePiece, validateAndMigrateTechnique, normalizeTechniqueItem } from "../src/lib/storage.js";
import { stampChangedTechnique, techniquePartKey as K } from "../src/lib/techniqueMerge.js";
import { canonicalPiece } from "../src/lib/pieceMerge.js";
import { pieceFingerprint as accountPieceFingerprint } from "../src/lib/accountSync.js";

const piece = (over = {}) => ({ id: "p1", name: "Ballade", notes: "", status: "active", targetBPM: 100, targetDate: "2026-11-01", updatedAt: 1000, ...over });

describe("which settings get a dated note (the list the owner approved, 2026-10-28)", () => {
  test("the single-value settings, and none of the collections, shapes or the chunk grid", () => {
    const expected = [
      "name", "composer", "workName", "notes", "status", "markedLearnedElsewhere", "targetBPM", "homeKey", "manualOverallConfidence",
      "lastPlayedDate", "startDate", "scheduleMode", "targetDate", "minutesPerDay", "practiceDaysPerWeek", "troubleSpotsEnabled", "troubleSpotDefaultMinutes",
    ];
    assert.deepEqual([...RECENCY_FIELDS].sort(), [...expected].sort());
    // still asked in Review: collections and whole shapes
    ["memoryAnchors", "recordings", "documents", "measureDifficulty", "sections", "recurringMode", "recurringMeasures", "recurringPairs", "bpmZones", "ladderConfig", "revival", "rescheduleMarker", "otherKeys"].forEach((k) =>
      assert.equal(isRecencyField(k), false, `${k} is not settled by recency`)
    );
    // the chunk grid: the "size and schedule travel together" case, a whole-piece question
    ["totalMeasures", "chunkMode", "customChunkSize", "chunkSplitPoints"].forEach((k) => assert.equal(isRecencyField(k), false, `${k} is the chunk grid`));
    // worked out from other settings, never settled on their own
    ["workId", "daysToLearn"].forEach((k) => assert.equal(isRecencyField(k), false, `${k} follows another setting`));
    // never a question already
    ["sortOrder", "switcherOrder", "createdAt", "progress"].forEach((k) => assert.equal(isRecencyField(k), false, k));
  });
});

describe("writing the notes: stampChangedSettings", () => {
  test("a changed setting gets a note at that moment, an unchanged one gets none", () => {
    const before = piece();
    const after = stampChangedSettings(before, { ...before, targetBPM: 120, notes: "" }, 5000);
    assert.deepEqual(after.settingTimes, { targetBPM: 5000 });
    assert.equal(after.targetBPM, 120);
  });

  test("nothing changed: the very same object, no field added", () => {
    const before = piece();
    const same = { ...before };
    assert.equal(stampChangedSettings(before, same, 5000), same);
    assert.equal("settingTimes" in same, false);
  });

  test("a setting that is not on the list never gets a note (a collection, the grid, practice)", () => {
    const before = piece({ recordings: [], totalMeasures: 32, progress: {} });
    const after = stampChangedSettings(before, { ...before, recordings: [{ id: "r1" }], totalMeasures: 40, progress: { c1: { sessions: [] } } }, 5000);
    assert.equal(after.settingTimes, undefined);
  });

  test("several settings changed together share one moment; earlier notes on other settings are kept", () => {
    const before = piece({ settingTimes: { status: 3000 } });
    const after = stampChangedSettings(before, { ...before, name: "Barcarolle", targetDate: "2026-12-01" }, 7000);
    assert.deepEqual(after.settingTimes, { status: 3000, name: 7000, targetDate: 7000 });
  });

  test("undefined and null are the same 'nothing' (a load that fills a field in with null is not a change)", () => {
    const before = piece({ composer: undefined });
    assert.equal(stampChangedSettings(before, { ...before, composer: null }, 5000).settingTimes, undefined);
  });

  test("an object-valued setting is compared by content, key order ignored", () => {
    const before = piece({ homeKey: { tonic: "C", quality: "major" } });
    assert.equal(stampChangedSettings(before, { ...before, homeKey: { quality: "major", tonic: "C" } }, 5000).settingTimes, undefined);
    assert.deepEqual(stampChangedSettings(before, { ...before, homeKey: { tonic: "D", quality: "major" } }, 5000).settingTimes, { homeKey: 5000 });
  });

  test("the inputs are never changed", () => {
    const before = piece({ settingTimes: { status: 3000 } });
    const snapshot = JSON.stringify(before);
    const next = { ...before, name: "X" };
    const nextSnapshot = JSON.stringify(next);
    stampChangedSettings(before, next, 7000);
    assert.equal(JSON.stringify(before), snapshot);
    assert.equal(JSON.stringify(next), nextSnapshot);
  });
});

describe("a change written straight to storage carries the notes updatePiece would have written (Pass 126 follow-up, Reschedule all)", () => {
  test("[regression] a target date moved for a piece that is not open gets a dated note, the moment of the change", () => {
    // "Reschedule all" extends a piece past its date (daysToLearn and targetDate) and sets the marker.
    // It wrote them with no note, so an older note could beat the newer date in a later clash.
    const before = piece({ scheduleMode: "days", daysToLearn: 21, settingTimes: { targetDate: 100 } });
    const marker = { asOfDay: 5, previous: null };
    const after = pieceWithChange(before, { rescheduleMarker: marker, daysToLearn: 30, targetDate: "2026-11-10" }, 9000);
    assert.equal(after.settingTimes.targetDate, 9000, "the new date is stamped now, past the old note");
    assert.equal(after.targetDate, "2026-11-10");
    assert.equal(after.updatedAt, 9000);
  });

  test("only the listed settings are stamped: days to learn and the reschedule marker follow the date and get no note of their own", () => {
    const before = piece({ scheduleMode: "days", daysToLearn: 21 });
    const after = pieceWithChange(before, { rescheduleMarker: { asOfDay: 5 }, daysToLearn: 30 }, 9000);
    assert.equal(after.settingTimes, undefined, "nothing on the list changed, so no field is added");
    assert.equal(after.daysToLearn, 30);
    assert.deepEqual(after.rescheduleMarker, { asOfDay: 5 });
    assert.equal(after.updatedAt, 9000);
  });

  test("a minutes-mode piece (no target date written) is not stamped for a date it never had", () => {
    const before = piece({ scheduleMode: "minutes", targetDate: undefined, daysToLearn: 21 });
    const after = pieceWithChange(before, { rescheduleMarker: { asOfDay: 5 }, daysToLearn: 28 }, 9000);
    assert.equal(after.settingTimes, undefined);
  });

  test("never earlier than a note the piece already holds, and the inputs are not changed", () => {
    const before = piece({ settingTimes: { targetDate: 20000 } });
    const snapshot = JSON.stringify(before);
    const after = pieceWithChange(before, { targetDate: "2026-12-01" }, 9000);
    assert.equal(after.settingTimes.targetDate, 20001, "a slow clock still stamps after what it has received");
    assert.equal(JSON.stringify(before), snapshot);
  });
});

describe("a note is never earlier than one the piece already holds (a slow clock still stamps AFTER what it has received)", () => {
  test("now is used when it is later than every note", () => {
    assert.equal(nextSettingStamp(piece({ settingTimes: { name: 100 } }), 5000), 5000);
    assert.equal(nextSettingStamp(piece(), 5000), 5000);
  });

  test("a clock behind a received note stamps one moment after it", () => {
    const received = piece({ settingTimes: { name: 9000, status: 4000 } });
    assert.equal(nextSettingStamp(received, 5000), 9001);
    const after = stampChangedSettings(received, { ...received, targetBPM: 140 }, 5000);
    assert.equal(after.settingTimes.targetBPM, 9001);
    assert.ok(compareRecency(after, received, "targetBPM") > 0, "so it beats what the other device already had");
  });

  test("a nonsense clock is read as 0, and a note still goes after the ones held", () => {
    assert.equal(nextSettingStamp(piece({ settingTimes: { name: 50 } }), NaN), 51);
    assert.equal(nextSettingStamp(piece(), NaN), 0);
  });
});

describe("reading the notes: the time of a setting and which copy changed it more recently", () => {
  test("its own note, else the piece's updatedAt, else nothing", () => {
    const withNote = piece({ settingTimes: { name: 2500 }, updatedAt: 9000 });
    assert.equal(settingTime(withNote, "name"), 2500);
    assert.equal(settingTime(withNote, "status"), 9000, "no note for this setting: updatedAt stands in");
    assert.equal(settingTime({ id: "x" }, "name"), 0);
    assert.equal(settingTime(null, "name"), 0);
    assert.equal(hasSettingNote(withNote, "name"), true);
    assert.equal(hasSettingNote(withNote, "status"), false);
  });

  test("1 / -1 for the later copy, 0 for the same moment or no idea (a tie is never guessed)", () => {
    const a = piece({ settingTimes: { name: 2000 } });
    const b = piece({ settingTimes: { name: 3000 } });
    assert.equal(compareRecency(a, b, "name"), -1);
    assert.equal(compareRecency(b, a, "name"), 1);
    assert.equal(compareRecency(a, a, "name"), 0);
    assert.equal(compareRecency({ id: "x" }, { id: "x" }, "name"), 0, "no notes, no updatedAt: nothing to compare");
  });

  test("a note beats updatedAt: a device that logged practice later does not win a setting it never changed later", () => {
    const changedEarly = piece({ settingTimes: { targetBPM: 2000 }, updatedAt: 9000 }); // then logged practice until 9000
    const changedLate = piece({ settingTimes: { targetBPM: 3000 }, updatedAt: 3000 });
    assert.equal(compareRecency(changedEarly, changedLate, "targetBPM"), -1);
    // without notes the old rule applies: the piece touched most recently
    assert.equal(compareRecency(piece({ updatedAt: 9000 }), piece({ updatedAt: 3000 }), "targetBPM"), 1);
  });
});

describe("loading a piece: the notes are kept clean, and a piece without any gets none", () => {
  const raw = (over = {}) => ({ id: "p1", name: "Etude", totalMeasures: 16, startDate: "2026-09-01", progress: {}, ...over });

  test("a piece with no notes loads without the field (nothing for the fingerprint to change)", () => {
    const loaded = validateAndMigratePiece(raw());
    assert.equal("settingTimes" in loaded, false);
  });

  test("only known settings with real times survive", () => {
    const loaded = validateAndMigratePiece(raw({ settingTimes: { name: 100, targetDate: "soon", bogus: 5, status: -3, notes: 0, targetBPM: 250.5, composer: NaN } }));
    assert.deepEqual(loaded.settingTimes, { name: 100, targetBPM: 250.5 });
    assert.deepEqual(cleanSettingTimes({ name: 100, nope: 1 }), { name: 100 });
    assert.equal(cleanSettingTimes({ name: "x" }), null);
    assert.equal(cleanSettingTimes([1, 2]), null);
    assert.equal(cleanSettingTimes(null), null);
  });

  test("garbage in the field is dropped, not kept as an empty object", () => {
    ["x", 5, [], {}, { bogus: 1 }].forEach((junk) => assert.equal("settingTimes" in validateAndMigratePiece(raw({ settingTimes: junk })), false, JSON.stringify(junk)));
  });

  test("a clean piece reloads to itself: no fingerprint moves and nothing re-uploads after the deploy", () => {
    const loaded = validateAndMigratePiece(raw({ settingTimes: { name: 100 } }));
    assert.equal(accountPieceFingerprint(loaded), accountPieceFingerprint(validateAndMigratePiece(JSON.parse(JSON.stringify(loaded)))));
    const plain = validateAndMigratePiece(raw());
    assert.deepEqual(canonicalPiece(plain), canonicalPiece(JSON.parse(JSON.stringify(plain))));
  });
});

describe("the technique library keeps notes for octaves, hands and the two settings (Pass 126)", () => {
  const scale = (id, over = {}) => normalizeTechniqueItem({ id, form: "scale", tonic: "C", quality: "major", octaves: 2, hands: "together", ...over });
  const library = (over = {}) => validateAndMigrateTechnique({ schemaVersion: 1, items: [scale("c"), scale("d", { tonic: "D" })], settings: { scalesPerDay: 3, minutesPerScale: 5 }, updatedAt: 100, ...over });

  test("which parts are timed", () => {
    ["octaves:c", "hands:c", "setting:scalesPerDay", "setting:minutesPerScale"].forEach((k) => assert.equal(isTimedTechniquePart(k), true, k));
    ["scale:c", "check:c", "taskPlan:2026-01-01:c", "walk", "setting:other", "starred:c", 7].forEach((k) => assert.equal(isTimedTechniquePart(k), false, String(k)));
    assert.deepEqual(cleanPartTimes({ "octaves:c": 5, "check:c": 6, "hands:c": 0, "setting:scalesPerDay": 9 }), { "octaves:c": 5, "setting:scalesPerDay": 9 });
    assert.equal(cleanPartTimes({}), null);
  });

  test("a library with no notes loads without the field; one with notes keeps only the real ones", () => {
    assert.equal("partTimes" in library(), false);
    assert.deepEqual(library({ partTimes: { "octaves:c": 50, junk: 1 } }).partTimes, { "octaves:c": 50 });
  });

  test("a change to octaves, hands or a setting gets a note; anything else, and a brand new scale, does not", () => {
    const before = library();
    const changed = (patch) => stampChangedTechnique(before, patch(before), 700);
    assert.deepEqual(changed((t) => ({ ...t, items: t.items.map((it) => (it.id === "c" ? { ...it, octaves: 3 } : it)) })).partTimes, { "octaves:c": 700 });
    assert.deepEqual(changed((t) => ({ ...t, items: t.items.map((it) => (it.id === "d" ? { ...it, hands: "thirds" } : it)) })).partTimes, { "hands:d": 700 });
    assert.deepEqual(changed((t) => ({ ...t, settings: { ...t.settings, minutesPerScale: 8 } })).partTimes, { "setting:minutesPerScale": 700 });
    assert.equal(changed((t) => ({ ...t, items: t.items.map((it) => (it.id === "c" ? { ...it, starred: true } : it)) })).partTimes, undefined, "starring is a yes/no part: no note");
    assert.equal(changed((t) => ({ ...t, items: [...t.items, scale("e", { tonic: "E" })] })).partTimes, undefined, "a scale just added is not a change to its octaves");
    const same = { ...before };
    assert.equal(stampChangedTechnique(before, same, 700), same);
  });

  test("a note is never earlier than one the library already holds", () => {
    const received = library({ partTimes: { "hands:c": 9000 } });
    assert.equal(nextPartStamp(received, 5000), 9001);
    assert.equal(partTime(received, "hands:c"), 9000);
    assert.equal(partTime(received, "octaves:c"), 100, "no note: updatedAt stands in");
    const after = stampChangedTechnique(received, { ...received, settings: { ...received.settings, scalesPerDay: 4 } }, 5000);
    assert.equal(after.partTimes["setting:scalesPerDay"], 9001);
    assert.equal(after.partTimes["hands:c"], 9000, "earlier notes are kept");
  });

  test("the part keys are the engine's own (a renamed key would silently stop stamping)", () => {
    assert.equal(isTimedTechniquePart(K.octaves("c")), true);
    assert.equal(isTimedTechniquePart(K.hands("c")), true);
    assert.equal(isTimedTechniquePart(K.setting("scalesPerDay")), true);
    assert.equal(isTimedTechniquePart(K.setting("minutesPerScale")), true);
    assert.equal(isTimedTechniquePart(K.taskPlan("2026-01-01", "c")), false, "a task's plan has no note: its keys would grow with every day's list");
  });
});
