import path from "path";
import { fileURLToPath } from "url";
import { createSession, touchSession } from "../store/sessionStore.js";
import { SESSION_TTL_SECONDS } from "../config/env.js";
import { setNoCache, requestOrigin } from "../app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../../web/public");

export function landing(_req, res) {
  res.sendFile(path.join(publicDir, "index.html"));
}

export function sender(_req, res) {
  res.sendFile(path.join(publicDir, "sender.html"));
}

export function receiverSSR(req, res) {
  try {
    const s = createSession({ ttlSeconds: SESSION_TTL_SECONDS });
    s.lastSeenReceiver = Date.now();
    s.lastSeenSender = 0;
    touchSession(s, SESSION_TTL_SECONDS);

    const qrPath = `/api/qr/${encodeURIComponent(s.id)}.png?v=${Date.now()}`;

    setNoCache(res);
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Send to Kobo/Kindle</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Cache-Control" content="no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<style>
:root { --ink:#000; --muted:#444; --border:#888; --paper:#fff; }
*,*::before,*::after{ box-sizing:border-box; }
html,body{ margin:0; padding:0; background:#fff; color:#000;
  font-family:-apple-system, system-ui, Segoe UI, Roboto, Arial, sans-serif; }
.wrap{ max-width:480px; margin:0 auto 24px; padding:0 10px; }
h1{ text-align:center; font-size:22px; margin:14px 0 2px; }
.sub{ text-align:center; color:#444; font-size:12px; margin-bottom:10px; }
.card{ background:#fff; border:1px solid #888; border-radius:10px; padding:12px; text-align:center; }
.key{ letter-spacing:8px; font-family:ui-monospace, Menlo, Consolas, monospace; font-size:22px; border:1px solid #888; border-radius:8px; padding:8px 10px; margin-bottom:10px;}
#qr{ display:block; width:180px; height:180px; margin:10px auto 0; border:1px solid #888; border-radius:6px;}
.btn{ display:block; width:100%; padding:12px 14px; border:1px solid #888; border-radius:10px; background:#eee; color:#000; font-weight:700; text-decoration:none; margin-top:12px;}
#status,#debug{ text-align:center; font-size:12px; margin-top:8px; min-height:1em; }
#debug{ color:#b00; }
footer{ text-align:center; font-size:12px; color:#000; margin-top:14px; }
</style>
</head>
<body>
  <h1>Send to Kobo/Kindle</h1>
  <div class="sub">E-reader friendly • no animations</div>
  <div class="wrap">
    <div class="card" id="sessionBox">
      <div class="key" id="code">${s.code}</div>
      <img id="qr" alt="QR code" src="${qrPath}">
      <a id="downloadBtn" class="btn" target="_blank" rel="noopener" style="display:none">Download file</a>
      <div id="status">Waiting for Sender to upload…</div>
      <div id="debug"></div>
    </div>
    <footer>Created by <strong>Kaung</strong> • © 2025 Sendo</footer>
  </div>
  <script>
    // Let lite.js enhance without having to create a session again
    window.__SESS_ID__ = ${JSON.stringify(s.id)};
    window.__RECV_TOKEN__ = ${JSON.stringify(s.receiverToken)};
  </script>
  <script src="/lite.js?v=ssr" type="text/javascript"></script>
</body>
</html>`);
  } catch (e) {
    console.error("receiver SSR error:", e);
    res.status(500).send("Receiver is temporarily unavailable.");
  }
}
