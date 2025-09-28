export default function InfoNote() {
  return (
    <section className="card p-5 space-y-3">
      <h2 className="text-sm font-semibold opacity-90">How Sendo works</h2>
      <ul className="list-disc pl-5 space-y-1 text-sm muted">
        <li>
          Receivers create a short-lived session and get a code, link, and QR.
        </li>
        <li>
          Senders join with the 4-character code, the link, or by scanning the
          QR.
        </li>
        <li>
          One file at a time. Only e-book formats:{" "}
          <code>.epub .mobi .azw .azw3 .pdf .txt</code>.
        </li>
        <li>
          Files auto-delete after a successful download, when replaced, on
          disconnect, or after 5 minutes of inactivity.
        </li>
        <li>
          Privacy first: no accounts, no analytics, minimal temporary storage.
        </li>
      </ul>
      <p className="muted text-xs">
        Tip: On e-readers, open the Receiver page, create a session, then scan
        or type the code on your phone/computer.
      </p>
    </section>
  );
}
