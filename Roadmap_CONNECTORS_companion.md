# Guia de Leitura e Execução — Roadmap_CONNECTORS (Companion)

Este documento **não substitui** o `Roadmap_CONNECTORS.md`.  
Ele existe para **guiar a leitura**, transformar o roadmap em **execução objetiva**, e impedir deriva (“interpretação criativa”, salto de fases, ou promessas sem lastro).

Use este guia como:
- **manual de execução** (como implementar, testar, revisar e promover)
- **checklist de gates** (quando uma fase realmente termina)
- **política de governança** (capabilities, contratos, versionamento, segurança e observabilidade)

---

## 1) Como ler o Roadmap (sem se enganar)

O roadmap principal está excelente em profundidade, mas ele mistura três “planos” diferentes:

1. **Infra / Runtime** (ingestão, batch, dedupe, correlação, rate-limit)
2. **Adapters / Conectores** (Meta WhatsApp/IG/Messenger, Google Calendar, SES, Zapier/Make)
3. **Domínios canônicos** (core-messaging, core-calendar, core-email, core-automation, core-sync…)

Se você não separa essas camadas mentalmente, você cai no erro clássico:
> implementar features de canal em cima de runtime incompleto, e depois refatorar tudo.

### Regra de ouro de leitura
- Tudo que está no roadmap e depende de **payload real** (Meta/Google/SES/Zapier) só é “verdade” quando houver:
  - parsing real
  - fixtures reais
  - testes que provem batch + idempotência

---

## 2) O “mapa” do repositório e onde cada coisa deve morar

Use isso como regra de alocação de código:

### 2.1 `apps/*` (edge operacional)
Responsabilidade:
- expor endpoints HTTP (`/webhook`, `/health`, `/oauth/*`, etc.)
- validar assinatura/signature e autenticação do request
- chamar parsers/adapters de `packages/*`
- registrar handlers/capabilities no runtime

**Apps não devem:**
- definir schemas canônicos
- duplicar parsing de provider
- conter regras de domínio

### 2.2 `packages/core-<provider>/*` (adapters/provider)
Exemplos:
- `core-meta-whatsapp`
- `core-meta-instagram`
- `core-google-calendar` (opcional)
- `core-email-providers/ses`

Responsabilidade:
- converter payload provider → eventos internos (ParsedEvent) **ou** → domínio canônico (dependendo da fase)
- decidir dedupeKey (com helpers do domínio, quando existir)
- client HTTP (Graph/Google/SES), retry/backoff, classificação de erro

### 2.3 `packages/core-<domain>/*` (domínios canônicos)
Exemplos:
- `core-messaging`, `core-calendar`, `core-email`, `core-automation`, `core-sync`

Responsabilidade:
- schema canônico (Zod)
- invariantes
- helpers (dedupe helpers, normalize)
- fixtures canônicas
- contract tests

### 2.4 `packages/core-runtime/*` (pipeline e execução)
Responsabilidade:
- receber ParsedEvents (batch)
- dedupe distribuído
- rate-limit
- roteamento por capability
- logs/metrics por item
- resposta agregada

---

## 3) Gates que faltam no Roadmap (e que você vai aplicar aqui)

O roadmap principal já traz critérios, mas, para execução, você precisa de gates **binários**.

### Gate G0 — “No Fake Parsing”
Nenhuma capability pode ser marcada como “ativa” se:
- usa envelope interno fake
- não usa payload real
- não tem fixtures reais

### Gate G1 — “Batch-Safe”
Antes de qualquer conector real (Meta/Google/SES), o runtime deve:
- aceitar N eventos por request
- processar item-a-item
- responder 200 em lote válido (mesmo que itens falhem), registrando falhas por item
- verificar assinatura **uma vez por request**

### Gate G2 — “Exactly-once side-effects”
Para qualquer coisa que gere side effect (outbound message/email/action):
- dedupeKey/idempotencyKey obrigatório
- comportamento em timeout definido (não duplicar)
- testes simulando retry storm

### Gate G3 — “Contrato Canônico Congelado”
A partir do momento em que um domínio canônico entra:
- breaking change exige SemVer e migração
- fixtures canônicas não podem “mudar silenciosamente”

### Gate G4 — “Prod-ready”
Sem SLO + runbook + rotação de secrets + auditoria, não existe “produção”.

---

## 4) Política de Capabilities (isso evita o repo virar mentira)

Cada capability deve ter status com definição objetiva.

### Status permitidos (recomendado)
- `planned`: existe apenas o manifesto/ideia, sem parsing real
- `scaffold`: existe handler vazio ou parsing parcial, sem payload real
- `active`: payload real + testes reais + dedupe validado
- `beta`: active + observabilidade + runbook básico + limites
- `prod`: beta + SLO + alertas + rotação de secrets + auditoria

### Regra de promoção para `active` (não negociável)
Para promover qualquer capability para `active`, precisa:
1. parsing real do provider
2. fixtures reais versionadas
3. testes:
   - batch com múltiplos itens
   - dedupe por item
   - falha de 1 item não vira 500 geral
4. logs por item com correlationId e dedupeKey

---

## 5) Transformando Roadmap em Backlog executável

O roadmap é longo. O que te faz avançar é um backlog bem “picotado”.

### 5.1 Formato padrão de issue (use sempre)
- Objetivo (1 frase)
- Contexto (por que isso desbloqueia algo)
- Entregas (arquivos/contratos)
- Critérios de aceite (testáveis)
- Riscos (1–3 bullets)
- Plano de teste (unit + integration + fixtures)

### 5.2 Como quebrar um EPIC em execução
Regra prática:
- 1 EPIC = 3–8 stories
- 1 story = 3–10 tasks
- 1 PR = 1 story (ideal)
- 1 PR deve ser revisável em 20–60 minutos

---

## 6) Ordem de execução “real” (anti-retrabalho)

O roadmap principal já sugere ordem. Aqui vai a ordem operacional, com dependências explícitas:

### Sprint 0 (setup)
- padronizar scripts de teste e lint
- definir convenções de fixtures
- definir política de logs/PII

### Sprint 1 (Runtime batch + observabilidade mínima)
- batch parsing (`parseEvents`) no runtime
- resposta agregada
- logs por item + summary
- testes de batch no core-runtime

### Sprint 2 (WhatsApp inbound real)
- `core-meta-whatsapp` parser real
- fixtures reais (texto + status + batch misto)
- app WhatsApp plugando parseEvents
- promover inbound/status para active

### Sprint 3 (WhatsApp outbound)
- client HTTP + retry/backoff
- idempotência outbound
- testes de retry/timeout

### Sprint 4 (Instagram DM inbound real)
- parser real + fixtures + batch tests
- promover inbound

Só depois disso faz sentido:
- comments reply, leads hardening, OAuth completo, etc.

---

## 7) Padrões de Testes (sem isso, “funciona no meu computador”)

### 7.1 Tipos de teste obrigatórios
- **Unit** (schemas, mapping, dedupeKey)
- **Integration** (runtime + app, via supertest)
- **Contract** (fixtures canônicas congeladas)
- **Chaos-lite** (retries e duplicação)
- **Multi-instance** (dedupe distribuído)

### 7.2 Regras de fixtures
- fixtures devem representar payload **real** (copiado e sanitizado)
- nomear por caso de uso:
  - `meta_whatsapp_message_text.json`
  - `meta_whatsapp_status_read.json`
  - `meta_whatsapp_batch_mixed.json`
- fixtures vivem ao lado do app (quando são webhook) e/ou no package do provider (quando são parser unit tests)

---

## 8) Observabilidade e PII (o que logar e o que nunca logar)

### 8.1 Campos obrigatórios por item
- correlationId
- connector
- capabilityId
- dedupeKey
- outcome: processed|deduped|failed
- latencyMs
- errorCode (quando falhar)
- upstreamStatus (quando aplicável)

### 8.2 Proibição absoluta
- não logar payload bruto
- não logar tokens/secrets
- mascarar PII (telefone/email) quando aparecer em metadado

---

## 9) Idempotência e Dedupe (por que isso é o coração)

### 9.1 Inbound
- dedupeKey determinístico por item
- TTL suficiente para cobrir retries do provider

### 9.2 Outbound
- clientMessageId obrigatório
- dedupeKey por (tenant + clientMessageId)
- timeout após envio não pode re-enviar “cego”

### 9.3 Tiping indicator
- por natureza não é idempotente; precisa bucket (ex.: 5–10s) e TTL curto

---

## 10) Segurança e Secrets (o que executar na prática)

### 10.1 Inventário mínimo de secrets
- Meta App Secret / Verify token / signing secret
- Google OAuth client secret
- AWS credentials / SES config
- Zapier/Make API keys (integration secrets)
- Redis credentials

### 10.2 Rotação (dual-secret)
Implementar suporte a:
- `secret_current` + `secret_previous`
- janela de convivência
- remoção segura do antigo

Sem isso, você não tem produção de verdade.

---

## 11) Como usar este guia durante a execução

### Checklist diário (operacional)
- O que estou fazendo hoje pertence a qual fase?
- Esta tarefa viola algum gate (G0–G4)?
- Existe teste e fixture real para isso?
- Estou criando domínio canônico cedo demais?
- Estou “ativando” capability sem lastro?

### Checklist de PR
- adicionou/atualizou fixtures?
- adicionou testes batch?
- logs por item têm dedupeKey/correlationId?
- não vazou payload/PII?
- idempotência definida?

---

## 12) Anexos: templates prontos

### 12.1 Template de Issue (copiar e colar)
**Título:** [Fase X] <EPIC/Story> — <objetivo>

**Objetivo:**  
**Contexto:**  
**Escopo (in/out):**  
**Arquivos-alvo:**  
**Critérios de aceite:**  
**Plano de teste:**  
**Riscos:**  
**Notas de rollout:**

### 12.2 Template de Definition of Done (DoD)
- parsing real (quando aplicável)
- fixtures reais versionadas
- unit + integration tests
- batch test (quando webhook)
- logs por item com campos obrigatórios
- idempotência/dedupe validado (quando side-effect)

---

## 13) Decisões já fixadas (para não “re-decidir” depois)

- Email default: **AWS SES**
- WhatsApp/Instagram/Messenger: **Meta Graph API oficial**
- Calendar: **Google Calendar OAuth + watch + sync**
- iPaaS: **Zapier + Make**
- Dedupe distribuído: **Redis**

---

## 14) Critérios de “conclusão real” de uma fase (sem autoengano)

Uma fase só termina quando:
- gates atendidos
- não há capability ativa sem payload real + testes reais
- contratos canônicos têm fixtures congeladas
- runbooks existem (quando fase implica operação)
- o repositório não contém “promessas ativas” sem implementação real

Se qualquer item falhar, a fase não terminou — você só avançou no texto.

