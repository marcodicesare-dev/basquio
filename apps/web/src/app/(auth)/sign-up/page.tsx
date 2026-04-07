import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function SignUpRedirectPage() {
  redirect("/sign-in?mode=sign-up");
}
