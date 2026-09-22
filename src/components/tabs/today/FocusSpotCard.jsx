import { useState, useEffect, useRef } from "react";
import { Target, Check } from "lucide-react";
import { formatRange, formatDuration, todayISODate } from "../../../lib/utils";
import { NumberInput } from "../../NumberInput";

// Pass 91 (experimental v1) — the practice card for a single focus spot,
// distinct from ChecklistItem's normal chunk card: a minutes-based timer
// instead of reps/BPM, and a single "Can you play this cleanly at a low
// tempo yet?" gate instead of the ladder's pass/soft-miss/fail judgment.
// Renders once per unresolved spot (FocusSpotsPanel, TodayTab.jsx, maps
// over every practice chunk's unresolved spots) — a chunk with more than
// one open spot gets one card per spot, not one card for the whole chunk.
//
// `gated` is display-only here — it only changes the bottom note's wording
// (whether this chunk will be *introduced* or will *resume* once every spot
// clears). The actual scheduling consequence of `gated` lives entirely in
// lib/scheduling.js's focusSpotGate; this component never reads or writes
// introducedDay itself.
export function FocusSpotCard({ chunk, spot, gated, siblingCount, requiredMinutes, onLogTime, onUnlogTime, onResolve }) {
  const [timerRunning, setTimerRunning] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [confirming, setConfirming] = useState(false);
  // Committed value only (NumberInput commits on blur/Enter) plus a
  // draft flag so Confirm can enable itself the instant something's typed,
  // the same split ChecklistItem's own reps/BPM fields use (Pass 53) —
  // waiting for the committed value alone would leave Confirm disabled
  // until the field is blurred.
  const [bpm, setBpm] = useState("");
  const [hasBpmDraft, setHasBpmDraft] = useState(false);
  const timerStartRef = useRef(null);

  // Same wall-clock reconciliation as ChecklistItem's own timer (see that
  // file) — recomputed from Date.now() each tick rather than a blind
  // increment, so a throttled/backgrounded tab still self-corrects on the
  // next tick instead of drifting behind real elapsed time.
  useEffect(() => {
    if (!timerRunning) return;
    timerStartRef.current = { startedAt: Date.now(), baseSeconds: durationSeconds };
    const id = setInterval(() => {
      setDurationSeconds(timerStartRef.current.baseSeconds + Math.round((Date.now() - timerStartRef.current.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRunning]);

  const currentSeconds = () => {
    if (!timerRunning || !timerStartRef.current) return durationSeconds;
    return Math.max(0, timerStartRef.current.baseSeconds + Math.floor((Date.now() - timerStartRef.current.startedAt) / 1000));
  };

  // Minimum time this spot must actually be practiced before either action
  // below is reachable — piece.troubleSpotDefaultMinutes (Settings/Wizard),
  // falling back to 5 for a piece that somehow has none (shouldn't happen —
  // storage.js backfills it — but this is the same "don't trust it, verify"
  // spirit as that field's own null-safe reads elsewhere). Checked against
  // currentSeconds(), which already covers both the running timer AND a
  // manually-typed minutes value the same way, so either path satisfies it.
  const requiredSeconds = (requiredMinutes || 5) * 60;
  const meetsMinimum = currentSeconds() >= requiredSeconds;

  const resetTimer = () => {
    setTimerRunning(false);
    setDurationSeconds(0);
  };

  const logTime = () => {
    if (!meetsMinimum) return;
    onLogTime(chunk.id, spot.id, currentSeconds());
    resetTimer();
  };

  const confirmResolve = () => {
    if (!hasBpmDraft || !bpm) return;
    onResolve(chunk.id, spot.id, Number(bpm), currentSeconds());
    resetTimer();
    setConfirming(false);
    setBpm("");
    setHasBpmDraft(false);
  };

  const loggedToday = (spot.sessions || []).some((s) => s.loggedDate === todayISODate());

  if (spot.resolved) {
    return (
      <div id={`focus-spot-${spot.id}`} className="focus-spot-card resolved">
        <span className="checklist-check"><Check size={18} /></span>
        <div className="focus-spot-card-body">
          <div className="focus-spot-card-head">
            <span className="focus-spot-icon"><Target size={11} /></span>
            <span className="mono">{spot.position ? `m. ${spot.position}` : formatRange(chunk.start, chunk.end)}</span>
            <span className="focus-spot-name">{spot.name}</span>
          </div>
          <p className="focus-spot-resolved-line"><Check size={15} /> Resolved at {spot.resolvedBpm} BPM</p>
        </div>
      </div>
    );
  }

  return (
    // Pass 96 — a stable arrival target for Piece Map's open-focus-spot
    // links (App.jsx's scroll-and-highlight effect).
    <div id={`focus-spot-${spot.id}`} className="focus-spot-card">
      {loggedToday ? (
        <button
          type="button"
          className="checklist-check"
          onClick={() => onUnlogTime(chunk.id, spot.id)}
          aria-label="Undo today's logged time"
          title="Undo today's logged time"
        >
          <Check size={18} />
        </button>
      ) : (
        <span className="checklist-check-empty" aria-hidden="true" />
      )}
      <div className="focus-spot-card-body">
        <div className="focus-spot-card-head">
          <span className="focus-spot-icon"><Target size={11} /></span>
          <span className="mono">{spot.position ? `m. ${spot.position}` : formatRange(chunk.start, chunk.end)}</span>
          <span className="focus-spot-name">{spot.name}</span>
          {siblingCount > 1 && <span className="focus-spot-count">{siblingCount} spots on this chunk</span>}
        </div>

        <div className="timer-row">
          <button
            type="button"
            className={`timer-btn ${timerRunning ? "running" : ""}`}
            onClick={() => setTimerRunning((r) => !r)}
          >
            {timerRunning ? "Stop" : "Start"} timer
          </button>
          {timerRunning ? (
            <span className="timer-display mono">
              {/* Counts down toward the requirement, then counts back up past
                  it once met — so it's always showing something meaningful:
                  time still needed, or total time actually spent so far. */}
              {meetsMinimum ? formatDuration(durationSeconds) : formatDuration(Math.max(0, requiredSeconds - durationSeconds))}
            </span>
          ) : (
            <label className="timer-manual">
              <span>minutes practiced (aim {requiredMinutes || 5})</span>
              <NumberInput
                value={durationSeconds ? Math.round(durationSeconds / 60) : ""}
                min={0}
                onCommit={(n) => setDurationSeconds(Math.round(n * 60))}
                placeholder="0"
              />
            </label>
          )}
        </div>

        <p className="focus-spot-prompt"><strong>Can you play this cleanly at a low tempo yet?</strong></p>

        {!meetsMinimum && (
          <p className="tip-line">
            Practice for at least {requiredMinutes || 5} minute{(requiredMinutes || 5) === 1 ? "" : "s"} before logging.
          </p>
        )}

        {!confirming ? (
          <div className="focus-spot-actions">
            <button
              type="button"
              className="ghost-btn sm"
              disabled={!meetsMinimum}
              title={meetsMinimum ? undefined : `Practice for at least ${requiredMinutes || 5} minute${(requiredMinutes || 5) === 1 ? "" : "s"} first`}
              onClick={logTime}
            >
              Not yet, log time
            </button>
            <button
              type="button"
              className="primary-btn sm"
              disabled={!meetsMinimum}
              title={meetsMinimum ? undefined : `Practice for at least ${requiredMinutes || 5} minute${(requiredMinutes || 5) === 1 ? "" : "s"} first`}
              onClick={() => setConfirming(true)}
            >
              Yes, log BPM
            </button>
          </div>
        ) : (
          <div className="focus-spot-bpm-form">
            <label>
              <span>Clean BPM</span>
              <NumberInput
                value={bpm}
                min={20}
                onCommit={(n) => setBpm(n)}
                onDraftChange={(text) => setHasBpmDraft(text !== "")}
                acceptPlaceholderOnTab
                placeholder="e.g. 76"
              />
            </label>
            <button
              type="button"
              className="ghost-btn sm"
              onClick={() => {
                setConfirming(false);
                setBpm("");
                setHasBpmDraft(false);
              }}
            >
              Back
            </button>
            <button type="button" className="primary-btn sm" disabled={!hasBpmDraft} onClick={confirmResolve}>
              Confirm
            </button>
          </div>
        )}

        <p className="tip-line">
          {gated
            ? siblingCount > 1
              ? `Once every focus spot on this chunk resolves, ${formatRange(chunk.start, chunk.end)} will be introduced to daily practice.`
              : `Once resolved, ${formatRange(chunk.start, chunk.end)} will be introduced to daily practice.`
            : `Your regular practice for ${formatRange(chunk.start, chunk.end)} will resume once this resolves.`}
        </p>
      </div>
    </div>
  );
}
