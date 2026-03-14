export default function SignInPage() {
  return (
    <section className="panel stack">
      <p className="eyebrow">Sign in</p>
      <h1>Supabase auth scaffold</h1>
      <p className="muted">
        The protected application shell checks Supabase sessions already. The next pass can replace this placeholder
        view with magic-link or SSO flows once the project keys are live.
      </p>
      <pre className="code-block">{`NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY`}</pre>
    </section>
  );
}
