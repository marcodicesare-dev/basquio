import { getSupabaseServerClient } from "@/lib/supabase/server";

export type ViewerState = {
  configured: boolean;
  user: {
    id: string;
    email: string | null;
  } | null;
};

export async function getViewerState(): Promise<ViewerState> {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    return {
      configured: false,
      user: null,
    };
  }

  const { data } = await supabase.auth.getUser();

  return {
    configured: true,
    user: data.user
      ? {
          id: data.user.id,
          email: data.user.email ?? null,
        }
      : null,
  };
}
