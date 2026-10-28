/*  MeasureOne service worker (Pass 123): lets the app OPEN with no connection.
 *
 *  What it does, and nothing else:
 *   - The page ("/"): ask the network first, and only if that fails serve the copy saved
 *     from the last visit that worked. So while there is a connection a new version always
 *     shows, and the app can never be stuck on an old page.
 *   - The app's own files under /assets/ (their names change whenever their content does):
 *     serve the saved copy if there is one, otherwise fetch it and save it.
 *   - Everything else is left alone, so the browser handles it as if this file did not
 *     exist: other websites (the account service, fonts), every request that is not a GET,
 *     and any other path.
 *
 *  Change VERSION whenever this file changes: caches made by other versions are deleted
 *  when the new version takes over.
 *
 *  The way back, if this ever causes trouble, is in DEPLOYMENT.md ("Turning the offline
 *  worker off"): replace this file with the self-removing worker described there.
 *
 *  Plain ES5 on purpose. Files in public/ reach the browser exactly as written, so nothing
 *  rewrites newer syntax for Safari 14; test/browser-compat.test.mjs checks them too.
 */
"use strict";

var VERSION = "1";
var PREFIX = "measureone-app-";
var CACHE = PREFIX + VERSION;
var PAGE = "/";
// The saved /assets/ copies are kept to this many (the files of a few dozen versions of the
// app); the oldest go first. Whatever is missing is fetched and saved again on the next visit.
var MAX_ASSETS = 60;

function noop() {}

function isAsset(url) {
  return url.pathname.indexOf("/assets/") === 0;
}

function isPage(request, url) {
  return request.mode === "navigate" && (url.pathname === "/" || url.pathname === "/index.html");
}

function isHtml(response) {
  return (response.headers.get("content-type") || "").indexOf("text/html") !== -1;
}

// Only a good answer from this very site is worth saving.
function savable(response) {
  return !!response && response.ok && response.type === "basic";
}

function trim(cache) {
  return cache.keys().then(function (requests) {
    var assets = requests.filter(function (request) {
      return isAsset(new URL(request.url));
    });
    var extra = assets.length - MAX_ASSETS;
    if (extra <= 0) return null;
    return Promise.all(
      assets.slice(0, extra).map(function (request) {
        return cache.delete(request);
      })
    );
  });
}

// Saves the page and the files it names, right when this worker is installed, so the app
// opens offline from the very next visit instead of the one after. Never fails the install:
// whatever cannot be fetched now is saved the first time the app asks for it.
function warm() {
  return caches.open(CACHE).then(function (cache) {
    return fetch(PAGE, { cache: "no-cache" }).then(function (response) {
      if (!savable(response)) return null;
      var copy = response.clone();
      return Promise.all([cache.put(PAGE, copy), response.text()]).then(function (results) {
        var seen = {};
        var urls = (results[1].match(/\/assets\/[A-Za-z0-9._-]+/g) || []).filter(function (url) {
          if (seen[url]) return false;
          seen[url] = true;
          return true;
        });
        return Promise.all(
          urls.map(function (url) {
            return cache.add(url).catch(noop);
          })
        );
      });
    });
  });
}

function answerPage(event) {
  return fetch(event.request).then(
    function (response) {
      if (savable(response) && isHtml(response)) {
        var copy = response.clone();
        event.waitUntil(
          caches
            .open(CACHE)
            .then(function (cache) {
              return cache.put(PAGE, copy);
            })
            .catch(noop)
        );
      }
      return response;
    },
    function () {
      // No connection: the page saved from the last visit that worked, if there is one,
      // otherwise exactly what the browser would have shown with no worker at all.
      return caches
        .open(CACHE)
        .then(function (cache) {
          return cache.match(PAGE, { ignoreVary: true });
        })
        .then(
          function (saved) {
            return saved || Response.error();
          },
          function () {
            return Response.error();
          }
        );
    }
  );
}

function answerAsset(event) {
  var request = event.request;
  return caches.open(CACHE).then(
    function (cache) {
      return cache.match(request, { ignoreVary: true }).then(
        function (saved) {
          if (saved) return saved;
          return fetch(request).then(function (response) {
            if (savable(response)) {
              var copy = response.clone();
              event.waitUntil(
                cache
                  .put(request, copy)
                  .then(function () {
                    return trim(cache);
                  })
                  .catch(noop)
              );
            }
            return response;
          });
        },
        function () {
          return fetch(request);
        }
      );
    },
    function () {
      // The browser would not give this worker any storage: plain network.
      return fetch(request);
    }
  );
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    warm()
      .catch(noop)
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (name) {
              return name.indexOf(PREFIX) === 0 && name !== CACHE;
            })
            .map(function (name) {
              return caches.delete(name);
            })
        );
      })
      .catch(noop)
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET" || request.headers.get("range")) return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isPage(request, url)) event.respondWith(answerPage(event));
  else if (isAsset(url)) event.respondWith(answerAsset(event));
});
