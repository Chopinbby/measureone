import { X, Check } from "lucide-react";

// Pass 121: the screens a held piece goes through when BOTH devices changed the same
// thing. This only DRAWS what lib/settleFlow.js (settleView) says: which screen it is,
// the question and its options, the summary, the buttons. The words are made in
// lib/accountSync.js and lib/settleFlow.js, with tests; nothing here decides anything.
//
// view: { stage: "question" | "recap" | "ready", notice, intro, stepLabel,
// primaryLabel, canNext, canBack, applies, question, answer, recap }
//   question         a question to answer ({ part, kind, title, text, detail?, options:
//                    [{ value, label, hint?, recommended? }] }) and the value chosen so far.
//                    Choosing an option changes nothing, and neither does Next.
//   recap            what will be kept, and what will be removed. The button here is the
//                    ONE moment anything is applied (the caller reads the account again
//                    first, in case it moved on).
//   ready            nothing left to decide; still waits for the person to say go.
// "Decide later" leaves the piece held and exactly as it is.
export function SettleConflictModal({ pieceName, pieceNumber = 1, pieceCount = 1, view, busy = false, onAnswer, onBack, onNext, onDecideLater, onClose }) {
  const where = [];
  if (view.stepLabel) where.push(view.stepLabel);
  if (pieceCount > 1) where.push(`Piece ${pieceNumber} of ${pieceCount}`);
  const question = view.question;
  const recap = view.recap;

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
          {view.notice && (
            <p className="wizard-hint import-warning" role="status" style={{ marginTop: 0 }}>
              {view.notice}
            </p>
          )}
          <p className="wizard-hint" style={{ marginTop: 0 }}>
            {view.intro}
          </p>
          {question && (
            <>
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
                  const chosen = view.answer === o.value;
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
          )}
          {recap && (
            <>
              <p style={{ fontWeight: 600, margin: "0 0 6px", fontSize: 14 }}>You are keeping:</p>
              <ul style={{ margin: "0 0 14px", paddingLeft: 20, fontSize: 15, lineHeight: 1.5 }}>
                {recap.keeps.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
              {recap.warnings.length > 0 && (
                <div className="wizard-hint import-warning" role="note" style={{ marginBottom: 0 }}>
                  <p style={{ fontWeight: 600, margin: "0 0 4px" }}>Please check before you settle:</p>
                  <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.5 }}>
                    {recap.warnings.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {view.stage === "ready" && <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>Bring it up to date? Whatever is only here goes up to your account afterwards.</p>}
        </div>
        <div className="modal-foot">
          <button className="ghost-btn" onClick={onDecideLater} disabled={busy}>
            Decide later
          </button>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {view.canBack && (
              <button className="ghost-btn" onClick={onBack} disabled={busy}>
                Back
              </button>
            )}
            <button className="primary-btn" onClick={onNext} disabled={busy || !view.canNext}>
              {view.applies && <Check size={15} />}
              {busy ? "Working..." : view.primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
