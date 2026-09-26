import { useMemo, useState } from "react";
import { Music } from "lucide-react";
import { NumberInput } from "../../NumberInput";
import { StarButton } from "./StarButton";
import { KeyText } from "./KeyText";
import { itemTitle, itemMeta, octavesText, walkIndexOfItem, HANDS_OPTIONS } from "./format";
import { isRepertoireItem } from "../../../lib/technique";
import { daysBetweenInclusive } from "../../../lib/utils";

// The "rotation priority" sort is display-only (the mockup's rule), separate
// from the engine's tiers in lib/technique.js: in-rotation items first, then
// starred and repertoire-key items, then a blend of slowness (70%) and days
// since last checked (30%, capped at 21 days).
const PRIORITY_SLOWNESS_WEIGHT = 0.7;
const PRIORITY_RECENCY_WEIGHT = 0.3;
const PRIORITY_RECENCY_CAP_DAYS = 21;

function daysAgo(dateStr, today) {
  if (!dateStr) return null;
  return daysBetweenInclusive(dateStr, today) - 1;
}

// Library (Pass 101): every item with star, name, meta, even tempo with a
// bar relative to the user's own other items, last checked, and an
// in-rotation switch. Click a row to edit octaves, hands and check octaves.
// Changing check octaves on an item with a saved tempo asks "keep as a
// starting point or start fresh" inside the row; leaving without choosing
// (closing the row, or doing anything else) discards the change.
export function TechniqueLibrary({ technique, repertoireKeys, today, onToggleStarItem, onToggleRotation, onEditItem, onChangeCheckOctaves }) {
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("priority");
  const [openId, setOpenId] = useState(null);
  const [pending, setPending] = useState(null); // { id, to } — an unconfirmed check-octaves change

  const items = technique.items;
  const inRotation = items.filter((it) => it.inRotation);
  const tempos = inRotation.map((it) => it.evenTempo).filter((t) => t != null);
  const min = tempos.length ? Math.min(...tempos) : 0;
  const max = tempos.length ? Math.max(...tempos) : 0;

  const sorted = useMemo(() => {
    const priority = (it) => {
      const slow = it.evenTempo == null ? 1 : 1 - (it.evenTempo - min) / ((max - min) || 1);
      const ago = daysAgo(it.lastCheckedDate, today);
      const recency = ago == null ? 1 : Math.min(ago / PRIORITY_RECENCY_CAP_DAYS, 1);
      return PRIORITY_SLOWNESS_WEIGHT * slow + PRIORITY_RECENCY_WEIGHT * recency;
    };
    const boosted = (it) => (it.starred || isRepertoireItem(it, repertoireKeys) ? 0 : 1);
    return items
      .filter((it) => filter === "all" || it.form === filter)
      .slice()
      .sort((a, b) => {
        if (a.inRotation !== b.inRotation) return a.inRotation ? -1 : 1;
        if (sortBy === "cof") return walkIndexOfItem(a) - walkIndexOfItem(b) || itemTitle(a).localeCompare(itemTitle(b));
        if (sortBy === "tempo") return (a.evenTempo ?? 0) - (b.evenTempo ?? 0) || itemTitle(a).localeCompare(itemTitle(b));
        return boosted(a) - boosted(b) || priority(b) - priority(a) || itemTitle(a).localeCompare(itemTitle(b));
      });
  }, [items, filter, sortBy, min, max, today, repertoireKeys]);

  const toggleRow = (id) => {
    setPending(null);
    setOpenId((cur) => (cur === id ? null : id));
  };

  const requestCheckOctaves = (item, n) => {
    const status = onChangeCheckOctaves(item.id, n);
    setPending(status === "needs-prompt" ? { id: item.id, to: n } : null);
  };
  const resolvePending = (choice) => {
    if (pending) onChangeCheckOctaves(pending.id, pending.to, choice);
    setPending(null);
  };

  return (
    <div className="panel tq-panel">
      <div className="tq-panel-head">
        <h3 className="tq-panel-title">Library</h3>
        <span className="tq-meta">{items.length} items · {inRotation.length} in rotation</span>
      </div>
      <p className="tq-panel-sub">
        Starred scales come up about 3 days a week, and scales in a key from a piece you are playing
        about 4 days a week. A scale that is both comes up 3 or 4 days a week. A note icon marks those keys.
      </p>
      <div className="tq-lib-controls">
        <div className="segmented tq-seg-sm">
          {[["all", "All"], ["scale", "Scales"], ["arpeggio", "Arpeggios"]].map(([v, l]) => (
            <button key={v} type="button" className={filter === v ? "active" : ""} onClick={() => { setPending(null); setFilter(v); }}>{l}</button>
          ))}
        </div>
        <select className="tq-select" aria-label="Sort by" value={sortBy} onChange={(e) => { setPending(null); setSortBy(e.target.value); }}>
          <option value="priority">Sort: rotation priority</option>
          <option value="cof">Sort: circle of fifths</option>
          <option value="tempo">Sort: slowest first</option>
        </select>
      </div>

      {items.length === 0 ? (
        <div className="tq-empty"><p>Your library is empty. Use "Add scale or arpeggio" to start it.</p></div>
      ) : (
        <>
          <div className="tq-lib-grid tq-lib-head">
            <span></span><span>Item</span><span>Even tempo</span><span>Checked</span><span>Rotation</span>
          </div>
          {sorted.map((it) => {
            const title = itemTitle(it);
            const width = it.evenTempo == null ? 0 : Math.round(25 + 75 * (it.evenTempo - min) / ((max - min) || 1));
            const ago = daysAgo(it.lastCheckedDate, today);
            const shownCheckOctaves = pending?.id === it.id ? pending.to : it.checkOctaves;
            return (
              <div key={it.id} className="tq-lib-row-wrap">
                <div className={`tq-lib-grid tq-lib-row${it.inRotation ? "" : " off"}`}>
                  <StarButton on={it.starred} onClick={() => { setPending(null); onToggleStarItem(it.id); }} label={`Practice ${title} more often`} />
                  <div className="tq-lib-item" onClick={() => toggleRow(it.id)}>
                    <div className="tq-title">
                      <KeyText text={title} />
                      {isRepertoireItem(it, repertoireKeys) && (
                        <span className="tq-note" title="Repertoire in this key"><Music size={12} /></span>
                      )}
                    </div>
                    <div className="tq-meta">{it.form === "arpeggio" ? "Arpeggio" : "Scale"} · {itemMeta(it)}</div>
                  </div>
                  <div>
                    {!it.inRotation ? (
                      <div className="tq-meta">n/a</div>
                    ) : it.evenTempo == null ? (
                      <div className="tq-meta">Not set</div>
                    ) : (
                      <>
                        <div className="tq-meta tq-ink">♩ {it.evenTempo}</div>
                        <div className="tq-bar"><i style={{ width: `${width}%` }} /></div>
                      </>
                    )}
                  </div>
                  {/* "Not yet", not "Never": a tempo typed in when the scale
                      was added isn't an even-rhythm check, so a scale can
                      have a tempo and still no check — the tooltip says so. */}
                  <div
                    className="tq-meta"
                    title={ago == null && it.evenTempo != null ? "Tempo entered when added. No even-rhythm check yet." : undefined}
                  >
                    {ago == null ? "Not yet" : ago === 0 ? "today" : `${ago} d ago`}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={it.inRotation}
                    aria-label={`Include ${title} in rotation`}
                    className={`tq-switch${it.inRotation ? " on" : ""}`}
                    onClick={() => { setPending(null); onToggleRotation(it.id); }}
                  />
                </div>
                {openId === it.id && (
                  <div className="tq-row-editor">
                    <div className="tq-editor-grid">
                      <label className="tq-editor-field">
                        <span>Octaves</span>
                        <NumberInput value={it.octaves} min={1} max={4} onCommit={(n) => { setPending(null); onEditItem(it.id, { octaves: n }); }} />
                      </label>
                      <label className="tq-editor-field">
                        <span>Hands</span>
                        <select className="tq-select" value={it.hands} onChange={(e) => { setPending(null); onEditItem(it.id, { hands: e.target.value }); }}>
                          {HANDS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </label>
                      <label className="tq-editor-field">
                        <span>Even-rhythm check</span>
                        <NumberInput value={shownCheckOctaves} min={1} max={4} onCommit={(n) => requestCheckOctaves(it, n)} />
                      </label>
                    </div>
                    {pending?.id === it.id && (
                      <div className="tq-prompt">
                        <div>
                          Your ♩ = {it.evenTempo} was measured over {octavesText(it.checkOctaves)}. Keep it as a
                          starting point, or start fresh?
                        </div>
                        <div className="tq-prompt-buttons">
                          <button type="button" className="primary-btn sm" onClick={() => resolvePending("keep")}>Keep as starting point</button>
                          <button type="button" className="ghost-btn tq-xs" onClick={() => resolvePending("fresh")}>Start fresh</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
