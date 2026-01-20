Perfeito. Vou consolidar **em um único documento TODO**, com foco **100% executivo e funcional**, sem repetir o nível de detalhe técnico dos roadmaps antigos, mas garantindo que **nenhum conector fique “meia-boca”**.

O objetivo deste documento é claro:

> **Quando este TODO estiver 100% concluído, qualquer conector deverá funcionar apenas configurando credenciais (API keys, tokens, IDs, secrets), sem precisar escrever código novo.**

Abaixo está o **documento único** que substitui:

* `Roadmap_CONNECTORS.md`
* `Roadmap_CONNECTORS_companion.md`
* `TODO_list.md` (pós Sprint-0)

---

# 🧩 TODO ÚNICO — CENTRAL DE CONECTORES

> **Repositório:** Connectors Monorepo
> **Missão:** Fornecer conectores **plug-and-play**, robustos, idempotentes e observáveis para canais de comunicação e integrações externas.

---

## 0. BASE COMUM (OBRIGATÓRIA PARA TODOS OS CONECTORES)

### 0.1 Runtime unificado (core-runtime)

* [x] Ingestão batch-safe (N eventos por request)
* [x] Deduplicação por item (`DedupeStore`)
* [x] `fullyDeduped` como semântica canônica
* [x] Rate limit por batch
* [x] Logs por item:

  * `correlationId`
  * `connector`
  * `capabilityId`
  * `dedupeKey`
  * `outcome`
  * `latencyMs`
* [x] Proibição de log de payload bruto / PII
* [x] RedisDedupeStore (produção)
* [x] InMemoryDedupeStore (dev/test)

### 0.2 Regras globais

* [x] Parsing **sempre real** (payload do provider)
* [x] Fixtures reais versionadas
* [x] IdempotencyKey obrigatório para side-effects
* [x] Nenhuma capability “active” sem testes reais
* [x] Versionamento independente por package (SemVer)

---

## 1. WHATSAPP (Meta WhatsApp Business API)

### 1.1 Inbound (Mensagens recebidas)

* [x] Receber payload real do WhatsApp
* [x] Extrair:

  * ID da mensagem (`wamid`)
  * ID do contato
  * Nome do perfil
  * Telefone
  * Tipo da mensagem
* [x] Suporte a:

  * Texto
  * Áudio
  * Imagem
  * Vídeo
  * Documento
  * Localização
* [x] Fixtures reais
* [x] Batch + dedupe estável
* [x] Capability `inbound_messages` → active

### 1.2 Status de mensagem

* [x] Receber eventos de:

  * sent
  * delivered
  * read
* [x] Dedupe por message ID + status
* [x] Capability `message_status_updates` → active

### 1.3 Outbound (envio de mensagens)

* [ ] Enviar mensagens via Graph API
* [ ] Suporte a:

  * Texto
  * Template
  * Áudio
  * Imagem
  * Vídeo
  * Documento
* [ ] Retry/backoff
* [ ] Idempotência por `clientMessageId`
* [ ] Capability `outbound_messages` → active

### 1.4 Webhook verification & security

* [x] Verify token
* [x] Validação de assinatura
* [x] Raw body seguro

---

## 2. INSTAGRAM

### 2.1 DM Inbound (Mensagens privadas)

* [x] Receber payload real de DM
* [x] Extrair:

  * Sender ID
  * Recipient ID
  * Message ID
  * Texto / mídia
* [x] Suporte a:

  * Texto
  * Imagem
  * Vídeo
* [x] Batch + dedupe por `mid`
* [x] Fixtures reais
* [x] Capability `inbound_messages` → active

### 2.2 Comment Reply (responder comentários)

* [x] Client HTTP implementado
* [x] Retry/backoff
* [x] DedupeKey determinístico
* [x] idempotencyKey obrigatório
* [ ] Wiring no app Instagram
* [ ] Integration test end-to-end
* [ ] Capability `comment_reply` → active

### 2.3 Comment Ingest (ler comentários)

* [ ] Receber eventos de comentário
* [ ] Extrair:

  * commentId
  * authorId
  * texto
  * postId
* [ ] Dedupe por `commentId`
* [ ] Fixtures reais
* [ ] Capability `comment_ingest` → active

### 2.4 Webhook verification

* [x] Verify token
* [x] Validação de assinatura

---

## 3. MESSENGER (Facebook Messenger)

### 3.1 Inbound

* [ ] Receber mensagens via Graph API
* [ ] Extrair:

  * Sender ID
  * Message ID
  * Texto / anexos
* [ ] Suporte a:

  * Texto
  * Imagem
  * Vídeo
  * Attachment
* [ ] Batch + dedupe
* [ ] Fixtures reais
* [ ] Capability `inbound_messages` → active

### 3.2 Outbound

* [ ] Enviar mensagens
* [ ] Retry/backoff
* [ ] Idempotência
* [ ] Capability `outbound_messages` → active

---

## 4. LINKEDIN

### 4.1 Inbound (mensagens)

* [ ] OAuth + permissões
* [ ] Receber mensagens (DM)
* [ ] Extrair:

  * sender
  * conversationId
  * messageId
* [ ] Batch + dedupe
* [ ] Fixtures reais
* [ ] Capability `inbound_messages` → active

### 4.2 Outbound

* [ ] Enviar mensagens
* [ ] Idempotência
* [ ] Retry/backoff
* [ ] Capability `outbound_messages` → active

---

## 5. DISCORD

### 5.1 Inbound

* [ ] Receber eventos via webhook/bot
* [ ] Extrair:

  * guildId
  * channelId
  * authorId
  * messageId
  * conteúdo
* [ ] Batch + dedupe
* [ ] Fixtures reais
* [ ] Capability `inbound_messages` → active

### 5.2 Outbound

* [ ] Enviar mensagens
* [ ] Retry/backoff
* [ ] Idempotência
* [ ] Capability `outbound_messages` → active

---

## 6. YOUTUBE

### 6.1 Comment Ingest

* [ ] Receber eventos (polling ou webhook)
* [ ] Extrair:

  * commentId
  * author
  * texto
  * videoId
* [ ] Batch + dedupe
* [ ] Fixtures reais
* [ ] Capability `comment_ingest` → active

### 6.2 Comment Reply

* [ ] Enviar reply
* [ ] Idempotência
* [ ] Retry/backoff
* [ ] Capability `comment_reply` → active

---

## 7. TIKTOK

### 7.1 Inbound

* [ ] Receber comentários / mensagens
* [ ] Extrair:

  * userId
  * commentId
  * texto
  * postId
* [ ] Batch + dedupe
* [ ] Fixtures reais
* [ ] Capability `inbound_messages` → active

### 7.2 Outbound / Reply

* [ ] Enviar reply
* [ ] Idempotência
* [ ] Retry/backoff
* [ ] Capability `comment_reply` → active

---

## 8. CONECTORES EXTERNOS (NÃO SOCIAIS)

### 8.1 Email (AWS SES)

* [ ] Envio de email
* [ ] Retry/backoff
* [ ] Idempotência por messageId
* [ ] Capability `email_send` → active

### 8.2 Calendar (Google Calendar)

* [ ] OAuth
* [ ] Sync de eventos
* [ ] Watch / webhook
* [ ] Dedupe por eventId
* [ ] Capability `calendar_sync` → active

### 8.3 Automação (Zapier / Make)

* [ ] Webhook ingest
* [ ] Auth por token
* [ ] Batch + dedupe
* [ ] Capability `automation_trigger` → active

---

## ✅ CRITÉRIO DE “REPOSITÓRIO CONCLUÍDO”

Este repositório **SÓ pode ser considerado concluído** quando **TODOS** os critérios forem atendidos **para TODOS os canais suportados** (WhatsApp, Instagram, Messenger, LinkedIn, Discord, YouTube, TikTok e conectores externos).

---

## 🏁 DEFINIÇÃO FINAL DE “REPO CONCLUÍDO”

O repositório **Connectors** está concluído **APENAS QUANDO**:

* ✔️ Todos os canais possuem **100% das funcionalidades disponíveis**
* ✔️ Todos os fluxos são idempotentes e exactly-once
* ✔️ Observabilidade é robusta e produtiva
* ✔️ Tudo funciona apenas com configuração
* ✔️ Não existe parsing fake, capability parcial ou “atalho técnico”

Informações detalhadas sobre os critérios, consultar o arquivo `criterios_aceite_connector.md`

---

Se quiser, o próximo passo lógico pode ser:

1. **Atualizar o TODO único** com este novo critério no topo
2. **Criar uma matriz de cobertura por canal** (checklist funcional)
3. **Definir o “canal de referência”** (ex: WhatsApp como gold standard)
4. **Gerar issues automáticas por canal x funcionalidade**

Você decide o próximo movimento.


---

## 📌 RESULTADO FINAL ESPERADO

> Um sistema onde **WhatsApp, Instagram, Messenger, LinkedIn, Discord, YouTube, TikTok e conectores externos** funcionam de forma **uniforme**, previsível e segura, bastando inserir:

* tokens
* app secrets
* IDs
* URLs de webhook

Sem retrabalho.
Sem “feature de mentira”.
Sem gambiarra por canal.
