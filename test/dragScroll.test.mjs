// Pass 125: the piece list scrolls by itself while a piece is dragged near its top or
// bottom edge (src/lib/dragScroll.js). The list is a short window (about seven rows)
// that scrolls inside the sidebar; without this, a piece could only be dragged to a row
// already in view. Two things are tested: how far to scroll for a pointer position
// (pure arithmetic), and the small timer loop, driven here with a stand-in list and a
// fake clock so nothing waits.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DRAG_SCROLL_EDGE,
  DRAG_SCROLL_MAX_STEP,
  DRAG_SCROLL_TICK_MS,
  DRAG_SCROLL_STALE_MS,
  dragScrollStep,
  createDragAutoScroller,
} from "../src/lib/dragScroll.js";

describe("how far the list scrolls for a pointer position (Pass 125)", () => {
  // a list 240 px tall whose top edge is at y = 100 (so its bottom edge is at 340); zones of 36 px
  const box = { top: 100, bottom: 340, edge: 36, maxStep: 8 };
  const step = (pointerY, over = {}) => dragScrollStep({ pointerY, ...box, ...over });

  test("nowhere near an edge: no scrolling, anywhere in the middle", () => {
    for (let y = 136; y <= 304; y += 4) assert.equal(step(y), 0, `y = ${y}`);
  });

  test("inside the top zone it scrolls up (negative); inside the bottom zone it scrolls down (positive)", () => {
    assert.ok(step(120) < 0);
    assert.ok(step(320) > 0);
  });

  test("the closer to the edge, the faster; at the edge or past it, the top speed; the inner border of the zone does nothing", () => {
    assert.equal(step(136), 0, "the inner border of the top zone");
    assert.equal(step(135), -1, "one pixel in: the slowest step, not nothing");
    assert.equal(step(118), -4, "halfway into the zone");
    assert.equal(step(100), -8, "on the edge");
    assert.equal(step(60), -8, "past the edge (the pointer above the list) is the same top speed");
    assert.equal(step(304), 0, "the inner border of the bottom zone");
    assert.equal(step(305), 1);
    assert.equal(step(322), 4);
    assert.equal(step(340), 8);
    assert.equal(step(400), 8);
    let previous = 0;
    for (let y = 136; y >= 100; y--) {
      assert.ok(-step(y) >= previous, `no slower as the pointer moves up (y = ${y})`);
      previous = -step(y);
    }
  });

  test("the two edges mirror each other", () => {
    for (let d = 0; d <= 60; d++) assert.equal(step(100 + d) + step(340 - d), 0, `${d} px from the edge: equal and opposite`);
  });

  test("a step is always a whole number within the limits, and never 0 inside a zone", () => {
    for (let y = 40; y <= 400; y += 0.5) {
      const s = step(y);
      assert.ok(Number.isInteger(s) && Math.abs(s) <= 8, `y = ${y}: ${s}`);
      if (y < 136 || y > 304) assert.notEqual(s, 0, `y = ${y} is inside a zone`);
    }
  });

  test("a list too short for two full zones gets two half-height zones that never overlap", () => {
    const short = { top: 0, bottom: 40, edge: 36, maxStep: 8 };
    assert.equal(dragScrollStep({ pointerY: 20, ...short }), 0, "the exact middle does nothing");
    assert.equal(dragScrollStep({ pointerY: 10, ...short }), -4, "upper half: halfway into its zone");
    assert.equal(dragScrollStep({ pointerY: 30, ...short }), 4);
    assert.equal(dragScrollStep({ pointerY: 0, ...short }), -8);
    assert.equal(dragScrollStep({ pointerY: 40, ...short }), 8);
  });

  test("the zone and the top speed can be changed, and the defaults are the exported constants", () => {
    assert.equal(step(110, { edge: 10, maxStep: 20 }), 0, "10 px in a 10 px zone is its inner border");
    assert.equal(step(105, { edge: 10, maxStep: 20 }), -10);
    assert.equal(dragScrollStep({ pointerY: 100, top: 100, bottom: 340 }), -DRAG_SCROLL_MAX_STEP);
    assert.equal(dragScrollStep({ pointerY: 100 + DRAG_SCROLL_EDGE, top: 100, bottom: 340 }), 0);
    assert.equal(dragScrollStep({ pointerY: 99 + DRAG_SCROLL_EDGE, top: 100, bottom: 340 }), -1);
  });

  test("nonsense in, nothing out: it never throws and never scrolls", () => {
    const bad = [
      { pointerY: NaN },
      { pointerY: undefined },
      { pointerY: Infinity },
      { top: undefined },
      { bottom: NaN },
      { top: 340, bottom: 100 },
      { top: 100, bottom: 100 },
      { edge: 0 },
      { edge: -5 },
      { maxStep: 0 },
      { maxStep: NaN },
    ];
    bad.forEach((over) => assert.equal(step(110, over), 0, JSON.stringify(over)));
    assert.equal(dragScrollStep({}), 0);
  });
});

describe("the scroller loop (Pass 125)", () => {
  // A list like the sidebar's: 240 px of window over 900 px of rows, top edge at y = 100. Its scrollTop
  // clamps to 0 .. 660 as a real element's does.
  function fakeList({ scrollTop = 0, top = 100, height = 240, content = 900 } = {}) {
    let st = scrollTop;
    const max = content - height;
    return {
      moves: 0,
      getBoundingClientRect() {
        return { top, bottom: top + height, left: 10, right: 200 };
      },
      get scrollTop() {
        return st;
      },
      set scrollTop(v) {
        this.moves += 1;
        st = Math.max(0, Math.min(max, v));
      },
    };
  }
  // A clock and a timer that move only when the test says so.
  function fakeClock() {
    let t = 0;
    let nextId = 0;
    const timers = new Map();
    return {
      now: () => t,
      setTimer: (fn, ms) => {
        nextId += 1;
        timers.set(nextId, { fn, ms });
        return nextId;
      },
      clearTimer: (id) => timers.delete(id),
      timerCount: () => timers.size,
      timerMs: () => [...timers.values()].map((x) => x.ms),
      advance(ms) {
        for (let spent = 0; spent < ms; spent += DRAG_SCROLL_TICK_MS) {
          t += DRAG_SCROLL_TICK_MS;
          [...timers.values()].forEach((x) => x.fn());
        }
      },
    };
  }
  const make = () => {
    const clock = fakeClock();
    const scroller = createDragAutoScroller({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: clock.now });
    // a drag held at one place reports itself every 50 ms, as a browser does
    const hold = (list, y, ms) => {
      for (let spent = 0; spent < ms; spent += 48) {
        scroller.update(list, y);
        clock.advance(48);
      }
    };
    return { clock, scroller, hold };
  };

  test("held in the top zone, the list scrolls to the top and stays there", () => {
    const { scroller, hold } = make();
    const list = fakeList({ scrollTop: 400 });
    hold(list, 105, 1000);
    assert.ok(list.scrollTop < 400, "it moved up");
    hold(list, 105, 4000);
    assert.equal(list.scrollTop, 0);
    assert.equal(scroller.isRunning(), true, "still being held, so still running");
  });

  test("held in the bottom zone, the list scrolls to the end and stays there", () => {
    const { hold } = make();
    const list = fakeList({ scrollTop: 100 });
    hold(list, 335, 6000);
    assert.equal(list.scrollTop, 660);
  });

  test("held in the middle, the loop runs but the list never moves", () => {
    const { scroller, hold } = make();
    const list = fakeList({ scrollTop: 300 });
    hold(list, 220, 2000);
    assert.equal(list.scrollTop, 300);
    assert.equal(list.moves, 0, "not even written to");
    assert.equal(scroller.isRunning(), true);
  });

  test("one timer however many times it is told, at the tick rate", () => {
    const { clock, scroller, hold } = make();
    const list = fakeList({ scrollTop: 400 });
    for (let i = 0; i < 20; i++) scroller.update(list, 105);
    assert.equal(clock.timerCount(), 1);
    assert.deepEqual(clock.timerMs(), [DRAG_SCROLL_TICK_MS]);
    hold(list, 105, 500);
    assert.equal(clock.timerCount(), 1);
  });

  test("stop ends it at once: the list stops moving, the timer is gone, and stopping again is harmless", () => {
    const { clock, scroller, hold } = make();
    const list = fakeList({ scrollTop: 400 });
    hold(list, 105, 300);
    const where = list.scrollTop;
    scroller.stop();
    assert.equal(scroller.isRunning(), false);
    assert.equal(clock.timerCount(), 0);
    clock.advance(2000);
    assert.equal(list.scrollTop, where, "nothing moves after stop");
    scroller.stop();
    scroller.stop();
    assert.equal(scroller.isRunning(), false);
  });

  test("it can start again after a stop, on the same list or another", () => {
    const { scroller, hold } = make();
    const a = fakeList({ scrollTop: 400 });
    hold(a, 105, 200);
    scroller.stop();
    const b = fakeList({ scrollTop: 400 });
    hold(b, 335, 600);
    assert.ok(b.scrollTop > 400, "the second list moves down");
    assert.ok(a.scrollTop < 400, "and the first one kept what it had");
    assert.equal(scroller.isRunning(), true);
  });

  test("no news from the drag for a while: it ends by itself, so a drag that left never keeps scrolling", () => {
    const { clock, scroller } = make();
    const list = fakeList({ scrollTop: 400 });
    scroller.update(list, 105);
    clock.advance(DRAG_SCROLL_STALE_MS - 2 * DRAG_SCROLL_TICK_MS);
    assert.equal(scroller.isRunning(), true, "still within the quiet allowance");
    clock.advance(4 * DRAG_SCROLL_TICK_MS);
    assert.equal(scroller.isRunning(), false);
    assert.equal(clock.timerCount(), 0);
    const where = list.scrollTop;
    clock.advance(1000);
    assert.equal(list.scrollTop, where);
    assert.ok(where > 400 - 8 * (DRAG_SCROLL_STALE_MS / DRAG_SCROLL_TICK_MS + 2), "it did scroll a little before giving up, but not without end");
  });

  test("deeper into the zone scrolls further in the same time", () => {
    const { hold } = make();
    const shallow = fakeList({ scrollTop: 600 });
    const deep = fakeList({ scrollTop: 600 });
    hold(shallow, 126, 480);
    hold(deep, 102, 480);
    assert.ok(600 - deep.scrollTop > 600 - shallow.scrollTop, `${600 - deep.scrollTop} px against ${600 - shallow.scrollTop} px`);
    assert.ok(600 - shallow.scrollTop > 0);
  });

  test("the newest pointer position wins: moving out of the zone stops the movement, moving across reverses it", () => {
    const { hold } = make();
    const list = fakeList({ scrollTop: 300 });
    hold(list, 105, 480);
    const afterUp = list.scrollTop;
    assert.ok(afterUp < 300);
    hold(list, 220, 480);
    assert.equal(list.scrollTop, afterUp, "in the middle: still");
    hold(list, 335, 480);
    assert.ok(list.scrollTop > afterUp, "bottom zone: back down");
  });

  test("the list's position on the page is read every tick, so a page that scrolled under the drag is followed", () => {
    const { clock, scroller } = make();
    const list = fakeList({ scrollTop: 300 });
    scroller.update(list, 220);
    clock.advance(160);
    assert.equal(list.scrollTop, 300, "the middle of the list");
    // the page scrolls down 150 px: the same pointer position is now near the list's top edge
    list.getBoundingClientRect = () => ({ top: 220 - 10, bottom: 220 - 10 + 240, left: 10, right: 200 });
    scroller.update(list, 220);
    clock.advance(160);
    assert.ok(list.scrollTop < 300);
  });

  test("a missing element or a position that is not a number is ignored: no timer, no error", () => {
    const { clock, scroller } = make();
    scroller.update(null, 105);
    scroller.update(undefined, 105);
    scroller.update(fakeList(), NaN);
    scroller.update(fakeList(), undefined);
    assert.equal(scroller.isRunning(), false);
    assert.equal(clock.timerCount(), 0);
  });

  test("with no replaced timer it uses the real ones, and stop() cleans them up", async () => {
    const scroller = createDragAutoScroller({ tickMs: 5 });
    const list = fakeList({ scrollTop: 400 });
    scroller.update(list, 220); // the middle of the list, so nothing should move however long it runs
    assert.equal(scroller.isRunning(), true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(list.scrollTop, 400, "the middle: still");
    scroller.stop();
    assert.equal(scroller.isRunning(), false);
  });
});
