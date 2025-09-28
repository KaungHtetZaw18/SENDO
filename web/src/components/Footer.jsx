export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-10 text-center">
      <div className="muted text-xs">
        <div className="opacity-90">Created by Kaung</div>
        <div className="opacity-60">
          © {year} Sendo — ephemeral file hand-off
        </div>
      </div>
    </footer>
  );
}
