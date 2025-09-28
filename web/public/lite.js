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
  function el(id) {
    return document.getElementById(id);
  }
  function setStatus(t) {
    el("status").textContent = t || "";
  }

  var sid = null;
  var rTok = null;
  var pollTimer = null;
  var hbTimer = null;

  function startHB() {
    stopHB();
    hbTimer = setInterval(function () {
      if (!sid) return;
      xhr(
        "POST",
        "/api/heartbeat",
        { sessionId: sid, role: "receiver" },
        function () {}
      );
    }, 30000);
  }
  function stopHB() {
    if (hbTimer) {
      clearInterval(hbTimer);
      hbTimer = null;
    }
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(function () {
      if (!sid) return;
      xhr(
        "GET",
        "/api/session/" + encodeURIComponent(sid) + "/status",
        null,
        function (err, x) {
          if (err || !x) return;
          if (x.status !== 200) {
            teardown("ttl");
            return;
          }
          var j;
          try {
            j = JSON.parse(x.responseText);
          } catch (_e) {
            return;
          }

          if (j.closed) {
            teardown(j.closedBy || "ttl");
            return;
          }

          if (j.hasFile && rTok) {
            // Kobo tends to prefer a direct GET to the same origin
            var href =
              location.origin +
              "/api/download/" +
              encodeURIComponent(sid) +
              "?receiverToken=" +
              encodeURIComponent(rTok);
            var a = el("downloadBtn");
            a.href = href;
            a.style.display = "block";
            setStatus(
              "File ready" + (j.file && j.file.name ? ": " + j.file.name : "")
            );
          } else {
            el("downloadBtn").style.display = "none";
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
    stopHB();
    var s = "Session expired.";
    if (reason === "sender") s = "Ended by Sender.";
    else if (reason === "receiver") s = "Ended by Receiver.";
    setStatus(s);
  }

  // auto-close the session when the page is left (djazz-style)
  function autoDisconnect() {
    if (!sid) return;
    try {
      navigator.sendBeacon &&
        navigator.sendBeacon(
          "/api/disconnect",
          new Blob([JSON.stringify({ sessionId: sid, by: "receiver" })], {
            type: "application/json",
          })
        );
    } catch (_e) {
      // fallback; fire-and-forget
      xhr(
        "POST",
        "/api/disconnect",
        { sessionId: sid, by: "receiver" },
        function () {}
      );
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
      var j;
      try {
        j = JSON.parse(x.responseText);
      } catch (_e) {
        setStatus("Bad response.");
        return;
      }

      sid = j.sessionId;
      rTok = j.receiverToken;

      el("code").textContent = j.code;
      // Use the new PNG endpoint (works on Kobo)
      el("qr").src = "/api/qr/" + encodeURIComponent(sid) + ".png";

      el("sessionBox").style.display = "block";
      setStatus("Waiting for Sender to upload…");

      startHB();
      startPoll();
    });
  }

  function ready() {
    // auto-create on load
    createSession();

    // auto-disconnect when navigating away (unload/pagehide better for e-ink)
    window.addEventListener("pagehide", autoDisconnect);
    window.addEventListener("beforeunload", autoDisconnect);
    document.addEventListener(
      "visibilitychange",
      function () {
        if (document.visibilityState === "hidden") autoDisconnect();
      },
      { passive: true }
    );
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
