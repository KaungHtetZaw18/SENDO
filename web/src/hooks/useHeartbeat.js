import { useEffect } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (typeof window !== "undefined" ? window.location.origin : "");

/**
 * Keep the session alive by pinging the server every 30s.
 * Safe to call with `undefined` – it will no-op.
 */
export function useHeartbeat(sessionId, role) {
  useEffect(() => {
    if (!sessionId) return;

    let stop = false;
    const tick = async () => {
      try {
        await fetch(`${API_BASE}/api/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, role }),
        });
      } catch (e) {
        void e; // ignore transient network errors
      }
      if (!stop) setTimeout(tick, 30000);
    };

    tick();
    return () => {
      stop = true;
    };
  }, [sessionId, role]);
}
