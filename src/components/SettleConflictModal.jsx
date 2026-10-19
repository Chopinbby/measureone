import { X, Check } from "lucide-react";

// Pass 121: the question a held piece asks when BOTH devices changed the same
// thing. One question at a time, in plain words; the words themselves are made in
// lib/accountSync.js (buildSettleQuestions, with tests), this only shows them.
//
// question: { part, title, text, detail?, options: [{ value, label, hint?,
// recommended? }] }, or null for a piece with nothing left to decide (the "ready"
// step, which still waits for the person to say go: opening Review changes nothing
// by itself). `answer` is the option chosen so far for THIS question. Choosing an
// option changes nothing either; "Next" moves on, and only the last "Settle this
// piece" (or "Bring it up to date") applies anything. "Decide later" leaves the piece
// held and exactly as it is; Back goes to the previous question of the same piece.
export function SettleConflictModal({
  pieceName,
  pieceNumber = 1,
  pieceCount = 1,
  question = null,
  stepNumber = 1,
  stepCount = 1,
  answer = null,
  isLast = true,
  busy = false,
  onAnswer,
  onBack,
  onNext,
  onDecideLater,
  onClose,
}) {
  const where = [];
  if (question) where.push(`Question ${stepNumber} of ${stepCount}`);
  if (pieceCount > 1) where.push(`Piece ${pieceNumber} of ${pieceCount}`);
  const primaryLabel = !question ? "Bring it up to date" : isLast ? "Settle this piece" : "Next";

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="settle-title">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <div>
            <h2 id="settle-title" style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19 }}>
              {pieceName}
            </h2>
            {where.length > 0 && (
              <p className="tip-line" style={{ marginTop: 2 }}>
                {where.join(" · ")}
              </p>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {question ? (
            <>
              <p className="wizard-hint" style={{ marginTop: 0 }}>
                This piece was changed on both of your devices since you last synced. Nothing changes until you settle the
                last question, and Decide later leaves it exactly as it is.
              </p>
              {/* an ordinary field's sentence starts with its own name, so the heading would say it twice */}
              {!question.text.startsWith(question.title) && <p style={{ fontWeight: 600, margin: "0 0 4px", fontSize: 14 }}>{question.title}</p>}
              <p style={{ margin: "0 0 14px", fontSize: 15, lineHeight: 1.5, whiteSpace: "pre-line" }}>{question.text}</p>
              {question.detail && (
                <p className="tip-line" style={{ margin: "-8px 0 14px" }}>
                  {question.detail}
                </p>
              )}
              <div role="radiogroup" aria-label="What to keep">
                <p className="wizard-hint" style={{ margin: "0 0 8px" }}>
                  Keep:
                </p>
                {question.options.map((o, i) => {
                  const chosen = answer === o.value;
                  return (
                    <label
                      key={o.value}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "10px 12px",
                        marginBottom: 8,
                        borderRadius: 10,
                        cursor: busy ? "default" : "pointer",
                        border: `1px solid ${chosen ? "var(--accent)" : "var(--line)"}`,
                        background: chosen ? "rgba(47,93,154,0.07)" : "var(--white)",
                      }}
                    >
                      <input
                        type="radio"
                        name={`settle-${question.part}`}
                        value={o.value}
                        checked={chosen}
                        disabled={busy}
                        autoFocus={i === 0}
                        onChange={() => onAnswer(o.value)}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{o.label}</span>
                        {o.recommended && (
                          <span className="tag tag-new" style={{ marginLeft: 8 }}>
                            Recommended
                          </span>
                        )}
                        {o.hint && (
                          <span className="tip-line" style={{ display: "block", marginTop: 2 }}>
                            {o.hint}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <p className="wizard-hint" style={{ marginTop: 0 }}>
                Nothing is left to decide for this piece: the copy on this device and the copy in your account fit together
                now.
              </p>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
                Bring it up to date? Whatever is only here goes up to your account afterwards.
              </p>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="ghost-btn" onClick={onDecideLater} disabled={busy}>
            Decide later
          </button>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {question && stepNumber > 1 && (
              <button className="ghost-btn" onClick={onBack} disabled={busy}>
                Back
              </button>
            )}
            <button className="primary-btn" onClick={onNext} disabled={busy || (!!question && !answer)}>
              {(isLast || !question) && <Check size={15} />}
              {busy ? "Working..." : primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
