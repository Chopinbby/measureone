import { Trash2, Plus, Copy } from "lucide-react";
import { NumberInput } from "../NumberInput";

export function BpmZonesEditor({ draft, set }) {
  // Same "pick up where the furthest-reaching one left off" default
  // SectionsEditor's addSection uses — the new zone's start is the highest
  // `end` across every existing zone (not just the last one in array
  // order, which can drift out of measure order once zones are edited
  // non-sequentially) plus 1, clamped to totalMeasures, rather than always
  // restarting at measure 1.
  const addZone = () => {
    const zones = draft.bpmZones || [];
    const lastEnd = Math.max(0, ...zones.map((z) => z.end));
    const start = Math.min(lastEnd + 1, draft.totalMeasures);
    set({
      bpmZones: [...zones, { id: `bz${Date.now()}`, start, end: draft.totalMeasures, bpm: draft.targetBPM || 100 }],
    });
  };
  const sections = draft.sections || [];
  // Sections are always set up first now (this panel sits right after
  // Sections in both the Wizard and Settings) — no equivalent "untouched
  // default" state to gate on the way the old sections-copy-from-zones
  // button did, since bpmZones' own default is a genuinely empty array,
  // not a single placeholder entry. So the safe-to-overwrite-without-asking
  // line is simply "no zones exist yet"; once the user has actually added
  // one, a wholesale replace needs confirmation first.
  const zonesAreUntouchedDefault = (draft.bpmZones || []).length === 0;
  const copyRangesFromSections = () => {
    if (
      !zonesAreUntouchedDefault &&
      !window.confirm("This will replace your current tempo zones with the section ranges — continue?")
    ) {
      return;
    }
    // "Copy ranges" should copy ranges — a zone that already had its own
    // custom BPM target shouldn't get silently flattened back to the
    // whole-piece default just because its range also got updated. Keeps
    // each surviving position's BPM (the zone currently at that index),
    // falling back to the default only for a position with no prior zone
    // to inherit from (more sections than zones existed before this copy).
    const existingZones = draft.bpmZones || [];
    set({
      bpmZones: sections.map((s, i) => ({
        // addZone's single-item `bz${Date.now()}` id is unique because each
        // click happens at a different moment — this replaces every zone in
        // one synchronous batch, where Date.now() would return the same
        // millisecond for every section and collide. The `_i` suffix keeps
        // the same prefix/timestamp shape while staying unique here.
        id: `bz${Date.now()}_${i}`,
        // Sections are already guaranteed start <= end (updateSection's own
        // min/max swap), but re-applying it here costs nothing and guards
        // against a section saved backwards before that fix existed (an old
        // import, a hand-edited backup) — same defensive reasoning the old
        // reverse-direction copy used.
        start: Math.min(s.start, s.end),
        end: Math.max(s.start, s.end),
        bpm: existingZones[i]?.bpm ?? (draft.targetBPM || 100),
      })),
    });
  };
  // start/end commit independently (each NumberInput fires its own
  // onCommit), so a patch touching just one of them can leave the pair
  // backwards — the same gap SectionsEditor.updateSection had before Pass
  // 51 fixed it there, left open here until it was found while building the
  // sections/tempo-zones copy tooling: a backwards zone silently never
  // matches any chunk in getDefaultTargetBPM's rangesOverlap check, rather
  // than crashing, but it's still a real, silently-wrong zone. Re-normalized
  // with the same min/max swap.
  const updateZone = (i, patch) =>
    set({
      bpmZones: draft.bpmZones.map((z, idx) => {
        if (idx !== i) return z;
        const merged = { ...z, ...patch };
        return { ...merged, start: Math.min(merged.start, merged.end), end: Math.max(merged.start, merged.end) };
      }),
    });
  const removeZone = (i) => set({ bpmZones: draft.bpmZones.filter((_, idx) => idx !== i) });

  return (
    <div>
      <p className="wizard-hint">
        Optionally set a different tempo target for specific measure ranges — this overrides the
        whole-piece default (set under Piece) for those measures.
      </p>
      <div className="pairs-list">
        {(draft.bpmZones || []).map((z, i) => (
          <div key={z.id} className="pair-row">
            <span className="pair-label">mm.</span>
            <NumberInput value={z.start} min={1} max={draft.totalMeasures} onCommit={(n) => updateZone(i, { start: n })} />
            <span>–</span>
            <NumberInput value={z.end} min={1} max={draft.totalMeasures} onCommit={(n) => updateZone(i, { end: n })} />
            <span className="pair-label">target</span>
            <NumberInput value={z.bpm} min={20} max={400} onCommit={(n) => updateZone(i, { bpm: n })} />
            <button className="icon-btn" onClick={() => removeZone(i)} aria-label="Remove">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button className="ghost-btn" onClick={addZone}>
          <Plus size={14} /> Add tempo zone
        </button>
        <button className="ghost-btn" onClick={copyRangesFromSections}>
          <Copy size={14} /> Copy ranges from sections
        </button>
      </div>
    </div>
  );
}
