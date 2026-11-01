// Pass 128 (src/lib/address.js): the app's own web address and the quiet "moved" note on the
// three old vercel.app addresses. The note must show on exactly those three and nowhere else
// (never on the new address, a preview, a per-deployment address or localhost), and say the
// card's words for each state.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NEW_ADDRESS, NEW_ADDRESS_URL, OLD_ADDRESSES, isOldAddress, movedNote } from "../src/lib/address.js";

const OLD = "measureone-git-main-measure-one.vercel.app";

describe("[Pass 128] which addresses carry the note", () => {
  test("the three old addresses, exactly", () => {
    assert.deepEqual([...OLD_ADDRESSES].sort(), [
      "measureone-git-main-measure-one.vercel.app",
      "measureone-measure-one.vercel.app",
      "measureone.vercel.app",
    ]);
    assert.equal(NEW_ADDRESS, "measureone.app");
    assert.equal(NEW_ADDRESS_URL, "https://measureone.app/");
  });

  test("each old address is recognised, whatever its case, a trailing dot or stray spaces", () => {
    for (const a of OLD_ADDRESSES) {
      assert.equal(isOldAddress(a), true, a);
      assert.equal(isOldAddress(a.toUpperCase()), true, a.toUpperCase());
      assert.equal(isOldAddress(`${a}.`), true, `${a}.`);
      assert.equal(isOldAddress(`  ${a} `), true);
    }
  });

  test("[regression, Pass 128] never the new address or its www", () => {
    assert.equal(isOldAddress(NEW_ADDRESS), false);
    assert.equal(isOldAddress(`www.${NEW_ADDRESS}`), false);
    assert.equal(OLD_ADDRESSES.includes(NEW_ADDRESS), false);
    for (const signedIn of [true, false]) {
      assert.equal(movedNote({ hostname: NEW_ADDRESS, signedIn, pieceCount: 5 }), null);
      assert.equal(movedNote({ hostname: `www.${NEW_ADDRESS}`, signedIn, pieceCount: 0 }), null);
    }
  });

  test("[regression, Pass 128] never a preview or per-deployment address: only the three exact names, not a .vercel.app suffix", () => {
    for (const host of [
      "measureone-jjwajut3k-measure-one.vercel.app", // a deployment's own address (DEPLOYMENT.md)
      "measureone-git-claude-pass-128-moved-note-measure-one.vercel.app", // a branch preview
      "measureone-git-claude-pass-126-build-measure-one.vercel.app",
      "some-other-project.vercel.app",
      "vercel.app",
    ]) {
      assert.equal(isOldAddress(host), false, host);
      assert.equal(movedNote({ hostname: host, signedIn: false, pieceCount: 3 }), null, host);
    }
  });

  test("never localhost, an address of numbers, or a look-alike", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "[::1]",
      "::1",
      "app.localhost",
      "measureone.vercel.app.evil.com",
      "evil.measureone.vercel.app",
      "xmeasureone.vercel.app",
      "measureone-vercel.app",
      "measureone.vercel.app:8080", // a port is not part of window.location.hostname
    ]) {
      assert.equal(isOldAddress(host), false, host);
    }
  });

  test("anything that isn't text is not an old address, and never throws", () => {
    for (const v of [undefined, null, 0, 5, {}, [], "", "  ", true]) {
      assert.equal(isOldAddress(v), false);
      assert.equal(movedNote({ hostname: v, signedIn: true, pieceCount: 1 }), null);
    }
    assert.equal(movedNote(), null);
    assert.equal(movedNote({}), null);
  });
});

describe("[Pass 128] what the note says", () => {
  test("signed in: where the pieces already are, no Export button", () => {
    const n = movedNote({ hostname: OLD, signedIn: true, pieceCount: 25 });
    assert.equal(`${n.title} ${n.sub}`, "MeasureOne has moved to measureone.app. Open it there and sign in to bring your pieces.");
    assert.equal(n.exportButton, false);
  });

  test("signed out with pieces: export here, import there, with the Export button", () => {
    const n = movedNote({ hostname: OLD, signedIn: false, pieceCount: 3 });
    assert.equal(`${n.title} ${n.sub}`, "MeasureOne has moved to measureone.app. Export a backup here, then import it there.");
    assert.equal(n.exportButton, true);
  });

  test("signed out with nothing on this device: no export sentence and no Export button (nothing to export)", () => {
    for (const pieceCount of [0, undefined, null, NaN, -1]) {
      const n = movedNote({ hostname: OLD, signedIn: false, pieceCount });
      assert.equal(`${n.title} ${n.sub}`, "MeasureOne has moved to measureone.app. Open it there.", String(pieceCount));
      assert.equal(n.exportButton, false);
    }
  });

  test("signed in wins over how many pieces there are", () => {
    for (const pieceCount of [0, 1, 99]) {
      const n = movedNote({ hostname: OLD, signedIn: true, pieceCount });
      assert.equal(n.exportButton, false);
      assert.match(n.sub, /sign in to bring your pieces/);
    }
  });

  test("every old address gets the note", () => {
    for (const hostname of OLD_ADDRESSES) assert.notEqual(movedNote({ hostname, signedIn: false, pieceCount: 1 }), null, hostname);
  });

  test("no em dash in what the person reads (the house rule for copy)", () => {
    for (const signedIn of [true, false]) {
      for (const pieceCount of [0, 4]) {
        const n = movedNote({ hostname: OLD, signedIn, pieceCount });
        assert.equal(/—/.test(`${n.title} ${n.sub}`), false);
      }
    }
  });
});
