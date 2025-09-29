(function () {
  // Same-origin API
  var API = "";

  var state = {
    sessionId: null,
    senderToken: null,
    hbTimer: null,
    pollTimer: null,
    beaconSent: false,
  };
  var qp = new URLSearchParams(location.search);

  // ---- DOM helpers
  function $(id) {
    return document.getElementById(id);
  }
  function setText(id, t) {
    var el = $(id);
    if (el) el.textContent = t || "";
  }
  function show(id) {
    var el = $(id);
    if (el) el.classList.remove("hide");
  }
  function hide(id) {
    var el = $(id);
    if (el) el.classList.add("hide");
  }

  // ---- XHR helper
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

  // ---- Heartbeat & status poll
  function startHeartbeat() {
    stopHeartbeat();
    state.hbTimer = setInterval(function () {
      if (!state.sessionId) return;
      xhr(
        "POST",
        "/api/heartbeat",
        { sessionId: state.sessionId, role: "sender" },
        function () {}
      );
    }, 30000);
  }
  function stopHeartbeat() {
    if (state.hbTimer) clearInterval(state.hbTimer);
    state.hbTimer = null;
  }

  function startPoll() {
    stopPoll();
    state.pollTimer = setInterval(function () {
      if (!state.sessionId) return;
      xhr(
        "GET",
        "/api/session/" + encodeURIComponent(state.sessionId) + "/status",
        null,
        function (err, x) {
          if (err || !x) return;
          if (x.status !== 200) return;
          var json;
          try {
            json = JSON.parse(x.responseText);
          } catch {
            return;
          }

          // If receiver closed/expired, bounce sender to landing
          if (json.closed) {
            teardownToLanding();
          }
        }
      );
    }, 1500);
  }
  function stopPoll() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  // ---- Disconnect (manual + beacon)
  function sendBeaconDisconnect() {
    try {
      if (state.beaconSent) return;
      if (!state.sessionId || !navigator.sendBeacon) return;
      state.beaconSent = true;
      var data = JSON.stringify({ sessionId: state.sessionId, by: "sender" });
      navigator.sendBeacon(
        "/api/disconnect",
        new Blob([data], { type: "application/json" })
      );
    } catch {}
  }

  function manualDisconnect() {
    if (!state.sessionId) return teardownToLanding();
    xhr(
      "POST",
      "/api/disconnect",
      { sessionId: state.sessionId, by: "sender" },
      function () {
        teardownToLanding();
      }
    );
  }

  function teardownToLanding() {
    stopHeartbeat();
    stopPoll();
    state.sessionId = null;
    state.senderToken = null;
    // Small delay to allow beacon to flush if we came from beforeunload
    setTimeout(function () {
      window.location.replace("/");
    }, 50);
  }

  // ---- UI logic
  function connect() {
    var raw = $("codeInput").value || "";
    var code = raw.trim().toUpperCase();
    if (code.length !== 4) {
      setText("connectStatus", "Please enter a 4-character key.");
      return;
    }
    $("connectBtn").disabled = true;
    setText("connectStatus", "Connecting…");

    xhr("POST", "/api/connect", { code: code }, function (err, x) {
      $("connectBtn").disabled = false;
      if (err || !x) return setText("connectStatus", "Network error.");
      if (x.status !== 200)
        return setText("connectStatus", "Could not connect. Check the key.");

      var json;
      try {
        json = JSON.parse(x.responseText);
      } catch {
        return setText("connectStatus", "Bad response.");
      }
      if (!json.ok) return setText("connectStatus", json.error || "Failed.");

      state.sessionId = json.sessionId;
      state.senderToken = json.senderToken;

      setText("connectedTo", "Connected to key: " + code);
      hide("connectCard");
      show("uploadCard");
      setText("connectStatus", "");

      // Reset controls
      $("fileInput").value = "";
      $("uploadBtn").disabled = true; // require a file to enable
      setText("uploadStatus", "");

      startHeartbeat();
      startPoll();
    });
  }

  function upload() {
    if (!state.sessionId || !state.senderToken) {
      setText("uploadStatus", "Not connected.");
      return;
    }
    var f = $("fileInput").files[0];
    if (!f) {
      setText(
        "uploadStatus",
        "Choose a file first (.epub .mobi .azw .azw3 .pdf .txt)."
      );
      return;
    }

    setText("uploadStatus", "Uploading…");
    $("uploadBtn").disabled = true; // prevent double-click during upload

    var fd = new FormData();
    fd.append("file", f);

    var url =
      "/api/upload?sessionId=" +
      encodeURIComponent(state.sessionId) +
      "&senderToken=" +
      encodeURIComponent(state.senderToken);

    var req = new XMLHttpRequest();
    req.open("POST", API + url, true);
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;

      if (req.status !== 200) {
        setText("uploadStatus", "Upload failed.");
        // Re-enable if a file is still selected
        $("uploadBtn").disabled = !$("fileInput").files[0];
        return;
      }
      var json;
      try {
        json = JSON.parse(req.responseText);
      } catch {
        setText("uploadStatus", "Bad response.");
        $("uploadBtn").disabled = !$("fileInput").files[0];
        return;
      }
      if (!json.ok) {
        setText("uploadStatus", json.error || "Upload failed.");
        $("uploadBtn").disabled = !$("fileInput").files[0];
        return;
      }

      // Success — keep the controls visible and usable for another upload.
      var name = json.file && json.file.name ? json.file.name : "file";
      setText("uploadStatus", "Uploaded: " + name);

      // Optionally clear the file so the user can pick a different one
      $("fileInput").value = "";
      $("uploadBtn").disabled = true; // disabled until a new file is selected
    };
    req.onerror = function () {
      setText("uploadStatus", "Network error.");
      $("uploadBtn").disabled = !$("fileInput").files[0];
    };
    req.send(fd);
  }

  function onFileChange() {
    // Enable Upload only when a file is selected
    $("uploadBtn").disabled = !$("fileInput").files[0];
  }

  // ---- Auto-wire
  function ready() {
    // If opened via deep-link (sender?sessionId=..&t=..), you can optionally auto-connect here.
    // For now we keep the “enter key” UX you requested.
    var sid = qp.get("sessionId");
    var tok = qp.get("t");
    if (sid && tok) {
      state.sessionId = sid;
      state.senderToken = tok;

      hide("connectCard");
      show("uploadCard");
      setText("connectedTo", "Connected by QR — ready to upload.");

      // Optional: refresh TTL; safe even though /join already connected
      xhr(
        "POST",
        "/api/connect",
        { sessionId: state.sessionId },
        function () {}
      );

      startHeartbeat();
      startPoll();
    }
    $("connectBtn").onclick = connect;
    $("uploadBtn").onclick = upload;
    $("disconnectBtn").onclick = manualDisconnect;
    $("fileInput").addEventListener("change", onFileChange);

    // Auto-disconnect if sender window/tab is closed or goes offline.
    window.addEventListener(
      "pagehide",
      function () {
        sendBeaconDisconnect();
      },
      { capture: true }
    );
    window.addEventListener(
      "beforeunload",
      function () {
        sendBeaconDisconnect();
      },
      { capture: true }
    );
    window.addEventListener("offline", function () {
      sendBeaconDisconnect();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
