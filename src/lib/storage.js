import { PIECE_KEY_PREFIX, ACTIVE_KEY } from "./constants";

/* ------------------------------------------------------------------ */
/*  localStorage load/save, extracted into plain functions so the      */
/*  App component's effects just call these rather than touching       */
/*  localStorage directly. Every call is wrapped defensively since      */
/*  storage can be unavailable (e.g. private browsing).                 */
/* ------------------------------------------------------------------ */

export function loadPiecesFromStorage() {
  const found = {};
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PIECE_KEY_PREFIX));
    keys.forEach((key) => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const p = JSON.parse(raw);
          found[p.id] = p;
        }
      } catch (e) {
        /* skip unreadable entry */
      }
    });
  } catch (e) {
    /* storage unavailable (e.g. private browsing) */
  }
  return found;
}

export function loadActivePieceId(pieces) {
  let active = null;
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (raw) active = JSON.parse(raw);
  } catch (e) {
    /* nothing saved yet */
  }
  if (!active || !pieces[active]) {
    const ids = Object.keys(pieces);
    active = ids.length ? ids[0] : null;
  }
  return active;
}

export function savePieceToStorage(id, piece) {
  try {
    localStorage.setItem(PIECE_KEY_PREFIX + id, JSON.stringify(piece));
  } catch (e) {
    /* storage unavailable */
  }
}

export function saveActivePieceIdToStorage(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, JSON.stringify(id));
    else localStorage.removeItem(ACTIVE_KEY);
  } catch (e) {
    /* storage unavailable */
  }
}

export function removePieceFromStorage(id) {
  try {
    localStorage.removeItem(PIECE_KEY_PREFIX + id);
  } catch (e) {
    /* storage unavailable */
  }
}

export function downloadBackup(pieces) {
  const backup = {
    exportedAt: new Date().toISOString(),
    version: 1,
    pieces: Object.values(pieces),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `measureone-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Returns the array of pieces found in a parsed backup file, or null if the
// shape doesn't look like a backup. Throws if `rawText` isn't valid JSON —
// callers should catch that separately to show a "not valid JSON" message
// distinct from "valid JSON but no pieces in it."
export function parseBackupPieces(rawText) {
  const data = JSON.parse(rawText);
  return Array.isArray(data.pieces) ? data.pieces : Array.isArray(data) ? data : null;
}
