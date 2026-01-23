#!/bin/bash

# ─────────────────────────────────────────────────────────────────────────────
# WhatsApp Outbound Message Testing Script
# ─────────────────────────────────────────────────────────────────────────────
# Tests all message types for WhatsApp connector
# Recipient: +5541988991078 (within 24h window)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Configuration
STAGING_URL="https://whatsapp-connector-staging-otr7m7leza-uc.a.run.app"
STAGING_TOKEN="ocaofficeTesting"
RECIPIENT="+5541988991078"
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
    local dedupe_key="whatsapp:tenant:$TENANT_ID:intent:$intent_id"
    local correlation_id=$(generate_uuid)
    local created_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
    
    cat <<EOF
{
  "intentId": "$intent_id",
  "tenantId": "$TENANT_ID",
  "provider": "whatsapp",
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
      "text": "🧪 Test Message - Text Type: Hello from WhatsApp Connector!"
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

# Test 4: Video Message (with mediaUrl for auto-upload)
test_video_message() {
    print_header "Test 4: VIDEO MESSAGE"
    
    # Using a reliable, fast-loading small video URL
    # Alternative: https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4 (too large)
    # Using a small test video from internet archive
    local payload=$(build_intent "video" '{
      "type": "video",
      "mediaUrl": "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
      "caption": "🎥 Test Video - Auto-uploaded"
    }')
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Video Message" "success" "$response"
    else
        print_result "Video Message" "error" "$response"
    fi
}

# Test 5: Document Message (with mediaUrl for auto-upload)
test_document_message() {
    print_header "Test 5: DOCUMENT MESSAGE"
    
    # Using mediaUrl - will be auto-uploaded by connector
    local payload=$(build_intent "document" '{
      "type": "document",
      "mediaUrl": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      "filename": "test-document.pdf",
      "caption": "📄 Test Document - Auto-uploaded"
    }')
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Document Message" "success" "$response"
    else
        print_result "Document Message" "error" "$response"
    fi
}

# Test 6: Location Message
test_location_message() {
    print_header "Test 6: LOCATION MESSAGE"
    
    local payload=$(build_intent "location" '{
      "type": "location",
      "latitude": -23.5505,
      "longitude": -46.6333,
      "name": "São Paulo, Brazil"
    }')
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Location Message" "success" "$response"
    else
        print_result "Location Message" "error" "$response"
    fi
}

# Test 7: Sticker Message (with mediaUrl for auto-upload)
test_sticker_message() {
    print_header "Test 7: STICKER MESSAGE"
    
    # IMPORTANT: Stickers MUST be exactly 512x512 pixels, WebP format, < 100KB
    # Using mediaUrl will auto-upload, but the source must meet Meta requirements
    # The URL below is NOT 512x512, so it will be uploaded but NOT delivered by WhatsApp
    # For production, use stickers that are exactly 512x512px
    local payload=$(build_intent "sticker" '{
      "type": "sticker",
      "mediaUrl": "https://www.gstatic.com/webp/gallery/1.webp"
    }')
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Sticker Message" "success" "$response"
    else
        print_result "Sticker Message" "error" "$response"
    fi
}

# Test 8: Contact Message (multiple contacts like real fixture)
test_contact_message() {
    print_header "Test 8: CONTACT MESSAGE"
    
    local payload=$(build_intent "contact" '{
      "type": "contacts",
      "contacts": [
        {
          "name": {
            "formatted_name": "John Example",
            "first_name": "John",
            "last_name": "Example"
          },
          "phones": [
            {
              "phone": "+5541988991078"
            }
          ],
          "emails": [
            {
              "email": "john@example.com"
            }
          ]
        },
        {
          "name": {
            "formatted_name": "Jane Smith",
            "first_name": "Jane",
            "last_name": "Smith"
          },
          "phones": [
            {
              "phone": "+5541999990000"
            }
          ],
          "emails": [
            {
              "email": "jane@example.com"
            }
          ]
        }
      ]
    }')
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Contact Message" "success" "$response"
    else
        print_result "Contact Message" "error" "$response"
    fi
}

# Test 9: Reaction Message
test_reaction_message() {
    print_header "Test 9: REACTION MESSAGE"
    
    # Using a test messageId for reaction
    local test_message_id="wamid.HBgMNTU0MTg4OTkxMDc4FQIAERgSQTA4ODhGNjEzMUIwQjREN0NGAA=="
    
    local payload=$(build_intent "reaction" "{
      \"type\": \"reaction\",
      \"messageId\": \"$test_message_id\",
      \"emoji\": \"😊\"
    }")
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Reaction Message" "success" "$response"
    else
        print_result "Reaction Message" "error" "$response"
    fi
}

# Test 10: Mark Read Message
test_mark_read_message() {
    print_header "Test 10: MARK READ MESSAGE"
    
    # Using a test messageId for mark_read
    local test_message_id="wamid.HBgMNTU0MTg4OTkxMDc4FQIAERgSQTA4ODhGNjEzMUIwQjREN0NGAA=="
    
    local payload=$(build_intent "mark_read" "{
      \"type\": \"mark_read\",
      \"messageId\": \"$test_message_id\"
    }")
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Mark Read Message" "success" "$response"
    else
        print_result "Mark Read Message" "error" "$response"
    fi
}

# Test 11: Template Message (using approved hello_world template)
test_template_message() {
    print_header "Test 11: TEMPLATE MESSAGE"
    
    local payload=$(build_intent "template" '{
      "type": "template",
      "templateName": "hello_world",
      "languageCode": "en_US"
    }')
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        print_result "Template Message" "success" "$response"
    else
        print_result "Template Message" "error" "$response"
    fi
}

# Main execution
main() {
    print_header "WhatsApp Outbound Message Testing"
    echo -e "Service URL: ${YELLOW}$STAGING_URL${NC}"
    echo -e "Recipient: ${YELLOW}$RECIPIENT${NC}"
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
    
    test_location_message
    sleep 1
    
    test_sticker_message
    sleep 1
    
    test_contact_message
    sleep 1
    
    test_reaction_message
    sleep 1
    
    test_mark_read_message
    sleep 1
    
    test_template_message
    
    print_header "Test Summary Complete"
    echo -e "${GREEN}All WhatsApp message types tested!${NC}\n"
}

main "$@"
