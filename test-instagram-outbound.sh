#!/bin/bash

# ─────────────────────────────────────────────────────────────────────────────
# Instagram Outbound Message Testing Script
# ─────────────────────────────────────────────────────────────────────────────
# Tests all message types for Instagram connector
# Recipient: jfs_jamis (within 24h window)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Configuration
STAGING_URL="https://instagram-connector-staging-693285708638.us-central1.run.app"
STAGING_TOKEN="ocaofficeTesting"
RECIPIENT="jfs_jamis"
TENANT_ID="test-tenant"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function to generate UUIDs
generate_uuid() {
    # Simple UUID v4 generator (works on most systems)
    if command -v uuidgen &> /dev/null; then
        uuidgen | tr '[:upper:]' '[:lower:]'
    else
        # Fallback: generate pseudo-UUID
        echo "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx" | sed 's/x/[0-9a-f]/g; s/y/[89ab]/' | tr -d '\n' | head -c 36
    fi
}

# Helper function to print headers
print_header() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"
}

# Helper function to print test results
print_result() {
    local test_name=$1
    local status=$2
    local response=$3
    
    if [ "$status" = "success" ]; then
        echo -e "${GREEN}✓ $test_name${NC}"
    else
        echo -e "${RED}✗ $test_name${NC}"
    fi
    
    if [ -n "$response" ]; then
        echo -e "  Response: ${YELLOW}$response${NC}"
    fi
    echo
}

# Helper function to build intent payload
build_intent() {
    local msg_type=$1
    local payload_json=$2
    
    local intent_id=$(generate_uuid)
    local dedupe_key="instagram:tenant:$TENANT_ID:intent:$intent_id"
    local correlation_id=$(generate_uuid)
    local created_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
    
    cat <<EOF
{
  "intentId": "$intent_id",
  "tenantId": "$TENANT_ID",
  "provider": "instagram",
  "to": "$RECIPIENT",
  "payload": $payload_json,
  "dedupeKey": "$dedupe_key",
  "correlationId": "$correlation_id",
  "createdAt": "$created_at"
}
EOF
}

# Test 1: Text Message
test_text_message() {
    print_header "Test 1: TEXT MESSAGE"
    
    local payload=$(build_intent "text" '{
      "type": "text",
      "clientMessageId": "99d277e7-1ef4-4b11-a305-5ce017403eb9",
      "text": "🧪 Test Message - Text Type: Hello from Instagram Connector!"
    }')
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Text Message" "success" "$response"
    else
        print_result "Text Message" "error" "$response"
    fi
}

# Test 2: Image Message (with caption)
test_image_message() {
    print_header "Test 2: IMAGE MESSAGE"
    
    local payload=$(build_intent "image" '{
      "type": "image",
      "clientMessageId": "3800f9cb-ed48-4013-a538-747852b8889c",
      "mediaUrl": "https://www.gstatic.com/webp/gallery/1.png",
      "caption": "📸 Test Image - This is a sample image"
    }')
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Image Message" "success" "$response"
    else
        print_result "Image Message" "error" "$response"
    fi
}

# Test 3: Audio Message
test_audio_message() {
    print_header "Test 3: AUDIO MESSAGE"
    
    local payload=$(build_intent "audio" '{
      "type": "audio",
      "clientMessageId": "d6686363-4312-431e-a5a9-865f9e7f08c0",
      "mediaUrl": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
    }')
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Audio Message" "success" "$response"
    else
        print_result "Audio Message" "error" "$response"
    fi
}

# Test 4: Video Message (with caption)
test_video_message() {
    print_header "Test 4: VIDEO MESSAGE"
    
    local payload=$(cat <<EOF
{
  "intents": [
    {
      "id": "video-test-$(date +%s)",
      "type": "video",
      "recipient": "$RECIPIENT",
      "mediaUrl": "https://www.w3schools.com/html/mov_bbb.mp4",
      "caption": "🎥 Test Video - Big Buck Bunny"
    }
  ]
}
EOF
)
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "$payload")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Video Message" "success" "$response"
    else
        print_result "Video Message" "error" "$response"
    fi
}

# Test 5: Document Message (with filename)
test_document_message() {
    print_header "Test 5: DOCUMENT MESSAGE"
    
    local payload=$(cat <<EOF
{
  "intents": [
    {
      "id": "document-test-$(date +%s)",
      "type": "document",
      "recipient": "$RECIPIENT",
      "mediaUrl": "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf_file.pdf",
      "filename": "test-document.pdf",
      "caption": "📄 Test Document"
    }
  ]
}
EOF
)
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "$payload")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Document Message" "success" "$response"
    else
        print_result "Document Message" "error" "$response"
    fi
}

# Test 6: Link Message (Link with preview)
test_link_message() {
    print_header "Test 6: LINK MESSAGE"
    
    local payload=$(cat <<EOF
{
  "intents": [
    {
      "id": "link-test-$(date +%s)",
      "type": "link",
      "recipient": "$RECIPIENT",
      "url": "https://github.com",
      "text": "Check out GitHub"
    }
  ]
}
EOF
)
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "$payload")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Link Message" "success" "$response"
    else
        print_result "Link Message" "error" "$response"
    fi
}

# Main execution
main() {
    print_header "Instagram Outbound Message Testing"
    echo -e "Service URL: ${YELLOW}$STAGING_URL${NC}"
    echo -e "Recipient: ${YELLOW}@$RECIPIENT${NC}"
    echo -e "Test Window: 24h (within message window)${NC}\n"
    
    # Run all tests
    test_text_message
    sleep 1
    
    test_image_message
    sleep 1
    
    test_audio_message
    sleep 1
    
    test_video_message
    sleep 1
    
    test_document_message
    sleep 1
    
    test_link_message
    
    print_header "Test Summary Complete"
    echo -e "${GREEN}All Instagram message types tested!${NC}\n"
}

main "$@"
