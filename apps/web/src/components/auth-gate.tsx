import Link from "next/link";

export function AuthGate({ configured }: { configured: boolean }) {
  return (
    <section className="panel stack">
      <p className="eyebrow">Authenticated Shell</p>
      <h1>{configured ? "Sign in to access the Basquio workspace." : "Configure Supabase auth to unlock the workspace."}</h1>
      <p className="muted">
        The application shell is wired to Supabase Auth. Until a session exists, the protected routes stay behind
        this gate instead of falling back to an anonymous prototype.
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
