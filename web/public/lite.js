(function () {
  // ---- tiny helpers ---------------------------------------------------------
  function xhr(method, url, body, cb) {
    try {
      var x = new XMLHttpRequest();
      x.open(method, url, true);
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
  function id(s) {
    return document.getElementById(s);
  }
  function setStatus(t) {
    id("status").textContent = t || "";
  }

  // ---- state ----------------------------------------------------------------
  var sessionId = null;
  var receiverToken = null;
  var pollTimer = null;
  var hbTimer = null;

  // ---- heartbeat ------------------------------------------------------------
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
    }, 30000);
  }
  function stopHeartbeat() {
    if (hbTimer) {
      clearInterval(hbTimer);
      hbTimer = null;
    }
  }

  // ---- polling --------------------------------------------------------------
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
          } catch (_) {
            return;
          }

          if (json.closed) {
            teardown(json.closedBy || "ttl");
            return;
          }

          if (json.hasFile && receiverToken) {
            var href =
              location.origin +
              "/api/download/" +
              encodeURIComponent(sessionId) +
              "?receiverToken=" +
              encodeURIComponent(receiverToken);

            var a = id("downloadBtn");
            a.setAttribute("href", href);
            // Kobo/Kindle sometimes ignore download if target=_blank
            a.removeAttribute("target");
            a.removeAttribute("rel");
            a.style.display = "block";

            setStatus(
              "File ready" +
                (json.file && json.file.name ? ": " + json.file.name : "")
            );
          } else {
            id("downloadBtn").style.display = "none";
            setStatus("Waiting for Sender to upload…");
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

  // ---- lifecycle ------------------------------------------------------------
  function teardown(reason) {
    stopPoll();
    stopHeartbeat();
    id("sessionBox").style.display = "none";
    sessionId = null;
    receiverToken = null;

    var c = id("controls");
    if (c) c.style.display = "block"; // in case we fall back to manual
    var s = "Session expired.";
    if (reason === "sender") s = "Ended by Sender.";
    else if (reason === "receiver") s = "Ended by Receiver.";
    setStatus(s);
  }

  function createSession() {
    setStatus("Creating session…");
    xhr("POST", "/api/session", { role: "receiver" }, function (err, x) {
      if (err || !x) {
        setStatus("Network error.");
        return;
      }
      if (x.status !== 200) {
        setStatus("Failed to create session.");
        return;
      }
      var json;
      try {
        json = JSON.parse(x.responseText);
      } catch (_e) {
        setStatus("Bad response.");
        return;
      }

      sessionId = json.sessionId;
      receiverToken = json.receiverToken;

      id("code").textContent = json.code;
      id("qr").src = json.qrDataUrl || "";
      id("sessionBox").style.display = "block";
      var c = id("controls");
      if (c) c.style.display = "none";

      setStatus("Waiting for Sender to upload…");
      startHeartbeat();
      startPoll();
    });
  }

  function disconnect() {
    if (!sessionId) {
      teardown("receiver");
      return;
    }
    xhr(
      "POST",
      "/api/disconnect",
      { sessionId: sessionId, by: "receiver" },
      function () {
        teardown("receiver");
      }
    );
  }

  // ---- boot -----------------------------------------------------------------
  function ready() {
    // Always wire up disconnect
    id("disconnectBtn").onclick = disconnect;

    // Auto-start a session when the page loads (fix for Kobo not clicking well)
    createSession();

    // Keep a manual fall-back (visible only if auto-start hides it too quickly)
    var startBtn = id("startBtn");
    if (startBtn)
      startBtn.onclick = function () {
        if (!sessionId) createSession();
      };
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
