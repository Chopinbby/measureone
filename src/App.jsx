import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BookOpen,
  LayoutGrid,
  CalendarDays,
  Music2,
  ListChecks,
  Layers,
  LineChart,
  Settings as SettingsIcon,
  Plus,
  ChevronDown,
  GripVertical,
  Pencil,
  Upload,
  Download,
  X,
  AlertTriangle,
  Piano,
  CloudDownload,
} from "lucide-react";

import { clamp, getCurrentDay, todayISODate, addDaysISO, formatMinutes, elapsedDay, formatRange, newId } from "./lib/utils";
import {
  busyPieceIds,
  keyScope,
  syncFromStorage,
  applyPiecesResult,
  applyTechniqueResult,
  settleBaselines,
  settleTechniqueBaseline,
  guardPieceWrites,
  guardTechniqueWrite,
  createTabLease,
  LEASE_KEY,
  LEASE_CHECK_MS,
  LEASE_CONFIRM_MS,
} from "./lib/tabSync";
import {
  generateAllChunks,
  migrateOrphanedProgress,
  reassociateTroubleSpots,
  canSplitChunk,
  computeSplitMeasure,
  splitPracticeChunk,
  splitPointsAfterStructureEdit,
} from "./lib/chunking";
import { getEffectiveTimeline, withLiveReviewStatus, computeRescheduleRemainder, planRescheduleForPieces, findStuckBehindPieces, estimateRescheduleFit, computeMinutesModeAutoExtend, isPlanActuallyComplete, computeReschedulePastPlanExtension, insertSplitHalfIntoMarkerChain } from "./lib/scheduling";
import { computeRevivalPlan, isInRevival } from "./lib/revival";
import { computeLadderAdvance, applyRunThroughFlag } from "./lib/ladder";
import { applyColdStartLog, applyColdStartUnlog } from "./lib/coldStart";
import { ensureWorkId, partsOfWork, groupPiecesByWork } from "./lib/works";
import { createDragAutoScroller } from "./lib/dragScroll";
import { mergeEditedPiece } from "./lib/pieceEdit";
import { PIECE_STATUS_LABEL } from "./lib/constants";
import {
  loadPiecesFromStorage,
  loadActivePieceId,
  savePieceToStorage,
  saveActivePieceIdToStorage,
  savePieceChanges,
  downloadBackup,
  parseBackupPieces,
  findMatchingPiece,
  mergeImportedPiece,
  diffImportedPiece,
  validateAndMigratePiece,
  loadLastExportedAt,
  saveLastExportedAt,
  loadOrInitFirstUseAt,
  isExportReminderDue,
  loadTechniqueFromStorage,
  saveTechniqueToStorage,
  normalizeTechniqueItem,
  readBackupTechnique,
  mergeImportedTechnique,
} from "./lib/storage";
import { resolveMethods, buildDayList, completeTask, uncompleteTask, topUpDayList, removeUnfinishedTask, changeCheckOctaves, repertoireKeysFromPieces } from "./lib/technique";

import { ManuscriptDoodle } from "./components/Manuscript";
import { RevivalEntryModal } from "./components/RevivalEntryModal";
import { DeletePieceModal } from "./components/DeletePieceModal";
import { SignInModal } from "./components/SignInModal";
import { ChoosePasswordModal } from "./components/ChoosePasswordModal";
import {
  isBackendConfigured,
  needsBackendAtStartup,
  loadBackend,
  authLink,
  isConnectionProblem,
  describeSignOutAll,
  EXPIRED_LINK_MESSAGE,
  SIGN_IN_AGAIN_NOTICE,
} from "./lib/backend";
import {
  backUpDevice,
  backupQuestion,
  describeBackupResult,
  hasRecordedBackup,
  readDeviceRecord,
  saveDeviceRecord,
  // Keeping the backup current (Pass 111)
  SYNC_QUIET_MS,
  syncSnapshot,
  syncWaitingChanges,
  reconcileLocalDeletions,
  quietDelayMs,
  retryGapMs,
  nextFailureCount,
  syncOutcome,
  describeSyncStatus,
  describeHeldBanner,
  // Merging by part (Pass 117): the quiet startup step only
  withPartsRecorded,
  // ... and the technique library's twin (Pass 118), called from Pass 120
  withTechniquePartsRecorded,
  // Noticing that another device changed something (Pass 116)
  CHECK_TICK_MS,
  createAccountChecker,
  checkOutcome,
  checkRowsUsable,
  describeAccountChanges,
  // Getting things from the account (Pass 112)
  accountRecordFor,
  fetchAccountCopy,
  countLiveAccountPieces,
  describeFetchProblem,
  describeRestoreButton,
  accountRowsToCandidates,
  restrictCandidatesToHeld,
  planAccountMerge,
  planNeedsQuestion,
  applyAccountMerge,
  withAccountCopyRecorded,
  withPieceDropped,
  markOtherCopiesDeleted,
  describeAccountMergeResult,
  // Changes from other devices arrive by themselves (Pass 120)
  classifyAccountChanges,
  autoUpdateOn,
  withAutoUpdate,
  withPieceHeld,
  autoUpdateTargets,
  needsMergeBeforeUpload,
  uploadAfterLook,
  fetchChangedAccountRows,
  mergeTechniqueFromAccount,
  reapplyOnto,
  describeAutoUpdate,
  describeRecencySettled,
  describeAutoPending,
  PIECE_UPDATED_NOTE,
  // Settling a held piece one question at a time (Pass 121)
  planSettle,
  describeSettleResult,
  describeSettleRereadProblem,
  // A piece deleted on one device is deleted everywhere, with a way back (Pass 122)
  bringBackDeletedPiece,
  fetchDeletedPieces,
  nothingWaitingHere,
  describeAutoRemoved,
  describeDeletedBanner,
  describeBringBack,
  // What the person said no to is remembered (Pass 122b)
  planDeclines,
  withDeclined,
  withDeclinedCleared,
  withDeclinedRemoved,
  declinedSummary,
  declinedCount,
  describeAskMeAgain,
} from "./lib/accountSync";
import { startSettle, settleChoose, settleBack, settleNext, settleView, keptPhrases, rereadSettleItem } from "./lib/settleFlow";
import { compareSwitcherOrder, sortPiecesForSwitcher, planSwitcherMove, makeOrderNote } from "./lib/pieceMerge";
import { stampChangedSettings, pieceWithChange } from "./lib/settingTimes";
import { stampChangedTechnique } from "./lib/techniqueMerge";
import { deletionsElsewhere, deletedForPerson, recentlyDeletedList } from "./lib/recentlyDeleted";
import { ExportPiecesModal } from "./components/ExportPiecesModal";
import { ImportPiecesModal } from "./components/ImportPiecesModal";
import { SettleConflictModal } from "./components/SettleConflictModal";
import { RecentlyDeletedModal } from "./components/RecentlyDeletedModal";
import { Wizard } from "./components/Wizard";

import { OverviewTab } from "./components/tabs/OverviewTab";
import { TimelineTab } from "./components/tabs/TimelineTab";
import { PieceMapTab } from "./components/tabs/PieceMapTab";
import { TodayTab } from "./components/tabs/TodayTab";
import { MasterAgendaTab } from "./components/tabs/MasterAgendaTab";
import { ProgressTab } from "./components/tabs/ProgressTab";
import { SettingsTab } from "./components/tabs/SettingsTab";
import { AllPiecesTab } from "./components/tabs/AllPiecesTab";
import { TechniqueTab } from "./components/tabs/TechniqueTab";

/* ------------------------------------------------------------------ */
/*  App shell                                                          */
/* ------------------------------------------------------------------ */

const NAV_BASE = [
  { key: "master-agenda", label: "Master Agenda", icon: Layers },
  // App-level, like Master Agenda — the hairline divider after it (see the
  // nav render) separates the app-wide items from the piece-scoped ones.
  { key: "technique", label: "Technique", icon: Piano },
  { key: "overview", label: "Piece Overview", icon: LayoutGrid },
  { key: "timeline", label: "Timeline", icon: CalendarDays },
  { key: "map", label: "Piece Map", icon: Music2 },
  { key: "today", label: "Daily Practice", icon: ListChecks },
  { key: "progress", label: "Progress", icon: LineChart },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

// Fields that regenerate practice-chunk IDENTITY (ids/boundaries) —
// generatePracticeChunks (lib/chunking.js) builds `id: c${start}` from a
// loop over totalMeasures stepped by chunkMode/customChunkSize, plus
// piece.chunkSplitPoints (Pass 97). chunkSplitPoints is deliberately NOT in
// this list: the Settings form never edits it (only handleSplitChunk adds
// to it), so "did this save change it" isn't a question handleSavePiece
// needs to ask — a structure edit's effect on it is handled separately, by
// splitPointsAfterStructureEdit. Nothing else feeds chunk identity. Originally this list also included measureDifficulty,
// recurringMode, recurringMeasures, and recurringPairs — mirroring
// ScheduleFields.jsx's own chunkSet-recompute dependency list — but that
// list answers a different question (which fields change total EFFORT,
// so the Schedule tab's minutesNeeded/daysToLearn estimate should
// refresh), not "which fields change chunk ids." Difficulty/recurring
// fields only feed weightedDifficultyFromArray/effortMultiplier — real
// scheduling inputs, but the chunk id a session was logged against is
// completely unaffected by them. Treating them as identity-changing was
// a real, reported bug: reassessing 2 chunks as hard/difficult cleared
// rescheduleMarker (see handleSavePiece below) exactly like a target-date
// edit did before that was fixed, so already-practiced chunks could get
// freshly re-spread and read as behind purely from the effort-weighted
// day placement shifting under them. Anything outside this list — target
// date, minutes/day, practice days/week, schedule mode, start date, AND
// difficulty/recurring — only changes pacing/effort, never which chunks
// exist. handleSavePiece uses this to tell an edit that's safe to
// preserve reschedule history across apart from one that regenerates
// chunk ids outright.
const CHUNK_STRUCTURE_FIELDS = ["totalMeasures", "chunkMode", "customChunkSize"];

// Renders nothing for an active piece — there's no badge for the default
// state, only for the two that pull a piece off the daily agenda.
function PieceStatusBadge({ status }) {
  if (!status || status === "active") return null;
  return <span className={`badge ${status}`}>{PIECE_STATUS_LABEL[status]}</span>;
}

// What the automatic upload (Pass 111) knows, for the status line and the
// "changed on another device" banner. Worked out from the device record by
// syncSnapshot; `failures` is how many attempts in a row have failed.
// `changes` (Pass 116) is what the last light read of the account says another
// device changed (classifyAccountChanges), or null.
// `deletedElsewhere` (Pass 122) is the pieces the account marks deleted that the PERSON is
// asked about ({ id, name, unsynced }): all of them with the automatic switch off, otherwise
// the ones older than 30 days and a combine's duplicates. The rest are removed by themselves.
const NO_SYNC_INFO = { firstBackupDone: false, waiting: 0, held: { pieces: [], technique: false }, backedUpAt: null, failures: 0, running: false, changes: null, deletedElsewhere: [], declined: { pieces: 0, pairs: 0 } };
const deletedKey = (list) => (list || []).map((d) => `${d.id}:${d.name}:${d.unsynced ? 1 : 0}`).join("|");
const heldKey = (held) => held.pieces.map((p) => `${p.id}:${p.name}:${p.deletedHere ? 1 : 0}`).join("|") + (held.technique ? "|T" : "");
const changesKey = (c) =>
  c ? [c.newer, c.added, c.deleted, c.held, c.needsReview].map((ids) => ids.join(",")).join("|") + (c.techniqueNewer ? "|N" : "") + (c.techniqueHeld ? "|H" : "") : "";
const sameSyncInfo = (a, b) =>
  a === b ||
  (a.firstBackupDone === b.firstBackupDone &&
    a.waiting === b.waiting &&
    a.backedUpAt === b.backedUpAt &&
    a.failures === b.failures &&
    a.running === b.running &&
    heldKey(a.held) === heldKey(b.held) &&
    changesKey(a.changes) === changesKey(b.changes) &&
    deletedKey(a.deletedElsewhere) === deletedKey(b.deletedElsewhere) &&
    a.declined.pieces === b.declined.pieces &&
    a.declined.pairs === b.declined.pairs);
// How long after startup (or signing in) before the first look at what's waiting.
const SYNC_STARTUP_DELAY_MS = 2000;
// ...and before the first light look at what other devices changed, a little
// later so an upload that's waiting goes first.
const CHECK_STARTUP_DELAY_MS = 4000;

export default function App() {
  const [pieces, setPieces] = useState({});
  // The `pieces` map as last written to storage (Pass 106) — the save effect
  // below writes only what differs from it. A ref, not state: it's
  // bookkeeping for that effect, nothing renders from it.
  const lastSavedPiecesRef = useRef({});
  const [activePieceId, setActivePieceId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Native HTML5 drag-and-drop state for reordering the piece switcher —
  // indices into pieceGroups (below), not piece ids, since a drag always
  // targets a whole row's position. draggedGroupIndex is set from the drag
  // handle's onDragStart; dragOverGroupIndex tracks whichever row is
  // currently the drop target, purely for the hover indicator, and is
  // read-but-not-required by the actual reorder (the drop handler gets its
  // own index from the row it fired on).
  const [draggedGroupIndex, setDraggedGroupIndex] = useState(null);
  const [dragOverGroupIndex, setDragOverGroupIndex] = useState(null);
  // Pass 125: the list shows about seven rows and scrolls inside that window, and not every
  // browser scrolls it by itself while a row is held near its edge. This does, so a piece can
  // be dragged to any row in one go (lib/dragScroll.js decides; it never changes what a drop does).
  const listAutoScrollRef = useRef(null);
  if (listAutoScrollRef.current === null) listAutoScrollRef.current = createDragAutoScroller();
  useEffect(() => () => listAutoScrollRef.current.stop(), []);
  const [settingsEditing, setSettingsEditing] = useState(false);
  const [editDraft, setEditDraftState] = useState(null);
  const [dayOverride, setDayOverride] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [revivalModalOpen, setRevivalModalOpen] = useState(false);
  const [wizardJoinWork, setWizardJoinWork] = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [rescheduleMessage, setRescheduleMessage] = useState("");
  const [rescheduleTitle, setRescheduleTitle] = useState("");
  // User-directed follow-up (Interleaved mode's "leave with an unresolved
  // provisional log" warning): { chunkIds, day } while TodayTab is actively
  // showing Interleaved mode with at least one unconfirmed provisional
  // session, else null. Reported by TodayTab itself (it owns viewMode and
  // the eligible-chunk list) — App.jsx only needs the result, to gate
  // navigation controls TodayTab has no say over (the sidebar, the piece
  // switcher).
  const [interleaveRisk, setInterleaveRisk] = useState(null);
  // Same idea as interleaveRisk immediately above, for a second, unrelated
  // kind of unsaved work: Revival's per-chunk assessment timer
  // (ReassessSequencePanel, rendered inside Today's Practice as of Pass 88).
  // Reported by that component itself (it owns the timer state) via
  // onAssessmentTimerRiskChange, so App.jsx can gate navigation that
  // component has no say over — see guardLeavingActiveWork below, which
  // checks both risks through one call instead of every gate point having
  // to remember both individually.
  const [assessmentTimerRisk, setAssessmentTimerRisk] = useState(false);
  // A list, not a single piece's status — the same confirmation covers both
  // the per-piece Reschedule button (one entry) and Master Agenda's
  // "Reschedule all" (one entry per behind-schedule piece). Each entry is
  // { pieceId, marker }, with the marker already fully built by whichever
  // handler opened the modal, so confirming is a plain write.
  const [rescheduleTargets, setRescheduleTargets] = useState([]);
  // Only ever set by the single-piece reschedule flow (handleReschedule)
  // when the remaining work doesn't fit the days left — null otherwise
  // (including every "Reschedule all" call, which covers multiple pieces
  // with different fits and has no single date to suggest). { targetDate,
  // daysToLearn } to extend the plan to, both derived from the same
  // requiredDays estimate handleReschedule already computes — see
  // handleConfirmRescheduleWithExtension below for how it's applied.
  const [rescheduleSuggestion, setRescheduleSuggestion] = useState(null);
  // Set by the reschedule dialog's "Set new target date" escape hatch,
  // consumed by the effect below once Settings' edit view has actually
  // rendered — a one-shot "scroll/focus the target-date field" request,
  // not persistent UI state. Cleared unconditionally on the next relevant
  // render regardless of whether activeTab actually became "settings" (see
  // that effect), since startEditing's own guardLeavingActiveWork() can
  // decline and leave activeTab unchanged — without that unconditional
  // clear, a declined guard here would leave this flag pending to
  // incorrectly fire on some later, unrelated arrival at Settings.
  const [focusTargetDateOnSettings, setFocusTargetDateOnSettings] = useState(false);
  // Pass 96 — a one-shot "scroll to and briefly highlight this DOM id once
  // Today's Practice has actually rendered" request, same
  // set-a-flag-then-scroll-in-an-effect shape as focusTargetDateOnSettings
  // just above (see that state's own comment for why the flag can't be
  // cleared synchronously in the same pass that schedules the timer).
  // Set by handleSelectDay's own optional second argument — Piece Map's
  // focus-spot links are the only caller that passes one; every existing
  // caller (Timeline, Master Agenda, Overview, Week view) is unaffected
  // and this always resets to null on THEIR navigations too, so a stale
  // target from an earlier focus-spot click can never misfire on a later,
  // unrelated day-select.
  const [scrollToOnArrival, setScrollToOnArrival] = useState(null);
  useEffect(() => {
    if (!scrollToOnArrival) return;
    if (activeTab !== "today") {
      setScrollToOnArrival(null);
      return;
    }
    const id = setTimeout(() => {
      const el = document.getElementById(scrollToOnArrival);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("arrival-highlight");
        setTimeout(() => el.classList.remove("arrival-highlight"), 1600);
      }
      setScrollToOnArrival(null);
    }, 50);
    return () => clearTimeout(id);
  }, [scrollToOnArrival, activeTab]);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [importCandidates, setImportCandidates] = useState(null);
  // The chosen backup's technique block (Pass 104), or null when it has none
  // (an older backup, a bare-array one, or exported with the row off).
  const [importTechnique, setImportTechnique] = useState(null);
  // What reading that block reported: { unreadable, skippedItems } — shown in
  // the import modal and the final message rather than skipped silently.
  const [importTechniqueInfo, setImportTechniqueInfo] = useState({ unreadable: false, skippedItems: 0 });
  // Getting things from the account (Pass 112, lib/accountSync.js). Restore,
  // "Get changes" and Review are one flow that hands the account's rows to this
  // same import modal. `importSource` says where the modal's pieces came from;
  // for the account, `importAccount` holds what the flow worked out (which row
  // each listed piece is, its kind, pieces deleted elsewhere). `accountNotice`
  // is the flow's last result as plain lines, shown in the page (never a
  // browser pop-up, which some browsers block).
  const [importSource, setImportSource] = useState("file");
  const [importAccount, setImportAccount] = useState(null);
  // Pass 121: Review asks about a piece held WITH recorded conflicts one question at a
  // time (lib/accountSync.js planSettle), not with the whole-piece picker above.
  // null, or { userId, items: [{ id, name, revision, status, questions, candidate }],
  // index, state, results: { settled: [{ name, kept }], unsettled: [{ name, reason }],
  // fallback: [{ name }] } }. `state` is the walk through the current piece's screens
  // (lib/settleFlow.js: the first screen, each question, the summary), plain data.
  // Holding it changes nothing: only the summary's button applies a piece.
  const [settleFlow, setSettleFlow] = useState(null);
  // Pass 122: the "Recently deleted" window. null (closed), or { status: "loading" | "ok" |
  // "error", items: [{ id, revision, name, deletedAt, measures, sessions }], error, busyId,
  // notice: { text, problem } | null }. Reading it changes nothing; Restore brings a piece back.
  const [recentlyDeleted, setRecentlyDeleted] = useState(null);
  const [accountFlowBusy, setAccountFlowBusy] = useState(false);
  const accountFlowBusyRef = useRef(false);
  const [accountNotice, setAccountNotice] = useState(null);
  // Changes from other devices arrive by themselves (Pass 120, lib/accountSync.js).
  // `autoUpdate` mirrors the switch in the device record (shown in the Account
  // panel); `autoNotice` is the panel's "Updated from another device: ..." line
  // ({ text } or null); `autoPending` names the pieces whose change is waiting for
  // the person to be done with them; `pieceUpdatedNote` is the id of the OPEN piece
  // an automatic update changed (the one quiet line at the top of the page).
  // `autoPendingIdsRef` is the same waiting set as ids, `autoRunningRef` stops two
  // runs overlapping, and `lateHeldRef` collects pieces an apply found changed
  // under it that must be held (saved by an effect once the state has settled).
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [autoNotice, setAutoNotice] = useState(null);
  const [autoPending, setAutoPending] = useState([]);
  const [pieceUpdatedNote, setPieceUpdatedNote] = useState(null);
  const autoPendingIdsRef = useRef(new Set());
  // Pieces an automatic update had to leave for the person (it can't tell how to
  // put the two copies together, or it may be the same piece under another name),
  // with the account revision they were left at: not fetched again until the
  // account's copy changes, instead of every minute.
  const autoLeftForYouRef = useRef(new Map());
  const autoRunningRef = useRef(false);
  const lateHeldRef = useRef(new Map());
  const [welcomeAccountCount, setWelcomeAccountCount] = useState(null);
  const accountDeletedHereRef = useRef([]);
  const [storageError, setStorageError] = useState(false);
  // Account sign-in (Pass 109). Optional: when the backend isn't configured
  // (the live site, a fresh checkout, tests) authEnabled is false and none of
  // this renders anywhere. `authSession` is just who's signed in, { email,
  // userId } or null; the library holds the real session. Signing in moves no
  // data yet (Passes 110-112), it only says who's signed in. The library
  // itself is downloaded only when needed (lib/backend.js, Design K).
  const authEnabled = isBackendConfigured();
  const [authSession, setAuthSession] = useState(null);
  const [authChecking, setAuthChecking] = useState(() => needsBackendAtStartup());
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInNotice, setSignInNotice] = useState("");
  const [choosePasswordMode, setChoosePasswordMode] = useState(null); // null | "invite" | "reset" | "change"
  // Account settings (Pass 113): signing out of every device. The question is
  // asked in the Account panel (never a browser pop-up), `signOutNotice` is the
  // last result as { text, problem } (shown in the Account panel, signed in or
  // out), and the ref stops a second press while one is running.
  const [signOutAllAsking, setSignOutAllAsking] = useState(false);
  const [signOutAllBusy, setSignOutAllBusy] = useState(false);
  const signOutAllBusyRef = useRef(false);
  const [signOutNotice, setSignOutNotice] = useState(null);
  const authListenerRef = useRef(false);
  const authLinkHandledRef = useRef(false);
  // Whether the browser itself says there is no connection (Pass 123). Only the Account
  // status line reads it: with a failed attempt behind it, the line says "Working offline"
  // instead of "isn't answering" (describeSyncStatus). Kept current by the browser's own
  // online and offline events, and only listened for on a site with an account service.
  const [browserOffline, setBrowserOffline] = useState(() => isBackendConfigured() && typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    if (!authEnabled) return;
    const update = () => setBrowserOffline(navigator.onLine === false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  // First backup to the account (Pass 110, lib/accountSync.js). Kept here, not
  // in SettingsTab, so a backup that's running, and its result, survive
  // leaving the Settings tab. `userId` is whose backup this is: a result is
  // only shown to the account that asked for it. The ref stops a second press
  // while one is running.
  const [backup, setBackup] = useState({ running: false, userId: null, result: null, finishedAt: null });
  const backupRunningRef = useRef(false);
  // True while the first-backup question is showing in the Account panel.
  const [backupAsking, setBackupAsking] = useState(false);
  // Keeping the backup current (Pass 111, lib/accountSync.js). The deciding is
  // all in the library; this file only schedules it. Everything the timers and
  // listeners need is in refs, so a callback that fires later never sees stale
  // state: `syncLatestRef` is the newest pieces/technique/account, and
  // `syncGenRef` is bumped whenever the account changes or signs out, which
  // makes a run still in flight stop at its next item.
  const [syncInfo, setSyncInfo] = useState(NO_SYNC_INFO);
  const [syncClock, setSyncClock] = useState(() => Date.now());
  const syncTimerRef = useRef(null);
  const syncRunningRef = useRef(false);
  const syncRerunRef = useRef(false);
  const syncFailuresRef = useRef(0);
  const syncNextAttemptRef = useRef(0);
  const syncPendingSinceRef = useRef(null);
  const syncGenRef = useRef(0);
  const syncLatestRef = useRef({ pieces: {}, technique: null, userId: null, loaded: false });
  const prevPiecesForSyncRef = useRef(null);
  // Noticing that another device changed something (Pass 116). The checker
  // (lib/accountSync.js) holds when the last check started, so every trigger is
  // throttled alike; `checkRowsRef` is the last light read ({ userId, rows }),
  // re-sorted against the device record by refreshSyncInfo, so the line in the
  // Account panel shrinks by itself as uploads and "Get changes" bring this
  // device up to date. Nothing here changes any data.
  const checkerRef = useRef(null);
  const checkRowsRef = useRef(null);
  const checkTimerRef = useRef(null);
  // Technique data (Pass 100) — app-level, one localStorage key of its own,
  // never part of `pieces` and never touched by setPieces/updatePiece. Its
  // write failures are tracked in their own flag so the pieces save effect
  // (which resets storageError on every run) can't clear a technique
  // failure, and vice versa; the banner shows while either is set.
  const [technique, setTechnique] = useState(null);
  const [techniqueStorageError, setTechniqueStorageError] = useState(false);
  // "Today" for the technique list only. Nothing app-wide ticks the date
  // while the app is open, so this has its own trigger (focus/visibility
  // plus a slow interval, below). Other screens' "today" is untouched.
  const [techniqueToday, setTechniqueToday] = useState(() => todayISODate());
  const [exportReminderDue, setExportReminderDue] = useState(false);
  const [exportReminderDismissed, setExportReminderDismissed] = useState(false);
  const importInputRef = useRef(null);

  // Keeping every tab of one browser in step (Pass 119, lib/tabSync.js). The
  // deciding is all in the library; this file only runs it. Everything a
  // listener or timer needs is in a ref, set during render, so a callback that
  // fires later sees the newest committed state and never a stale one.
  //   piecesRef / techniqueRef  the newest committed pieces and technique
  //   busyCtxRef                what makes a piece "in use" (isPieceBusy)
  //   lastSavedTechniqueRef     the technique library as this tab last saved or
  //                             loaded it (null until its first save, which is
  //                             the old unconditional one); the pieces' twin is
  //                             lastSavedPiecesRef above
  //   pendingBaselinesRef       promises "once this tab holds X, X is what it
  //                             last saved", settled by the save effects only
  //                             when the committed state really holds X
  //   deferredTabSyncRef        pieces in use whose change from another tab waits
  //   tabSyncTick               makes the save effects run again after a result
  //                             that changes no state (a kept copy)
  //   leaseRef / leaseStepRef   this tab's lease on the account work (below)
  const piecesRef = useRef({});
  const techniqueRef = useRef(null);
  const loadedRef = useRef(false);
  const busyCtxRef = useRef(null);
  const lastSavedTechniqueRef = useRef(null);
  const pendingBaselinesRef = useRef({ pieces: {}, technique: null });
  const deferredTabSyncRef = useRef(new Set());
  const [tabSyncTick, setTabSyncTick] = useState(0);
  const tabIdRef = useRef(null);
  if (!tabIdRef.current) tabIdRef.current = newId("tab");
  const leaseRef = useRef(null);
  const leaseStepRef = useRef(null);

  const piece = activePieceId ? pieces[activePieceId] : null;

  piecesRef.current = pieces;
  techniqueRef.current = technique;
  loadedRef.current = loaded;
  busyCtxRef.current = { activePieceId, interleaveRisk, assessmentTimerRisk, settingsEditing, editDraft };

  // Load every saved piece, then whichever one was active last.
  useEffect(() => {
    const found = loadPiecesFromStorage();
    // What's in storage now IS `found` (loadPiecesFromStorage already writes
    // back any piece whose shape it migrated), so the save effect's first run
    // after load has nothing to write.
    lastSavedPiecesRef.current = found;
    setPieces(found);
    setActivePieceId(loadActivePieceId(found));
    // The technique library's first save after a load is the old, unconditional
    // one (nothing to compare with yet), which sets this (Pass 119).
    lastSavedTechniqueRef.current = null;
    setTechnique(loadTechniqueFromStorage());
    setLoaded(true);
  }, []);

  // Persists every piece in `pieces` that changed — any piece, not just
  // the active one. Originally scoped to "only the active piece" on
  // the assumption that nothing ever mutates a piece other than the one
  // currently open; the discard-on-leave-Interleaved guard above
  // (guardLeavingInterleaved/confirmAndDiscardProvisional) broke that
  // assumption for the first time, and broke it silently: `switchToPiece`
  // discards a provisional session on the piece being LEFT and reassigns
  // `activePieceId` to the piece being entered inside the same event
  // handler, so both `setPieces` (with the discard already applied) and
  // `setActivePieceId` (the new piece) land in the same React batch — by
  // the time this effect re-ran, `activePieceId` already pointed at the
  // NEW piece, so `pieces[activePieceId]` was never the just-discarded
  // one, and that discard was computed correctly in memory but never
  // written to localStorage, silently reverting on next reload. Found via
  // manual browser testing, not by inspection — the in-memory state looked
  // right the whole time. Considering every piece here removes the assumption
  // this depended on entirely, rather than special-casing this one call
  // site (bulk reschedule, below, already had to work around the same
  // "only active" gap in its own way, for the same underlying reason: nothing
  // here was ever built to handle more than one piece's data changing in the
  // same tick). A failed write (most likely QuotaExceededError, since session
  // history only ever grows — see storage.js) used to be swallowed silently,
  // so a logged session could vanish with no sign anything went wrong.
  // Surface it instead: a banner stays up until a save actually succeeds
  // again, so recovering (e.g. after deleting an old piece to free up space)
  // clears it on its own.
  //
  // Pass 106: writes only the pieces whose object changed since the last
  // successful save, and removes the ones that are gone (deleting a piece
  // relies on this; handleDeletePiece no longer removes it itself). A failed
  // write isn't marked saved, so it's retried on the next change, and
  // storageError still means "this run had a failed write" — see
  // savePieceChanges (lib/storage.js).
  //
  // Pass 119: a write guard sits in front of that. Every tab of this browser
  // shares one localStorage but keeps its own pieces in memory, so before a
  // piece is written it is compared with what storage holds NOW against what
  // this tab last saved or loaded; if another tab wrote in between (or
  // deleted the piece), the write is held and the tab reconciles instead of
  // overwriting (guardPieceWrites, lib/tabSync.js). The "last saved" map is
  // first brought up to date with any result that has landed
  // (settleBaselines).
  useEffect(() => {
    if (!loaded) return;
    const settled = settleBaselines({ pieces, lastSavedPieces: lastSavedPiecesRef.current, pending: pendingBaselinesRef.current.pieces });
    lastSavedPiecesRef.current = settled.lastSavedPieces;
    pendingBaselinesRef.current.pieces = settled.pending;
    const busy = busyPieceIds(Object.keys(pieces), busyCtxRef.current);
    const { writable, hold } = guardPieceWrites({ pieces, lastSaved: lastSavedPiecesRef.current, busy });
    const { saved, failed } = savePieceChanges(lastSavedPiecesRef.current, writable);
    lastSavedPiecesRef.current = saved;
    setStorageError(failed.length > 0);
    if (hold.length) requestTabSync({ pieceIds: hold, technique: false });
  }, [pieces, loaded, tabSyncTick]);

  // Persist technique data, separately from pieces (see techniqueStorageError).
  // Same guard as the pieces' (Pass 119): not written over a library another
  // tab changed since this tab last saved or loaded it. A library that is
  // exactly the one last saved (a result just adopted) isn't written again.
  useEffect(() => {
    if (!loaded || !technique) return;
    const settled = settleTechniqueBaseline({ technique, lastSavedTechnique: lastSavedTechniqueRef.current, pending: pendingBaselinesRef.current.technique });
    lastSavedTechniqueRef.current = settled.lastSavedTechnique;
    pendingBaselinesRef.current.technique = settled.pending;
    if (lastSavedTechniqueRef.current === technique) return;
    if (guardTechniqueWrite({ technique, lastSaved: lastSavedTechniqueRef.current }).hold) {
      requestTabSync({ pieceIds: [], technique: true });
      return;
    }
    const saved = saveTechniqueToStorage(technique);
    if (saved.ok) lastSavedTechniqueRef.current = technique;
    setTechniqueStorageError(!saved.ok);
  }, [technique, loaded, tabSyncTick]);

  /* ---------------------------------------------------------------- */
  /*  Several tabs of one browser (Pass 119).                          */
  /*  runTabSync reads what storage holds, asks lib/tabSync.js what    */
  /*  this tab should do about it, and applies the answer through the  */
  /*  usual setters. It is the ONE place that happens, whoever asks:   */
  /*  another tab's `storage` event, the write guard above holding a   */
  /*  write back, a piece that was in use becoming idle, or this tab   */
  /*  taking the lease (a full catch-up). It never writes: the save    */
  /*  effects do, after the result has landed, and a result that is    */
  /*  adopted as-is is not written back.                               */
  /* ---------------------------------------------------------------- */

  const runTabSync = (scope = { pieceIds: null, technique: true }) => {
    if (!loadedRef.current) return;
    const memory = { pieces: piecesRef.current, technique: techniqueRef.current };
    const lastSaved = { pieces: lastSavedPiecesRef.current, technique: lastSavedTechniqueRef.current };
    const busy = busyPieceIds(Object.keys(memory.pieces), busyCtxRef.current);
    const out = syncFromStorage({ memory, lastSaved, busy, pieceIds: scope.pieceIds, technique: scope.technique !== false });
    // A piece in use waits; remember it until it is idle (an effect below).
    const deferred = deferredTabSyncRef.current;
    if (scope.pieceIds) scope.pieceIds.forEach((id) => deferred.delete(id));
    else deferred.clear();
    out.deferred.forEach((id) => deferred.add(id));
    if (out.conflicts.length) console.warn("[tab sync] Couldn't put some changes together cleanly; this tab's copy was kept.", out.conflicts);
    if (!out.changed) return;
    const pending = pendingBaselinesRef.current;
    pendingBaselinesRef.current = { pieces: { ...pending.pieces, ...out.baselines.pieces }, technique: out.baselines.technique || pending.technique };
    setPieces((prev) => applyPiecesResult(prev, memory.pieces, out.result));
    setTechnique((prev) => applyTechniqueResult(prev, memory.technique, out.result));
    // A piece the other tab deleted takes its screens with it; one that arrives
    // on an empty welcome screen becomes the open piece.
    const openId = busyCtxRef.current && busyCtxRef.current.activePieceId;
    if (openId && out.removedIds.includes(openId)) {
      const remaining = Object.keys({ ...memory.pieces }).filter((id) => !out.removedIds.includes(id));
      setActivePieceId(remaining[0] || out.addedIds[0] || null);
      setActiveTab("overview");
      setDayOverride(null);
      setSwitcherOpen(false);
      setDeleteModalOpen(false);
    } else if (!openId && out.addedIds.length) {
      setActivePieceId(out.addedIds[0]);
    }
    setTabSyncTick((n) => n + 1);
  };

  // Asked from inside an effect, so it runs a moment later, outside React's own
  // commit work.
  const requestTabSync = (scope) => {
    setTimeout(() => runTabSync(scope), 0);
  };

  // The two places that write a piece straight to storage before its state is
  // set (importing a backup, and the bulk reschedule's other pieces) pass the
  // same check as the save effect. If another tab changed the piece, nothing is
  // written here and { ok: true } is returned: the caller's state update goes
  // ahead and the save effect reconciles first (merging by part) instead of
  // overwriting. A write that did land is recorded as saved, so the save effect
  // doesn't write the same piece again.
  const writePieceDirect = (id, piece) => {
    const last = lastSavedPiecesRef.current;
    const g = guardPieceWrites({ pieces: { [id]: piece }, lastSaved: Object.prototype.hasOwnProperty.call(last, id) ? { [id]: last[id] } : {} });
    if (g.hold.length) return { ok: true, held: true };
    const result = savePieceToStorage(id, piece);
    if (result.ok) lastSavedPiecesRef.current = { ...last, [id]: piece };
    return result;
  };

  // Another tab wrote to storage.
  useEffect(() => {
    const onStorage = (e) => {
      try {
        if (e.storageArea && e.storageArea !== window.localStorage) return;
      } catch (err) {
        return;
      }
      if (e.key === LEASE_KEY) {
        if (leaseStepRef.current) leaseStepRef.current();
        return;
      }
      const scope = keyScope(e.key);
      if (scope) runTabSync(scope);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // A piece that was in use is idle now (an Interleaved attempt confirmed or
  // discarded, a reassessment timer stopped, the settings draft saved or
  // discarded): bring in what waited for it.
  useEffect(() => {
    if (!loaded || deferredTabSyncRef.current.size === 0) return;
    const idle = [...deferredTabSyncRef.current].filter((id) => busyPieceIds([id], busyCtxRef.current).length === 0);
    if (idle.length) requestTabSync({ pieceIds: idle, technique: false });
  }, [loaded, activePieceId, interleaveRisk, assessmentTimerRisk, settingsEditing, editDraft ? editDraft.id : null]);

  /* ---------------------------------------------------------------- */
  /*  Keeping the backup current (Pass 111).                           */
  /*  Everything here only SCHEDULES lib/accountSync.js: what's        */
  /*  waiting, how it's uploaded, what a refusal means and the wording */
  /*  are all decided there, and tested. Nothing here runs, and the    */
  /*  account library isn't loaded, unless this device is signed in    */
  /*  AND its first backup has been checked (Pass 110).                */
  /* ---------------------------------------------------------------- */

  // What's waiting, from the device record as it is now, published for the
  // status line and the banner. No network. Returns the snapshot, or null when
  // signed out.
  const refreshSyncInfo = () => {
    const { pieces: latestPieces, technique: latestTechnique, userId } = syncLatestRef.current;
    if (!authEnabled || !userId) {
      setSyncInfo((prev) => (prev === NO_SYNC_INFO ? prev : NO_SYNC_INFO));
      setAutoUpdate(false);
      return null;
    }
    // The switch lives in the device record (another tab may have changed it).
    const deviceRecord = readDeviceRecord();
    const autoOn = autoUpdateOn(deviceRecord, userId);
    setAutoUpdate(autoOn);
    const lastRead = checkRowsRef.current;
    const snap = syncSnapshot({
      pieces: latestPieces,
      technique: latestTechnique,
      userId,
      accountRows: lastRead && lastRead.userId === userId ? lastRead.rows : null,
    });
    // Pass 122: the pieces the account marks deleted that the person is asked about.
    let deletedElsewhere = [];
    if (lastRead && lastRead.userId === userId && snap.firstBackupDone) {
      const acct = accountRecordFor(deviceRecord, userId);
      const deletions = deletionsElsewhere({ rows: lastRead.rows, entries: acct.pieces, localPieceIds: Object.keys(latestPieces), now: Date.now() });
      const rowRevision = Object.fromEntries(((lastRead.rows && lastRead.rows.pieces) || []).map((r) => [r.id, r.revision]));
      const leftIds = deletions.ids.filter((id) => autoLeftForYouRef.current.get(id) === rowRevision[id]);
      deletedElsewhere = deletedForPerson({ deletions, autoOn, leftIds }).map((id) => ({
        id,
        name: (latestPieces[id] && latestPieces[id].name) || "Untitled piece",
        unsynced: !nothingWaitingHere(latestPieces[id], acct.pieces[id]),
      }));
    }
    // Pass 122b: how many "no" answers this device remembers (the button that takes them back)
    const declined = declinedSummary(accountRecordFor(deviceRecord, userId));
    const next = { ...snap, deletedElsewhere, declined, failures: syncFailuresRef.current, running: syncRunningRef.current };
    setSyncInfo((prev) => (sameSyncInfo(prev, next) ? prev : next));
    return snap;
  };

  // Only one tab of this browser does the account work (Pass 119): the automatic
  // upload and the look at what other devices changed. `holdsNow` looks at the
  // lease again each time instead of trusting a flag, because a tab that was
  // asleep may have lost it since its last look. Buttons the person presses
  // (Back up this device, Get changes) work in any tab: they asked for them.
  const holdsLease = () => !!leaseRef.current && leaseRef.current.holdsNow();

  const scheduleSync = (delayMs) => {
    if (!authEnabled) return;
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      runSync();
    }, Math.max(0, delayMs));
  };

  /* ---------------------------------------------------------------- */
  /*  Noticing that another device changed something (Pass 116).       */
  /*  A light read (ids, revisions, deleted marks; never a piece's     */
  /*  data) that NOTICES. With "Update automatically from other        */
  /*  devices" OFF (the default) it applies nothing, and "Get changes" */
  /*  works exactly as before; ON, what it finds is brought in by      */
  /*  runAutoUpdate (Pass 120, below). It runs only while signed in    */
  /*  and only once this device's first backup is checked; never while */
  /*  the page is hidden, and never while an upload, a manual backup   */
  /*  or "Get changes" is running. Triggers: startup (once sign-in is  */
  /*  known), the window regaining focus or the page becoming visible  */
  /*  (at most once a minute), the browser coming back online, and     */
  /*  every minute while the page is visible (Pass 120; it was five).  */
  /*  A failed check counts toward the same "isn't answering" count    */
  /*  the uploads use and shows no error of its own. When it runs and  */
  /*  what it means are decided in lib/accountSync.js, and tested.     */
  /* ---------------------------------------------------------------- */

  const scheduleCheck = (delayMs, trigger) => {
    if (!authEnabled) return;
    clearTimeout(checkTimerRef.current);
    checkTimerRef.current = setTimeout(() => {
      checkTimerRef.current = null;
      requestCheck(trigger);
    }, Math.max(0, delayMs));
  };

  // Says what came of the look: { fresh, applied, why }. `fresh`: it was taken and
  // believed, so checkRowsRef now holds the account as it is. `applied`: it also brought
  // something in. `why`, when it wasn't fresh, is for runSync (uploadAfterLook, lib/accountSync.js).
  // `beforeUpload` is runSync's own look: it is needed even while the page is in the
  // background (the upload goes out anyway), and it is not put off with a timer of its own
  // when something is busy (runSync waits and asks again).
  const requestCheck = async (trigger, { beforeUpload = false } = {}) => {
    const skipped = (why) => ({ fresh: false, applied: false, why });
    const { userId, loaded: isLoaded } = syncLatestRef.current;
    if (!authEnabled || !userId || !isLoaded) return skipped("not-ready");
    if (!beforeUpload && typeof document !== "undefined" && document.visibilityState !== "visible") return skipped("hidden");
    if (!holdsLease()) return skipped("no-lease"); // another tab does the looking (Pass 119)
    if (!hasRecordedBackup(readDeviceRecord(), userId)) return skipped("no-backup");
    const isBusy = () => backupRunningRef.current || accountFlowBusyRef.current || syncRunningRef.current;
    if (isBusy()) {
      if (!beforeUpload) scheduleCheck(2000, trigger); // look again once it's finished
      return skipped("busy");
    }
    if (!checkerRef.current) checkerRef.current = createAccountChecker();
    const generation = syncGenRef.current;
    const recordBefore = accountRecordFor(readDeviceRecord(), userId);
    const out = await checkerRef.current.run({ trigger, userId, visible: true });
    if (!out.ran) return skipped(out.why); // "running": another look (say the "online" one) is in flight
    if (syncGenRef.current !== generation) return skipped("cancelled"); // signed out, or another account, meanwhile
    syncFailuresRef.current = nextFailureCount(syncFailuresRef.current, checkOutcome(out));
    // Rows read while an upload, a backup or "Get changes" was changing the
    // record could already include this device's own upload without the
    // record knowing yet, which would read as "newer": don't believe them.
    let usable = false;
    if (out.result.status === "ok" && checkRowsUsable({ recordBefore, recordNow: accountRecordFor(readDeviceRecord(), userId), busy: isBusy() })) {
      checkRowsRef.current = { userId, rows: out.result.rows };
      usable = true;
    }
    refreshSyncInfo();
    // Pass 120: with the switch on, what the check found is brought in now.
    const updated = usable ? await runAutoUpdate("check") : null;
    const why = usable ? null : out.result.status !== "ok" ? (out.result.reason === "signed-out" ? "cancelled" : "failed") : "unusable";
    return { fresh: usable, applied: !!(updated && updated.applied), why };
  };

  // One upload run: send what's waiting (the library does it, one item at a
  // time, each "only if still at revision N"), then decide what happens next.
  // A refusal is not a failure (that piece is held and left alone); no
  // connection, a server that isn't answering, or something the database
  // objected to is, and waits for the next retry gap (30 seconds, 2 minutes,
  // then every 10 minutes) or the browser's online event.
  const runSync = async () => {
    const { pieces: latestPieces, technique: latestTechnique, userId, loaded: isLoaded } = syncLatestRef.current;
    if (!authEnabled || !userId || !isLoaded || !latestTechnique) return;
    if (!holdsLease()) return; // another tab does the uploading (Pass 119); taking the lease starts it again
    if (backupRunningRef.current || accountFlowBusyRef.current) {
      // a manual backup, or the account being read or merged (Pass 112), is
      // running: don't overlap it
      scheduleSync(2000);
      return;
    }
    if (syncRunningRef.current) {
      syncRerunRef.current = true; // go again when this one ends
      return;
    }
    // Pass 120: MERGE BEFORE UPLOAD. With "Update automatically from other
    // devices" on, a piece that has a change waiting here and a newer copy in the
    // account (as the last check saw it) would be refused and held. So the
    // account's copy is brought in first (the parts merged, or the piece held if a
    // part conflicts) and the merged result goes up in the next round, after the
    // usual quiet period. A piece that can't be merged yet (it is in use, or the
    // account couldn't be read) is left out of this run, not sent to be refused.
    // A refusal is still judged and held, as the last safety net.
    let skipPieceIds = [];
    let skipTechnique = false;
    // "The latest check" has to be CURRENT: another device may have uploaded in the
    // seconds since the last one, and an upload made without knowing would be
    // refused and held. So, with the switch on, one light look at the account comes
    // first (never the data: ids, revisions, deleted dates, about 3 KB). If it
    // brought something in, this run stops and the merged result goes up in the
    // next one, after the usual quiet period.
    // Pass 126 follow-up: NO FRESH LOOK, NO UPLOAD. The look used to be skipped without a
    // word when the page was in the background, or when another look was already running
    // (the browser's "online" event starts one at the same moment it starts this run), and
    // the run then went on from an old picture of the account, was refused, and held a piece
    // that would have merged. Now a look that didn't happen or wasn't believed makes the run
    // wait and look again (uploadAfterLook decides, and is tested); the refusal below stays
    // as the last safety net, for the seconds between the look and the upload.
    if (autoUpdateOn(readDeviceRecord(), userId)) {
      const looked = await requestCheck("startup", { beforeUpload: true });
      const next = uploadAfterLook(looked);
      if (next.action === "stop") return;
      if (next.action === "wait") {
        const gap = next.afterFailure ? retryGapMs(syncFailuresRef.current) : next.afterMs;
        if (next.afterFailure) syncNextAttemptRef.current = Date.now() + gap;
        scheduleSync(gap);
        return;
      }
    }
    const mergeRecord = readDeviceRecord();
    const lastRead = checkRowsRef.current;
    if (lastRead && lastRead.userId === userId && autoUpdateOn(mergeRecord, userId)) {
      const accountRecord = accountRecordFor(mergeRecord, userId);
      const changes = classifyAccountChanges({ rows: lastRead.rows, accountRecord, localPieceIds: Object.keys(latestPieces) });
      const first = needsMergeBeforeUpload({ pieces: latestPieces, technique: latestTechnique, accountRecord, changes });
      if (first.pieceIds.length > 0 || first.technique) {
        // Pieces already known to be waiting for the person are not asked about again.
        const unresolved = first.pieceIds.filter((id) => !autoPendingIdsRef.current.has(id));
        if (unresolved.length > 0 || first.technique) {
          const done = await runAutoUpdate("before-upload");
          if (done && done.applied) return;
        }
        skipPieceIds = first.pieceIds;
        skipTechnique = first.technique;
      }
    }
    const snap = syncSnapshot({ pieces: latestPieces, technique: latestTechnique, userId });
    if (!snap.firstBackupDone || snap.waiting === 0) {
      syncPendingSinceRef.current = null;
      refreshSyncInfo();
      return;
    }
    const generation = syncGenRef.current;
    syncRunningRef.current = true;
    refreshSyncInfo();
    let result;
    try {
      result = await syncWaitingChanges({
        pieces: latestPieces,
        technique: latestTechnique,
        userId,
        isCancelled: () => syncGenRef.current !== generation || !holdsLease(),
        skipPieceIds,
        skipTechnique,
      });
    } catch (e) {
      // syncWaitingChanges reports its own failures; this is only a last resort.
      result = { status: "stopped", reason: "other" };
    }
    syncRunningRef.current = false;
    if (syncGenRef.current !== generation) {
      // signed out, or into another account, while it ran
      refreshSyncInfo();
      if (syncLatestRef.current.userId) scheduleSync(SYNC_STARTUP_DELAY_MS);
      return;
    }
    const outcome = syncOutcome(result);
    syncFailuresRef.current = nextFailureCount(syncFailuresRef.current, outcome);
    if (outcome === "failure") {
      const gap = retryGapMs(syncFailuresRef.current);
      syncNextAttemptRef.current = Date.now() + gap;
      scheduleSync(gap);
    } else {
      syncNextAttemptRef.current = 0;
      if (syncRerunRef.current) {
        syncRerunRef.current = false;
        scheduleSync(SYNC_QUIET_MS);
      }
    }
    const after = refreshSyncInfo();
    syncPendingSinceRef.current = after && after.waiting > 0 ? Date.now() : null;
  };

  // Deleting a piece is noticed here, not inferred later. A piece this
  // session saw leave `pieces` is marked "deleted here" in the device record
  // (so the deletion survives a reload and goes up once signed in), and a stale
  // mark on a piece that exists again is cleared. A piece that's merely
  // missing from `pieces` (a failed load, say) is NOT a deletion: treating it
  // as one would mark the account's copy of everything deleted.
  const noteLocalDeletions = (current) => {
    const previous = prevPiecesForSyncRef.current;
    prevPiecesForSyncRef.current = current;
    const removedIds = previous ? Object.keys(previous).filter((id) => !Object.prototype.hasOwnProperty.call(current, id)) : [];
    const { record, changed } = reconcileLocalDeletions(readDeviceRecord(), { removedIds, presentIds: Object.keys(current) });
    if (changed) saveDeviceRecord(record);
  };

  // THE HOOK AFTER BOTH SAVE EFFECTS above (so what it looks at is already
  // saved on this device): after every change to pieces or technique, work
  // out what's waiting and (re)start the quiet-period timer. A run waits a few
  // seconds after the last change, so logging several things in a row is one
  // upload, and never more than a minute after the first of them. After a
  // failure it waits for the retry gap instead, so saving more can't hammer a
  // service that isn't answering.
  useEffect(() => {
    if (!loaded) return;
    syncLatestRef.current = { pieces, technique, userId: authSession ? authSession.userId : null, loaded: true };
    if (!authEnabled) return;
    noteLocalDeletions(pieces);
    if (!authSession) return;
    const snap = refreshSyncInfo();
    if (snap && snap.firstBackupDone && snap.waiting > 0) {
      const now = Date.now();
      if (syncPendingSinceRef.current == null) syncPendingSinceRef.current = now;
      scheduleSync(Math.max(quietDelayMs(now, syncPendingSinceRef.current), syncNextAttemptRef.current - now));
    }
  }, [pieces, technique, loaded]);

  // Merging by part (Pass 117): pieces recorded before `parts` existed get them
  // here, once at startup, quietly (no network, no piece changes). A piece whose
  // fingerprint still equals its record's hasn't changed since it was last
  // synced, so this device's copy IS the synced state and its parts are
  // recorded from it. A piece with changes waiting is left alone: it gets parts
  // at its next confirmed upload, and until then a merge would ask rather than
  // merge by part. Nothing uses the parts yet (the merge engine,
  // lib/pieceMerge.js, isn't wired into the app).
  useEffect(() => {
    if (!authEnabled || !loaded) return;
    const withPieces = withPartsRecorded(readDeviceRecord(), pieces);
    // Pass 120: the technique library's parts too (Pass 118 built the step and left
    // the call for this pass), so an automatic update has a base to merge from.
    const withBoth = technique ? withTechniquePartsRecorded(withPieces.record, technique) : { record: withPieces.record, recorded: 0 };
    if (withPieces.recorded > 0 || withBoth.recorded > 0) saveDeviceRecord(withBoth.record);
  }, [loaded]);

  // Signing in, or the app starting with a saved sign-in: work out what's
  // waiting and look at it soon. Signing out, or another account: stop (a run
  // still going stops at its next item), forget this session's retry state and
  // clear the status. The device record is left alone, so signing back in as
  // the same account simply compares and finds what's waiting; a different
  // account has no record here and starts at Pass 110's question.
  useEffect(() => {
    syncLatestRef.current = { ...syncLatestRef.current, userId: authSession ? authSession.userId : null };
    syncGenRef.current += 1;
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = null;
    syncRerunRef.current = false;
    syncFailuresRef.current = 0;
    syncNextAttemptRef.current = 0;
    syncPendingSinceRef.current = null;
    // The last light read belongs to the last account: forget it (Pass 116).
    if (checkerRef.current) checkerRef.current.reset();
    checkRowsRef.current = null;
    clearTimeout(checkTimerRef.current);
    checkTimerRef.current = null;
    if (!authEnabled || !authSession) {
      setSyncInfo((prev) => (prev === NO_SYNC_INFO ? prev : NO_SYNC_INFO));
      return;
    }
    if (!loaded) return;
    const snap = refreshSyncInfo();
    if (snap && snap.firstBackupDone && snap.waiting > 0) scheduleSync(SYNC_STARTUP_DELAY_MS);
    if (snap && snap.firstBackupDone) scheduleCheck(CHECK_STARTUP_DELAY_MS, "startup");
  }, [loaded, authSession ? authSession.userId : null]);

  // The connection coming back is an immediate retry (and forgets the
  // backoff). The window regaining focus works out what's waiting again and
  // tries if the retry gap is over: a timer that was throttled while the window
  // sat in the background may not have fired.
  useEffect(() => {
    if (!authEnabled) return;
    const onOnline = () => {
      if (!syncLatestRef.current.userId) return;
      syncFailuresRef.current = 0;
      syncNextAttemptRef.current = 0;
      const snap = refreshSyncInfo();
      if (snap && snap.firstBackupDone && snap.waiting > 0) scheduleSync(0);
      requestCheck("online");
    };
    const onFocus = () => {
      if (!syncLatestRef.current.userId) return;
      setSyncClock(Date.now());
      const snap = refreshSyncInfo();
      if (snap && snap.firstBackupDone && snap.waiting > 0 && !syncRunningRef.current && Date.now() >= syncNextAttemptRef.current) {
        scheduleSync(1000);
      }
      requestCheck("focus");
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(syncTimerRef.current);
    };
  }, []);

  // Every minute while the page is visible (Pass 116, shortened from five in
  // Pass 120): the page asks every CHECK_TICK_MS (15 seconds) whether a check
  // is due, which costs no request; the checker only lets one through when a
  // minute has passed since the last. Asking more often than the interval is
  // what keeps timer drift from spacing checks one to two minutes apart.
  useEffect(() => {
    if (!authEnabled) return;
    const id = setInterval(() => requestCheck("interval"), CHECK_TICK_MS);
    return () => {
      clearInterval(id);
      clearTimeout(checkTimerRef.current);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  One tab does the account work (Pass 119).                        */
  /*  A lease in localStorage (lib/tabSync.js, createTabLease): the    */
  /*  holder renews it every 10 seconds, another tab takes it over     */
  /*  once it has gone 30 seconds without one, and a closing tab hands */
  /*  it on at once. A tab without it does not upload and does not     */
  /*  look at what other devices changed (runSync and requestCheck     */
  /*  above), but it still hears what the holder saves, through the    */
  /*  storage listener. Taking the lease first catches up with storage */
  /*  (this tab may have missed events), then starts the work again.   */
  /*  Only while signed in: with no account service, or signed out,    */
  /*  there is no account work to share.                               */
  /* ---------------------------------------------------------------- */

  const onLeaseGained = () => {
    runTabSync({ pieceIds: null, technique: true });
    const snap = refreshSyncInfo();
    if (snap && snap.firstBackupDone && snap.waiting > 0) scheduleSync(SYNC_STARTUP_DELAY_MS);
    if (snap && snap.firstBackupDone) scheduleCheck(CHECK_STARTUP_DELAY_MS, "startup");
  };

  // Stop what this tab had going: a run in flight stops at its next item.
  const onLeaseLost = () => {
    syncGenRef.current += 1;
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = null;
    clearTimeout(checkTimerRef.current);
    checkTimerRef.current = null;
    syncRerunRef.current = false;
  };

  useEffect(() => {
    if (!authEnabled || !authSession) return;
    // Merely reading window.localStorage can throw (some browsers' private modes):
    // then no tab holds a lease and none does account work, which is the safe side.
    let storage = null;
    try {
      storage = window.localStorage;
    } catch (e) {
      storage = null;
    }
    if (!storage) return;
    const lease = createTabLease({ storage, tabId: tabIdRef.current });
    leaseRef.current = lease;
    let wasHolder = false;
    let confirmTimer = null;
    const apply = (state) => {
      if (state.holder && !wasHolder) {
        wasHolder = true;
        onLeaseGained();
      } else if (!state.holder && wasHolder) {
        wasHolder = false;
        onLeaseLost();
      }
      if (state.claiming) {
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => apply(lease.confirm()), LEASE_CONFIRM_MS);
      }
    };
    const step = () => apply(lease.check());
    leaseStepRef.current = step;
    step();
    const timer = setInterval(step, LEASE_CHECK_MS);
    const release = () => {
      clearTimeout(confirmTimer);
      lease.release();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") step();
    };
    window.addEventListener("pagehide", release);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      clearTimeout(confirmTimer);
      window.removeEventListener("pagehide", release);
      document.removeEventListener("visibilitychange", onVisible);
      lease.release();
      if (leaseRef.current === lease) leaseRef.current = null;
      if (leaseStepRef.current === step) leaseStepRef.current = null;
    };
  }, [authEnabled, authSession ? authSession.userId : null]);

  // The status line says "Backed up 3 minutes ago", so while the Settings page
  // is showing and someone is signed in, re-read the clock every half minute.
  useEffect(() => {
    if (!authSession || activeTab !== "settings") return;
    setSyncClock(Date.now());
    const id = setInterval(() => setSyncClock(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, [authSession ? authSession.userId : null, activeTab]);

  // The welcome screen's "Restore 12 pieces from your account" button: when
  // someone is signed in on a device with no piece open, count the pieces the
  // account holds (ids only, no piece data). No button when it holds none, or
  // can't be reached.
  useEffect(() => {
    if (!authEnabled || !authSession || !loaded || piece) {
      setWelcomeAccountCount(null);
      return;
    }
    let cancelled = false;
    countLiveAccountPieces({ userId: authSession.userId }).then((r) => {
      if (!cancelled) setWelcomeAccountCount(r.status === "ok" ? r.count : null);
    });
    return () => {
      cancelled = true;
    };
  }, [authSession ? authSession.userId : null, loaded, !!piece]);

  // Re-read the date when the window regains focus or becomes visible, and
  // once a minute — setting the same date string is a no-op re-render-wise,
  // so this only does anything when the day actually changed.
  useEffect(() => {
    const check = () => setTechniqueToday(todayISODate());
    const onVisibility = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(check, 60 * 1000);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, []);

  // Ensure today's technique list exists. buildDayList rolls the previous
  // list's unfinished tasks forward (same methods) and returns an existing
  // list for today unchanged, so this is stable across reloads and screens.
  useEffect(() => {
    if (!loaded || !technique) return;
    if (technique.dayList?.date === techniqueToday) return;
    updateTechnique((t) => ({
      ...t,
      dayList: buildDayList(techniqueEngineState(t), techniqueToday, t.settings.scalesPerDay),
    }));
  }, [loaded, technique, techniqueToday]);

  // Persist which piece is active.
  useEffect(() => {
    if (!loaded) return;
    saveActivePieceIdToStorage(activePieceId);
  }, [activePieceId, loaded]);

  // Account sign-in (Pass 109). Starts listening for sign-in changes, once,
  // which is what downloads the library (see lib/backend.js). Runs at startup
  // only when the library is needed then (a session saved on this device, or
  // an invite or reset link in the address), and when someone opens sign-in.
  const attachAuthListener = () => {
    if (!authEnabled || authListenerRef.current) return;
    authListenerRef.current = true;
    loadBackend().then((client) => {
      if (!client) {
        authListenerRef.current = false;
        setAuthChecking(false);
        return;
      }
      client.auth.onAuthStateChange((event, session) => {
        setAuthChecking(false);
        setAuthSession(session && session.user ? { email: session.user.email || "", userId: session.user.id } : null);
        // Arriving from an invite or reset link: the link has signed the person
        // in, so ask them to choose a password (once). The library announces a
        // reset by name but an invite only as a plain sign-in, so the link's
        // type comes from the address (authLink), read before the library ran.
        if (!authLinkHandledRef.current) {
          if (event === "PASSWORD_RECOVERY") {
            authLinkHandledRef.current = true;
            setChoosePasswordMode("reset");
          } else if (session && authLink && authLink.type === "invite") {
            authLinkHandledRef.current = true;
            setChoosePasswordMode("invite");
          } else if (session && authLink && authLink.type === "recovery") {
            authLinkHandledRef.current = true;
            setChoosePasswordMode("reset");
          }
        }
      });
    });
  };

  useEffect(() => {
    if (!authEnabled) return;
    // An expired or already-used link: say so, in the sign-in window, where a
    // fresh reset link can be asked for.
    if (authLink && authLink.error) {
      setSignInNotice(EXPIRED_LINK_MESSAGE);
      setSignInOpen(true);
    }
    if (needsBackendAtStartup()) attachAuthListener();
    else setAuthChecking(false);
  }, []);

  const openSignIn = () => {
    if (!authEnabled) return;
    setSignInNotice("");
    setSignInOpen(true);
    attachAuthListener();
  };

  // Signs out this device only ("local"): the library's default would sign the
  // account out of every device it's on. Leaves this device's pieces and
  // technique data exactly as they are.
  const handleSignOut = async () => {
    const client = await loadBackend();
    if (!client) return;
    const { error } = await client.auth.signOut({ scope: "local" });
    // With no connection the library still removes the session from this device
    // (and announces the sign-out) before reporting that the service couldn't be
    // told, so a connection problem here is not a failed sign-out: this device
    // is signed out, and the service's own copy of the session simply expires.
    // Only some other kind of failure is worth an alert.
    if (error && !isConnectionProblem(error)) window.alert("Couldn't sign out. Try again in a moment.");
  };

  // Account settings (Pass 113). "Change password" opens the same window an
  // invitation or reset link does, in its "change" mode. If the service asks
  // for a recent sign-in first, that window offers "Sign in again", which
  // closes it and opens the sign-in window with a note; the person then
  // chooses Change password once more.
  const openChangePassword = () => {
    if (!authEnabled || !authSession) return;
    setChoosePasswordMode("change");
  };
  const handleSignInAgainToChangePassword = () => {
    setChoosePasswordMode(null);
    setSignInNotice(SIGN_IN_AGAIN_NOTICE);
    setSignInOpen(true);
  };

  // "Sign out of all devices": the library's global scope ends every session
  // the account has, this device's included. Like the ordinary sign-out it
  // leaves this device's pieces, technique data and device record exactly as
  // they are. Unlike it, a failed connection matters here: the library still
  // signs this device out, but the other devices were not told, so the result
  // (describeSignOutAll) says what actually happened, read back from the
  // library rather than assumed. Shown in the Account panel, never as a pop-up.
  const handleSignOutAll = async () => {
    setSignOutAllAsking(false);
    if (!authEnabled || !authSession || signOutAllBusyRef.current) return;
    signOutAllBusyRef.current = true;
    setSignOutAllBusy(true);
    setSignOutNotice(null);
    let error = null;
    let signedOutHere = false;
    try {
      const client = await loadBackend();
      if (!client) {
        error = { name: "AuthRetryableFetchError" };
      } else {
        try {
          const result = await client.auth.signOut({ scope: "global" });
          error = result.error || null;
        } catch (e) {
          error = e || { name: "Error" };
        }
        try {
          const { data } = await client.auth.getSession();
          signedOutHere = !(data && data.session);
        } catch (e) {
          signedOutHere = false;
        }
      }
    } finally {
      signOutAllBusyRef.current = false;
      setSignOutAllBusy(false);
    }
    setSignOutNotice(describeSignOutAll({ error, signedOutHere }));
  };

  // Signing out, any way, closes the "sign out of all devices" question; signing
  // in clears the last result.
  useEffect(() => {
    setSignOutAllAsking(false);
    if (authSession) setSignOutNotice(null);
  }, [authSession ? authSession.userId : null]);

  // Copies this device's pieces and technique library to the signed-in account
  // and checks the copy by reading it back (Pass 110, lib/accountSync.js). It
  // only ever adds what the account lacks: it never changes this device's data
  // and never overwrites a row the account already holds. `pieces` and
  // `technique` are read once, when this runs: what's uploaded and compared is
  // what this device held at that moment, even if something changes while it
  // runs.
  const runBackUp = async () => {
    if (!authEnabled || !authSession || !technique || backupRunningRef.current || syncRunningRef.current || accountFlowBusyRef.current) return;
    const { userId } = authSession;
    backupRunningRef.current = true;
    setBackup({ running: true, userId, result: null, finishedAt: null });
    let result;
    try {
      result = await backUpDevice({ pieces, technique, userId });
    } catch (e) {
      // backUpDevice reports its own failures; this is only a last resort.
      result = { userId, status: "stopped", reason: "other" };
    }
    backupRunningRef.current = false;
    setBackup({ running: false, userId, result, finishedAt: Date.now() });
    // A first backup that checked out is what switches automatic uploading on
    // (Pass 111): work out what's waiting now, and send it after the quiet period.
    const snap = refreshSyncInfo();
    if (snap && snap.firstBackupDone && snap.waiting > 0) scheduleSync(SYNC_QUIET_MS);
  };

  // The "Back up this device" button. Design J: the first backup to an account
  // asks first, so one browser's pieces never land in the wrong account by
  // surprise; once a checked backup is recorded on this device for that
  // account, pressing again goes straight through, since all it can do is add
  // what's missing. The question is shown in the Account panel itself, never
  // as a browser pop-up: some browsers block or auto-dismiss pop-ups, and a
  // blocked pop-up reads as "No", so the button silently does nothing. The
  // first version used a pop-up and did nothing on its first real try; making
  // the pop-up answer "No" reproduces that exactly (the real browser's
  // behavior wasn't confirmed, but the symptom is identical).
  const handleBackUpDevice = () => {
    if (!authEnabled || !authSession || !technique || backupRunningRef.current) return;
    if (!hasRecordedBackup(readDeviceRecord(), authSession.userId)) {
      setBackupAsking(true);
      return;
    }
    runBackUp();
  };
  const handleConfirmBackUp = () => {
    setBackupAsking(false);
    runBackUp();
  };
  const handleCancelBackUp = () => setBackupAsking(false);

  // A backup result belongs to the account that asked for it: drop it when the
  // signed-in account changes or signs out. (A backup that's still running
  // keeps going and reports to its own account, see handleBackUpDevice.)
  useEffect(() => {
    setBackupAsking(false);
    setBackup((b) => (b.running || (b.userId === null && b.result === null) ? b : { running: false, userId: null, result: null, finishedAt: null }));
    // The account flow belongs to the account that opened it too.
    setAccountNotice(null);
    setWelcomeAccountCount(null);
    accountDeletedHereRef.current = [];
    // ... and so does what an automatic update (Pass 120) said and is waiting on.
    setAutoNotice(null);
    setAutoPending([]);
    autoPendingIdsRef.current = new Set();
    setPieceUpdatedNote(null);
    setSettleFlow(null);
    if (importSource === "account") {
      setImportCandidates(null);
      setImportTechnique(null);
      setImportTechniqueInfo({ unreadable: false, skippedItems: 0 });
      setImportSource("file");
      setImportAccount(null);
    }
  }, [authSession ? authSession.userId : null]);

  // Check the export reminder once pieces are loaded — app-level (not
  // per-piece), since export already bundles every piece into one backup.
  // loadOrInitFirstUseAt seeds its anchor on first read, so this doubles as
  // that seeding call.
  useEffect(() => {
    if (!loaded) return;
    const lastExportedAt = loadLastExportedAt();
    const firstUseAt = loadOrInitFirstUseAt();
    setExportReminderDue(isExportReminderDue(lastExportedAt, firstUseAt));
  }, [loaded]);

  // targetId defaults to the active piece (the common case, and every call
  // site before Pass 32a) but can be passed explicitly — sidebar reordering
  // needs to write sortOrder onto pieces that aren't necessarily the one
  // currently open.
  const updatePiece = (updater, targetId = activePieceId) => {
    if (!targetId) return;
    setPieces((prev) => {
      const current = prev[targetId];
      if (!current) return prev;
      const next = typeof updater === "function" ? updater(current) : updater;
      // Bumped on every mutation through this single funnel (CLAUDE.md: all
      // piece changes go through updatePiece) so mergeImportedPiece can tell
      // "this device has newer state than the file being re-imported" from
      // "the file actually is the newer copy" — see storage.js.
      //
      // Pass 126: and every single-value setting this change moved gets a dated note
      // ("the most recent change wins", lib/settingTimes.js). A merge, a reload from another
      // tab and an import never come through here, so they never write one.
      const now = Date.now();
      return { ...prev, [targetId]: { ...stampChangedSettings(current, next, now), updatedAt: now } };
    });
  };

  const chunkSet = useMemo(() => (piece ? generateAllChunks(piece) : null), [piece]);
  const chunks = chunkSet ? chunkSet.all : [];
  const practiceChunks = chunkSet ? chunkSet.practiceChunks : [];
  // Raw, pre-review-status timeline — realCurrentDay is clamped off its
  // days.length, which withLiveReviewStatus below never changes (it only
  // edits reviewChunkIds within existing days), so computing
  // realCurrentDay off this raw value first and the corrected `timeline`
  // second (using that same realCurrentDay) avoids a circular dependency
  // between the two.
  const rawTimeline = useMemo(() => (piece ? getEffectiveTimeline(piece, chunkSet) : null), [piece, chunkSet]);
  const realCurrentDay = useMemo(
    () => (piece && rawTimeline ? getCurrentDay(piece, rawTimeline.days.length) : 1),
    [piece, rawTimeline]
  );
  // A review whose due date has passed sits on its original day forever,
  // looking like a still-open task, duplicating what's already shown live
  // on today's screen — see withLiveReviewStatus (lib/scheduling.js) for
  // the full mechanism. Applied here, once, so every tab consuming
  // `timeline` gets the corrected reviewChunkIds for free.
  const timeline = useMemo(
    () => (piece && rawTimeline ? withLiveReviewStatus(rawTimeline, piece, realCurrentDay) : rawTimeline),
    [piece, rawTimeline, realCurrentDay]
  );
  const currentDay = dayOverride || realCurrentDay;

  // scheduleMode: "minutes" mirror of TodayTab's days-mode reschedule nudge
  // (Pass 39): once elapsedDay runs past this piece's daysToLearn with the
  // piece not yet actually learned (isPieceLearned — Stage 3's real
  // definition, not just "logged once"), there's no deadline here to
  // protect by stopping and asking, so the plan just grows automatically
  // instead of falling into the due-reviews-only maintenance view. See
  // computeMinutesModeAutoExtend (lib/scheduling.js) and
  // docs/Decisions.md#scheduling for the days-vs-minutes asymmetry this
  // generalizes. Scoped to the active piece only, same as chunkSet/timeline
  // themselves — a background piece not currently open picks this up the
  // next time it's opened, not live. Skipped while the piece is being
  // hand-edited in Settings so this can't race a save landing on top of it.
  // Self-limiting: applying the patch grows daysToLearn past elapsedDay, so
  // the next recompute finds nothing left to do and the effect is a no-op.
  useEffect(() => {
    if (!loaded || !piece || !chunkSet || !timeline || settingsEditing) return;
    const extension = computeMinutesModeAutoExtend(piece, chunkSet, timeline);
    if (extension) updatePiece((p) => ({ ...p, ...extension }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, piece, chunkSet, timeline, settingsEditing]);

  // `tab` defaults to "overview" (every call site before Master Agenda's
  // "Log practice"/"Pick a random piece" below), which land on Today's
  // Practice instead — you clicked "practice", so you should land where
  // you actually log it, not on the dashboard.
  const switchToPiece = (id, tab = "overview") => {
    if (!guardLeavingActiveWork()) return;
    setActivePieceId(id);
    setSwitcherOpen(false);
    setActiveTab(tab);
    setDayOverride(null);
    setSettingsEditing(false);
    setEditDraftState(null);
  };

  const handleComplete = (finished, options = {}) => {
    if (!guardLeavingActiveWork()) return;
    const id = newId("p");
    // Appends to the end of the switcher without waiting for a reload to
    // backfill it (validateAndMigratePiece isn't in the create path) —
    // Date.now() sorts after every existing piece's sortOrder/createdAt.
    const withId = ensureWorkId({ ...finished, id, updatedAt: Date.now(), sortOrder: finished.createdAt || Date.now() });
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
    setActivePieceId(remainingIds[0] || null);
    setEditDraftState(null);
    setSettingsEditing(false);
    setActiveTab("overview");
    setDayOverride(null);
    setDeleteModalOpen(false);
  };

  /* ------------------------------------------------------------------ */
  /*  Technique practice handlers (Pass 100; undo and top-up Pass 101).  */
  /*  Every technique change goes through updateTechnique — never        */
  /*  setPieces/updatePiece. Called from TechniqueTab and its panel.     */
  /* ------------------------------------------------------------------ */

  // Every key of every ACTIVE piece (Pass 103): its own key plus the other
  // keys it passes through. Paused/archived pieces don't count; a piece
  // mid-revival is still active, so it does. Feeds the engine's pace tier
  // (via techniqueEngineState) and the "Repertoire in this key" pill /
  // Library note icon on every screen that shows technique.
  const techniqueRepertoireKeys = useMemo(() => repertoireKeysFromPieces(pieces), [pieces]);

  // The engine's view of the saved technique object.
  function techniqueEngineState(t) {
    return {
      items: t.items,
      methods: resolveMethods(t.methodState, t.customMethods),
      methodLastUsed: t.methodLastUsed,
      walkPosition: t.walkPosition,
      previousList: t.dayList,
      repertoireKeys: techniqueRepertoireKeys,
    };
  }

  // `stamp: false` for a library that arrives from somewhere else (an import, an update from another
  // device): it carries its own dated notes (Pass 126) and its changes are nobody's change here.
  function updateTechnique(updater, { stamp = true } = {}) {
    setTechnique((prev) => {
      if (!prev) return prev;
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (!next || next === prev) return prev;
      const now = Date.now();
      return { ...(stamp ? stampChangedTechnique(prev, next, now) : next), updatedAt: now };
    });
  }

  const updateTechniqueItem = (itemId, fn) =>
    updateTechnique((t) => ({ ...t, items: t.items.map((it) => (it.id === itemId ? fn(it) : it)) }));

  // Check-off (tempo omitted: a bare check-off, saved tempo unchanged) or
  // an even-rhythm check with a tempo, which sets the new baseline.
  const handleTechniqueComplete = (itemId, tempo = null) =>
    updateTechnique((t) => {
      if (!t.dayList) return t;
      const done = completeTask(
        { items: t.items, dayList: t.dayList, methodLastUsed: t.methodLastUsed, walkPosition: t.walkPosition },
        itemId,
        t.dayList.date,
        tempo,
        Date.now() // the exact time of the check (Pass 118): when two devices log a tempo the same day, the later wins
      );
      return { ...t, items: done.items, dayList: done.dayList, methodLastUsed: done.methodLastUsed, walkPosition: done.walkPosition };
    });
  const handleTechniqueCheckOff = (itemId) => handleTechniqueComplete(itemId, null);
  // Un-check: reverses everything the check-off changed (uncompleteTask).
  const handleTechniqueUncheck = (itemId) =>
    updateTechnique((t) => {
      if (!t.dayList) return t;
      const undone = uncompleteTask(
        { items: t.items, dayList: t.dayList, methodLastUsed: t.methodLastUsed, walkPosition: t.walkPosition },
        itemId
      );
      return { ...t, items: undone.items, dayList: undone.dayList, methodLastUsed: undone.methodLastUsed, walkPosition: undone.walkPosition };
    });

  // After a scale is added or put back in rotation, fill any free slots on
  // today's list right away instead of waiting for tomorrow's list (Pass
  // 101). Nothing already on the list is replaced.
  const withTopUp = (t) =>
    t.dayList ? { ...t, dayList: topUpDayList(techniqueEngineState(t), t.dayList, t.dayList.date, t.settings.scalesPerDay) } : t;
  const handleTechniqueLogTempo = (itemId, tempo) => handleTechniqueComplete(itemId, tempo);

  const handleTechniqueToggleStarItem = (itemId) =>
    updateTechniqueItem(itemId, (it) => ({ ...it, starred: !it.starred }));
  // Switching a scale off also takes its unfinished task off today's list
  // (a done one stays as a record); either way, free slots are topped up.
  const handleTechniqueToggleRotation = (itemId) =>
    updateTechnique((t) => {
      const next = { ...t, items: t.items.map((it) => (it.id === itemId ? { ...it, inRotation: !it.inRotation } : it)) };
      const nowOn = next.items.find((it) => it.id === itemId)?.inRotation;
      return withTopUp(nowOn ? next : { ...next, dayList: removeUnfinishedTask(next.dayList, itemId) });
    });

  const updateMethodState = (methodId, fn) =>
    updateTechnique((t) => {
      const cur = t.methodState[methodId] || { starred: false, enabled: true };
      return { ...t, methodState: { ...t.methodState, [methodId]: fn(cur) } };
    });
  const handleTechniqueToggleStarMethod = (methodId) => updateMethodState(methodId, (s) => ({ ...s, starred: !s.starred }));
  const handleTechniqueToggleMethod = (methodId) => updateMethodState(methodId, (s) => ({ ...s, enabled: !s.enabled }));

  // fields: { form, tonic, quality, minorForm, octaves, hands, checkOctaves }.
  // Returns false if the fields don't make a valid item.
  const handleTechniqueAddItem = (fields) => {
    const item = normalizeTechniqueItem({ ...fields, id: newId("t") });
    if (!item) return false;
    updateTechnique((t) => withTopUp({ ...t, items: [...t.items, item] }));
    return true;
  };

  // Edits octaves / hands / form details. checkOctaves is deliberately not
  // editable here — it goes through handleTechniqueChangeCheckOctaves so a
  // saved tempo is never silently re-based.
  const handleTechniqueEditItem = (itemId, patch) =>
    updateTechniqueItem(itemId, (it) => {
      const { checkOctaves, id, ...rest } = patch || {};
      return normalizeTechniqueItem({ ...it, ...rest }) || it;
    });

  // choice: undefined (ask first), "keep", or "fresh". Returns the engine's
  // status — "needs-prompt" means nothing changed and the screen should ask
  // "keep as a starting point, or start fresh?" then call again with a choice.
  const handleTechniqueChangeCheckOctaves = (itemId, newOctaves, choice) => {
    const item = technique?.items.find((it) => it.id === itemId);
    if (!item) return "unchanged";
    const result = changeCheckOctaves(item, newOctaves, choice);
    if (result.status === "applied") updateTechniqueItem(itemId, () => result.item);
    return result.status;
  };

  // fields: { name, technique, description, appliesTo }. Returns false if
  // the name is blank.
  const handleTechniqueAddMethod = (fields) => {
    const name = (fields?.name || "").trim();
    if (!name) return false;
    const method = {
      id: newId("m"),
      name,
      technique: fields.technique || "Rhythm",
      description: (fields.description || "").trim(),
      appliesTo: fields.appliesTo || "both",
      custom: true,
    };
    updateTechnique((t) => ({ ...t, customMethods: [...t.customMethods, method] }));
    return true;
  };

  // The panel's card handlers, shared by every surface that shows today's
  // technique list (Technique page, Master Agenda, Daily Practice) — one
  // list in App state, so a check-off anywhere shows everywhere.
  const techniquePanelHandlers = {
    onCheckOff: handleTechniqueCheckOff,
    onUncheck: handleTechniqueUncheck,
    onLogTempo: handleTechniqueLogTempo,
    onToggleStarItem: handleTechniqueToggleStarItem,
    onToggleStarMethod: handleTechniqueToggleStarMethod,
  };

  const handleExportClick = () => setExportModalOpen(true);

  // includeTechnique (Pass 104): the export modal's "Technique library" row,
  // on by default. Off leaves the technique block out of the file entirely.
  const handleConfirmExport = (selectedIds, includeTechnique = false) => {
    const subset = Object.fromEntries(selectedIds.map((id) => [id, pieces[id]]).filter(([, p]) => p));
    downloadBackup(subset, includeTechnique ? technique : null);
    const result = saveLastExportedAt(Date.now());
    if (!result.ok) setStorageError(true);
    setExportReminderDue(false);
    setExportReminderDismissed(false);
    setExportModalOpen(false);
  };

  const handleImportClick = () => importInputRef.current?.click();

  // Parses the chosen file and hands the found pieces to ImportPiecesModal
  // for the user to pick from — nothing is actually added/merged until
  // handleConfirmImport runs.
  const handleImportFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      let importedPieces;
      let techniqueRead;
      try {
        importedPieces = parseBackupPieces(reader.result);
        techniqueRead = readBackupTechnique(reader.result);
      } catch (e) {
        window.alert("That file doesn't look like a valid MeasureOne backup.");
        return;
      }
      const valid = (importedPieces || []).filter((p) => p && p.id);
      // A backup can hold only a technique library (exported with every
      // piece unticked) — that's still worth importing.
      if (valid.length === 0 && !techniqueRead.technique) {
        window.alert(
          techniqueRead.unreadable
            ? "The technique library in that backup couldn't be read, and it has no pieces, so there's nothing to import."
            : "No pieces found in that backup file."
        );
        return;
      }
      setImportTechnique(techniqueRead.technique);
      setImportTechniqueInfo({ unreadable: techniqueRead.unreadable, skippedItems: techniqueRead.skippedItems });
      setImportCandidates(valid);
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = (selectedIndices, ladderChoices = {}, orderChoice = "existing", includeTechnique = false) => {
    const next = { ...pieces };
    let firstNewId = null;
    let updatedCount = 0;
    let createdCount = 0;
    // Imported pieces are "created" now, in this browser, regardless of
    // whatever createdAt the source file carried — createdAt is just
    // sort-order bookkeeping, never the scheduling anchor (see getCurrentDay
    // in lib/utils). If the source didn't specify a plan start date, the
    // plan begins today (the import date); if it did (e.g. restoring your
    // own backup of an in-progress piece), that start date is honored so
    // the plan doesn't jump back to day 1.
    const importedAt = Date.now();
    const reRanked = []; // matched pieces that took the file's place in the list (orderChoice "imported")
    selectedIndices.forEach((index) => {
      const candidate = importCandidates[index];
      if (!candidate) return;
      // A backup file never brings a reorder note along: it dates from another day and lists
      // pieces that may no longer be here, so it must not rearrange the list. (A chosen
      // "use the imported order" is stamped as a reorder of its own, below.)
      const { switcherOrder: _fileNote, ...p } = candidate;
      // Match by id first, then by song identity (name + composer), so
      // re-importing a backup — e.g. after hand-editing minutesPerDay in
      // the exported file — updates the piece it already matches instead
      // of piling up a second copy of it. Unlike the brand-new-piece path
      // below, a matched import's startDate is left as-is (no "default to
      // today" fallback) — mergeImportedPiece already keeps the existing
      // piece's startDate whenever the import doesn't specify one, and
      // forcing today here would silently reset an in-progress plan back
      // to day 1 if the exported file happened to be missing that field.
      const match = findMatchingPiece(next, p);
      if (match) {
        // Re-derived here (not trusted from ImportPiecesModal's earlier
        // preview) for the same reason `match` itself is re-derived above —
        // "the real check happens again on confirm, against whatever
        // `pieces` looks like at that moment." When updatedAt alone can tell
        // which side is ahead, that's the ladder-state winner outright and
        // needs no input from the user; only real divergence (resolution:
        // null) falls back to whatever the user picked in the modal — or
        // "existing" (today's original, safer default) if they never
        // interacted with that particular picker.
        const diff = diffImportedPiece(match, p);
        const ladderChoice = diff.hasDivergence ? (ladderChoices[index] === "imported" ? "imported" : "existing") : diff.resolution;
        // validateAndMigratePiece (not just reconcileMinutesPerDaySchedule)
        // so an imported piece gets the same full backfill a stored piece
        // gets on load — most importantly here, a ladderConfig missing
        // bpmSteps (an old export, or one that predates it entirely) gets
        // merged with defaults rather than reaching computeLadderAdvance
        // incomplete and throwing on the next logged session. See storage.js.
        const merged = validateAndMigratePiece(ensureWorkId({
          ...mergeImportedPiece(match, p, ladderChoice, orderChoice),
          rescheduleMarker: null,
        }));
        next[match.id] = merged;
        writePieceDirect(match.id, merged);
        if (merged.sortOrder !== match.sortOrder) reRanked.push(match.id);
        updatedCount++;
      } else {
        const id = next[p.id] ? newId("p") : p.id;
        // validateAndMigratePiece re-derives daysToLearn against
        // minutesPerDay for "minutes" mode (otherwise an imported piece
        // just keeps whatever daysToLearn the backup happened to carry,
        // which may have nothing to do with its minutesPerDay — e.g. a
        // backup hand-edited to change the pace without updating the day
        // count to match) and backfills everything else a stored piece
        // gets on load, same reasoning as the matched branch above.
        const withId = validateAndMigratePiece({ ...p, id, createdAt: importedAt + index, startDate: p.startDate || todayISODate() });
        next[id] = withId;
        if (!firstNewId) firstNewId = id;
        writePieceDirect(id, withId);
        createdCount++;
      }
    });
    if (reRanked.length > 0) {
      // The person chose the file's order on purpose, which is a reorder: stamped now, so that it
      // is the most recent one and the list shows what the ranks now say.
      const ordered = groupPiecesByWork(Object.values(next).sort(compareSwitcherOrder)).flatMap((g) => g.pieces);
      const note = makeOrderNote({ ordered, all: Object.values(next), now: importedAt });
      reRanked.forEach((id) => {
        next[id] = { ...next[id], switcherOrder: { at: note.at, ids: [...note.ids] } };
        writePieceDirect(id, next[id]);
      });
    }
    setPieces(next);
    if (!activePieceId && firstNewId) setActivePieceId(firstNewId);
    // Technique library (Pass 104): merged, never replaced — see
    // mergeImportedTechnique (lib/storage.js). Goes through updateTechnique
    // like every other technique change, and tops up today's list so newly
    // added scales can join it straight away.
    let techniqueStats = null;
    if (includeTechnique && importTechnique && technique) {
      techniqueStats = mergeImportedTechnique(technique, importTechnique).stats;
      updateTechnique((t) => withTopUp(mergeImportedTechnique(t, importTechnique).technique), { stamp: false });
    }
    const { unreadable: techniqueUnreadable, skippedItems } = importTechniqueInfo;
    setImportCandidates(null);
    setImportTechnique(null);
    setImportTechniqueInfo({ unreadable: false, skippedItems: 0 });
    const parts = [];
    if (createdCount) parts.push(`${createdCount} new piece${createdCount === 1 ? "" : "s"} added`);
    if (updatedCount) parts.push(`${updatedCount} existing piece${updatedCount === 1 ? "" : "s"} updated`);
    if (techniqueStats) {
      const t = techniqueStats;
      parts.push(
        `technique library merged (${t.itemsAdded} scale${t.itemsAdded === 1 ? "" : "s"} added, ` +
          `${t.temposUpdated} newer tempo${t.temposUpdated === 1 ? "" : "s"}, ${t.methodsAdded} method${t.methodsAdded === 1 ? "" : "s"} added` +
          (skippedItems > 0 ? `, ${skippedItems} unreadable scale${skippedItems === 1 ? "" : "s"} skipped` : "") +
          ")"
      );
    }
    if (techniqueUnreadable) parts.push("the technique library in the file couldn't be read, so it wasn't imported");
    window.alert(parts.length ? `Import complete: ${parts.join(", ")}.` : "Nothing selected. Import cancelled.");
  };

  /* ---------------------------------------------------------------- */
  /*  Getting things from the account (Pass 112).                      */
  /*  Restore from the welcome screen, "Get changes" in the Account    */
  /*  panel, and Review on a piece held as changed on another device   */
  /*  are one flow. lib/accountSync.js reads the account's rows, works */
  /*  out what each one is and merges them with the import path's own  */
  /*  functions; this file only runs it, shows the import modal when a */
  /*  person needs to decide something, and applies the result. It     */
  /*  never removes anything from this device unless "Delete it here   */
  /*  too" is clicked, and the only thing it writes to the account is  */
  /*  marking a duplicate copy deleted.                                */
  /* ---------------------------------------------------------------- */

  const closeImportModal = () => {
    setImportCandidates(null);
    setImportTechnique(null);
    setImportTechniqueInfo({ unreadable: false, skippedItems: 0 });
    if (importSource === "account") {
      const gone = accountDeletedHereRef.current;
      accountDeletedHereRef.current = [];
      // (Pass 122: added to what is already said, e.g. a piece kept from this same window)
      if (gone.length) setAccountNotice((prev) => ({ lines: [...(prev ? prev.lines : []), ...gone.map((n) => ({ text: `Deleted "${n}" here too.` }))] }));
    }
    setImportSource("file");
    setImportAccount(null);
  };

  // Does the merge and everything that goes with it. The device record is saved
  // BEFORE any state changes, so the automatic upload (Pass 111) never sees
  // merged pieces without their entries and mistakes them for new ones.
  //
  // Pass 120: ONE apply step for both ways in. `automatic` is "Update
  // automatically from other devices": the same merge, the same entries, the same
  // record, but only what needs no decision is applied (see applyAccountMerge in
  // lib/accountSync.js); a piece with a conflicting part is held, a piece in
  // `busyIds` waits, and the result is told in the Account panel (and, if it is
  // the open piece, one quiet line) instead of the Get changes result lines.
  // Returns { applied } so the caller knows whether anything was recorded.
  //
  // Pass 121: the same step settles a held piece from the person's answers (`settle`,
  // { [pieceId]: { [part]: "local" | "remote" | "both" } }, mode "settle"). Only when the
  // answers settle EVERY conflict is anything applied, record first like the rest;
  // otherwise the piece and the record are exactly as they were.
  const applyAccountFlow = async ({ mode, userId, candidates, selectedIds, ladderChoices, orderChoice, includeTechnique, automatic = false, busyIds = [], settle = null, leadLines = [] }) => {
    // The newest committed copies (Pass 119's refs), not the last effect's.
    const localPieces = piecesRef.current;
    const localTechnique = techniqueRef.current;
    const record = accountRecordFor(readDeviceRecord(), userId);
    const out = applyAccountMerge({ candidates, localPieces, localTechnique, accountRecord: record, selectedIds, ladderChoices, orderChoice, includeTechnique, automatic, busyIds, settle });
    let nextRecord = withAccountCopyRecorded(readDeviceRecord(), userId, {
      entries: out.entries,
      technique: out.technique ? out.technique.entry : null,
      checkedAt: out.becomesChecked ? Date.now() : null,
    });
    // A piece changed differently on both sides is held, with which parts (Pass 121 asks).
    out.held.forEach((h) => {
      nextRecord = withPieceHeld(nextRecord, userId, h.id, h.conflicts);
    });
    // Pass 122: a piece the account marks deleted, removed here by itself. The device forgets
    // it FIRST (without counting it as an upload), so no second "deleted" is ever sent.
    const removedIds = out.removed.map((r) => r.id);
    removedIds.forEach((id) => {
      nextRecord = withPieceDropped(nextRecord, userId, id);
    });
    saveDeviceRecord(nextRecord);
    const changedIds = Object.keys(out.pieces).filter((id) => out.pieces[id] !== localPieces[id]);
    if (changedIds.length > 0) {
      setPieces((prev) => {
        const next = { ...prev };
        changedIds.forEach((id) => {
          // Automatic only: if the piece was replaced since the plan was made (an
          // update React hadn't applied yet), redo this piece against the copy that
          // is there now, so a newer change is never overwritten; what can't be
          // merged cleanly is left alone and held (saved by the effect below).
          if (automatic && prev[id] !== localPieces[id]) {
            const theirs = (candidates.pieces.find((c) => c.id === id) || {}).piece;
            if (!prev[id] || !theirs) return;
            const again = reapplyOnto({ current: prev[id], accountPiece: theirs, baseParts: record.pieces[id] && record.pieces[id].parts });
            next[id] = again.piece;
            if (again.held) lateHeldRef.current.set(id, again.held);
            return;
          }
          next[id] = out.pieces[id];
        });
        return next;
      });
      // Restoring onto an empty device opens a piece, which brings up the
      // regular app (sidebar included) in place of the welcome screen.
      if (out.firstNewId) setActivePieceId((prev) => prev || out.firstNewId);
    }
    // ...and then it goes. The piece that is OPEN is left for another one, the way deleting it
    // here does (handleDeleteHereToo). A piece in use never gets this far: it waited.
    let openRemovedName = null;
    if (removedIds.length > 0) {
      const openId = busyCtxRef.current && busyCtxRef.current.activePieceId;
      setPieces((prev) => {
        const next = { ...prev };
        removedIds.forEach((id) => delete next[id]);
        return next;
      });
      if (openId && removedIds.includes(openId)) {
        openRemovedName = (out.removed.find((r) => r.id === openId) || {}).name || null;
        setActivePieceId(Object.keys(localPieces).filter((id) => !removedIds.includes(id))[0] || null);
        setEditDraftState(null);
        setSettingsEditing(false);
        setActiveTab("overview");
        setDayOverride(null);
      }
    }
    if (out.technique && out.technique.changed) {
      const accountTechnique = candidates.technique.technique;
      const baseParts = record.technique && record.technique.parts;
      updateTechnique((t) => withTopUp(automatic ? mergeTechniqueFromAccount(t, accountTechnique, baseParts) : mergeImportedTechnique(t, accountTechnique).technique), { stamp: false });
    }
    refreshSyncInfo();
    // Whatever this device holds beyond the account's copy is now an ordinary
    // change waiting: send it after the usual quiet period. (Nothing in state may
    // have changed, so the effect that normally schedules this might not run.)
    if (accountRecordFor(readDeviceRecord(), userId).checkedAt != null) scheduleSync(SYNC_QUIET_MS);
    const applied = Object.keys(out.entries).length > 0 || !!out.technique || out.held.length > 0 || removedIds.length > 0;
    if (automatic) {
      // Told quietly, in the Account panel; the page-wide banner only when something was lost
      // (practice that went with a removed piece) or the piece that was open just went (Pass 122).
      const updatedText = describeAutoUpdate({
        names: [...out.names.added, ...out.names.took, ...out.names.merged],
        technique: !!(out.technique && out.technique.changed),
        removed: out.removed.map((r) => r.name),
      });
      // Pass 126: where both devices changed the same setting, the more recent change was kept: said
      // quietly here, with whose it was, and nothing to press.
      const keptText = describeRecencySettled({ pieces: out.recency, technique: out.technique ? out.technique.notices : [] });
      const text = [updatedText, keptText].filter(Boolean).join(" ");
      if (text) setAutoNotice({ text });
      const removedLines = describeAutoRemoved(out.removed, openRemovedName);
      if (removedLines.length > 0) setAccountNotice({ lines: removedLines });
      autoPendingIdsRef.current = new Set(out.deferred.map((d) => d.id));
      setAutoPending(out.deferred.map((d) => d.name));
      // Only if the piece that is OPEN changed: one quiet line at the top of the page.
      const openId = busyCtxRef.current && busyCtxRef.current.activePieceId;
      if (openId && out.updatedIds.includes(openId)) setPieceUpdatedNote(openId);
      return { applied, needsYou: out.needsYou, leftDeleted: out.leftDeleted };
    }
    // Settling a held piece (Pass 121): told by the settle flow itself, once it has
    // gone through every piece, not by the Get changes result lines.
    if (settle) return { applied: Object.keys(out.entries).length > 0, unsettled: out.unsettled, settledIds: out.settledIds, upToDateIds: out.upToDateIds };
    // The other copy of a combined piece is marked deleted only once this device
    // has made its first backup: until then the combined piece can't go up to
    // replace it, and marking it would leave the account with no live copy.
    let marked = null;
    let notMarked = [];
    if (out.markDeleted.length > 0) {
      if (accountRecordFor(readDeviceRecord(), userId).checkedAt != null) {
        marked = await markOtherCopiesDeleted({ items: out.markDeleted, userId });
      } else {
        notMarked = out.markDeleted.map((m) => m.name);
      }
    }
    const deletedHere = accountDeletedHereRef.current;
    accountDeletedHereRef.current = [];
    let lines = describeAccountMergeResult({
      mode,
      applied: out.counts,
      technique: out.technique && out.technique.changed ? out.technique : null,
      unreadable: candidates.unreadable.length,
      skippedItems: candidates.technique.skippedItems,
      techniqueUnreadable: candidates.technique.unreadable,
      marked,
      notMarked,
      leftOff: out.leftOff,
    });
    if (deletedHere.length > 0) {
      lines = lines.filter((l) => l.text !== "Everything here already matches your account.");
      deletedHere.forEach((n) => lines.push({ text: `Deleted "${n}" here too.` }));
    }
    if (leadLines.length > 0) {
      // What the settle flow just said stays on top (and "everything matches" would repeat it)
      lines = [...leadLines, ...lines.filter((l) => l.text !== "Everything here already matches your account.")];
    }
    setAccountNotice({ lines });
    return { applied };
  };

  // Pass 120: brings in what the last check found, when the switch is on. Runs in
  // the tab that holds the lease only (the check does), reads ONLY the rows that
  // changed, and goes through applyAccountFlow, the same step Get changes uses.
  // Pieces in use wait (the shared busy test, lib/tabSync.js) and are applied when
  // the person is done with them (the effect below). Returns null when nothing ran,
  // else { applied }. Never throws.
  const runAutoUpdate = async (reason) => {
    const { userId, loaded: isLoaded } = syncLatestRef.current;
    if (!authEnabled || !userId || !isLoaded || !holdsLease()) return null;
    if (backupRunningRef.current || accountFlowBusyRef.current || autoRunningRef.current) return null;
    const lastRead = checkRowsRef.current;
    if (!lastRead || lastRead.userId !== userId) return null;
    const deviceRecord = readDeviceRecord();
    const changes = classifyAccountChanges({
      rows: lastRead.rows,
      accountRecord: accountRecordFor(deviceRecord, userId),
      localPieceIds: Object.keys(piecesRef.current),
    });
    // Pass 122: a piece the account marked deleted within 30 days is removed here by itself.
    const deletions = deletionsElsewhere({
      rows: lastRead.rows,
      entries: accountRecordFor(deviceRecord, userId).pieces,
      localPieceIds: Object.keys(piecesRef.current),
      now: Date.now(),
    });
    const targets = autoUpdateTargets({ deviceRecord, userId, changes, deletions });
    const accountRevision = Object.fromEntries(((lastRead.rows && lastRead.rows.pieces) || []).map((r) => [r.id, r.revision]));
    targets.pieceIds = targets.pieceIds.filter((id) => autoLeftForYouRef.current.get(id) !== accountRevision[id]);
    if (!targets.on) {
      // switched off: nothing waits for anything
      if (autoPendingIdsRef.current.size > 0) {
        autoPendingIdsRef.current = new Set();
        setAutoPending([]);
      }
      return null;
    }
    if (targets.pieceIds.length === 0 && !targets.technique) {
      if (autoPendingIdsRef.current.size > 0) {
        autoPendingIdsRef.current = new Set();
        setAutoPending([]);
      }
      return null;
    }
    autoRunningRef.current = true;
    accountFlowBusyRef.current = true; // so an upload, a check or a manual flow waits for this
    try {
      const got = await fetchChangedAccountRows({ userId, ids: targets.pieceIds, technique: targets.technique });
      if (syncLatestRef.current.userId !== userId) return null; // signed out, or another account, meanwhile
      if (got.status !== "ok") return null; // the next check brings it again
      if (!autoUpdateOn(readDeviceRecord(), userId)) return null; // switched off while reading
      const candidates = accountRowsToCandidates(got.rows);
      const busyIds = busyPieceIds(Object.keys(piecesRef.current), busyCtxRef.current);
      const result = await applyAccountFlow({
        mode: "auto",
        userId,
        candidates,
        selectedIds: null,
        ladderChoices: {},
        orderChoice: "follow",
        includeTechnique: targets.technique,
        automatic: true,
        busyIds,
      });
      // what was left for the person is not asked about again at this revision
      (result.needsYou || []).forEach((n) => {
        const c = candidates.pieces.find((x) => x.id === n.id);
        if (c) autoLeftForYouRef.current.set(n.id, c.revision);
      });
      // ...and the same for a deleted row the apply looked at and left alone (a combine's
      // duplicate): it is not fetched again, and the person is asked about it instead
      if ((result.leftDeleted || []).length > 0) {
        result.leftDeleted.forEach((d) => autoLeftForYouRef.current.set(d.id, d.revision));
        refreshSyncInfo();
      }
      return result;
    } catch (e) {
      console.warn("MeasureOne: an automatic update didn't go through.", e && e.message);
      return null;
    } finally {
      // A moment later, so the state this just set has been committed before an
      // upload or a check looks at it.
      setTimeout(() => {
        accountFlowBusyRef.current = false;
        autoRunningRef.current = false;
      }, 100);
    }
  };

  // The Account panel's switch. Stored in the device record only (never in the
  // account), off unless chosen. Turning it on looks right away, so a change
  // already waiting arrives in seconds rather than at the next minute.
  const handleSetAutoUpdate = (on) => {
    if (!authEnabled || !authSession) return;
    saveDeviceRecord(withAutoUpdate(readDeviceRecord(), authSession.userId, !!on));
    setAutoUpdate(!!on);
    if (!on) {
      autoPendingIdsRef.current = new Set();
      setAutoPending([]);
    } else {
      requestCheck("startup");
    }
  };

  // A piece that was in use is free now (an Interleaved attempt confirmed or
  // discarded, a reassessment timer stopped, the settings draft saved or
  // discarded): bring in what waited for it.
  useEffect(() => {
    if (!loaded || autoPendingIdsRef.current.size === 0) return;
    const stillBusy = busyPieceIds([...autoPendingIdsRef.current], busyCtxRef.current);
    if (stillBusy.length < autoPendingIdsRef.current.size) runAutoUpdate("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, activePieceId, interleaveRisk, assessmentTimerRisk, settingsEditing, editDraft ? editDraft.id : null]);

  // Pieces an apply found changed under it that couldn't be merged cleanly are
  // held now that the state has settled (see applyAccountFlow).
  useEffect(() => {
    if (lateHeldRef.current.size === 0 || !authSession) return;
    const late = [...lateHeldRef.current.entries()];
    lateHeldRef.current = new Map();
    let rec = readDeviceRecord();
    late.forEach(([id, conflicts]) => {
      rec = withPieceHeld(rec, authSession.userId, id, conflicts);
    });
    saveDeviceRecord(rec);
    refreshSyncInfo();
  }, [pieces]);

  // The quiet line on the open piece goes away when another piece is opened.
  useEffect(() => {
    if (pieceUpdatedNote && pieceUpdatedNote !== activePieceId) setPieceUpdatedNote(null);
  }, [activePieceId, pieceUpdatedNote]);

  // mode: "restore" (the welcome screen), "changes" (the Account panel's "Get
  // changes from your account"), or "review" (a piece held as changed on another
  // device: only what's held). Reads the account, then either applies it at once
  // (when nothing needs a decision: a clean newer copy, or what already matches)
  // or opens the import modal for the person to decide.
  //
  // Pass 121: in "review" mode a piece held WITH recorded conflicts is not put in the
  // picker. It gets its own flow, one plain question per conflicting part (planSettle),
  // and opening it changes nothing. `opts.exclude` (piece ids that already had their
  // turn) skips that and leaves them out of the picker; `opts.leadLines` is what the
  // settle flow already said, kept at the top of the result.
  const openAccountFlow = async (mode, opts = {}) => {
    if (!authEnabled || !authSession || accountFlowBusyRef.current || backupRunningRef.current || importCandidates) return;
    const userId = authSession.userId;
    accountFlowBusyRef.current = true;
    setAccountFlowBusy(true);
    setAccountNotice(opts.leadLines && opts.leadLines.length > 0 ? { lines: opts.leadLines } : null);
    try {
      const got = await fetchAccountCopy({ userId });
      if (syncLatestRef.current.userId !== userId) return; // signed out, or another account, meanwhile
      if (got.status !== "ok") {
        setAccountNotice({ lines: [{ text: describeFetchProblem(got.reason), problem: true }] });
        return;
      }
      const { pieces: localPieces, technique: localTechnique } = syncLatestRef.current;
      if (!localTechnique) return;
      // Pass 122b: a restore starts afresh. It is only offered on the welcome screen, which has
      // no Settings, so a "no" given in an earlier restore must not leave the device with no way
      // to get those pieces back. Whatever is left unticked this time is remembered as usual.
      if (mode === "restore" && declinedCount(accountRecordFor(readDeviceRecord(), userId)) > 0) {
        saveDeviceRecord(withDeclinedCleared(readDeviceRecord(), userId));
      }
      const record = accountRecordFor(readDeviceRecord(), userId);
      const all = accountRowsToCandidates(got.rows);
      if (mode !== "review" && all.pieces.length === 0 && all.deleted.length === 0 && !all.technique.technique) {
        setAccountNotice({ lines: [{ text: "Your account has nothing yet. Press Back up this device to copy this device's pieces to it." }] });
        return;
      }
      if (mode === "review" && !opts.exclude) {
        const settlePlan = planSettle({ candidates: all, localPieces, accountRecord: record });
        // A piece whose questions could not be prepared goes through the picker, and says so.
        const fallback = settlePlan.errored.map((e) => ({ name: e.name }));
        if (settlePlan.items.length > 0) {
          setSettleFlow({
            userId,
            items: settlePlan.items.map((i) => ({ ...i, candidate: all.pieces.find((c) => c.id === i.id) })),
            index: 0,
            state: startSettle(settlePlan.items[0]),
            results: { settled: [], unsettled: [], fallback },
          });
          return;
        }
        if (fallback.length > 0) opts = { ...opts, leadLines: [...(opts.leadLines || []), ...describeSettleResult({ fallback })] };
      }
      const candidates = mode === "review" ? restrictCandidatesToHeld(all, record, opts.exclude || []) : all;
      const plan = planAccountMerge({ candidates, localPieces, localTechnique, accountRecord: record });
      const visible = plan.items.filter((i) => i.kind !== "same");
      const ask = mode === "restore" ? visible.length > 0 || plan.deletedElsewhere.length > 0 : planNeedsQuestion(plan);
      if (!ask) {
        await applyAccountFlow({ mode, userId, candidates, selectedIds: null, ladderChoices: {}, orderChoice: "follow", includeTechnique: true, leadLines: opts.leadLines || [] });
        return;
      }
      const matchName = (i) =>
        i.matchId ? (localPieces[i.matchId] || (candidates.pieces.find((c) => c.id === i.matchId) || {}).piece || {}).name || "this piece" : null;
      // The technique library gets a row in the modal only when merging it would
      // change something here. Otherwise it's merged quietly with the rest (its
      // only effect is recording the account's copy), so "0 new, 0 newer tempos"
      // never asks for a decision that isn't one.
      let techniqueOffered = false;
      if (plan.technique.available && !plan.technique.same) {
        const st = mergeImportedTechnique(localTechnique, candidates.technique.technique).stats;
        techniqueOffered = st.itemsAdded + st.temposUpdated + st.methodsAdded + st.methodStatesAdded > 0;
      }
      setImportSource("account");
      setImportAccount({
        mode,
        userId,
        candidates,
        visibleIds: visible.map((i) => i.id),
        // Pass 122b: `id` and `matchId` say what the ticks mean afterwards (planDeclines);
        // `uncertain`: a name match where one of the two has no composer
        visibleItems: visible.map((i) => ({ id: i.id, kind: i.kind, matchId: i.matchId })),
        rowMeta: visible.map((i) => ({ kind: i.kind, held: i.held, matchName: matchName(i), uncertain: !!i.uncertain })),
        deletedElsewhere: plan.deletedElsewhere,
        unreadable: plan.unreadable.length,
        techniqueQuiet: plan.technique.available && !techniqueOffered,
        leadLines: opts.leadLines || [],
      });
      setImportTechnique(techniqueOffered ? candidates.technique.technique : null);
      setImportTechniqueInfo({ unreadable: candidates.technique.unreadable, skippedItems: candidates.technique.skippedItems });
      setImportCandidates(visible.map((i) => i.piece));
    } finally {
      accountFlowBusyRef.current = false;
      setAccountFlowBusy(false);
    }
  };

  // The modal's confirm button when its pieces came from the account. Indexes
  // are positions in the list the modal showed; the flow keys everything by the
  // account row's id. What the modal didn't list ("already the same") is always
  // applied: it only records the account's copy.
  const handleConfirmAccountImport = async (selectedIndices, ladderChoicesByIndex = {}, orderChoice = "follow", includeTechnique = false) => {
    const flow = importAccount;
    if (!flow || accountFlowBusyRef.current) return;
    if (!authSession || flow.userId !== authSession.userId) {
      closeImportModal();
      setAccountNotice({ lines: [{ text: "You signed out, so nothing was changed." }] });
      return;
    }
    const selected = new Set(selectedIndices.map((i) => flow.visibleIds[i]).filter(Boolean));
    // Pass 122b: what the person left unticked is an answer. A new piece left unticked is
    // remembered as "not on this device" and not mentioned again; a "same piece, other
    // copy" left unticked is remembered as "different pieces" (and, in a restore, comes in as
    // its own piece). Saved BEFORE the apply, so the apply already honors it, and nothing
    // is remembered when the window is closed instead.
    const said = planDeclines({ items: flow.visibleItems || [], selectedIds: [...selected], mode: flow.mode });
    if (said.pairs.length > 0 || said.pieces.length > 0) {
      saveDeviceRecord(withDeclined(readDeviceRecord(), flow.userId, { pairs: said.pairs, pieces: said.pieces }));
    }
    said.arrivingIds.forEach((id) => selected.add(id));
    flow.candidates.pieces.forEach((c) => {
      if (!flow.visibleIds.includes(c.id)) selected.add(c.id);
    });
    const ladderChoices = {};
    selectedIndices.forEach((i) => {
      const id = flow.visibleIds[i];
      if (id) ladderChoices[id] = ladderChoicesByIndex[i] === "imported" ? "imported" : "existing";
    });
    accountFlowBusyRef.current = true;
    setAccountFlowBusy(true);
    setImportCandidates(null);
    setImportTechnique(null);
    setImportTechniqueInfo({ unreadable: false, skippedItems: 0 });
    setImportSource("file");
    setImportAccount(null);
    try {
      await applyAccountFlow({
        mode: flow.mode,
        userId: flow.userId,
        candidates: flow.candidates,
        selectedIds: [...selected],
        ladderChoices,
        orderChoice,
        includeTechnique: includeTechnique || !!flow.techniqueQuiet,
        leadLines: flow.leadLines || [],
      });
    } finally {
      accountFlowBusyRef.current = false;
      setAccountFlowBusy(false);
    }
  };

  // "Delete it here too": a piece the account marks deleted (deleted on another
  // device) but that's still here. Only this click removes it. The device forgets
  // it first (without counting it as an upload), so no second "deleted" is sent
  // for a row that's already marked.
  // From the window the result is said when the window closes; from the banner or the Account
  // panel (Pass 122, `fromWindow: false`) there is no window, so it is said at once.
  const handleDeleteHereToo = (id, { fromWindow = true } = {}) => {
    const target = pieces[id];
    if (!target) return;
    // Deleting the open piece switches pieces and tabs, so it goes through the
    // same guard as every other way of leaving unfinished work (an unconfirmed
    // Interleaved attempt, a running assessment timer).
    if (activePieceId === id && !guardLeavingActiveWork()) return;
    if (authSession) saveDeviceRecord(withPieceDropped(readDeviceRecord(), authSession.userId, id));
    if (fromWindow) accountDeletedHereRef.current = [...accountDeletedHereRef.current, target.name || "Untitled piece"];
    else setAccountNotice({ lines: [{ text: `Deleted "${target.name || "Untitled piece"}" here too.` }] });
    const remainingIds = Object.keys(pieces).filter((x) => x !== id);
    setPieces((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (activePieceId === id) {
      setActivePieceId(remainingIds[0] || null);
      setEditDraftState(null);
      setSettingsEditing(false);
      setActiveTab("overview");
      setDayOverride(null);
    }
    setImportAccount((prev) => (prev ? { ...prev, deletedElsewhere: prev.deletedElsewhere.filter((d) => d.id !== id) } : prev));
  };

  /* ---------------------------------------------------------------- */
  /*  Bringing a deleted piece back (Pass 122).                        */
  /*  "Keep it" is for a piece this device still holds that the        */
  /*  account marks deleted; "Restore" (in Recently deleted) is for    */
  /*  any piece deleted in the last 30 days. Both clear the account's  */
  /*  deleted mark, "only if still at revision N" (lib/accountSync.js  */
  /*  bringBackDeletedPiece), and then bring the piece in through the  */
  /*  same single apply step Get changes uses, so a copy here that     */
  /*  differs from the account's is merged, never replaced.            */
  /* ---------------------------------------------------------------- */

  // `out` is bringBackDeletedPiece's "kept" or "live" answer: the account's copy is live now.
  const bringBackThroughApply = async ({ userId, id, out, lead }) => {
    // The last light look at the account still says this piece is deleted. Correct that one
    // row first, so nothing is shown (the banner, the "Changes from another device" line)
    // from a look that is no longer true.
    const last = checkRowsRef.current;
    if (last && last.userId === userId && last.rows) {
      const rows = (last.rows.pieces || []).map((r) => (r.id === id ? { ...r, deleted_at: null, revision: out.revision } : r));
      checkRowsRef.current = { ...last, rows: { ...last.rows, pieces: rows } };
    }
    // Pass 122b: asking for this piece by name beats an old "no" about it
    saveDeviceRecord(withDeclinedRemoved(readDeviceRecord(), userId, [id]));
    const candidates = accountRowsToCandidates({ pieces: [{ id, revision: out.revision, deleted_at: null, data: out.data }], technique: null });
    await applyAccountFlow({ mode: "changes", userId, candidates, selectedIds: [id], ladderChoices: {}, orderChoice: "follow", includeTechnique: false, leadLines: [lead] });
  };

  const handleKeepDeleted = async (id) => {
    if (!authEnabled || !authSession || accountFlowBusyRef.current || backupRunningRef.current) return;
    const target = piecesRef.current[id];
    if (!target) return;
    const userId = authSession.userId;
    const name = target.name || "Untitled piece";
    // The revision this device read when it noticed the deletion (the last light look).
    const lastRead = checkRowsRef.current;
    const seen = lastRead && lastRead.userId === userId ? ((lastRead.rows && lastRead.rows.pieces) || []).find((r) => r.id === id) : null;
    accountFlowBusyRef.current = true;
    setAccountFlowBusy(true);
    try {
      const out = await bringBackDeletedPiece({ userId, id, expectedRevision: seen ? seen.revision : null });
      if (syncLatestRef.current.userId !== userId) return; // signed out, or another account, meanwhile
      const line = describeBringBack({ status: out.status, name, reason: out.reason });
      if (out.status === "kept" || out.status === "live") await bringBackThroughApply({ userId, id, out, lead: line });
      else setAccountNotice({ lines: [line] });
    } catch (e) {
      console.warn("MeasureOne: keeping a piece didn't go through.", e && e.message);
      setAccountNotice({ lines: [describeBringBack({ status: "stopped", name, reason: "other" })] });
    } finally {
      accountFlowBusyRef.current = false;
      setAccountFlowBusy(false);
    }
    setImportAccount((prev) => (prev ? { ...prev, deletedElsewhere: prev.deletedElsewhere.filter((d) => d.id !== id) } : prev));
    refreshSyncInfo();
  };

  // "Ask me again about what I said no to" (Pass 122b): forgets every "no" this device
  // remembers for this account, so the pieces left off, and the pieces said to be different,
  // are offered again. It only changes the device record, and nothing in the account. The last
  // light look at the account is kept and sorted against the record again (refreshSyncInfo),
  // so the line that counts changes from other devices shows them at once; no request is made.
  const handleAskMeAgain = () => {
    if (!authEnabled || !authSession || accountFlowBusyRef.current || backupRunningRef.current) return;
    const userId = authSession.userId;
    const had = declinedCount(accountRecordFor(readDeviceRecord(), userId)) > 0;
    if (had) saveDeviceRecord(withDeclinedCleared(readDeviceRecord(), userId));
    refreshSyncInfo();
    setAccountNotice({ lines: describeAskMeAgain({ cleared: had }) });
  };

  const loadRecentlyDeleted = async (userId, notice = null) => {
    const got = await fetchDeletedPieces({ userId });
    if (syncLatestRef.current.userId !== userId) {
      setRecentlyDeleted(null);
      return;
    }
    setRecentlyDeleted((prev) => {
      if (!prev) return prev; // closed meanwhile
      if (got.status !== "ok") return { ...prev, status: "error", items: [], error: describeFetchProblem(got.reason), busyId: null, notice };
      return { ...prev, status: "ok", items: recentlyDeletedList(got.rows, { now: Date.now() }), error: null, busyId: null, notice };
    });
  };

  const handleOpenRecentlyDeleted = () => {
    if (!authEnabled || !authSession) return;
    setRecentlyDeleted({ status: "loading", items: [], error: null, busyId: null, notice: null });
    loadRecentlyDeleted(authSession.userId);
  };

  const handleCloseRecentlyDeleted = () => setRecentlyDeleted(null);

  const handleRestoreDeleted = async (item) => {
    if (!authEnabled || !authSession || accountFlowBusyRef.current || backupRunningRef.current) return;
    const userId = authSession.userId;
    accountFlowBusyRef.current = true;
    setAccountFlowBusy(true);
    setRecentlyDeleted((prev) => (prev ? { ...prev, busyId: item.id } : prev));
    let notice = null;
    let lookAgain = false;
    try {
      const out = await bringBackDeletedPiece({ userId, id: item.id, expectedRevision: item.revision });
      if (syncLatestRef.current.userId !== userId) {
        setRecentlyDeleted(null);
        return;
      }
      const line = describeBringBack({ status: out.status, name: item.name, restored: true, reason: out.reason });
      if (out.status === "kept" || out.status === "live") {
        await bringBackThroughApply({ userId, id: item.id, out, lead: line });
        notice = { text: line.text, problem: false };
        setRecentlyDeleted((prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== item.id) } : prev));
      } else {
        notice = { text: line.text, problem: !!line.problem };
        lookAgain = out.status === "moved"; // the row changed since the list was read: read it again
      }
    } catch (e) {
      console.warn("MeasureOne: restoring a piece didn't go through.", e && e.message);
      notice = { text: describeBringBack({ status: "stopped", name: item.name, reason: "other" }).text, problem: true };
    } finally {
      accountFlowBusyRef.current = false;
      setAccountFlowBusy(false);
    }
    setRecentlyDeleted((prev) => (prev ? { ...prev, busyId: null, notice } : prev));
    if (lookAgain) loadRecentlyDeleted(userId, notice);
  };

  // The one quiet banner for pieces the account marks deleted that the person is asked about.
  const deletedBanner = authSession
    ? describeDeletedBanner(syncInfo.deletedElsewhere.map((d) => d.name), { unsynced: syncInfo.deletedElsewhere.some((d) => d.unsynced) })
    : null;

  /* ---------------------------------------------------------------- */
  /*  Settling a held piece, one question at a time (Pass 121).        */
  /*  The questions, the wording and the rule for what each answer     */
  /*  does are in lib/accountSync.js and lib/pieceMerge.js (tested);   */
  /*  this only walks the person through them. Choosing an option and  */
  /*  "Next" change nothing, and neither does "Decide later" or the    */
  /*  close button. Only the last answer of a piece applies it, through */
  /*  applyAccountFlow, the same record-first step Get changes uses.   */
  /* ---------------------------------------------------------------- */

  const settleItem = settleFlow ? settleFlow.items[settleFlow.index] : null;
  const settleCurrent = settleFlow && settleItem ? settleView(settleItem, settleFlow.state) : null;

  // Every piece has had its turn. What else is still held (a refused upload, the
  // technique library, a piece Review could not ask about) goes through the
  // whole-piece picker exactly as before; the pieces that just had their turn,
  // including the ones put off with "Decide later", are left out of it.
  const finishSettleFlow = (flow, results) => {
    const lines = describeSettleResult(results);
    const ids = flow.items.map((i) => i.id);
    setSettleFlow(null);
    const record = accountRecordFor(readDeviceRecord(), flow.userId);
    const othersHeld = Object.keys(record.pieces).some((id) => record.pieces[id].held && !ids.includes(id)) || !!(record.technique && record.technique.held);
    if (othersHeld) openAccountFlow("review", { exclude: ids, leadLines: lines });
    else if (lines.length > 0) setAccountNotice({ lines });
  };

  const advanceSettleFlow = (flow, results) => {
    if (flow.index + 1 < flow.items.length) {
      setSettleFlow({ ...flow, index: flow.index + 1, state: startSettle(flow.items[flow.index + 1]), results });
    } else finishSettleFlow(flow, results);
  };

  const handleSettleAnswer = (value) => {
    if (!settleFlow || !settleItem || accountFlowBusyRef.current) return;
    setSettleFlow({ ...settleFlow, state: settleChoose(settleItem, settleFlow.state, value) });
  };
  const handleSettleBack = () => {
    if (!settleFlow || !settleItem || accountFlowBusyRef.current) return;
    setSettleFlow({ ...settleFlow, state: settleBack(settleItem, settleFlow.state) });
  };
  const handleSettleDecideLater = () => {
    if (settleFlow && !accountFlowBusyRef.current) advanceSettleFlow(settleFlow, settleFlow.results);
  };
  const handleSettleClose = () => {
    if (!accountFlowBusyRef.current) setSettleFlow(null);
  };
  const handleSettleNext = async () => {
    const flow = settleFlow;
    if (!flow || !settleItem || accountFlowBusyRef.current) return;
    const step = settleNext(settleItem, flow.state);
    if (!step.applies) {
      if (step.state !== flow.state) setSettleFlow({ ...flow, state: step.state });
      return;
    }
    // The summary's button (or "Bring it up to date"): the one moment anything is applied.
    if (!authSession || flow.userId !== authSession.userId) {
      setSettleFlow(null);
      setAccountNotice({ lines: [{ text: "You signed out, so nothing was changed." }] });
      return;
    }
    accountFlowBusyRef.current = true;
    setAccountFlowBusy(true);
    let results = flow.results;
    let stay = null; // set when the person stays on this piece: asked again, or the account could not be read
    let item = settleItem;
    try {
      // The account may have moved on while the person decided (another device logged
      // practice, or changed what is being decided). Read the row again; the answers are
      // applied only if they still mean what they meant, else the questions start over.
      const got = await fetchChangedAccountRows({ userId: flow.userId, ids: [item.id] });
      if (syncLatestRef.current.userId !== flow.userId) {
        setSettleFlow(null);
        setAccountNotice({ lines: [{ text: "You signed out, so nothing was changed." }] });
        return;
      }
      if (got.status !== "ok") {
        stay = { ...flow, state: { ...flow.state, notice: describeSettleRereadProblem(got.reason) } };
      } else {
        const verdict = rereadSettleItem({ item, rows: got.rows, localPieces: piecesRef.current, accountRecord: accountRecordFor(readDeviceRecord(), flow.userId) });
        if (verdict.outcome === "gone") {
          results = { ...results, unsettled: [...results.unsettled, { name: item.name, reason: "gone" }] };
        } else if (verdict.outcome === "again") {
          stay = { ...flow, items: flow.items.map((it, i) => (i === flow.index ? verdict.item : it)), state: startSettle(verdict.item, verdict.notice) };
        } else {
          item = verdict.item;
          const out = await applyAccountFlow({
            mode: "settle",
            userId: flow.userId,
            candidates: {
              pieces: [item.candidate],
              deleted: [],
              unreadable: [],
              technique: { technique: null, revision: null, unreadable: false, skippedItems: 0 },
            },
            selectedIds: [item.id],
            ladderChoices: {},
            orderChoice: "follow",
            includeTechnique: false,
            settle: { [item.id]: flow.state.answers },
          });
          if (out.unsettled.length > 0) {
            results = { ...results, unsettled: [...results.unsettled, { name: item.name, reason: out.unsettled[0].reason || "changed" }] };
          } else if (out.applied) {
            // "Kept ..." only for a piece the answers were really applied to; a piece that
            // already matched by now is just up to date.
            const kept = out.settledIds.includes(item.id) ? keptPhrases(item, flow.state) : [];
            results = { ...results, settled: [...results.settled, { name: item.name, kept }] };
          } else {
            results = { ...results, unsettled: [...results.unsettled, { name: item.name, reason: "error" }] };
          }
        }
      }
    } catch (e) {
      console.warn("MeasureOne: settling a piece didn't go through.", e && e.message);
      results = { ...results, unsettled: [...results.unsettled, { name: item.name, reason: "error" }] };
      stay = null;
    } finally {
      accountFlowBusyRef.current = false;
      setAccountFlowBusy(false);
    }
    if (stay) setSettleFlow(stay);
    else advanceSettleFlow(flow, results);
  };

  // Editing state lives here, not inside SettingsTab, so switching tabs
  // mid-edit doesn't unmount (and lose) the in-progress draft.
  const startEditing = () => {
    if (!guardLeavingActiveWork()) return;
    setEditDraftState((d) => {
      if (d) return d;
      // Pieces created before the deadline-date field existed only have
      // daysToLearn as a raw count — backfill an equivalent targetDate so
      // ScheduleFields' date math has something to work from.
      const targetDate = piece.targetDate || addDaysISO(todayISODate(), Math.max(0, (piece.daysToLearn || 1) - 1));
      return { ...piece, targetDate, practiceDaysPerWeek: piece.practiceDaysPerWeek || 7 };
    });
    setSettingsEditing(true);
    setActiveTab("settings");
  };
  // Runs after startEditing (called from the reschedule dialog's "Set new
  // target date" button) has landed on Settings — the target-date field
  // sits 6 panels down (Piece, Sections, Tempo zones, Difficulty,
  // Recurring material, then Schedule), not visible on arrival, so this
  // scrolls it into view and focuses it instead of leaving the user to
  // find it themselves. Keyed on the flag becoming true, checked against
  // activeTab rather than assumed: startEditing's own
  // guardLeavingActiveWork() can decline and never set activeTab to
  // "settings" at all, in which case this only clears the flag and does
  // nothing else. document.getElementById, not a ref, matches the plain
  // id on that one input (ScheduleFields.jsx) — see the comment there.
  //
  // The scroll itself is deferred a tick, not called synchronously here:
  // ScheduleFields.jsx has its own useEffect that recomputes minutesPerDay/
  // daysToLearn right after this same Settings mount and can trigger a
  // second render (e.g. the overloaded-pace warning banner appearing),
  // shifting the page's layout out from under an already-centered scroll
  // target. Confirmed live — the field landed off-screen (negative
  // getBoundingClientRect().top) on a piece whose pace needed that
  // recompute, while an otherwise-identical piece that didn't need it
  // centered correctly. The short setTimeout lets that settle first.
  //
  // Real bug caught live while verifying this: the flag must NOT be reset
  // synchronously in the same pass that schedules the timer. Both
  // focusTargetDateOnSettings and activeTab sit in this effect's own
  // dependency array — calling setFocusTargetDateOnSettings(false) inline
  // here (before the timer fires) triggers an immediate re-render, which
  // re-runs this effect, whose cleanup (clearTimeout) cancels the pending
  // scroll before 50ms ever elapses. Confirmed by monkey-patching
  // scrollIntoView/focus and finding they were never called at all. The
  // flag is reset only once inside the timeout callback instead, after
  // the scroll/focus have actually run — that reset still triggers a
  // re-run of this effect, but by then there's no pending timer left to
  // cancel, so it's harmless.
  useEffect(() => {
    if (!focusTargetDateOnSettings) return;
    if (activeTab !== "settings") {
      // startEditing's own guardLeavingActiveWork() declined and never
      // switched tabs — nothing to scroll to. Still has to consume the
      // flag here (synchronously is fine in THIS branch, since no timer
      // was ever scheduled to race against), or it would misfire on some
      // later, unrelated arrival at Settings.
      setFocusTargetDateOnSettings(false);
      return;
    }
    const id = setTimeout(() => {
      const el = document.getElementById("settings-target-date-field");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
      }
      setFocusTargetDateOnSettings(false);
    }, 50);
    return () => clearTimeout(id);
  }, [focusTargetDateOnSettings, activeTab]);
  const setEditDraft = (patch) => setEditDraftState((d) => ({ ...d, ...patch }));
  const handleSavePiece = (draft) => {
    // `draft` is the edit form's copy of the piece from when editing started
    // (or last saved). Only the fields the form owns are taken from it — see
    // mergeEditedPiece (lib/pieceEdit.js) — so Save can't undo practice
    // logged, ratings, chunk notes, a Pause/Archive, or an ended revival
    // that happened elsewhere while the form was open. `updated` below is
    // the live piece with just the form's edits applied.
    const updated = mergeEditedPiece(piece, draft);
    // Typing a work title on a standalone piece promotes it into a work;
    // clearing it pulls the piece back out. See lib/works.js.
    //
    // migrateOrphanedProgress (lib/chunking.js) reattaches any progress
    // entry whose chunk id an edit just regenerated (totalMeasures/
    // chunkMode/customChunkSize) onto whichever new chunk best overlaps
    // the same measures — `piece` here is still the pre-edit state (this
    // closure's own current value, not `updated`), so it's the "old" side
    // of the comparison. A no-op, same object back, when nothing was
    // actually orphaned by this edit.
    // reassociateTroubleSpots (lib/chunking.js) is a second, more precise
    // pass on top of migrateOrphanedProgress: the latter only catches a
    // chunk id that's disappeared outright, not one that still exists but
    // now covers different measures (customChunkSize 8 -> 4 both produce a
    // "c9", just at 9-16 vs 9-12) — a case migrateOrphanedProgress reads as
    // pure continuity. Each focus spot's own startMeasure is checked
    // against `updated`'s real, current chunks regardless of which id it's
    // currently nested under.
    const progress = reassociateTroubleSpots(migrateOrphanedProgress(piece, updated), generateAllChunks(updated).practiceChunks);
    // A save that doesn't regenerate chunk ids (see CHUNK_STRUCTURE_FIELDS)
    // — pacing fields, or a difficulty/recurring reassessment — used to
    // still always drop rescheduleMarker to null, same as every other edit,
    // falling back to a from-scratch computeTimeline on the next render.
    // That function has no notion of piece.progress at all: it freely
    // re-labels every practice chunk "new" by where it lands in the newly
    // spread schedule, regardless of doneDays — so simply retyping the
    // target date here (including via the reschedule dialog's own "Set new
    // target date" escape hatch, which lands on this exact save path), or
    // reassessing a chunk's difficulty, could make an already-practiced
    // chunk read as brand new or newly behind. computeRescheduleRemainder
    // is the same "what's actually still untouched" computation
    // handleReschedule's own button already trusts — reusing it here keeps
    // that distinction intact for this entry point too, chained onto any
    // existing reschedule history the same way. Only an edit that actually
    // regenerates chunk ids (totalMeasures/chunkMode/customChunkSize) falls
    // through to the pre-existing behavior, since a chunk id from before
    // that edit may not even exist anymore (migrateOrphanedProgress, above,
    // is what handles reattaching progress in that case).
    const scheduleOnlyEdit = CHUNK_STRUCTURE_FIELDS.every((f) => updated[f] === piece[f]);
    const rescheduleMarker = scheduleOnlyEdit
      ? computeRescheduleRemainder(piece, chunkSet, timeline).marker
      : null;

    // Pass 97 — a structural edit can invalidate existing split points.
    // splitPointsAfterStructureEdit (lib/chunking.js) decides which survive:
    // if the chunk step is unchanged (e.g. only totalMeasures moved) every
    // split that's still a legitimate midpoint stays, no dialog; if the step
    // changed, only splits the new grid already lands on survive (a resize
    // like 4 -> 2 keeps every midpoint split, no dialog). Only splits
    // actually being lost get named in a confirmation.
    let chunkSplitPoints = piece.chunkSplitPoints || [];
    if (!scheduleOnlyEdit && chunkSplitPoints.length > 0) {
      const { kept, lost } = splitPointsAfterStructureEdit(piece, updated);
      if (lost.length > 0) {
        const oldChunks = chunkSet.practiceChunks;
        const describeLostSplit = (m) => {
          const right = oldChunks.find((c) => c.start === m);
          const left = oldChunks.find((c) => c.end === m - 1);
          if (!right || !left) return `measure ${m}`;
          return `${formatRange(left.start, right.end)} (→ ${formatRange(left.start, right.start - 1)} / ${formatRange(right.start, right.end)})`;
        };
        const descriptions = lost.map(describeLostSplit).join("; ");
        const ok = window.confirm(
          lost.length === 1
            ? `This change can't preserve your split at ${descriptions}. It'll merge back into an ordinary chunk under the new chunking.\n\nProgress still carries over the way it always does when chunking changes.\n\nContinue?`
            : `This change can't preserve ${lost.length} of your splits: ${descriptions}.\n\nThey'll merge back into ordinary chunks under the new chunking. Progress still carries over the way it always does when chunking changes.\n\nContinue?`
        );
        if (!ok) return;
      }
      chunkSplitPoints = kept;
    }

    updatePiece(ensureWorkId({ ...updated, progress, rescheduleMarker, chunkSplitPoints }));
    setEditDraftState(null);
    setSettingsEditing(false);
  };
  const handleDiscardEdit = () => {
    setEditDraftState(null);
    setSettingsEditing(false);
  };

  // Consolidation-day logging — stop count replaces the old bare "mark
  // complete" checkbox (Repertoire-Lifecycle.md's "Post-run-through
  // logging"). Mirrors handleLogSession/handleUnlogSession's shape
  // (doneDays append-if-missing, sessions appended and keyed by loggedAt,
  // multiple same-day attempts allowed) against the synthetic
  // "__consolidation__" progress key rather than a real chunk id.
  const handleLogRunThrough = (day, stopCount) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress["__consolidation__"] || { doneDays: [] };
      const doneDays = prevEntry.doneDays.includes(day) ? prevEntry.doneDays : [...prevEntry.doneDays, day];
      const loggedDate = todayISODate();
      const sessions = [...(prevEntry.sessions || []), { day, stopCount, loggedAt: Date.now(), loggedDate }];
      progress["__consolidation__"] = { ...prevEntry, doneDays, sessions };
      return { ...p, progress, lastLoggedAt: loggedDate };
    });
  };

  // Removes only the most recently logged run-through for `day` — same
  // "undo the last attempt, not the whole day" convention as
  // handleUnlogSession.
  const handleUnlogRunThrough = (day) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress["__consolidation__"];
      if (!prevEntry) return p;
      const sessions = [...(prevEntry.sessions || [])];
      const lastIdx = sessions.map((s) => s.day).lastIndexOf(day);
      if (lastIdx === -1) return p;
      sessions.splice(lastIdx, 1);
      const stillHasDay = sessions.some((s) => s.day === day);
      const doneDays = stillHasDay ? prevEntry.doneDays : (prevEntry.doneDays || []).filter((d) => d !== day);
      progress["__consolidation__"] = { ...prevEntry, doneDays, sessions };
      return { ...p, progress };
    });
  };

  // Cold-Start check (Pass 56) — a whole-piece cold play-through offered
  // once every section's own single-section run-through has been logged
  // at least once, then re-offered at a widening gap since anything was
  // last logged on the piece. Both handlers are thin wrappers: the actual
  // logic (why this writes a separate "__cold_start__" key rather than
  // reusing "__consolidation__", the gapDays computation, the escalating
  // due-threshold check) lives in lib/coldStart.js so it's unit-testable
  // per CLAUDE.md's "logic that needs a regression test belongs in
  // src/lib/" rule. See docs/Algorithms.md#cold-start-check.
  const handleLogColdStart = (day, avgBpm, notes) => {
    updatePiece((p) => {
      const { progress, lastLoggedAt } = applyColdStartLog(p, day, avgBpm, notes);
      return { ...p, progress, lastLoggedAt };
    });
  };

  const handleUnlogColdStart = () => {
    updatePiece((p) => {
      const result = applyColdStartUnlog(p);
      return result ? { ...p, ...result } : p;
    });
  };

  // `sessionInput` = { cleanReps, bpm, outcome, durationSeconds, targetBPM,
  // suggestedStartingBPM } — outcome is already classified by the caller
  // (classifySessionOutcome, lib/confidence.js), since that needs the full
  // chunk (difficultyLabel) and the piece's bpmZones, neither of which this
  // handler has from just a chunkId. targetBPM is the caller's
  // already-resolved effective target (entry.targetBPM ||
  // getDefaultTargetBPM(...)), needed here for lib/ladder.js's tempo-floor
  // gating. suggestedStartingBPM is likewise caller-resolved
  // (getSuggestedStartingBPM(piece, chunk), lib/confidence.js) — needed
  // only for the moment a fail newly sets needsRelearning (rule 4:
  // Decisions.md#spaced-repetition--maintenance), same reason targetBPM is
  // resolved by the caller rather than here.
  //
  // Sessions are appended, never overwritten by day alone — logging the
  // same chunk twice on one plan-day (e.g. an early touch, then a later
  // re-attempt) now produces two distinct records, keyed by `loggedAt` (a
  // precise timestamp). See PR summary: this is a placeholder scheme, not
  // the semantic Tier-1/due-review/re-attempt keying the design doc
  // eventually wants — that needs Tier 1/Tier 2 scheduling, a later,
  // explicitly deferred pass.
  const handleLogSession = (chunkId, day, sessionInput) => {
    const { cleanReps, bpm, outcome, durationSeconds, targetBPM, suggestedStartingBPM, skipped, provisional } = sessionInput;
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId] || { doneDays: [] };
      const loggedDate = todayISODate();
      const loggedAt = Date.now();

      // Pass 29 — Interleaved mode's "skip, just save time" action. A
      // zero-rep session fed through the normal path below would classify
      // as a real fail (classifySessionOutcome treats `!cleanReps` as
      // "fail"), which would be wrong here: choosing not to report an
      // outcome isn't the same as reporting a failed one. This branch
      // records that time was spent — but, per user direction, does NOT
      // add `day` to `doneDays`: a skip is explicitly not "marked
      // completed," so the chunk still shows as open in the regular
      // checklist and can be logged for real later, during or outside
      // Interleaved mode. It returns before computeLadderAdvance runs, so
      // stage/practiceBPM/nextDueDate are left exactly as they were. The
      // session record itself carries `skipped: true` so every reader that
      // treats `sessions` as evidence of judged practice — confidence
      // scoring, Progress tab stats, ladder-status history — can exclude it
      // via lib/utils.js's `loggedSessions` rather than silently counting
      // it as a real attempt. Total time practiced (`sumPracticeSeconds`)
      // deliberately still counts it — the time really was spent.
      if (skipped) {
        const sessions = [...(prevEntry.sessions || []), { day, loggedAt, loggedDate, skipped: true, durationSeconds }];
        progress[chunkId] = { ...prevEntry, sessions };
        return { ...p, progress, lastLoggedAt: loggedDate };
      }

      // Pass 29 follow-up — Interleaved mode's provisional logging. A
      // retrieval attempt made mid-rotation often looks rougher than the
      // same chunk would in focused, blocked practice, while still being
      // the more effective long-term practice — so InterleavePanel routes
      // an auto-classified soft-miss/fail (NOT a manual "needs more work"
      // override, which is already an explicit, deliberate fail) through
      // here instead of committing it immediately. The real reps/BPM/
      // outcome ARE recorded, unlike a skip, but — same as skip — `day` is
      // not added to `doneDays` and computeLadderAdvance does not run:
      // nothing about this attempt affects the ladder until the user
      // confirms it (handleConfirmProvisionalSession) or discards it
      // (handleDiscardProvisionalSession), during or outside Interleaved
      // mode. loggedSessions (lib/utils.js) excludes provisional sessions
      // from confidence/progress-tab reads the same way it excludes
      // skipped ones, for the same reason: neither is a resolved, judged
      // attempt yet.
      if (provisional) {
        const sessions = [
          ...(prevEntry.sessions || []),
          { day, loggedAt, loggedDate, cleanReps, bpm, outcome, durationSeconds, provisional: true },
        ];
        progress[chunkId] = { ...prevEntry, sessions };
        return { ...p, progress, lastLoggedAt: loggedDate };
      }

      const doneDays = prevEntry.doneDays.includes(day) ? prevEntry.doneDays : [...prevEntry.doneDays, day];

      // Snapshot the ladder state as it stood *before* this session, onto
      // the session record itself — not the chunk entry — so same-day
      // multi-session logging keeps each session's own "before" picture
      // distinct. Lets handleUnlogSession fully reverse the ladder when
      // undoing the most recent session, instead of just deleting the
      // record and leaving stage/tempo/nextDueDate advanced (the
      // desync bug documented in docs/Decisions.md's "session undo should
      // fully reverse the ladder" entry). Same snapshot-and-restore pattern
      // `flagSnapshot` already uses for rough/lost flags (handleSetFlag,
      // below).
      const ladderSnapshot = {
        stage: prevEntry.stage ?? null,
        consecutivePasses: prevEntry.consecutivePasses ?? 0,
        consecutiveStabilizingFails: prevEntry.consecutiveStabilizingFails ?? 0,
        practiceBPM: prevEntry.practiceBPM ?? null,
        nextDueDate: prevEntry.nextDueDate ?? null,
        tier1Done: prevEntry.tier1Done ?? false,
        needsRelearning: prevEntry.needsRelearning ?? false,
        // currentBPM (the last tempo actually played, distinct from the
        // ladder's practiceBPM) was originally left out of this snapshot —
        // "six small fields" was a deliberate scope call in Pass 10, but the
        // consequence was that undoing a chunk's only session left
        // currentBPM holding the undone session's tempo, and
        // computeAutoConfidence reads it directly, so a fully-reverted
        // chunk could still show a nonzero confidence score. Captured here
        // so undo reverses it too. See docs/Decisions.md's "session undo
        // should fully reverse the ladder" entry.
        currentBPM: prevEntry.currentBPM ?? null,
        // Per-stage tempo baselines (Pass 26 follow-up, lib/ladder.js) —
        // same reasoning as currentBPM above: without these in the
        // snapshot, undoing the one session that just recorded a fresh
        // stage-entry baseline would leave that baseline standing even
        // though the promotion/demotion that set it was itself undone.
        stabilizingEntryBPM: prevEntry.stabilizingEntryBPM ?? null,
        settlingEntryBPM: prevEntry.settlingEntryBPM ?? null,
        holdingEntryBPM: prevEntry.holdingEntryBPM ?? null,
        // Tempo-ratchet adaptive rate (Pass 59, lib/ladder.js) — same
        // reasoning as the three entry-BPM fields above: without this in
        // the snapshot, undoing a session that halved/reset/recovered
        // tempoRatchetK would leave that new rate standing even though the
        // session that caused it was itself undone.
        tempoRatchetK: prevEntry.tempoRatchetK ?? null,
        // Holding review count (Pass 61, lib/ladder.js) — same reasoning
        // again: without this in the snapshot, undoing a session that
        // incremented or reset holdingReviewCount would leave that new
        // count standing even though the session that caused it was
        // itself undone. `?? null`, not `?? 0` — same false-conflict fix
        // as the storage.js backfill (see that comment): a chunk that's
        // never touched Holding has no count to be "0" of, and writing a
        // materialized `0` here would resurface the same bug via undo
        // instead of via migration.
        holdingReviewCount: prevEntry.holdingReviewCount ?? null,
      };
      const sessions = [
        ...(prevEntry.sessions || []),
        { day, loggedAt, loggedDate, cleanReps, bpm, outcome, durationSeconds, ladderSnapshot },
      ];

      // practiceBPM is seeded from whatever the learner actually logs the
      // first time they touch a chunk — the USER-SELECTED starting tempo,
      // concept 2 of the three-concept split (see
      // lib/confidence.js's getSuggestedStartingBPM block comment,
      // docs/Algorithms.md). getSuggestedStartingBPM (concept 1) is
      // guidance only, surfaced to the learner in ChecklistItem's
      // first-encounter note — it never gets written here directly, so a
      // suggestion never silently becomes the real baseline without the
      // learner actually choosing it.
      const seededPracticeBPM = prevEntry.practiceBPM != null ? prevEntry.practiceBPM : bpm;

      // computeLadderAdvance's Holding-stage interval math (lib/ladder.js)
      // still reads an `effectiveness` tier ('low'/'good'/'high') to modulate
      // how fast the review gap grows — the reverse of confidence.js's
      // sessionOutcome() legacy-session fallback (fail<->low, pass<->high,
      // soft-miss<->good). Without this, effectiveness was always undefined,
      // the multiplier always landed on the neutral case (1x), and a
      // chunk's Holding interval could never grow past its 14-day starting
      // point even after repeated clean passes — a real bug, not the
      // intentionally-neutral placeholder an earlier version of this
      // comment described.
      const effectiveness = outcome === "fail" ? "low" : outcome === "pass" ? "high" : "good";

      const advance = computeLadderAdvance(
        {
          stage: prevEntry.stage,
          consecutivePasses: prevEntry.consecutivePasses,
          consecutiveStabilizingFails: prevEntry.consecutiveStabilizingFails,
          practiceBPM: seededPracticeBPM,
          targetBPM,
          tier1Done: prevEntry.tier1Done,
          needsRelearning: prevEntry.needsRelearning,
          suggestedStartingBPM,
          stabilizingEntryBPM: prevEntry.stabilizingEntryBPM,
          settlingEntryBPM: prevEntry.settlingEntryBPM,
          holdingEntryBPM: prevEntry.holdingEntryBPM,
          tempoRatchetK: prevEntry.tempoRatchetK,
          holdingReviewCount: prevEntry.holdingReviewCount,
        },
        { result: outcome, effectiveness, asOfDate: loggedDate, cleanReps, bpm },
        p.ladderConfig
      );

      progress[chunkId] = {
        ...prevEntry,
        doneDays,
        sessions,
        currentBPM: bpm,
        stage: advance.stage,
        consecutivePasses: advance.consecutivePasses,
        consecutiveStabilizingFails: advance.consecutiveStabilizingFails,
        practiceBPM: advance.practiceBPM,
        nextDueDate: advance.nextDueDate,
        tier1Done: advance.tier1Done,
        needsRelearning: advance.needsRelearning,
        stabilizingEntryBPM: advance.stabilizingEntryBPM,
        settlingEntryBPM: advance.settlingEntryBPM,
        holdingEntryBPM: advance.holdingEntryBPM,
        tempoRatchetK: advance.tempoRatchetK,
        holdingReviewCount: advance.holdingReviewCount,
        // A real logged session moves the ladder forward for real —
        // clears any pending flagSnapshot (see handleSetFlag below) so
        // later clearing a rough/lost flag can't discard this genuine
        // progress by reverting to the state from before the flag.
        flagSnapshot: undefined,
      };
      return { ...p, progress, lastLoggedAt: loggedDate };
    });
  };

  // Removes only the most recently logged session for `day`, not every
  // session that day — multiple sessions can now legitimately share a
  // plan-day (see handleLogSession above).
  //
  // Fully reverses the ladder state that session's outcome advanced
  // (stage/consecutivePasses/consecutiveStabilizingFails/practiceBPM/
  // nextDueDate/tier1Done) via the ladderSnapshot handleLogSession now
  // captures on every session — but ONLY when the session being undone is
  // this chunk's most recent session *overall* (not just the most recent
  // for `day`: restoring a snapshot rewinds to a moment in time, so
  // undoing an earlier session while a later one still stands would
  // silently erase that later session's effects too — the "genuinely hard
  // corner" docs/Decisions.md's "session undo should fully reverse the
  // ladder" entry scopes around). Outside that case — a non-latest
  // session, or a pre-migration session logged before ladderSnapshot
  // existed — falls back to removing the record only, same behavior as
  // before this pass: it does not guess or reconstruct what the ladder
  // state should be.
  //
  // A full reversal also undoes a rough/lost flag applied on top of this
  // session (see the flagSnapshot check below) — otherwise the flag would
  // outlive the ladder state it was based on.
  const handleUnlogSession = (chunkId, day) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId];
      if (!prevEntry) return p;
      const sessions = [...(prevEntry.sessions || [])];
      const lastIdx = sessions.map((s) => s.day).lastIndexOf(day);
      if (lastIdx === -1) return p;

      const isLatestSession = lastIdx === sessions.length - 1;
      const snapshot = sessions[lastIdx].ladderSnapshot;

      sessions.splice(lastIdx, 1);
      const stillHasDay = sessions.some((s) => s.day === day);
      const doneDays = stillHasDay ? prevEntry.doneDays : (prevEntry.doneDays || []).filter((d) => d !== day);

      let entry = { ...prevEntry, doneDays, sessions };
      if (isLatestSession && snapshot) {
        const isValidSnapshot =
          "stage" in snapshot &&
          "consecutivePasses" in snapshot &&
          "consecutiveStabilizingFails" in snapshot &&
          "practiceBPM" in snapshot &&
          "nextDueDate" in snapshot &&
          "tier1Done" in snapshot;
        if (isValidSnapshot) {
          entry = {
            ...entry,
            stage: snapshot.stage,
            consecutivePasses: snapshot.consecutivePasses,
            consecutiveStabilizingFails: snapshot.consecutiveStabilizingFails,
            practiceBPM: snapshot.practiceBPM,
            nextDueDate: snapshot.nextDueDate,
            tier1Done: snapshot.tier1Done,
            // needsRelearning was added to the snapshot shape in the same
            // pass that added the flag itself — an older snapshot (missing
            // the key entirely) predates the flag ever being settable, so
            // false is the correct restore, not a validity failure like
            // the six fields checked above.
            needsRelearning: "needsRelearning" in snapshot ? snapshot.needsRelearning : false,
            // currentBPM joined the snapshot shape after Pass 10 (see
            // handleLogSession above). Same backward-compatible treatment as
            // needsRelearning — optional, deliberately NOT part of the
            // isValidSnapshot check above, so sessions logged before this
            // existed keep undoing exactly as well as they did before rather
            // than all failing validation at once. But unlike
            // needsRelearning there's no correct constant to fall back to:
            // an older snapshot simply never recorded the pre-session tempo,
            // and reconstructing it from the remaining sessions would be a
            // guess (currentBPM can also be set by hand via handleUpdateBPM).
            // So an older snapshot leaves the field untouched — exactly
            // today's behavior — instead of inventing a value, same
            // "never reconstruct" rule the fallback branch below follows.
            ...("currentBPM" in snapshot ? { currentBPM: snapshot.currentBPM } : {}),
            // Per-stage tempo baselines (Pass 26 follow-up) — same
            // optional, not-part-of-isValidSnapshot treatment as
            // currentBPM directly above, and for the same reason: an
            // older snapshot never recorded them, and there's no correct
            // constant to invent in their place.
            ...("stabilizingEntryBPM" in snapshot ? { stabilizingEntryBPM: snapshot.stabilizingEntryBPM } : {}),
            ...("settlingEntryBPM" in snapshot ? { settlingEntryBPM: snapshot.settlingEntryBPM } : {}),
            ...("holdingEntryBPM" in snapshot ? { holdingEntryBPM: snapshot.holdingEntryBPM } : {}),
            // Tempo-ratchet adaptive rate (Pass 59) — same optional,
            // not-part-of-isValidSnapshot treatment as the entry-BPM
            // fields above: an older snapshot never recorded it, and
            // there's no correct constant to invent in its place.
            ...("tempoRatchetK" in snapshot ? { tempoRatchetK: snapshot.tempoRatchetK } : {}),
            // Holding review count (Pass 61) — same optional treatment: an
            // older snapshot never recorded it, and there's no correct
            // constant to invent in its place.
            ...("holdingReviewCount" in snapshot ? { holdingReviewCount: snapshot.holdingReviewCount } : {}),
          };
          // A rough/lost flag still carrying its flagSnapshot can only have
          // been applied AFTER this session, with nothing logged since —
          // handleLogSession unconditionally clears flagSnapshot on every
          // real session, so its mere presence here proves that ordering.
          // Undoing the session that predates the flag should undo the
          // flag too, not leave it pointing at a ladder state (and a
          // flagSnapshot restore point) that no longer exists. A flag with
          // no flagSnapshot predates this session (or survived a later
          // real log) and is left untouched, same as today.
          if (entry.flag && entry.flagSnapshot) {
            entry.flag = undefined;
            entry.flagSnapshot = undefined;
          }
        } else {
          console.warn(`handleUnlogSession: malformed ladderSnapshot for chunk ${chunkId}, falling back to record-only removal`, snapshot);
        }
      }
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  // Pass 91 (experimental v1) — focus spots (docs/Data-Model.md#focus-spots-v1).
  // A spot discovered on a chunk's own Daily Practice card (ChecklistItem's
  // "+ Add a focus spot"), so this handler only ever exists for a chunk
  // that's already introduced. fromSetup is hardcoded false here — see
  // lib/scheduling.js's focusSpotGate for why that matters (only a
  // fromSetup spot gates introduction; a spot added here must never
  // retroactively pull an already-scheduled chunk back off the plan). The
  // Wizard's own equivalent (FocusSpotsStep, Wizard.jsx) writes fromSetup:
  // true directly onto its local draft instead of going through this
  // handler, since the piece doesn't exist yet at that point for
  // updatePiece to target.
  const handleAddFocusSpot = (chunkId, { name, position, startMeasure, endMeasure }) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId] || { doneDays: [] };
      const spot = {
        id: newId("fs"),
        name,
        position: position || "",
        // Validated by the caller (ChecklistItem's add-spot form) before
        // this ever runs — see lib/utils.js's parseMeasurePosition. This is
        // what reassociateTroubleSpots (lib/chunking.js) matches against if
        // this piece's measures/chunking ever change later.
        startMeasure: typeof startMeasure === "number" ? startMeasure : null,
        endMeasure: typeof endMeasure === "number" ? endMeasure : null,
        length: null,
        fromSetup: false,
        resolved: false,
        resolvedBpm: null,
        resolvedAt: null,
        sessions: [],
      };
      progress[chunkId] = { ...prevEntry, troubleSpots: [...(prevEntry.troubleSpots || []), spot] };
      return { ...p, progress };
    });
  };

  // "Log time" on FocusSpotCard — records that time was spent without
  // claiming the spot is clean yet. Deliberately separate from
  // handleLogSession's chunk-level sessions array: a trouble-spot session is
  // not evidence of whole-chunk practice, so nothing here ever touches
  // piece.progress[chunkId].sessions or the chunk's own ladder state — only
  // this one spot's own nested sessions array.
  const handleLogFocusSpotTime = (chunkId, spotId, durationSeconds) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId];
      if (!prevEntry) return p;
      const loggedDate = todayISODate();
      const nextSpots = (prevEntry.troubleSpots || []).map((s) =>
        s.id === spotId
          ? { ...s, sessions: [...(s.sessions || []), { loggedAt: Date.now(), loggedDate, durationSeconds }] }
          : s
      );
      progress[chunkId] = { ...prevEntry, troubleSpots: nextSpots };
      return { ...p, progress, lastLoggedAt: loggedDate };
    });
  };

  // Undo for the checkbox on FocusSpotCard's own head row (same click-to-
  // undo pattern ChecklistItem's leading checkmark already uses) — clears
  // EVERY session logged today for this one spot, not just the most recent.
  // loggedToday (FocusSpotCard.jsx) is "does any session exist for today,"
  // so removing only the last one left the checkbox looking stuck checked
  // whenever a second time-log had already happened the same day (log some
  // time, come back later and log more — an entirely normal thing to do) —
  // one click looked like it did nothing. Removing every today-dated entry
  // makes the checkbox behave as an actual toggle: one click always fully
  // unchecks it, regardless of how many times time was logged today.
  const handleUnlogFocusSpotTime = (chunkId, spotId) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId];
      if (!prevEntry) return p;
      const today = todayISODate();
      const nextSpots = (prevEntry.troubleSpots || []).map((s) => {
        if (s.id !== spotId) return s;
        const sessions = s.sessions || [];
        if (!sessions.some((sess) => sess.loggedDate === today)) return s;
        return { ...s, sessions: sessions.filter((sess) => sess.loggedDate !== today) };
      });
      progress[chunkId] = { ...prevEntry, troubleSpots: nextSpots };
      return { ...p, progress };
    });
  };

  // "Achieved / Doable" on FocusSpotCard — the one gate the pass describes:
  // hitting this, with the BPM it was played cleanly at, both ends this
  // spot's own tracking and, once every spot on the chunk has cleared,
  // hands the whole chunk to the existing tempo-ladder machinery. That
  // handoff is a direct practiceBPM seed (the same "practiceBPM is seeded
  // from whatever the learner actually logs the first time they touch a
  // chunk" rule handleLogSession already uses above, just triggered by a
  // trouble-spot resolution instead of a first real session) — not a
  // computeLadderAdvance call, since no rep/pass-fail outcome is being
  // judged here, only a tempo. The chunk still starts at stage: null, same
  // as any other never-logged chunk; its very next *real* logged session is
  // what actually puts it on the ladder for the first time. Seeded as the
  // minimum resolvedBpm across every spot on the chunk — conservative, since
  // the chunk as a whole can only go as fast as its slowest cleared spot —
  // and only when practiceBPM isn't already set (a chunk this handler can
  // resolve the last spot on was, by construction, gated, so it should
  // never have one yet; guarded anyway rather than assumed).
  const handleResolveFocusSpot = (chunkId, spotId, bpm, durationSeconds = 0) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId];
      if (!prevEntry) return p;
      const loggedDate = todayISODate();
      const resolvedAt = Date.now();
      const nextSpots = (prevEntry.troubleSpots || []).map((s) =>
        s.id === spotId
          ? {
              ...s,
              resolved: true,
              resolvedBpm: bpm,
              resolvedAt,
              sessions: [...(s.sessions || []), { loggedAt: resolvedAt, loggedDate, durationSeconds }],
            }
          : s
      );
      const allResolved = nextSpots.length > 0 && nextSpots.every((s) => s.resolved);
      const seededPracticeBPM =
        allResolved && prevEntry.practiceBPM == null
          ? Math.min(...nextSpots.map((s) => s.resolvedBpm).filter((n) => typeof n === "number"))
          : prevEntry.practiceBPM;
      progress[chunkId] = { ...prevEntry, troubleSpots: nextSpots, practiceBPM: seededPracticeBPM };
      return { ...p, progress, lastLoggedAt: loggedDate };
    });
  };

  // Pass 97 — splits a base practice chunk (2+ measures) into two, from
  // Daily Practice's "Split a chunk" panel. No undo, so the confirm step is
  // the only safety net (matching the app's existing no-undo precedent,
  // difficulty reassessment) — built as a plain window.confirm, the same
  // pattern already used for "Mark as learned elsewhere," "End revival," and
  // leaving unlogged practice data.
  const handleSplitChunk = (chunkId) => {
    const chunk = chunkSet.practiceChunks.find((c) => c.id === chunkId);
    if (!canSplitChunk(chunk)) return;
    const splitMeasure = computeSplitMeasure(chunk);
    const rangeText = (s, e) => (s === e ? `${s}` : `${s}-${e}`);
    const ok = window.confirm(
      `Split mm. ${chunk.start}-${chunk.end} into ${rangeText(chunk.start, splitMeasure - 1)} and ${rangeText(splitMeasure, chunk.end)}?\n\nThis can't be undone.`
    );
    if (!ok) return;

    // Snapshotted from the pre-split piece/chunkSet/timeline — the same
    // "what's actually still untouched" computation every other
    // reschedule-marker constructor uses (see
    // docs/Algorithms.md#rescheduling). A structural edit would normally
    // null rescheduleMarker outright (handleSavePiece above); that would
    // discard real reschedule history, so a split instead re-snapshots it
    // fresh, same as a pacing-only Settings edit already does.
    const remainder = piece.rescheduleMarker ? computeRescheduleRemainder(piece, chunkSet, timeline) : null;

    updatePiece((p) => {
      const result = splitPracticeChunk(p, chunkId);
      if (!result) return p;
      const { chunkSplitPoints, progress, firstHalfId, secondHalfId } = result;
      const rescheduleMarker = remainder
        ? insertSplitHalfIntoMarkerChain(remainder.marker, firstHalfId, secondHalfId)
        : p.rescheduleMarker;
      return { ...p, chunkSplitPoints, progress, rescheduleMarker };
    });
  };

  // Pass 29 follow-up — resolves a provisional session (see handleLogSession
  // above) by finally running it through computeLadderAdvance, using the
  // real reps/BPM/outcome it already recorded. Operates on the most recent
  // session for `day` that still has `provisional: true` — not just the
  // most recent session overall, since a provisional record can sit
  // alongside other, already-resolved sessions on the same chunk/day (this
  // app already allows multiple sessions per plan-day). `targetBPM`/
  // `suggestedStartingBPM` are caller-resolved (ChecklistItem already
  // computes both), same convention handleLogSession itself uses, since
  // this handler only has a chunkId, not the chunk.
  //
  // Ladder math runs AS OF TODAY, not the original attempt's day — the
  // interval a confirmed soft-miss/fail schedules should count from when
  // the outcome was actually accepted, not backdated to a tentative
  // attempt that might have sat unresolved for a while. `doneDays` still
  // records the original attempt's plan-day, though: the practice really
  // did happen then, confirmation just resolves what it counted as.
  const handleConfirmProvisionalSession = (chunkId, day, { targetBPM, suggestedStartingBPM } = {}) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId];
      if (!prevEntry) return p;
      const sessions = [...(prevEntry.sessions || [])];
      const idx = sessions.map((s) => s.day === day && !!s.provisional).lastIndexOf(true);
      if (idx === -1) return p;
      const target = sessions[idx];
      const loggedDate = todayISODate();

      // Same six-plus-per-stage-BPM snapshot handleLogSession captures,
      // for the same reason: so undoing this confirmation later (via the
      // existing handleUnlogSession — it needs no changes to support this,
      // since it already restores from any session's ladderSnapshot) fully
      // reverses the ladder change confirming makes, not just the record.
      const ladderSnapshot = {
        stage: prevEntry.stage ?? null,
        consecutivePasses: prevEntry.consecutivePasses ?? 0,
        consecutiveStabilizingFails: prevEntry.consecutiveStabilizingFails ?? 0,
        practiceBPM: prevEntry.practiceBPM ?? null,
        nextDueDate: prevEntry.nextDueDate ?? null,
        tier1Done: prevEntry.tier1Done ?? false,
        needsRelearning: prevEntry.needsRelearning ?? false,
        currentBPM: prevEntry.currentBPM ?? null,
        stabilizingEntryBPM: prevEntry.stabilizingEntryBPM ?? null,
        settlingEntryBPM: prevEntry.settlingEntryBPM ?? null,
        holdingEntryBPM: prevEntry.holdingEntryBPM ?? null,
        tempoRatchetK: prevEntry.tempoRatchetK ?? null,
        // Same `?? null` fix as handleLogSession's snapshot above — not `?? 0`.
        holdingReviewCount: prevEntry.holdingReviewCount ?? null,
      };

      const seededPracticeBPM = prevEntry.practiceBPM != null ? prevEntry.practiceBPM : target.bpm;
      const effectiveness = target.outcome === "fail" ? "low" : target.outcome === "pass" ? "high" : "good";
      const advance = computeLadderAdvance(
        {
          stage: prevEntry.stage,
          consecutivePasses: prevEntry.consecutivePasses,
          consecutiveStabilizingFails: prevEntry.consecutiveStabilizingFails,
          practiceBPM: seededPracticeBPM,
          targetBPM,
          tier1Done: prevEntry.tier1Done,
          needsRelearning: prevEntry.needsRelearning,
          suggestedStartingBPM,
          stabilizingEntryBPM: prevEntry.stabilizingEntryBPM,
          settlingEntryBPM: prevEntry.settlingEntryBPM,
          holdingEntryBPM: prevEntry.holdingEntryBPM,
          tempoRatchetK: prevEntry.tempoRatchetK,
          holdingReviewCount: prevEntry.holdingReviewCount,
        },
        { result: target.outcome, effectiveness, asOfDate: loggedDate, cleanReps: target.cleanReps, bpm: target.bpm },
        p.ladderConfig
      );

      sessions[idx] = { ...target, provisional: false, ladderSnapshot };
      const doneDays = prevEntry.doneDays.includes(target.day) ? prevEntry.doneDays : [...prevEntry.doneDays, target.day];

      progress[chunkId] = {
        ...prevEntry,
        doneDays,
        sessions,
        currentBPM: target.bpm,
        stage: advance.stage,
        consecutivePasses: advance.consecutivePasses,
        consecutiveStabilizingFails: advance.consecutiveStabilizingFails,
        practiceBPM: advance.practiceBPM,
        nextDueDate: advance.nextDueDate,
        tier1Done: advance.tier1Done,
        needsRelearning: advance.needsRelearning,
        stabilizingEntryBPM: advance.stabilizingEntryBPM,
        settlingEntryBPM: advance.settlingEntryBPM,
        holdingEntryBPM: advance.holdingEntryBPM,
        tempoRatchetK: advance.tempoRatchetK,
        holdingReviewCount: advance.holdingReviewCount,
        flagSnapshot: undefined,
      };
      return { ...p, progress, lastLoggedAt: loggedDate };
    });
  };

  // Pass 29 follow-up — discards a provisional session outright, as if it
  // had never been logged. No ladder snapshot to restore: a provisional
  // session never advanced the ladder in the first place, so there is
  // nothing to reverse — just remove the record. This is also how a
  // learner "redoes" a rough interleaved attempt: discard, then log a
  // fresh one normally.
  const handleDiscardProvisionalSession = (chunkId, day) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId];
      if (!prevEntry) return p;
      const sessions = [...(prevEntry.sessions || [])];
      const idx = sessions.map((s) => s.day === day && !!s.provisional).lastIndexOf(true);
      if (idx === -1) return p;
      sessions.splice(idx, 1);
      progress[chunkId] = { ...prevEntry, sessions };
      return { ...p, progress };
    });
  };

  // User-directed follow-up: the one place the "leave Interleaved mode with
  // an unresolved provisional log" warning actually confirms and discards —
  // called both from TodayTab itself (its own Day View/Week View/All Tasks
  // buttons, via onConfirmLeaveInterleaved below) and from here in App.jsx
  // (the sidebar nav and the piece switcher, via guardLeavingInterleaved),
  // so the warning text and the discard behavior can't drift between the
  // two call sites. `chunkIds` may contain more than one id (several
  // chunks in the same rotation each left an unresolved attempt); each
  // gets discarded independently, same as if the learner had discarded
  // them one at a time from their own chunk cards.
  const confirmAndDiscardProvisional = (chunkIds, day) => {
    if (!chunkIds || chunkIds.length === 0) return true;
    const ok = window.confirm(
      "Practice data is tracked but not logged. Are you sure you want to leave before logging your progress?"
    );
    if (ok) chunkIds.forEach((id) => handleDiscardProvisionalSession(id, day));
    return ok;
  };

  // Gates navigation App.jsx itself controls (sidebar tabs, switching
  // pieces) — TodayTab reports the live risk via onInterleaveRiskChange
  // (setInterleaveRisk) since it's the only thing that knows whether
  // Interleaved mode is actually on screen right now. Returns true when
  // it's safe to proceed (nothing pending, or the learner confirmed).
  const guardLeavingInterleaved = () => {
    if (!interleaveRisk) return true;
    return confirmAndDiscardProvisional(interleaveRisk.chunkIds, interleaveRisk.day);
  };

  // Mirrors confirmAndDiscardProvisional's role above, for the assessment-
  // timer risk instead of a provisional session: the one place this
  // warning actually confirms, called both from PieceMapTab itself
  // (Previous/Next/Finish/Close, via onConfirmLeaveAssessmentTimer below)
  // and from here in App.jsx (via guardLeavingAssessmentTimer), so the
  // wording can't drift between the two call sites. Unlike a provisional
  // session, there's nothing to explicitly discard on confirm — the timer
  // is local React state inside PieceMapTab that simply disappears once
  // that component unmounts, so this only has to ask, never to clean up.
  const confirmLeavingAssessmentTimer = () => {
    return window.confirm(
      "This chunk's assessment timer hasn't been logged yet. Are you sure you want to leave before logging it?"
    );
  };

  // Same shape as guardLeavingInterleaved — reads the risk PieceMapTab
  // reported (assessmentTimerRisk) since App.jsx has no other way to know
  // whether a running/unlogged timer exists on a screen it doesn't own.
  const guardLeavingAssessmentTimer = () => {
    if (!assessmentTimerRisk) return true;
    return confirmLeavingAssessmentTimer();
  };

  // Single checkpoint for every kind of "you'll lose something if you
  // leave" risk this app currently tracks — every cross-tab/cross-piece
  // navigation gate below calls this instead of the two guards above
  // individually, so a gate point can't accidentally check one risk and
  // forget the other, and a third kind of risk (if one is ever added) only
  // needs wiring in here once rather than at every call site again. Short-
  // circuits on the first "no" — if either guard's confirm is declined,
  // the whole navigation is cancelled without asking about the other.
  const guardLeavingActiveWork = () => {
    if (!guardLeavingInterleaved()) return false;
    if (!guardLeavingAssessmentTimer()) return false;
    return true;
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

  // Piece-level twin of handleSetManualConfidence above (Pass 58) — a
  // direct field write, same escape-hatch shape, just piece.manualOverallConfidence
  // instead of a per-chunk progress entry. Not in ProgressTab.jsx's own
  // touched-file scope for this pass, but there's no way to build "a way to
  // set/clear the manual override inline" (the pass's own words) without a
  // write path, and every piece mutation in this app funnels through an
  // App.jsx-owned handler like this one — see CLAUDE.md's updatePiece rule.
  const handleSetManualOverallConfidence = (value) => {
    updatePiece((p) => ({ ...p, manualOverallConfidence: value }));
  };

  // Rule 2's manual half of needsRelearning's dual exit (the other half is
  // automatic: 4 consecutive full Stabilizing passes, handled inside
  // computeLadderAdvance itself — lib/ladder.js). Same escape-hatch shape
  // as handleSetManualConfidence above: a direct field write, no snapshot
  // to restore, since "resume normal review now" needs nothing reversed —
  // unlike handleSetFlag's rough/lost cycle, which undoes a demotion this
  // flag never separately applies (rule 3's demote-and-pin already
  // happened as part of the fail that set the flag, and stays whether or
  // not the flag itself is later cleared).
  //
  // Also resets consecutiveStabilizingFails to 0 — confirmed with the
  // user: clearing should put the chunk back where a single fail would
  // leave it, not one fail away from immediately re-flagging. Without
  // this, the streak that triggered the flag (already at 2) survives the
  // clear, so the very next fail (3) still reads as ">= 2" and re-flags
  // instantly — one fail after a manual "I've got this," not two. The
  // automatic exit doesn't need this: any real pass already resets the
  // streak to 0 on its own (computeLadderAdvance's pass branch, every
  // outcome), so by the time 4 of them graduate a chunk out, the streak
  // has long since been at 0 regardless of this handler.
  const handleClearRelearning = (chunkId) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const entry = progress[chunkId] ? { ...progress[chunkId] } : { doneDays: [] };
      entry.needsRelearning = false;
      entry.consecutiveStabilizingFails = 0;
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  // Replaces the old boolean-only handleSetWeakSpot: `flag` is
  // undefined | 'rough' | 'lost', cycled by PieceMapTab (untouched → rough
  // → lost → untouched). Landing on 'rough' or 'lost' also applies the
  // forced-demote-and-pin-due-date ladder operation (lib/ladder.js) — every
  // transition into one of those states is a fresh judgment call about
  // this run-through, so it reapplies each time, not just once.
  //
  // Clearing back to 'untouched' reverts stage/consecutivePasses/
  // nextDueDate to exactly what they were the moment the flag was first
  // set — undoes the schedule change the flag caused, rather than just
  // leaving the demotion in place. Captured once, in `flagSnapshot`, on
  // the untouched->rough transition only (not re-captured on rough->lost,
  // so it always reflects the state from *before any* flag in this
  // cycle). If a real session gets logged while flagged, handleLogSession
  // above clears the snapshot — so a subsequent "clear the flag" can't
  // discard genuinely-earned progress by reverting past it.
  //
  // Restore is guarded against a malformed/partial snapshot (missing one
  // of the three fields) rather than trusting it blindly — this is the
  // only place `flagSnapshot` is ever written today, but a future write
  // path with a different shape should not silently blank out a chunk's
  // stage/nextDueDate. On a bad shape, skip the restore (leave the
  // ladder state exactly where the flag's demotion last set it) and warn,
  // same "don't guess, say so" spirit as the stage check in
  // computeProgressTier (lib/confidence.js).
  const handleSetFlag = (chunkId, flag) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId] ? { ...progress[chunkId] } : { doneDays: [] };
      const entry = { ...prevEntry, flag };
      if (flag === "rough" || flag === "lost") {
        if (!prevEntry.flag) {
          entry.flagSnapshot = {
            stage: prevEntry.stage ?? null,
            consecutivePasses: prevEntry.consecutivePasses ?? 0,
            nextDueDate: prevEntry.nextDueDate ?? null,
          };
        }
        const advance = applyRunThroughFlag(
          { stage: prevEntry.stage, consecutivePasses: prevEntry.consecutivePasses },
          flag,
          todayISODate()
        );
        entry.stage = advance.stage;
        entry.consecutivePasses = advance.consecutivePasses;
        entry.nextDueDate = advance.nextDueDate;
      } else if (prevEntry.flagSnapshot) {
        const snap = prevEntry.flagSnapshot;
        const isValidSnapshot = snap && "stage" in snap && "consecutivePasses" in snap && "nextDueDate" in snap;
        if (isValidSnapshot) {
          entry.stage = snap.stage;
          entry.consecutivePasses = snap.consecutivePasses;
          entry.nextDueDate = snap.nextDueDate;
        } else {
          console.warn(`handleSetFlag: malformed flagSnapshot for chunk ${chunkId}, skipping restore (leaving current ladder state as-is)`, snap);
        }
        entry.flagSnapshot = undefined;
      }
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

  const handleSetPieceStatus = (status) => {
    updatePiece((p) => ({ ...p, status }));
  };

  const handleUpdateRevival = (patch) => {
    updatePiece((p) => ({ ...p, revival: { ...(p.revival || {}), ...patch } }));
  };

  // Pass 88 — Revival no longer has its own tab; a piece already in
  // revival routes to Today's Practice, which renders the reassessment
  // panel or the plan itself depending on revival.reassessmentComplete.
  const handleOpenRevival = () => {
    if (isInRevival(piece)) setActiveTab("today");
    else setRevivalModalOpen(true);
  };

  const handleStartRevival = ({ tempoLadderStartFraction, lastPlayedDate }) => {
    updatePiece((p) => ({
      ...p,
      lastPlayedDate: lastPlayedDate || p.lastPlayedDate || null,
      revival: {
        active: true,
        startedAt: Date.now(),
        // Pass 55 — dormant field, never collected anymore; hardcoded
        // rather than left undefined so every revival object has the same
        // shape regardless of how it was created (see Data-Model.md).
        purpose: null,
        tempoLadderStartFraction: tempoLadderStartFraction ?? 0.6,
        reassessmentComplete: false,
        plan: null,
      },
    }));
    setRevivalModalOpen(false);
    setActiveTab("today");
  };

  const closeRescheduleModal = () => {
    setRescheduleModalOpen(false);
    setRescheduleMessage("");
    setRescheduleTitle("");
    setRescheduleTargets([]);
    setRescheduleSuggestion(null);
  };

  // Writes every confirmed marker. Split deliberately in two: the active
  // piece goes through updatePiece like every other piece mutation in this
  // app (CLAUDE.md), and only the *other* pieces take the direct path —
  // which also has to persist them by hand, because the save effect above
  // only ever writes the active piece. Without that explicit save, a bulk
  // reschedule would look right on screen and be gone on reload.
  //
  // Those hand-written pieces are saved *before* the state update, and only
  // what actually saved gets applied. Order matters: showing a piece as
  // rescheduled when its write failed is the silent-revert-on-reload bug
  // this whole branch exists to avoid, just moved one step later.
  //
  // A failure is reported with an alert rather than the storage-error
  // banner, which cannot carry this particular message: the save effect
  // re-runs on this same state change and re-derives the banner purely from
  // the *active* piece's result, so a failure belonging to a different piece
  // would be cleared again within the same tick. (The banner still covers
  // the active piece, via that effect, exactly as before.)
  // A target's `extend` (single-piece flow never sets it; bulk sets it only
  // for a piece planRescheduleForPieces found already past its own target
  // date — lib/scheduling.js) carries { daysToLearn, targetDate }, with
  // targetDate omitted rather than written as null for a scheduleMode:
  // "minutes" piece — same "only include it when it's real" pattern
  // handleConfirmRescheduleWithExtension below already uses for the
  // single-piece case.
  const extendPatch = (extend) =>
    extend ? { daysToLearn: extend.daysToLearn, ...(extend.targetDate ? { targetDate: extend.targetDate } : {}) } : {};

  const handleConfirmReschedule = () => {
    if (!rescheduleTargets.length) return;

    const activeTarget = rescheduleTargets.find((t) => t.pieceId === activePieceId);
    if (activeTarget) {
      updatePiece((p) => ({ ...p, rescheduleMarker: activeTarget.marker, ...extendPatch(activeTarget.extend) }));
    }

    const saved = {};
    const failedNames = [];
    rescheduleTargets
      .filter((t) => t.pieceId !== activePieceId)
      .forEach(({ pieceId, marker, extend }) => {
        const current = pieces[pieceId];
        if (!current) return;
        // Pass 126 follow-up: through the same stamping updatePiece does, so a target date moved
        // here carries a dated note (lib/settingTimes.js, pieceWithChange). It used to carry none.
        const next = pieceWithChange(current, { rescheduleMarker: marker, ...extendPatch(extend) });
        if (writePieceDirect(pieceId, next).ok) saved[pieceId] = next;
        else failedNames.push(current.name || "Untitled piece");
      });

    if (Object.keys(saved).length) setPieces((prev) => ({ ...prev, ...saved }));

    // Pass 74: land back on real "today" — once rescheduled, there's
    // nothing incomplete left before today for a browsed past day to be
    // showing, and today is the natural place to be regardless. Same reset
    // onJumpToday already uses.
    setDayOverride(null);
    closeRescheduleModal();

    if (failedNames.length) {
      window.alert(
        `Couldn't save the new schedule for ${failedNames.join(", ")}. Your browser's storage is full or unavailable, so ${failedNames.length === 1 ? "that piece was left" : "those pieces were left"} exactly as before. Nothing was lost.\n\nExport a backup, then free up space (deleting an old piece works) and try again.`
      );
    }
  };

  // The other half of the "doesn't fit" choice for "days" mode (extend to a
  // suggested target date), and the *only* reschedule action offered at all
  // for "minutes" mode (there's no fixed deadline to protect there, so
  // extending the plan rather than cramming into what's left is the only
  // sensible option — see handleReschedule). Extends the plan to
  // rescheduleSuggestion's length first, then applies the same
  // rescheduleMarker against that now-larger window, in one updatePiece call
  // so the timeline recomputed off the new daysToLearn already has the
  // extra days available. Only ever reachable from the single-piece flow
  // (rescheduleSuggestion is null for "Reschedule all"), so there's exactly
  // one target and no "other pieces" branch to mirror from
  // handleConfirmReschedule. targetDate is only present (and only written)
  // for "days" mode — see handleReschedule; a "minutes" mode piece never
  // had one to begin with, so nothing here should invent one. Setting
  // daysToLearn alone would otherwise be silently undone on the next
  // reload for a "minutes" mode piece — see reconcileMinutesPerDaySchedule
  // (lib/scheduling.js) for the other half of that fix.
  const handleConfirmRescheduleWithExtension = () => {
    if (!rescheduleSuggestion || !rescheduleTargets.length) return;
    const activeTarget = rescheduleTargets.find((t) => t.pieceId === activePieceId);
    if (!activeTarget) return;
    updatePiece((p) => ({
      ...p,
      ...(rescheduleSuggestion.targetDate ? { targetDate: rescheduleSuggestion.targetDate } : {}),
      daysToLearn: rescheduleSuggestion.daysToLearn,
      rescheduleMarker: activeTarget.marker,
    }));
    // Pass 74: same "land back on today" reset as handleConfirmReschedule.
    setDayOverride(null);
    closeRescheduleModal();
  };

  const handleEndRevival = () => {
    // This button lives on the same screen the assessment timer runs on
    // (Revival's reassessment pass, rendered inside Today's Practice as of
    // Pass 88) — ending revival unmounts it exactly like a tab/piece switch
    // would, so it needs the same guard those get, checked before the "end
    // this cycle?" confirm below rather than after (declining because of
    // unlogged timer work shouldn't still prompt to end the cycle).
    if (!guardLeavingActiveWork()) return;
    if (!window.confirm("End this revival cycle? Weak-spot flags and confidence ratings stay, but the revival plan will be cleared.")) return;
    updatePiece((p) => ({
      ...p,
      revival: {
        active: false,
        startedAt: null,
        purpose: null,
        tempoLadderStartFraction: 0.6,
        reassessmentComplete: false,
        plan: null,
      },
    }));
    setActiveTab("overview");
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

  // `scrollTargetId` (optional) is Pass 96's addition — Piece Map's focus-
  // spot links are the only caller that passes one. Set unconditionally
  // (to null when omitted), not only when truthy, so this always clears
  // whatever an earlier focus-spot click left pending — every other
  // caller of this same onSelectDay prop (Timeline, Master Agenda,
  // Overview, Week view) has nothing to scroll to and shouldn't
  // accidentally inherit a stale target from a previous, unrelated click.
  const handleSelectDay = (dayNumber, scrollTargetId = null) => {
    setDayOverride(dayNumber);
    setActiveTab("today");
    setScrollToOnArrival(scrollTargetId);
  };

  const openRescheduleModal = (targets, title, message, suggestion = null) => {
    setRescheduleTargets(targets);
    setRescheduleTitle(title);
    setRescheduleMessage(message);
    setRescheduleSuggestion(suggestion);
    setRescheduleModalOpen(true);
  };

  // month/day only, no year — matches the estFinishDate display convention
  // ScheduleFields already uses for the same "derived finish date" idea.
  const formatDateReadable = (dateStr) =>
    new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const handleReschedule = () => {
    // Pass 74: fit estimation below is anchored to realCurrentDay, not
    // currentDay — currentDay is whatever day is currently being browsed
    // (Timeline/day-nav can set it to a past or future day via
    // dayOverride), and reschedule eligibility and fit estimation must be
    // measured against the real current day regardless of what's on
    // screen. Reported live as a marker anchored to a browsed past day
    // (e.g. day 19 while real-today was day 29) instead of today. The new
    // marker's own asOfDay is a separate concern, computed inside
    // computeRescheduleRemainder from elapsedDay(piece) directly — see its
    // comment for why that can't just reuse realCurrentDay either.
    // Pass 73 follow-up to Pass 65: a transition/combo's own logged status
    // was never checked directly anywhere in the reschedule mechanism —
    // computeEffectiveTimeline could only infer it indirectly from whether
    // a flanking/linked practice chunk was still untouched, so a connector
    // whose neighbors were BOTH already practiced was invisible to every
    // reschedule, forever, no matter how many times the piece was
    // rescheduled again (confirmed, reported precisely). computeRescheduleRemainder
    // checks the connector directly instead of guessing from its neighbors.
    const { remainingChunkIds, remainingConnectorIds, marker } = computeRescheduleRemainder(piece, chunkSet, timeline);
    if (!marker) {
      // Genuinely nothing to do: every practice chunk has been introduced
      // AND no connector is both untouched and overdue. isPlanActuallyComplete's
      // "days"-mode bar also covers transitions/combos (chunkSet.all), so
      // this can still correctly stay silent once the plan is truly done.
      if (!isPlanActuallyComplete(piece, chunkSet, timeline)) {
        window.alert(
          "Every practice chunk has already been introduced, so there's nothing left to reschedule. What's still open is a transition or focus block waiting to be logged; check \"All Tasks\" on Daily Practice to find it."
        );
      }
      return;
    }

    const { availableDays, requiredDays, fits } = estimateRescheduleFit(
      piece,
      practiceChunks,
      timeline,
      realCurrentDay,
      remainingChunkIds,
      [...chunkSet.transitions, ...chunkSet.combos],
      remainingConnectorIds
    );

    const dayWord = (n) => (n === 1 ? "day" : "days");
    const remainWord = (n) => (n === 1 ? "remains" : "remain");

    // Named per what's actually moving — a connector-only reschedule
    // (zero untouched practice chunks, one or more stuck transitions/focus
    // blocks) used to say "This will rebalance the 0 chunk(s)...", which
    // is both confusing and literally wrong about what's about to happen.
    const chunkCount = remainingChunkIds.length;
    const connectorCount = remainingConnectorIds.length;
    let message =
      chunkCount > 0 && connectorCount > 0
        ? `This will rebalance the ${chunkCount} chunk(s) and ${connectorCount} transition(s)/focus block(s) you haven't started yet across the days left in your plan. Everything you've already practiced stays where it is. Continue?`
        : chunkCount > 0
          ? `This will rebalance the ${chunkCount} chunk(s) you haven't started yet across the days left in your plan. Chunks you've already practiced stay where they are. Continue?`
          : `This will rebalance the ${connectorCount} transition(s)/focus block(s) you haven't started yet across the days left in your plan. Everything you've already practiced stays where it is. Continue?`;
    let suggestion = null;
    if (!fits) {
      // Extends the plan just far enough that requiredDays worth of days are
      // actually available *from today* — same requiredDays estimate above,
      // no separate calculation. Shared with planRescheduleForPieces' bulk
      // "already past its plan" extension (lib/scheduling.js) rather than a
      // second copy of this formula — anchored to the real, unclamped
      // elapsedDay rather than `currentDay` (which is clamped to the plan's
      // length once you're past it, via getCurrentDay): for a piece only
      // slightly behind the two are identical, but for one genuinely far
      // past its plan, sizing off the clamped value could still leave the
      // freshly-extended plan short of *today*, needing several more
      // reschedule clicks to actually catch up (confirmed in manual
      // testing: a piece 10 days past a 5-day plan took three successive
      // clicks to converge).
      const { daysToLearn: newDaysToLearn, targetDate: suggestedTargetDate } = computeReschedulePastPlanExtension(
        piece,
        elapsedDay(piece),
        requiredDays
      );
      if (piece.scheduleMode === "minutes") {
        // No target date to suggest changing — one was never set in this
        // mode (minutesPerDay is the fixed input, daysToLearn the derived
        // output; see ScheduleFields.jsx). There's also no "cram into the
        // tighter window" alternative worth offering: minutes-mode has no
        // calendar deadline to protect by staying tight, so extending the
        // plan is the only sensible reschedule here — a single action, not
        // a choice. targetDate stays null so the modal renders one button.
        suggestion = { targetDate: null, daysToLearn: newDaysToLearn };
        message = `Heads up: at your current pace (${formatMinutes(piece.minutesPerDay)}/day), what's left realistically needs about ${requiredDays} more ${dayWord(requiredDays)}, but only ${availableDays} ${dayWord(availableDays)} ${remainWord(availableDays)} in this plan.\n\nRescheduling will extend your plan to ${newDaysToLearn} days total, at the same pace, so everything fits. Continue?`;
      } else if (elapsedDay(piece) > timeline.days.length) {
        // The piece's target date has already fully passed — not just a
        // tight window, an actually-expired one. "Reschedule into current
        // plan days" packs everything onto what's effectively a single
        // already-past day (availableDays floors at 1 here); doing that
        // once is exactly what let a piece go permanently invisible to
        // "Reschedule all" later (found during Pass 39 follow-up
        // verification — see docs/Decisions.md#scheduling). There's no
        // real "current plan days" left to offer as an alternative, so
        // only the extend choice is offered — singleChoice tells the modal
        // to render one button instead of two.
        suggestion = { targetDate: suggestedTargetDate, daysToLearn: newDaysToLearn, singleChoice: true };
        message = `Heads up: at your current pace (${formatMinutes(piece.minutesPerDay)}/day), what's left realistically needs about ${requiredDays} more ${dayWord(requiredDays)}, and this piece's target date has already passed.\n\nRescheduling will move the target date to ${formatDateReadable(suggestedTargetDate)} to fit, at the same pace. Continue?`;
      } else {
        suggestion = { targetDate: suggestedTargetDate, daysToLearn: newDaysToLearn };
        message = `Heads up: at your current pace (${formatMinutes(piece.minutesPerDay)}/day), what's left realistically needs about ${requiredDays} more ${dayWord(requiredDays)}, but only ${availableDays} ${dayWord(availableDays)} ${remainWord(availableDays)} in this plan.\n\nWould you like to change the target date to ${formatDateReadable(suggestedTargetDate)}, or reschedule into the current remaining plan days?`;
      }
    }

    openRescheduleModal(
      [
        {
          pieceId: activePieceId,
          // `previous: piece.rescheduleMarker` chains onto this piece's last
          // reschedule (or null, its first) — see computeEffectiveTimeline
          // (lib/scheduling.js) for why a second reschedule needs that
          // chain instead of always re-deriving from the raw, never-
          // rescheduled schedule. Already baked into `marker` by
          // computeRescheduleRemainder above.
          marker,
        },
      ],
      "Reschedule remaining chunks?",
      message,
      suggestion
    );
  };

  // "Reschedule all" (Master Agenda) — the same operation, applied to every
  // active piece that's behind schedule right now, behind a single
  // confirmation that names them all.
  //
  // The bulk path deliberately doesn't repeat the single-piece dialog's full
  // pace warning per piece — five of those paragraphs stacked in one dialog
  // is a wall nobody reads. It does still have to *say* which pieces are in
  // that state, though: otherwise the convenient button would hand you less
  // information than doing the same thing one piece at a time, and the
  // "On schedule" the cards flip to afterwards would read as "you're fine
  // now" when the real situation is "this plan is now very tight". So: name
  // them, and point at the per-piece button for the detail.
  const handleRescheduleAll = () => {
    const plans = planRescheduleForPieces(pieces);
    // Master Agenda's "N pieces are behind schedule" panel now uses the
    // same wider, day-based "behind" signal its own per-piece badges use
    // (countBehindDays, not just missedCount) — see docs/Decisions.md#scheduling.
    // A piece can satisfy that wider signal purely from an unlogged
    // transition, combo, or review, with every practice chunk already
    // touched — planRescheduleForPieces can never include a piece like
    // that (there's no untouched practice-chunk material for it to move),
    // so without this, such a piece would just silently vanish from this
    // point on: counted in the panel above, then dropped with no
    // explanation once the button was actually clicked. findStuckBehindPieces
    // finds exactly that set, so it can be named and explained instead.
    const stuck = findStuckBehindPieces(pieces);
    const stuckNameOf = (s) => s.piece.name || "Untitled piece";

    if (!plans.length) {
      // Nothing this action can actually move, but the panel that offered
      // this button was showing for a reason — say what that reason is
      // instead of the button silently doing nothing, mirroring
      // handleReschedule's own single-piece alert for the identical
      // situation.
      if (stuck.length) {
        window.alert(
          `${stuck.length} piece${stuck.length === 1 ? " is" : "s are"} behind schedule (${stuck.map(stuckNameOf).join(", ")}), but ${stuck.length === 1 ? "it has" : "they have"} no unstarted material left to reschedule. What's stuck is a transition, focus block, or review waiting to be logged instead. Check "All Tasks" on ${stuck.length === 1 ? "its" : "each"} Daily Practice to find it.`
        );
      }
      return;
    }

    const nameOf = (p) => p.piece.name || "Untitled piece";
    const names = plans.map(nameOf).join(", ");
    const totalChunks = plans.reduce((s, p) => s + p.marker.remainingChunkOrder.length, 0);
    // A piece can now be included here purely via a stuck, overdue
    // connector (Pass 65/73) — without this, a bulk reschedule made up
    // entirely (or partly) of such pieces would say "This will rebalance
    // the 0 chunk(s)...", the exact wording bug already fixed for the
    // single-piece path but missed here at the time, since before that fix
    // this situation could never actually arise.
    const totalConnectors = plans.reduce((s, p) => s + p.marker.remainingConnectorIds.length, 0);
    // A piece already past its own target date gets an `extend` patch from
    // planRescheduleForPieces (Pass 39 follow-up) — its target date moves
    // as part of this action, so it no longer belongs in the "probably
    // won't fit" warning below, which is specifically about a piece that's
    // still inside its plan but running tight.
    const extending = plans.filter((p) => p.extend);
    const tight = plans.filter((p) => !p.fit.fits && !p.extend);

    const extendingNote = extending.length
      ? `\n\n${extending.length === 1 ? "" : `${extending.length} of these (`}${extending.map(nameOf).join(", ")}${extending.length === 1 ? " is" : ") are"} past ${extending.length === 1 ? "its" : "their"} target date entirely. Rescheduling will also push ${extending.length === 1 ? "its" : "their"} target date${extending.length === 1 ? "" : "s"} out to fit, at the same pace.`
      : "";

    const warning = tight.length
      ? `\n\nHeads up: at your current pace, ${tight.length === 1 ? "" : `${tight.length} of these (`}${tight.map(nameOf).join(", ")}${tight.length === 1 ? " probably won't" : ") probably won't"} fit in the days ${tight.length === 1 ? "its plan has" : "their plans have"} left. Rescheduling packs things in as tightly as possible either way; open ${tight.length === 1 ? "it" : "them"} individually for the details, or extend the timeline in Settings.`
      : "";

    // A piece counted in Master Agenda's summary above but excluded here
    // because it has nothing reschedulable — named explicitly so the
    // count this dialog is about to act on never silently diverges from
    // the count that panel just showed.
    const stuckNote = stuck.length
      ? `\n\n${stuck.length === 1 ? "" : `${stuck.length} more (`}${stuck.map(stuckNameOf).join(", ")}${stuck.length === 1 ? " is" : ") are"} also behind schedule but ${stuck.length === 1 ? "isn't" : "aren't"} included here, since ${stuck.length === 1 ? "it has" : "they have"} nothing unstarted left to reschedule. What's stuck ${stuck.length === 1 ? "there is" : "there are"} a transition, focus block, or review waiting to be logged instead. Check "All Tasks" on ${stuck.length === 1 ? "its" : "each of their"} Daily Practice.`
      : "";

    // Named per what's actually moving, same as the single-piece dialog —
    // a bulk reschedule can now be made up entirely of connector-only
    // pieces, so "chunk(s)" alone (or worse, "0 chunk(s)") would be wrong.
    const whatsMoving =
      totalChunks > 0 && totalConnectors > 0
        ? `${totalChunks} chunk(s) and ${totalConnectors} transition(s)/focus block(s)`
        : totalChunks > 0
          ? `${totalChunks} chunk(s)`
          : `${totalConnectors} transition(s)/focus block(s)`;
    const alreadyPracticedNote = totalConnectors > 0 ? "Everything you've already practiced stays where it is" : "Chunks you've already practiced stay where they are";

    const message =
      `${plans.length} piece${plans.length === 1 ? " is" : "s are"} behind schedule: ${names}.\n\n` +
      // "...and each piece keeps its own target date" only when that's
      // actually true for every piece here — dropped rather than stated
      // falsely whenever extendingNote is about to say otherwise for some
      // of them.
      `This will rebalance the ${whatsMoving} you haven't started yet across the days left in each piece's own plan. ${alreadyPracticedNote}${extending.length ? "" : ", and each piece keeps its own target date"}.` +
      `${extendingNote}${warning}${stuckNote}\n\nContinue?`;

    openRescheduleModal(
      plans.map(({ pieceId, marker, extend }) => ({ pieceId, marker, extend })),
      `Reschedule ${plans.length} piece${plans.length === 1 ? "" : "s"}?`,
      message
    );
  };

  // The list the switcher shows: the arrangement of the most recent reorder (the dated note a
  // drag leaves in the pieces it changes), the old rank order for anything it does not list.
  // lib/pieceMerge.js decides; two devices holding the same pieces show the same list.
  const pieceList = sortPiecesForSwitcher(Object.values(pieces));
  const pieceGroups = groupPiecesByWork(pieceList);
  const workParts = piece ? partsOfWork(pieceList, piece.workId) : [];

  // Reorders whole switcher rows (a standalone piece, or an entire
  // multi-movement work as one block) by moving the dragged row to the
  // dropped-on row's position and re-ranking every piece to the new
  // flattened order. Movement order *within* a work is untouched — that's
  // still governed by createdAt via groupPiecesByWork/partsOfWork
  // (lib/works.js), deliberately left alone per Pass 32a's build order
  // (works already stay contiguous in the switcher for free, without any
  // special-case logic here).
  const moveGroupTo = (fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= pieceGroups.length || toIndex >= pieceGroups.length) return;
    const reordered = [...pieceGroups];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    // What is written is decided in lib/pieceMerge.js (planSwitcherMove): the new ranks as
    // always, and, so that the most recent reorder wins on every device, a dated note of the
    // whole arrangement in the pieces that changed (and in none that did not).
    planSwitcherMove({
      ordered: reordered.flatMap((g) => g.pieces),
      movedIds: moved.pieces.map((p) => p.id),
      all: pieceList,
      now: Date.now(),
    }).forEach((u) => updatePiece((current) => ({ ...current, sortOrder: u.sortOrder, switcherOrder: u.switcherOrder }), u.id));
  };

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

      {(storageError || techniqueStorageError) && (
        <div className="storage-error-banner">
          <AlertTriangle size={18} />
          <div>
            <p className="storage-error-title">Your last change couldn't be saved</p>
            <p className="storage-error-sub">
              Browser storage is full or unavailable, so recent practice data may not be
              persisted. Export a backup now, then free up space (e.g. delete an old piece).
              This banner clears once a save succeeds again.
            </p>
          </div>
          <button className="ghost-btn" onClick={() => setExportModalOpen(true)}>
            Export backup
          </button>
        </div>
      )}

      {authSession && (syncInfo.held.pieces.length > 0 || syncInfo.held.technique) && (
        // The one case waiting won't fix (Pass 111): something in the account was
        // changed by another device, so this device's copy hasn't been uploaded
        // over it. Same look as the storage-error banner. Review (Pass 112) opens
        // the account flow for what's held, so the person can settle it. Ordinary
        // cases (waiting, retrying) never get a banner.
        <div className="storage-error-banner">
          <AlertTriangle size={18} />
          <div>
            <p className="storage-error-title">{describeHeldBanner(syncInfo.held).title}</p>
            <p className="storage-error-sub">{describeHeldBanner(syncInfo.held).sub}</p>
          </div>
          <button className="ghost-btn" onClick={() => openAccountFlow("review")} disabled={accountFlowBusy || backup.running}>
            Review
          </button>
        </div>
      )}

      {deletedBanner && (
        // Pass 122: a piece the account marks deleted on another device that is still here and
        // that nothing removes by itself (the automatic switch is off, or the deletion is older
        // than 30 days, or it was a combine's duplicate). One quiet banner; the Account panel
        // in Settings lists each one with the same two buttons.
        <div className="export-reminder-banner" role="status">
          <CloudDownload size={18} />
          <div>
            <p className="export-reminder-title">{deletedBanner.title}</p>
            <p className="export-reminder-sub">{deletedBanner.sub}</p>
          </div>
          {syncInfo.deletedElsewhere.length === 1 ? (
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexShrink: 0 }}>
              <button className="ghost-btn" onClick={() => handleDeleteHereToo(syncInfo.deletedElsewhere[0].id, { fromWindow: false })} disabled={accountFlowBusy || backup.running}>
                Delete it here too
              </button>
              <button className="ghost-btn" onClick={() => handleKeepDeleted(syncInfo.deletedElsewhere[0].id)} disabled={accountFlowBusy || backup.running}>
                Keep it
              </button>
            </div>
          ) : (
            <button className="ghost-btn" onClick={() => { if (guardLeavingActiveWork()) setActiveTab("settings"); }}>
              Open Settings
            </button>
          )}
        </div>
      )}

      {authSession && accountNotice && accountNotice.lines.length > 0 && !(piece && activeTab === "settings") && (
        // The last result of restoring, getting changes or reviewing, in the
        // page (the Account panel shows it itself on Settings). Dismissible.
        <div className={accountNotice.lines.some((l) => l.problem) ? "storage-error-banner" : "export-reminder-banner"} role="status">
          <CloudDownload size={18} />
          <div>
            {accountNotice.lines.map((line, i) => (
              <p key={i} className={i === 0 ? "export-reminder-title" : "export-reminder-sub"} style={line.problem ? { color: "var(--brick)" } : undefined}>
                {line.text}
              </p>
            ))}
          </div>
          <button className="export-reminder-dismiss" aria-label="Dismiss" onClick={() => setAccountNotice(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      {authSession && piece && pieceUpdatedNote === piece.id && (
        // Pass 120: only when an automatic update changed the piece that is OPEN.
        // One quiet line, dismissible; it goes when another piece is opened.
        <div className="export-reminder-banner" role="status">
          <CloudDownload size={18} />
          <div>
            <p className="export-reminder-title">{PIECE_UPDATED_NOTE}</p>
          </div>
          <button className="export-reminder-dismiss" aria-label="Dismiss" onClick={() => setPieceUpdatedNote(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      {exportReminderDue && !exportReminderDismissed && pieceList.length > 0 && (
        <div className="export-reminder-banner">
          <Download size={18} />
          <div>
            <p className="export-reminder-title">Back up your practice data</p>
            <p className="export-reminder-sub">
              MeasureOne only saves to this browser, and it's been a while since your last export.
              Download a backup so your plans and practice history aren't only in one place.
            </p>
          </div>
          <button className="ghost-btn" onClick={() => setExportModalOpen(true)}>
            Export backup
          </button>
          <button
            className="export-reminder-dismiss"
            aria-label="Dismiss reminder"
            onClick={() => setExportReminderDismissed(true)}
          >
            <X size={16} />
          </button>
        </div>
      )}

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
              {/* Signed in, and the account holds pieces (Pass 112): bring them onto
                  this device. Shown only once the count has come back. */}
              {authEnabled && authSession && welcomeAccountCount > 0 && (
                <button className="ghost-btn" style={{ marginTop: 16 }} onClick={() => openAccountFlow("restore")} disabled={accountFlowBusy}>
                  <CloudDownload size={14} /> {accountFlowBusy ? "Reading your account..." : describeRestoreButton(welcomeAccountCount)}
                </button>
              )}
              {/* Only when an account backend is configured (Pass 109): a new
                  device has no sidebar until a piece exists, so this is the way
                  in to sign-in there (docs/Accounts-and-Backend.md, Design I). */}
              {authEnabled && !authChecking && (
                authSession ? (
                  <p className="wizard-hint" style={{ margin: "18px 0 0" }}>
                    Signed in as {authSession.email}.{" "}
                    <button type="button" className="link-btn" onClick={handleSignOut}>Sign out</button>
                  </p>
                ) : (
                  <button type="button" className="link-btn" style={{ display: "block", marginTop: 18 }} onClick={openSignIn}>
                    Sign in
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="app-shell">
          <nav className="sidebar">
            <div className="brand"><BookOpen size={20} /><span>MeasureOne</span></div>

            <div className="piece-switcher">
              <button className="piece-switcher-trigger" onClick={() => setSwitcherOpen((o) => !o)}>
                <span className="piece-switcher-name">
                  {piece.name || "Untitled piece"}
                  <PieceStatusBadge status={piece.status} />
                </span>
                <ChevronDown size={14} className={switcherOpen ? "rotated" : ""} />
              </button>
              {switcherOpen && (
                <div
                  className="piece-switcher-list"
                  onDragOver={(e) => {
                    if (draggedGroupIndex !== null) listAutoScrollRef.current.update(e.currentTarget, e.clientY);
                  }}
                >
                  {pieceGroups.map((g, gi) => (
                    <div
                      key={g.workId || g.pieces[0].id}
                      className={[
                        g.workId ? "piece-switcher-work" : "",
                        draggedGroupIndex === gi ? "piece-switcher-dragging" : "",
                        dragOverGroupIndex === gi && draggedGroupIndex !== null && draggedGroupIndex !== gi ? "piece-switcher-drag-over" : "",
                      ].filter(Boolean).join(" ")}
                      onDragOver={(e) => {
                        if (draggedGroupIndex === null) return;
                        e.preventDefault();
                        if (dragOverGroupIndex !== gi) setDragOverGroupIndex(gi);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        listAutoScrollRef.current.stop();
                        if (draggedGroupIndex !== null) moveGroupTo(draggedGroupIndex, gi);
                        setDraggedGroupIndex(null);
                        setDragOverGroupIndex(null);
                      }}
                    >
                      <div className="piece-switcher-group-head">
                        <span
                          className="piece-switcher-drag-handle"
                          draggable
                          onDragStart={(e) => {
                            setDraggedGroupIndex(gi);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", String(gi));
                          }}
                          onDragEnd={() => {
                            listAutoScrollRef.current.stop();
                            setDraggedGroupIndex(null);
                            setDragOverGroupIndex(null);
                          }}
                          aria-label={`Drag to reorder ${g.workName || g.pieces[0].name || "piece"}`}
                        >
                          <GripVertical size={14} />
                        </span>
                        {g.workId ? (
                          <div className="piece-switcher-work-name">{g.workName}</div>
                        ) : (
                          <button
                            className={`piece-switcher-item ${g.pieces[0].id === activePieceId ? "active" : ""}`}
                            onClick={() => switchToPiece(g.pieces[0].id)}
                          >
                            {g.pieces[0].name || "Untitled piece"}
                            <PieceStatusBadge status={g.pieces[0].status} />
                          </button>
                        )}
                      </div>
                      {g.workId && g.pieces.map((p) => (
                        <button
                          key={p.id}
                          className={`piece-switcher-item ${p.id === activePieceId ? "active" : ""}`}
                          onClick={() => switchToPiece(p.id)}
                        >
                          {p.name || "Untitled movement"}
                          <PieceStatusBadge status={p.status} />
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="nav-list">
              {NAV_BASE.map((n) => {
                const Icon = n.icon;
                return (
                  <React.Fragment key={n.key}>
                    <button
                      className={`nav-item ${activeTab === n.key ? "active" : ""}`}
                      onClick={() => { if (guardLeavingActiveWork()) setActiveTab(n.key); }}
                    >
                      <Icon size={17} />
                      <span>{n.label}</span>
                    </button>
                    {n.key === "technique" && <div className="nav-divider" role="separator" />}
                  </React.Fragment>
                );
              })}
            </div>
            <div className="sidebar-foot">
              <button className="ghost-btn full" onClick={startEditing}>
                <Pencil size={14} /> Edit piece settings
              </button>
              <button className="ghost-btn full" onClick={() => openWizard()}>
                <Plus size={14} /> Add new piece
              </button>
            </div>
          </nav>

          <main className="main-content">
            {activeTab === "technique" && technique && (
              <TechniqueTab
                technique={technique}
                repertoireKeys={techniqueRepertoireKeys}
                onCheckOff={handleTechniqueCheckOff}
                onUncheck={handleTechniqueUncheck}
                onLogTempo={handleTechniqueLogTempo}
                onToggleStarItem={handleTechniqueToggleStarItem}
                onToggleRotation={handleTechniqueToggleRotation}
                onToggleStarMethod={handleTechniqueToggleStarMethod}
                onToggleMethod={handleTechniqueToggleMethod}
                onAddItem={handleTechniqueAddItem}
                onEditItem={handleTechniqueEditItem}
                onChangeCheckOctaves={handleTechniqueChangeCheckOctaves}
                onAddMethod={handleTechniqueAddMethod}
              />
            )}
            {activeTab === "overview" && (
              <OverviewTab
                piece={piece}
                practiceChunks={practiceChunks}
                chunks={chunks}
                chunkSet={chunkSet}
                timeline={timeline}
                currentDay={currentDay}
                realCurrentDay={realCurrentDay}
                onReschedule={handleReschedule}
                onAddPiece={() => openWizard()}
                onStartRevival={handleOpenRevival}
                onPausePiece={() => handleSetPieceStatus("paused")}
                workParts={workParts}
                onSelectPart={switchToPiece}
                onAddPart={handleAddPart}
                onSelectDay={handleSelectDay}
              />
            )}
            {activeTab === "master-agenda" && (
              <MasterAgendaTab
                pieces={pieces}
                onSelectPiece={switchToPiece}
                onSelectPieceToday={(id) => switchToPiece(id, "today")}
                onSelectDay={handleSelectDay}
                onRescheduleAll={handleRescheduleAll}
                technique={technique}
                techniqueRepertoireKeys={techniqueRepertoireKeys}
                techniqueHandlers={techniquePanelHandlers}
              />
            )}
            {activeTab === "timeline" && (
              <TimelineTab
                chunks={chunks}
                chunkSet={chunkSet}
                timeline={timeline}
                piece={piece}
                currentDay={currentDay}
                realCurrentDay={realCurrentDay}
                onSelectDay={handleSelectDay}
                onReschedule={handleReschedule}
              />
            )}
            {activeTab === "map" && (
              <PieceMapTab
                piece={piece}
                chunks={chunks}
                currentDay={currentDay}
                timeline={timeline}
                realCurrentDay={realCurrentDay}
                onSelectDay={handleSelectDay}
                onUpdateBPM={handleUpdateBPM}
                onSetManualConfidence={handleSetManualConfidence}
                onSetFlag={handleSetFlag}
                onSetMemoryAnchor={handleSetMemoryAnchor}
                onClearRelearning={handleClearRelearning}
              />
            )}
            {activeTab === "today" && (
              <TodayTab
                piece={piece}
                chunks={chunks}
                chunkSet={chunkSet}
                timeline={timeline}
                currentDay={currentDay}
                realCurrentDay={realCurrentDay}
                isRealToday={currentDay === realCurrentDay}
                technique={technique}
                techniqueRepertoireKeys={techniqueRepertoireKeys}
                techniqueHandlers={techniquePanelHandlers}
                onDayChange={(d) => setDayOverride(clamp(d, 1, timeline.days.length))}
                onJumpToday={() => setDayOverride(null)}
                onLogSession={handleLogSession}
                onUnlogSession={handleUnlogSession}
                onConfirmProvisionalSession={handleConfirmProvisionalSession}
                onDiscardProvisionalSession={handleDiscardProvisionalSession}
                onLogRunThrough={handleLogRunThrough}
                onUnlogRunThrough={handleUnlogRunThrough}
                onLogColdStart={handleLogColdStart}
                onUnlogColdStart={handleUnlogColdStart}
                onSetOverallConfidence={handleSetManualOverallConfidence}
                onReschedule={handleReschedule}
                onReassessRange={handleReassessRange}
                onSetMemoryAnchor={handleSetMemoryAnchor}
                onInterleaveRiskChange={setInterleaveRisk}
                onConfirmLeaveInterleaved={confirmAndDiscardProvisional}
                onUpdateBPM={handleUpdateBPM}
                onSetManualConfidence={handleSetManualConfidence}
                onFinishReassessment={() =>
                  handleUpdateRevival({ reassessmentComplete: true, plan: computeRevivalPlan(piece, chunkSet, currentDay) })
                }
                onReopenReassessment={() => handleUpdateRevival({ reassessmentComplete: false })}
                onEndRevival={handleEndRevival}
                onAssessmentTimerRiskChange={setAssessmentTimerRisk}
                onConfirmLeaveAssessmentTimer={confirmLeavingAssessmentTimer}
                onAddFocusSpot={handleAddFocusSpot}
                onLogFocusSpotTime={handleLogFocusSpotTime}
                onUnlogFocusSpotTime={handleUnlogFocusSpotTime}
                onResolveFocusSpot={handleResolveFocusSpot}
                onSplitChunk={handleSplitChunk}
              />
            )}
            {activeTab === "progress" && (
              <ProgressTab
                piece={piece}
                chunks={chunks}
                timeline={timeline}
                currentDay={currentDay}
                onViewAllPieces={() => setActiveTab("all-pieces")}
                onSetOverallConfidence={handleSetManualOverallConfidence}
              />
            )}
            {/* Not in NAV_BASE — reached only via the button on Progress,
                same "button-only tab" pattern as "revival" below (not part
                of the persistent sidebar). See docs/Architecture.md. */}
            {activeTab === "all-pieces" && (
              <AllPiecesTab
                pieces={pieceList}
                onSelectPiece={switchToPiece}
                currentPieceId={piece.id}
                currentPieceName={piece.name}
              />
            )}
            {activeTab === "settings" && (
              <SettingsTab
                piece={piece}
                chunkSet={chunkSet}
                timeline={timeline}
                editDraft={editDraft}
                setEditDraft={setEditDraft}
                onSave={handleSavePiece}
                onDelete={() => setDeleteModalOpen(true)}
                editing={settingsEditing}
                onStartEdit={startEditing}
                onDiscard={handleDiscardEdit}
                onAddPiece={() => openWizard()}
                onExportClick={handleExportClick}
                onImportClick={handleImportClick}
                onSetStatus={handleSetPieceStatus}
                authEnabled={authEnabled}
                authChecking={authChecking}
                authEmail={authSession ? authSession.email : null}
                onSignIn={openSignIn}
                onSignOut={handleSignOut}
                onBackUp={handleBackUpDevice}
                backupAskText={backupAsking && authSession ? backupQuestion(Object.keys(pieces).length, authSession.email) : null}
                onConfirmBackUp={handleConfirmBackUp}
                onCancelBackUp={handleCancelBackUp}
                syncActive={syncInfo.firstBackupDone}
                syncRunning={syncInfo.running}
                syncStatus={authSession ? describeSyncStatus({ now: syncClock, ...syncInfo, offline: browserOffline }) : null}
                accountChangesText={authSession ? describeAccountChanges(syncInfo.changes) : null}
                backupRunning={backup.running}
                backupLines={authSession && backup.userId === authSession.userId && backup.result ? describeBackupResult(backup.result) : []}
                backupCheckedAt={authSession && backup.userId === authSession.userId && backup.result && backup.result.status === "done" ? backup.finishedAt : null}
                onGetChanges={() => openAccountFlow("changes")}
                onReviewHeld={() => openAccountFlow("review")}
                heldCount={authSession ? syncInfo.held.pieces.length + (syncInfo.held.technique ? 1 : 0) : 0}
                accountBusy={accountFlowBusy}
                accountNotice={authSession ? accountNotice : null}
                onDismissAccountNotice={() => setAccountNotice(null)}
                autoUpdate={autoUpdate}
                onSetAutoUpdate={handleSetAutoUpdate}
                autoUpdateNotice={authSession && autoNotice ? autoNotice.text : null}
                onDismissAutoUpdateNotice={() => setAutoNotice(null)}
                autoPendingText={authSession && autoUpdate ? describeAutoPending(autoPending) : null}
                deletedElsewhere={authSession ? syncInfo.deletedElsewhere : []}
                onKeepDeleted={handleKeepDeleted}
                onDeleteDeletedHere={(id) => handleDeleteHereToo(id, { fromWindow: false })}
                onOpenRecentlyDeleted={handleOpenRecentlyDeleted}
                declinedSummary={syncInfo.declined}
                onAskMeAgain={handleAskMeAgain}
                onChangePassword={openChangePassword}
                signOutAllAsking={signOutAllAsking && !!authSession}
                onAskSignOutAll={() => setSignOutAllAsking(true)}
                onConfirmSignOutAll={handleSignOutAll}
                onCancelSignOutAll={() => setSignOutAllAsking(false)}
                signOutAllBusy={signOutAllBusy}
                signOutNotice={signOutNotice}
                onDismissSignOutNotice={() => setSignOutNotice(null)}
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
      {authEnabled && signInOpen && (
        <SignInModal notice={signInNotice} onClose={() => { setSignInOpen(false); setSignInNotice(""); }} />
      )}
      {authEnabled && choosePasswordMode && (
        <ChoosePasswordModal
          mode={choosePasswordMode}
          onClose={() => setChoosePasswordMode(null)}
          onSignInAgain={handleSignInAgainToChangePassword}
        />
      )}
      {deleteModalOpen && piece && (
        <DeletePieceModal
          piece={piece}
          syncsToAccount={authEnabled && !!authSession && syncInfo.firstBackupDone}
          onCancel={() => setDeleteModalOpen(false)}
          onConfirm={handleDeletePiece}
        />
      )}
      {exportModalOpen && (
        <ExportPiecesModal
          pieceGroups={pieceGroups}
          techniqueItemCount={technique?.items.length || 0}
          onCancel={() => setExportModalOpen(false)}
          onExport={handleConfirmExport}
        />
      )}
      {importCandidates && (
        <ImportPiecesModal
          candidates={importCandidates}
          existingPieces={pieces}
          techniqueCandidate={importTechnique}
          techniqueUnreadable={importTechniqueInfo.unreadable}
          techniqueSkippedItems={importTechniqueInfo.skippedItems}
          existingTechnique={technique}
          onCancel={closeImportModal}
          onImport={importSource === "account" ? handleConfirmAccountImport : handleConfirmImport}
          source={importSource}
          mode={importAccount ? importAccount.mode : "changes"}
          rowMeta={importAccount ? importAccount.rowMeta : null}
          deletedElsewhere={importAccount ? importAccount.deletedElsewhere : []}
          onDeleteHere={handleDeleteHereToo}
          onKeepHere={handleKeepDeleted}
          unreadableCount={importAccount ? importAccount.unreadable : 0}
        />
      )}
      {authEnabled && authSession && recentlyDeleted && (
        <RecentlyDeletedModal state={recentlyDeleted} busy={accountFlowBusy} onRestore={handleRestoreDeleted} onClose={handleCloseRecentlyDeleted} />
      )}
      {settleFlow && settleItem && settleCurrent && (
        <SettleConflictModal
          pieceName={settleItem.name}
          pieceNumber={settleFlow.index + 1}
          pieceCount={settleFlow.items.length}
          view={settleCurrent}
          busy={accountFlowBusy}
          onAnswer={handleSettleAnswer}
          onBack={handleSettleBack}
          onNext={handleSettleNext}
          onDecideLater={handleSettleDecideLater}
          onClose={handleSettleClose}
        />
      )}
      {rescheduleModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="modal-head">
              <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19, margin: 0 }}>
                {rescheduleTitle || "Reschedule remaining chunks?"}
              </h2>
              <button className="icon-btn" onClick={closeRescheduleModal} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              {/* pre-line, not the default collapse: both messages use a
                  blank line to separate the explanation from the actual
                  question, and the bulk one lists the pieces above it. */}
              <p style={{ fontSize: 14, lineHeight: 1.5, margin: 0, whiteSpace: "pre-line" }}>{rescheduleMessage}</p>
            </div>
            <div className="modal-foot">
              <button className="ghost-btn" onClick={closeRescheduleModal}>
                Cancel
              </button>
              {!rescheduleSuggestion ? (
                <button className="primary-btn" onClick={handleConfirmReschedule}>
                  Reschedule
                </button>
              ) : !rescheduleSuggestion.targetDate ? (
                // scheduleMode: "minutes" — no target date to reference at
                // all, extending is the only action either way.
                <button className="primary-btn" onClick={handleConfirmRescheduleWithExtension}>
                  Reschedule
                </button>
              ) : rescheduleSuggestion.singleChoice ? (
                // scheduleMode: "days", but the target date has already
                // fully passed — "reschedule into current plan days" isn't
                // a real alternative here (see the comment where this is
                // set), so only the extend button shows.
                <>
                  <button
                    className="ghost-btn"
                    onClick={() => {
                      closeRescheduleModal();
                      startEditing();
                      setFocusTargetDateOnSettings(true);
                    }}
                  >
                    Set new target date
                  </button>
                  <button className="primary-btn" onClick={handleConfirmRescheduleWithExtension}>
                    Change target date to {formatDateReadable(rescheduleSuggestion.targetDate)}
                  </button>
                </>
              ) : (
                <>
                  <button className="ghost-btn" onClick={handleConfirmReschedule}>
                    Reschedule into current plan days
                  </button>
                  <button
                    className="ghost-btn"
                    onClick={() => {
                      closeRescheduleModal();
                      startEditing();
                      setFocusTargetDateOnSettings(true);
                    }}
                  >
                    Set new target date
                  </button>
                  <button className="primary-btn" onClick={handleConfirmRescheduleWithExtension}>
                    Change target date to {formatDateReadable(rescheduleSuggestion.targetDate)}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

/* Inter and Fraunces have no ♯ or ♭, so the browser borrowed a system
   font whose ♭ sits in a full-width box with a wide blank left side — "E♭"
   read as "E ♭" in piece names, placeholders and headings. Naming
   Helvetica Neue (Mac) / Segoe UI Symbol (Windows) right after them makes
   the browser draw just those symbols snugly; every other character is
   still Inter/Fraunces. IBM Plex Mono has its own ♯/♭ at its fixed width,
   so .mono is deliberately left as is (a fallback there would break
   column alignment). */
.measureone-app {
  --paper: #EEF0EC;
  --paper-card: #F8F9F6;
  --ink: #202A33;
  --ink-soft: #57646F;
  --ink-faint: #8B96A0;
  --line: rgba(32,42,51,0.14);
  --accent: #2F5D9A;
  --accent-deep: #214775;
  --warm: #B98A3E;
  --teal: #2E6E63;
  --brick: #B5473A;
  --white: #FFFFFF;
  font-family: 'Inter', 'Helvetica Neue', 'Segoe UI Symbol', sans-serif;
  color: var(--ink);
  background: var(--paper);
  min-height: 100%;
  width: 100%;
  box-sizing: border-box;
}
.measureone-app *, .measureone-app *::before, .measureone-app *::after { box-sizing: border-box; }
.measureone-app h1, .measureone-app h2, .measureone-app h3 {
  font-family: 'Fraunces', 'Helvetica Neue', 'Segoe UI Symbol', serif; font-weight: 600; margin: 0; color: var(--ink);
}
.measureone-app .mono { font-family: 'IBM Plex Mono', monospace; }
.measureone-app button { font-family: inherit; cursor: pointer; }
.measureone-app input { font-family: inherit; }
.measureone-app :focus-visible { outline: 2px solid var(--accent-deep); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .measureone-app * { transition: none !important; animation: none !important; }
}

.app-shell { display: flex; min-height: 100vh; }
.sidebar {
  width: 232px; flex-shrink: 0; background: var(--paper-card); border-right: 1px solid var(--line);
  display: flex; flex-direction: column; padding: 20px 14px; position: sticky; top: 0; height: 100vh;
}
.brand { display: flex; align-items: center; gap: 8px; padding: 6px 10px 20px; font-family: 'Fraunces', 'Helvetica Neue', 'Segoe UI Symbol', serif; font-weight: 600; font-size: 18px; color: var(--accent-deep); }
.nav-list { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; border: none;
  background: transparent; color: var(--ink-soft); font-size: 14px; font-weight: 500; text-align: left;
  width: 100%; transition: background .15s, color .15s;
}
.nav-item span { flex: 1; }
.nav-item:hover { background: rgba(47,93,154,0.1); color: var(--ink); }
.nav-item.active { background: var(--accent); color: var(--white); }
.sidebar-foot { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px solid var(--line); margin-top: 8px; }

.piece-switcher { position: relative; }
.piece-switcher-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--white); font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 10px; }
.piece-switcher-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.piece-switcher-trigger svg.rotated { transform: rotate(180deg); }
.piece-switcher-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; padding: 6px; background: var(--white); border: 1px solid var(--line); border-radius: 8px; max-height: 240px; overflow-y: auto; }
.piece-switcher-item { text-align: left; padding: 8px 10px; border-radius: 6px; border: none; background: transparent; font-size: 13px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.piece-switcher-item:hover { background: rgba(47,93,154,0.08); }
.piece-switcher-item.active { background: var(--accent); color: var(--white); font-weight: 600; }
.piece-switcher-work { display: flex; flex-direction: column; gap: 2px; }
.piece-switcher-work-name { font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-faint); font-weight: 700; padding: 6px 0 1px 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.piece-switcher-work .piece-switcher-item { margin-left: 8px; }
.piece-switcher-group-head { display: flex; align-items: center; gap: 2px; }
.piece-switcher-group-head .piece-switcher-item { flex: 1; min-width: 0; }
.piece-switcher-drag-handle { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; flex-shrink: 0; margin-left: 2px; color: var(--ink-faint); cursor: grab; border-radius: 4px; }
.piece-switcher-drag-handle:hover { background: rgba(47,93,154,0.12); color: var(--ink-soft); }
.piece-switcher-drag-handle:active { cursor: grabbing; }
.piece-switcher-dragging { opacity: 0.4; }
.piece-switcher-drag-over { box-shadow: inset 0 2px 0 var(--accent); }
.part-list { display: flex; flex-wrap: wrap; gap: 8px; }
.part-chip { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--white); font-size: 13px; color: var(--ink-soft); font-weight: 600; }
.part-chip:hover { border-color: var(--accent); color: var(--ink); }
.part-chip.active { background: var(--accent); border-color: var(--accent); color: var(--white); }
.part-chip.active .badge { background: rgba(255,255,255,0.3); color: inherit; }
.part-chip-idx { font-size: 11px; opacity: 0.7; }
.part-chip-pct { font-size: 11.5px; opacity: 0.8; }
.part-chip.add { color: var(--accent-deep); border-style: dashed; }

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

.eyebrow { font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; color: var(--accent-deep); margin: 0 0 6px; font-weight: 600; }

.hero-card { background: var(--paper-card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.hero-doodle-band { padding: 14px 24px 0; background: linear-gradient(180deg, rgba(47,93,154,0.07), rgba(47,93,154,0)); }
.manuscript-doodle { width: 100%; height: 64px; display: block; opacity: 0.16; }
.hero-content { padding: 6px 32px 32px; }
.hero-content h1 { font-size: clamp(22px, 3vw, 30px); line-height: 1.2; }
.hero-content h1 .badge { font-size: 11px; vertical-align: middle; margin-left: 10px; }
.status-note { background: var(--paper); }
.hero-sub { color: var(--ink-soft); font-size: 14px; margin-top: 8px; }
.hero-composer { color: var(--ink-soft); font-size: 15px; font-style: italic; margin-top: 2px; }

.manuscript-strip { display: flex; height: 46px; border-radius: 8px; margin: 20px 0 4px; border: 1px solid var(--line); position: relative; }
.manuscript-strip.compact { height: 28px; }
.manuscript-block { position: relative; border-right: 2px solid var(--paper); min-width: 3px; }
.manuscript-block:first-child { border-top-left-radius: 7px; border-bottom-left-radius: 7px; }
.recurring-dot { position: absolute; top: 2px; left: 50%; transform: translateX(-50%); font-size: 11px; line-height: 1; color: rgba(255,255,255,0.85); }
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
.stat-num { font-size: 24px; font-weight: 600; color: var(--accent-deep); }
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
.day-preview-row.clickable { width: 100%; background: none; border: none; border-bottom: 1px solid var(--line); font: inherit; color: inherit; text-align: left; cursor: pointer; }
.day-preview-row.clickable:last-child { border-bottom: none; }
.day-preview-row.clickable:hover .day-desc { color: var(--accent-deep); }
.day-num { min-width: 56px; white-space: nowrap; color: var(--accent-deep); flex-shrink: 0; }
.day-desc { flex: 1; color: var(--ink-soft); }
.day-min { color: var(--ink-faint); flex-shrink: 0; }
.all-pieces-col { width: 90px; flex-shrink: 0; color: var(--ink-faint); }
.all-pieces-head { color: var(--ink-faint); font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }

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
.day-card.clickable:hover { border-color: var(--accent); }
.day-card.consolidation { background: rgba(47,93,154,0.08); }
.day-card.rest { background: var(--paper); }
.day-card.rest .day-card-min { color: var(--ink-faint); }
.day-card.day-past { opacity: 0.55; }
.day-card-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink-soft); margin-bottom: 8px; }
.day-card-day { display: inline-flex; align-items: center; gap: 4px; }
.day-card-check { color: var(--ink-faint); opacity: 0.7; }
.day-card-min { color: var(--accent-deep); }
.day-card-note { font-size: 12.5px; color: var(--ink-soft); margin: 0; }
.day-card-group { margin-bottom: 6px; }
.day-card-tag { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); margin-bottom: 4px; }
.day-card-tag.special { color: var(--accent-deep); }
.chip { display: inline-block; font-size: 11.5px; font-family: 'IBM Plex Mono', monospace; background: var(--teal); color: var(--white); padding: 2px 7px; border-radius: 5px; margin: 0 4px 4px 0; }
.chip.subtle { background: transparent; border: 1px solid var(--line); color: var(--ink-soft); }
.chip.transition { background: var(--accent); }

.diff-grid-wrap { border: 1px solid var(--line); border-radius: 10px; padding: 10px; max-height: 300px; overflow-y: auto; background: var(--white); }
.diff-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(30px, 1fr)); gap: 4px; }
.diff-cell { aspect-ratio: 1; border: none; border-radius: 4px; font-size: 9px; font-family: 'IBM Plex Mono', monospace; color: var(--white); }
.diff-cell.diff-1 { background: var(--teal); }
.diff-cell.diff-2 { background: var(--accent); }
.diff-cell.diff-3 { background: var(--brick); }
.diff-cell:hover { filter: brightness(1.1); }

.badge { display: inline-block; font-size: 9.5px; background: rgba(255,255,255,0.25); padding: 1px 6px; border-radius: 20px; margin-left: 6px; vertical-align: middle; text-transform: uppercase; letter-spacing: 0.03em; }
.badge.dark { background: rgba(47,93,154,0.18); color: var(--accent-deep); }
.badge.paused { background: rgba(47,93,154,0.18); color: var(--accent-deep); }
.badge.archived { background: rgba(139,150,160,0.22); color: var(--ink-faint); }
.piece-switcher-item.active .badge { background: rgba(255,255,255,0.3); color: inherit; }
.manual-mark { margin-left: 4px; vertical-align: middle; opacity: 0.6; }
.climbing-mark { margin-left: 4px; vertical-align: middle; color: var(--teal); }
.manual-conf-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.manual-conf-row input { width: 80px; flex-shrink: 0; }
.derived-stat { font-size: 13px; color: var(--ink-soft); margin: 4px 0 0; }
.derived-stat strong { color: var(--accent-deep); }

.schedule-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; background: rgba(181,71,58,0.08); border: 1px solid rgba(181,71,58,0.3); border-radius: 14px; padding: 16px 20px; }
.schedule-banner-title { font-family: 'Fraunces', 'Helvetica Neue', 'Segoe UI Symbol', serif; font-weight: 600; font-size: 15px; margin: 0 0 4px; color: var(--brick); }
.schedule-banner-sub { font-size: 12.5px; color: var(--ink-soft); margin: 0; max-width: 480px; }
.schedule-banner-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* Non-blocking heads-up, not an alarm — amber rather than schedule-banner's
   brick red, since this never requires action (proceeding as-is is always
   fine, see ScheduleFields.jsx). */
.plan-fit-banner { background: rgba(47,93,154,0.1); border: 1px solid rgba(47,93,154,0.35); border-radius: 14px; padding: 14px 18px; margin: 4px 0 18px; }
.plan-fit-banner-title { font-family: 'Fraunces', 'Helvetica Neue', 'Segoe UI Symbol', serif; font-weight: 600; font-size: 14.5px; margin: 0 0 4px; color: var(--accent-deep); }
.plan-fit-banner-sub { font-size: 12.5px; color: var(--ink-soft); margin: 0; line-height: 1.5; }

.storage-error-banner { display: flex; align-items: center; gap: 14px; background: rgba(181,71,58,0.1); border-bottom: 1px solid rgba(181,71,58,0.35); color: var(--brick); padding: 12px 24px; }
.storage-error-banner svg { flex-shrink: 0; }
.storage-error-title { font-family: 'Fraunces', 'Helvetica Neue', 'Segoe UI Symbol', serif; font-weight: 600; font-size: 14px; margin: 0 0 2px; color: var(--brick); }
.storage-error-sub { font-size: 12px; color: var(--ink-soft); margin: 0; max-width: 620px; }
.storage-error-banner .ghost-btn { margin-left: auto; flex-shrink: 0; }
.export-reminder-banner { display: flex; align-items: center; gap: 14px; background: rgba(47,93,154,0.1); border-bottom: 1px solid rgba(47,93,154,0.35); color: var(--accent-deep); padding: 12px 24px; }
.export-reminder-banner svg { flex-shrink: 0; }
.export-reminder-title { font-family: 'Fraunces', 'Helvetica Neue', 'Segoe UI Symbol', serif; font-weight: 600; font-size: 14px; margin: 0 0 2px; color: var(--accent-deep); }
.export-reminder-sub { font-size: 12px; color: var(--ink-soft); margin: 0; max-width: 620px; }
.export-reminder-banner .ghost-btn { margin-left: auto; flex-shrink: 0; }
.export-reminder-dismiss { background: transparent; border: none; color: var(--ink-soft); cursor: pointer; padding: 4px; flex-shrink: 0; display: inline-flex; border-radius: 6px; }
.export-reminder-dismiss:hover { color: var(--ink); background: rgba(32,42,51,0.06); }
.revival-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; background: rgba(47,93,154,0.1); border: 1px solid rgba(47,93,154,0.35); border-radius: 14px; padding: 16px 20px; }
.revival-banner-title { font-family: 'Fraunces', 'Helvetica Neue', 'Segoe UI Symbol', serif; font-weight: 600; font-size: 15px; margin: 0 0 4px; color: var(--accent); }
.revival-banner-reasons { font-size: 12.5px; color: var(--ink-soft); margin: 0; padding-left: 18px; max-width: 480px; }

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
.map-cell-diff-icon { position: absolute; top: 10px; right: 10px; color: var(--ink-faint); }
.map-cell-recurring { position: absolute; bottom: 10px; right: 10px; font-size: 13px; color: var(--ink-faint); }
.map-cell-flag { position: absolute; bottom: 10px; left: 10px; display: inline-flex; }
.map-cell-flag.flag-rough { color: var(--warm); }
.map-cell-flag.flag-lost { color: var(--brick); }
.map-cell-relearning { position: absolute; top: 10px; left: 10px; display: inline-flex; color: var(--brick); }
.map-cell-group { grid-column: span 2; display: flex; gap: 8px; border: 2px dashed var(--ink-faint); border-radius: 12px; padding: 6px; }
.map-cell-group .map-cell { flex: 1; min-width: 0; }

.flag-toggle { display: inline-flex; align-items: center; gap: 7px; align-self: flex-start; border: 1px solid var(--line); background: var(--white); color: var(--ink-soft); border-radius: 9px; padding: 8px 14px; font-size: 13px; font-weight: 600; transition: border-color .15s, background .15s, color .15s; }
.flag-toggle:hover { border-color: var(--accent); }
.flag-toggle.flag-rough { border-color: var(--warm); background: rgba(185,138,62,0.1); color: var(--warm); }
.flag-toggle.flag-lost { border-color: var(--brick); background: rgba(181,71,58,0.1); color: var(--brick); }

.relearning-hint { display: flex; align-items: flex-start; gap: 6px; color: var(--brick); }
.relearning-hint svg { flex-shrink: 0; margin-top: 1px; }

.climbing-hint { display: flex; align-items: flex-start; gap: 6px; color: var(--teal); margin: 10px 0 0; }
.climbing-hint svg { flex-shrink: 0; margin-top: 1px; }
.climbing-hint-note { font-size: 12px; color: var(--ink-soft); margin: 4px 0 0 20px; }

.detail-panel { border-color: var(--ink); }
.detail-modal { max-width: 480px; }
.detail-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 22px; border-bottom: 1px solid var(--line); }
.detail-modal .modal-body { padding: 22px 22px 24px; }
.detail-stats { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.detail-stats > div { display: flex; justify-content: space-between; font-size: 13.5px; border-bottom: 1px solid var(--line); padding-bottom: 7px; }
.detail-stats .lbl { color: var(--ink-soft); }
.detail-stats .val { font-weight: 600; }
.detail-stats .val.warn { color: var(--brick); display: inline-flex; align-items: center; gap: 4px; text-align: right; }
.chunk-info { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
.chunk-info summary { display: flex; align-items: center; gap: 5px; cursor: pointer; font-size: 12.5px; font-weight: 600; color: var(--ink-soft); list-style: none; }
.chunk-info summary::-webkit-details-marker { display: none; }
.chunk-info summary svg { transition: transform 0.15s ease; }
.chunk-info[open] summary svg { transform: rotate(90deg); }
.chunk-info[open] summary { margin-bottom: 12px; }
.chunk-info .detail-stats { margin-bottom: 0; }

.checklist { display: flex; flex-direction: column; gap: 10px; }
.checklist-item { display: flex; gap: 12px; align-items: flex-start; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--white); }
.checklist-item.checked { background: rgba(46,110,99,0.08); border-color: rgba(46,110,99,0.35); }
.checklist-item.historical { border-style: dashed; }
.checklist-item.historical .checklist-check { border-style: dashed; background: transparent; }
.checklist-check { width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--teal); background: rgba(46,110,99,0.15); flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--teal); margin-top: 2px; }
.checklist-check-empty { width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--ink-faint); background: var(--white); flex-shrink: 0; margin-top: 2px; padding: 0; cursor: pointer; transition: border-color .15s, background .15s; }
.checklist-check-empty:hover:not(:disabled) { border-color: var(--teal); background: rgba(46,110,99,0.08); }
.checklist-check-empty:disabled { cursor: not-allowed; opacity: 0.6; }
.checklist-body { flex: 1; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.checklist-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.checklist-label { font-weight: 700; }
.tag { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 20px; font-weight: 600; }
.tag-new { background: var(--accent); color: var(--white); }
.tag-review { background: var(--ink-soft); color: var(--white); }
.tag-transition { background: var(--teal); color: var(--white); }
.tag-combo { background: var(--brick); color: var(--white); }
.tag-section-runthrough { background: var(--accent-deep); color: var(--white); }
.tag-section-transition { background: var(--ink); color: var(--white); }
.tag.subtle { background: transparent; border: 1px solid var(--line); color: var(--ink-soft); }
.conf-pill { margin-left: auto; font-size: 12px; color: var(--accent-deep); font-weight: 600; }
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
.fail-override-row { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--ink-soft); font-weight: 600; margin-top: 8px; }
.primary-btn.sm { padding: 7px 14px; font-size: 12.5px; }

/* Pass 91 (experimental v1) — focus spots. .ts- prefix is shared by the
   Wizard's setup-time spot list (Wizard.jsx's FocusSpotsStep) and Settings'
   own on/off panel; .focus-spot- prefix is Daily Practice's own gated/
   paused practice card (components/tabs/today/FocusSpotCard.jsx). */
.ts-chunk-list { list-style: none; margin: 0 0 18px; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.ts-chunk-row { border: 1px solid var(--line); border-radius: 10px; padding: 11px 13px; background: var(--white); }
.ts-chunk-row-main { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ts-chunk-row-main .grow { flex: 1; }
.ts-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.ts-chip { display: inline-flex; align-items: center; background: rgba(32,42,51,0.06); border-radius: 20px; padding: 2px; }
.ts-chip-label { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: none; padding: 3px 4px 3px 8px; font-size: 12px; color: var(--ink); font-family: inherit; cursor: pointer; }
.ts-chip-label .mono { color: var(--ink-soft); font-size: 11px; }
.ts-chip-label:hover { color: var(--accent-deep); }
.ts-chip-remove { background: transparent; border: none; color: var(--ink-faint); width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; flex-shrink: 0; }
.ts-chip-remove:hover { background: rgba(181,71,58,0.15); color: var(--brick); }
.ts-add-form { background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 13px 14px 6px; margin-top: 10px; }
.ts-add-form .field { margin-bottom: 10px; }
.ts-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin: 10px 0 4px; }

.focus-spot-panel { border-color: rgba(47,93,154,0.4); }
.focus-spot-summary { font-size: 12.5px; color: var(--ink-soft); margin: -6px 0 14px; }
.focus-spot-cards { display: flex; flex-direction: column; gap: 12px; }
.focus-spot-card { display: flex; gap: 12px; align-items: flex-start; border: 1px solid var(--line); border-radius: 10px; background: var(--white); padding: 14px 15px; }
.focus-spot-card.resolved { background: rgba(46,110,99,0.08); border-color: rgba(46,110,99,0.35); }
.focus-spot-card-body { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.focus-spot-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.focus-spot-name { font-weight: 700; }
.focus-spot-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--accent-deep); }
.focus-spot-count { font-size: 11.5px; color: var(--accent-deep); background: rgba(47,93,154,0.12); border-radius: 20px; padding: 2px 9px; font-weight: 600; }
.focus-spot-prompt { font-size: 13px; margin: 0; }
.focus-spot-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.focus-spot-bpm-form { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; margin-top: 2px; }
.focus-spot-bpm-form label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--ink-soft); font-weight: 600; }
.focus-spot-bpm-form input { width: 90px; border: 1px solid var(--line); border-radius: 6px; padding: 7px 8px; font-size: 13.5px; background: var(--white); color: var(--ink); font-family: 'IBM Plex Mono', monospace; }
.focus-spot-resolved-line { display: flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 600; color: var(--teal); margin: 0; }

/* Pass 96 — a brief flash on whatever Piece Map's focus-spot links scroll
   to (a FocusSpotCard or a ChecklistItem's card), so landing on the right
   card is obvious even though nothing about its own border/background
   otherwise changed. box-shadow rather than background/border-color: both
   of those are already meaningful state on these two cards (checked/
   paused/resolved), so animating either would fight that instead of
   layering cleanly on top of it. Automatically skipped for
   prefers-reduced-motion via the existing app-wide rule near the top of
   this stylesheet. */
.arrival-highlight { animation: arrival-pulse 1.6s ease-out; }
@keyframes arrival-pulse {
  0% { box-shadow: 0 0 0 3px rgba(47,93,154,0.55); }
  100% { box-shadow: 0 0 0 3px rgba(47,93,154,0); }
}

.checklist-item.paused { border-style: dashed; border-color: var(--accent); background: rgba(47,93,154,0.05); }
.paused-note { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; background: rgba(47,93,154,0.08); border-radius: 8px; padding: 10px 11px; }
.paused-note svg { flex-shrink: 0; margin-top: 1px; color: var(--accent-deep); }

.view-all-list { display: flex; flex-direction: column; gap: 14px; }

.focus-panel { border-color: rgba(181,71,58,0.3); }
.focus-list { display: flex; flex-direction: column; gap: 8px; }
.focus-row { display: flex; align-items: center; gap: 10px; font-size: 13px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.focus-row:last-child { border-bottom: none; padding-bottom: 0; }
.focus-conf { margin-left: auto; font-weight: 600; color: var(--brick); }

.reassess-panel { border-color: rgba(47,93,154,0.35); }
.split-chunk-panel { border-color: rgba(46,110,99,0.35); }
.reassess-quickpicks { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }

.stat-grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
@media (max-width: 640px) { .stat-grid-2 { grid-template-columns: 1fr; } }

.progress-chart { display: flex; align-items: flex-end; gap: 6px; height: 140px; padding-top: 10px; }
.progress-chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; gap: 4px; }
.progress-chart-bars { display: flex; gap: 2px; align-items: flex-end; height: 120px; width: 100%; justify-content: center; }
.progress-chart-bar { width: 6px; border-radius: 3px 3px 0 0; }
.progress-chart-bar.planned { background: var(--ink-faint); opacity: 0.5; }
.progress-chart-bar.actual { background: var(--accent); }
.progress-chart-label { font-size: 9px; color: var(--ink-faint); }
.progress-chart.by-day { height: auto; gap: 2px; }
.progress-chart.by-day .progress-chart-col { min-width: 0; }
.progress-chart.by-day .progress-chart-bars { gap: 1px; }
.progress-chart.by-day .progress-chart-bar { width: auto; flex: 0 1 6px; min-width: 1px; }
.progress-chart.by-day .progress-chart-label { height: 11px; line-height: 11px; white-space: nowrap; }
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
.history-day { color: var(--accent-deep); width: 56px; flex-shrink: 0; }
.history-items { color: var(--ink-soft); }

.analytics-bars { display: flex; flex-direction: column; gap: 14px; }
.analytics-bar-row { display: flex; align-items: center; gap: 12px; }
.analytics-bar-label { width: 110px; flex-shrink: 0; font-size: 13px; color: var(--ink-soft); }
.analytics-bar-track { flex: 1; height: 10px; border-radius: 6px; background: var(--paper); overflow: hidden; }
.analytics-bar-fill { height: 100%; border-radius: 6px; }

.primary-btn { display: inline-flex; align-items: center; gap: 8px; background: var(--accent); color: var(--white); border: none; border-radius: 9px; padding: 10px 18px; font-size: 14px; font-weight: 600; transition: background .15s; }
.primary-btn:hover:not(:disabled) { background: var(--accent-deep); }
.primary-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.primary-btn.lg { padding: 13px 24px; font-size: 15px; }
.primary-btn.outline-accent { background: transparent; color: var(--accent); border: 1.5px solid var(--accent); }
.primary-btn.outline-accent:hover:not(:disabled) { background: rgba(47,93,154,0.08); }

.ghost-btn { display: inline-flex; align-items: center; gap: 7px; background: transparent; border: 1px solid var(--line); color: var(--ink); border-radius: 9px; padding: 9px 16px; font-size: 13.5px; font-weight: 500; transition: border-color .15s, background .15s; }
.ghost-btn:hover { border-color: var(--accent); background: rgba(47,93,154,0.06); }
.ghost-btn.full { width: 100%; justify-content: center; }
.ghost-btn.active { background: var(--accent); color: var(--white); border-color: var(--accent); }
.ghost-btn:disabled { opacity: 0.45; cursor: not-allowed; }

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
.modal-step { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-faint); font-weight: 500; background: none; border: none; padding: 0; font-family: inherit; cursor: not-allowed; }
.modal-step:not(:disabled) { cursor: pointer; }
.modal-step:not(:disabled):hover { color: var(--accent-deep); }
.modal-step.active { color: var(--accent-deep); }
.modal-step.done { color: var(--teal); }
.modal-step.done:hover { color: var(--accent-deep); }
.modal-step-dot { width: 18px; height: 18px; border-radius: 50%; border: 1px solid currentColor; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; }
.modal-body { padding: 26px 26px 10px; overflow-y: auto; flex: 1; }
.modal-foot { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 18px 26px; border-top: 1px solid var(--line); }

.wizard-pane h2 { font-size: 20px; margin-bottom: 6px; }
.wizard-hint { color: var(--ink-soft); font-size: 13.5px; margin: 0 0 20px; line-height: 1.5; }

.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.field > span { font-size: 12.5px; font-weight: 600; color: var(--ink-soft); }
/* One width rule for every toggle/button that sits directly in a form field or
   an add-row list: size to the content instead of stretching to the column's
   full width (a flex column's default align-items: stretch). Text inputs,
   selects and textareas are deliberately not listed — they stay full width.
   The sidebar's .ghost-btn.full is its own, intentionally full-width thing. */
.field > .segmented, .field > .ghost-btn, .field > .primary-btn, .field > .danger-btn,
.pairs-list > .ghost-btn { align-self: flex-start; }
.field input[type="text"], .field input[type="email"], .field input[type="password"], .field input[type="number"], .field input[type="date"] { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 14px; background: var(--white); color: var(--ink); }
.field textarea { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 14px; background: var(--white); color: var(--ink); font-family: inherit; resize: vertical; }
.field input:disabled { color: var(--ink-faint); background: var(--paper); }
.field-row { display: flex; gap: 16px; }
.field-row .field { flex: 1; }
/* Piece Map's chunk detail modal (Pass 96) — Related chunks and Focus
   spots side by side, each sized to content down to a 180px floor rather
   than a fixed 50/50 split (a short Related-chunks list next to a longer
   Focus spots one shouldn't force them to match widths), stacking only
   once the row can no longer fit two of those floors side by side —
   .detail-modal's own 480px cap already fits two comfortably, so this
   only actually triggers on a narrower viewport. Unlike .field-row above
   (never wraps — Current BPM/Target BPM must always stay side by side),
   deliberately its own class rather than a shared one. When only one of
   the two sections has anything to show, it's the sole flex child and
   fills the row on its own — no extra rule needed for that case. */
.related-focus-row { display: flex; flex-wrap: wrap; gap: 20px; }
.related-focus-row > .field { flex: 1 1 180px; min-width: 0; }
/* One spot row (icon, name, position tag, resolved state) — shared by the
   link, the muted "not currently scheduled" variant, and the plain-text
   revival variant, so all three line up identically regardless of which
   one a given spot renders as. */
.focus-spot-map-row { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; text-align: left; font-size: 13px; }

.segmented { display: inline-flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; flex-wrap: wrap; }
.segmented button { border: none; background: var(--white); color: var(--ink-soft); padding: 8px 14px; font-size: 13px; font-weight: 500; border-right: 1px solid var(--line); }
.segmented button:last-child { border-right: none; }
.segmented button.active { background: var(--accent); color: var(--white); }

.pairs-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.pair-row { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-soft); flex-wrap: wrap; }
.pair-row input { width: 52px; border: 1px solid var(--line); border-radius: 6px; padding: 6px; font-size: 13px; text-align: center; font-family: 'IBM Plex Mono', monospace; background: var(--white); color: var(--ink); }
.pair-row input.name-input { width: 120px; text-align: left; font-family: 'Inter', 'Helvetica Neue', 'Segoe UI Symbol', sans-serif; }
.pair-label { flex-shrink: 0; }

.recording-row { display: flex; align-items: center; gap: 6px; }
.recording-row input { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; font-size: 13px; background: var(--white); color: var(--ink); }
.recording-row input.name-input { flex: 0.8; }
.recordings-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.recording-link { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--accent-deep); background: rgba(47,93,154,0.08); border: 1px solid var(--line); border-radius: 20px; padding: 5px 12px; text-decoration: none; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recording-link:hover { background: rgba(47,93,154,0.16); }

.review-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 20px; }
.review-stat { background: var(--white); border: 1px solid var(--line); border-radius: 10px; padding: 14px; text-align: center; }
.review-stat .num { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 20px; font-weight: 600; color: var(--accent-deep); }
.review-stat .lbl { font-size: 11px; color: var(--ink-soft); }

.time-summary-banner { display: flex; align-items: center; justify-content: flex-start; gap: 40px; flex-wrap: wrap; background: var(--paper-card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px; margin-bottom: 24px; }
.time-summary-item { display: flex; flex-direction: column; gap: 2px; }
.time-summary-label { font-size: 11px; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
.time-summary-num { font-family: 'IBM Plex Mono', monospace; font-size: 20px; font-weight: 600; color: var(--accent-deep); }
/* Pass 102: "includes Nm technique" under Master Agenda's Total planned. */
.time-summary-sub { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); }
/* Pass 104 review fix: import modal note when a backup's technique library
   (or some of its scales) couldn't be read — said, not skipped silently. */
.wizard-hint.import-warning { color: var(--brick); background: rgba(181,71,58,0.06); border: 1px solid rgba(181,71,58,0.25); border-radius: 8px; padding: 8px 10px; margin: 0 0 12px; }
.time-status { font-size: 12px; color: var(--ink-soft); }
.time-status.busy { color: var(--brick); }

.master-agenda-cards { display: flex; flex-direction: column; gap: 14px; }
.piece-card { background: var(--paper-card); border: 1px solid var(--line); border-radius: 14px; padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; }
.piece-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.piece-title { font-family: 'Fraunces', 'Helvetica Neue', 'Segoe UI Symbol', serif; font-size: 16px; font-weight: 600; color: var(--ink); margin: 0; }
.piece-meta { display: flex; gap: 12px; align-items: center; }
.piece-time { font-family: 'IBM Plex Mono', monospace; font-size: 15px; font-weight: 600; color: var(--accent-deep); }
.tasks-list { display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--ink-soft); }
.task-item { display: flex; gap: 8px; align-items: center; }
.task-tag { display: inline-block; font-size: 9.5px; padding: 2px 7px; border-radius: 4px; font-weight: 600; text-transform: uppercase; flex-shrink: 0; color: var(--white); }
.tag-new { background: var(--accent); }
.tag-review { background: var(--ink-soft); }
.tag-transition { background: var(--teal); }
.tag-combo { background: var(--brick); }
.piece-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid var(--line); margin-top: 8px; }
.link-btn { background: transparent; border: none; color: var(--accent-deep); font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; transition: color 0.15s; padding: 0; font-family: inherit; }
.link-btn:hover { color: var(--accent); text-decoration: underline; }

/* ---------------------------------------------------------------- */
/*  Technique practice (Pass 101) — the Technique page, the shared   */
/*  panel (components/tabs/technique/TechniquePanel.jsx), Library    */
/*  and Methods. Built to docs/mockups/technique-practice.html.      */
/* ---------------------------------------------------------------- */
.nav-divider { height: 1px; background: var(--line); margin: 6px 4px; }
.tq-page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.tq-h1 { font-size: 26px; line-height: 1.15; }
.tq-page-sub { margin-top: 6px; font-size: 13px; }
.tq-subtabs { align-self: flex-start; margin-bottom: -8px; }
.tq-seg-sm button { padding: 5px 12px; font-size: 12.5px; }
.tq-panel { padding: 16px 18px; }
.tq-panel-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.tq-panel .tq-panel-title { font-size: 15px; margin: 0; display: flex; align-items: center; gap: 8px; }
.tq-panel-sub { color: var(--ink-soft); font-size: 12.5px; margin: 4px 0 12px; line-height: 1.5; }
.tq-meta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); }
.tq-ink { color: var(--ink); }
.tq-empty { border: 1px dashed var(--line); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.tq-empty p { margin: 0; font-size: 13px; color: var(--ink-soft); }

/* Task card: done = filled teal check + tinted card, never a strikethrough. */
.tq-card { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--white); margin-bottom: 8px; }
.tq-card.done { border-color: rgba(46,110,99,0.45); background: rgba(46,110,99,0.06); }
.tq-check { flex: none; width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--ink-faint); background: var(--white); display: flex; align-items: center; justify-content: center; color: var(--white); padding: 0; margin-top: 1px; }
.tq-check.done { background: var(--teal); border-color: var(--teal); }
/* A check-off saved before undo existed can't be reversed: stays teal, just not clickable. */
.tq-check:disabled { cursor: default; }
.tq-card-main { flex: 1; min-width: 0; }
.tq-card-head { display: flex; justify-content: space-between; gap: 8px; cursor: pointer; }
.tq-title { font-weight: 600; font-size: 13.5px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.tq-title-star { display: inline-flex; color: var(--accent); }
.tq-title-star svg { fill: currentColor; }
.tq-chevron { color: var(--ink-faint); display: inline-flex; }
.tq-methods { margin-top: 6px; }
.tq-method-row { display: flex; gap: 5px; align-items: flex-start; padding: 3px 0; }
.tq-method-body { flex: 1; min-width: 0; cursor: pointer; }
.tq-method-top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.tq-method-name { font-weight: 600; font-size: 12.5px; }
.tq-method-desc { color: var(--ink-soft); font-size: 12px; line-height: 1.5; margin-top: 1px; }
.tq-tech-tag { flex: none; font-size: 10.5px; padding: 1px 8px; border-radius: 20px; border: 1px solid rgba(46,110,99,0.5); color: var(--teal); font-weight: 600; letter-spacing: .02em; white-space: nowrap; }
.tq-pill-row { margin-top: 7px; }
.tq-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 500; background: rgba(47,93,154,0.14); color: var(--accent-deep); }
.tq-expanded { margin-top: 6px; }
.tq-start { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin: 8px 0 10px; padding: 10px 12px; background: var(--paper); border-radius: 8px; }
.tq-start-label { font-weight: 600; font-size: 12.5px; }
.tq-start-sub { color: var(--ink-soft); font-size: 12px; margin-top: 1px; }
.tq-start-value { font-size: 16px; font-weight: 600; color: var(--ink); white-space: nowrap; border-bottom: 1px dotted var(--ink-faint); }
.tq-tip { position: relative; display: inline-block; cursor: help; outline: none; }
.tq-tip-text { display: none; position: absolute; right: 0; bottom: calc(100% + 6px); background: var(--ink); color: var(--white); font-size: 11.5px; line-height: 1.4; padding: 6px 9px; border-radius: 7px; white-space: nowrap; z-index: 5; font-weight: 500; }
.tq-tip:hover .tq-tip-text, .tq-tip:focus .tq-tip-text { display: block; }
.tq-check-section { border-top: 1px solid var(--line); padding-top: 10px; }
.tq-check-heading { font-weight: 600; font-size: 12.5px; }
.tq-check-sub { color: var(--ink-soft); font-size: 12px; margin: 1px 0 8px; line-height: 1.6; }
.tq-check-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.tq-tempo-input input { width: 76px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 7px; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; background: var(--white); color: var(--ink); }
.tq-tempo-input.error input { border-color: var(--brick); }
.tq-ok { color: var(--teal); font-size: 12.5px; font-weight: 500; margin: 0; }
.tq-hint { color: var(--ink-soft); font-size: 12px; margin: 0; }
.tq-error { color: var(--brick); font-size: 12.5px; }
.tq-more-often { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 10px; }
.ghost-btn.tq-xs { padding: 3px 9px; font-size: 11.5px; border-radius: 7px; gap: 5px; }
.ghost-btn.tq-on { border-color: var(--accent); color: var(--accent-deep); background: rgba(47,93,154,0.1); }
.ghost-btn.tq-on svg { fill: currentColor; }

/* Stars: the lucide Star, centered in a fixed square; filled when on. */
.tq-star { flex: none; border: none; background: transparent; color: var(--ink-faint); padding: 0; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; }
.tq-star svg { display: block; }
.tq-star:hover { color: var(--accent-deep); }
.tq-star.on { color: var(--accent); }
.tq-star.on svg { fill: currentColor; }
.tq-method-row .tq-star { margin-top: -1px; }

/* Library */
.tq-lib-controls { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
/* Accidentals: Inter has no ♭, and the browser's fallback draws it in a
   full-em box with a wide blank left side (read as "E ♭"). These fonts draw
   ♯/♭ snugly; KeyText.jsx wraps them. The select gets the same stack since
   a native option can't hold a span. */
.tq-acc { font-family: 'Helvetica Neue', 'Segoe UI Symbol', 'Arial Unicode MS', sans-serif; }
.tq-select { font-family: 'Inter', 'Helvetica Neue', 'Segoe UI Symbol', sans-serif; }
/* Pass 103: the piece's key fields (BasicsFields) — set apart by a divider
   inside the Wizard/Settings basics form, with key chips for "Other keys". */
.key-fields { border-top: 1px solid var(--line); padding-top: 14px; }
.key-fields .field { margin-bottom: 10px; }
.field .field-hint { font-size: 12px; font-weight: 400; color: var(--ink-soft); }
.key-chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.key-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px; border: 1px solid var(--line); border-radius: 20px; background: var(--white); font-size: 12.5px; }
.key-chip button { border: none; background: transparent; color: var(--ink-faint); padding: 0 2px; font-size: 15px; line-height: 1; }
.key-chip button:hover { color: var(--brick); }
.tq-select { padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; font-family: inherit; font-size: 12.5px; background: var(--white); color: var(--ink); max-width: 100%; }
.tq-lib-grid { display: grid; grid-template-columns: 22px minmax(0,1fr) 72px 64px 52px; gap: 8px; align-items: center; }
.tq-lib-head { padding: 8px 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-faint); font-weight: 600; border-top: 1px solid var(--line); margin-top: 10px; }
.tq-lib-row-wrap { border-top: 1px solid var(--line); }
.tq-lib-row { padding: 7px 0; }
.tq-lib-row.off .tq-title, .tq-lib-row.off .tq-meta { opacity: .5; }
.tq-lib-item { min-width: 0; cursor: pointer; }
.tq-lib-item .tq-title { font-size: 13px; }
.tq-note { display: inline-flex; color: var(--accent-deep); margin-left: 2px; }
.tq-bar { height: 4px; border-radius: 2px; background: var(--paper); overflow: hidden; margin-top: 4px; }
.tq-bar i { display: block; height: 100%; background: var(--accent); opacity: .85; }
.tq-switch { position: relative; width: 32px; height: 18px; border-radius: 9px; border: 1px solid var(--line); background: var(--white); padding: 0; justify-self: center; flex: none; }
.tq-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--ink-faint); transition: left .15s; }
.tq-switch.on { background: var(--teal); border-color: var(--teal); }
.tq-switch.on::after { left: 16px; background: var(--white); }
.tq-row-editor { padding: 2px 0 12px 30px; }
.tq-editor-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }
.tq-editor-field { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--ink-soft); }
.tq-editor-field input[type="number"] { width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; background: var(--white); color: var(--ink); }
.tq-editor-field .segmented { align-self: flex-start; }
.tq-prompt { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; line-height: 1.5; margin-top: 10px; }
.tq-prompt-buttons { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; align-items: center; }

/* Methods */
.tq-group-label { font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; letter-spacing: .06em; font-size: 10.5px; color: var(--accent-deep); font-weight: 600; margin: 14px 0 2px; }
.tq-method-item { display: grid; grid-template-columns: 22px minmax(0,1fr) 40px; gap: 8px; align-items: start; padding: 7px 0; border-top: 1px solid var(--line); }
.tq-method-item.off .tq-method-item-body { opacity: .5; }
.tq-method-item .tq-switch { margin-top: 2px; }
.tq-mine { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; padding: 1px 6px; border-radius: 20px; background: rgba(46,110,99,0.12); color: var(--teal); margin-left: 4px; }
.tq-add-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.tq-panel .field .tq-select { align-self: stretch; }

/* Add form */
.tq-add-grid { margin: 10px 0 12px; }
.tq-checkbox { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 12px; }

@media (max-width: 820px) {
  .nav-divider { display: none; }
}
@media (max-width: 640px) {
  .tq-lib-grid { grid-template-columns: 22px minmax(0,1fr) 64px 46px; }
  .tq-lib-grid > *:nth-child(4) { display: none; }
  .tq-editor-grid { grid-template-columns: 1fr; }
  .tq-row-editor { padding-left: 0; }
}

`;
