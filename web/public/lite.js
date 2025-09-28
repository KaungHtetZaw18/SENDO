// web/public/lite.js
(function () {
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
  function qs(id) {
    return document.getElementById(id);
  }
  function setStatus(t) {
    qs("status").textContent = t || "";
  }

  var sessionId = null;
  var receiverToken = null;
  var pollTimer = null;
  var hbTimer = null;

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
            teardown("ttl");
            return;
          }
          var json;
          try {
            json = JSON.parse(x.responseText);
          } catch (e) {
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

            var a = qs("downloadBtn");
            a.setAttribute("href", href);
            a.removeAttribute("target");
            a.removeAttribute("rel");
            a.style.display = "block";
            setStatus(
              "File ready" +
                (json.file && json.file.name ? ": " + json.file.name : "")
            );
          } else {
            qs("downloadBtn").style.display = "none";
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

  function teardown(reason) {
    stopPoll();
    stopHeartbeat();
    qs("startBtn") && (qs("startBtn").style.display = "block");
    qs("disconnectBtn").style.display = "none";
    sessionId = null;
    receiverToken = null;

    if (reason === "sender") setStatus("Ended by Sender.");
    else if (reason === "receiver") setStatus("Ended by Receiver.");
    else setStatus("Session expired.");
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
      } catch (e) {
        setStatus("Bad response.");
        return;
      }

      sessionId = json.sessionId;
      receiverToken = json.receiverToken;

      qs("code").textContent = json.code;
      qs("qr").src = json.qrDataUrl || "";

      if (qs("startBtn")) qs("startBtn").style.display = "none";
      qs("disconnectBtn").style.display = "block";
      setStatus("Waiting for Sender to upload…");

      startHeartbeat();
      startPoll();
    });
  }

  function disconnect() {
    if (!sessionId) return teardown("receiver");
    xhr(
      "POST",
      "/api/disconnect",
      { sessionId: sessionId, by: "receiver" },
      function () {
        teardown("receiver");
      }
    );
  }

  function ready() {
    var startBtn = qs("startBtn");
    if (startBtn) startBtn.onclick = createSession;
    qs("disconnectBtn").onclick = disconnect;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
