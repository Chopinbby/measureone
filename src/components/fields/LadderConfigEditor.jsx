import { NumberInput } from "../NumberInput";
import { DIFFICULTY_META } from "../../lib/constants";
import { isReviewModelV2 } from "../../lib/scheduling";
import {
  PASS_TABLE_STAGES,
  PASS_TABLE_DIFFICULTIES,
  PASS_TABLE_ROW_LABELS,
  HOLDING_MAX_DAYS_V2,
  autoPassesNeeded,
  passesOverrideFor,
  passTableRowLabelFor,
  hasPassesOverride,
  withPassesOverride,
  withPassesOverridesCleared,
  withHoldingMaxOverride,
} from "../../lib/ladder";

/* ------------------------------------------------------------------ */
/*  Editor for piece.ladderConfig — the spaced-repetition maintenance */
/*  ladder's tunable stage lengths, graduation counts and tempo       */
/*  floors. Hand-picked defaults (see lib/storage.js's                */
/*  DEFAULT_LADDER_CONFIG); this editor makes them adjustable, not    */
/*  evidence-based — see docs/Research.md. The practiceBPM step sizes */
/*  (ladderConfig.bpmSteps) are deliberately not editable here — see  */
/*  docs/Decisions.md.                                                */
/* ------------------------------------------------------------------ */

// Sub-section label, styled inline off the existing .wizard-hint class
// rather than <h4> — this app's heading reset only covers h1/h2/h3
// (App.jsx's CSS), h4 is scoped elsewhere (.piece-notes h4) and isn't in
// this pass's Touches list to extend, so a bare <h4> here would render
// unstyled/inconsistent rather than matching the rest of the app.
function SubHeading({ children }) {
  return <p className="wizard-hint" style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 2 }}>{children}</p>;
}

// Every ladderConfig field this editor exposes is a plain number except
// stabilizing.tempoFloorFraction, whose DEFAULT is null ("Stabilizing has
// no tempo floor" — lib/ladder.js's clearsStageFloor). NumberInput can't
// commit a cleared field back to null (blurring an emptied input just
// snaps back to the last committed value, same as every other NumberInput
// in this app) — mirrors PieceMapTab's manual-confidence override, the one
// other nullable NumberInput-backed field, and its "Reset to automatic"
// button for getting back to null.
export function LadderConfigEditor({ draft, set }) {
  const config = draft.ladderConfig;
  // Pass 139: a piece on the new review plan reads how many passes a chunk
  // needs from a table (plan length by difficulty) instead of the two
  // "Passes to graduate" boxes below.
  const newPlan = isReviewModelV2(draft);

  const updateStage = (stage, patch) =>
    set({ ladderConfig: { ...config, [stage]: { ...config[stage], ...patch } } });

  const stageName = { stabilizing: "Stabilizing", settling: "Settling" };
  const holdingMax = config.overrides && config.overrides.holdingMaxDays;
  const graduateLabel = newPlan ? "Passes to graduate (Review and Focus block cards)" : "Passes to graduate";

  return (
    <div>
      {newPlan && (
        <>
          <SubHeading>Passes to move up a stage</SubHeading>
          <p className="wizard-hint">
            This piece is on the new review plan. How many passes a chunk needs to leave Stabilizing, and again to
            leave Settling, depends on its difficulty and on the length of your plan.{" "}
            {draft.scheduleMode === "minutes"
              ? `Your plan is set by minutes per day, so this piece reads the longest row ("${PASS_TABLE_ROW_LABELS[PASS_TABLE_ROW_LABELS.length - 1]}").`
              : `Your plan is ${draft.daysToLearn} day${Number(draft.daysToLearn) === 1 ? "" : "s"} long, so this piece reads the "${passTableRowLabelFor(draft.daysToLearn, draft.scheduleMode)}" row.`}{" "}
            A chunk never moves up on its first session, and it keeps the passes it has earned if you change the
            plan length. A pass played at 85% or more of the target tempo counts as two.
          </p>
          {PASS_TABLE_STAGES.map((stage) => (
            <div key={stage}>
              <p className="wizard-hint" style={{ marginBottom: 2 }}>{stageName[stage]}</p>
              <div className="field-row">
                {PASS_TABLE_DIFFICULTIES.map((difficulty) => {
                  const auto = autoPassesNeeded(difficulty, draft.daysToLearn, draft.scheduleMode);
                  const own = passesOverrideFor(config, stage, difficulty);
                  return (
                    <label className="field" key={difficulty}>
                      <span>{DIFFICULTY_META[difficulty].label}{own != null ? " (set by you)" : " (automatic)"}</span>
                      <NumberInput
                        value={own != null ? own : auto}
                        min={1}
                        onCommit={(n) => set({ ladderConfig: withPassesOverride(config, stage, difficulty, n, auto) })}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="manual-conf-row">
            <button
              className="ghost-btn"
              disabled={!hasPassesOverride(config)}
              onClick={() => set({ ladderConfig: withPassesOverridesCleared(config) })}
            >
              Reset to automatic
            </button>
          </div>
          <p className="wizard-hint">
            When a chunk comes back is worked out from your plan's length, as a window: it can be reviewed from its
            earliest day, and the app puts it on the lightest day inside that window. Review and Focus block cards (the
            ones that join two chunks) still use the "Review every (days)", "Passes to graduate" and interval numbers
            below, until they are reworked.
          </p>
        </>
      )}

      <p className="wizard-hint">
        Advanced tuning for the spaced-repetition maintenance ladder: how often a chunk comes back
        for review, how many clean passes it takes to move up a stage, and the tempo floors that
        apply along the way. These are hand-picked starting points, not settings tuned from real
        data, so change them if your own experience says otherwise.
      </p>

      <SubHeading>Stabilizing</SubHeading>
      <p className="wizard-hint">The first stage after a chunk is introduced: frequent, short-interval review.</p>
      <div className="field-row">
        <label className="field">
          <span>{newPlan ? "Review every (days) (Review and Focus block cards)" : "Review every (days)"}</span>
          <NumberInput value={config.stabilizing.intervalDays} min={1} onCommit={(n) => updateStage("stabilizing", { intervalDays: n })} />
        </label>
        <label className="field">
          <span>{graduateLabel}</span>
          <NumberInput
            value={config.stabilizing.graduationPasses}
            min={1}
            onCommit={(n) => updateStage("stabilizing", { graduationPasses: n })}
          />
        </label>
        <label className="field">
          <span>Tempo floor (fraction of target)</span>
          {config.stabilizing.tempoFloorFraction == null ? (
            <NumberInput
              value=""
              min={0}
              placeholder="none"
              onCommit={(n) => updateStage("stabilizing", { tempoFloorFraction: n })}
            />
          ) : (
            <div className="manual-conf-row">
              <NumberInput
                value={config.stabilizing.tempoFloorFraction}
                min={0}
                onCommit={(n) => updateStage("stabilizing", { tempoFloorFraction: n })}
              />
              <button className="ghost-btn" onClick={() => updateStage("stabilizing", { tempoFloorFraction: null })}>
                Clear (no floor)
              </button>
            </div>
          )}
        </label>
      </div>

      <SubHeading>Settling</SubHeading>
      <p className="wizard-hint">The middle stage: longer intervals, and a real tempo floor kicks in.</p>
      <div className="field-row">
        <label className="field">
          <span>{newPlan ? "Review every (days) (Review and Focus block cards)" : "Review every (days)"}</span>
          <NumberInput value={config.settling.intervalDays} min={1} onCommit={(n) => updateStage("settling", { intervalDays: n })} />
        </label>
        <label className="field">
          <span>{graduateLabel}</span>
          <NumberInput
            value={config.settling.graduationPasses}
            min={1}
            onCommit={(n) => updateStage("settling", { graduationPasses: n })}
          />
        </label>
        <label className="field">
          <span>Tempo floor (fraction of target)</span>
          <NumberInput
            value={config.settling.tempoFloorFraction}
            min={0}
            onCommit={(n) => updateStage("settling", { tempoFloorFraction: n })}
          />
        </label>
      </div>

      <SubHeading>Holding</SubHeading>
      <p className="wizard-hint">
        The resting stage: no further stage to graduate to, so review intervals keep expanding
        instead (capped at the maximum below). Every 4th logged review since a chunk's most recent
        entry into Holding asks for one extra clean rep, reverting to the usual requirement
        otherwise.
      </p>
      <div className="field-row">
        <label className="field">
          <span>{newPlan ? "Starting interval (days) (Review and Focus block cards)" : "Starting interval (days)"}</span>
          <NumberInput
            value={config.holding.startIntervalDays}
            min={1}
            onCommit={(n) => updateStage("holding", { startIntervalDays: n })}
          />
        </label>
        <label className="field">
          <span>{newPlan ? "Maximum interval (days) (Review and Focus block cards)" : "Maximum interval (days)"}</span>
          <NumberInput
            value={config.holding.maxIntervalDays}
            min={1}
            onCommit={(n) => updateStage("holding", { maxIntervalDays: n })}
          />
        </label>
        {newPlan && (
          <label className="field">
            <span>Maximum interval on the new plan (days)</span>
            {holdingMax == null ? (
              <NumberInput
                value=""
                min={1}
                placeholder={`${HOLDING_MAX_DAYS_V2} (automatic)`}
                onCommit={(n) => set({ ladderConfig: withHoldingMaxOverride(config, n) })}
              />
            ) : (
              <div className="manual-conf-row">
                <NumberInput value={holdingMax} min={1} onCommit={(n) => set({ ladderConfig: withHoldingMaxOverride(config, n) })} />
                <button className="ghost-btn" onClick={() => set({ ladderConfig: withHoldingMaxOverride(config, null) })}>
                  Reset to automatic
                </button>
              </div>
            )}
          </label>
        )}
      </div>
      {newPlan && (
        <p className="wizard-hint">
          This is the longest a chunk's own review may wait in Holding, and its window never reaches past it. The
          maximum interval above is now used only by Review and Focus block cards.
        </p>
      )}
    </div>
  );
}
