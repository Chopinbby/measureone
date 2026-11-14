import { useEffect, useRef, useState } from "react";
import { botCheckSiteKey, loadTurnstile, BOT_CHECK_UNAVAILABLE_MESSAGE } from "../lib/backend";

// The bot check (Pass 135, docs/Accounts-and-Backend.md, "Open sign-up"). Cloudflare
// Turnstile: most people see nothing at all, because it runs as "interaction only" and
// shows a small box only when it can't tell by itself. It is on every window that makes
// a call the service guards (sign up, password sign-in, forgot password, and the password
// re-check before deleting an account), because Supabase asks for the token on all of them
// once the project's bot check is on.
//
// What it does: loads Cloudflare's script (only now, never at startup; lib/backend.js),
// draws the widget in a box, and tells the window two things through `onChange(token, status)`:
//   status "working"      the widget is loading or thinking (the window waits to send)
//   status "ready"        a token is ready; `token` is it
//   status "unavailable"  the script couldn't load or the widget failed; the window lets the
//                         person try anyway, and the service says whether a token was needed
// A token works ONCE, so the window bumps `resetCount` after every attempt, win or lose, and
// this takes a new one. It never logs the token. Rendered only when the build has the site
// key (isBotCheckConfigured); with none, nothing here runs and no script is fetched.
export function BotCheck({ onChange, resetCount = 0 }) {
  const box = useRef(null);
  const widgetId = useRef(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  const [unavailable, setUnavailable] = useState(false);
  // True once the widget has been working for a few seconds with no token: most people never
  // see this, but a button that stays grey with no word why would look broken.
  const [slow, setSlow] = useState(false);
  const slowTimer = useRef(null);

  const say = (token, status) => {
    clearTimeout(slowTimer.current);
    if (status === "working") slowTimer.current = setTimeout(() => setSlow(true), 4000);
    else setSlow(false);
    if (status === "ready") setUnavailable(false);
    if (latest.current) latest.current(token, status);
  };

  useEffect(() => {
    let cancelled = false;
    say("", "working");
    loadTurnstile().then((turnstile) => {
      if (cancelled) return;
      if (!turnstile || !box.current) {
        setUnavailable(true);
        say("", "unavailable");
        return;
      }
      try {
        widgetId.current = turnstile.render(box.current, {
          sitekey: botCheckSiteKey(),
          appearance: "interaction-only",
          // The app has one look (light); without this the box follows the device and turns
          // dark inside a light window.
          theme: "light",
          // Cloudflare's box is 300 wide at its smallest "flexible" size. A window on a phone
          // can have less room than that (seen at a 363-wide screen: 269), so there it takes
          // the narrow "compact" shape instead of running into the window's edge.
          size: box.current.clientWidth >= 300 ? "flexible" : "compact",
          callback: (token) => say(token, "ready"),
          "expired-callback": () => say("", "working"),
          "timeout-callback": () => say("", "working"),
          "error-callback": () => {
            setUnavailable(true);
            say("", "unavailable");
          },
        });
      } catch (e) {
        setUnavailable(true);
        say("", "unavailable");
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(slowTimer.current);
      try {
        if (widgetId.current !== null && window.turnstile) window.turnstile.remove(widgetId.current);
      } catch (e) {
        /* the widget is gone either way */
      }
      widgetId.current = null;
    };
  }, []);

  // A new attempt needs a new token: the one just used is spent.
  useEffect(() => {
    if (!resetCount || widgetId.current === null) return;
    try {
      say("", "working");
      window.turnstile.reset(widgetId.current);
    } catch (e) {
      setUnavailable(true);
      say("", "unavailable");
    }
  }, [resetCount]);

  return (
    <div style={{ margin: "4px 0 12px" }}>
      <div ref={box} />
      {unavailable && (
        <p className="wizard-hint" style={{ margin: "6px 0 0" }} role="status">
          {BOT_CHECK_UNAVAILABLE_MESSAGE}
        </p>
      )}
      {slow && !unavailable && (
        <p className="wizard-hint" style={{ margin: "6px 0 0" }} role="status">
          Checking that you're not a bot. If a box appears above, tick it to go on.
        </p>
      )}
    </div>
  );
}
