// minimal receiver page: auto-start, poll, redirect-to-landing on close
(function () {
  function $(id) {
    return document.getElementById(id);
  }
  function setStatus(t) {
    $("status").textContent = t || "";
  }

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

  var sessionId = null,
    receiverToken = null,
    pollTimer = null,
    hbTimer = null;

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
            redirectLanding("ttl");
            return;
          }

          var json;
          try {
            json = JSON.parse(x.responseText);
          } catch {
            return;
          }

          if (json.closed) {
            redirectLanding(json.closedBy || "ttl");
            return;
          }

          if (json.hasFile && receiverToken) {
            var href =
              "/api/download/" +
              encodeURIComponent(sessionId) +
              "?receiverToken=" +
              encodeURIComponent(receiverToken);
            $("downloadBtn").setAttribute("href", href);
            $("downloadBtn").style.display = "block";
            setStatus(
              "File ready" +
                (json.file && json.file.name ? ": " + json.file.name : "")
            );
          } else {
            $("downloadBtn").style.display = "none";
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

  function redirectLanding(reason) {
    // small delay so the user can see the message flash on e-ink
    setTimeout(function () {
      try {
        // hint to server that receiver is leaving (so sender gets “ended by receiver” quickly)
        if (sessionId) {
          var data = new Blob(
            [JSON.stringify({ sessionId: sessionId, by: "receiver" })],
            { type: "application/json" }
          );
          navigator.sendBeacon && navigator.sendBeacon("/api/disconnect", data);
        }
      } catch {}
      window.location.href = "/"; // landing
    }, 200);
  }

  function createSession() {
    setStatus("Creating session…");
    xhr("POST", "/api/session", { role: "receiver" }, function (err, x) {
      if (err || !x || x.status !== 200) {
        setStatus("Failed to create session.");
        return;
      }

      var json;
      try {
        json = JSON.parse(x.responseText);
      } catch {
        setStatus("Bad response.");
        return;
      }

      sessionId = json.sessionId;
      receiverToken = json.receiverToken;

      $("code").textContent = json.code;
      $("qr").src = "/api/qr/" + encodeURIComponent(sessionId) + ".png";
      setStatus("Waiting for Sender to upload…");

      startHeartbeat();
      startPoll();
    });
  }

  // inform server we left (disconnect=receiver) so sender bounces home
  window.addEventListener("pagehide", function () {
    try {
      if (!sessionId) return;
      var data = new Blob(
        [JSON.stringify({ sessionId: sessionId, by: "receiver" })],
        { type: "application/json" }
      );
      navigator.sendBeacon && navigator.sendBeacon("/api/disconnect", data);
    } catch {}
  });

  // Auto-start immediately — no Start button
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createSession);
  } else {
    createSession();
  }
})();
