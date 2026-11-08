// Pass 132: the "Report a problem" link.
//
// A plain mailto: link to the contact address (hello@measureone.app, which forwards to the
// owner's inbox through ImprovMX, Pass 129). Phase 3 Design G (docs/Accounts-and-Backend.md):
// no error-reporting service during invitations, because one would see error messages and those
// can include piece names. Nothing goes through any server of ours or anyone else's: the
// person's own email app opens with a note ready, and nothing is sent until they press send in it.
//
// What the note carries is decided here, in one place, so a test can pin it. It holds ONLY the
// address the app is opened at and the browser's own name text, both shown in the draft where the
// person can delete them. It takes nothing from a piece, the technique library, the account or
// storage, and the function only reads the two named inputs, so a caller cannot pass more in by
// accident. Pure; no window, no storage. The component reads window.location.hostname and
// navigator.userAgent and hands them over.

export const CONTACT_ADDRESS = "hello@measureone.app";
export const REPORT_LABEL = "Report a problem";
export const REPORT_SUBJECT = "MeasureOne: a problem";

const UNKNOWN = "unknown";
const MAX_BROWSER_LENGTH = 200;

// One line of plain text: control characters (line breaks included) become spaces, runs of spaces
// collapse, the ends are trimmed and the length is capped. Anything that isn't text, or is empty
// after cleaning, is "unknown". A line break inside a value must never be able to start a new
// line of the note, and the value is percent-encoded again when the link is built.
function oneLine(value, maxLength) {
  if (typeof value !== "string") return UNKNOWN;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return UNKNOWN;
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

// A web address's host only: letters, digits, dots, hyphens, and the colon and brackets a port or
// an IPv6 address brings. Anything else is "unknown" rather than cleaned up, because a host that
// isn't one tells us nothing and must not carry text into the note.
function cleanHost(hostname) {
  if (typeof hostname !== "string") return UNKNOWN;
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return /^[a-z0-9.\-:[\]]{1,253}$/.test(host) ? host : UNKNOWN;
}

// The whole note, as the person will see it in their email app.
export function reportBody({ hostname, userAgent } = {}) {
  return [
    "What happened?",
    "",
    "",
    "What were you trying to do?",
    "",
    "",
    "Please leave out anything private, such as piece names.",
    "The two lines below were added by the app, so we can see which address and browser you are using. You can delete them.",
    `Address: ${cleanHost(hostname)}`,
    `Browser: ${oneLine(userAgent, MAX_BROWSER_LENGTH)}`,
  ].join("\r\n");
}

// { address, subject, body, href }. `href` is the mailto: link. Subject and body are encoded with
// encodeURIComponent (spaces as %20, which mailto needs, never "+"), so a "&" or "?" inside a value
// can't start a new field such as cc= or bcc=.
export function reportProblem({ hostname, userAgent } = {}) {
  const body = reportBody({ hostname, userAgent });
  const href =
    `mailto:${CONTACT_ADDRESS}` +
    `?subject=${encodeURIComponent(REPORT_SUBJECT)}` +
    `&body=${encodeURIComponent(body)}`;
  return { address: CONTACT_ADDRESS, subject: REPORT_SUBJECT, body, href };
}
