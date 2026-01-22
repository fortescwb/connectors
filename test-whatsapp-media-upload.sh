#!/bin/bash

# ─────────────────────────────────────────────────────────────────────────────
# WhatsApp Media Upload & Outbound Testing Script
# ─────────────────────────────────────────────────────────────────────────────
# Uploads media to Meta Graph API and tests Video, Document, Sticker with mediaIds
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Configuration
STAGING_URL="https://whatsapp-connector-staging-otr7m7leza-uc.a.run.app"
STAGING_TOKEN="ocaofficeTesting"
RECIPIENT="+5541988991078"
TENANT_ID="test-tenant"

# Meta Graph API configuration
GRAPH_API_VERSION="v18.0"
WHATSAPP_ACCESS_TOKEN="${WHATSAPP_ACCESS_TOKEN:-}"
WHATSAPP_PHONE_NUMBER_ID="${WHATSAPP_PHONE_NUMBER_ID:-}"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function to generate UUIDs
generate_uuid() {
    if command -v uuidgen &> /dev/null; then
        uuidgen | tr '[:upper:]' '[:lower:]'
    else
        echo "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx" | sed 's/x/[0-9a-f]/g; s/y/[89ab]/' | tr -d '\n' | head -c 36
    fi
}

# Helper function to print headers
print_header() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"
}

# Helper function to print results
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

# Upload media to Meta Graph API and return mediaId
upload_media_to_meta() {
    local media_file=$1
    local media_type=$2
    
    if [ -z "$WHATSAPP_ACCESS_TOKEN" ] || [ -z "$WHATSAPP_PHONE_NUMBER_ID" ]; then
        echo "ERROR: WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set" >&2
        return 1
    fi
    
    local response=$(curl -s -X POST \
        "https://graph.instagram.com/$GRAPH_API_VERSION/$WHATSAPP_PHONE_NUMBER_ID/media" \
        -F "file=@$media_file" \
        -F "type=$media_type" \
        -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN")
    
    # Extract media ID from response
    echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

# Create test media files
create_test_video() {
    # Create a minimal MP4 video (using ffmpeg if available, otherwise use a placeholder)
    local video_file="/tmp/test_video_$$.mp4"
    
    if command -v ffmpeg &> /dev/null; then
        ffmpeg -f lavfi -i color=c=blue:s=320x240:d=1 -f lavfi -i sine=f=1000:d=1 \
            -pix_fmt yuv420p "$video_file" 2>/dev/null
    else
        # Fallback: copy from public URL
        curl -s -L "https://www.w3schools.com/html/mov_bbb.mp4" -o "$video_file" || true
    fi
    
    echo "$video_file"
}

create_test_document() {
    local doc_file="/tmp/test_document_$$.pdf"
    
    if command -v echo &> /dev/null; then
        # Create a minimal PDF using echo (works on most systems)
        printf '%%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 100 700 Td (Test Document) Tj ET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000244 00000 n\n0000000333 00000 n\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n428\n%%%%EOF' > "$doc_file"
    else
        # Fallback: copy from public URL
        curl -s -L "https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf_file.pdf" -o "$doc_file" || true
    fi
    
    echo "$doc_file"
}

create_test_sticker() {
    local sticker_file="/tmp/test_sticker_$$.webp"
    
    if command -v convert &> /dev/null; then
        # Create a minimal WebP sticker using ImageMagick
        convert -size 512x512 xc:blue "$sticker_file" 2>/dev/null || true
    else
        # Fallback: download from URL
        curl -s -L "https://www.gstatic.com/webp/gallery/1.png" -o "$sticker_file" || true
    fi
    
    echo "$sticker_file"
}

# Test Video with mediaId
test_video_with_upload() {
    print_header "Test: VIDEO MESSAGE (with uploaded mediaId)"
    
    # Check if we have credentials for upload
    if [ -z "$WHATSAPP_ACCESS_TOKEN" ] || [ -z "$WHATSAPP_PHONE_NUMBER_ID" ]; then
        echo -e "${YELLOW}⚠ Skipping media upload test - WHATSAPP credentials not set${NC}"
        echo "   To enable media upload tests, set:"
        echo "   export WHATSAPP_ACCESS_TOKEN=<your_token>"
        echo "   export WHATSAPP_PHONE_NUMBER_ID=<your_phone_id>"
        return
    fi
    
    local video_file=$(create_test_video)
    local media_id=$(upload_media_to_meta "$video_file" "video/mp4")
    
    if [ -z "$media_id" ]; then
        print_result "Video Message" "error" "Failed to upload media"
        return
    fi
    
    local payload=$(build_intent "video" "{
      \"type\": \"video\",
      \"mediaId\": \"$media_id\",
      \"caption\": \"🎥 Test Video - Uploaded to Meta\"
    }")
    
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
    
    rm -f "$video_file"
}

# Test Document with mediaId
test_document_with_upload() {
    print_header "Test: DOCUMENT MESSAGE (with uploaded mediaId)"
    
    if [ -z "$WHATSAPP_ACCESS_TOKEN" ] || [ -z "$WHATSAPP_PHONE_NUMBER_ID" ]; then
        echo -e "${YELLOW}⚠ Skipping media upload test - WHATSAPP credentials not set${NC}"
        return
    fi
    
    local doc_file=$(create_test_document)
    local media_id=$(upload_media_to_meta "$doc_file" "application/pdf")
    
    if [ -z "$media_id" ]; then
        print_result "Document Message" "error" "Failed to upload media"
        return
    fi
    
    local payload=$(build_intent "document" "{
      \"type\": \"document\",
      \"mediaId\": \"$media_id\",
      \"filename\": \"test-document.pdf\",
      \"caption\": \"📄 Test Document\"
    }")
    
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
    
    rm -f "$doc_file"
}

# Test Sticker with mediaId
test_sticker_with_upload() {
    print_header "Test: STICKER MESSAGE (with uploaded mediaId)"
    
    if [ -z "$WHATSAPP_ACCESS_TOKEN" ] || [ -z "$WHATSAPP_PHONE_NUMBER_ID" ]; then
        echo -e "${YELLOW}⚠ Skipping media upload test - WHATSAPP credentials not set${NC}"
        return
    fi
    
    local sticker_file=$(create_test_sticker)
    local media_id=$(upload_media_to_meta "$sticker_file" "image/webp")
    
    if [ -z "$media_id" ]; then
        print_result "Sticker Message" "error" "Failed to upload media"
        return
    fi
    
    local payload=$(build_intent "sticker" "{
      \"type\": \"sticker\",
      \"mediaId\": \"$media_id\"
    }")
    
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
    
    rm -f "$sticker_file"
}

# Main execution
main() {
    print_header "WhatsApp Media Upload & Outbound Testing"
    echo -e "Service URL: ${YELLOW}$STAGING_URL${NC}"
    echo -e "Recipient: ${YELLOW}$RECIPIENT${NC}"
    echo -e "Test Window: 24h (within message window)${NC}\n"
    
    if [ -z "$WHATSAPP_ACCESS_TOKEN" ] || [ -z "$WHATSAPP_PHONE_NUMBER_ID" ]; then
        echo -e "${YELLOW}ℹ Media upload tests disabled (credentials not set)${NC}"
        echo -e "To enable, export:"
        echo -e "  ${BLUE}export WHATSAPP_ACCESS_TOKEN=<token>${NC}"
        echo -e "  ${BLUE}export WHATSAPP_PHONE_NUMBER_ID=<phone_id>${NC}\n"
    fi
    
    # Run media upload tests
    test_video_with_upload
    sleep 1
    
    test_document_with_upload
    sleep 1
    
    test_sticker_with_upload
    
    print_header "Media Upload Tests Complete"
    echo -e "${GREEN}WhatsApp media message types tested!${NC}\n"
}

main "$@"
