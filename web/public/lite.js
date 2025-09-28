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
  function el(id) {
    return document.getElementById(id);
  }
  function setStatus(t) {
    el("status").innerHTML = t || "";
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
            var dl = el("downloadLink");
            dl.href =
              "/dl/" + encodeURIComponent(sid) + "/" + encodeURIComponent(rTok); // path-based
            dl.style.display = "block";
            setStatus(
              "File ready" + (j.file && j.file.name ? ": " + j.file.name : "")
            );
          } else {
            el("downloadLink").style.display = "none";
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
    el("startBtn").style.display = "block";
    el("disconnectBtn").style.display = "none";
    el("sessionBox").style.display = "none";
    el("downloadLink").style.display = "none";
    sid = null;
    rTok = null;
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
      var j;
      try {
        j = JSON.parse(x.responseText);
      } catch (_e) {
        setStatus("Bad response.");
        return;
      }

      sid = j.sessionId;
      rTok = j.receiverToken;

      el("code").innerHTML = j.code;
      // Use server-made PNG so no client QR library is needed
      el("qr").src = "/api/qr/" + encodeURIComponent(sid) + ".png";

      el("sessionBox").style.display = "block";
      el("startBtn").style.display = "none";
      el("disconnectBtn").style.display = "block";
      setStatus("Waiting for Sender to upload…");

      startHB();
      startPoll();
    });
  }

  function disconnect() {
    if (!sid) return teardown("receiver");
    xhr(
      "POST",
      "/api/disconnect",
      { sessionId: sid, by: "receiver" },
      function () {
        teardown("receiver");
      }
    );
  }

  function ready() {
    el("startBtn").onclick = function (e) {
      e.preventDefault();
      createSession();
    };
    el("disconnectBtn").onclick = function (e) {
      e.preventDefault();
      disconnect();
    };
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
