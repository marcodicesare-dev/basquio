import Link from "next/link";

export function AuthGate({ configured }: { configured: boolean }) {
  return (
    <section className="panel stack">
      <p className="eyebrow">Workspace access</p>
      <h1>{configured ? "Sign in to access the Basquio workspace." : "Sign-in is not available yet."}</h1>
      <p className="muted">
        The workspace is private by default, so protected pages stay behind sign-in instead of falling back to an
        anonymous prototype.
      </p>
      <div className="row">
        <Link className="button" href="/sign-in">
          Open sign-in
        </Link>
        <Link className="button secondary" href="/">
          Back to overview
        </Link>
      </div>
    </section>
  );
}
