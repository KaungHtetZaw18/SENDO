import { useEffect, useRef, useState } from "react";
import Spinner from "../components/Spinner.jsx";
import Toast from "../components/Toast.jsx";
import Footer from "../components/Footer.jsx";
import InfoNote from "../components/InfoNote.jsx";
import { useHeartbeat } from "../hooks/useHeartbeat.js";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (typeof window !== "undefined" ? window.location.origin : "");

export default function Receiver() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ hasFile: false, closed: false });
  const [downNoti, setDownNoti] = useState(false);
  const [closedNoti, setClosedNoti] = useState(false);

  // track previous hasFile to detect server-side clear after download/replace
  const prevHasFileRef = useRef(false);

  // create session on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "receiver" }),
      });
      const json = await res.json();
      if (mounted) {
        setData(json);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // heartbeat while open
  useHeartbeat(data?.sessionId, "receiver");

  // poll status
  useEffect(() => {
    if (!data?.sessionId) return;
    let stop = false,
      t;

    const poll = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/session/${data.sessionId}/status`
        );
        if (!res.ok) {
          // 404/410 etc → session gone, redirect after short toast
          setStatus((s) => ({ ...s, closed: true }));
          location.href = "/?closedBy=ttl";
        } else {
          const json = await res.json();
          if (json.closed) {
            location.href = `/?closedBy=${encodeURIComponent(
              json.closedBy || "ttl"
            )}`;
            return;
          }

          // detect transition: had file → now no file (download finished or replaced)
          const was = prevHasFileRef.current;
          const now = !!json.hasFile;
          if (was && !now && !json.closed) {
            setDownNoti(true);
            setTimeout(() => setDownNoti(false), 2500);
          }
          prevHasFileRef.current = now;

          setStatus(json);
        }
      } catch (e) {
        // ignore intermittent polling errors
        void e;
      }
      if (!stop) t = setTimeout(poll, 1500);
    };

    poll();
    return () => {
      stop = true;
      if (t) clearTimeout(t);
    };
  }, [data?.sessionId]);

  // if session is closed (sender disconnected or TTL), notify then redirect
  useEffect(() => {
    if (!status.closed) return;
    setClosedNoti(true);
    const to = setTimeout(() => {
      setClosedNoti(false);
      location.href = "/";
    }, 1600);
    return () => clearTimeout(to);
  }, [status.closed]);

  if (loading) {
    return (
      <main className="container-soft bg-app">
        <div className="card p-6 flex items-center gap-3">
          <Spinner />
          <span className="muted">Creating session…</span>
        </div>
      </main>
    );
  }

  if (!data?.ok) {
    return (
      <main className="container-soft bg-app">
        <div className="card p-6">
          Failed to create session.{" "}
          <a className="underline" href="/">
            Try again
          </a>
          .
        </div>
      </main>
    );
  }

  const { code, senderLink, qrDataUrl, receiverToken, sessionId, expiresAt } =
    data;
  const secondsLeft = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));

  const onDisconnect = async () => {
    await fetch(`${API_BASE}/api/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, by: "receiver" }),
    });
    // server closes; polling will catch 404/closed and redirect
    location.href = "/?closedBy=receiver";
  };

  return (
    <main className="container-soft bg-app">
      <div className="w-full max-w-2xl space-y-6">
        <header className="space-y-1 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Receiver</h1>
            <p className="muted text-sm">
              Share this code, link, or QR with the Sender.
            </p>
          </div>
          <button className="btn" onClick={onDisconnect}>
            Disconnect
          </button>
        </header>

        <section className="grid gap-4">
          <div className="card p-4">
            <p className="muted text-xs mb-1">Connection Code</p>
            <div className="text-4xl font-black tracking-[0.6em]">{code}</div>
          </div>

          <div className="card p-4">
            <p className="muted text-xs mb-1">Sender Link</p>
            <a
              className="underline break-all"
              href={senderLink}
              target="_blank"
              rel="noreferrer"
            >
              {senderLink}
            </a>
          </div>

          <div className="card p-4 grid place-items-center">
            <img
              src={qrDataUrl}
              alt="QR to join as Sender"
              className="w-56 h-56 rounded-xl"
            />
          </div>

          {status.hasFile ? (
            <div className="card p-4 space-y-2">
              <p className="text-sm">
                File ready: <strong>{status.file?.name}</strong>{" "}
                <span className="muted">({status.file?.size} bytes)</span>
              </p>
              {/* Open in a NEW TAB so this page stays mounted => toast & poll keep working */}
              <a
                className="btn"
                target="_blank"
                rel="noreferrer"
                href={`${API_BASE}/api/download/${sessionId}?receiverToken=${encodeURIComponent(
                  receiverToken
                )}`}
              >
                Download
              </a>
            </div>
          ) : (
            <div className="card p-4 muted text-sm">
              Waiting for Sender to upload…
            </div>
          )}
        </section>

        <footer className="muted text-xs">Expires in ~{secondsLeft}s.</footer>
      </div>

      <Toast open={downNoti}>Downloaded. The file was cleared.</Toast>
      <Toast open={closedNoti} kind="error">
        Session closed.
      </Toast>
      <InfoNote />
      <Footer />
    </main>
  );
}
