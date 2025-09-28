(function () {
  // ---- Config (same-origin API) ----
  var API = "";

  // ---- tiny DOM helpers ----
  function $(id) {
    return document.getElementById(id);
  }
  function setText(id, t) {
    var el = $(id);
    if (el) el.textContent = t || "";
  }
  function setDebug(t) {
    setText("debug", t || "");
  }

  // ---- minimal XHR (JSON) ----
  function xhr(method, url, body, cb) {
    try {
      var x = new XMLHttpRequest();
      x.open(method, API + url, true);
      if (body) x.setRequestHeader("Content-Type", "application/json");
      x.onreadystatechange = function () {
        if (x.readyState === 4) cb(null, x);
      };
      x.onerror = function () {
        cb(new Error("net"), null);
      };
      x.send(body ? JSON.stringify(body) : null);
    } catch (e) {
      cb(e, null);
    }
  }

  // ---- state ----
  var sessionId = null;
  var receiverToken = null;
  var hbTimer = null;
  var pollTimer = null;
  var beaconSent = false;

  // ---- heartbeat ----
  function startHeartbeat() {
    stopHeartbeat();
    hbTimer = setInterval(function () {
      if (!sessionId) return;
      xhr(
        "POST",
        "/api/heartbeat",
        { sessionId: sessionId, role: "receiver" },
        function () {}
      );
    }, 15000);
  }
  function stopHeartbeat() {
    if (hbTimer) {
      clearInterval(hbTimer);
      hbTimer = null;
    }
  }

  // ---- polling ----
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(function () {
      if (!sessionId) return;
      xhr(
        "GET",
        "/api/session/" + encodeURIComponent(sessionId) + "/status",
        null,
        function (err, x) {
          if (err || !x) return;
          if (x.status !== 200) {
            setDebug("status " + x.status + " on /status");
            teardown();
            location.replace("/");
            return;
          }
          var json;
          try {
            json = JSON.parse(x.responseText);
          } catch (_) {
            return;
          }

          if (json.closed) {
            teardown();
            location.replace("/");
            return;
          }

          if (json.hasFile && receiverToken) {
            var href =
              "/api/download/" +
              encodeURIComponent(sessionId) +
              "?receiverToken=" +
              encodeURIComponent(receiverToken);
            var btn = $("downloadBtn");
            if (btn) {
              btn.setAttribute("href", href);
              btn.style.display = "block";
            }
            setText(
              "status",
              "File ready" +
                (json.file && json.file.name ? ": " + json.file.name : "")
            );
          } else {
            var b = $("downloadBtn");
            if (b) b.style.display = "none";
            setText("status", "Waiting for Sender to upload…");
          }
        }
      );
    }, 1500);
  }
  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ---- teardown ----
  function teardown() {
    stopHeartbeat();
    stopPoll();
    sessionId = null;
    receiverToken = null;
    setText("status", "");
  }

  // ---- disconnect beacon ----
  function sendBeaconDisconnect() {
    try {
      if (beaconSent) return;
      if (!sessionId || !navigator.sendBeacon) return;
      beaconSent = true;
      var data = JSON.stringify({ sessionId: sessionId, by: "receiver" });
      navigator.sendBeacon(
        "/api/disconnect",
        new Blob([data], { type: "application/json" })
      );
    } catch {}
  }
  window.addEventListener("pagehide", sendBeaconDisconnect, { capture: true });
  window.addEventListener("beforeunload", sendBeaconDisconnect, {
    capture: true,
  });
  window.addEventListener("offline", sendBeaconDisconnect);

  // ---- init (SSR first, then XHR fallback) ----
  function init() {
    // If server rendered the page with a ready session, use it immediately.
    if (window.__SESS_ID__) {
      sessionId = String(window.__SESS_ID__ || "");
      receiverToken = String(window.__RECV_TOKEN__ || "");
      setText("status", "Waiting for Sender to upload…");

      // Nudge QR to render on some e-ink engines
      var qre = $("qr");
      if (qre && qre.src) qre.src = qre.src.split("?")[0] + "?v=" + Date.now();

      startHeartbeat();
      startPoll();
      return;
    }

    // Otherwise create client-side (GET-first for very old browsers)
    createSessionCompat();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ---- client-side session creation (GET-first) ----
  function createSessionCompat() {
    setText("status", "Creating session…");
    setDebug("");

    // 1) GET first
    xhr("GET", "/api/session/new?v=" + Date.now(), null, function (err, x) {
      if (!err && x && x.status === 200) {
        handleSessionResponse(x);
        return;
      }
      if (x)
        setDebug(
          "GET /api/session/new failed (status " + x.status + "). Trying POST…"
        );

      // 2) Fallback to POST
      xhr("POST", "/api/session", { role: "receiver" }, function (err2, x2) {
        if (!err2 && x2 && x2.status === 200) {
          handleSessionResponse(x2);
          return;
        }
        setText("status", "Failed to create session.");
        if (x2) setDebug("POST /api/session failed (status " + x2.status + ")");
      });
    });
  }

  function handleSessionResponse(x) {
    var json;
    try {
      json = JSON.parse(x.responseText);
    } catch (_) {
      setText("status", "Bad response.");
      setDebug("JSON parse error");
      return;
    }

    if (!json || !json.ok) {
      setText("status", "Server error creating session.");
      return;
    }

    sessionId = json.sessionId;
    receiverToken = json.receiverToken;

    // Show 4-char code in plain black text
    setText("code", json.code || "----");

    // Robust QR loading (cache-bust + one retry + reflow trick)
    var qre = $("qr");
    if (qre) {
      var tried = 0;
      function setQR() {
        qre.onerror = function () {
          if (tried < 1) {
            tried++;
            qre.removeAttribute("src"); // force reflow on some Kobo builds
            setTimeout(setQR, 400);
          } else setDebug("QR image failed to load.");
        };
        qre.src =
          "/api/qr/" + encodeURIComponent(sessionId) + ".png?v=" + Date.now();
      }
      setQR();
    }

    setText("status", "Waiting for Sender to upload…");
    startHeartbeat();
    startPoll();
  }
})();
