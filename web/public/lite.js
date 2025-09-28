/* web/public/lite.js — Kobo/Kindle friendly (ES3-ish) */
(function () {
  function qs(id) {
    return document.getElementById(id);
  }
  function setStatus(t) {
    qs("status").innerHTML = t || "";
  }

  var sessionId = null;
  var receiverToken = null;
  var pollTimer = null;
  var hbTimer = null;

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
          if (err || !x) {
            return;
          }
          if (x.status !== 200) {
            setStatus("Session expired.");
            stopPoll();
            return;
          }

          var json;
          try {
            json = JSON.parse(x.responseText);
          } catch (e) {
            return;
          }

          if (json.closed) {
            setStatus(
              json.closedBy === "sender"
                ? "Ended by Sender."
                : "Session expired."
            );
            stopPoll();
            stopHeartbeat();
            return;
          }

          if (json.hasFile && receiverToken) {
            var href =
              "/api/download/" +
              encodeURIComponent(sessionId) +
              "?receiverToken=" +
              encodeURIComponent(receiverToken);
            qs("downloadBtn").setAttribute("href", href);
            qs("downloadBtn").style.display = "block";
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

      // Show 4-char code and PNG QR (PNG works best on e-readers)
      qs("code").innerHTML = json.code;
      qs("qr").src = "/api/qr/" + encodeURIComponent(sessionId) + ".png";

      setStatus("Waiting for Sender to upload…");
      startHeartbeat();
      startPoll();
    });
  }

  function ready() {
    createSession();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
