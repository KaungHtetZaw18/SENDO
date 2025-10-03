// sender.js (ES6)
(() => {
  // ----- helpers -----
  const readMeta = (name) => {
    const m = [...document.getElementsByTagName("meta")].find(
      (el) => el.getAttribute("name") === name
    );
    return m?.getAttribute("content") || "";
  };

  let API = (readMeta("sendo-api-base") || "").replace(/\/+$/, "");
  if (!API) API = ""; // same-origin fallback

  const $ = (id) => document.getElementById(id);
  const setText = (id, t) => {
    const el = $(id);
    if (el) el.textContent = t || "";
  };
  const show = (id) => $(id)?.classList.remove("hide");
  const hide = (id) => $(id)?.classList.add("hide");

  const xhr = (method, url, body) =>
    new Promise((resolve) => {
      try {
        const x = new XMLHttpRequest();
        x.open(method, API + url, true);
        if (body) x.setRequestHeader("Content-Type", "application/json");
        x.onreadystatechange = () => {
          if (x.readyState === 4) resolve(x);
        };
        x.onerror = () => resolve(null);
        x.send(body ? JSON.stringify(body) : null);
      } catch {
        resolve(null);
      }
    });

  // ----- state -----
  const state = {
    sessionId: null,
    senderToken: null,
    hbTimer: null,
    pollTimer: null,
  };

  // ----- parse params -----
  const parseParams = () => {
    let sid = null,
      tok = null;
    try {
      const qp = new URLSearchParams(window.location.search);
      sid = qp.get("sessionId");
      tok = qp.get("t");
    } catch {}
    if (!sid || !tok) {
      const s = window.location.search || "";
      const m1 = /[?&]sessionId=([^&]+)/.exec(s);
      const m2 = /[?&]t=([^&]+)/.exec(s);
      if (m1) sid = decodeURIComponent(m1[1] || "");
      if (m2) tok = decodeURIComponent(m2[1] || "");
    }
    return { sid, tok };
  };

  // ----- heartbeat / poll -----
  const startHeartbeat = () => {
    stopHeartbeat();
    state.hbTimer = setInterval(() => {
      if (!state.sessionId) return;
      xhr("POST", "/api/heartbeat", {
        sessionId: state.sessionId,
        role: "sender",
      });
    }, 30000);
  };
  const stopHeartbeat = () => {
    if (state.hbTimer) clearInterval(state.hbTimer);
    state.hbTimer = null;
  };

  const startPoll = () => {
    stopPoll();
    state.pollTimer = setInterval(async () => {
      if (!state.sessionId) return;
      const r = await xhr(
        "GET",
        `/api/session/${encodeURIComponent(state.sessionId)}/status`
      );
      if (!r || r.status !== 200) {
        // receiver closed / TTL / network problem: land
        return teardownToLanding();
      }
      let json;
      try {
        json = JSON.parse(r.responseText);
      } catch {
        return;
      }
      if (json && (json.closed || json.status === "closed")) {
        return teardownToLanding();
      }
    }, 1500);
  };
  const stopPoll = () => {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  };

  // ----- disconnect (single path) -----
  const disconnectAndLand = (by = "sender") => {
    if (state.sessionId) {
      try {
        const data = JSON.stringify({ sessionId: state.sessionId, by });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(
            (API || "") + "/api/disconnect",
            new Blob([data], { type: "application/json" })
          );
        } else {
          const x = new XMLHttpRequest();
          x.open("POST", (API || "") + "/api/disconnect", false);
          x.setRequestHeader("Content-Type", "application/json");
          try {
            x.send(data);
          } catch (_) {}
        }
      } catch (_) {}
    }
    teardownToLanding();
  };

  const manualDisconnect = () => disconnectAndLand("sender");

  const teardownToLanding = () => {
    stopHeartbeat();
    stopPoll();
    state.sessionId = null;
    state.senderToken = null;
    setTimeout(() => window.location.replace("/"), 50);
  };

  // ----- UI actions -----
  const connect = async () => {
    const code = ($("codeInput")?.value || "").trim().toUpperCase();
    if (code.length !== 4)
      return setText("connectStatus", "Please enter a 4-character key.");
    $("connectBtn").disabled = true;
    setText("connectStatus", "Connecting…");

    const r = await xhr("POST", "/api/connect", { code });
    $("connectBtn").disabled = false;

    if (!r) return setText("connectStatus", "Network error.");
    if (r.status !== 200)
      return setText("connectStatus", "Could not connect. Check the key.");

    let json;
    try {
      json = JSON.parse(r.responseText);
    } catch {
      return setText("connectStatus", "Bad response.");
    }
    if (!json.ok) return setText("connectStatus", json.error || "Failed.");

    state.sessionId = json.sessionId;
    state.senderToken = json.senderToken;

    setText("connectedTo", `Connected to key: ${code}`);
    hide("connectCard");
    show("uploadCard");
    setText("connectStatus", "");
    $("fileInput").value = "";
    $("uploadBtn").disabled = true;

    startHeartbeat();
    startPoll();
  };

  const onFileChange = () => {
    $("uploadBtn").disabled = !$("fileInput")?.files[0];
  };

  const upload = () => {
    if (!state.sessionId || !state.senderToken)
      return setText("uploadStatus", "Not connected.");

    const f = $("fileInput")?.files[0];
    if (!f)
      return setText(
        "uploadStatus",
        "Choose a file first (.epub .mobi .azw .azw3 .pdf .txt)."
      );

    setText("uploadStatus", "Uploading…");
    $("uploadBtn").disabled = true;

    const fd = new FormData();
    fd.append("file", f);

    const url = `/api/upload?sessionId=${encodeURIComponent(
      state.sessionId
    )}&senderToken=${encodeURIComponent(state.senderToken)}`;

    const req = new XMLHttpRequest();
    req.open("POST", (API || "") + url, true);
    req.onreadystatechange = () => {
      if (req.readyState !== 4) return;

      if (req.status !== 200) {
        setText("uploadStatus", "Upload failed.");
        $("uploadBtn").disabled = !$("fileInput")?.files[0];
        return;
      }
      let json;
      try {
        json = JSON.parse(req.responseText);
      } catch {
        setText("uploadStatus", "Bad response.");
        $("uploadBtn").disabled = !$("fileInput")?.files[0];
        return;
      }
      if (!json.ok) {
        setText("uploadStatus", json.error || "Upload failed.");
        $("uploadBtn").disabled = !$("fileInput")?.files[0];
        return;
      }
      const name = json.file?.name || "file";
      setText("uploadStatus", `Uploaded: ${name}`);
      $("fileInput").value = "";
      $("uploadBtn").disabled = true;
    };
    req.onerror = () => {
      setText("uploadStatus", "Network error.");
      $("uploadBtn").disabled = !$("fileInput")?.files[0];
    };
    req.send(fd);
  };

  // ----- auto-join & boot -----
  const flipToUpload = () => {
    hide("connectCard");
    show("uploadCard");
    setText("connectedTo", "Connected by QR — ready to upload.");
    $("fileInput").value = "";
    $("uploadBtn").disabled = true;
  };

  const autoJoinIfParams = async () => {
    const { sid, tok } = parseParams();
    if (!sid || !tok) return false;

    state.sessionId = sid;
    state.senderToken = tok;

    // Flip immediately; retry until DOM is ready
    let tries = 0;
    const tryFlip = () => {
      tries++;
      if ($("uploadCard") && $("connectCard")) {
        flipToUpload();
      } else if (tries < 10) {
        return setTimeout(tryFlip, 30);
      }
    };
    tryFlip();

    // refresh TTL non-blocking
    xhr("POST", "/api/connect", { sessionId: state.sessionId });
    startHeartbeat();
    startPoll();
    return true;
  };

  const wireHandlers = () => {
    $("connectBtn").onclick = connect;
    $("uploadBtn").onclick = upload;
    $("disconnectBtn").onclick = manualDisconnect;
    $("fileInput").addEventListener("change", onFileChange);

    // auto-disconnect on close/offline
    window.addEventListener("pagehide", () => disconnectAndLand("sender"), {
      capture: true,
    });
    window.addEventListener("beforeunload", () => disconnectAndLand("sender"), {
      capture: true,
    });
    window.addEventListener("offline", () => disconnectAndLand("sender"));
  };

  const boot = async () => {
    wireHandlers();
    await autoJoinIfParams();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
