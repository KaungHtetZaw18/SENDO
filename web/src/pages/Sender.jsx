import { useEffect, useMemo, useState } from "react";
import Spinner from "../components/Spinner.jsx";
import Toast from "../components/Toast.jsx";
import { useHeartbeat } from "../hooks/useHeartbeat.js";
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (typeof window !== "undefined" ? window.location.origin : "");

export default function Sender() {
  const [code, setCode] = useState("");
  const [connected, setConnected] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");

  const urlParams = useMemo(() => new URLSearchParams(location.search), []);

  // Try auto-connect if opened with ?sessionId=...
  useEffect(() => {
    const sid = urlParams.get("sessionId");
    if (!sid) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid }),
        });
        const json = await res.json();
        if (json.ok) {
          setConnected(json);
        } else {
          setErr(json.error || "This session has expired or was closed.");
          location.href = "/?closedBy=ttl";
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [urlParams]);

  // Always call hooks at top level
  useHeartbeat(connected?.sessionId, "sender");

  // Poll status so if Receiver disconnects (or TTL), we bounce with reason
  useEffect(() => {
    if (!connected?.sessionId) return;
    let stop = false,
      t;

    const poll = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/session/${connected.sessionId}/status`
        );
        if (!res.ok) {
          location.href = "/?closedBy=ttl";
          return;
        }
        const json = await res.json();
        if (json.closed) {
          location.href = `/?closedBy=${encodeURIComponent(
            json.closedBy || "ttl"
          )}`;
          return;
        }
      } catch (e) {
        // ignore transient errors but "use" the var to satisfy eslint
        void e;
      }
      if (!stop) t = setTimeout(poll, 1500);
    };

    poll();
    return () => {
      stop = true;
      if (t) clearTimeout(t);
    };
  }, [connected?.sessionId]);

  async function connectByCode(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (json.ok) setConnected(json);
      else setErr(json.error || "Invalid code");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="container-soft bg-app">
        <div className="card p-6 flex items-center gap-3">
          <Spinner />
          <span className="muted">Connecting…</span>
        </div>
      </main>
    );
  }

  if (connected) {
    const onDisconnect = async () => {
      await fetch(`${API_BASE}/api/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: connected.sessionId, by: "sender" }),
      });
      location.href = "/?closedBy=sender";
    };

    return (
      <main className="container-soft bg-app">
        <div className="w-full max-w-lg space-y-6">
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Sender</h1>
              <p className="muted text-sm">Connected. Upload an e-book.</p>
            </div>
            <button className="btn" onClick={onDisconnect}>
              Disconnect
            </button>
          </header>

          <div className="card p-4">
            <Uploader
              sessionId={connected.sessionId}
              senderToken={connected.senderToken}
              onToast={(msg) => {
                setToast(msg);
                setTimeout(() => setToast(""), 3000);
              }}
            />
          </div>

          <Toast open={!!toast}>{toast}</Toast>
        </div>
      </main>
    );
  }

  return (
    <main className="container-soft bg-app">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Sender</h1>
          <p className="muted text-sm">
            Enter the 4-character code from the Receiver.
          </p>
        </header>

        <form onSubmit={connectByCode} className="space-y-3">
          <input
            className="w-full card px-4 py-3 text-center uppercase tracking-[0.6em]"
            placeholder="ABCD"
            maxLength={4}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
          />
          <button type="submit" className="btn w-full">
            Connect
          </button>
        </form>

        {err && <p className="text-red-400 text-sm">{err}</p>}
      </div>
    </main>
  );
}

function Uploader({ sessionId, senderToken, onToast }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");

  async function onUpload(e) {
    e.preventDefault();
    setStatus("");
    if (!file) return;

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch(
        `${API_BASE}/api/upload?sessionId=${encodeURIComponent(
          sessionId
        )}&senderToken=${encodeURIComponent(senderToken)}`,
        { method: "POST", body: form }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Upload failed");
      setStatus(`Uploaded: ${json.file.name}`);
      onToast?.("Uploaded");
    } catch (err) {
      setStatus(`Error: ${err.message}`);
      onToast?.("Upload failed");
    }
  }

  return (
    <form onSubmit={onUpload} className="space-y-3">
      <div className="grid gap-2">
        <input
          className="file:mr-4 file:rounded-lg file:border file:border-paper-border file:bg-paper-hover file:px-3 file:py-1 file:text-ink file:hover:bg-paper-hover/80"
          type="file"
          accept=".epub,.mobi,.azw,.azw3,.pdf,.txt"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <p className="muted text-xs">
          Allowed: .epub .mobi .azw .azw3 .pdf .txt
        </p>
      </div>
      <button className="btn" type="submit">
        Upload
      </button>
      {status && <p className="muted text-sm">{status}</p>}
    </form>
  );
}
