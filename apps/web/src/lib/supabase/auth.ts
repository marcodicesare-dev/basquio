import { getSupabaseServerClient } from "@/lib/supabase/server";
export {
  buildResetPasswordPath,
  buildSignInPath,
  sanitizeNextPath,
} from "@/lib/supabase/paths";

export type ViewerState = {
  configured: boolean;
  user: {
    id: string;
    email: string | null;
    user_metadata: Record<string, unknown> | null;
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
          user_metadata:
            data.user.user_metadata && typeof data.user.user_metadata === "object" && !Array.isArray(data.user.user_metadata)
              ? (data.user.user_metadata as Record<string, unknown>)
              : null,
        }
      : null,
  };
}
