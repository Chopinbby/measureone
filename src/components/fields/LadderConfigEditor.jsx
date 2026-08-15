import { NumberInput } from "../NumberInput";

/* ------------------------------------------------------------------ */
/*  Editor for piece.ladderConfig — the spaced-repetition maintenance */
/*  ladder's tunable stage lengths, graduation counts, tempo floors,  */
/*  and practiceBPM ratchet step sizes. Hand-picked defaults (see     */
/*  lib/storage.js's DEFAULT_LADDER_CONFIG); this editor makes them   */
/*  adjustable, not evidence-based — see docs/Research.md.            */
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

  const updateStage = (stage, patch) =>
    set({ ladderConfig: { ...config, [stage]: { ...config[stage], ...patch } } });
  const updateBpmSteps = (patch) => set({ ladderConfig: { ...config, bpmSteps: { ...config.bpmSteps, ...patch } } });

  return (
    <div>
      <p className="wizard-hint">
        Advanced tuning for the spaced-repetition maintenance ladder — how often a chunk comes back
        for review, how many clean passes it takes to move up a stage, and how much its practice
        tempo moves after each session. These are hand-picked starting points, not settings tuned
        from real data — change them if your own experience says otherwise.
      </p>

      <SubHeading>Stabilizing</SubHeading>
      <p className="wizard-hint">The first stage after a chunk is introduced — frequent, short-interval review.</p>
      <div className="field-row">
        <label className="field">
          <span>Review every (days)</span>
          <NumberInput value={config.stabilizing.intervalDays} min={1} onCommit={(n) => updateStage("stabilizing", { intervalDays: n })} />
        </label>
        <label className="field">
          <span>Passes to graduate</span>
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
      <p className="wizard-hint">The middle stage — longer intervals, and a real tempo floor kicks in.</p>
      <div className="field-row">
        <label className="field">
          <span>Review every (days)</span>
          <NumberInput value={config.settling.intervalDays} min={1} onCommit={(n) => updateStage("settling", { intervalDays: n })} />
        </label>
        <label className="field">
          <span>Passes to graduate</span>
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
        The resting stage — no further stage to graduate to, so review intervals keep expanding
        instead (capped at the maximum below), and the tempo floor climbs a little with each pass.
      </p>
      <div className="field-row">
        <label className="field">
          <span>Starting interval (days)</span>
          <NumberInput
            value={config.holding.startIntervalDays}
            min={1}
            onCommit={(n) => updateStage("holding", { startIntervalDays: n })}
          />
        </label>
        <label className="field">
          <span>Maximum interval (days)</span>
          <NumberInput
            value={config.holding.maxIntervalDays}
            min={1}
            onCommit={(n) => updateStage("holding", { maxIntervalDays: n })}
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Tempo floor, starting fraction</span>
          <NumberInput
            value={config.holding.tempoFloorStartFraction}
            min={0}
            onCommit={(n) => updateStage("holding", { tempoFloorStartFraction: n })}
          />
        </label>
        <label className="field">
          <span>Tempo floor, step per pass</span>
          <NumberInput
            value={config.holding.tempoFloorStepFraction}
            min={0}
            onCommit={(n) => updateStage("holding", { tempoFloorStepFraction: n })}
          />
        </label>
        <label className="field">
          <span>Tempo floor, cap fraction</span>
          <NumberInput
            value={config.holding.tempoFloorCapFraction}
            min={0}
            onCommit={(n) => updateStage("holding", { tempoFloorCapFraction: n })}
          />
        </label>
      </div>

      <SubHeading>Tempo ratchet</SubHeading>
      <p className="wizard-hint">
        How practiceBPM moves after each logged session, at any stage. A full pass steps up by this
        much; a partial pass steps down. A real fail usually resets straight to this chunk's
        recorded tempo for the stage it drops into, falling back to this step only when nothing's
        recorded yet.
      </p>
      <div className="field-row">
        <label className="field">
          <span>Full pass (+BPM)</span>
          <NumberInput value={config.bpmSteps.pass} onCommit={(n) => updateBpmSteps({ pass: n })} />
        </label>
        <label className="field">
          <span>Partial pass (BPM)</span>
          <NumberInput value={config.bpmSteps.softMiss} onCommit={(n) => updateBpmSteps({ softMiss: n })} />
        </label>
        <label className="field">
          <span>Fail fallback (BPM)</span>
          <NumberInput value={config.bpmSteps.fail} onCommit={(n) => updateBpmSteps({ fail: n })} />
        </label>
      </div>
    </div>
  );
}
