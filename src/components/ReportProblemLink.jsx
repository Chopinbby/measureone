import { reportProblem, REPORT_LABEL } from "../lib/reportProblem";

// The "Report a problem" link (Pass 132). A plain link that opens a new message in the person's
// own email app, addressed to the contact address; nothing is sent until they press send there.
// What the message holds is decided and tested in lib/reportProblem.js. This only reads the two
// things that file takes: the address the app is open at and the browser's own name text.
//
// It is a real <a href="mailto:...">, not a script, so it still works if the page's script is
// the thing that broke, and it never touches a piece, the account or storage. Pass
// `className="ghost-btn"` for the button look (Settings) or leave the default for a quiet text
// link (the welcome screen).
export function ReportProblemLink({ className = "link-btn", children }) {
  const hostname = typeof window !== "undefined" ? window.location?.hostname : undefined;
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : undefined;
  const { href } = reportProblem({ hostname, userAgent });
  return (
    <a className={className} href={href}>
      {children || REPORT_LABEL}
    </a>
  );
}
