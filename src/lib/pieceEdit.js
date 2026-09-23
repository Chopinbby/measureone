/* ------------------------------------------------------------------ */
/*  Saving the "Edit piece settings" form.                             */
/*                                                                     */
/*  The edit form works on a draft: a copy of the piece taken when     */
/*  editing starts, kept in App.jsx so it survives tab switches. By    */
/*  the time Save is clicked the live piece may have moved on (practice */
/*  logged, ratings, chunk notes, a revival ended), so Save must not   */
/*  write the whole draft back over it — that silently undoes whatever */
/*  happened elsewhere. mergeEditedPiece takes ONLY the fields the     */
/*  form actually edits from the draft and keeps everything else from  */
/*  the live piece.                                                    */
/*                                                                     */
/*  This is deliberately an allow-list, not a "everything except..."   */
/*  list: a field someone adds to the app later defaults to "keep the  */
/*  live value". Forgetting to list a NEW FORM field fails visibly (the */
/*  edit doesn't stick); the opposite mistake would quietly wipe data. */
/* ------------------------------------------------------------------ */

// Every field one of the edit form's panels writes to the draft
// (BasicsFields, SectionsEditor, DifficultyEditor, RecurringEditor,
// ScheduleFields, BpmZonesEditor, LadderConfigEditor, RecordingsEditor,
// DocumentsEditor, and SettingsTab's own Focus spots / Learned elsewhere
// panels). Anything that decides how the piece is CHUNKED (totalMeasures,
// chunkMode, customChunkSize, sections, measureDifficulty, recurring*) has
// to be here: leaving one out would make a chunk-size edit silently not save.
//
// Not listed on purpose, so the live value always wins: progress,
// memoryAnchors, lastLoggedAt, lastPlayedDate, status (Pause/Archive apply
// immediately), sortOrder, workId (derived from workName by ensureWorkId),
// createdAt, rescheduleMarker (recomputed by the save handler), and the rest
// of `revival` — see the tempo-fraction special case below.
export const EDIT_FORM_FIELDS = [
  // BasicsFields
  "name",
  "composer",
  "workName",
  "notes",
  "totalMeasures",
  "targetBPM",
  // SectionsEditor / DifficultyEditor / RecurringEditor
  "sections",
  "measureDifficulty",
  "recurringMode",
  "recurringPairs",
  // ScheduleFields
  "startDate",
  "scheduleMode",
  "daysToLearn",
  "targetDate",
  "minutesPerDay",
  "practiceDaysPerWeek",
  "chunkMode",
  "customChunkSize",
  // BpmZonesEditor / LadderConfigEditor / RecordingsEditor / DocumentsEditor
  "bpmZones",
  "ladderConfig",
  "recordings",
  "documents",
  // SettingsTab's own draft panels
  "troubleSpotsEnabled",
  "troubleSpotDefaultMinutes",
  "markedLearnedElsewhere",
];

export function mergeEditedPiece(livePiece, draft) {
  const merged = { ...livePiece };
  EDIT_FORM_FIELDS.forEach((field) => {
    if (field in draft) merged[field] = draft[field];
  });
  // The one revival value the form edits. Only applied while the live piece
  // is still in revival: if it was ended elsewhere while the form was open,
  // the draft's stale `revival` (active: true) must not bring it back, and
  // the rest of the live revival state (plan, reassessment) is kept as is.
  const draftFraction = draft.revival && draft.revival.tempoLadderStartFraction;
  if (livePiece.revival && livePiece.revival.active && draftFraction !== undefined) {
    merged.revival = { ...livePiece.revival, tempoLadderStartFraction: draftFraction };
  }
  return merged;
}
