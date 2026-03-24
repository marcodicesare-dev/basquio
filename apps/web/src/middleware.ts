import { NextResponse, type NextRequest } from "next/server";

import { createServerClient, type CookieOptions } from "@supabase/ssr";

import { sanitizeNextPath } from "@/lib/supabase/auth";

const protectedPagePrefixes = ["/dashboard", "/jobs", "/templates", "/artifacts", "/billing", "/settings", "/recipes"];
const protectedApiPaths = ["/api/generate", "/api/uploads/prepare"];

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next({
      request,
    });
  }

  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (isProtectedPage(pathname) && !user) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/sign-in";
    signInUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  if (isProtectedApi(pathname) && !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (pathname === "/sign-in" && user) {
    const nextPath = sanitizeNextPath(request.nextUrl.searchParams.get("next"), "/dashboard");
    return NextResponse.redirect(new URL(nextPath, request.url));
  }

  return response;
}

function isProtectedApi(pathname: string) {
  return protectedApiPaths.includes(pathname);
}

function isProtectedPage(pathname: string) {
  return protectedPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export const config = {
  matcher: ["/dashboard/:path*", "/jobs/:path*", "/templates/:path*", "/artifacts/:path*", "/billing/:path*", "/settings/:path*", "/recipes/:path*", "/api/generate", "/api/uploads/prepare", "/sign-in"],
};
