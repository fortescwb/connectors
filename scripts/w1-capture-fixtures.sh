#!/bin/bash

#############################################################################
# W1 — Captura Automática de Fixtures Reais do WhatsApp Staging
#############################################################################
# Usage: ./scripts/w1-capture-fixtures.sh --url <staging-url> --token <token> --phone <phone>
#############################################################################

set -euo pipefail

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configurações
STAGING_URL=""
STAGING_TOKEN=""
PHONE_TO=""
FIXTURES_DIR="packages/core-meta-whatsapp/fixtures/outbound/real"
LOG_FILE="W1_CAPTURE_$(date +%Y%m%d_%H%M%S).log"
CAPTURED=0
FAILED=0

#############################################################################
# Funções
#############################################################################

log_info() {
    echo -e "${BLUE}ℹ${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}✗${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1" | tee -a "$LOG_FILE"
}

usage() {
    cat << EOF
${BLUE}W1 — Captura de Fixtures Reais${NC}

Uso:
  $0 --url <staging-url> --token <token> --phone <phone>

Exemplo:
  $0 \\
    --url "https://my-staging-url.run.app" \\
    --token "my-staging-token-abc123" \\
    --phone "+554284027199"

Opções:
  --url       URL do staging (ex: https://my-staging.run.app)
  --token     STAGING_OUTBOUND_TOKEN
  --phone     Telefone para teste (ex: +554284027199)
  --help      Mostra esta mensagem

EOF
    exit 1
}

parse_args() {
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
            --phone)
                PHONE_TO="$2"
                shift 2
                ;;
            --help)
                usage
                ;;
            *)
                log_error "Opção desconhecida: $1"
                usage
                ;;
        esac
    done
}

validate_args() {
    if [[ -z "$STAGING_URL" || -z "$STAGING_TOKEN" || -z "$PHONE_TO" ]]; then
        log_error "Argumentos faltando"
        usage
    fi

    # Remover trailing slash se presente
    STAGING_URL="${STAGING_URL%/}"

    log_info "URL: $STAGING_URL"
    log_info "Token: ${STAGING_TOKEN:0:10}***"
    log_info "Telefone: $PHONE_TO"
}

check_prerequisites() {
    log_info "Verificando pré-requisitos..."

    # Verificar curl
    if ! command -v curl &> /dev/null; then
        log_error "curl não está instalado"
        exit 1
    fi
    log_success "curl disponível"

    # Verificar jq
    if ! command -v jq &> /dev/null; then
        log_error "jq não está instalado"
        exit 1
    fi
    log_success "jq disponível"

    # Criar diretório de fixtures
    mkdir -p "$FIXTURES_DIR"
    log_success "Diretório $FIXTURES_DIR criado/confirmado"
}

health_check() {
    log_info "Verificando saúde do staging..."

    local response
    response=$(curl -s -w "\n%{http_code}" "$STAGING_URL/health" || echo "000")
    local http_code=$(echo "$response" | tail -n1)

    if [[ "$http_code" == "200" ]]; then
        log_success "Staging está UP (HTTP $http_code)"
        return 0
    else
        log_error "Staging respondeu com HTTP $http_code"
        return 1
    fi
}

sanitize_fixture() {
    local fixture_data="$1"
    local fixture_type="$2"

    # Sanitizar phone numbers
    fixture_data=$(echo "$fixture_data" | jq \
        --arg phone_to "$PHONE_TO" \
        'walk(if type == "string" then gsub($phone_to; "+55XXXX****") else . end)')

    # Sanitizar message IDs
    fixture_data=$(echo "$fixture_data" | jq \
        'walk(if type == "string" and startswith("wamid.") then "wamid.SANITIZED_ID_" + (.[6:16] | gsub("[0-9a-zA-Z]"; "X")) else . end)')

    # Sanitizar URLs sensíveis (mas manter exemplos)
    fixture_data=$(echo "$fixture_data" | jq \
        'walk(if type == "string" and (startswith("https://") or startswith("http://")) and contains("cloud") then "https://example.com/files/sanitized" else . end)')

    echo "$fixture_data"
}

capture_text_message() {
    log_info "Capturando TEXT MESSAGE..."

    local intent_id="w1-text-$(date +%s)"
    local request_body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {
      "type": "text",
      "text": "W1 Test: Text message [$(date +%Y%m%d_%H%M%S)]"
    },
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-corr-text",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)

    local response
    response=$(curl -s -X POST "$STAGING_URL/__staging/outbound" \
        -H "Content-Type: application/json" \
        -H "X-Staging-Token: $STAGING_TOKEN" \
        -d "$request_body")

    if echo "$response" | jq -e '.sent > 0' > /dev/null 2>&1; then
        local sanitized=$(sanitize_fixture "$response" "text")
        echo "$sanitized" | jq '.' > "$FIXTURES_DIR/text.json"
        log_success "TEXT MESSAGE capturado → $FIXTURES_DIR/text.json"
        ((CAPTURED++))
        return 0
    else
        log_error "Falha ao capturar TEXT MESSAGE"
        ((FAILED++))
        return 1
    fi
}

capture_audio_message() {
    log_info "Capturando AUDIO MESSAGE..."

    local intent_id="w1-audio-$(date +%s)"
    local request_body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {
      "type": "audio",
      "mediaUrl": "https://example.com/files/audio-sample.opus"
    },
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-corr-audio",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)

    local response
    response=$(curl -s -X POST "$STAGING_URL/__staging/outbound" \
        -H "Content-Type: application/json" \
        -H "X-Staging-Token: $STAGING_TOKEN" \
        -d "$request_body")

    if echo "$response" | jq -e '.sent > 0' > /dev/null 2>&1; then
        local sanitized=$(sanitize_fixture "$response" "audio")
        echo "$sanitized" | jq '.' > "$FIXTURES_DIR/audio.json"
        log_success "AUDIO MESSAGE capturado → $FIXTURES_DIR/audio.json"
        ((CAPTURED++))
        return 0
    else
        log_error "Falha ao capturar AUDIO MESSAGE"
        ((FAILED++))
        return 1
    fi
}

capture_document_message() {
    log_info "Capturando DOCUMENT MESSAGE..."

    local intent_id="w1-doc-$(date +%s)"
    local request_body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {
      "type": "document",
      "mediaUrl": "https://example.com/files/document-sample.pdf",
      "filename": "Report_W1_Test.pdf",
      "caption": "Test document from W1"
    },
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-corr-document",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)

    local response
    response=$(curl -s -X POST "$STAGING_URL/__staging/outbound" \
        -H "Content-Type: application/json" \
        -H "X-Staging-Token: $STAGING_TOKEN" \
        -d "$request_body")

    if echo "$response" | jq -e '.sent > 0' > /dev/null 2>&1; then
        local sanitized=$(sanitize_fixture "$response" "document")
        echo "$sanitized" | jq '.' > "$FIXTURES_DIR/document.json"
        log_success "DOCUMENT MESSAGE capturado → $FIXTURES_DIR/document.json"
        ((CAPTURED++))
        return 0
    else
        log_error "Falha ao capturar DOCUMENT MESSAGE"
        ((FAILED++))
        return 1
    fi
}

capture_contacts_message() {
    log_info "Capturando CONTACTS MESSAGE..."

    local intent_id="w1-contacts-$(date +%s)"
    local request_body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {
      "type": "contacts",
      "contacts": [
        {
          "name": "John Example",
          "phones": ["+55XXXX0001"],
          "emails": ["john@example.com"]
        },
        {
          "name": "Jane Smith",
          "phones": ["+55XXXX0002"],
          "emails": ["jane@example.com"]
        }
      ]
    },
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-corr-contacts",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)

    local response
    response=$(curl -s -X POST "$STAGING_URL/__staging/outbound" \
        -H "Content-Type: application/json" \
        -H "X-Staging-Token: $STAGING_TOKEN" \
        -d "$request_body")

    if echo "$response" | jq -e '.sent > 0' > /dev/null 2>&1; then
        local sanitized=$(sanitize_fixture "$response" "contacts")
        echo "$sanitized" | jq '.' > "$FIXTURES_DIR/contacts.json"
        log_success "CONTACTS MESSAGE capturado → $FIXTURES_DIR/contacts.json"
        ((CAPTURED++))
        return 0
    else
        log_error "Falha ao capturar CONTACTS MESSAGE"
        ((FAILED++))
        return 1
    fi
}

capture_reaction_message() {
    log_info "Capturando REACTION MESSAGE..."

    local intent_id="w1-reaction-$(date +%s)"
    local request_body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {
      "type": "reaction",
      "messageId": "wamid.EXAMPLE_MESSAGE_ID_FOR_REACTION_TEST",
      "emoji": "👍"
    },
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-corr-reaction",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)

    local response
    response=$(curl -s -X POST "$STAGING_URL/__staging/outbound" \
        -H "Content-Type: application/json" \
        -H "X-Staging-Token: $STAGING_TOKEN" \
        -d "$request_body")

    if echo "$response" | jq -e '.sent > 0' > /dev/null 2>&1; then
        local sanitized=$(sanitize_fixture "$response" "reaction")
        echo "$sanitized" | jq '.' > "$FIXTURES_DIR/reaction.json"
        log_success "REACTION MESSAGE capturado → $FIXTURES_DIR/reaction.json"
        ((CAPTURED++))
        return 0
    else
        log_error "Falha ao capturar REACTION MESSAGE"
        ((FAILED++))
        return 1
    fi
}

capture_template_message() {
    log_info "Capturando TEMPLATE MESSAGE..."

    local intent_id="w1-template-$(date +%s)"
    local request_body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {
      "type": "template",
      "name": "hello_world",
      "languageCode": "en_US",
      "components": [
        {
          "type": "body",
          "parameters": [
            {"type": "text", "text": "User Name"}
          ]
        }
      ]
    },
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-corr-template",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)

    local response
    response=$(curl -s -X POST "$STAGING_URL/__staging/outbound" \
        -H "Content-Type: application/json" \
        -H "X-Staging-Token: $STAGING_TOKEN" \
        -d "$request_body")

    if echo "$response" | jq -e '.sent > 0' > /dev/null 2>&1; then
        local sanitized=$(sanitize_fixture "$response" "template")
        echo "$sanitized" | jq '.' > "$FIXTURES_DIR/template.json"
        log_success "TEMPLATE MESSAGE capturado → $FIXTURES_DIR/template.json"
        ((CAPTURED++))
        return 0
    else
        log_error "Falha ao capturar TEMPLATE MESSAGE"
        ((FAILED++))
        return 1
    fi
}

capture_image_message() {
    log_info "Capturando IMAGE MESSAGE..."

    local intent_id="w1-image-$(date +%s)"
    local request_body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {
      "type": "image",
      "mediaUrl": "https://example.com/files/image-sample.jpg",
      "caption": "Test image from W1"
    },
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-corr-image",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)

    local response
    response=$(curl -s -X POST "$STAGING_URL/__staging/outbound" \
        -H "Content-Type: application/json" \
        -H "X-Staging-Token: $STAGING_TOKEN" \
        -d "$request_body")

    if echo "$response" | jq -e '.sent > 0' > /dev/null 2>&1; then
        local sanitized=$(sanitize_fixture "$response" "image")
        echo "$sanitized" | jq '.' > "$FIXTURES_DIR/image.json"
        log_success "IMAGE MESSAGE capturado → $FIXTURES_DIR/image.json"
        ((CAPTURED++))
        return 0
    else
        log_error "Falha ao capturar IMAGE MESSAGE"
        ((FAILED++))
        return 1
    fi
}

capture_mark_read() {
    log_info "Capturando MARK READ..."

    local intent_id="w1-mark-read-$(date +%s)"
    local request_body=$(cat <<EOF
{
  "intents": [{
    "intentId": "$intent_id",
    "tenantId": "staging-test",
    "provider": "whatsapp",
    "to": "$PHONE_TO",
    "payload": {
      "type": "mark_read",
      "messageId": "wamid.EXAMPLE_MESSAGE_ID_FOR_MARK_READ_TEST"
    },
    "dedupeKey": "whatsapp:$intent_id",
    "correlationId": "w1-corr-mark-read",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  }]
}
EOF
)

    local response
    response=$(curl -s -X POST "$STAGING_URL/__staging/outbound" \
        -H "Content-Type: application/json" \
        -H "X-Staging-Token: $STAGING_TOKEN" \
        -d "$request_body")

    if echo "$response" | jq -e '.sent > 0' > /dev/null 2>&1; then
        local sanitized=$(sanitize_fixture "$response" "mark_read")
        echo "$sanitized" | jq '.' > "$FIXTURES_DIR/mark_read.json"
        log_success "MARK READ capturado → $FIXTURES_DIR/mark_read.json"
        ((CAPTURED++))
        return 0
    else
        log_error "Falha ao capturar MARK READ"
        ((FAILED++))
        return 1
    fi
}

validate_fixtures() {
    log_info "Validando fixtures..."

    local valid=0
    local invalid=0

    for fixture in "$FIXTURES_DIR"/*.json; do
        if [[ -f "$fixture" ]]; then
            if jq -e '.' "$fixture" > /dev/null 2>&1; then
                log_success "$(basename "$fixture") é válido"
                ((valid++))
            else
                log_error "$(basename "$fixture") é inválido"
                ((invalid++))
            fi
        fi
    done

    # Verificar PII
    log_info "Verificando PII..."
    if grep -r "$PHONE_TO" "$FIXTURES_DIR" 2>/dev/null; then
        log_warning "Phone numbers encontrados - certifique-se de que estão sanitizados"
    else
        log_success "Nenhum phone raw encontrado"
    fi

    return 0
}

print_summary() {
    echo ""
    echo "=========================================="
    echo "  W1 — CAPTURA DE FIXTURES — RESUMO"
    echo "=========================================="
    echo ""
    echo -e "${GREEN}✓ Capturados: $CAPTURED${NC}"
    echo -e "${RED}✗ Falhados: $FAILED${NC}"
    echo ""
    echo "Fixtures em: $FIXTURES_DIR"
    echo "Log: $LOG_FILE"
    echo ""
    if [[ $CAPTURED -eq 8 && $FAILED -eq 0 ]]; then
        echo -e "${GREEN}✓ W1 COMPLETO — Pronto para W2${NC}"
    else
        echo -e "${YELLOW}⚠ W1 PARCIAL — Revisar falhas${NC}"
    fi
    echo "=========================================="
    echo ""
}

#############################################################################
# Main
#############################################################################

main() {
    log_info "Iniciando W1 — Captura de Fixtures Reais"
    log_info "Log: $LOG_FILE"
    echo ""

    parse_args "$@"
    validate_args
    check_prerequisites

    if ! health_check; then
        log_error "Staging não está acessível. Abortar."
        exit 1
    fi

    log_info "Capturando fixtures..."
    echo ""

    capture_text_message
    capture_audio_message
    capture_image_message
    capture_document_message
    capture_contacts_message
    capture_reaction_message
    capture_template_message
    capture_mark_read

    echo ""
    validate_fixtures

    print_summary
}

main "$@"
