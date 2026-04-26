"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Briefcase,
  Buildings,
  Files,
  FolderOpen,
  House,
  Plus,
  Sparkle,
  UsersThree,
  ChatText,
} from "@phosphor-icons/react";

import type { WorkspaceScope, ScopeCounts } from "@/lib/workspace/types";
import { SCOPE_KIND_LABELS, type ScopeKind } from "@/lib/workspace/constants";

type SidebarScopeTree = Record<ScopeKind, WorkspaceScope[]>;
type SidebarCopy = {
  home: string;
  clients: string;
  categories: string;
  functions: string;
  sources: string;
  people: string;
  memory: string;
  newClient: string;
  newCategory: string;
  newFunction: string;
  clientName: string;
  categoryName: string;
  functionName: string;
  add: string;
  adding: string;
  cancel: string;
  items: string;
};

export type SidebarConversationScope = {
  name: string;
  kindLabel: string;
  tooltip: string;
};

export type SidebarRecentConversation = {
  id: string;
  title: string;
  lastMessageAt: string;
  scope?: SidebarConversationScope | null;
};

const DEFAULT_COPY: SidebarCopy = {
  home: "Home",
  clients: "Clients",
  categories: "Categories",
  functions: "Functions",
  sources: "Sources",
  people: "People",
  memory: "Knowledge",
  newClient: "New client",
  newCategory: "New category",
  newFunction: "New function",
  clientName: "Client name",
  categoryName: "Category name",
  functionName: "Function name",
  add: "Add",
  adding: "Adding",
  cancel: "Cancel",
  items: "items",
};

const KIND_ICON: Record<Exclude<ScopeKind, "system">, typeof Buildings> = {
  client: Buildings,
  category: FolderOpen,
  function: Briefcase,
};

export function WorkspaceSidebar({
  tree,
  counts,
  recentConversations = [],
  copy = DEFAULT_COPY,
  onNavigate,
}: {
  tree: SidebarScopeTree;
  counts: Record<string, ScopeCounts>;
  recentConversations?: SidebarRecentConversation[];
  copy?: SidebarCopy;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [openForm, setOpenForm] = useState<Exclude<ScopeKind, "system"> | null>(null);

  const peopleActive =
    pathname === "/workspace/people" || pathname.startsWith("/workspace/people/");
  const memoryActive =
    pathname === "/workspace/memory" || pathname.startsWith("/workspace/memory/");
  const sourcesActive =
    pathname === "/workspace/sources" || pathname.startsWith("/workspace/sources/");
  const scopeActiveAny = pathname.startsWith("/workspace/scope/");
  const chatActiveAny = pathname.startsWith("/workspace/chat/");
  const homeActive =
    pathname === "/workspace" ||
    (!peopleActive && !memoryActive && !sourcesActive && !scopeActiveAny && !chatActiveAny);

  const navigateWithTransition = useCallback(
    () => (event: React.MouseEvent<HTMLAnchorElement>) => {
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
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const transitionDocument = (
        document as Document & {
          startViewTransition?: (callback: () => void) => void;
        }
      );
      onNavigate?.();
      if (transitionDocument.startViewTransition && !reducedMotion) {
        transitionDocument.startViewTransition(() => {});
      }
    },
    [onNavigate],
  );

  function scopeHref(scope: WorkspaceScope) {
    return `/workspace/scope/${scope.kind}/${scope.slug}`;
  }

  function scopeActive(scope: WorkspaceScope) {
    return pathname === scopeHref(scope);
  }

  const kinds: Array<Exclude<ScopeKind, "system">> = ["client", "category", "function"];

  return (
    <div id="wbeta-workspace-nav" className="wbeta-sidebar-nav-root" aria-label="Workspace navigation">
      <nav className="wbeta-sidebar-nav">
        <Link
          href="/workspace"
          className={homeActive ? "wbeta-nav-link wbeta-nav-link-active" : "wbeta-nav-link"}
          aria-current={homeActive ? "page" : undefined}
          onClick={navigateWithTransition()}
        >
          <span className="wbeta-nav-icon" aria-hidden>
            <House size={16} weight={homeActive ? "fill" : "regular"} />
          </span>
          <span className="wbeta-nav-label">{copy.home}</span>
        </Link>
      </nav>

      <section className="wbeta-sidebar-section wbeta-sidebar-recent">
        <header className="wbeta-sidebar-head">
          <span className="wbeta-sidebar-head-icon" aria-hidden>
            <ChatText size={14} weight="regular" />
          </span>
          <span className="wbeta-sidebar-head-label">Recent chats</span>
          <Link
            href="/workspace"
            className="wbeta-sidebar-new-chat"
            onClick={navigateWithTransition()}
          >
            New
          </Link>
        </header>
        {recentConversations.length > 0 ? (
          <ul className="wbeta-sidebar-list">
            {recentConversations.slice(0, 6).map((conversation) => {
              const active = pathname === `/workspace/chat/${conversation.id}`;
              const scope = conversation.scope ?? workspaceScopeFallback();
              const scopeLabel = formatConversationScope(scope);
              return (
                <li key={conversation.id}>
                  <Link
                    href={`/workspace/chat/${conversation.id}`}
                    className={
                      active
                        ? "wbeta-sidebar-item wbeta-sidebar-chat-item wbeta-sidebar-item-active"
                        : "wbeta-sidebar-item wbeta-sidebar-chat-item"
                    }
                    aria-current={active ? "page" : undefined}
                    onClick={navigateWithTransition()}
                  >
                    <span className="wbeta-sidebar-chat-main">
                      <span className="wbeta-sidebar-item-name">{conversation.title}</span>
                      <span
                        className="wbeta-sidebar-chat-scope"
                        aria-label={`${scopeLabel}. ${scope.tooltip}`}
                      >
                        <span className="wbeta-sidebar-chat-scope-label">{scopeLabel}</span>
                        <span className="wbeta-sidebar-chat-scope-tip" role="tooltip">
                          {scope.tooltip}
                        </span>
                      </span>
                    </span>
                    <span className="wbeta-sidebar-item-time">
                      {relativeTime(conversation.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="wbeta-sidebar-empty">Start a chat and it will stay here.</p>
        )}
      </section>

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
              <span className="wbeta-sidebar-head-label">{kindLabel(kind, copy)}</span>
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
                        onClick={navigateWithTransition()}
                      >
                        <span className="wbeta-sidebar-item-name">{scope.name}</span>
                        {badge > 0 ? (
                          <span className="wbeta-sidebar-item-badge" aria-label={`${badge} ${copy.items}`}>
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
                copy={copy}
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
                <span>{newLabel(kind, copy)}</span>
              </button>
            )}
          </section>
        );
      })}

      <nav className="wbeta-sidebar-nav wbeta-sidebar-nav-bottom">
        <Link
          href="/workspace/sources"
          className={sourcesActive ? "wbeta-nav-link wbeta-nav-link-active" : "wbeta-nav-link"}
          aria-current={sourcesActive ? "page" : undefined}
          onClick={navigateWithTransition()}
        >
          <span className="wbeta-nav-icon" aria-hidden>
            <Files size={16} weight={sourcesActive ? "fill" : "regular"} />
          </span>
          <span className="wbeta-nav-label">{copy.sources}</span>
        </Link>
        <Link
          href="/workspace/people"
          className={peopleActive ? "wbeta-nav-link wbeta-nav-link-active" : "wbeta-nav-link"}
          aria-current={peopleActive ? "page" : undefined}
          onClick={navigateWithTransition()}
        >
          <span className="wbeta-nav-icon" aria-hidden>
            <UsersThree size={16} weight={peopleActive ? "fill" : "regular"} />
          </span>
          <span className="wbeta-nav-label">{copy.people}</span>
        </Link>
        <Link
          href="/workspace/memory"
          className={memoryActive ? "wbeta-nav-link wbeta-nav-link-active" : "wbeta-nav-link"}
          aria-current={memoryActive ? "page" : undefined}
          onClick={navigateWithTransition()}
        >
          <span className="wbeta-nav-icon" aria-hidden>
            <Sparkle size={16} weight={memoryActive ? "fill" : "regular"} />
          </span>
          <span className="wbeta-nav-label">{copy.memory}</span>
        </Link>
      </nav>
    </div>
  );
}

function workspaceScopeFallback(): SidebarConversationScope {
  return {
    name: "Workspace",
    kindLabel: "Workspace",
    tooltip: "This chat was not tied to a specific client or category.",
  };
}

function formatConversationScope(scope: SidebarConversationScope): string {
  if (scope.kindLabel === "Workspace") return "Workspace";
  return `${scope.kindLabel}: ${scope.name}`;
}

function relativeTime(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function NewScopeForm({
  kind,
  copy,
  onCancel,
  onCreated,
}: {
  kind: Exclude<ScopeKind, "system">;
  copy: SidebarCopy;
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
    <form className="wbeta-sidebar-newform" onSubmit={handleSubmit} aria-busy={busy || pending}>
      <input
        className="wbeta-sidebar-input"
        type="text"
        placeholder={
          kind === "client" ? copy.clientName : kind === "category" ? copy.categoryName : copy.functionName
        }
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
          {copy.cancel}
        </button>
        <button
          type="submit"
          className="wbeta-sidebar-newform-save"
          disabled={!name.trim() || busy || pending}
          aria-busy={busy || pending}
          data-loading={busy || pending ? "true" : undefined}
        >
          {busy || pending ? copy.adding : copy.add}
        </button>
      </div>
      {error ? <p className="wbeta-sidebar-newform-error">{error}</p> : null}
    </form>
  );
}

function kindLabel(kind: Exclude<ScopeKind, "system">, copy: SidebarCopy) {
  if (kind === "client") return copy.clients;
  if (kind === "category") return copy.categories;
  if (kind === "function") return copy.functions;
  return SCOPE_KIND_LABELS[kind];
}

function newLabel(kind: Exclude<ScopeKind, "system">, copy: SidebarCopy) {
  if (kind === "client") return copy.newClient;
  if (kind === "category") return copy.newCategory;
  return copy.newFunction;
}

// Export the SidebarScopeTree type for parent-server-fetch convenience.
export type { SidebarScopeTree };
