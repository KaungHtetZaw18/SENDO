(function () {
  // Same-origin API
  var API = "";

  // ---- helpers ----
  function $(id) {
    return document.getElementById(id);
  }
  function setText(id, t) {
    var el = $(id);
    if (el) el.textContent = t || "";
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
            teardown();
            location.replace("/");
            return;
          }

          var json;
          try {
            json = JSON.parse(x.responseText);
          } catch {
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
            if ($("downloadBtn")) $("downloadBtn").style.display = "none";
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

  // ---- disconnect beacon on leave/offline ----
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

  // ---- session creation (GET first, POST fallback) ----
  function createSessionCompat() {
    setText("status", "Creating session…");

    // 1) Try GET (works better on many e-readers)
    xhr("GET", "/api/session/new", null, function (err, x) {
      if (!err && x && x.status === 200) {
        return handleSessionResponse(x);
      }

      // 2) Fallback: JSON POST
      xhr("POST", "/api/session", { role: "receiver" }, function (err2, x2) {
        if (!err2 && x2 && x2.status === 200) {
          return handleSessionResponse(x2);
        }

        // 3) Show a clear message
        var msg = "Failed to create session.";
        if (err || err2) msg += " Network error.";
        setText("status", msg);
      });
    });
  }

  function handleSessionResponse(x) {
    var json;
    try {
      json = JSON.parse(x.responseText);
    } catch {
      setText("status", "Bad response.");
      return;
    }

    if (!json || !json.ok) {
      setText("status", "Server error creating session.");
      return;
    }

    sessionId = json.sessionId;
    receiverToken = json.receiverToken;

    setText("code", json.code); // plain black text key
    var qre = $("qr");
    if (qre)
      qre.src =
        "/api/qr/" + encodeURIComponent(sessionId) + ".png?v=" + Date.now(); // cache-bust

    setText("status", "Waiting for Sender to upload…");
    startHeartbeat();
    startPoll();
  }

  // ---- init ----
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", createSessionCompat);
  else createSessionCompat();
})();
