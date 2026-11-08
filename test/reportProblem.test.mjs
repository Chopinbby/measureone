// Pass 132 (src/lib/reportProblem.js): the "Report a problem" email link.
//
// What must stay true: the link goes to the contact address and nowhere else; the note carries
// only the address the app is opened at and the browser's name text (never a piece, a name, an
// account or anything from storage); a value that contains line breaks or "&" can't start a new
// line of the note or a new field such as cc= or bcc=; and nothing in the copy uses an em dash.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CONTACT_ADDRESS, REPORT_LABEL, REPORT_SUBJECT, reportBody, reportProblem } from "../src/lib/reportProblem.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

// Read a mailto: link back the way an email app does: the address, then each field decoded.
function readMailto(href) {
  assert.ok(href.startsWith("mailto:"), href);
  const [head, query = ""] = href.slice("mailto:".length).split("?");
  const fields = {};
  const keys = [];
  for (const pair of query.split("&")) {
    const at = pair.indexOf("=");
    const key = pair.slice(0, at);
    keys.push(key);
    fields[key] = decodeURIComponent(pair.slice(at + 1));
  }
  return { to: decodeURIComponent(head), fields, keys, ampersands: (href.match(/&/g) || []).length, questionMarks: (href.match(/\?/g) || []).length };
}

describe("[Pass 132] where the link goes", () => {
  test("the contact address, the label and the subject are the agreed ones", () => {
    assert.equal(CONTACT_ADDRESS, "hello@measureone.app");
    assert.equal(REPORT_LABEL, "Report a problem");
    assert.equal(REPORT_SUBJECT, "MeasureOne: a problem");
  });

  test("it is a mailto: link to that one address, with a subject and a body and no other field", () => {
    const r = reportProblem({ hostname: "measureone.app", userAgent: UA });
    const m = readMailto(r.href);
    assert.equal(m.to, CONTACT_ADDRESS);
    assert.deepEqual(m.keys, ["subject", "body"]);
    assert.equal(m.fields.subject, REPORT_SUBJECT);
    assert.equal(m.fields.body, r.body);
    assert.equal(r.address, CONTACT_ADDRESS);
    assert.equal(r.subject, REPORT_SUBJECT);
  });

  test("spaces are %20, never '+', and line breaks are CRLF, which is what mailto expects", () => {
    const r = reportProblem({ hostname: "measureone.app", userAgent: UA });
    assert.ok(!r.href.includes("+"), "a '+' would show as a plus sign in some email apps");
    assert.ok(r.href.includes("%0D%0A"));
    assert.ok(!/(^|[^D])%0A/.test(r.href), "a bare line feed, not CRLF");
    assert.ok(r.body.includes("\r\n"));
  });
});

describe("[Pass 132] what the note carries", () => {
  test("the questions, the privacy line, and exactly two details: address and browser", () => {
    const body = reportBody({ hostname: "measureone.app", userAgent: UA });
    const lines = body.split("\r\n");
    assert.equal(lines[0], "What happened?");
    assert.ok(lines.includes("What were you trying to do?"));
    assert.ok(lines.includes("Please leave out anything private, such as piece names."));
    assert.equal(lines.filter((l) => l.startsWith("Address: ")).length, 1);
    assert.equal(lines.filter((l) => l.startsWith("Browser: ")).length, 1);
    assert.equal(lines.at(-2), "Address: measureone.app");
    assert.equal(lines.at(-1), `Browser: ${UA}`);
  });

  test("it reads only hostname and userAgent: anything else passed in never reaches the note", () => {
    const r = reportProblem({
      hostname: "measureone.app",
      userAgent: UA,
      pieces: { p1: { name: "Moonlight Sonata" } },
      pieceName: "Moonlight Sonata",
      email: "someone@example.com",
      userId: "11111111-2222-3333-4444-555555555555",
    });
    const everything = JSON.stringify(r) + decodeURIComponent(r.href);
    for (const secret of ["Moonlight", "someone@example.com", "11111111-2222"]) {
      assert.ok(!everything.includes(secret), secret);
    }
  });

  test("the same input gives the same link (nothing time or random in it)", () => {
    const a = reportProblem({ hostname: "measureone.app", userAgent: UA });
    const b = reportProblem({ hostname: "measureone.app", userAgent: UA });
    assert.deepEqual(a, b);
  });
});

describe("[Pass 132] values that are not what they should be", () => {
  test("a line break in the browser text can't start a new line of the note", () => {
    const body = reportBody({ hostname: "measureone.app", userAgent: "Safari\r\nBcc: boss@example.com\nCc: x@y.z" });
    const lines = body.split("\r\n");
    assert.equal(lines.at(-1), "Browser: Safari Bcc: boss@example.com Cc: x@y.z");
    assert.equal(lines.filter((l) => l.startsWith("Bcc:") || l.startsWith("Cc:")).length, 0);
  });

  test("'&', '?' and '=' in the browser text can't add a field such as cc= or bcc=", () => {
    const r = reportProblem({ hostname: "measureone.app", userAgent: "x&cc=boss@example.com&bcc=a@b.c?subject=Hi" });
    const m = readMailto(r.href);
    assert.deepEqual(m.keys, ["subject", "body"]);
    assert.equal(m.ampersands, 1);
    assert.equal(m.questionMarks, 1);
    assert.equal(m.fields.subject, REPORT_SUBJECT);
    assert.ok(m.fields.body.endsWith("Browser: x&cc=boss@example.com&bcc=a@b.c?subject=Hi"));
  });

  test("a host that isn't one is 'unknown', not cleaned up and carried along", () => {
    for (const bad of ["measureone.app\r\nBcc: x@y.z", "a b.example", "evil.com/path?x=1", "", undefined, null, 42, {}]) {
      assert.match(reportBody({ hostname: bad, userAgent: UA }), /Address: unknown(\r\n|$)/, String(bad));
    }
  });

  test("case, spaces and a trailing dot don't matter in a host; a port and 'localhost' are fine", () => {
    assert.match(reportBody({ hostname: "  MeasureOne.APP. ", userAgent: UA }), /Address: measureone\.app\r\n/);
    assert.match(reportBody({ hostname: "localhost:5173", userAgent: UA }), /Address: localhost:5173\r\n/);
    assert.match(reportBody({ hostname: "[::1]", userAgent: UA }), /Address: \[::1\]\r\n/);
  });

  test("no browser text is 'unknown'; very long text is cut, not sent whole", () => {
    for (const none of [undefined, null, "", "   \n ", 7, {}]) {
      assert.match(reportBody({ hostname: "measureone.app", userAgent: none }), /Browser: unknown$/, String(none));
    }
    const long = reportBody({ hostname: "measureone.app", userAgent: "a".repeat(5000) });
    const browser = long.split("\r\n").at(-1);
    assert.equal(browser.length, "Browser: ".length + 200);
  });

  test("called with nothing at all, it still gives a working link", () => {
    const r = reportProblem();
    assert.equal(readMailto(r.href).to, CONTACT_ADDRESS);
    assert.match(r.body, /Address: unknown\r\nBrowser: unknown$/);
  });
});

describe("[Pass 132] house style", () => {
  test("no em dash anywhere in the label, subject or note", () => {
    const r = reportProblem({ hostname: "measureone.app", userAgent: UA });
    for (const text of [REPORT_LABEL, REPORT_SUBJECT, r.body]) assert.ok(!text.includes("—"), text);
  });
});
