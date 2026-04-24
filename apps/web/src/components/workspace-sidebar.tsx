"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Briefcase,
  Buildings,
  FolderOpen,
  House,
  Plus,
  Sparkle,
  UsersThree,
} from "@phosphor-icons/react";

import type { WorkspaceScope, ScopeCounts } from "@/lib/workspace/types";
import { SCOPE_KIND_LABELS, type ScopeKind } from "@/lib/workspace/constants";

type SidebarScopeTree = Record<ScopeKind, WorkspaceScope[]>;

const KIND_ICON: Record<Exclude<ScopeKind, "system">, typeof Buildings> = {
  client: Buildings,
  category: FolderOpen,
  function: Briefcase,
};

const KIND_NEW_LABEL: Record<Exclude<ScopeKind, "system">, string> = {
  client: "New client",
  category: "New category",
  function: "New function",
};

export function WorkspaceSidebar({
  tree,
  counts,
}: {
  tree: SidebarScopeTree;
  counts: Record<string, ScopeCounts>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [openForm, setOpenForm] = useState<Exclude<ScopeKind, "system"> | null>(null);

  const peopleActive = pathname === "/workspace/people" || pathname.startsWith("/workspace/people/");
  const memoryActive = pathname === "/workspace/memory" || pathname.startsWith("/workspace/memory/");
  const scopeActiveAny = pathname.startsWith("/workspace/scope/");
  // Home is the fallback for any /workspace path that isn't scope / people / memory
  // so deliverable detail pages still read as "you are inside workspace".
  const homeActive = !peopleActive && !memoryActive && !scopeActiveAny;

  const navigateWithTransition = useCallback(
    (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }
      event.preventDefault();
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const startViewTransition = (
        document as Document & {
          startViewTransition?: (callback: () => void) => void;
        }
      ).startViewTransition;
      if (startViewTransition && !reducedMotion) {
        startViewTransition(() => {
          router.push(href);
        });
        return;
      }
      router.push(href);
    },
    [router],
  );

  function scopeHref(scope: WorkspaceScope) {
    return `/workspace/scope/${scope.kind}/${scope.slug}`;
  }

  function scopeActive(scope: WorkspaceScope) {
    return pathname === scopeHref(scope);
  }

  const kinds: Array<Exclude<ScopeKind, "system">> = ["client", "category", "function"];

  return (
    <div className="wbeta-sidebar-nav-root" aria-label="Workspace navigation">
      <nav className="wbeta-sidebar-nav">
        <Link
          href="/workspace"
          className={homeActive ? "wbeta-nav-link wbeta-nav-link-active" : "wbeta-nav-link"}
          aria-current={homeActive ? "page" : undefined}
          onClick={navigateWithTransition("/workspace")}
        >
          <span className="wbeta-nav-icon" aria-hidden>
            <House size={16} weight={homeActive ? "fill" : "regular"} />
          </span>
          <span className="wbeta-nav-label">Home</span>
        </Link>
      </nav>

      {kinds.map((kind) => {
        const Icon = KIND_ICON[kind];
        const scopes = tree[kind];
        const isOpen = openForm === kind;
        return (
          <section key={kind} className="wbeta-sidebar-section">
            <header className="wbeta-sidebar-head">
              <span className="wbeta-sidebar-head-icon" aria-hidden>
                <Icon size={14} weight="regular" />
              </span>
              <span className="wbeta-sidebar-head-label">{SCOPE_KIND_LABELS[kind]}</span>
            </header>

            {scopes.length > 0 ? (
              <ul className="wbeta-sidebar-list">
                {scopes.map((scope) => {
                  const active = scopeActive(scope);
                  const c = counts[scope.id];
                  const badge = c
                    ? c.memory_count + c.deliverable_count + c.fact_count
                    : 0;
                  return (
                    <li key={scope.id}>
                      <Link
                        href={scopeHref(scope)}
                        className={
                          active
                            ? "wbeta-sidebar-item wbeta-sidebar-item-active"
                            : "wbeta-sidebar-item"
                        }
                        aria-current={active ? "page" : undefined}
                        onClick={navigateWithTransition(scopeHref(scope))}
                      >
                        <span className="wbeta-sidebar-item-name">{scope.name}</span>
                        {badge > 0 ? (
                          <span className="wbeta-sidebar-item-badge" aria-label={`${badge} items`}>
                            {badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {isOpen ? (
              <NewScopeForm
                kind={kind}
                onCancel={() => setOpenForm(null)}
                onCreated={(scope) => {
                  setOpenForm(null);
                  router.push(`/workspace/scope/${scope.kind}/${scope.slug}`);
                  router.refresh();
                }}
              />
            ) : (
              <button
                type="button"
                className="wbeta-sidebar-new"
                onClick={() => setOpenForm(kind)}
              >
                <span className="wbeta-sidebar-new-icon" aria-hidden>
                  <Plus size={13} weight="bold" />
                </span>
                <span>{KIND_NEW_LABEL[kind]}</span>
              </button>
            )}
          </section>
        );
      })}

      <nav className="wbeta-sidebar-nav wbeta-sidebar-nav-bottom">
        <Link
          href="/workspace/people"
          className={peopleActive ? "wbeta-nav-link wbeta-nav-link-active" : "wbeta-nav-link"}
          aria-current={peopleActive ? "page" : undefined}
          onClick={navigateWithTransition("/workspace/people")}
        >
          <span className="wbeta-nav-icon" aria-hidden>
            <UsersThree size={16} weight={peopleActive ? "fill" : "regular"} />
          </span>
          <span className="wbeta-nav-label">People</span>
        </Link>
        <Link
          href="/workspace/memory"
          className={memoryActive ? "wbeta-nav-link wbeta-nav-link-active" : "wbeta-nav-link"}
          aria-current={memoryActive ? "page" : undefined}
          onClick={navigateWithTransition("/workspace/memory")}
        >
          <span className="wbeta-nav-icon" aria-hidden>
            <Sparkle size={16} weight={memoryActive ? "fill" : "regular"} />
          </span>
          <span className="wbeta-nav-label">Memory</span>
        </Link>
      </nav>
    </div>
  );
}

function NewScopeForm({
  kind,
  onCancel,
  onCreated,
}: {
  kind: Exclude<ScopeKind, "system">;
  onCancel: () => void;
  onCreated: (scope: WorkspaceScope) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!trimmed || busy) return;
      setError(null);
      setBusy(true);
      try {
        const response = await fetch("/api/workspace/scopes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, name: trimmed }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          scope?: WorkspaceScope;
          error?: string;
        };
        if (!response.ok || !data.scope) {
          setError(data.error ?? "Could not add the scope. Try a different name.");
          return;
        }
        startTransition(() => onCreated(data.scope!));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add the scope.");
      } finally {
        setBusy(false);
      }
    },
    [name, kind, onCreated, busy],
  );

  return (
    <form className="wbeta-sidebar-newform" onSubmit={handleSubmit}>
      <input
        className="wbeta-sidebar-input"
        type="text"
        placeholder={kind === "client" ? "Client name" : kind === "category" ? "Category name" : "Function name"}
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoFocus
        maxLength={120}
        disabled={busy || pending}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="wbeta-sidebar-newform-row">
        <button
          type="button"
          className="wbeta-sidebar-newform-cancel"
          onClick={onCancel}
          disabled={busy || pending}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="wbeta-sidebar-newform-save"
          disabled={!name.trim() || busy || pending}
        >
          {busy || pending ? "Adding" : "Add"}
        </button>
      </div>
      {error ? <p className="wbeta-sidebar-newform-error">{error}</p> : null}
    </form>
  );
}

// Export the SidebarScopeTree type for parent-server-fetch convenience.
export type { SidebarScopeTree };
