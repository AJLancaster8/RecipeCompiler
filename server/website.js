// Serves the Recipe App website (the Expo web build in ./dist) from the
// recipe server, so opening http://<server>:3000 in a browser shows the app
// rather than raw data. The data itself lives under /api/… and needs a
// signed-in session.
//
// Build (or rebuild) the website with:  npm run build:web

const fs = require("node:fs");
const path = require("node:path");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// The site only ever loads its own files and talks to its own server.
// (Inline styles are needed by react-native-web; blob:/data: by the photo
// picker and image resizer.)
const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = {
  "Content-Security-Policy": SITE_CSP,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), payment=()",
};

const NOT_BUILT_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Recipe App</title>
<style>body{font-family:system-ui,sans-serif;background:#faf7f2;color:#2b2118;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
code{background:#efe8de;padding:2px 6px;border-radius:6px}</style></head>
<body><main><h1>The website hasn't been built yet</h1>
<p>On the server, run <code>npm run build:web</code>, then reload this page.</p></main></body></html>`;

function createWebsite(webDir) {
  const root = path.resolve(webDir);
  const indexPath = path.join(root, "index.html");

  function sendFile(req, res, filePath, cacheForever) {
    let data;
    try {
      data = fs.readFileSync(filePath);
    } catch {
      return sendText(res, 404, "Not found");
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": data.length,
      // Built files have a content hash in their name, so they never change.
      "Cache-Control": cacheForever ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  }

  function sendText(res, status, text) {
    res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end(text);
  }

  // pathname: the URL path, e.g. "/", "/discover", "/_expo/static/js/web/entry-abc.js"
  function serve(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method not allowed");

    if (!fs.existsSync(indexPath)) {
      res.writeHead(503, { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8" });
      return res.end(NOT_BUILT_PAGE);
    }

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return sendText(res, 400, "Bad request");
    }
    // No hidden files, no escaping the website folder.
    const segments = decoded.split("/").filter(Boolean);
    if (decoded.includes("\0") || segments.some((s) => s.startsWith(".") || s.includes("\\"))) {
      return sendText(res, 404, "Not found");
    }
    const filePath = path.resolve(root, ...segments);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) return sendText(res, 404, "Not found");

    let stat = null;
    try {
      stat = fs.statSync(filePath);
    } catch {
      // not a file — handled below
    }
    if (stat?.isFile()) {
      const hashed = segments[0] === "_expo" || segments[0] === "assets";
      return sendFile(req, res, filePath, hashed);
    }
    // A missing file (e.g. an old script) is a real 404…
    if (path.extname(decoded)) return sendText(res, 404, "Not found");
    // …but any other path is a page of the app (/discover, /recipe, …),
    // which the app's own router shows.
    return sendFile(req, res, indexPath, false);
  }

  return { serve, isBuilt: () => fs.existsSync(indexPath) };
}

module.exports = { createWebsite, SECURITY_HEADERS };
