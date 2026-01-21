# W5 — Production Readiness

## Status: 🔄 AGUARDANDO W4

**Pré-requisitos:**
- ✅ W1 — Captura de Fixtures Reais **COMPLETO**
- ✅ W2 — Validação Operacional em Staging **COMPLETO**
- ✅ W3 — Atualização de Status 🟡→🟢 **COMPLETO**
- ✅ W4 — Go/No-Go Final **GO (aprovado)**

---

## 📋 Checklist de Produção

### 1️⃣ Infraestrutura — Produção

#### Cloud Run

- [ ] **1.1** Cloud Run service criado (`whatsapp-connector`)
- [ ] **1.2** Região: `{sua-região}` (ex: `us-central1`, `southamerica-east1`)
- [ ] **1.3** Memory: 512MB (ou conforme teste recomendou)
- [ ] **1.4** CPU: 1 (ou conforme teste recomendou)
- [ ] **1.5** Timeout: 60s (ou 120s para eventos grandes)
- [ ] **1.6** Max instances: autoscale configured
- [ ] **1.7** Min instances: 1 (ou 0 para serverless)
- [ ] **1.8** Health check: `/health` endpoint configured

#### Redis (Dedupe Store)

- [ ] **2.1** Upstash Redis provisioned (prod tier)
- [ ] **2.2** Redis TLS enabled
- [ ] **2.3** Retention: 24h TTL para dedupe keys
- [ ] **2.4** Connection string: `REDIS_URL` em Secret Manager
- [ ] **2.5** Firewall: Cloud Run IP whitelisted
- [ ] **2.6** Backup: Automated daily backups configured
- [ ] **2.7** High availability: Replication configured

#### Secrets Manager

- [ ] **3.1** `WHATSAPP_ACCESS_TOKEN`: Prod token (não staging)
- [ ] **3.2** `WHATSAPP_PHONE_NUMBER_ID`: Prod WABA number
- [ ] **3.3** `REDIS_URL`: Prod Redis connection string
- [ ] **3.4** `STAGING_OUTBOUND_TOKEN`: Disabled/removed
- [ ] **3.5** Secrets rotated: monthly schedule configured
- [ ] **3.6** Access logs: Cloud Run service account only
- [ ] **3.7** All secrets NOT hardcoded in image

#### Webhook Configuration

- [ ] **4.1** Meta App: Webhook URL updated to prod
- [ ] **4.2** Webhook URL: `https://{prod-url}/webhook`
- [ ] **4.3** Verify token: Same as HMAC validation token
- [ ] **4.4** Webhook active: Status = "Active" in Meta dashboard
- [ ] **4.5** Events subscribed: `messages`, `message_status`, etc.
- [ ] **4.6** Callback retry: Meta configured (default ok)

---

### 2️⃣ Logging & Monitoring

#### Logging

- [ ] **5.1** Cloud Logging integration active
- [ ] **5.2** Log level: `INFO` for prod (not `DEBUG`)
- [ ] **5.3** All logs JSON structured
- [ ] **5.4** Zero PII in any log line
- [ ] **5.5** Retention: 30 days (configurável)
- [ ] **5.6** Log sink: Forward to BigQuery (opcional)

#### Metrics

- [ ] **6.1** Cloud Monitoring integration active
- [ ] **6.2** Custom metrics exported:
  - [ ] `whatsapp/messages_sent` (counter)
  - [ ] `whatsapp/messages_failed` (counter)
  - [ ] `whatsapp/messages_deduped` (counter)
  - [ ] `whatsapp/send_latency_ms` (histogram)
  - [ ] `whatsapp/dedupe_hit_rate` (gauge)
  - [ ] `whatsapp/redis_latency_ms` (histogram)
- [ ] **6.3** Alerting: Critical alerts configured
  - [ ] Error rate > 5%
  - [ ] Latency p99 > 5s
  - [ ] Redis connection lost
  - [ ] Service unavailable

#### Tracing

- [ ] **7.1** OpenTelemetry instrumentation active
- [ ] **7.2** Traces exported to Cloud Trace
- [ ] **7.3** Correlation IDs propagated (W3C format)
- [ ] **7.4** Latency histograms captured

---

### 3️⃣ Resiliência & Failover

#### Error Handling

- [ ] **8.1** 4xx errors → no retry (log + mark failed)
- [ ] **8.2** 5xx errors → exponential backoff retry
- [ ] **8.3** 429 (rate limit) → retry with longer backoff
- [ ] **8.4** Timeout → retry with dedupe protection
- [ ] **8.5** Circuit breaker: if error rate > threshold, stop sending

#### Failover

- [ ] **9.1** Redis failover: Upstash handles
- [ ] **9.2** API failover: Graph API (Meta) is primary, no fallback
- [ ] **9.3** Service failover: Cloud Run autoscale handles
- [ ] **9.4** Database failover: N/A (stateless, Redis only)

#### Graceful Shutdown

- [ ] **10.1** SIGTERM handler: Stop accepting new intents
- [ ] **10.2** Drain timeout: 30s to complete in-flight
- [ ] **10.3** Connection pooling: Gracefully close redis/http

---

### 4️⃣ Capacity & Scaling

#### Load Testing

- [ ] **11.1** Load test performed: {timestamp}
- [ ] **11.2** Load level: {X messages/sec tested at}
- [ ] **11.3** Results:
  - [ ] Latency p99: < 5s
  - [ ] Error rate: < 1%
  - [ ] Dedupe performance: < 100ms overhead

#### Scaling Configuration

- [ ] **12.1** Max instances: Calculated based on load test
- [ ] **12.2** Min instances: 1 (cost optimization)
- [ ] **12.3** Scale up: When CPU > 70% or memory > 80%
- [ ] **12.4** Scale down: After 5 min idle
- [ ] **12.5** Cooldown: Between scale events = 60s

#### Quotas & Limits

- [ ] **13.1** Cloud Run quota: Unlimited (default)
- [ ] **13.2** Redis connection limit: {number}
- [ ] **13.3** Graph API quota: {X requests/sec per Meta}
- [ ] **13.4** Rate limiting: Per-tenant limit implemented

---

### 5️⃣ Segurança — Produção

#### Data Protection

- [ ] **14.1** Data encryption: TLS for all connections
- [ ] **14.2** Redis TLS: Required (not optional)
- [ ] **14.3** Phone numbers: Encrypted at rest (Redis)
- [ ] **14.4** Secrets: Never logged, never in memory longer than needed

#### Access Control

- [ ] **15.1** Cloud Run: Private service (not public)
- [ ] **15.2** VPC-SC: Service connector configured
- [ ] **15.3** IAM: Least privilege service account
- [ ] **15.4** Webhook: Only Meta IPs allowed (IP whitelist)

#### Audit & Compliance

- [ ] **16.1** Cloud Audit Logs: Enabled
- [ ] **16.2** Secret Manager audit: Enabled
- [ ] **16.3** Data residency: {seu-país/região}
- [ ] **16.4** GDPR compliance: Right to deletion implemented

---

### 6️⃣ Rollout Strategy

#### Canary Deployment

- [ ] **17.1** Canary percentage: 5% (prod traffic)
- [ ] **17.2** Canary duration: 2 hours (or until 100 messages)
- [ ] **17.3** Success metric: Error rate < 1%
- [ ] **17.4** Rollback trigger: If error rate > 5%

#### Gradual Rollout

- [ ] **18.1** Phase 1: 5% of traffic (2h)
- [ ] **18.2** Phase 2: 25% of traffic (4h)
- [ ] **18.3** Phase 3: 50% of traffic (8h)
- [ ] **18.4** Phase 4: 100% of traffic (final)

#### Rollback Plan

- [ ] **19.1** Rollback script: `scripts/rollback-cloud-run.sh` exists
- [ ] **19.2** Previous version: Tagged in registry
- [ ] **19.3** Rollback time: < 2 min
- [ ] **19.4** Verification: Health check after rollback

---

### 7️⃣ Runbooks & Documentation

#### Operational Runbooks

- [ ] **20.1** Runbook: Deployment (release process)
- [ ] **20.2** Runbook: Scaling (increase/decrease capacity)
- [ ] **20.3** Runbook: Incident response (service down)
- [ ] **20.4** Runbook: Performance troubleshooting
- [ ] **20.5** Runbook: Dedupe store corruption recovery

#### On-Call

- [ ] **21.1** Escalation path: defined
- [ ] **21.2** On-call rotation: scheduled
- [ ] **21.3** SLA: Response time {X min}, resolution {Y hours}
- [ ] **21.4** Incident management: Tool configured (ex: PagerDuty)

#### Documentation

- [ ] **22.1** Architecture diagram: Updated with prod setup
- [ ] **22.2** API documentation: Endpoint contracts documented
- [ ] **22.3** Integration guide: For other services
- [ ] **22.4** Troubleshooting guide: Common issues & solutions

---

### 8️⃣ Pre-Deployment Checklist

#### 24h Before Deployment

- [ ] **23.1** All W1-W4 completed and documented
- [ ] **23.2** Staging validation PASSED
- [ ] **23.3** All secrets validated (non-expired)
- [ ] **23.4** Cloud Run image built and tested
- [ ] **23.5** Database migrations (if any): tested
- [ ] **23.6** On-call engineer assigned
- [ ] **23.7** Communications channel open (Slack, etc.)

#### Day of Deployment

- [ ] **24.1** Staging health: ✅ All green
- [ ] **24.2** Redis connectivity: ✅ Tested
- [ ] **24.3** Graph API connectivity: ✅ Tested
- [ ] **24.4** Load: ✅ Normal (not peak)
- [ ] **24.5** Team ready: ✅ All key people present

#### Post-Deployment (30 min)

- [ ] **25.1** Health check: ✅ `/health` 200
- [ ] **25.2** Metrics: ✅ Data flowing
- [ ] **25.3** Logs: ✅ No errors
- [ ] **25.4** Test message: ✅ Delivery verified
- [ ] **25.5** Performance: ✅ Latency acceptable

#### Post-Deployment (2 hours)

- [ ] **26.1** Error rate: ✅ < 1%
- [ ] **26.2** Dedupe: ✅ Working (verified via duplicate test)
- [ ] **26.3** Webhook: ✅ Receiving inbound events
- [ ] **26.4** Redis: ✅ Healthy (connection count, memory)
- [ ] **26.5** All 7 types: ✅ At least 1 of each delivered

---

## 📋 Produção Readiness Scorecard

```markdown
# Production Readiness Scorecard

## Summary
- Infraestrutura: {N}/{M} checks passed
- Logging & Monitoring: {N}/{M} checks passed
- Resiliência: {N}/{M} checks passed
- Capacity: {N}/{M} checks passed
- Segurança: {N}/{M} checks passed
- Rollout: {N}/{M} checks passed
- Documentação: {N}/{M} checks passed
- Pre-Deployment: {N}/{M} checks passed

**Overall:** {N}/178 checks passed = {X}% complete

## Red Flags (Blockers)
- [ ] None found ✅
- Or list any items marked ❌
```

---

## ✅ Critério de Sucesso W5

Marcar W5 como **COMPLETO** quando:

1. ✅ > 95% de todas as checklist items checked
2. ✅ Zero red flags/blockers
3. ✅ Todos runbooks criados
4. ✅ On-call notificado e treinado
5. ✅ Communication plan pronto

---

## 🚫 Critério de Falha W5

Marcar W5 como **FALHA** se:

1. ❌ Secrets não estão em Secret Manager
2. ❌ Redis não está provisionado
3. ❌ Cloud Run não está configurado
4. ❌ Webhook URL não está na Meta
5. ❌ Runbooks não existem

**Ação em Falha:**
- Abrir issues para cada blocker
- Remediar antes de tentar deploy

---

## 📝 Artifact W5

Esperado após W5 COMPLETO:

```
W5_PRODUCTION_READINESS.md
├─ Checklist: 95%+ complete
├─ Red flags: None
├─ Infrastructure: ✅ Ready
├─ Monitoring: ✅ Ready
├─ Runbooks: ✅ Created
├─ On-call: ✅ Trained
└─ Status: ✅ READY FOR DEPLOYMENT
```

---

## 🚀 Após W5 Completo

**Próxima Ação:** Deploy em Produção (com aprovação explícita do usuário)

```bash
# Deploy command (exemplo):
gcloud run deploy whatsapp-connector \
  --image gcr.io/your-project/whatsapp-connector:latest \
  --region us-central1 \
  --set-env-vars ENVIRONMENT=production
```

---

## 📞 Contato & Suporte

Se encontrar qualquer problema:

1. Abrir issue no repositório
2. Contactar on-call engineer
3. Escalar ao tech lead

---

**W5 Status:** 🟡 PRONTO PARA EXECUÇÃO (depois de W4 GO)
