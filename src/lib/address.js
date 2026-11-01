// Pass 128: the app's own web address, and the quiet "moved" note on the old ones.
//
// The owner bought measureone.app (2026-11-01) and it serves the same app as the three
// vercel.app addresses. Those keep working on purpose (Phase 3 Design H, docs/Accounts-and-
// Backend.md): the browser keeps pieces per address, so a signed-out person's pieces exist
// only at the address they were made on, and a forced redirect would strand them. Instead the
// app says, once and quietly, where it lives now.
//
// Pure and tested (test/address.test.mjs). App.jsx only reads window.location.hostname and
// draws what `movedNote` returns; nothing here touches storage, the account or a piece.

export const NEW_ADDRESS = "measureone.app";
export const NEW_ADDRESS_URL = `https://${NEW_ADDRESS}/`;

// EXACTLY these three, never a ".vercel.app" suffix test: Vercel gives every preview its own
// vercel.app address (the owner's tries of a pull request), and a preview must not carry the
// note. The new address, www, localhost and Vercel's per-deployment addresses are not here
// either, so none of them shows it.
export const OLD_ADDRESSES = [
  "measureone.vercel.app",
  "measureone-git-main-measure-one.vercel.app",
  "measureone-measure-one.vercel.app",
];

// `hostname` is what window.location.hostname gives (no port, no path). Case and one
// trailing dot don't matter to a browser, so they don't matter here; anything that isn't text
// is "not an old address".
export function isOldAddress(hostname) {
  if (typeof hostname !== "string") return false;
  const name = hostname.trim().toLowerCase().replace(/\.$/, "");
  return OLD_ADDRESSES.includes(name);
}

// What the note says, or null when there is no note. The two wordings are the card's:
//   signed in:  where the pieces already are (the account), so open the new address and sign in;
//   signed out: the pieces exist only in this browser, so export here and import there, which
//               needs something to export. With nothing on this device the export sentence
//               would point at nothing, so it just says where to go.
// `exportButton` says whether the note offers the Export button. A device that is signed in
// never does: its pieces come from the account.
export function movedNote({ hostname, signedIn, pieceCount } = {}) {
  if (!isOldAddress(hostname)) return null;
  const title = `MeasureOne has moved to ${NEW_ADDRESS}.`;
  if (signedIn) return { title, sub: "Open it there and sign in to bring your pieces.", exportButton: false };
  if (Number.isFinite(pieceCount) && pieceCount > 0) {
    return { title, sub: "Export a backup here, then import it there.", exportButton: true };
  }
  return { title, sub: "Open it there.", exportButton: false };
}
