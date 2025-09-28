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
            var href =
              location.origin +
              "/api/download/" +
              encodeURIComponent(sid) +
              "?receiverToken=" +
              encodeURIComponent(rTok);
            var a = el("downloadBtn");
            a.href = href;
            a.removeAttribute("target");
            a.removeAttribute("rel");
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
    // keep the box visible with the message so user sees what happened
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
      // ✅ Use the server PNG endpoint for QR (more reliable on Kobo)
      el("qr").src = "/api/qr/" + encodeURIComponent(sid) + ".png";

      el("sessionBox").style.display = "block";
      setStatus("Waiting for Sender to upload…");

      startHB();
      startPoll();
    });
  }

  function disconnect(ev) {
    if (ev) ev.preventDefault();
    if (!sid) {
      setStatus("Ended by Receiver.");
      return;
    }
    xhr(
      "POST",
      "/api/disconnect",
      { sessionId: sid, by: "receiver" },
      function () {
        setStatus("Ended by Receiver.");
        // keep UI on screen; sender will see the disconnect too
      }
    );
  }

  function ready() {
    el("disconnectBtn").onclick = disconnect;
    // Auto-create session on load so Kobo users see code/QR immediately
    createSession();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
