export default function SignInPage() {
  return (
    <section className="panel stack-xl">
      <p className="section-label">Sign in</p>
      <h1>Supabase auth remains optional for local Basquio testing.</h1>
      <p className="muted">
        The app no longer blocks internal evidence-package testing behind auth. This route stays as the future handoff
        point for magic-link or SSO flows once the project credentials are fully live.
      </p>
      <pre className="code-block">{`NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY`}</pre>
    </section>
  );
}
