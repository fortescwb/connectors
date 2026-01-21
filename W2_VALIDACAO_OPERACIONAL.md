# W2 — Validação Operacional em Staging

## Status: 🔄 AGUARDANDO W1

**Pré-requisito:** ✅ W1 — Captura de Fixtures Reais **COMPLETO**

---

## 📋 Checklist de Validação

### 1️⃣ Health & Connectivity

- [ ] **1.1** Staging está UP
  ```bash
  curl -s $STAGING_URL/health | jq .
  # Esperado: {"status": "ok", "version": "..."}
  ```

- [ ] **1.2** Webhook endpoint responde
  ```bash
  curl -s "$STAGING_URL/webhook?hub.mode=subscribe&hub.challenge=test&hub.verify_token=test"
  # Esperado: HTTP 401 (token inválido é ok, significa endpoint existe)
  ```

- [ ] **1.3** Staging outbound endpoint existe
  ```bash
  curl -s -X POST "$STAGING_URL/__staging/outbound" \
    -H "X-Staging-Token: invalid" \
    -d '{}' | jq .
  # Esperado: 401 ou error response (não 404)
  ```

- [ ] **1.4** Redis conectado
  ```bash
  # Verificar no log
  cat /tmp/staging-logs | grep -i redis | grep -i "connected\|ok"
  # Esperado: Alguma indicação de sucesso
  ```

### 2️⃣ Autenticação & Segurança

- [ ] **2.1** Token inválido é rejeitado
  ```bash
  curl -X POST "$STAGING_URL/__staging/outbound" \
    -H "X-Staging-Token: invalid-token-123" \
    -H "Content-Type: application/json" \
    -d '{"intents": []}'
  # Esperado: 401 Unauthorized
  ```

- [ ] **2.2** Token válido é aceito
  ```bash
  curl -X POST "$STAGING_URL/__staging/outbound" \
    -H "X-Staging-Token: $STAGING_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"intents": []}'
  # Esperado: 200 OK (com sent: 0, não erro)
  ```

- [ ] **2.3** Webhook signature é validado
  ```bash
  # Tentar webhook POST sem assinatura
  curl -X POST "$STAGING_URL/webhook" \
    -d '{"entry": [{"messaging": []}]}'
  # Esperado: 401 (sem X-Hub-Signature-256 deve falhar)
  ```

### 3️⃣ Message Sending & Delivery

- [ ] **3.1** Mensagem text é entregue
  ```bash
  curl -X POST "$STAGING_URL/__staging/outbound" \
    -H "X-Staging-Token: $STAGING_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "intents": [{
        "intentId": "w2-test-001",
        "tenantId": "test",
        "provider": "whatsapp",
        "to": "+554284027199",
        "payload": {
          "type": "text",
          "text": "W2 Test - Delivery Verification"
        },
        "dedupeKey": "w2:001",
        "correlationId": "w2-corr",
        "createdAt": "2024-01-21T10:00:00.000Z"
      }]
    }'
  # Esperado: {"sent": 1, "deduped": 0, "failed": 0}
  ```

- [ ] **3.2** Resposta contém estructura esperada
  ```bash
  # Response deve ter: sent, deduped, failed, correlationId (opcional)
  # Validar que nenhum campo expos token/secret
  ```

- [ ] **3.3** Todos os 7 tipos são entregues
  ```bash
  # Rodar script de teste multi-tipos
  for type in text audio document contacts reaction template mark_read; do
    echo "Testing $type..."
    # Enviar intent do tipo
  done
  # Esperado: 7/7 sucesso
  ```

### 4️⃣ Dedupe & Idempotência

- [ ] **4.1** Mensagem duplicada é deduplicada
  ```bash
  # Enviar 2x com mesmo dedupeKey
  curl -X POST "$STAGING_URL/__staging/outbound" \
    -H "X-Staging-Token: $STAGING_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "intents": [{
        "intentId": "w2-dedupe-001",
        "dedupeKey": "unique-test-001",
        ...
      }]
    }'
  # 1ª chamada: {sent: 1, deduped: 0}
  
  # 2ª chamada (mesma): {sent: 0, deduped: 1}
  ```

- [ ] **4.2** Timeout + retry não duplica
  ```bash
  # Simular timeout durante requisição
  # (timeout no meio do processamento, não é resposta do server)
  # Reenviar mesma intent
  # Esperado: sent=0, deduped=1 (não enviou 2x)
  ```

- [ ] **4.3** client_msg_id é idêntico entre retries
  ```bash
  # Extrair client_msg_id do primeiro envio
  # Extrair client_msg_id de retry
  # Esperado: são iguais (mesmo intentId)
  ```

### 5️⃣ Logs & Observability

- [ ] **5.1** Logs não contêm phone numbers
  ```bash
  curl $STAGING_URL/logs | grep "+554284027199"
  # Esperado: nada encontrado (ou apenas sanitizado)
  ```

- [ ] **5.2** Logs não contêm tokens
  ```bash
  curl $STAGING_URL/logs | grep -i "token\|secret\|key"
  # Esperado: nenhuma chave sensível
  ```

- [ ] **5.3** Logs não contêm payloads completos
  ```bash
  curl $STAGING_URL/logs | grep "\"text\":\|\"media"
  # Esperado: nenhum payload exposto
  ```

- [ ] **5.4** Logs contêm informações úteis
  ```bash
  curl $STAGING_URL/logs | head -50
  # Esperado: timestamp, intentId, type, status, provider
  ```

- [ ] **5.5** Métricas de dedupe estão sendo registradas
  ```bash
  curl $STAGING_URL/metrics | grep -i dedupe
  # Esperado: dedupe_hit_count, dedupe_miss_count, etc.
  ```

### 6️⃣ Error Handling & Resilience

- [ ] **6.1** Payload inválido retorna erro
  ```bash
  curl -X POST "$STAGING_URL/__staging/outbound" \
    -H "X-Staging-Token: $STAGING_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"intents": [{"invalid": "schema"}]}'
  # Esperado: 400 Bad Request (não 500)
  ```

- [ ] **6.2** Phone inválido é tratado
  ```bash
  curl -X POST "$STAGING_URL/__staging/outbound" \
    -H "X-Staging-Token: $STAGING_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "intents": [{
        ...,
        "to": "invalid-phone"
      }]
    }'
  # Esperado: failed: 1 (não 500)
  ```

- [ ] **6.3** Missing fields retornam erro
  ```bash
  # Testar sem intentId, sem provider, sem payload
  # Esperado: 400 Bad Request para cada um
  ```

- [ ] **6.4** Retry logic funciona
  ```bash
  # Se API retorna 5xx, verificar que há retries
  # Esperado: evento eventualmente sucesso (ou Max Retries error)
  ```

### 7️⃣ Latency & Performance

- [ ] **7.1** Response time é aceitável (< 5s)
  ```bash
  time curl -X POST "$STAGING_URL/__staging/outbound" \
    -H "X-Staging-Token: $STAGING_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"intents": [...]}'
  # Esperado: real ~1-2s
  ```

- [ ] **7.2** Batch de múltiplas intents é processado
  ```bash
  # Enviar {"intents": [intent1, intent2, ..., intent10]}
  # Esperado: sent: 10 (ou sent: N, failed: M, total = 10)
  ```

- [ ] **7.3** Latência não aumenta com dedupe store
  ```bash
  # Enviar mesma intent 100x
  # Medir tempo da 1ª, 50ª, 100ª
  # Esperado: tempo é consistente (Redis lookup é rápido)
  ```

---

## 📝 Procedimento de Execução

### 1. Setup
```bash
cd /home/fortes/Repositórios/connectors

# Carregar credenciais
export STAGING_URL="https://your-staging-url.run.app"
export STAGING_TOKEN="your-staging-token"
export PHONE_TO="+554284027199"
```

### 2. Executar Testes

**Manual (entendimento):**
```bash
# Testar cada item da checklist
# Copiar/colar commands acima
```

**Automático (recomendado):**
```bash
# Criar script w2-validate.sh que executa todos os testes
# Salvar saída em w2-validation-results.txt
```

### 3. Registrar Evidências
```bash
# Criar arquivo de evidências
mkdir -p w2-evidence
curl -s $STAGING_URL/health > w2-evidence/health.json
curl -s $STAGING_URL/metrics > w2-evidence/metrics.json
# ... etc para cada teste
```

---

## ✅ Critérios de Sucesso (W2 PASS)

Para marcar W2 como **COMPLETO**, todos estes devem ser ✅:

1. ✅ Health check OK
2. ✅ Autenticação funcionando (válido aceito, inválido rejeitado)
3. ✅ Todos 7 tipos de mensagem entregues
4. ✅ Dedupe funcionando (no reenvio, no timeout+retry)
5. ✅ Logs sem PII/tokens
6. ✅ Erro handling correto (4xx para bad payload, 5xx retried)
7. ✅ Latência aceitável
8. ✅ Observabilidade funcional

---

## 🔴 Critérios de Falha (W2 FAIL)

Se **qualquer um** destes ocorrer, marcar como **FALHA**:

1. ❌ Endpoint respondendo com 5xx não-remediável
2. ❌ Dedupe não funcionando (duplicatas sendo enviadas)
3. ❌ PII/tokens sendo expostos em logs
4. ❌ Latência > 10s
5. ❌ Telefone não entregando (webhook não chegando)
6. ❌ Error handling retornando 500 para input inválido

---

## 📊 Saída Esperada

```markdown
# W2 — Validação Operacional — Relatório Final

Data: 2024-01-21  
Ambiente: Staging (Cloud Run + Upstash Redis)

## Resultado: ✅ PASS

### Testes Executados
- [x] Health Check: OK
- [x] Autenticação: OK (7/7)
- [x] Message Delivery: OK (7 tipos, 7/7)
- [x] Dedupe: OK (100 retries, 0 duplicatas)
- [x] Logs: OK (0 PII encontrado)
- [x] Error Handling: OK (4/4 casos tratados)
- [x] Latência: OK (avg 1.2s)
- [x] Observability: OK (métricas normalizadas)

### Evidências
- health.json
- metrics.json
- message-delivery.log
- dedupe-test.log
- logs-audit.txt

### Próxima Etapa
→ W3 — Atualizar Status 🟡→🟢 REAL
```

---

## 🚀 Próximas Etapas Após W2

- [ ] **W3:** Atualizar README.md (🟡 ACTIVE → 🟢 REAL)
- [ ] **W4:** Go/No-Go final (análise de critérios)
- [ ] **W5:** Production Readiness (checklist, sem deploy)

**W2 Status:** 🟡 PRONTO PARA EXECUÇÃO (depois de W1)
