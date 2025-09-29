(function () {
  // Keep relative to same origin
  var API = "";

  // ---------- tiny helpers ----------
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

  // ---------- state ----------
  var sessionId = null;
  var receiverToken = null;
  var hbTimer = null;
  var pollTimer = null;
  var beaconSent = false;
  var paused = false;

  // ---------- heartbeat ----------
  function startHeartbeat() {
    stopHeartbeat();
    hbTimer = setInterval(function () {
      if (!sessionId || paused) return;
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

  // ---------- polling ----------
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(function () {
      if (!sessionId || paused) return;
      xhr(
        "GET",
        "/api/session/" + encodeURIComponent(sessionId) + "/status",
        null,
        function (err, x) {
          if (err || !x) return; // transient network hiccup -> ignore; next tick will retry
          if (x.status !== 200) {
            // session vanished/closed
            teardown("bad_status_" + x.status);
            location.replace("/");
            return;
          }
          var json;
          try {
            json = JSON.parse(x.responseText);
          } catch (_) {
            return;
          }

          if (!json || json.closed || json.status === "closed") {
            teardown("closed");
            location.replace("/");
            return;
          }

          // File ready -> show download link
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
            // If sender connected show different text; else waiting…
            setText(
              "status",
              json.senderConnected
                ? "Connected. Waiting for Sender to upload…"
                : "Waiting for Sender to connect…"
            );
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

  // ---------- teardown ----------
  function teardown() {
    stopHeartbeat();
    stopPoll();
    sessionId = null;
    receiverToken = null;
    setText("status", "");
  }

  // ---------- disconnect beacon ----------
  function sendBeaconDisconnect(by) {
    try {
      if (beaconSent) return;
      if (!sessionId || !navigator.sendBeacon) return;
      beaconSent = true;
      var data = JSON.stringify({ sessionId: sessionId, by: by || "receiver" });
      navigator.sendBeacon(
        "/api/disconnect",
        new Blob([data], { type: "application/json" })
      );
    } catch {}
  }
  window.addEventListener(
    "pagehide",
    function () {
      sendBeaconDisconnect("receiver");
    },
    { capture: true }
  );
  window.addEventListener(
    "beforeunload",
    function () {
      sendBeaconDisconnect("receiver");
    },
    { capture: true }
  );
  window.addEventListener("offline", function () {
    sendBeaconDisconnect("receiver");
  });

  // Pause timers when hidden (saves battery/memory on e-ink)
  document.addEventListener("visibilitychange", function () {
    paused = document.hidden;
  });

  // ---------- session creation (GET-first; fallback to POST) ----------
  function createSessionCompat() {
    setText("status", "Creating session…");
    setDebug("");
    // Close previous session (if any) before making a new one
    if (sessionId) {
      try {
        navigator.sendBeacon(
          "/api/disconnect",
          new Blob([JSON.stringify({ sessionId, by: "receiver" })], {
            type: "application/json",
          })
        );
      } catch {}
      sessionId = null;
      receiverToken = null;
    }
    // 1) GET first (older engines)
    xhr("GET", "/api/session/new?v=" + Date.now(), null, function (err, x) {
      if (!err && x && x.status === 200) {
        handleSessionResponse(x);
        return;
      }
      if (x)
        setDebug(
          "GET /api/session/new failed (" + x.status + "). Trying POST…"
        );

      // 2) POST fallback
      xhr("POST", "/api/session", { role: "receiver" }, function (err2, x2) {
        if (!err2 && x2 && x2.status === 200) {
          handleSessionResponse(x2);
          return;
        }
        setText("status", "Failed to create session.");
        if (x2) setDebug("POST /api/session failed (" + x2.status + ")");
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

    // show 4-char code
    setText("code", json.code || "----");

    // robust QR load (server generates /api/qr/:id.png that encodes /join)
    var qre = $("qr");
    if (qre) {
      var tried = 0;
      function setQR() {
        qre.onerror = function () {
          if (tried < 1) {
            tried++;
            qre.removeAttribute("src"); // reflow for some Kobo builds
            setTimeout(setQR, 400);
          } else setDebug("QR image failed to load.");
        };
        qre.src =
          "/api/qr/" + encodeURIComponent(sessionId) + ".png?v=" + Date.now();
      }
      setQR();
    }

    setText("status", "Waiting for Sender to connect…");
    startHeartbeat();
    startPoll();
  }

  // ---------- init ----------
  function init() {
    // If SSR created a session already, use it
    if (window.__SESS_ID__) {
      sessionId = String(window.__SESS_ID__ || "");
      receiverToken = String(window.__RECV_TOKEN__ || "");
      // refresh QR src once to avoid stale cache on e-ink
      var qre = $("qr");
      if (qre && qre.src) qre.src = qre.src.split("?")[0] + "?v=" + Date.now();

      setText("status", "Waiting for Sender to connect…");
      startHeartbeat();
      startPoll();
      return;
    }
    // else create a session client-side
    createSessionCompat();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
