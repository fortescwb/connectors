#!/bin/bash
# =============================================================================
# IG1 Fixture Capture (Instagram DM)
# =============================================================================
# Captura fixtures REAIS do endpoint /__staging/outbound para os tipos suportados
# (text, link, image, video, audio, document). Salva em
# packages/core-meta-instagram/fixtures/outbound/real
#
# Uso:
#   ./scripts/ig1-capture-fixtures.sh --url https://staging.example.com \
#     --token $STAGING_OUTBOUND_TOKEN \
#     --recipient 1789xxxxxxxxxxxx
#
# Flags adicionais:
#   --graph-token     Token opcional para chamadas diretas (não usado por padrão)
#   --ig-account-id   ID da conta IG Business (se app não estiver com env setado)
# =============================================================================

set -euo pipefail

STAGING_URL="${STAGING_URL:-http://localhost:3001}"
STAGING_TOKEN="${STAGING_TOKEN:-}"
RECIPIENT_ID="${RECIPIENT_ID:-}"
IG_ACCOUNT_ID="${IG_ACCOUNT_ID:-}"
GRAPH_TOKEN="${GRAPH_TOKEN:-}"
OUTPUT_DIR="packages/core-meta-instagram/fixtures/outbound/real"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
  cat <<'EOF'
Usage: ig1-capture-fixtures.sh [OPTIONS]

Options:
  --url URL              Base URL do app Instagram (default: http://localhost:3001)
  --token TOKEN          X-Staging-Token configurado no app
  --recipient ID         IG user ID para receber as DMs (obrigatório)
  --ig-account-id ID     IG Business Account ID (se o app não estiver configurado)
  --graph-token TOKEN    Token Graph opcional para debug/upload manual
  --help                 Exibe esta ajuda
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) STAGING_URL="$2"; shift 2 ;;
    --token) STAGING_TOKEN="$2"; shift 2 ;;
    --recipient) RECIPIENT_ID="$2"; shift 2 ;;
    --ig-account-id) IG_ACCOUNT_ID="$2"; shift 2 ;;
    --graph-token) GRAPH_TOKEN="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$STAGING_TOKEN" ]]; then
  echo -e "${RED}Erro: --token (X-Staging-Token) é obrigatório${NC}"
  exit 1
fi
if [[ -z "$RECIPIENT_ID" ]]; then
  echo -e "${RED}Erro: --recipient é obrigatório (IG user ID do tester)${NC}"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

capture_fixture() {
  local type="$1"
  local intent_json="$2"
  local filename="$OUTPUT_DIR/${type}.json"

  echo -e "${YELLOW}[*] Capturando ${type}...${NC}"

  local response
  response=$(curl -s -X POST "${STAGING_URL}/__staging/outbound" \
    -H "Content-Type: application/json" \
    -H "X-Staging-Token: ${STAGING_TOKEN}" \
    -d "{\"intents\":[${intent_json}]}")

  local ok
  ok=$(echo "$response" | jq -r '.ok // false' 2>/dev/null)
  if [[ "$ok" != "true" ]]; then
    echo -e "${RED}[✗] Falha ao enviar ${type}${NC}"
    echo "$response"
    return 1
  fi

  local item
  item=$(echo "$response" | jq '.result.results[0] // {}')
  local status
  status=$(echo "$item" | jq -r '.status // "unknown"')

  if [[ "$status" != "sent" ]]; then
    echo -e "${RED}[✗] Envio não foi marcado como sent (status=${status})${NC}"
    echo "$response"
    return 1
  fi

  local providerStatus
  providerStatus=$(echo "$item" | jq -r '.providerResponse.status // "n/a"')

  cat <<EOF | jq '.' > "$filename"
{
  "\$schema": "../../src/schemas/outbound-intent.json",
  "\$description": "Fixture real ${type} capturada via /__staging/outbound (sanitizada)",
  "\$captured": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "intent": ${intent_json},
  "result": ${item}
}
EOF

  echo -e "${GREEN}[✓] ${type} salvo em ${filename}${NC}"
  echo "  - providerStatus: ${providerStatus}"
}

echo -e "${BLUE}=== IG1 Capture ===${NC}"
echo "Staging URL: ${STAGING_URL}"
echo "Recipient: ${RECIPIENT_ID}"
echo "Output: ${OUTPUT_DIR}"
echo ""

# Text
capture_fixture "text" "$(cat <<'EOF'
{
  "intentId": "01IG-TEXT-INTENT-001",
  "tenantId": "tenant_ig1",
  "provider": "instagram",
  "to": "__RECIPIENT__",
  "payload": { "type": "text", "text": "Hello from IG1 fixture capture" },
  "dedupeKey": "instagram:tenant:tenant_ig1:intent:01IG-TEXT-INTENT-001",
  "correlationId": "ig1-text-001",
  "createdAt": "2025-01-22T10:30:00.000Z"
}
EOF
 | sed "s/__RECIPIENT__/${RECIPIENT_ID}/")"

# Link
capture_fixture "link" "$(cat <<'EOF'
{
  "intentId": "01IG-LINK-INTENT-001",
  "tenantId": "tenant_ig1",
  "provider": "instagram",
  "to": "__RECIPIENT__",
  "payload": { "type": "link", "url": "https://developers.facebook.com", "text": "Docs" },
  "dedupeKey": "instagram:tenant:tenant_ig1:intent:01IG-LINK-INTENT-001",
  "correlationId": "ig1-link-001",
  "createdAt": "2025-01-22T10:31:00.000Z"
}
EOF
 | sed "s/__RECIPIENT__/${RECIPIENT_ID}/")"

# Image (expects server to upload or accept URL)
capture_fixture "image" "$(cat <<'EOF'
{
  "intentId": "01IG-IMAGE-INTENT-001",
  "tenantId": "tenant_ig1",
  "provider": "instagram",
  "to": "__RECIPIENT__",
  "payload": { "type": "image", "url": "https://via.placeholder.com/640x640.png?text=IG1+Image", "caption": "image test" },
  "dedupeKey": "instagram:tenant:tenant_ig1:intent:01IG-IMAGE-INTENT-001",
  "correlationId": "ig1-image-001",
  "createdAt": "2025-01-22T10:32:00.000Z"
}
EOF
 | sed "s/__RECIPIENT__/${RECIPIENT_ID}/")"

# Video
capture_fixture "video" "$(cat <<'EOF'
{
  "intentId": "01IG-VIDEO-INTENT-001",
  "tenantId": "tenant_ig1",
  "provider": "instagram",
  "to": "__RECIPIENT__",
  "payload": { "type": "video", "url": "https://file-examples.com/storage/fe9f6/video.mp4", "caption": "video test" },
  "dedupeKey": "instagram:tenant:tenant_ig1:intent:01IG-VIDEO-INTENT-001",
  "correlationId": "ig1-video-001",
  "createdAt": "2025-01-22T10:33:00.000Z"
}
EOF
 | sed "s/__RECIPIENT__/${RECIPIENT_ID}/")"

# Audio
capture_fixture "audio" "$(cat <<'EOF'
{
  "intentId": "01IG-AUDIO-INTENT-001",
  "tenantId": "tenant_ig1",
  "provider": "instagram",
  "to": "__RECIPIENT__",
  "payload": { "type": "audio", "url": "https://file-examples.com/storage/fe9f6/audio.mp3" },
  "dedupeKey": "instagram:tenant:tenant_ig1:intent:01IG-AUDIO-INTENT-001",
  "correlationId": "ig1-audio-001",
  "createdAt": "2025-01-22T10:34:00.000Z"
}
EOF
 | sed "s/__RECIPIENT__/${RECIPIENT_ID}/")"

# Document
capture_fixture "document" "$(cat <<'EOF'
{
  "intentId": "01IG-DOC-INTENT-001",
  "tenantId": "tenant_ig1",
  "provider": "instagram",
  "to": "__RECIPIENT__",
  "payload": { "type": "document", "url": "https://file-examples.com/storage/fe9f6/document.pdf", "filename": "doc.pdf" },
  "dedupeKey": "instagram:tenant:tenant_ig1:intent:01IG-DOC-INTENT-001",
  "correlationId": "ig1-doc-001",
  "createdAt": "2025-01-22T10:35:00.000Z"
}
EOF
 | sed "s/__RECIPIENT__/${RECIPIENT_ID}/")"

echo ""
echo -e "${GREEN}IG1 COMPLETE${NC}"
echo "Verifique fixtures em ${OUTPUT_DIR} e sanitize tokens/IDs antes do commit."
