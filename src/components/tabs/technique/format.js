/* ------------------------------------------------------------------ */
/*  Display helpers for the Technique screens (Pass 101) — labels and  */
/*  copy only. Scheduling logic lives in lib/technique.js.             */
/* ------------------------------------------------------------------ */

import { WALK_KEYS, normalizeKey, sameKey, sameSpelledKey } from "../../../lib/technique";

// One display name per walk position, in walk order — each major, then
// its relative minor. Enharmonic pairs are shown as the brief writes them.
export const WALK_KEY_LABELS = [
  "C major", "A minor", "G major", "E minor", "D major", "B minor",
  "A major", "F♯ minor", "E major", "C♯ minor", "B major", "G♯ minor",
  "F♯/G♭ major", "D♯/E♭ minor", "D♭ major", "B♭ minor", "A♭ major", "F minor",
  "E♭ major", "C minor", "B♭ major", "G minor", "F major", "D minor",
];

// The key list for the Add form and a piece's key fields: the 24 keys in
// walk order. An enharmonic pair is ONE choice, labelled with both
// spellings ("F♯/G♭ major", "D♯/E♭ minor"), never two separate entries (on
// direct request, Pass 103 follow-up). `tonic` is the spelling saved on the
// item or piece: always the first of the pair, so a piece and a scale picked
// from the same entry are stored identically and always match.
export const KEY_OPTIONS = WALK_KEY_LABELS.map((label, i) => {
  const [name, quality] = label.split(" ");
  return { value: String(i), label, tonic: name.split("/")[0], quality };
});

// The KEY_OPTIONS entry for a stored { tonic, quality }: matched as spelled
// first, then by sound, so a key saved with the other spelling of a pair
// (e.g. "G♭ major" from an import, or from the brief 26-key list) still
// shows as its combined entry instead of "Not set".
export function keyOptionFor(key) {
  if (!key) return null;
  return KEY_OPTIONS.find((o) => sameSpelledKey(o, key)) || KEY_OPTIONS.find((o) => sameKey(o, key)) || null;
}

export const MINOR_FORMS = [
  { value: "natural", label: "Natural" },
  { value: "harmonic", label: "Harmonic" },
  { value: "melodic", label: "Melodic" },
];

export const HANDS_OPTIONS = [
  { value: "together", label: "Together" },
  { value: "thirds", label: "A third apart" },
  { value: "sixths", label: "A sixth apart" },
];

export const APPLIES_TO_LABEL = {
  both: "Scales and arpeggios",
  scale: "Scales only",
  arpeggio: "Arpeggios only",
  together: "Hands together only",
};

// Walk position of an item's key (0-23), for the circle-of-fifths sort.
export function walkIndexOfItem(item) {
  const k = normalizeKey({ tonic: item.tonic, quality: item.quality });
  if (!k) return 99;
  return WALK_KEYS.findIndex((w) => w.pc === k.pc && w.quality === k.quality);
}

// "F#" → "F♯", "Eb" → "E♭". No regex lookbehind here: Safari only supports
// it from 16.4, the build targets Safari 14, and esbuild can't rewrite it —
// one lookbehind anywhere in the bundle stops the whole app loading there.
function prettyTonic(tonic) {
  return String(tonic || "").replace(/#/g, "♯").replace(/^([A-G])b/, "$1♭");
}

// "D major", "G minor, harmonic", "E♭ major arpeggio", "B minor arpeggio".
export function itemTitle(item) {
  const base = `${prettyTonic(item.tonic)} ${item.quality}`;
  if (item.form === "arpeggio") return `${base} arpeggio`;
  if (item.quality === "minor" && item.minorForm) return `${base}, ${item.minorForm}`;
  return base;
}

export function octavesText(n) {
  return `${n} ${n === 1 ? "octave" : "octaves"}`;
}

export function handsText(h) {
  if (h === "thirds") return "hands a third apart";
  if (h === "sixths") return "hands a sixth apart";
  return "hands together";
}

// "2 octaves · hands together"
export function itemMeta(item) {
  return `${octavesText(item.octaves)} · ${handsText(item.hands)}`;
}
