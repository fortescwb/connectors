# 📱 WhatsApp Connector - Deploy Staging

## Pré-requisitos

- **GCP Project** com Cloud Run e Artifact Registry habilitados
- **Upstash Redis** (free tier: 500K commands/mês, 256MB, 1 DB) - https://upstash.com
- **Meta App** (WhatsApp Business Platform)

---

## 1️⃣ Criar Upstash Redis

```bash
# 1. Acesse https://upstash.com e crie conta (grátis)
# 2. Create Database → Redis → Global region
# 3. Copie connection string (TLS): rediss://default:PWD@endpoint.upstash.io:6379
```

---

## 2️⃣ Criar Secrets no GCP

```bash
# Redis (OBRIGATÓRIO em staging/production - app falha sem ele)
echo -n "rediss://default:PWD@endpoint.upstash.io:6379" | \
  gcloud secrets create redis-url-staging --data-file=-

# Webhook verification token
echo -n "your-verify-token" | \
  gcloud secrets create whatsapp-verify-token-staging --data-file=-

# Webhook signature secret (HMAC)
echo -n "your-webhook-secret" | \
  gcloud secrets create whatsapp-webhook-secret-staging --data-file=-

# Meta API credentials (outbound)
echo -n "EAAxxxx..." | \
  gcloud secrets create whatsapp-access-token-staging --data-file=-
  
echo -n "123456789" | \
  gcloud secrets create whatsapp-phone-number-id-staging --data-file=-
```

---

## 3️⃣ Deploy Manual (Cloud Run)

```bash
# Build + Push imagem
cd apps/whatsapp
gcloud builds submit --tag us-central1-docker.pkg.dev/PROJECT_ID/connectors/whatsapp:staging ../../

# Deploy
gcloud run deploy whatsapp-connector-staging \
  --image=us-central1-docker.pkg.dev/PROJECT_ID/connectors/whatsapp:staging \
  --region=us-central1 \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=10 \
  --set-env-vars="NODE_ENV=staging" \
  --set-secrets="REDIS_URL=redis-url-staging:latest,WHATSAPP_VERIFY_TOKEN=whatsapp-verify-token-staging:latest,WHATSAPP_WEBHOOK_SECRET=whatsapp-webhook-secret-staging:latest,WHATSAPP_ACCESS_TOKEN=whatsapp-access-token-staging:latest,WHATSAPP_PHONE_NUMBER_ID=whatsapp-phone-number-id-staging:latest"

# Pegar URL do serviço
gcloud run services describe whatsapp-connector-staging \
  --region=us-central1 \
  --format='value(status.url)'
```

---

## 4️⃣ Smoke Tests

```bash
# Substitua SERVICE_URL pela URL do Cloud Run
SERVICE_URL="https://whatsapp-connector-staging-xxx.a.run.app"

# Health check
curl -i $SERVICE_URL/health
# Esperado: HTTP 200 {"status":"ok","connector":"whatsapp"}

# Webhook verification (GET)
curl -i "$SERVICE_URL/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test123"
# Esperado: HTTP 200 test123
```

---

## 5️⃣ Testar Outbound (Staging Only)

O endpoint `POST /__staging/outbound` permite testar envio de mensagens WhatsApp com dedupe Redis real.

**⚠️ Pré-requisitos:**
- `NODE_ENV=staging` (endpoint não disponível em production)
- `STAGING_OUTBOUND_TOKEN` configurado (secret GCP)
- `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` configurados

```bash
# Criar secret do token de staging
echo -n "staging-secret-token-xyz" | \
  gcloud secrets create staging-outbound-token-staging --data-file=-

# Adicionar secret no deploy
gcloud run services update whatsapp-connector-staging \
  --region=us-central1 \
  --update-secrets="STAGING_OUTBOUND_TOKEN=staging-outbound-token-staging:latest"

# Testar envio de mensagem
curl -i -X POST $SERVICE_URL/__staging/outbound \
  -H "Content-Type: application/json" \
  -H "X-Staging-Token: staging-secret-token-xyz" \
  -d '{
    "intents": [
      {
        "to": "5511999999999",
        "type": "text",
        "text": { "body": "Test message from staging" },
        "idempotencyKey": "test-msg-001"
      }
    ]
  }'

# Esperado: HTTP 200 com resultado do processamento
# {
#   "ok": true,
#   "result": {
#     "summary": { "total": 1, "sent": 1, "deduped": 0, "failed": 0 }
#   }
# }

# Testar idempotência (mesmo idempotencyKey)
curl -i -X POST $SERVICE_URL/__staging/outbound \
  -H "Content-Type: application/json" \
  -H "X-Staging-Token: staging-secret-token-xyz" \
  -d '{
    "intents": [
      {
        "to": "5511999999999",
        "type": "text",
        "text": { "body": "Test message from staging" },
        "idempotencyKey": "test-msg-001"
      }
    ]
  }'

# Esperado: HTTP 200 com dedupe
# {
#   "ok": true,
#   "result": {
#     "summary": { "total": 1, "sent": 0, "deduped": 1, "failed": 0 }
#   }
# }
```

**Validações importantes:**
- ✅ Primeira chamada envia mensagem (sent=1, deduped=0)
- ✅ Segunda chamada com mesmo `idempotencyKey` deduplica (sent=0, deduped=1)
- ✅ Logs mostram `"Redis validated at boot (PING ok)"`
- ✅ `failMode: 'closed'` → se Redis falhar, outbound bloqueia (não gera duplicatas)

---

## 6️⃣ Configurar Meta Webhook

1. Acesse Meta App Dashboard → WhatsApp → Configuration
2. **Webhook URL**: `https://SERVICE_URL/webhook`
3. **Verify Token**: Mesmo valor de `WHATSAPP_VERIFY_TOKEN`
4. **Subscribe to fields**: `messages`, `message_status`

---

## ⚙️ Environment Variables

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `NODE_ENV` | Sim | `staging` ou `production` (fail-closed: exige Redis + PING no boot) |
| `REDIS_URL` | **Sim (staging/prod)** | Connection string Upstash (TLS: `rediss://...`). App falha no boot sem ele ou se PING falhar (timeout 3s). |
| `WHATSAPP_VERIFY_TOKEN` | Sim | Token de verificação do webhook Meta |
| `WHATSAPP_WEBHOOK_SECRET` | Recomendado | Secret para validação de assinatura HMAC (X-Hub-Signature-256) |
| `WHATSAPP_ACCESS_TOKEN` | Não (sim para outbound) | Token de acesso Meta (outbound messages) |
| `WHATSAPP_PHONE_NUMBER_ID` | Não (sim para outbound) | Phone number ID do WhatsApp Business |
| `STAGING_OUTBOUND_TOKEN` | Não (sim para `/__staging/outbound`) | Token para proteger endpoint de staging (não disponível em production) |
| `PORT` | Não | Porta HTTP (default: 3000, Cloud Run usa 8080) |

**⚠️ CRITICAL (Fail-Closed Guarantees):**
- **Staging/Production (`NODE_ENV=staging|production`)**: 
  - `REDIS_URL` é **OBRIGATÓRIO** → app lança `Error` no boot se ausente
  - Redis connectivity **validada no boot** → app lança `Error` se `redis.ping()` falhar (timeout: 3s)
  - `failMode: 'closed'` → se Redis falhar durante runtime, processamento **bloqueia** (não gera duplicatas)
- **Development**: 
  - InMemory permitido apenas para **inbound** (webhooks Meta)
  - **Outbound** (`/__staging/outbound`) exige Redis mesmo em dev (evita testes falsamente verdes)

---

## 🐛 Troubleshooting

### App falha no boot: "REDIS_URL is required"
- Verify secret `redis-url-staging` existe e está montado no Cloud Run
- `NODE_ENV` está em `staging` ou `production` (fail-closed)

### App falha no boot: "Redis connection failed" ou "Redis ping timeout"
- Verificar connection string Upstash (TLS: `rediss://`, não `redis://`)
- Testar localmente: `redis-cli -u "rediss://..." PING`
- Verificar free tier Upstash não excedido (500K commands/mês)
- Timeout padrão: 3 segundos (ajustar `timeoutMs` em `createDedupeStore` se necessário)

### Eventos duplicados (inbound)
- Redis deduplication ativo? Ver logs: `"Redis validated at boot (PING ok)"`
- Verificar `failMode: 'closed'` em staging/prod (logs devem mostrar)
- TTL dedupe: 24h (definido em `RedisDedupeStore`)

### Outbound duplicado (staging endpoint)
- Mesmo problema: verificar Redis ativo e `failMode: 'closed'`
- Testar idempotência: enviar mesma mensagem 2x com mesmo `idempotencyKey`
- Segunda chamada deve retornar `deduped: 1, sent: 0`

### Endpoint `/__staging/outbound` retorna 401
- Verificar `X-Staging-Token` header corresponde ao secret `STAGING_OUTBOUND_TOKEN`
- Endpoint **não disponível** em `NODE_ENV=production` (retorna 404)

### Webhook verification falha
- `WHATSAPP_VERIFY_TOKEN` no Meta === secret GCP
- Logs: verificar `hub.verify_token` recebido vs configurado

---

## 📚 Rollback

```bash
# Listar revisions
gcloud run revisions list --service=whatsapp-connector-staging --region=us-central1

# Rollback para revision anterior
gcloud run services update-traffic whatsapp-connector-staging \
  --to-revisions=whatsapp-connector-staging-00001-xxx=100 \
  --region=us-central1
```

---

## 📄 Additional Resources

- [Upstash Redis](https://upstash.com) - Free tier Redis (500K commands/mês)
- [Google Cloud Run](https://cloud.google.com/run/docs)
- [Meta WhatsApp API](https://developers.facebook.com/docs/whatsapp)
- [Cloud Build CI/CD](cloudbuild.yaml) - Automated deployment pipeline

### Meta Integration

- [ ] Webhook URL configured in Meta App Dashboard
- [ ] Webhook verification passed in Meta UI
- [ ] Test message sent from WhatsApp triggers webhook
- [ ] Event appears in Cloud Run logs
- [ ] Event is deduplicated correctly (send same event twice)

### Security

- [ ] Service uses HTTPS (Cloud Run default)
- [ ] No PII or raw payload in logs
- [ ] Signature verification enabled (`WHATSAPP_WEBHOOK_SECRET` set)
- [ ] Secrets not visible in env vars (using Secret Manager)
- [ ] Container runs as non-root user (nodejs:1001)

### Performance

- [ ] p95 latency < 500ms (for webhook POST)
- [ ] Cold start < 3s
- [ ] No 429 rate limit errors from Redis
- [ ] Deduplication hit rate > 0% (if sending duplicates)

---

## 📚 Additional Resources

- [Meta WhatsApp Business API Docs](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Google Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Upstash Redis (Free Tier)](https://upstash.com)
- [Monorepo Architecture](../../docs/architecture.md)
- [Acceptance Criteria](../../CRITERIOS_FINAIS_ACEITE_REPOSITORIO_CONNECTORS.md)

---

## 🆘 Support

For issues:
1. Check Cloud Run logs: `gcloud logging read ...`
2. Verify secrets and env vars
3. Test locally with Docker first
4. Review [Troubleshooting](#troubleshooting) section

**Critical Issues:**
- If duplicates occur: Check Redis connectivity immediately
- If no events received: Verify Meta webhook configuration
- If 403 errors: Check signature secret matches Meta dashboard
