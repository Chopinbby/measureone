import { useMemo, useState } from "react";
import { Piano } from "lucide-react";
import { TechniqueTaskCard } from "./TechniqueTaskCard";
import { KeyText } from "./KeyText";
import { WALK_KEY_LABELS } from "./format";
import { resolveMethods, walkHint } from "../../../lib/technique";

// The shared Technique panel (Pass 101): icon, heading, "N of M done", a
// sub-line, and today's task cards. Standalone on purpose — Pass 102 puts
// this same component on Master Agenda and Daily Practice, with
// variant="shared" for their sub-line. It is one list: checking a task
// off here is the same saved change wherever the panel appears.
//
// variant "page" (the Technique page's Today tab) adds the walk hint;
// "shared" says checking off counts everywhere.
export function TechniquePanel({ technique, repertoireKeys, variant = "page", onAddItem, handlers }) {
  const [openId, setOpenId] = useState(null);
  const tasks = technique.dayList?.tasks || [];
  const itemsById = useMemo(() => Object.fromEntries(technique.items.map((it) => [it.id, it])), [technique.items]);
  const methodsById = useMemo(
    () => Object.fromEntries(resolveMethods(technique.methodState, technique.customMethods).map((m) => [m.id, m])),
    [technique.methodState, technique.customMethods]
  );
  // A task whose item was removed from the library can't be shown or done.
  const shown = tasks.filter((t) => itemsById[t.itemId]);
  const doneCount = shown.filter((t) => t.done).length;
  const minutes = technique.settings?.minutesPerScale ?? 5;

  // The walk hint (lib/technique.js walkHint): hidden when the key of the
  // day isn't on today's list, and still naming today's key after it's done.
  const walk = variant === "page" ? walkHint(technique.items, technique.walkPosition, technique.dayList) : null;

  return (
    <div className="panel tq-panel">
      <div className="tq-panel-head">
        <h3 className="tq-panel-title"><Piano size={16} /> Technique</h3>
        {shown.length > 0 && <span className="tq-meta">{doneCount} of {shown.length} done</span>}
      </div>
      <p className="tq-panel-sub">
        Today's scales and arpeggios, about {minutes} minutes each.
        {variant !== "page" && " Checking one off here counts everywhere it appears."}
        {walk && (
          <>
            {" Circle of fifths: "}
            <KeyText text={WALK_KEY_LABELS[walk.today.position]} /> today
            {walk.next.position !== walk.today.position && (
              <>, <KeyText text={WALK_KEY_LABELS[walk.next.position]} /> next</>
            )}
            .
          </>
        )}
      </p>
      {technique.items.length === 0 ? (
        <div className="tq-empty">
          <p>No scales or arpeggios yet. Add one to start your daily list.</p>
          {onAddItem && <button type="button" className="ghost-btn" onClick={onAddItem}>Add scale or arpeggio</button>}
        </div>
      ) : shown.length === 0 ? (
        <div className="tq-empty">
          <p>Nothing on today's list. Scales you add or put back in rotation join it right away.</p>
        </div>
      ) : (
        shown.map((t) => (
          <TechniqueTaskCard
            key={t.itemId}
            task={t}
            item={itemsById[t.itemId]}
            methodsById={methodsById}
            repertoireKeys={repertoireKeys}
            open={openId === t.itemId}
            onToggleOpen={() => setOpenId((cur) => (cur === t.itemId ? null : t.itemId))}
            {...handlers}
          />
        ))
      )}
    </div>
  );
}
