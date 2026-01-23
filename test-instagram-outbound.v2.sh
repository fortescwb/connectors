#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Instagram Outbound Message Testing Script (v2)
# ─────────────────────────────────────────────────────────────────────────────
# Sends outbound intents to the Instagram connector staging endpoint using the
# canonical /__staging/outbound contract: { intents: [ OutboundMessageIntent ] }.
#
# Notes:
# - clientMessageId is REQUIRED by the current Instagram outbound intent schema.
# - Some message "types" may still be scaffold-only; in that case the API may
#   return ok:true with status=failed for the item. This script surfaces that.
# - Recipient may need to be a numeric recipientId depending on your integration
#   setup; using @handle may fail even if the connector is correct.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Config (override via env vars)
STAGING_URL="${STAGING_URL:-https://instagram-connector-staging-693285708638.us-central1.run.app}"
STAGING_TOKEN="${STAGING_TOKEN:-ocaofficeTesting}"
TENANT_ID="${TENANT_ID:-test-tenant}"
RECIPIENT="${RECIPIENT:-jfs_jamis}"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

generate_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    # Fallback UUID-ish (good enough for tests)
    python3 - <<'PY'
import uuid
print(str(uuid.uuid4()))
PY
  fi
}

now_iso() {
  date -u +'%Y-%m-%dT%H:%M:%SZ'
}

print_banner() {
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
}

print_result() {
  local label="$1"
  local ok="$2"
  local response="$3"

  if [[ "$ok" == "true" ]]; then
    echo -e "${GREEN}✓ ${label}${NC}"
  else
    echo -e "${RED}✗ ${label}${NC}"
  fi
  echo "  Response: ${response}"
}

post_intent() {
  local intent_json="$1"
  local req_json
  req_json="$(cat <<EOF
{
  "intents": [
    ${intent_json}
  ]
}
EOF
)"

  # Use --fail-with-body so HTTP errors are shown; still capture output.
  local response
  response="$(curl -sS --fail-with-body -X POST \
    "${STAGING_URL}/__staging/outbound" \
    -H "Content-Type: application/json" \
    -H "X-Staging-Token: ${STAGING_TOKEN}" \
    -d "${req_json}" || true)"

  # Determine overall ok field (best-effort grep)
  local ok="false"
  if echo "$response" | grep -q '"ok":[[:space:]]*true'; then
    ok="true"
  fi

  echo "$ok|$response"
}

build_intent() {
  local payload_json="$1"

  local intent_id
  intent_id="$(generate_uuid)"
  local correlation_id
  correlation_id="$(generate_uuid)"
  local created_at
  created_at="$(now_iso)"
  local dedupe_key="instagram:tenant:${TENANT_ID}:intent:${intent_id}"

  cat <<EOF
{
  "intentId": "${intent_id}",
  "tenantId": "${TENANT_ID}",
  "provider": "instagram",
  "to": "${RECIPIENT}",
  "payload": ${payload_json},
  "dedupeKey": "${dedupe_key}",
  "correlationId": "${correlation_id}",
  "createdAt": "${created_at}"
}
EOF
}

# ─────────────────────────────────────────────────────────────────────────────
# Tests (same intent as the original script tried to run)
# ─────────────────────────────────────────────────────────────────────────────

test_text() {
  print_banner "Test 1: TEXT MESSAGE"

  local client_id
  client_id="$(generate_uuid)"

  local payload_json
  payload_json="$(cat <<EOF
{
  "type": "text",
  "clientMessageId": "${client_id}",
  "text": "🧪 Test Message - Text Type: Hello from Instagram Connector!"
}
EOF
)"
  local intent
  intent="$(build_intent "${payload_json}")"

  local out
  out="$(post_intent "${intent}")"
  local ok="${out%%|*}"
  local resp="${out#*|}"
  print_result "Text Message" "${ok}" "${resp}"
}

test_image() {
  print_banner "Test 2: IMAGE MESSAGE"

  local client_id
  client_id="$(generate_uuid)"

  local payload_json
  payload_json="$(cat <<EOF
{
  "type": "image",
  "clientMessageId": "${client_id}",
  "mediaUrl": "https://www.gstatic.com/webp/gallery/1.png",
  "caption": "📸 Test Image - This is a sample image"
}
EOF
)"
  local intent
  intent="$(build_intent "${payload_json}")"

  local out
  out="$(post_intent "${intent}")"
  local ok="${out%%|*}"
  local resp="${out#*|}"
  print_result "Image Message" "${ok}" "${resp}"
}

test_audio() {
  print_banner "Test 3: AUDIO MESSAGE"

  local client_id
  client_id="$(generate_uuid)"

  local payload_json
  payload_json="$(cat <<EOF
{
  "type": "audio",
  "clientMessageId": "${client_id}",
  "mediaUrl": "https://www2.cs.uic.edu/~i101/SoundFiles/StarWars3.wav",
  "caption": "🎵 Test Audio - Sample audio file"
}
EOF
)"
  local intent
  intent="$(build_intent "${payload_json}")"

  local out
  out="$(post_intent "${intent}")"
  local ok="${out%%|*}"
  local resp="${out#*|}"
  print_result "Audio Message" "${ok}" "${resp}"
}

test_video() {
  print_banner "Test 4: VIDEO MESSAGE"

  local client_id
  client_id="$(generate_uuid)"

  local payload_json
  payload_json="$(cat <<EOF
{
  "type": "video",
  "clientMessageId": "${client_id}",
  "mediaUrl": "https://www.w3schools.com/html/mov_bbb.mp4",
  "caption": "🎥 Test Video - Big Buck Bunny"
}
EOF
)"
  local intent
  intent="$(build_intent "${payload_json}")"

  local out
  out="$(post_intent "${intent}")"
  local ok="${out%%|*}"
  local resp="${out#*|}"
  print_result "Video Message" "${ok}" "${resp}"
}

test_document() {
  print_banner "Test 5: DOCUMENT MESSAGE"

  local client_id
  client_id="$(generate_uuid)"

  local payload_json
  payload_json="$(cat <<EOF
{
  "type": "document",
  "clientMessageId": "${client_id}",
  "mediaUrl": "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf_file.pdf",
  "filename": "test-document.pdf",
  "caption": "📄 Test Document"
}
EOF
)"
  local intent
  intent="$(build_intent "${payload_json}")"

  local out
  out="$(post_intent "${intent}")"
  local ok="${out%%|*}"
  local resp="${out#*|}"
  print_result "Document Message" "${ok}" "${resp}"
}

test_link() {
  print_banner "Test 6: LINK MESSAGE"

  # Most APIs treat "link" as plain text; we keep the original "link" intent type
  # as the script attempted, but embed URL in the payload.
  local client_id
  client_id="$(generate_uuid)"

  local payload_json
  payload_json="$(cat <<EOF
{
  "type": "link",
  "clientMessageId": "${client_id}",
  "url": "https://github.com",
  "text": "Check out GitHub"
}
EOF
)"
  local intent
  intent="$(build_intent "${payload_json}")"

  local out
  out="$(post_intent "${intent}")"
  local ok="${out%%|*}"
  local resp="${out#*|}"
  print_result "Link Message" "${ok}" "${resp}"
}

main() {
  print_banner "Instagram Outbound Message Testing"
  echo -e "Service URL: ${YELLOW}${STAGING_URL}${NC}"
  echo -e "Recipient: ${YELLOW}@${RECIPIENT}${NC}"
  echo -e "Tenant: ${YELLOW}${TENANT_ID}${NC}"
  echo -e "Test Window: 24h (within message window)\n"

  test_text; sleep 1
  test_image; sleep 1
  test_audio; sleep 1
  test_video; sleep 1
  test_document; sleep 1
  test_link

  print_banner "Test Summary Complete"
  echo "All Instagram message types tested!"
}

main "$@"
