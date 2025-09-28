import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Toast from "./components/Toast.jsx";
import InfoNote from "./components/InfoNote.jsx";
import Footer from "./components/Footer.jsx";
import { detectDevice } from "./utils/device";

export default function App() {
  const d = detectDevice();
  const navigate = useNavigate();
  const [closedBy, setClosedBy] = useState("");
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const by = p.get("closedBy");
    if (by) {
      setClosedBy(by);
      const clean = new URL(location.href);
      clean.searchParams.delete("closedBy");
      window.history.replaceState(null, "", clean.toString());
      setTimeout(() => setClosedBy(""), 2000);
    }
  }, []);

  const who =
    closedBy === "receiver"
      ? "Session ended by Receiver"
      : closedBy === "sender"
      ? "Session ended by Sender"
      : closedBy === "ttl"
      ? "Session expired"
      : "";

  if (d.isEreader) {
    // Auto-redirect to lite.html
    window.location.href = "/lite.html";
    return null; // don’t render React app
  }

  return (
    <main className="container-soft bg-app">
      <div className="w-full max-w-lg space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Sendo</h1>
          <p className="muted text-sm">Ephemeral one-to-one file hand-off</p>
        </header>

        <div className="grid gap-3">
          <button className="btn" onClick={() => navigate("/receiver")}>
            I am a Receiver
          </button>
          <button className="btn" onClick={() => navigate("/sender")}>
            I am a Sender
          </button>
        </div>
        <InfoNote />
        <Footer />
      </div>

      <Toast open={!!who}>{who}</Toast>
    </main>
  );
}
