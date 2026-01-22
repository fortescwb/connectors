#!/bin/bash
set -Euo pipefail

# W1 capture script (v2) - real fixtures with media upload + location

STAGING_URL=""
STAGING_TOKEN=""
PHONE_TO=""
GRAPH_TOKEN=""
PHONE_NUMBER_ID=""
STEPS_CSV=""
STEPS=()
STEPS_SET=0

FIXTURES_DIR="packages/core-meta-whatsapp/fixtures/outbound/real"
TMP_DIR=""
LOG_FILE="W1_CAPTURE_V2_$(date +%Y%m%d_%H%M%S).log"
CAPTURED=0
FAILED=0
LAST_PROVIDER_MESSAGE_ID=""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info(){ echo -e "${BLUE}ℹ${NC} $1" | tee -a "$LOG_FILE"; }
log_success(){ echo -e "${GREEN}✓${NC} $1" | tee -a "$LOG_FILE"; }
log_error(){ echo -e "${RED}✗${NC} $1" | tee -a "$LOG_FILE"; }
log_warning(){ echo -e "${YELLOW}⚠${NC} $1" | tee -a "$LOG_FILE"; }

new_intent_id(){
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen
  else
    cat /proc/sys/kernel/random/uuid
  fi
}

usage(){ cat <<EOF
Usage: $0 --url <staging-url> --token <staging-token> --phone-to <e164> \
          --graph-token <access-token> --phone-number-id <phone-number-id>

Env vars also supported:
  STAGING_URL, STAGING_TOKEN, PHONE_TO, GRAPH_TOKEN, PHONE_NUMBER_ID

Requires: curl, jq, ffmpeg
EOF
}

parse_args(){
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --url) STAGING_URL="$2"; shift 2;;
      --token) STAGING_TOKEN="$2"; shift 2;;
      --phone-to) PHONE_TO="$2"; shift 2;;
      --graph-token) GRAPH_TOKEN="$2"; shift 2;;
      --phone-number-id) PHONE_NUMBER_ID="$2"; shift 2;;
      --steps) STEPS_CSV="$2"; STEPS_SET=1; shift 2;;
      --help) usage; exit 0;;
      *) log_error "Unknown option: $1"; usage; exit 1;;
    esac
  done
}

validate_args(){
  STAGING_URL="${STAGING_URL:-${STAGING_URL:-}}"
  STAGING_TOKEN="${STAGING_TOKEN:-${STAGING_TOKEN:-}}"
  PHONE_TO="${PHONE_TO:-${PHONE_TO:-}}"
  GRAPH_TOKEN="${GRAPH_TOKEN:-${GRAPH_TOKEN:-}}"
  PHONE_NUMBER_ID="${PHONE_NUMBER_ID:-${PHONE_NUMBER_ID:-}}"
  STEPS_CSV="${STEPS_CSV:-}"

  if [[ -z "$STAGING_URL" || -z "$STAGING_TOKEN" || -z "$PHONE_TO" || -z "$GRAPH_TOKEN" || -z "$PHONE_NUMBER_ID" ]]; then
    log_error "Missing required arguments."
    usage
    exit 1
  fi

  STAGING_URL="${STAGING_URL%/}"
  log_info "URL: $STAGING_URL"
  log_info "Token: ${STAGING_TOKEN:0:8}***"
  log_info "Phone To: $PHONE_TO"
  log_info "Graph token: ${GRAPH_TOKEN:0:8}***"
  log_info "Phone number ID: $PHONE_NUMBER_ID"

  if [[ "$STEPS_SET" -eq 1 || -n "$STEPS_CSV" ]]; then
    IFS=',' read -r -a STEPS <<< "$STEPS_CSV"
  else
    STEPS=(text audio image video document sticker contacts location_fixed reaction template mark_read)
  fi
  log_info "Steps: ${STEPS[*]}"
}

check_prereqs(){
  for bin in curl jq ffmpeg; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      log_error "$bin not found"
      exit 1
    fi
  done
  mkdir -p "$FIXTURES_DIR"
  TMP_DIR=$(mktemp -d)
}

cleanup(){
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

health_check(){
  local http_code
  http_code=$(curl -s -w "\n%{http_code}" "$STAGING_URL/health" | tail -n1)
  if [[ "$http_code" == "200" ]]; then
    log_success "Staging UP (200)"
  else
    log_error "Staging health check failed ($http_code)"
    exit 1
  fi
}

sanitize_json(){
  local data="$1"
  echo "$data" | jq \
    --arg phone "$PHONE_TO" \
    'def esc($s): ($s | gsub("([\\\\.*+?^$|()\\[\\]{}])"; "\\\\\\1"));
     walk(if type=="string" then
       .
       | gsub(esc($phone); "+55XXXX****")
       | (if startswith("wamid.") then "wamid.SANITIZED" else . end)
     else . end)'
}

run_step(){
  local name="$1"; shift
  if "$@"; then
    return 0
  else
    log_error "${name} failed (see log/output above)"
    ((FAILED++))
    return 0
  fi
}

upload_media(){
  local file="$1"; local mime="$2"
  local resp
  resp=$(curl -s -X POST "https://graph.facebook.com/v19.0/$PHONE_NUMBER_ID/media" \
    -H "Authorization: Bearer $GRAPH_TOKEN" \
    -F "messaging_product=whatsapp" \
    -F "file=@${file};type=${mime}" \
    -F "type=${mime}")
  echo "$resp" | jq -e '.id' >/dev/null 2>&1 || { log_error "Upload failed: $resp"; exit 1; }
  echo "$resp" | jq -r '.id'
}

make_image(){
  local img="$TMP_DIR/w1-image.jpg"
  ffmpeg -loglevel error -y -f lavfi -i color=c=skyblue:s=640x360 -frames:v 1 "$img"
  echo "$img"
}

make_video(){
  local vid="$TMP_DIR/w1-video.mp4"
  ffmpeg -loglevel error -y \
    -f lavfi -i color=c=orange:s=640x360:d=4 \
    -f lavfi -i sine=frequency=880:duration=4 \
    -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$vid"
  echo "$vid"
}

make_sticker(){
  local webp="$TMP_DIR/w1-sticker.webp"
  ffmpeg -loglevel error -y -f lavfi -i color=c=lightgreen:s=512x512 -frames:v 1 -loop 0 "$webp"
  echo "$webp"
}

make_audio(){
  local aud="$TMP_DIR/w1-audio.ogg"
  ffmpeg -loglevel error -y -f lavfi -i anullsrc=r=16000:cl=mono -t 3 -c:a libopus "$aud"
  echo "$aud"
}

post_intent(){
  local type="$1"; local body="$2"; local outfile="$3"
  local resp
  resp=$(curl -s -X POST "$STAGING_URL/__staging/outbound" \
    -H "Content-Type: application/json" \
    -H "X-Staging-Token: $STAGING_TOKEN" \
    -d "$body")

  local sent="0"
  local provider_id=""

  if ! sent=$(echo "$resp" | jq -r '.sent // .result.summary.sent // 0' 2>/dev/null); then
    log_error "Failed to parse response for $type (raw saved)"
    echo "$resp" > "$outfile"
    ((FAILED++))
    return 1
  fi

  provider_id=$(echo "$resp" | jq -r '
    .result.results[0].providerResponse.providerMessageId //
    .result.results[0].providerResponse.raw.messages[0].id //
    .result.results[0].response.messages[0].id //
    .result.items[0].providerMessageId //
    .result.items[0].response.messages[0].id // empty' 2>/dev/null || true)

  local sanitized
  sanitized=$(sanitize_json "$resp")
  echo "$sanitized" | jq '.' > "$outfile"

  if [[ "$sent" != "0" ]]; then
    log_success "$type captured → $outfile"
    ((CAPTURED++))
  else
    log_warning "$type sent=0 (check fixture)"
    ((FAILED++))
  fi

  if [[ -n "$provider_id" ]]; then
    LAST_PROVIDER_MESSAGE_ID="$provider_id"
  fi
}

capture_text(){
  local intent_id=$(new_intent_id)
  local body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {"type": "text", "text": "W1 Real Fixture: Text message"},
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-text",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)
  post_intent "text" "$body" "$FIXTURES_DIR/text.json"
}

capture_audio(){
  log_info "Capturing audio via mediaId"
  local audio_file=$(make_audio)
  local media_id
  media_id=$(upload_media "$audio_file" "audio/ogg")
  local intent_id=$(new_intent_id)
  local body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {"type": "audio", "mediaId": "$media_id"},
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-audio",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)
  post_intent "audio" "$body" "$FIXTURES_DIR/audio.json"
}

capture_image(){
  log_info "Capturing image via mediaId"
  local img_file=$(make_image)
  local media_id
  media_id=$(upload_media "$img_file" "image/jpeg")
  local intent_id=$(new_intent_id)
  local body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {"type": "image", "mediaId": "$media_id", "caption": "W1 image"},
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-image",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)
  post_intent "image" "$body" "$FIXTURES_DIR/image.json"
}

capture_video(){
  log_info "Capturing video via mediaId"
  local video_file=$(make_video)
  local media_id
  media_id=$(upload_media "$video_file" "video/mp4")
  local intent_id=$(new_intent_id)
  local body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {"type": "video", "mediaId": "$media_id", "caption": "W1 video"},
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-video",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)
  post_intent "video" "$body" "$FIXTURES_DIR/video.json"
}

capture_sticker(){
  log_info "Capturing sticker via mediaId"
  local sticker_file=$(make_sticker)
  local media_id
  media_id=$(upload_media "$sticker_file" "image/webp")
  local intent_id=$(new_intent_id)
  local body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {"type": "sticker", "mediaId": "$media_id"},
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-sticker",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)
  post_intent "sticker" "$body" "$FIXTURES_DIR/sticker.json"
}

capture_document(){
  log_info "Capturing document"
  local intent_id=$(new_intent_id)
  local body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {"type": "document", "mediaUrl": "https://example.com/files/document-sample.pdf", "filename": "Report_W1_Test.pdf", "caption": "Test document"},
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-document",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)
  post_intent "document" "$body" "$FIXTURES_DIR/document.json"
}

capture_contacts(){
  log_info "Capturing contacts"
  local intent_id=$(new_intent_id)
  local body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {"type": "contacts", "contacts": [{"name": {"formatted_name": "John Example", "first_name": "John", "last_name": "Example"}, "phones": [{"phone": "$PHONE_TO"}], "emails": [{"email": "john@example.com"}]}, {"name": {"formatted_name": "Jane Smith", "first_name": "Jane", "last_name": "Smith"}, "phones": [{"phone": "+5541999990000"}], "emails": [{"email": "jane@example.com"}]}]},
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-contacts",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)
  post_intent "contacts" "$body" "$FIXTURES_DIR/contacts.json"
}

capture_location_fixed(){
  log_info "Capturing location fixed"
  local intent_id=$(new_intent_id)
  local body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {"type": "location", "latitude": -25.4278, "longitude": -49.2731, "name": "Fixed Location", "address": "Curitiba"},
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-location-fixed",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)
  post_intent "location_fixed" "$body" "$FIXTURES_DIR/location_fixed.json"
}

capture_reaction(){
  log_info "Capturing reaction"
  if [[ -z "$LAST_PROVIDER_MESSAGE_ID" ]]; then
    log_warning "No providerMessageId available for reaction; using placeholder"
  fi
  local target_id="${LAST_PROVIDER_MESSAGE_ID:-wamid.PLACEHOLDER}"
  local intent_id=$(new_intent_id)
  local body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {"type": "reaction", "messageId": "$target_id", "emoji": "👍"},
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-reaction",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)
  post_intent "reaction" "$body" "$FIXTURES_DIR/reaction.json"
}

capture_mark_read(){
  log_info "Capturing mark_read"
  if [[ -z "$LAST_PROVIDER_MESSAGE_ID" ]]; then
    log_warning "No providerMessageId for mark_read; using placeholder"
  fi
  local target_id="${LAST_PROVIDER_MESSAGE_ID:-wamid.PLACEHOLDER}"
  local intent_id=$(new_intent_id)
  local body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {"type": "mark_read", "messageId": "$target_id"},
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-mark-read",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)
  post_intent "mark_read" "$body" "$FIXTURES_DIR/mark_read.json"
}

capture_template(){
  log_info "Capturing template"
  local intent_id=$(new_intent_id)
  local body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {"type": "template", "templateName": "hello_world", "languageCode": "en_US"},
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-template",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)
  post_intent "template" "$body" "$FIXTURES_DIR/template.json"
}

validate_fixtures(){
  local supported_types=("text" "audio" "image" "video" "document" "sticker" "contacts" "location_fixed" "reaction" "template" "mark_read")
  local validation_passed=true

  # Check for unsupported fixtures
  for f in "$FIXTURES_DIR"/*.json; do
    local basename=$(basename "$f" .json)
    local is_supported=0
    for type in "${supported_types[@]}"; do
      if [[ "$basename" == "$type" ]]; then
        is_supported=1
        break
      fi
    done
    if [[ $is_supported -eq 0 && "$basename" != "README" ]]; then
      log_error "Unsupported fixture found: $basename (must be removed)"
      validation_passed=false
    fi
  done

  # Validate all fixtures have valid JSON
  for f in "$FIXTURES_DIR"/*.json; do
    if [[ -f "$f" ]]; then
      if jq -e '.' "$f" >/dev/null 2>&1; then
        log_success "$(basename "$f") valid"
      else
        log_error "$(basename "$f") invalid JSON"
        validation_passed=false
      fi
    fi
  done

  # Warn if expected fixtures are missing (except mark_read which is informational)
  for type in "${supported_types[@]}"; do
    if [[ "$type" != "mark_read" ]]; then
      if [[ ! -f "$FIXTURES_DIR/${type}.json" ]]; then
        log_warning "${type}.json missing (expected fixture)"
        validation_passed=false
      fi
    fi
  done

  if [[ "$validation_passed" == false ]]; then
    log_error "Fixture validation failed (unsupported files or missing required fixtures)"
    return 1
  fi
}

summary(){
  echo ""; echo "==== SUMMARY ===="
  echo "Captured: $CAPTURED"; echo "Failed: $FAILED"
  echo "Fixtures: $FIXTURES_DIR"; echo "Log: $LOG_FILE"
}

main(){
  log_info "Starting W1 capture v2"
  parse_args "$@"
  validate_args
  check_prereqs
  health_check

  for step in "${STEPS[@]}"; do
    case "$step" in
      text) run_step "text" capture_text ;;
      audio) run_step "audio" capture_audio ;;
      image) run_step "image" capture_image ;;
      video) run_step "video" capture_video ;;
      document) run_step "document" capture_document ;;
      sticker) run_step "sticker" capture_sticker ;;
      contacts) run_step "contacts" capture_contacts ;;
      location_fixed) run_step "location_fixed" capture_location_fixed ;;
      reaction) run_step "reaction" capture_reaction ;;
      template) run_step "template" capture_template ;;
      mark_read) run_step "mark_read" capture_mark_read ;;
      *) log_warning "Unknown step '$step' (skipped)" ;;
    esac
  done

  # Validate fixtures and summarize
  if validate_fixtures; then
    summary
    exit 0
  else
    summary
    exit 1
  fi
}

main "$@"
