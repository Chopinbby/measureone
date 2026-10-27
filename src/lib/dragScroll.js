/* ------------------------------------------------------------------ */
/*  Scrolling a short list while something is dragged over it         */
/*  (Pass 125)                                                         */
/*                                                                     */
/*  The piece list in the sidebar shows about seven rows and scrolls   */
/*  inside that window. A row is moved with native HTML5 drag and      */
/*  drop, and not every browser scrolls such a window by itself while  */
/*  a drag is held near its edge (Safari does not, reliably), so a     */
/*  piece could only be moved to rows already in view and a long list  */
/*  took several drags to cross. This does the scrolling: while the    */
/*  dragged piece is within DRAG_SCROLL_EDGE px of the window's top or */
/*  bottom edge, the list scrolls that way, faster the closer to (or   */
/*  past) the edge. It stops when the piece is dropped, the drag ends, */
/*  or the list hears nothing more from the drag.                      */
/*                                                                     */
/*  Pure arithmetic plus a small timer loop that touches only the      */
/*  element it is handed, so it is tested in node with a stand-in      */
/*  element and a fake timer (test/dragScroll.test.mjs). It changes    */
/*  nothing about what a drop does.                                    */
/* ------------------------------------------------------------------ */

// px from the list's top or bottom edge inside which scrolling starts
export const DRAG_SCROLL_EDGE = 36;
// px scrolled per tick at the edge (or past it); 0 at the inner border of the zone
export const DRAG_SCROLL_MAX_STEP = 8;
export const DRAG_SCROLL_TICK_MS = 16;
// Scrolling stops by itself when the list has heard nothing from the drag for this
// long (a browser fires "dragover" every 50 to 350 ms while a drag is held over an
// element, so a quiet spell this long means the drag has left).
export const DRAG_SCROLL_STALE_MS = 700;

// How far to scroll right now: negative scrolls up, positive scrolls down, 0 means the
// pointer is not near an edge. `pointerY`, `top` and `bottom` share one coordinate
// system (the viewport's). A list too short for two full zones gets two half-height zones
// so they never overlap. A pointer past the edge counts as at the edge.
export function dragScrollStep({ pointerY, top, bottom, edge = DRAG_SCROLL_EDGE, maxStep = DRAG_SCROLL_MAX_STEP }) {
  if (![pointerY, top, bottom, edge, maxStep].every(Number.isFinite)) return 0;
  const height = bottom - top;
  if (height <= 0 || edge <= 0 || maxStep <= 0) return 0;
  const zone = Math.min(edge, height / 2);
  if (pointerY < top + zone) return -Math.ceil(maxStep * Math.min(1, (top + zone - pointerY) / zone));
  if (pointerY > bottom - zone) return Math.ceil(maxStep * Math.min(1, (pointerY - (bottom - zone)) / zone));
  return 0;
}

// One scroller per list. `update(element, clientY)` is called on every "dragover" over the
// list: it remembers where the pointer is and starts the loop if it is not running. Each tick
// scrolls the element by `dragScrollStep`. `stop()` ends it (a drop, the end of the drag, the
// list going away); calling it when nothing runs is fine. A pointer that leaves the list sends
// no more "dragover" events, so the loop also ends by itself once it has heard nothing for
// `staleMs`. (A "dragleave" is deliberately not used: it fires between rows too, and not every
// browser reports where the pointer was, so acting on it could stop the scrolling every time a
// row passed under the pointer.) The timer, the clock and the numbers can be replaced so a test
// can drive it without waiting.
export function createDragAutoScroller({
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (id) => clearInterval(id),
  now = () => Date.now(),
  tickMs = DRAG_SCROLL_TICK_MS,
  staleMs = DRAG_SCROLL_STALE_MS,
  edge = DRAG_SCROLL_EDGE,
  maxStep = DRAG_SCROLL_MAX_STEP,
} = {}) {
  let timer = null;
  let list = null;
  let pointerY = null;
  let seenAt = 0;

  const stop = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    list = null;
    pointerY = null;
  };

  const tick = () => {
    if (!list || pointerY === null || now() - seenAt > staleMs) {
      stop();
      return;
    }
    const box = list.getBoundingClientRect();
    const step = dragScrollStep({ pointerY, top: box.top, bottom: box.bottom, edge, maxStep });
    if (step !== 0) list.scrollTop += step;
  };

  return {
    update(element, clientY) {
      if (!element || !Number.isFinite(clientY)) return;
      list = element;
      pointerY = clientY;
      seenAt = now();
      if (timer === null) timer = setTimer(tick, tickMs);
    },
    stop,
    isRunning: () => timer !== null,
  };
}
