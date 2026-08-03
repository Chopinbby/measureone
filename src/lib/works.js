/* ------------------------------------------------------------------ */
/*  Multi-movement works.                                             */
/*                                                                     */
/*  A "work" is purely a grouping label over ordinary pieces: each     */
/*  movement/part is a complete, self-contained piece with its own     */
/*  chunks, timeline, progress and revival state. Parts are linked     */
/*  only by a shared `workId`, so nothing in chunking, scheduling or   */
/*  confidence has to know works exist. See docs/Data-Model.md#works.  */
/* ------------------------------------------------------------------ */

// A work exists exactly when the user has given a work title. Typing one on a
// standalone piece promotes it into a (single-part) work; clearing it drops
// the piece back out of the group.
export function ensureWorkId(piece) {
  const named = (piece.workName || "").trim();
  if (!named) return piece.workId ? { ...piece, workId: null } : piece;
  if (piece.workId) return piece;
  return { ...piece, workId: `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
}

// Sibling parts of the same work, in creation order, so a part's position in
// the strip is stable rather than dependent on object key order.
export function partsOfWork(pieceList, workId) {
  if (!workId) return [];
  return pieceList
    .filter((p) => p.workId === workId)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

// Ordered groups for the sidebar switcher: each entry is either a standalone
// piece (`workId: null`, one item) or a work with its parts. Groups keep the
// order of their earliest-created member.
export function groupPiecesByWork(pieceList) {
  const groups = [];
  const byWork = {};
  pieceList.forEach((p) => {
    if (!p.workId) {
      groups.push({ workId: null, workName: null, pieces: [p] });
      return;
    }
    if (!byWork[p.workId]) {
      byWork[p.workId] = { workId: p.workId, workName: p.workName || "Untitled work", pieces: [] };
      groups.push(byWork[p.workId]);
    }
    byWork[p.workId].pieces.push(p);
  });
  Object.values(byWork).forEach((g) => g.pieces.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
  return groups;
}
