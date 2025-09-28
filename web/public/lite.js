(function () {
  // Same-origin API
  var API = "";

  // ---- DOM helpers ---------------------------------------------------------
  function $(id) {
    return document.getElementById(id);
  }
  function setText(id, t) {
    var el = $(id);
    if (el) el.textContent = t || "";
  }

  // ---- XHR (JSON) ----------------------------------------------------------
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

  // ---- State ---------------------------------------------------------------
  var sessionId = null;
  var receiverToken = null;
  var hbTimer = null;
  var pollTimer = null;

  // ---- Heartbeat -----------------------------------------------------------
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
    }, 15000); // 15s for snappier liveness
  }
  function stopHeartbeat() {
    if (hbTimer) {
      clearInterval(hbTimer);
      hbTimer = null;
    }
  }

  // ---- Polling -------------------------------------------------------------
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
            location.replace("/"); // receiver always goes home when closed
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

  // ---- Teardown ------------------------------------------------------------
  function teardown(_reason) {
    stopHeartbeat();
    stopPoll();
    sessionId = null;
    receiverToken = null;
    setText("status", "");
    // UI stays, redirect is handled by caller when needed
  }

  // ---- Disconnect beacon on leave/offline ---------------------------------
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

  // Only fire on real page exits
  function onPageHide() {
    sendBeaconDisconnect();
  }
  function onBeforeUnload() {
    sendBeaconDisconnect();
  }
  function onOffline() {
    sendBeaconDisconnect();
  }

  // IMPORTANT: remove the aggressive visibilitychange handler
  // Some e-readers flip to "hidden" briefly on load or UI changes.
  // If you must keep it, use a delay debounce to avoid false positives.
  // window.addEventListener("visibilitychange", function () {
  //   if (document.hidden) {
  //     setTimeout(function() {
  //       if (document.hidden) sendBeaconDisconnect();
  //     }, 1500);
  //   }
  // });

  window.addEventListener("pagehide", onPageHide, { capture: true });
  window.addEventListener("beforeunload", onBeforeUnload, { capture: true });
  window.addEventListener("offline", onOffline);

  // ---- Create session ------------------------------------------------------
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

      setText("code", json.code);
      // Use PNG endpoint (more reliable on e-readers)
      var qre = $("qr");
      if (qre) qre.src = "/api/qr/" + encodeURIComponent(sessionId) + ".png";
      setText("status", "Waiting for Sender to upload…");

      startHeartbeat();
      startPoll();
    });
  }

  // ---- Init ----------------------------------------------------------------
  function ready() {
    createSession();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
