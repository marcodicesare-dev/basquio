#!/usr/bin/env bash
#
# Generate a Supabase SSR auth cookie for marco@basquio.com and save it to
# /tmp/marco-sb-cookie.txt in Netscape cookie format for use with curl -b.
#
# Usage:
#   ./scripts/auth-as-marco.sh
#   curl -s -L -b /tmp/marco-sb-cookie.txt https://basquio.com/workspace -o /tmp/out.html
#
# Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from apps/web/.env.local.
# Only works for team-beta-eligible emails (@basquio.com).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/apps/web/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

SB_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
SB_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
EMAIL="${1:-marco@basquio.com}"

if [[ -z "$SB_URL" || -z "$SB_KEY" ]]; then
  echo "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in $ENV_FILE" >&2
  exit 1
fi

LINK_JSON=$(curl -s -X POST "${SB_URL}/auth/v1/admin/generate_link" \
  -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"magiclink\",\"email\":\"${EMAIL}\"}")

ACTION_LINK=$(echo "$LINK_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('action_link',''))")
if [[ -z "$ACTION_LINK" ]]; then
  echo "Supabase admin generate_link returned no action_link. Response:" >&2
  echo "$LINK_JSON" >&2
  exit 1
fi

FINAL_URL=$(curl -s -L -o /dev/null -w "%{url_effective}" "$ACTION_LINK")
export FINAL_URL
export SB_URL SB_KEY

python3 - <<'PY'
import urllib.parse as u, json as j, base64, subprocess, os
final = os.environ["FINAL_URL"]
frag = final.split("#", 1)[1] if "#" in final else ""
params = dict(p.split("=", 1) for p in frag.split("&") if "=" in p)
access = u.unquote(params.get("access_token", ""))
refresh = u.unquote(params.get("refresh_token", ""))
expires_at = int(params.get("expires_at", "0"))
expires_in = int(params.get("expires_in", "3600"))

sb_url = os.environ["SB_URL"]
sb_key = os.environ["SB_KEY"]
user_resp = subprocess.check_output(
    ["curl", "-s", f"{sb_url}/auth/v1/user",
     "-H", f"apikey: {sb_key}",
     "-H", f"Authorization: Bearer {access}"]
)
user = j.loads(user_resp)
session = {
    "access_token": access,
    "refresh_token": refresh,
    "expires_at": expires_at,
    "expires_in": expires_in,
    "token_type": params.get("token_type", "bearer"),
    "user": user,
}
raw = j.dumps(session, separators=(",", ":")).encode()
b64 = base64.b64encode(raw).decode()
cookie_value = "base64-" + b64
project_ref = sb_url.split("//")[1].split(".")[0]
cookie_name = f"sb-{project_ref}-auth-token"

with open("/tmp/marco-sb-cookie.txt", "w") as f:
    f.write("# Netscape HTTP Cookie File\n")
    f.write(f"basquio.com\tFALSE\t/\tTRUE\t{expires_at}\t{cookie_name}\t{cookie_value}\n")
print(f"Cookie written: /tmp/marco-sb-cookie.txt")
print(f"User: {user.get('email')} ({user.get('id')})")
print(f"Expires in: {expires_in}s")
PY
