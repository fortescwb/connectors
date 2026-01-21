# 0. Documentos que devem ser lidos como anexo a esse.

 * conectores_meta-graph.md
 * CRITERIOS_FINAL_ACEITE_REPOSITORIO_CONNECTORS.md
 * TODO_list_roadmap.md

# Fase A — WhatsApp: fechar outbound “surface completo” (primeiro)

Você já tem runtime/dedupe end-to-end e text outbound melhorado; agora é completar “o que a API permite” para outbound.

**A1. Modelagem canônica de outbound (no domínio)**

* Definir um contrato canônico de “OutboundMessageIntent” que suporte: text, template, media, location, contacts, interactive, reactions, mark_read.
* Schemas **Zod estritos** (o critério exige). 

**A2. Implementação por “builders” (no core-meta-whatsapp)**

* Em vez de um `sendMessage` com `switch` monolítico: crie builders puros por tipo (ex.: `buildTextPayload`, `buildTemplatePayload`, `buildMediaPayload`, etc.).
* Cada builder:

  * valida schema
  * gera payload Graph
  * produz metadata segura para logs (sem PII)

**A3. Fixtures reais por tipo outbound**

* Se não tiver como gerar agora via conta de testes, então você não consegue marcar “concluído” (e nem “active” para essas capabilities).
* Sem fixture real, é scaffold, ponto.

**A4. Testes**

* Unit: cada builder com fixtures reais sanitizadas.
* Integration: runtime + dedupeStore + retry/timeout sem duplicar (você já começou isso; estenda para cada tipo).

**Saída dessa fase**

* WhatsApp pode ter `outbound_messages` como **active** (não “concluído”) quando o surface do outbound estiver completo e testado.

## Fase B — Instagram: fechar Comment Reply wiring + Comment ingest (segundo)

Aqui o gargalo não é “client”: é **app wiring + fixtures + eventos**.

**B1. Comment Reply wiring (apps/instagram)**

* Criar handler de capability e endpoint/consumer, e2e test via supertest/HTTP mock.
* Só então você pode subir `comment_reply` para active.

**B2. Comment ingest**

* Webhook parser real + fixtures reais + dedupe por commentId.
* Normalização para `core-comments` (e aqui entra o seu `core-comments` como domínio, que já existe).

**B3. DM outbound**

* Só depois de comment ingest/reply estarem sólidos; DM outbound parece simples mas tem edge cases e risco de PII/logs.

### Fase C — Messenger: “primeiro fixtures, depois qualquer coisa”

Seu próprio critério mata qualquer tentativa de avançar sem payload real. 
Então o passo 1 é operacional:

**C1. Capturar fixtures reais (sanitizadas)**

* inbound message
* postback
* quick reply
* attachments
* status

**C2. Só depois: schemas Zod + parseWebhook + app deployável**
Sem isso, você fica escrevendo código que “parece certo” e nunca vira ativo.

---
