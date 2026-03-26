import { NotificationSettings } from "@/components/notification-settings";
import { getViewerState } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const viewer = await getViewerState();
  const email = viewer.user?.email ?? "";

  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>Settings</h1>
      </section>

      <section className="settings-grid">
        <article className="panel stack-lg">
          <div className="stack">
            <p className="artifact-kind">Profile</p>
            <h2>Account</h2>
          </div>

          <div className="stack">
            <div className="settings-field">
              <span className="settings-field-label">Email</span>
              <span className="settings-field-value">{email}</span>
            </div>
            <div className="settings-field">
              <span className="settings-field-label">Authentication</span>
              <span className="settings-field-value">Email + password, Google</span>
            </div>
          </div>
        </article>

        <article className="panel stack-lg">
          <div className="stack">
            <p className="artifact-kind">Data</p>
            <h2>Privacy and retention</h2>
          </div>

          <div className="stack">
            <p className="muted">
              Your files are processed during generation and stored encrypted in Supabase Storage.
              We never use your data to train models. Source files can be deleted after export.
            </p>
            <p className="muted">
              Report artifacts (PPTX, PDF) are retained until you delete them.
              Credit history is kept for billing records.
            </p>
          </div>
        </article>
        <article className="panel stack-lg">
          <div className="stack">
            <p className="artifact-kind">Notifications</p>
            <h2>Email</h2>
          </div>
          <NotificationSettings />
        </article>
      </section>
    </div>
  );
}
