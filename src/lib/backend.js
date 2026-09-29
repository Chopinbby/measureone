/* ------------------------------------------------------------------ */
/*  The connection to the account backend (Supabase), Pass 108.       */
/*                                                                     */
/*  Optional by design (docs/Accounts-and-Backend.md, Decided 3 and    */
/*  Design G): the client exists only when both connection settings    */
/*  are present. Without them `supabase` is null and                   */
/*  isBackendConfigured() is false, and the app runs exactly as it     */
/*  did before accounts, saving to this browser only. That's the state */
/*  of the live site, of a fresh checkout, and of `npm test`.           */
/*                                                                     */
/*  Only the public key belongs here (the "anon" / publishable key).   */
/*  The database's row-level security rules decide what each account   */
/*  may read and write, so this key is safe in the browser. The secret  */
/*  (service_role) key must never be added: it skips those rules.      */
/*                                                                     */
/*  Nothing imports this yet: sign-in is Pass 109.                     */
/* ------------------------------------------------------------------ */

import { createClient } from "@supabase/supabase-js";

// import.meta.env is Vite's; it's undefined under node:test, hence the `|| {}`.
const env = import.meta.env || {};
const url = typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL.trim() : "";
const key = typeof env.VITE_SUPABASE_ANON_KEY === "string" ? env.VITE_SUPABASE_ANON_KEY.trim() : "";

function makeClient() {
  if (!url || !key) return null;
  try {
    // Session persistence is left at the library's defaults.
    return createClient(url, key);
  } catch (e) {
    // A malformed setting (e.g. a URL that isn't one) mustn't stop the app
    // loading: without a backend it simply runs as it did before accounts.
    console.warn("MeasureOne: backend settings are invalid, running without an account backend.", e);
    return null;
  }
}

export const supabase = makeClient();

export function isBackendConfigured() {
  return supabase !== null;
}
