"use client";

import { useEffect, useState } from "react";

export function NotificationSettings() {
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings/notifications")
      .then((r) => r.json())
      .then((data) => {
        setEnabled(data.notifyOnRunComplete ?? true);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    try {
      await fetch("/api/settings/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyOnRunComplete: next }),
      });
    } catch {
      setEnabled(!next);
    }
    setSaving(false);
  };

  if (!loaded) return null;

  return (
    <div className="stack">
      <div className="settings-field" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span className="settings-field-label">Email me when reports finish</span>
          <p className="muted" style={{ fontSize: "0.82rem", margin: "0.25rem 0 0" }}>
            We&apos;ll send one email when a run completes successfully.
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={saving}
          style={{
            width: 44,
            height: 24,
            borderRadius: 12,
            border: "none",
            cursor: saving ? "wait" : "pointer",
            background: enabled ? "#1a6aff" : "rgba(255,255,255,0.15)",
            position: "relative",
            transition: "background 0.2s ease",
            flexShrink: 0,
          }}
          aria-label={enabled ? "Disable completion emails" : "Enable completion emails"}
        >
          <span
            style={{
              display: "block",
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#fff",
              position: "absolute",
              top: 3,
              left: enabled ? 23 : 3,
              transition: "left 0.2s ease",
            }}
          />
        </button>
      </div>
    </div>
  );
}
