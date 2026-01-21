# W1 — Captura de Fixtures Reais em Staging

## Status: 🚀 PRONTO PARA EXECUÇÃO

### ✅ Pré-requisitos

- [ ] Staging Cloud Run está UP (`curl https://{staging-url}/health`)
- [ ] `STAGING_OUTBOUND_TOKEN` está definido
- [ ] `WHATSAPP_ACCESS_TOKEN` está em Secret Manager staging
- [ ] `WHATSAPP_PHONE_NUMBER_ID` está em Secret Manager staging
- [ ] Webhook da Meta está conectado e verificado
- [ ] Telefone de origem: `+554284027199` está cadastrado na WABA

### 🚀 Passo 1: Executar Captura

#### Opção A: Automática (Recomendado)

```bash
cd /home/fortes/Repositórios/connectors

# 1. Definir credenciais
export STAGING_URL="https://{seu-staging-url}.run.app"
export STAGING_TOKEN="{seu-staging-token}"
export PHONE_TO="+554284027199"

# 2. Executar script
chmod +x scripts/capture-whatsapp-fixtures.sh
./scripts/capture-whatsapp-fixtures.sh \
  --url "$STAGING_URL" \
  --token "$STAGING_TOKEN" \
  --phone-to "$PHONE_TO"

# Esperado: ✓ Captured 7 fixtures
```

#### Opção B: Manual (Debug)

Se o script falhar, executar manualmente:

```bash
# 1. Health check
curl "$STAGING_URL/health"

# 2. Webhook verify (test)
curl "$STAGING_URL/webhook?hub.mode=subscribe&hub.challenge=test&hub.verify_token=$VERIFY_TOKEN"

# 3. Test message (simple)
curl -X POST "$STAGING_URL/__staging/outbound" \
  -H "Content-Type: application/json" \
  -H "X-Staging-Token: $STAGING_TOKEN" \
  -d '{
    "intents": [{
      "intentId": "test-001",
      "tenantId": "test",
      "provider": "whatsapp",
      "to": "+554284027199",
      "payload": {"type": "text", "text": "Test"},
      "dedupeKey": "test:001",
      "correlationId": "test-corr",
      "createdAt": "2024-01-21T10:00:00.000Z"
    }]
  }'
```

### ✅ Passo 2: Validar Fixtures

```bash
cd packages/core-meta-whatsapp

# 1. Listar fixtures capturados
ls -lh fixtures/outbound/real/
# Expected: 7 arquivos .json

# 2. Validar JSON
for f in fixtures/outbound/real/*.json; do
  echo "Checking $f..."
  jq '.' "$f" > /dev/null && echo "✓ Valid" || echo "✗ Invalid"
done

# 3. Verificar PII/Sanitização
grep -r "554284027199" fixtures/outbound/real/ 2>/dev/null && echo "⚠️ Phone encontrado - sanitizar!" || echo "✓ Sem phone raw"
grep -r "wamid\." fixtures/outbound/real/ 2>/dev/null && echo "ℹ️ Message IDs presentes (esperado)" || echo "⚠️ Message IDs faltando"
```

### ✅ Passo 3: Rodar Testes

```bash
cd /home/fortes/Repositórios/connectors

# 1. Unit tests (deve passar com fixtures reais)
cd packages/core-meta-whatsapp && pnpm test
# Expected: 34 tests passing

# 2. Integration tests
cd ../core-runtime && pnpm test -- outbound-exactly-once
# Expected: 12 tests passing

# 3. Back to root
cd ../..
```

### ✅ Passo 4: Registrar Validação

Criar `W1_VALIDATION_LOG.md`:

```markdown
## W1 — Captura de Fixtures Reais — Log de Validação

Data: 2024-01-21  
Executado por: {seu-nome}

### ✅ Captura
- [x] 7 fixtures capturados (text, audio, document, contacts, reaction, template, mark_read)
- [x] Salvos em `packages/core-meta-whatsapp/fixtures/outbound/real/`
- [x] Todos os arquivos .json válidos
- [x] Nenhum phone number raw
- [x] Nenhum token exposto

### ✅ Testes
- [x] Unit tests: 34/34 passing
- [x] Integration tests: 12/12 passing

### ✅ Observabilidade
- [x] Logs sem PII
- [x] Dedupe funcionando
- [x] Mensagens entregues com sucesso

### Status: ✅ COMPLETO
Pronto para W2
```

---

## 📋 Checklist de Sanitização

Antes de commitar, validar:

### Não deve conter:

- [ ] Phone numbers completos (ex: `+554284027199`)
- [ ] Tokens de acesso
- [ ] App secrets
- [ ] Message IDs reais (ex: `wamid.HBgL...`)
- [ ] Media URLs sensíveis

### Deve conter:

- [ ] Message IDs sanitizados (ex: `wamid.SANITIZED.ID`)
- [ ] Phone mascarado (ex: `+554284***4567` ou genérico)
- [ ] Example URLs (ex: `https://example.com/files/`)
- [ ] Example emails/nomes (ex: `john@example.com`, `John Doe`)

---

## 🆘 Troubleshooting

### "Invalid staging token"
```bash
# Verificar token
echo $STAGING_TOKEN
# Confirmar que está correto no Secret Manager
```

### "Phone number not registered"
```bash
# Verificar configuração na Meta
# WABA ID deve ter o número +554284027199 configurado
```

### "401 Unauthorized"
```bash
# Verificar WHATSAPP_ACCESS_TOKEN
# Pode ter expirado; regenerar em Secret Manager
```

### "Fixture JSON inválido"
```bash
# Validar comando jq
jq '.' fixtures/outbound/real/text.json
```

---

## ✅ Próxima Etapa

Após W1 completo:
1. Commitar fixtures em `fixtures/outbound/real/`
2. Proceeder para **W2 — Validação Operacional em Staging**
3. Registrar todas as evidências

---

**W1 Status:** 🟡 PRONTO
**Próximo:** W2 Validação Operacional
