import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Opening the app with no connection (Pass 123): a small service worker, public/sw.js,
// registered once the page has finished loading so it never slows the first paint. Built
// versions only (npm run dev has none). A browser that refuses it (some private windows,
// older browsers) just keeps working as it always did. `update()` makes the browser look
// for a changed worker on every visit, which is also what carries the way back
// (DEPLOYMENT.md, "Turning the offline worker off") to a device that has the old one.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const registerWorker = () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  };
  if (document.readyState === "complete") registerWorker();
  else window.addEventListener("load", registerWorker, { once: true });
}
