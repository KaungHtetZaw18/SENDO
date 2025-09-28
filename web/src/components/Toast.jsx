export default function Toast({ open, kind = "info", children }) {
  if (!open) return null;
  const color = kind === "error" ? "text-red-300" : "text-ink";
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-6 px-4 py-2 rounded-xl bg-paper-raised/90 border border-paper-border shadow-soft">
      <span className={`text-sm ${color}`}>{children}</span>
    </div>
  );
}
