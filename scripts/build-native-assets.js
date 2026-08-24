// Copies the web app's source files into www/, which is the webDir Capacitor
// packages into the native iOS/Android shells. The PWA itself is served
// straight from the project root (see .claude/launch.json / index.html) so
// this only exists to give Capacitor a distinct, non-recursive directory to
// copy — per Capacitor's requirement, webDir can't be "." (the project root),
// since that would try to copy node_modules/ios/android/etc. into themselves.
//
// sw.js is deliberately NOT copied: the native shell already bundles every
// asset locally, so a service worker's cache-the-app-shell strategy is
// redundant there and only risks the same staleness issues seen in browser
// testing. index.html's service worker registration already fails silently
// (see its .catch()) when sw.js is absent, so no other change is needed.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WWW = path.join(ROOT, "www");

const FILES_TO_COPY = [
  "index.html",
  "style.css",
  "data.js",
  "config.js",
  "api.js",
  "app.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
];

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

FILES_TO_COPY.forEach((file) => {
  fs.copyFileSync(path.join(ROOT, file), path.join(WWW, file));
});

console.log(`Copied ${FILES_TO_COPY.length} files into www/`);
