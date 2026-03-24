"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      router.push("/");
      router.refresh();
      return;
    }

    setIsPending(true);

    try {
      await supabase.auth.signOut();
      router.push("/");
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <button className="button small secondary sidebar-signout" type="button" onClick={handleClick} disabled={isPending}>
      {isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}
