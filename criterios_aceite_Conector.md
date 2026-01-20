# 1. Cobertura Funcional Completa por Canal (OBRIGATÓRIO)

Para **cada canal**, **TODAS as funcionalidades disponibilizadas oficialmente pela plataforma** devem estar implementadas, **sem exceções**.

Isso inclui, conforme aplicável ao canal:

## Comunicação

* Inbound (mensagens, DMs, comentários, eventos)
* Outbound (envio de mensagens, replies, respostas)
* Status / delivery / read / erro
* Reações (quando suportado)
* Threads / conversas / replies encadeados

## Conteúdo

* Texto
* Áudio
* Imagem
* Vídeo
* Documento
* Localização
* Stickers / reactions / attachments (quando aplicável)

## Metadados

* IDs estáveis (mensagem, conversa, usuário, canal)
* Nome / username / display name
* Foto de perfil (quando disponível)
* Identificadores do tenant / página / conta

> ❌ **Não é aceitável** declarar um canal como “concluído” com apenas inbound + outbound parcial.
> ✔️ Um canal só está pronto quando **tudo que a API permite, o conector suporta**.

---

## 2. Parsing Real e Completo (SEM SIMULAÇÕES)

Para **100% dos eventos**:

* Parsing baseado **exclusivamente** em payloads reais do provider
* Schemas estritos (Zod ou equivalente)
* Fixtures reais versionadas
* Nenhum payload “mockado” ou simplificado

> ❌ Qualquer parsing fake invalida o critério de conclusão.

---

## 3. Idempotência e Exactly-Once (END-TO-END)

Para **todo side-effect** (envio, reply, trigger externo):

* `idempotencyKey` **obrigatório**
* `dedupeKey`/`fullyDeduped`:

  * Determinístico
  * Estável entre retries
  * Baseado em IDs do provider (nunca em hash de conteúdo)
* Dedupe realizado **antes** de qualquer side-effect
* `fullyDeduped` corretamente calculado no runtime

> ❌ Fallbacks por hash, timestamp ou heurística invalidam o critério.

---

## 4. Observabilidade ROBUSTA (NÃO “MÍNIMA”)

Cada conector deve possuir **observabilidade de nível produção**, incluindo:

## Logs estruturados (por item)

* `correlationId`
* `tenantId`
* `connector`
* `capability`
* `providerEventId`
* `dedupeKey`
* `outcome`
* `latencyMs`
* `errorCode` / `errorClass` (quando aplicável)

## Métricas

* Throughput por capability
* Latência (p50 / p95 / p99)
* Taxa de erro por tipo
* Taxa de dedupe
* Retry count
* Rate-limit hits

## Requisitos adicionais

* Nenhum payload bruto ou PII em logs
* Logs e métricas suficientes para:

  * Debug
  * Auditoria
  * SLA / SLO

> ❌ “Log básico” ou apenas console.log invalida o critério.

---

## 5. Plug-and-Play Real (Zero Código)

Para qualquer conector:

* Funcionamento completo **apenas com configuração**, incluindo:

  * API keys
  * Tokens
  * App secrets
  * IDs (pageId, accountId, etc.)
* Nenhuma modificação de código necessária
* Documentação clara de variáveis obrigatórias

> ✔️ Se exige código adicional, **não está concluído**.

---

## 6. Testes de Produção Simulados

Para cada canal e capability:

* Testes unitários
* Testes de integração
* Testes batch
* Testes de dedupe
* Testes de retry/backoff
* Testes de erro do provider

> ❌ Ausência de testes reais invalida a conclusão do canal.

---

## 7. Documentação como Fonte de Verdade

* README, architecture e manifests **refletem exatamente o código**
* Nenhuma capability marcada como ativa sem cumprir TODOS os critérios
* Diferença clara entre:

  * planned
  * scaffold
  * active
  * beta
  * prod

---
