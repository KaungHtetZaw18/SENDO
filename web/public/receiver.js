(function () {
  // ---------- config ----------
  function readMeta(name) {
    var els = document.getElementsByTagName("meta");
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute("name") === name) {
        return els[i].getAttribute("content");
      }
    }
    return "";
  }

  var API = readMeta("sendo-api-base") || "";
  API = API.replace(/\/+$/, ""); // strip trailing slash

  if (!API) {
    console.log("Missing <meta name='sendo-api-base'> in HTML!");
  }

  // ---------- tiny helpers ----------
  function $(id) {
    return document.getElementById(id);
  }
  function setText(id, t) {
    var el = $(id);
    if (el) el.textContent = t || "";
  }
  function setStatus(t) {
    setText("status", t);
  }
  function setDebug(t) {
    var el = $("debug");
    if (el) el.textContent = t || "";
  }

  function xhrGET(absUrl, cb) {
    try {
      var x = new XMLHttpRequest();
      x.open("GET", absUrl, true);
      x.onreadystatechange = function () {
        if (x.readyState === 4) cb(null, x);
      };
      x.onerror = function () {
        cb(new Error("net"), null);
      };
      x.send();
    } catch (e) {
      cb(e, null);
    }
  }

  // ---------- state ----------
  var sessionId = null;
  var receiverToken = null;
  var hbTimer = null;
  var pollTimer = null;

  // ---------- heartbeat ----------
  function startHeartbeat() {
    stopHeartbeat();
    hbTimer = setInterval(function () {
      if (!sessionId) return;
      var body = JSON.stringify({ sessionId: sessionId, role: "receiver" });
      try {
        var x = new XMLHttpRequest();
        x.open("POST", API + "/api/heartbeat", true);
        x.setRequestHeader("Content-Type", "application/json");
        x.send(body);
      } catch (_) {}
    }, 15000);
  }
  function stopHeartbeat() {
    if (hbTimer) {
      clearInterval(hbTimer);
      hbTimer = null;
    }
  }

  // ---------- polling ----------
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(function () {
      if (!sessionId) return;
      xhrGET(
        API + "/api/session/" + encodeURIComponent(sessionId) + "/status",
        function (err, x) {
          if (err || !x) return;
          if (x.status !== 200) {
            teardownToLanding();
            return;
          }
          var json = null;
          try {
            json = JSON.parse(x.responseText);
          } catch (_) {}
          if (!json) return;

          if (json.closed || json.status === "closed") {
            teardownToLanding();
            return;
          }

          if (json.hasFile && receiverToken) {
            var href =
              API +
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
            var b = $("downloadBtn");
            if (b) b.style.display = "none";
            setText(
              "status",
              json.senderConnected
                ? "Connected. Waiting for Sender…"
                : "Waiting for Sender to connect…"
            );
          }
        }
      );
    }, 2000);
  }
  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ---------- teardown ----------
  function teardown() {
    stopHeartbeat();
    stopPoll();
    sessionId = null;
    receiverToken = null;
  }

  function teardownToLanding() {
    teardown();
    setTimeout(function () {
      window.location.replace("/");
    }, 100);
  }

  // ---------- QR ----------
  function setQR(sid) {
    var q = $("qr");
    if (!q) return;
    var src =
      API +
      "/api/qr/" +
      encodeURIComponent(sid) +
      ".png?v=" +
      new Date().getTime();
    var tried = 0;
    q.onerror = function () {
      if (tried < 1) {
        tried++;
        q.removeAttribute("src");
        setTimeout(function () {
          q.src = src.split("?")[0] + "?v=" + new Date().getTime();
        }, 300);
      } else {
        setDebug("QR image failed to load.");
      }
    };
    q.onload = function () {
      q.onerror = q.onload = null;
    };
    q.src = src;
  }

  // ---------- create session ----------
  function createSession() {
    setStatus("Creating session…");
    setDebug("");
    xhrGET(
      API + "/api/session/new?v=" + new Date().getTime(),
      function (err, x) {
        if (err || !x) {
          setStatus("Failed to create session.");
          return;
        }
        if (x.status !== 200) {
          setStatus("Failed: " + x.status);
          return;
        }
        var json = null;
        try {
          json = JSON.parse(x.responseText);
        } catch (_) {}
        if (!json) {
          setStatus("Bad response");
          return;
        }

        sessionId = json.sessionId || json.id || null;
        receiverToken = json.receiverToken || null;

        if (!sessionId) {
          setStatus("No session id");
          return;
        }

        setText("code", json.code || "----");
        setQR(sessionId);
        setStatus("Waiting for Sender…");
        startHeartbeat();
        startPoll();
      }
    );
  }

  // ---------- init ----------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createSession);
  } else {
    createSession();
  }
})();
