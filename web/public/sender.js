(function () {
  // Always call the same-origin API (works locally and in prod)
  var API = "";

  var state = {
    sessionId: null,
    senderToken: null,
    hb: null,
  };

  function $(id) {
    return document.getElementById(id);
  }
  function setText(id, t) {
    $(id).textContent = t || "";
  }
  function show(id) {
    $(id).classList.remove("hide");
  }
  function hide(id) {
    $(id).classList.add("hide");
  }

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

  function startHeartbeat() {
    stopHeartbeat();
    state.hb = setInterval(function () {
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
    if (state.hb) {
      clearInterval(state.hb);
      state.hb = null;
    }
  }

  function connect() {
    var raw = $("code").value || "";
    var code = raw.trim().toUpperCase();
    if (code.length !== 4) {
      setText("connectStatus", "Please enter a 4-character key.");
      return;
    }
    $("connectBtn").disabled = true;
    setText("connectStatus", "Connecting…");

    xhr("POST", "/api/connect", { code: code }, function (err, x) {
      $("connectBtn").disabled = false;
      if (err || !x) {
        setText("connectStatus", "Network error.");
        return;
      }
      if (x.status !== 200) {
        setText(
          "connectStatus",
          "Could not connect. Check the key and try again."
        );
        return;
      }
      var json;
      try {
        json = JSON.parse(x.responseText);
      } catch (e) {
        setText("connectStatus", "Bad response.");
        return;
      }
      if (!json.ok) {
        setText("connectStatus", json.error || "Failed.");
        return;
      }

      state.sessionId = json.sessionId;
      state.senderToken = json.senderToken;
      setText("connectStatus", "Connected.");
      setText("connectedTo", "Connected to key: " + code);
      show("uibox");
      startHeartbeat();
    });
  }

  function upload() {
    if (!state.sessionId || !state.senderToken) {
      setText("uploadStatus", "Not connected.");
      return;
    }
    var f = $("file").files[0];
    if (!f) {
      setText(
        "uploadStatus",
        "Choose a file first (.epub .mobi .azw .azw3 .pdf .txt)."
      );
      return;
    }

    setText("uploadStatus", "Uploading…");
    $("uploadBtn").disabled = true;

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
      $("uploadBtn").disabled = false;
      if (req.status !== 200) {
        setText("uploadStatus", "Upload failed.");
        return;
      }
      var json;
      try {
        json = JSON.parse(req.responseText);
      } catch (e) {
        setText("uploadStatus", "Bad response.");
        return;
      }
      if (!json.ok) {
        setText("uploadStatus", json.error || "Upload failed.");
        return;
      }
      setText(
        "uploadStatus",
        "Uploaded: " + (json.file && json.file.name ? json.file.name : "file")
      );
    };
    req.onerror = function () {
      $("uploadBtn").disabled = false;
      setText("uploadStatus", "Network error.");
    };
    req.send(fd);
  }

  function ready() {
    $("connectBtn").onclick = connect;
    $("uploadBtn").onclick = upload;
    window.addEventListener("beforeunload", stopHeartbeat);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
