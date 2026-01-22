#!/bin/bash

# Test script para STICKER e REACTION apenas
# Foca exclusivamente nos dois tipos que não estavam funcionando

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Configuração
# ─────────────────────────────────────────────────────────────────────────────

STAGING_URL="${STAGING_URL:-https://whatsapp-connector-staging-otr7m7leza-uc.a.run.app}"
STAGING_TOKEN="${STAGING_TOKEN:-dev-test-token-12345}"
PHONE_NUMBER="${PHONE_NUMBER:-+5541988991078}"

# ─────────────────────────────────────────────────────────────────────────────
# Funções Helper
# ─────────────────────────────────────────────────────────────────────────────

print_header() {
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "$1"
    echo "════════════════════════════════════════════════════════════"
    echo ""
}

print_result() {
    local test_name="$1"
    local status="$2"
    local response="$3"
    
    if [ "$status" = "success" ]; then
        echo "✓ $test_name"
    else
        echo "✗ $test_name"
    fi
    echo "  Response: $response"
    echo ""
}

build_intent() {
    local msg_type="$1"
    local payload="$2"
    
    cat <<EOF
{
  "intentId": "$(uuidgen)",
  "tenantId": "test-tenant",
  "provider": "whatsapp",
  "to": "$PHONE_NUMBER",
  "payload": $payload
}
EOF
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 1: STICKER MESSAGE
# ─────────────────────────────────────────────────────────────────────────────

test_sticker() {
    print_header "Test 1: STICKER MESSAGE (WebP format)"
    
    # Using mediaUrl - will be auto-uploaded by connector
    # Note: Stickers must be WebP format for WhatsApp
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
        # Extract key details
        local status=$(echo "$response" | jq -r '.result.results[0].status // "unknown"')
        local latency=$(echo "$response" | jq -r '.result.results[0].latencyMs // "N/A"')
        local provider_msg_id=$(echo "$response" | jq -r '.result.results[0].providerResponse.providerMessageId // "N/A"')
        
        echo "✓ Sticker Message ENVIADO COM SUCESSO"
        echo "  Status: $status"
        echo "  Latency: ${latency}ms"
        echo "  Provider Message ID: $provider_msg_id"
        echo ""
        echo "  VERIFIQUE SEU WHATSAPP: Você deve receber um STICKER (imagem WebP)"
        echo ""
        return 0
    else
        echo "✗ Sticker Message FALHOU"
        echo "  Response: $response"
        echo ""
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 2: REACTION MESSAGE
# ─────────────────────────────────────────────────────────────────────────────

test_reaction() {
    print_header "Test 2: REACTION MESSAGE (Emoji)"
    
    echo "IMPORTANTE: Para testar REACTION, precisamos de um messageId válido."
    echo "Por favor, envie uma mensagem para o número de teste primeiro,"
    echo "e então execute este teste com o messageId."
    echo ""
    
    # Ask user for messageId
    echo -n "Cole o messageId (wamid) da mensagem que deseja reagir (ou Enter para pular): "
    read MESSAGE_ID
    
    if [ -z "$MESSAGE_ID" ]; then
        echo "⊘ Teste de REACTION pulado (sem messageId fornecido)"
        echo ""
        return 0
    fi
    
    local payload=$(build_intent "reaction" "{
      \"type\": \"reaction\",
      \"messageId\": \"$MESSAGE_ID\",
      \"emoji\": \"👍\"
    }")
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        # Extract key details
        local status=$(echo "$response" | jq -r '.result.results[0].status // "unknown"')
        local latency=$(echo "$response" | jq -r '.result.results[0].latencyMs // "N/A"')
        local provider_msg_id=$(echo "$response" | jq -r '.result.results[0].providerResponse.providerMessageId // "N/A"')
        
        echo "✓ Reaction Message ENVIADO COM SUCESSO"
        echo "  Status: $status"
        echo "  Latency: ${latency}ms"
        echo "  Provider Message ID: $provider_msg_id"
        echo ""
        echo "  VERIFIQUE SEU WHATSAPP: A mensagem especificada deve ter um 👍"
        echo ""
        return 0
    else
        echo "✗ Reaction Message FALHOU"
        echo "  Response: $response"
        echo ""
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 3: SEND TEXT FIRST (para obter messageId)
# ─────────────────────────────────────────────────────────────────────────────

send_text_for_reaction() {
    print_header "Test 0: Enviando TEXTO para obter messageId"
    
    local payload=$(build_intent "text" '{
      "type": "text",
      "text": "Esta mensagem será usada para testar REACTION. Aguarde a reação 👍"
    }')
    
    local response=$(curl -s -X POST \
      "$STAGING_URL/__staging/outbound" \
      -H "Content-Type: application/json" \
      -H "X-Staging-Token: $STAGING_TOKEN" \
      -d "{\"intents\": [$payload]}")
    
    local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
    
    if [ "$success" = "true" ]; then
        local message_id=$(echo "$response" | jq -r '.result.results[0].providerResponse.providerMessageId // "N/A"')
        
        echo "✓ Mensagem de texto enviada!"
        echo "  Message ID: $message_id"
        echo ""
        echo "  Use este ID para testar REACTION:"
        echo "  MESSAGE_ID=\"$message_id\""
        echo ""
        
        # Return the message ID
        echo "$message_id"
        return 0
    else
        echo "✗ Falha ao enviar mensagem de texto"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Main Execution
# ─────────────────────────────────────────────────────────────────────────────

main() {
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║  TESTE FOCADO: STICKER e REACTION                          ║"
    echo "║  WhatsApp Business Cloud API - Janeiro 2026                ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Connector URL: $STAGING_URL"
    echo "Phone Number: $PHONE_NUMBER"
    echo ""
    
    # Test 1: STICKER
    if test_sticker; then
        STICKER_OK=true
    else
        STICKER_OK=false
    fi
    
    # Send text message to get messageId
    local text_output=$(send_text_for_reaction)
    MESSAGE_ID=$(echo "$text_output" | tail -1)
    
    # Wait a bit for message to be delivered
    echo "Aguardando 3 segundos para garantir que a mensagem foi entregue..."
    sleep 3
    
    # Test 2: REACTION (usando o messageId obtido)
    if [ ! -z "$MESSAGE_ID" ] && [ "$MESSAGE_ID" != "N/A" ]; then
        print_header "Test 2: REACTION MESSAGE (usando messageId obtido)"
        
        # Escape the message ID properly (remove any newlines/spaces)
        MESSAGE_ID=$(echo "$MESSAGE_ID" | tr -d '\n\r ' | xargs)
        
        local payload=$(build_intent "reaction" "{
          \"type\": \"reaction\",
          \"messageId\": \"$MESSAGE_ID\",
          \"emoji\": \"👍\"
        }")
        
        local response=$(curl -s -X POST \
          "$STAGING_URL/__staging/outbound" \
          -H "Content-Type: application/json" \
          -H "X-Staging-Token: $STAGING_TOKEN" \
          -d "{\"intents\": [$payload]}")
        
        local success=$(echo "$response" | grep -q '"ok":true' && echo "true" || echo "false")
        
        if [ "$success" = "true" ]; then
            local status=$(echo "$response" | jq -r '.result.results[0].status // "unknown"')
            local latency=$(echo "$response" | jq -r '.result.results[0].latencyMs // "N/A"')
            
            echo "✓ Reaction Message ENVIADO COM SUCESSO"
            echo "  Status: $status"
            echo "  Latency: ${latency}ms"
            echo ""
            echo "  VERIFIQUE SEU WHATSAPP: A mensagem de texto deve ter um 👍"
            echo ""
            REACTION_OK=true
        else
            echo "✗ Reaction Message FALHOU"
            echo "  Response: $response"
            echo ""
            REACTION_OK=false
        fi
    else
        echo "⊘ Teste de REACTION pulado (não foi possível obter messageId)"
        REACTION_OK=false
    fi
    
    # Summary
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║  RESULTADO FINAL                                           ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
    
    if [ "$STICKER_OK" = "true" ]; then
        echo "  ✓ STICKER: FUNCIONANDO"
    else
        echo "  ✗ STICKER: FALHOU"
    fi
    
    if [ "$REACTION_OK" = "true" ]; then
        echo "  ✓ REACTION: FUNCIONANDO"
    else
        echo "  ✗ REACTION: FALHOU"
    fi
    
    echo ""
    echo "IMPORTANTE: Verifique seu WhatsApp para confirmar o recebimento!"
    echo ""
    
    if [ "$STICKER_OK" = "true" ] && [ "$REACTION_OK" = "true" ]; then
        echo "🎉 SUCESSO TOTAL! Ambos os tipos estão funcionando!"
        exit 0
    else
        echo "⚠️  Alguns testes falharam. Verifique os logs acima."
        exit 1
    fi
}

main "$@"
