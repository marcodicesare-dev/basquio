import { WorkspaceSkeleton } from "@/components/workspace-skeleton";

export default function WorkspaceLoading() {
  return (
    <div className="wbeta-loading-shell" role="status" aria-label="Loading workspace">
      <aside className="wbeta-loading-side" aria-hidden>
        <WorkspaceSkeleton density="line" width={96} height={18} />
        <WorkspaceSkeleton density="card" height={44} />
        <div className="wbeta-loading-side-group">
          <WorkspaceSkeleton density="line" width="42%" />
          <WorkspaceSkeleton density="line" width="84%" />
          <WorkspaceSkeleton density="line" width="72%" />
          <WorkspaceSkeleton density="line" width="78%" />
        </div>
        <div className="wbeta-loading-side-group">
          <WorkspaceSkeleton density="line" width="38%" />
          <WorkspaceSkeleton density="line" width="76%" />
          <WorkspaceSkeleton density="line" width="66%" />
        </div>
      </aside>
      <main className="wbeta-loading-main" aria-hidden>
        <div className="wbeta-loading-chat">
          <WorkspaceSkeleton density="line" width="56%" height={18} />
          <WorkspaceSkeleton density="card" height={92} />
          <WorkspaceSkeleton density="line" width="72%" />
          <WorkspaceSkeleton density="line" width="64%" />
          <WorkspaceSkeleton density="line" width="48%" />
        </div>
        <div className="wbeta-loading-composer">
          <WorkspaceSkeleton density="line" width="38%" />
          <WorkspaceSkeleton density="line" width="100%" height={42} />
        </div>
      </main>
    </div>
  );
}
