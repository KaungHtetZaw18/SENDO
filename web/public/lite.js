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
            teardown("ttl");
            return;
          }

          var json;
          try {
            json = JSON.parse(x.responseText);
          } catch {
            return;
          }

          if (json.closed) {
            teardown(json.closedBy || "ttl");
            // Always return to landing page when session ends
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
  var beaconSent = false;
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

  // ---- create session ----
  function createSession() {
    setText("status", "Creating session…");
    xhr("POST", "/api/session", { role: "receiver" }, function (err, x) {
      if (err || !x) {
        setText("status", "Network error.");
        return;
      }
      if (x.status !== 200) {
        setText("status", "Failed to create session.");
        return;
      }

      var json;
      try {
        json = JSON.parse(x.responseText);
      } catch {
        setText("status", "Bad response.");
        return;
      }

      sessionId = json.sessionId;
      receiverToken = json.receiverToken;

      // plain text key (black)
      setText("code", json.code);

      // PNG QR hosted by server (works on Kobo)
      var qre = $("qr");
      if (qre) qre.src = "/api/qr/" + encodeURIComponent(sessionId) + ".png";

      setText("status", "Waiting for Sender to upload…");

      startHeartbeat();
      startPoll();
    });
  }

  // ---- init ----
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", createSession);
  else createSession();
})();
