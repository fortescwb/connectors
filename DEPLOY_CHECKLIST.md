# ✅ Checklist Final - Deploy WhatsApp Connector (Cloud Run Staging)

> **Data:** `__________`  
> **Executado por:** `__________`  
> **Ambiente:** Staging  
> **Commit/Tag:** `__________`

---

## 📋 PRÉ-REQUISITOS

### Infraestrutura GCP

- [ ] Projeto GCP criado e selecionado
- [ ] Billing ativado
- [ ] APIs habilitadas:
  - [ ] Cloud Run API
  - [ ] Artifact Registry API (ou Container Registry)
  - [ ] Secret Manager API
  - [ ] Cloud Build API (se usando cloudbuild.yaml)
  - [ ] Cloud Logging API
- [ ] Service Account com permissões:
  - [ ] Cloud Run Admin
  - [ ] Secret Manager Secret Accessor
  - [ ] Artifact Registry Writer (se aplicável)

### Redis (Upstash)

- [ ] Conta Upstash criada (https://upstash.com - free tier)
- [ ] Database Redis criada (Global region recomendada)
- [ ] Connection string copiada (formato: `rediss://default:pwd@endpoint.upstash.io:6379`)
- [ ] TLS/SSL habilitado (padrão Upstash: `rediss://`)
- [ ] Free tier limits conhecidos: 500K commands/month, 256MB storage, 1 database

### Secrets Manager

Criar os seguintes secrets (nome sugerido):

- [ ] `whatsapp-verify-token-staging`: Token de verificação do webhook Meta
- [ ] `whatsapp-webhook-secret-staging`: Secret para assinatura HMAC (X-Hub-Signature-256)
- [ ] `redis-url-staging`: URL completa do Redis (`redis://IP:6379`)
- [ ] `whatsapp-access-token-staging`: Token de acesso Meta Graph API (para outbound)
- [ ] `whatsapp-phone-number-id-staging`: ID do número de telefone do WhatsApp Business

**Comandos para criar secrets:**
```bash
echo -n "your-verify-token" | gcloud secrets create whatsapp-verify-token-staging --data-file=-
echo -n "your-webhook-secret" | gcloud secrets create whatsapp-webhook-secret-staging --data-file=-
echo -n "rediss://default:PASSWORD@endpoint.upstash.io:6379" | gcloud secrets create redis-url-staging --data-file=-
echo -n "EAAxxxx..." | gcloud secrets create whatsapp-access-token-staging --data-file=-
echo -n "123456789" | gcloud secrets create whatsapp-phone-number-id-staging --data-file=-
```

- [ ] Permissões IAM configuradas (Secret Accessor para Cloud Run SA)

### Artifact Registry

- [ ] Repositório criado: `connectors`
- [ ] Região: `us-central1` (ou mesma do Cloud Run)
- [ ] Formato: Docker
- [ ] Autenticação configurada: `gcloud auth configure-docker us-central1-docker.pkg.dev`

---

## 🐳 BUILD & PUSH DA IMAGEM

### Build Local (Opcional - Para Teste)

```bash
cd /path/to/connectors/apps/whatsapp
docker build --tag whatsapp-connector:local --file Dockerfile ../../

# Teste local
docker run -it --rm -p 8080:8080 \
  -e WHATSAPP_VERIFY_TOKEN="test-token" \
  -e PORT=8080 \
  whatsapp-connector:local

# Em outro terminal
curl http://localhost:8080/health
```

- [ ] Build local bem-sucedido
- [ ] Container inicia sem erros
- [ ] Health endpoint retorna 200 OK

### Build Cloud

**Opção 1: Cloud Build Automatizado**

```bash
cd /path/to/connectors
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=_SERVICE=whatsapp,_ENV=staging
```

- [ ] Build cloud iniciado
- [ ] Build completo sem erros
- [ ] Imagem publicada no Artifact Registry
- [ ] Deploy no Cloud Run concluído
- [ ] Smoke tests do Cloud Build passaram

**Opção 2: Build Manual + Deploy**

```bash
# Build e push
cd /path/to/connectors/apps/whatsapp
docker build \
  --tag us-central1-docker.pkg.dev/PROJECT_ID/connectors/whatsapp:staging \
  --file Dockerfile \
  ../../

docker push us-central1-docker.pkg.dev/PROJECT_ID/connectors/whatsapp:staging
```

- [ ] Build manual bem-sucedido
- [ ] Push para registry completo

---

## ☁️ DEPLOY NO CLOUD RUN

### Deploy Manual (se não usando Cloud Build)

```bash
export SERVICE_NAME="whatsapp-connector-staging"
export REGION="us-central1"
export IMAGE="us-central1-docker.pkg.dev/PROJECT_ID/connectors/whatsapp:staging"

gcloud run deploy ${SERVICE_NAME} \
  --image=${IMAGE} \
  --region=${REGION} \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=10 \
  --timeout=60s \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="WHATSAPP_VERIFY_TOKEN=whatsapp-verify-token-staging:latest,WHATSAPP_WEBHOOK_SECRET=whatsapp-webhook-secret-staging:latest,REDIS_URL=redis-url-staging:latest,WHATSAPP_ACCESS_TOKEN=whatsapp-access-token-staging:latest,WHATSAPP_PHONE_NUMBER_ID=whatsapp-phone-number-id-staging:latest"
```

- [ ] Deploy iniciado
- [ ] Service criado/atualizado
- [ ] URL do serviço anotada: `_____________`
- [ ] Nenhum erro de deploy

### Verificação Pós-Deploy

```bash
# Obter URL do serviço
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
  --region=${REGION} \
  --format='value(status.url)')

echo "Service URL: $SERVICE_URL"
```

- [ ] Service URL obtida
- [ ] Service está "Ready" (gcloud run services list)

---

## 🧪 TESTES DE VALIDAÇÃO

### 1. Health Check

```bash
curl -i $SERVICE_URL/health
```

**Resultado esperado:**
```
HTTP/2 200
content-type: application/json

{"status":"ok","connector":"whatsapp"}
```

- [ ] HTTP 200 OK
- [ ] JSON response correto
- [ ] Latência < 500ms

### 2. Webhook Verification (GET)

```bash
VERIFY_TOKEN="your-verify-token-here"
curl -i "${SERVICE_URL}/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=test123"
```

**Resultado esperado:**
```
HTTP/2 200
content-type: text/plain

test123
```

- [ ] HTTP 200 OK
- [ ] Challenge retornado corretamente
- [ ] Token incorreto retorna 403 (teste também)

### 3. Logs Estruturados

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}" \
  --limit=20 \
  --format=json
```

**Verificar:**

- [ ] Logs aparecem em JSON estruturado
- [ ] Campo `service` = "whatsapp-app"
- [ ] Campo `level` presente (info, warn, error)
- [ ] Nenhum payload bruto ou PII nos logs
- [ ] Logs de Redis: "Redis connected successfully" (se REDIS_URL está configurada)
- [ ] Nenhum erro de conexão Redis

### 4. Redis Connectivity

**Nos logs, procurar:**
- [ ] `"message":"Redis connected successfully"`
- [ ] Nenhum `"message":"Redis connection error"`
- [ ] Nenhum `"message":"REDIS_URL is required in production"`

**Se houver erros Redis:**
- Verificar REDIS_URL no Secret Manager (Upstash format: `rediss://...`)
- Verificar credentials no Upstash dashboard
- Testar conexão localmente: `redis-cli -u "$REDIS_URL"`

### 5. Webhook POST (Simulação)

```bash
curl -i -X POST $SERVICE_URL/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "123456789",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "15551234567",
            "phone_number_id": "123456789"
          },
          "messages": [{
            "from": "15559876543",
            "id": "wamid.test-'$(date +%s)'",
            "timestamp": "'$(date +%s)'",
            "type": "text",
            "text": {"body": "Hello staging"}
          }]
        },
        "field": "messages"
      }]
    }]
  }'
```

**Resultado esperado (sem assinatura):**
- HTTP 200 ou 403 (se signature validation habilitada)

**Verificar nos logs:**
- [ ] Evento recebido e processado
- [ ] `correlationId` gerado
- [ ] `dedupeKey` presente
- [ ] `outcome` = "processed" ou "deduplicated"
- [ ] Nenhum erro de parsing

---

## 🔒 VALIDAÇÃO DE SEGURANÇA

### Container Security

- [ ] Container roda como non-root (nodejs:1001)
- [ ] Imagem baseada em Alpine (minimal attack surface)
- [ ] Nenhuma secret em variável de ambiente (todas em Secret Manager)

### Logs & Observabilidade

- [ ] Nenhum payload bruto logado
- [ ] Nenhum PII (telefone, nome completo) em plain text
- [ ] Signature validation ativa (WHATSAPP_WEBHOOK_SECRET configurado)
- [ ] Logs incluem todos campos obrigatórios:
  - [ ] `correlationId`
  - [ ] `dedupeKey`
  - [ ] `connector`
  - [ ] `capabilityId`
  - [ ] `outcome`
  - [ ] `latencyMs`

### Network & Access

- [ ] HTTPS habilitado (default no Cloud Run)
- [ ] Webhook URL usa HTTPS (Meta requer)
- [ ] Redis acessível apenas via VPC interna
- [ ] Cloud Run permite apenas tráfego autenticado (se aplicável)

---

## 🔗 INTEGRAÇÃO COM META

### Configurar Webhook no Meta App Dashboard

1. Acessar [Meta App Dashboard](https://developers.facebook.com/apps/)
2. Selecionar o app WhatsApp
3. Navegar para **WhatsApp > Configuration**
4. **Edit** na seção "Webhook"
5. Configurar:
   - **Callback URL:** `https://YOUR_SERVICE_URL/webhook`
   - **Verify Token:** (mesmo valor do secret `whatsapp-verify-token-staging`)
   - **Webhook fields:** Selecionar `messages` e `message_status` (mínimo)

- [ ] Callback URL configurada
- [ ] Verify token configurado
- [ ] Webhook verification bem-sucedida (Meta valida GET)
- [ ] Webhook fields selecionados (messages, message_status)
- [ ] Webhook ativo (toggle ON)

### Testar Mensagem Real

1. Enviar mensagem WhatsApp para o número de teste
2. Verificar logs do Cloud Run

**Nos logs, verificar:**

- [ ] Evento recebido do Meta
- [ ] Assinatura verificada (se WHATSAPP_WEBHOOK_SECRET configurado)
- [ ] Evento parseado corretamente
- [ ] `dedupeKey` gerado
- [ ] Handler executado (log: "Inbound WhatsApp message handled")
- [ ] Nenhum erro de processamento

### Testar Deduplicação

1. Enviar mesma mensagem duas vezes (ou forçar reenvio do Meta)
2. Verificar logs

**Esperado:**
- [ ] Primeira mensagem: `outcome: "processed"` ou `fullyDeduped: false`
- [ ] Segunda mensagem: `outcome: "deduplicated"` ou `fullyDeduped: true`
- [ ] Handler NÃO executado na segunda vez

---

## 📊 MÉTRICAS & MONITORING

### Cloud Monitoring

Configurar alertas (opcional, mas recomendado):

- [ ] Alerta: Error rate > 5%
- [ ] Alerta: Latência p95 > 2s
- [ ] Alerta: Request count == 0 por > 5min (possível downtime)
- [ ] Alerta: Cold start > 5s

### Dashboards

Criar dashboard com:

- [ ] Request count (total, por endpoint)
- [ ] Latência (p50, p95, p99)
- [ ] Error rate (por código HTTP)
- [ ] Container CPU/Memory usage
- [ ] Redis connection errors

---

## 🚨 ROLLBACK PROCEDURE

### Se houver falha crítica:

1. **Rollback imediato:**
   ```bash
   # Listar revisões
   gcloud run revisions list --service=${SERVICE_NAME} --region=${REGION}
   
   # Rollback para revisão anterior
   PREVIOUS_REVISION="whatsapp-connector-staging-00001-abc"
   gcloud run services update-traffic ${SERVICE_NAME} \
     --region=${REGION} \
     --to-revisions=${PREVIOUS_REVISION}=100
   ```

2. **Desabilitar webhook no Meta (se necessário):**
   - Meta App Dashboard > WhatsApp > Configuration > Webhook > Toggle OFF

3. **Investigar logs:**
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND severity>=ERROR" \
     --limit=50
   ```

4. **Notificar equipe**

### Critérios de Rollback

Fazer rollback imediatamente se:

- [ ] Error rate > 10% por > 5 minutos
- [ ] Nenhum evento processado por > 10 minutos (com tráfego esperado)
- [ ] Duplicação de eventos detectada (mesmo `dedupeKey` processado múltiplas vezes)
- [ ] Perda de mensagens (eventos chegam no Meta mas não nos logs)
- [ ] Redis errors > 50% das requisições

---

## ✅ CRITÉRIOS DE SUCESSO FINAL

### Must-Have (Bloqueante)

- [ ] Health endpoint retorna 200 OK
- [ ] Webhook GET verification funciona
- [ ] Meta consegue entregar eventos
- [ ] Eventos são parseados corretamente
- [ ] Logs estruturados presentes
- [ ] Nenhum PII em logs
- [ ] Redis dedupe funcionando
- [ ] Signature validation ativa
- [ ] **App não inicia sem REDIS_URL em staging/production (fail-closed)**
- [ ] **Redis connection validada no boot em staging/production (fail-closed)**

### Should-Have (Importante)

- [ ] Latência p95 < 500ms
- [ ] Cold start < 3s
- [ ] Deduplicação testada e funcionando
- [ ] Alertas configurados
- [ ] Dashboard criado
- [ ] Rollback procedure testado (dry-run)

### Nice-to-Have (Desejável)

- [ ] Min instances = 2 (eliminar cold starts)
- [ ] Horizontal scaling testado (stress test)
- [ ] Logs exportados para BigQuery ou Datadog
- [ ] Integration tests automatizados

---

## 📝 DOCUMENTAÇÃO PÓS-DEPLOY

### Atualizar Documentação

- [ ] URL do serviço staging anotada no README
- [ ] Secrets utilizados documentados
- [ ] Procedimento de rollback validado
- [ ] Contatos de oncall/suporte atualizados
- [ ] Runbook criado para troubleshooting

### Handoff para Operações

- [ ] Demonstração do serviço funcionando
- [ ] Walkthrough dos logs e métricas
- [ ] Explicação dos alertas configurados
- [ ] Treinamento de rollback
- [ ] Acesso aos dashboards garantido

---

## 🎯 PRÓXIMOS PASSOS (PÓS-STAGING)

- [ ] Monitorar staging por 7 dias
- [ ] Coletar métricas de performance
- [ ] Validar ausência de duplicações
- [ ] Testar cenários de falha (Redis down, Meta timeout)
- [ ] Planejar deploy em produção
- [ ] Criar automação para deploys futuros (CI/CD)
- [ ] Configurar outros conectores (Instagram, Messenger)

---

**✅ DEPLOY CONCLUÍDO COM SUCESSO**

**Data/Hora:** `__________`  
**Aprovado por:** `__________`  
**Observações:** 

```
_____________________________________________________________________
_____________________________________________________________________
_____________________________________________________________________
```

---

## 📞 CONTATOS DE EMERGÊNCIA

- **Oncall Engineering:** `__________`
- **DevOps/SRE:** `__________`
- **Product Owner:** `__________`
- **Meta Support:** https://developers.facebook.com/support/

---

## 📚 REFERÊNCIAS

- [README Deploy](./apps/whatsapp/README.md)
- [Architecture Docs](./docs/architecture.md)
- [Acceptance Criteria](./CRITERIOS_FINAIS_ACEITE_REPOSITORIO_CONNECTORS.md)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Meta WhatsApp API](https://developers.facebook.com/docs/whatsapp/cloud-api)
