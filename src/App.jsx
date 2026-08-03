import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BookOpen,
  LayoutGrid,
  CalendarDays,
  Music2,
  ListChecks,
  LineChart,
  BarChart3,
  Settings as SettingsIcon,
  Plus,
  ChevronDown,
  Pencil,
  RefreshCw,
  Upload,
} from "lucide-react";

import { clamp, getCurrentDay } from "./lib/utils";
import { EFFORT_TO_MIN } from "./lib/constants";
import { generateAllChunks } from "./lib/chunking";
import { getEffectiveTimeline, computeScheduleStatus } from "./lib/scheduling";
import { computeRevivalPlan } from "./lib/revival";
import { ensureWorkId, partsOfWork, groupPiecesByWork } from "./lib/works";
import {
  loadPiecesFromStorage,
  loadActivePieceId,
  savePieceToStorage,
  saveActivePieceIdToStorage,
  removePieceFromStorage,
  downloadBackup,
  parseBackupPieces,
} from "./lib/storage";

import { ManuscriptDoodle } from "./components/Manuscript";
import { RevivalEntryModal } from "./components/RevivalEntryModal";
import { DeletePieceModal } from "./components/DeletePieceModal";
import { Wizard } from "./components/Wizard";

import { OverviewTab } from "./components/tabs/OverviewTab";
import { TimelineTab } from "./components/tabs/TimelineTab";
import { PieceMapTab } from "./components/tabs/PieceMapTab";
import { TodayTab } from "./components/tabs/TodayTab";
import { RevivalTab } from "./components/tabs/RevivalTab";
import { ProgressTab } from "./components/tabs/ProgressTab";
import { AnalyticsTab } from "./components/tabs/AnalyticsTab";
import { SettingsTab } from "./components/tabs/SettingsTab";

/* ------------------------------------------------------------------ */
/*  App shell                                                          */
/* ------------------------------------------------------------------ */

const NAV_BASE = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "timeline", label: "Timeline", icon: CalendarDays },
  { key: "map", label: "Piece Map", icon: Music2 },
  { key: "today", label: "Today's Practice", icon: ListChecks },
  { key: "progress", label: "Progress", icon: LineChart },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];
const REVIVAL_NAV_ITEM = { key: "revival", label: "Revival", icon: RefreshCw };

export default function App() {
  const [pieces, setPieces] = useState({});
  const [activePieceId, setActivePieceId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [settingsEditing, setSettingsEditing] = useState(false);
  const [editDraft, setEditDraftState] = useState(null);
  const [dayOverride, setDayOverride] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [revivalModalOpen, setRevivalModalOpen] = useState(false);
  const [wizardJoinWork, setWizardJoinWork] = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const importInputRef = useRef(null);

  const piece = activePieceId ? pieces[activePieceId] : null;

  // Load every saved piece, then whichever one was active last.
  useEffect(() => {
    const found = loadPiecesFromStorage();
    setPieces(found);
    setActivePieceId(loadActivePieceId(found));
    setLoaded(true);
  }, []);

  // Persist only the active piece when it changes.
  useEffect(() => {
    if (!loaded || !activePieceId || !pieces[activePieceId]) return;
    savePieceToStorage(activePieceId, pieces[activePieceId]);
  }, [pieces, activePieceId, loaded]);

  // Persist which piece is active.
  useEffect(() => {
    if (!loaded) return;
    saveActivePieceIdToStorage(activePieceId);
  }, [activePieceId, loaded]);

  const updatePiece = (updater) => {
    if (!activePieceId) return;
    setPieces((prev) => {
      const current = prev[activePieceId];
      if (!current) return prev;
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...prev, [activePieceId]: next };
    });
  };

  const chunkSet = useMemo(() => (piece ? generateAllChunks(piece) : null), [piece]);
  const chunks = chunkSet ? chunkSet.all : [];
  const practiceChunks = chunkSet ? chunkSet.practiceChunks : [];
  const timeline = useMemo(() => (piece ? getEffectiveTimeline(piece, chunkSet) : null), [piece, chunkSet]);
  const realCurrentDay = useMemo(
    () => (piece && timeline ? getCurrentDay(piece, timeline.days.length) : 1),
    [piece, timeline]
  );
  const currentDay = dayOverride || realCurrentDay;

  const navItems = useMemo(() => {
    if (!piece || !piece.revival || !piece.revival.active) return NAV_BASE;
    const items = [...NAV_BASE];
    items.splice(items.findIndex((n) => n.key === "progress"), 0, REVIVAL_NAV_ITEM);
    return items;
  }, [piece && piece.revival && piece.revival.active]);

  const switchToPiece = (id) => {
    setActivePieceId(id);
    setSwitcherOpen(false);
    setActiveTab("overview");
    setDayOverride(null);
    setSettingsEditing(false);
    setEditDraftState(null);
  };

  const handleComplete = (finished, options = {}) => {
    const id = `p_${Date.now()}`;
    const withId = ensureWorkId({ ...finished, id });
    setPieces((prev) => ({ ...prev, [id]: withId }));
    setActivePieceId(id);
    setWizardOpen(false);
    setWizardJoinWork(null);
    setSwitcherOpen(false);
    setActiveTab("overview");
    setDayOverride(null);
    if (options.startAsRevival) setRevivalModalOpen(true);
  };

  const openWizard = (joinWork = null) => {
    setWizardJoinWork(joinWork);
    setWizardOpen(true);
    setSwitcherOpen(false);
  };

  const handleCloseWizard = () => {
    setWizardOpen(false);
    setWizardJoinWork(null);
  };

  // Adding a movement to the work the active piece belongs to.
  const handleAddPart = () => {
    if (!piece || !piece.workId) return;
    openWizard({ workId: piece.workId, workName: piece.workName, composer: piece.composer });
  };

  const handleDeletePiece = () => {
    if (!piece) return;
    const idToDelete = piece.id;
    const remainingIds = Object.keys(pieces).filter((id) => id !== idToDelete);
    setPieces((prev) => {
      const next = { ...prev };
      delete next[idToDelete];
      return next;
    });
    removePieceFromStorage(idToDelete);
    setActivePieceId(remainingIds[0] || null);
    setEditDraftState(null);
    setSettingsEditing(false);
    setActiveTab("overview");
    setDayOverride(null);
    setDeleteModalOpen(false);
  };

  const handleExportAll = () => downloadBackup(pieces);

  const handleImportClick = () => importInputRef.current?.click();

  const handleImportFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      let importedPieces;
      try {
        importedPieces = parseBackupPieces(reader.result);
      } catch (e) {
        window.alert("That file doesn't look like a valid MeasureOne backup.");
        return;
      }
      if (!importedPieces || importedPieces.length === 0) {
        window.alert("No pieces found in that backup file.");
        return;
      }
      const next = { ...pieces };
      let firstNewId = null;
      importedPieces.forEach((p) => {
        if (!p || !p.id) return;
        const id = next[p.id] ? `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : p.id;
        const withId = { ...p, id };
        next[id] = withId;
        if (!firstNewId) firstNewId = id;
        savePieceToStorage(id, withId);
      });
      setPieces(next);
      if (!activePieceId && firstNewId) setActivePieceId(firstNewId);
      window.alert(`Imported ${importedPieces.length} piece(s).`);
    };
    reader.readAsText(file);
  };

  // Editing state lives here, not inside SettingsTab, so switching tabs
  // mid-edit doesn't unmount (and lose) the in-progress draft.
  const startEditing = () => {
    setEditDraftState((d) => d || { ...piece });
    setSettingsEditing(true);
    setActiveTab("settings");
  };
  const setEditDraft = (patch) => setEditDraftState((d) => ({ ...d, ...patch }));
  const handleSavePiece = (updated) => {
    // Typing a work title on a standalone piece promotes it into a work;
    // clearing it pulls the piece back out. See lib/works.js.
    updatePiece(ensureWorkId({ ...updated, rescheduleMarker: null }));
    setEditDraftState(null);
    setSettingsEditing(false);
  };
  const handleDiscardEdit = () => {
    setEditDraftState(null);
    setSettingsEditing(false);
  };

  const handleToggleDone = (chunkId, day) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const entry = progress[chunkId] ? { ...progress[chunkId], doneDays: [...progress[chunkId].doneDays] } : { doneDays: [] };
      const idx = entry.doneDays.indexOf(day);
      if (idx >= 0) entry.doneDays.splice(idx, 1);
      else entry.doneDays.push(day);
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  const handleLogSession = (chunkId, day, cleanReps, bpm, effectiveness, durationSeconds) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId] || { doneDays: [] };
      const doneDays = prevEntry.doneDays.includes(day) ? prevEntry.doneDays : [...prevEntry.doneDays, day];
      const sessions = (prevEntry.sessions || []).filter((s) => s.day !== day);
      sessions.push({ day, cleanReps, bpm, effectiveness, durationSeconds });
      progress[chunkId] = { ...prevEntry, doneDays, sessions, currentBPM: bpm };
      return { ...p, progress };
    });
  };

  const handleUnlogSession = (chunkId, day) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId];
      if (!prevEntry) return p;
      const doneDays = (prevEntry.doneDays || []).filter((d) => d !== day);
      const sessions = (prevEntry.sessions || []).filter((s) => s.day !== day);
      progress[chunkId] = { ...prevEntry, doneDays, sessions };
      return { ...p, progress };
    });
  };

  const handleUpdateBPM = (chunkId, field, value) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const entry = progress[chunkId] ? { ...progress[chunkId] } : { doneDays: [] };
      entry[field] = value;
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  const handleSetManualConfidence = (chunkId, value) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const entry = progress[chunkId] ? { ...progress[chunkId] } : { doneDays: [] };
      entry.manualConfidence = value;
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  const handleSetWeakSpot = (chunkId, value) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const entry = progress[chunkId] ? { ...progress[chunkId] } : { doneDays: [] };
      entry.weakSpot = value;
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  const handleSetMemoryAnchor = (id, text) => {
    updatePiece((p) => {
      const memoryAnchors = { ...(p.memoryAnchors || {}) };
      const trimmed = (text || "").trim();
      if (trimmed) memoryAnchors[id] = trimmed;
      else delete memoryAnchors[id];
      return { ...p, memoryAnchors };
    });
  };

  const handleUpdateRevival = (patch) => {
    updatePiece((p) => ({ ...p, revival: { ...(p.revival || {}), ...patch } }));
  };

  const handleOpenRevival = () => {
    if (piece.revival && piece.revival.active) setActiveTab("revival");
    else setRevivalModalOpen(true);
  };

  const handleStartRevival = ({ purpose, performanceTempo, lastPlayedDate }) => {
    updatePiece((p) => ({
      ...p,
      lastPlayedDate: lastPlayedDate || p.lastPlayedDate || null,
      revival: {
        active: true,
        startedAt: Date.now(),
        purpose,
        performanceTempo: performanceTempo || null,
        tempoLadderStartFraction: 0.6,
        reassessmentComplete: false,
        plan: null,
      },
    }));
    setRevivalModalOpen(false);
    setActiveTab("revival");
  };

  const handleEndRevival = () => {
    if (!window.confirm("End this revival cycle? Weak-spot flags and confidence ratings stay, but the revival plan will be cleared.")) return;
    updatePiece((p) => ({
      ...p,
      revival: {
        active: false,
        startedAt: null,
        purpose: null,
        performanceTempo: null,
        tempoLadderStartFraction: 0.6,
        reassessmentComplete: false,
        plan: null,
      },
    }));
    setActiveTab("overview");
  };

  const handleGenerateRevivalPlan = () => {
    handleUpdateRevival({ plan: computeRevivalPlan(piece, chunkSet, currentDay) });
  };

  const handleReassessRange = (from, to, level) => {
    const levelNum = level === "easy" ? 1 : level === "medium" ? 2 : 3;
    updatePiece((p) => {
      const measureDifficulty = [...p.measureDifficulty];
      for (let m = from; m <= to; m++) {
        if (m >= 1 && m <= measureDifficulty.length) measureDifficulty[m - 1] = levelNum;
      }
      return { ...p, measureDifficulty };
    });
  };

  const handleSelectDay = (dayNumber) => {
    setDayOverride(dayNumber);
    setActiveTab("today");
  };

  const handleReschedule = () => {
    const status = computeScheduleStatus(piece, practiceChunks, timeline, currentDay);
    if (status.remainingChunkIds.length === 0) return;

    const remaining = practiceChunks.filter((c) => status.remainingChunkIds.includes(c.id));
    const remainingEffort = remaining.reduce((s, c) => s + c.effort, 0);
    const availableDays = Math.max(1, timeline.days.length - currentDay + 1);
    const requiredDays = Math.max(
      1,
      Math.ceil(((remainingEffort * EFFORT_TO_MIN) / 0.65) / Math.max(5, piece.minutesPerDay))
    );

    let message = `This will rebalance the ${status.remainingChunkIds.length} chunk(s) you haven't started yet across the days left in your plan. Chunks you've already practiced stay where they are. Continue?`;
    if (requiredDays > availableDays) {
      message = `Heads up: at your current pace (${piece.minutesPerDay} min/day), what's left realistically needs about ${requiredDays} more day(s), but only ${availableDays} day(s) remain in this plan. Rescheduling will pack things in as tightly as possible, but you likely won't finish everything by your target date. You could extend the timeline in Settings instead.\n\nReschedule anyway?`;
    }

    if (!window.confirm(message)) return;
    updatePiece((p) => ({
      ...p,
      rescheduleMarker: { asOfDay: currentDay, remainingChunkOrder: status.remainingChunkIds },
    }));
  };

  const pieceList = Object.values(pieces).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const pieceGroups = groupPiecesByWork(pieceList);
  const workParts = piece ? partsOfWork(pieceList, piece.workId) : [];

  return (
    <div className="measureone-app">
      <style>{CSS}</style>
      <input
        type="file"
        accept="application/json"
        ref={importInputRef}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files[0];
          if (file) handleImportFile(file);
          e.target.value = "";
        }}
      />

      {!loaded ? (
        <div className="empty-state">
          <p className="wizard-hint" style={{ margin: 0 }}>Loading your pieces…</p>
        </div>
      ) : !piece ? (
        <div className="empty-state">
          <div className="hero-card empty-hero-card">
            <div className="hero-doodle-band"><ManuscriptDoodle /></div>
            <div className="hero-content empty-hero-content">
              <p className="eyebrow">MeasureOne</p>
              <h1>A practice plan for every piece, at any stage.</h1>
              <p className="empty-sub">
                Tell us the measures, the hard parts, and how long you've got. We'll turn it into
                a day-by-day plan you can actually follow.
              </p>
              <button className="primary-btn lg" onClick={() => openWizard()}>
                <Plus size={18} /> Start a new piece
              </button>
              {pieceList.length > 0 && (
                <button className="ghost-btn" style={{ marginTop: 16 }} onClick={() => switchToPiece(pieceList[pieceList.length - 1].id)}>
                  Return to Dashboard
                </button>
              )}
              <button className="ghost-btn" style={{ marginTop: 16 }} onClick={handleImportClick}>
                <Upload size={14} /> Import a backup
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="app-shell">
          <nav className="sidebar">
            <div className="brand"><BookOpen size={20} /><span>MeasureOne</span></div>

            <div className="piece-switcher">
              <button className="piece-switcher-trigger" onClick={() => setSwitcherOpen((o) => !o)}>
                <span className="piece-switcher-name">{piece.name || "Untitled piece"}</span>
                <ChevronDown size={14} className={switcherOpen ? "rotated" : ""} />
              </button>
              {switcherOpen && (
                <div className="piece-switcher-list">
                  {pieceGroups.map((g) => (
                    <div key={g.workId || g.pieces[0].id} className={g.workId ? "piece-switcher-work" : ""}>
                      {g.workId && <div className="piece-switcher-work-name">{g.workName}</div>}
                      {g.pieces.map((p) => (
                        <button
                          key={p.id}
                          className={`piece-switcher-item ${p.id === activePieceId ? "active" : ""}`}
                          onClick={() => switchToPiece(p.id)}
                        >
                          {p.name || (g.workId ? "Untitled movement" : "Untitled piece")}
                        </button>
                      ))}
                    </div>
                  ))}
                  <button className="piece-switcher-add" onClick={() => openWizard()}>
                    <Plus size={14} /> Add new piece
                  </button>
                </div>
              )}
            </div>

            <div className="nav-list">
              {navItems.map((n) => {
                const Icon = n.icon;
                return (
                  <button
                    key={n.key}
                    className={`nav-item ${activeTab === n.key ? "active" : ""}`}
                    onClick={() => setActiveTab(n.key)}
                  >
                    <Icon size={17} />
                    <span>{n.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="sidebar-foot">
              <button className="ghost-btn full" onClick={startEditing}>
                <Pencil size={14} /> Edit piece
              </button>
            </div>
          </nav>

          <main className="main-content">
            {activeTab === "overview" && (
              <OverviewTab
                piece={piece}
                practiceChunks={practiceChunks}
                chunks={chunks}
                timeline={timeline}
                currentDay={currentDay}
                onReschedule={handleReschedule}
                onAddPiece={() => openWizard()}
                onStartRevival={handleOpenRevival}
                workParts={workParts}
                onSelectPart={switchToPiece}
                onAddPart={handleAddPart}
              />
            )}
            {activeTab === "timeline" && <TimelineTab chunks={chunks} timeline={timeline} onSelectDay={handleSelectDay} />}
            {activeTab === "map" && (
              <PieceMapTab
                piece={piece}
                chunks={chunks}
                currentDay={currentDay}
                onUpdateBPM={handleUpdateBPM}
                onSetManualConfidence={handleSetManualConfidence}
                onSetWeakSpot={handleSetWeakSpot}
                onSetMemoryAnchor={handleSetMemoryAnchor}
              />
            )}
            {activeTab === "revival" && piece.revival && piece.revival.active && (
              <RevivalTab
                piece={piece}
                chunkSet={chunkSet}
                currentDay={currentDay}
                onUpdateBPM={handleUpdateBPM}
                onSetManualConfidence={handleSetManualConfidence}
                onSetWeakSpot={handleSetWeakSpot}
                onSetMemoryAnchor={handleSetMemoryAnchor}
                onFinishReassessment={() => handleUpdateRevival({ reassessmentComplete: true })}
                onReopenReassessment={() => handleUpdateRevival({ reassessmentComplete: false })}
                onGeneratePlan={handleGenerateRevivalPlan}
                onSetPerformanceTempo={(n) => handleUpdateRevival({ performanceTempo: n || null })}
                onSetTempoLadderFraction={(n) => handleUpdateRevival({ tempoLadderStartFraction: n })}
                onLogSession={handleLogSession}
                onUnlogSession={handleUnlogSession}
                onEndRevival={handleEndRevival}
              />
            )}
            {activeTab === "today" && (
              <TodayTab
                piece={piece}
                chunks={chunks}
                timeline={timeline}
                currentDay={currentDay}
                isRealToday={currentDay === realCurrentDay}
                onDayChange={(d) => setDayOverride(clamp(d, 1, timeline.days.length))}
                onJumpToday={() => setDayOverride(null)}
                onLogSession={handleLogSession}
                onUnlogSession={handleUnlogSession}
                onToggleDone={handleToggleDone}
                onReschedule={handleReschedule}
                onReassessRange={handleReassessRange}
              />
            )}
            {activeTab === "progress" && <ProgressTab piece={piece} chunks={chunks} timeline={timeline} currentDay={currentDay} />}
            {activeTab === "analytics" && <AnalyticsTab piece={piece} chunks={chunks} currentDay={currentDay} />}
            {activeTab === "settings" && (
              <SettingsTab
                piece={piece}
                editDraft={editDraft}
                setEditDraft={setEditDraft}
                onSave={handleSavePiece}
                onDelete={() => setDeleteModalOpen(true)}
                editing={settingsEditing}
                onStartEdit={startEditing}
                onDiscard={handleDiscardEdit}
                onAddPiece={() => openWizard()}
                onExportAll={handleExportAll}
                onImportClick={handleImportClick}
              />
            )}
          </main>
        </div>
      )}

      {wizardOpen && (
        <Wizard onCancel={handleCloseWizard} onComplete={handleComplete} hasPiece={!!piece} joinWork={wizardJoinWork} />
      )}
      {revivalModalOpen && piece && (
        <RevivalEntryModal piece={piece} onCancel={() => setRevivalModalOpen(false)} onStart={handleStartRevival} />
      )}
      {deleteModalOpen && piece && (
        <DeletePieceModal piece={piece} onCancel={() => setDeleteModalOpen(false)} onConfirm={handleDeletePiece} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

.measureone-app {
  --paper: #EEF0EC;
  --paper-card: #F8F9F6;
  --ink: #202A33;
  --ink-soft: #57646F;
  --ink-faint: #8B96A0;
  --line: rgba(32,42,51,0.14);
  --brass: #B98A3E;
  --brass-deep: #8F6A2D;
  --teal: #2E6E63;
  --brick: #B5473A;
  --white: #FFFFFF;
  font-family: 'Inter', sans-serif;
  color: var(--ink);
  background: var(--paper);
  min-height: 100%;
  width: 100%;
  box-sizing: border-box;
}
.measureone-app *, .measureone-app *::before, .measureone-app *::after { box-sizing: border-box; }
.measureone-app h1, .measureone-app h2, .measureone-app h3 {
  font-family: 'Fraunces', serif; font-weight: 600; margin: 0; color: var(--ink);
}
.measureone-app .mono { font-family: 'IBM Plex Mono', monospace; }
.measureone-app button { font-family: inherit; cursor: pointer; }
.measureone-app input { font-family: inherit; }
.measureone-app :focus-visible { outline: 2px solid var(--brass-deep); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .measureone-app * { transition: none !important; animation: none !important; }
}

.app-shell { display: flex; min-height: 100vh; }
.sidebar {
  width: 232px; flex-shrink: 0; background: var(--paper-card); border-right: 1px solid var(--line);
  display: flex; flex-direction: column; padding: 20px 14px; position: sticky; top: 0; height: 100vh;
}
.brand { display: flex; align-items: center; gap: 8px; padding: 6px 10px 20px; font-family: 'Fraunces', serif; font-weight: 600; font-size: 18px; color: var(--brass-deep); }
.nav-list { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; border: none;
  background: transparent; color: var(--ink-soft); font-size: 14px; font-weight: 500; text-align: left;
  width: 100%; transition: background .15s, color .15s;
}
.nav-item span { flex: 1; }
.nav-item:hover { background: rgba(185,138,62,0.1); color: var(--ink); }
.nav-item.active { background: var(--brass); color: var(--white); }
.sidebar-foot { padding-top: 12px; border-top: 1px solid var(--line); margin-top: 8px; }

.piece-switcher { position: relative; }
.piece-switcher-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--white); font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 10px; }
.piece-switcher-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.piece-switcher-trigger svg.rotated { transform: rotate(180deg); }
.piece-switcher-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; padding: 6px; background: var(--white); border: 1px solid var(--line); border-radius: 8px; max-height: 240px; overflow-y: auto; }
.piece-switcher-item { text-align: left; padding: 8px 10px; border-radius: 6px; border: none; background: transparent; font-size: 13px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.piece-switcher-item:hover { background: rgba(185,138,62,0.08); }
.piece-switcher-item.active { background: var(--brass); color: var(--white); font-weight: 600; }
.piece-switcher-add { display: flex; align-items: center; gap: 6px; text-align: left; padding: 8px 10px; border-radius: 6px; border: none; background: transparent; font-size: 13px; color: var(--brass-deep); font-weight: 600; border-top: 1px solid var(--line); margin-top: 4px; padding-top: 10px; }
.piece-switcher-add:hover { background: rgba(185,138,62,0.08); }
.piece-switcher-work { display: flex; flex-direction: column; gap: 2px; }
.piece-switcher-work-name { font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-faint); font-weight: 700; padding: 8px 10px 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.piece-switcher-work .piece-switcher-item { margin-left: 8px; }
.part-switcher .part-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.part-chip { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--white); font-size: 13px; color: var(--ink-soft); font-weight: 600; }
.part-chip:hover { border-color: var(--brass); color: var(--ink); }
.part-chip.active { background: var(--brass); border-color: var(--brass); color: var(--white); }
.part-chip-idx { font-size: 11px; opacity: 0.7; }
.part-chip-pct { font-size: 11.5px; opacity: 0.8; }
.part-chip.add { color: var(--brass-deep); border-style: dashed; }

.main-content { flex: 1; padding: 32px 40px 64px; max-width: 940px; }

@media (max-width: 820px) {
  .app-shell { flex-direction: column; }
  .sidebar { width: 100%; height: auto; position: static; flex-direction: row; flex-wrap: wrap; align-items: center; padding: 10px; gap: 10px; }
  .brand { padding: 6px 10px; }
  .piece-switcher { flex: 1 1 150px; min-width: 120px; max-width: 260px; }
  .piece-switcher-trigger { margin-bottom: 0; }
  .piece-switcher-list { position: absolute; top: calc(100% + 4px); left: 0; width: max-content; min-width: 180px; max-width: 260px; margin-bottom: 0; z-index: 30; box-shadow: 0 8px 20px rgba(32,42,51,0.15); }
  .nav-list { flex-direction: row; flex: 1 1 auto; min-width: 240px; overflow-x: auto; }
  .nav-item span { display: none; }
  .sidebar-foot { display: none; }
  .main-content { padding: 20px; }
}

.empty-state { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.empty-hero-card { max-width: 620px; }
.empty-hero-content { text-align: center; padding: 12px 36px 40px; }
.empty-hero-content h1 { font-size: clamp(26px, 4vw, 36px); line-height: 1.15; margin: 10px 0 16px; }
.empty-sub { color: var(--ink-soft); font-size: 15px; line-height: 1.6; margin: 0 0 26px; }

.eyebrow { font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; color: var(--brass-deep); margin: 0 0 6px; font-weight: 600; }

.hero-card { background: var(--paper-card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.hero-doodle-band { padding: 14px 24px 0; background: linear-gradient(180deg, rgba(185,138,62,0.07), rgba(185,138,62,0)); }
.manuscript-doodle { width: 100%; height: 64px; display: block; opacity: 0.16; }
.hero-content { padding: 6px 32px 32px; }
.hero-content h1 { font-size: clamp(22px, 3vw, 30px); line-height: 1.2; }
.hero-sub { color: var(--ink-soft); font-size: 14px; margin-top: 8px; }
.hero-composer { color: var(--ink-soft); font-size: 15px; font-style: italic; margin-top: 2px; }

.manuscript-strip { display: flex; height: 46px; border-radius: 8px; margin: 20px 0 4px; border: 1px solid var(--line); position: relative; }
.manuscript-strip.compact { height: 28px; }
.manuscript-block { position: relative; border-right: 2px solid var(--paper); min-width: 3px; }
.manuscript-block:first-child { border-top-left-radius: 7px; border-bottom-left-radius: 7px; }
.recurring-dot { position: absolute; top: 5px; left: 50%; transform: translateX(-50%); width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.85); }
.final-barline { width: 4px; background: var(--ink); border-top-right-radius: 7px; border-bottom-right-radius: 7px; }
.block-tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(-6px);
  background: var(--ink);
  color: var(--paper);
  font-size: 11px;
  line-height: 1.3;
  padding: 4px 9px;
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
  z-index: 20;
}
.manuscript-block:hover .block-tooltip, .manuscript-block:focus-visible .block-tooltip { opacity: 1; }
.manuscript-block:first-child .block-tooltip { left: 0; transform: translateY(-6px); }
.manuscript-block:nth-last-child(2) .block-tooltip { left: auto; right: 0; transform: translateY(-6px); }

.tab-pane { display: flex; flex-direction: column; gap: 22px; }
.overview-top-row { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: -8px; }
.tab-header { margin-bottom: -4px; }
.tab-header h1 { font-size: 26px; }
.day-nav { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.day-nav-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.panel { background: var(--paper-card); border: 1px solid var(--line); border-radius: 14px; padding: 22px 24px; }
.panel h3 { font-size: 15px; margin-bottom: 14px; }
.panel.danger { border-color: rgba(181,71,58,0.35); }

.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
@media (max-width: 640px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
.stat-card { background: var(--paper-card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 4px; }
.stat-num { font-size: 24px; font-weight: 600; color: var(--brass-deep); }
.stat-lbl { font-size: 12px; color: var(--ink-soft); }

.bal-row { display: flex; height: 14px; border-radius: 7px; overflow: hidden; }
.bal-seg { height: 100%; }
.diff-summary { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.diff-summary-item { font-size: 13.5px; color: var(--ink-soft); display: flex; align-items: center; }
.diff-summary-item strong { color: var(--ink); margin-left: 4px; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 8px; flex-shrink: 0; }

.day-preview-list { display: flex; flex-direction: column; }
.day-preview-row { display: flex; align-items: center; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.day-preview-row:last-child { border-bottom: none; }
.day-num { width: 56px; color: var(--brass-deep); flex-shrink: 0; }
.day-desc { flex: 1; color: var(--ink-soft); }
.day-min { color: var(--ink-faint); flex-shrink: 0; }

.def-list { display: flex; flex-direction: column; gap: 10px; margin: 0 0 18px; }
.def-list > div { display: flex; justify-content: space-between; font-size: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--line); gap: 12px; }
.def-list dt { color: var(--ink-soft); }
.def-list dd { margin: 0; text-align: right; }

.piece-notes { margin: 0 0 18px; }
.piece-notes h4 { font-size: 12.5px; font-weight: 600; color: var(--ink-soft); margin: 0 0 6px; }
.piece-notes p { margin: 0; font-size: 14px; color: var(--ink); white-space: pre-wrap; line-height: 1.5; }
.edit-actions { display: flex; justify-content: flex-end; gap: 10px; padding-bottom: 20px; }

.week-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
.day-card { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: var(--white); }
.day-card.clickable { cursor: pointer; text-align: left; font: inherit; color: inherit; width: 100%; }
.day-card.clickable:hover { border-color: var(--brass); }
.day-card.consolidation { background: rgba(185,138,62,0.08); }
.day-card-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink-soft); margin-bottom: 8px; }
.day-card-min { color: var(--brass-deep); }
.day-card-note { font-size: 12.5px; color: var(--ink-soft); margin: 0; }
.day-card-group { margin-bottom: 6px; }
.day-card-tag { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); margin-bottom: 4px; }
.day-card-tag.special { color: var(--brass-deep); }
.chip { display: inline-block; font-size: 11.5px; font-family: 'IBM Plex Mono', monospace; background: var(--teal); color: var(--white); padding: 2px 7px; border-radius: 5px; margin: 0 4px 4px 0; }
.chip.subtle { background: transparent; border: 1px solid var(--line); color: var(--ink-soft); }
.chip.transition { background: var(--brass); }

.diff-grid-wrap { border: 1px solid var(--line); border-radius: 10px; padding: 10px; max-height: 300px; overflow-y: auto; background: var(--white); }
.diff-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(30px, 1fr)); gap: 4px; }
.diff-cell { aspect-ratio: 1; border: none; border-radius: 4px; font-size: 9px; font-family: 'IBM Plex Mono', monospace; color: var(--white); }
.diff-cell.diff-1 { background: var(--teal); }
.diff-cell.diff-2 { background: var(--brass); }
.diff-cell.diff-3 { background: var(--brick); }
.diff-cell:hover { filter: brightness(1.1); }

.badge { display: inline-block; font-size: 9.5px; background: rgba(255,255,255,0.25); padding: 1px 6px; border-radius: 20px; margin-left: 6px; vertical-align: middle; text-transform: uppercase; letter-spacing: 0.03em; }
.badge.dark { background: rgba(185,138,62,0.18); color: var(--brass-deep); }
.manual-mark { margin-left: 4px; vertical-align: middle; opacity: 0.6; }
.manual-conf-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.manual-conf-row input { width: 80px; flex-shrink: 0; }
.derived-stat { font-size: 13px; color: var(--ink-soft); margin: 4px 0 0; }
.derived-stat strong { color: var(--brass-deep); }

.schedule-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; background: rgba(181,71,58,0.08); border: 1px solid rgba(181,71,58,0.3); border-radius: 14px; padding: 16px 20px; }
.schedule-banner-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; margin: 0 0 4px; color: var(--brick); }
.schedule-banner-sub { font-size: 12.5px; color: var(--ink-soft); margin: 0; max-width: 480px; }

.confidence-legend { display: flex; gap: 18px; font-size: 13px; color: var(--ink-soft); flex-wrap: wrap; }
.confidence-legend span { display: flex; align-items: center; }
.map-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
.map-cell { position: relative; border: 1px solid var(--line); border-radius: 10px; padding: 12px 10px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; background: var(--white); text-align: left; }
.map-cell.tier-teal { background: rgba(46,110,99,0.14); border-color: rgba(46,110,99,0.4); }
.map-cell.tier-brass { background: rgba(185,138,62,0.14); border-color: rgba(185,138,62,0.4); }
.map-cell.tier-brick { background: rgba(181,71,58,0.14); border-color: rgba(181,71,58,0.4); }
.map-cell.selected { outline: 2px solid var(--ink); outline-offset: -1px; }
.map-cell-kind { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-faint); }
.map-cell-range { font-size: 12.5px; font-weight: 600; }
.map-cell-conf { font-size: 15px; font-weight: 600; color: var(--ink); display: flex; align-items: center; }
.map-cell-diff-dot { position: absolute; top: 10px; right: 10px; width: 8px; height: 8px; border-radius: 50%; }
.diff-dot-easy { background: var(--teal); }
.diff-dot-medium { background: var(--brass); }
.diff-dot-hard { background: var(--brick); }
.map-cell-recurring { position: absolute; bottom: 10px; right: 10px; font-size: 13px; color: var(--ink-faint); }
.map-cell-weak { position: absolute; bottom: 10px; left: 10px; color: var(--brick); display: inline-flex; }

.weak-toggle { display: inline-flex; align-items: center; gap: 7px; align-self: flex-start; border: 1px solid var(--line); background: var(--white); color: var(--ink-soft); border-radius: 9px; padding: 8px 14px; font-size: 13px; font-weight: 600; transition: border-color .15s, background .15s, color .15s; }
.weak-toggle:hover { border-color: var(--brick); }
.weak-toggle.active { border-color: var(--brick); background: rgba(181,71,58,0.1); color: var(--brick); }

.detail-panel { border-color: var(--ink); }
.detail-modal { max-width: 480px; }
.detail-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 22px; border-bottom: 1px solid var(--line); }
.detail-modal .modal-body { padding: 22px 22px 24px; }
.detail-stats { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.detail-stats > div { display: flex; justify-content: space-between; font-size: 13.5px; border-bottom: 1px solid var(--line); padding-bottom: 7px; }
.detail-stats .lbl { color: var(--ink-soft); }
.detail-stats .val { font-weight: 600; }

.checklist { display: flex; flex-direction: column; gap: 10px; }
.checklist-item { display: flex; gap: 12px; align-items: flex-start; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--white); }
.checklist-item.checked { background: rgba(46,110,99,0.08); border-color: rgba(46,110,99,0.35); }
.checklist-check { width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--teal); background: rgba(46,110,99,0.15); flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--teal); margin-top: 2px; }
.checklist-check-empty { width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--ink-faint); background: var(--white); flex-shrink: 0; margin-top: 2px; padding: 0; cursor: pointer; transition: border-color .15s, background .15s; }
.checklist-check-empty:hover:not(:disabled) { border-color: var(--teal); background: rgba(46,110,99,0.08); }
.checklist-check-empty:disabled { cursor: not-allowed; opacity: 0.6; }
.checklist-body { flex: 1; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.checklist-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.checklist-label { font-weight: 700; }
.tag { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 20px; font-weight: 600; }
.tag-new { background: var(--brass); color: var(--white); }
.tag-review { background: var(--ink-soft); color: var(--white); }
.tag-transition { background: var(--teal); color: var(--white); }
.tag-combo { background: var(--brick); color: var(--white); }
.tag-section-runthrough { background: var(--brass-deep); color: var(--white); }
.tag-section-transition { background: var(--ink); color: var(--white); }
.tag.subtle { background: transparent; border: 1px solid var(--line); color: var(--ink-soft); }
.conf-pill { margin-left: auto; font-size: 12px; color: var(--brass-deep); font-weight: 600; }
.tip-line { font-size: 12px; color: var(--ink-soft); margin: 0; }
.timer-row { display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
.timer-btn { border: 1px solid var(--line); background: var(--white); color: var(--ink-soft); border-radius: 7px; padding: 5px 12px; font-size: 12px; font-weight: 600; }
.timer-btn.running { background: var(--brick); border-color: var(--brick); color: var(--white); }
.timer-display { font-size: 13px; color: var(--ink-soft); min-width: 40px; }
.timer-manual { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-soft); font-weight: 600; }
.timer-manual input { width: 70px; border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; font-size: 13px; background: var(--white); color: var(--ink); font-family: 'IBM Plex Mono', monospace; }
.log-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.log-row label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--ink-soft); font-weight: 600; }
.log-row input { width: 90px; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font-size: 13px; background: var(--white); color: var(--ink); font-family: 'IBM Plex Mono', monospace; }
.feel-row { display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--ink-soft); font-weight: 600; margin-top: 8px; }
.primary-btn.sm { padding: 7px 14px; font-size: 12.5px; }

.view-all-list { display: flex; flex-direction: column; gap: 14px; }

.focus-panel { border-color: rgba(181,71,58,0.3); }
.focus-list { display: flex; flex-direction: column; gap: 8px; }
.focus-row { display: flex; align-items: center; gap: 10px; font-size: 13px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.focus-row:last-child { border-bottom: none; padding-bottom: 0; }
.focus-conf { margin-left: auto; font-weight: 600; color: var(--brick); }

.reassess-panel { border-color: rgba(185,138,62,0.35); }
.reassess-prompt { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.reassess-quickpicks { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }

.stat-grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
@media (max-width: 640px) { .stat-grid-2 { grid-template-columns: 1fr; } }

.progress-chart { display: flex; align-items: flex-end; gap: 6px; height: 140px; padding-top: 10px; }
.progress-chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; gap: 4px; }
.progress-chart-bars { display: flex; gap: 2px; align-items: flex-end; height: 120px; width: 100%; justify-content: center; }
.progress-chart-bar { width: 6px; border-radius: 3px 3px 0 0; }
.progress-chart-bar.planned { background: var(--ink-faint); opacity: 0.5; }
.progress-chart-bar.actual { background: var(--brass); }
.progress-chart-label { font-size: 9px; color: var(--ink-faint); }
.chart-legend { display: flex; gap: 16px; margin-top: 10px; font-size: 12px; color: var(--ink-soft); }
.chart-legend span { display: flex; align-items: center; }

.heatmap-row { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 6px; }
.heatmap-cell { flex: 0 0 20px; height: 20px; border-radius: 4px; border: 1px solid var(--line); }

.sparkline { flex-shrink: 0; }
.tempo-trend-list { display: flex; flex-direction: column; gap: 10px; }
.tempo-trend-row { display: flex; align-items: center; gap: 12px; font-size: 12.5px; }
.tempo-trend-row .mono:first-child { width: 90px; flex-shrink: 0; }
.tempo-trend-nums { width: 90px; flex-shrink: 0; text-align: right; color: var(--ink-soft); }

.history-list { display: flex; flex-direction: column; gap: 8px; }
.history-row { display: flex; gap: 14px; font-size: 13px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.history-row:last-child { border-bottom: none; padding-bottom: 0; }
.history-day { color: var(--brass-deep); width: 56px; flex-shrink: 0; }
.history-items { color: var(--ink-soft); }

.analytics-bars { display: flex; flex-direction: column; gap: 14px; }
.analytics-bar-row { display: flex; align-items: center; gap: 12px; }
.analytics-bar-label { width: 110px; flex-shrink: 0; font-size: 13px; color: var(--ink-soft); }
.analytics-bar-track { flex: 1; height: 10px; border-radius: 6px; background: var(--paper); overflow: hidden; }
.analytics-bar-fill { height: 100%; border-radius: 6px; }

.primary-btn { display: inline-flex; align-items: center; gap: 8px; background: var(--brass); color: var(--white); border: none; border-radius: 9px; padding: 10px 18px; font-size: 14px; font-weight: 600; transition: background .15s; }
.primary-btn:hover:not(:disabled) { background: var(--brass-deep); }
.primary-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.primary-btn.lg { padding: 13px 24px; font-size: 15px; }

.ghost-btn { display: inline-flex; align-items: center; gap: 7px; background: transparent; border: 1px solid var(--line); color: var(--ink); border-radius: 9px; padding: 9px 16px; font-size: 13.5px; font-weight: 500; transition: border-color .15s, background .15s; }
.ghost-btn:hover { border-color: var(--brass); background: rgba(185,138,62,0.06); }
.ghost-btn.full { width: 100%; justify-content: center; }

.danger-btn { display: inline-flex; align-items: center; gap: 7px; background: transparent; border: 1px solid var(--brick); color: var(--brick); border-radius: 9px; padding: 9px 16px; font-size: 13.5px; font-weight: 600; }
.danger-btn:hover:not(:disabled) { background: rgba(181,71,58,0.08); }
.danger-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.icon-btn { background: transparent; border: none; color: var(--ink-soft); width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; }
.icon-btn:hover:not(:disabled) { background: rgba(32,42,51,0.06); color: var(--ink); }
.icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.modal-overlay { position: fixed; inset: 0; background: rgba(32,42,51,0.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.modal { background: var(--paper-card); border-radius: 16px; width: 100%; max-width: 640px; max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--line); }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--line); }
.modal-steps { display: flex; gap: 16px; flex-wrap: wrap; }
.modal-step { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-faint); font-weight: 500; }
.modal-step.active { color: var(--brass-deep); }
.modal-step.done { color: var(--teal); }
.modal-step-dot { width: 18px; height: 18px; border-radius: 50%; border: 1px solid currentColor; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; }
.modal-body { padding: 26px 26px 10px; overflow-y: auto; flex: 1; }
.modal-foot { display: flex; justify-content: space-between; padding: 18px 26px; border-top: 1px solid var(--line); }

.wizard-pane h2 { font-size: 20px; margin-bottom: 6px; }
.wizard-hint { color: var(--ink-soft); font-size: 13.5px; margin: 0 0 20px; line-height: 1.5; }

.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.field > span { font-size: 12.5px; font-weight: 600; color: var(--ink-soft); }
.field input[type="text"], .field input[type="number"] { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 14px; background: var(--white); color: var(--ink); }
.field textarea { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 14px; background: var(--white); color: var(--ink); font-family: inherit; resize: vertical; }
.field input:disabled { color: var(--ink-faint); background: var(--paper); }
.field-row { display: flex; gap: 16px; }
.field-row .field { flex: 1; }

.segmented { display: inline-flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; flex-wrap: wrap; }
.segmented button { border: none; background: var(--white); color: var(--ink-soft); padding: 8px 14px; font-size: 13px; font-weight: 500; border-right: 1px solid var(--line); }
.segmented button:last-child { border-right: none; }
.segmented button.active { background: var(--brass); color: var(--white); }

.pairs-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.pair-row { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-soft); flex-wrap: wrap; }
.pair-row input { width: 52px; border: 1px solid var(--line); border-radius: 6px; padding: 6px; font-size: 13px; text-align: center; font-family: 'IBM Plex Mono', monospace; background: var(--white); color: var(--ink); }
.pair-row input.name-input { width: 120px; text-align: left; font-family: 'Inter', sans-serif; }
.pair-label { flex-shrink: 0; }

.recording-row { display: flex; align-items: center; gap: 6px; }
.recording-row input { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; font-size: 13px; background: var(--white); color: var(--ink); }
.recording-row input.name-input { flex: 0.8; }
.recordings-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.recording-link { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--brass-deep); background: rgba(185,138,62,0.08); border: 1px solid var(--line); border-radius: 20px; padding: 5px 12px; text-decoration: none; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recording-link:hover { background: rgba(185,138,62,0.16); }

.review-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 20px; }
.review-stat { background: var(--white); border: 1px solid var(--line); border-radius: 10px; padding: 14px; text-align: center; }
.review-stat .num { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 20px; font-weight: 600; color: var(--brass-deep); }
.review-stat .lbl { font-size: 11px; color: var(--ink-soft); }
`;
