import Link from "next/link";

import { GenerationForm } from "@/components/generation-form";

export default function NewJobPage() {
  return (
    <div className="page-shell workspace-page">
      <section className="workspace-page-head">
        <h1>New analysis</h1>

        <Link className="button secondary" href="/artifacts">
          View presentations
        </Link>
      </section>

      <GenerationForm />
    </div>
  );
}
