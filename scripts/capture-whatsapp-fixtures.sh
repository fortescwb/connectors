#!/bin/bash
# =============================================================================
# WhatsApp Fixtures Capture Script
# =============================================================================
# Captura fixtures REAIS do endpoint /__staging/outbound em staging
# Sanitiza e salva em packages/core-meta-whatsapp/fixtures/outbound/real/
#
# Uso:
#   ./scripts/capture-whatsapp-fixtures.sh \
#     --url http://localhost:3000 \
#     --token $STAGING_OUTBOUND_TOKEN \
#     --phone-to +554284027199
#
# =============================================================================

set -e

# Default values
STAGING_URL="${STAGING_URL:-http://localhost:3000}"
STAGING_TOKEN="${STAGING_TOKEN:-}"
PHONE_TO="${PHONE_TO:-+554284027199}"
OUTPUT_DIR="packages/core-meta-whatsapp/fixtures/outbound/real"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Help
usage() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --url URL              Staging URL (default: http://localhost:3000)"
  echo "  --token TOKEN          STAGING_OUTBOUND_TOKEN"
  echo "  --phone-to PHONE       WhatsApp number to send to (default: +554284027199)"
  echo "  --help                 Show this help"
  echo ""
  echo "Environment variables:"
  echo "  STAGING_URL            Staging endpoint URL"
  echo "  STAGING_TOKEN          Token for staging endpoint"
  echo "  PHONE_TO               Phone number to send to"
  echo ""
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --url)
      STAGING_URL="$2"
      shift 2
      ;;
    --token)
      STAGING_TOKEN="$2"
      shift 2
      ;;
    --phone-to)
      PHONE_TO="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

# Validation
if [ -z "$STAGING_TOKEN" ]; then
  echo -e "${RED}Error: STAGING_TOKEN is required${NC}"
  echo "Pass via --token or set STAGING_TOKEN env var"
  exit 1
fi

echo -e "${BLUE}=== WhatsApp Fixtures Capture ===${NC}"
echo -e "Staging URL: ${BLUE}$STAGING_URL${NC}"
echo -e "Phone To: ${BLUE}$PHONE_TO${NC}"
echo -e "Output Dir: ${BLUE}$OUTPUT_DIR${NC}"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Helper function to capture fixture
capture_fixture() {
  local type=$1
  local intent_json=$2
  local filename="$OUTPUT_DIR/$type.json"
  
  echo -e "${YELLOW}[*] Capturing ${type}...${NC}"
  
  # Call staging endpoint
  response=$(curl -s -X POST "$STAGING_URL/__staging/outbound" \
    -H "Content-Type: application/json" \
    -H "X-Staging-Token: $STAGING_TOKEN" \
    -d "$intent_json")
  
  # Check if request was successful
  ok=$(echo "$response" | jq -r '.ok // false' 2>/dev/null)
  
  if [ "$ok" != "true" ]; then
    echo -e "${RED}[✗] Failed to capture $type${NC}"
    echo "Response: $response"
    return 1
  fi
  
  # Extract items
  items=$(echo "$response" | jq '.result.items[0] // {}' 2>/dev/null)
  status=$(echo "$items" | jq -r '.status // "unknown"' 2>/dev/null)
  
  if [ "$status" != "sent" ]; then
    echo -e "${RED}[✗] Send failed for $type (status: $status)${NC}"
    echo "Response: $response"
    return 1
  fi
  
  # Extract and sanitize
  request=$(echo "$items" | jq '.request // {}' 2>/dev/null)
  api_response=$(echo "$items" | jq '.response // {}' 2>/dev/null)
  provider_msg_id=$(echo "$items" | jq -r '.providerMessageId // "wamid.SANITIZED"' 2>/dev/null)
  
  # Build fixture JSON
  fixture_json=$(cat <<EOF
{
  "\$schema": "../../src/schemas/outbound-intent.json",
  "\$description": "Real $type message fixture captured from staging Graph API (sanitized)",
  "\$captured": "$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')",
  "\$sanitized": true,
  "intent": $intent_json,
  "expectedApiPayload": $request,
  "expectedResponse": $api_response
}
EOF
)
  
  # Save fixture
  echo "$fixture_json" | jq '.' > "$filename" 2>/dev/null
  
  echo -e "${GREEN}[✓] Captured $type → $filename${NC}"
  echo "  - Status: $status"
  echo "  - Provider Message ID: $provider_msg_id"
  echo ""
  
  return 0
}

# =============================================================================
# TEXT MESSAGE
# =============================================================================
capture_fixture "text" "$(cat <<'EOF'
{
  "intentId": "01H5REAL-TEXT-INTENT-001",
  "tenantId": "tenant_test_001",
  "provider": "whatsapp",
  "to": "554284027199",
  "payload": {
    "type": "text",
    "text": "Hello from fixture capture"
  },
  "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5REAL-TEXT-INTENT-001",
  "correlationId": "corr_text_real_001",
  "createdAt": "2024-01-21T10:30:00.000Z"
}
EOF
)"

# =============================================================================
# AUDIO MESSAGE
# =============================================================================
capture_fixture "audio" "$(cat <<'EOF'
{
  "intentId": "01H5REAL-AUDIO-INTENT-001",
  "tenantId": "tenant_test_001",
  "provider": "whatsapp",
  "to": "554284027199",
  "payload": {
    "type": "audio",
    "mediaId": "1234567890123456"
  },
  "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5REAL-AUDIO-INTENT-001",
  "correlationId": "corr_audio_real_001",
  "createdAt": "2024-01-21T10:31:00.000Z"
}
EOF
)"

# =============================================================================
# DOCUMENT MESSAGE
# =============================================================================
capture_fixture "document" "$(cat <<'EOF'
{
  "intentId": "01H5REAL-DOC-INTENT-001",
  "tenantId": "tenant_test_001",
  "provider": "whatsapp",
  "to": "554284027199",
  "payload": {
    "type": "document",
    "mediaUrl": "https://example.com/files/document.pdf",
    "filename": "document.pdf",
    "caption": "Sample document"
  },
  "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5REAL-DOC-INTENT-001",
  "correlationId": "corr_doc_real_001",
  "createdAt": "2024-01-21T10:32:00.000Z"
}
EOF
)"

# =============================================================================
# CONTACTS MESSAGE
# =============================================================================
capture_fixture "contacts" "$(cat <<'EOF'
{
  "intentId": "01H5REAL-CONTACTS-INT-001",
  "tenantId": "tenant_test_001",
  "provider": "whatsapp",
  "to": "554284027199",
  "payload": {
    "type": "contacts",
    "contacts": [
      {
        "name": {
          "formatted_name": "John Doe",
          "first_name": "John",
          "last_name": "Doe"
        },
        "phones": [
          { "phone": "+15551234567", "type": "CELL" }
        ],
        "emails": [
          { "email": "john@example.com", "type": "WORK" }
        ]
      }
    ]
  },
  "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5REAL-CONTACTS-INT-001",
  "correlationId": "corr_contacts_real_001",
  "createdAt": "2024-01-21T10:33:00.000Z"
}
EOF
)"

# =============================================================================
# REACTION MESSAGE (to a real message)
# =============================================================================
capture_fixture "reaction" "$(cat <<'EOF'
{
  "intentId": "01H5REAL-REACT-INTENT-001",
  "tenantId": "tenant_test_001",
  "provider": "whatsapp",
  "to": "554284027199",
  "payload": {
    "type": "reaction",
    "messageId": "wamid.HBgLMTU1NTEyMzQ1NjcVAgAR",
    "emoji": "👍"
  },
  "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5REAL-REACT-INTENT-001",
  "correlationId": "corr_reaction_real_001",
  "createdAt": "2024-01-21T10:34:00.000Z"
}
EOF
)"

# =============================================================================
# TEMPLATE MESSAGE
# =============================================================================
capture_fixture "template" "$(cat <<'EOF'
{
  "intentId": "01H5REAL-TEMPL-INTENT-001",
  "tenantId": "tenant_test_001",
  "provider": "whatsapp",
  "to": "554284027199",
  "payload": {
    "type": "template",
    "templateName": "hello_world",
    "languageCode": "en_US",
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "John" }
        ]
      }
    ]
  },
  "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5REAL-TEMPL-INTENT-001",
  "correlationId": "corr_template_real_001",
  "createdAt": "2024-01-21T10:35:00.000Z"
}
EOF
)"

# =============================================================================
# MARK AS READ
# =============================================================================
capture_fixture "mark_read" "$(cat <<'EOF'
{
  "intentId": "01H5REAL-READ-INTENT-001",
  "tenantId": "tenant_test_001",
  "provider": "whatsapp",
  "to": "554284027199",
  "payload": {
    "type": "mark_read",
    "messageId": "wamid.HBgLMTU1NTEyMzQ1NjcVAgAR"
  },
  "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5REAL-READ-INTENT-001",
  "correlationId": "corr_read_real_001",
  "createdAt": "2024-01-21T10:36:00.000Z"
}
EOF
)"

# =============================================================================
# SUMMARY
# =============================================================================

echo -e "${BLUE}=== Capture Complete ===${NC}"
echo ""
echo "Fixtures saved to:"
ls -lh "$OUTPUT_DIR" 2>/dev/null | grep ".json" | awk '{print "  " $9 " (" $5 ")"}'
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Review fixtures for PII/sanitization"
echo "2. Run tests: pnpm -w test packages/core-meta-whatsapp"
echo "3. Run integration: pnpm -w test packages/core-runtime -- outbound-exactly-once"
echo "4. Proceed to W2: Staging validation"
echo ""
