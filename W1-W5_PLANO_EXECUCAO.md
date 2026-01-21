# 🚀 PLANO W1-W5 — EXECUÇÃO FINAL

**Objetivo:** Promover WhatsApp Outbound de 🟡 ACTIVE para 🟢 REAL e ✅ PRODUCTION-READY

**Sequência:** W1 → W2 → W3 → W4 → W5

**Duração Estimada:** 3-5 dias (dependendo de descobertas)

---

## 📊 Visão Geral

| Semana | Tarefa | Status | Saída | Next |
|--------|--------|--------|-------|------|
| W1 | Captura de Fixtures Reais | 🟡 PRONTO | 7 real_*.json | W2 |
| W2 | Validação Operacional | 🟡 PRONTO (após W1) | W2 Pass/Fail | W3 ou Fix |
| W3 | Atualizar Status 🟡→🟢 | 🟡 PRONTO (após W2) | README atualizado | W4 |
| W4 | Go/No-Go Final | 🟡 PRONTO (após W3) | Decisão GO/NO-GO | W5 ou Fix |
| W5 | Production Readiness | 🟡 PRONTO (após W4) | Checklist completo | Deploy |

---

## 🎯 Cada Fase em Detalhe

### W1: Captura de Fixtures Reais (0.5-1 dia)

**O quê:** Capturar 7 tipos de mensagens reais do endpoint /__staging/outbound

**Como:**
```bash
# 1. Prep
export STAGING_URL="https://seu-staging-url.run.app"
export STAGING_TOKEN="seu-staging-token"
export PHONE_TO="+554284027199"

# 2. Executar captura
chmod +x scripts/w1-capture-fixtures.sh
./scripts/w1-capture-fixtures.sh \
  --url "$STAGING_URL" \
  --token "$STAGING_TOKEN" \
  --phone-to "$PHONE_TO"

# 3. Verificar
ls -lh packages/core-meta-whatsapp/fixtures/outbound/real/
# Esperado: 7 arquivos .json
```

**Saída:**
- ✅ 7 fixtures em `fixtures/outbound/real/`
- ✅ Log de captura em `W1_CAPTURE_*.log`
- ✅ Arquivo de validação `W1_CAPTURA_FIXTURES.md`

**Sucesso Criteria:** Todos 7 tipos capturados sem erros

---

### W2: Validação Operacional em Staging (1-2 dias)

**O quê:** Testar todas as funcionalidades em staging

**Como:**
```bash
# Seguir checklist em W2_VALIDACAO_OPERACIONAL.md
# Executar ~20 testes manuais + automáticos

# Principais:
1. Health check
2. Auth validation (válido/inválido)
3. Delivery de todos 7 tipos
4. Dedupe (sem duplicatas)
5. Logs (sem PII)
6. Error handling
7. Latência aceitável
```

**Saída:**
- ✅ Todos 20+ testes PASS
- ✅ Evidências em `w2-evidence/`
- ✅ Relatório `W2_VALIDATION_RESULTS.md`

**Sucesso Criteria:** Todos testes com ✅, zero PII em logs

---

### W3: Atualizar Status 🟡→🟢 (0.5 dia)

**O quê:** Promover documentação de ACTIVE para REAL

**Como:**
```bash
# 1. Atualizar README
# Mudar: 🟡 ACTIVE → 🟢 REAL
# Mudar: example fixtures → real fixtures ✅

# 2. Atualizar WHATSAPP_OUTBOUND_COMPLETE.md
# Mudar: "Staging-Ready" → "Production-Ready"

# 3. Commit
git add packages/core-meta-whatsapp/README.md
git add WHATSAPP_OUTBOUND_COMPLETE.md
git add W3_STATUS_UPDATE.md
git add packages/core-meta-whatsapp/fixtures/outbound/real/*.json
git commit -m "W3: Promote WhatsApp to 🟢 REAL"
```

**Saída:**
- ✅ README com 🟢 REAL
- ✅ Git commit com evidência
- ✅ Arquivo `W3_STATUS_UPDATE.md`

**Sucesso Criteria:** Status refletido em todos docs, commit criado

---

### W4: Go/No-Go Final (1 dia)

**O quê:** Votação final de aprovou ou reprovou para produção

**Como:**
```bash
# Preencher W4_GO_NO_GO.md:
# - 5 categorias (Implementação, Testes, Staging, Segurança, Docs)
# - Cada categoria: GO ou NO-GO
# - Se algum NO-GO: abrir issue, remediar, repetir

# Decisão Final:
# ✅ GO FOR PRODUCTION
# ou
# ❌ NO-GO (need fixes)
```

**Saída:**
- ✅ Documento assinado `W4_GO_NO_GO_DECISION.md`
- ✅ Decisão GO ou NO-GO

**Sucesso Criteria:** 5/5 categorias votam GO

---

### W5: Production Readiness (2-3 dias)

**O quê:** Checklist final antes de deploy

**Como:**
```bash
# Validar:
# 1. Cloud Run + Redis + Secrets configurados
# 2. Webhook conectado na Meta
# 3. Monitoring + Alerting ativo
# 4. Runbooks criados
# 5. On-call treinado

# Scorecard:
# - 95%+ de checklist items = READY
# - Qualquer blocker = REPEAT
```

**Saída:**
- ✅ Scorecard > 95% completo
- ✅ Runbooks em `docs/runbooks/`
- ✅ Arquivo `W5_PRODUCTION_READINESS.md`

**Sucesso Criteria:** > 95% checks, zero blockers

---

## 🗂️ Estrutura de Arquivos

Após W1-W5 completo:

```
/home/fortes/Repositórios/connectors/
├── packages/core-meta-whatsapp/
│   ├── fixtures/outbound/
│   │   ├── example_*.json (7 arquivos) ← W0
│   │   └── real_*.json (7 arquivos) ← W1 ✅
│   ├── README.md ← W3 atualizado (🟢 REAL)
│   └── tests/
│       ├── sendMessage.test.ts (34 tests) ← W0
│       └── outbound-exactly-once.integration.test.ts (12 tests) ← W0
├── W1_CAPTURA_FIXTURES.md ← W1
├── W1_CAPTURE_20240121_120000.log ← W1
├── W2_VALIDACAO_OPERACIONAL.md ← W2
├── w2-evidence/ ← W2
│   ├── health.json
│   ├── metrics.json
│   └── delivery-test.log
├── W2_VALIDATION_RESULTS.md ← W2
├── W3_STATUS_UPDATE.md ← W3
├── WHATSAPP_OUTBOUND_COMPLETE.md ← W3 atualizado
├── W4_GO_NO_GO.md ← W4 template
├── W4_GO_NO_GO_DECISION.md ← W4 preenchido ✅ GO
├── W5_PRODUCTION_READINESS.md ← W5
├── docs/
│   └── runbooks/
│       ├── deployment.md ← W5
│       ├── scaling.md ← W5
│       └── incident-response.md ← W5
├── scripts/
│   ├── w1-capture-fixtures.sh ← W1
│   └── rollback-cloud-run.sh ← W5
```

---

## 🔄 Loop de Feedback

Se qualquer fase falhar:

```
Falha em W2? → Abrir issue → Fix em W1-W2 código → Repetir W2
Falha em W4? → Abrir issue → Fix em W1-W3 código → Repetir W1-W4
```

**Nunca avançar se fase anterior falhou.**

---

## ⏱️ Timeline Estimada

| Fase | Duração | Quando Iniciar |
|------|---------|----------------|
| W1 | 0.5-1 dia | Semana que vem (segunda) |
| W2 | 1-2 dias | Terça/Quarta |
| W3 | 0.5 dia | Quinta |
| W4 | 1 dia | Sexta |
| W5 | 2-3 dias | Semana seguinte (segunda-quarta) |
| **Total** | **5-8 dias** | **Fim semana próxima** |

---

## 🎯 Condições Finais

### Para Iniciar W1:
- ✅ Staging está UP
- ✅ Webhook conectado na Meta
- ✅ Credenciais configuradas (STAGING_TOKEN, etc)
- ✅ Telefone (+554284027199) cadastrado na WABA

### Para Fazer Deploy (Após W5):
- ✅ W1-W5 todos COMPLETO
- ✅ W4 votou GO
- ✅ Aprovação explícita do usuário
- ✅ On-call designado
- ✅ Communication channel aberto

---

## 📞 Contato

Se tiver dúvidas ou encontrar problemas durante W1-W5:

1. Consulte o documento da fase específica (W1_*, W2_*, etc)
2. Abra uma issue no repositório
3. Escalera ao tech lead

---

## ✅ Próximo Passo

**Você está pronto para começar!**

### Iniciar W1 Agora:

```bash
cd /home/fortes/Repositórios/connectors

# 1. Definir credenciais
export STAGING_URL="https://seu-staging-url.run.app"
export STAGING_TOKEN="seu-token"
export PHONE_TO="+554284027199"

# 2. Executar captura
chmod +x scripts/w1-capture-fixtures.sh
./scripts/w1-capture-fixtures.sh \
  --url "$STAGING_URL" \
  --token "$STAGING_TOKEN" \
  --phone-to "$PHONE_TO"

# 3. Validar
ls -lh packages/core-meta-whatsapp/fixtures/outbound/real/
```

---

**🚀 Bom trabalho! Vamos levar WhatsApp para produção! 🚀**
