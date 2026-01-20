
# 🏁 CRITÉRIOS FINAIS DE ACEITE — REPOSITÓRIO CONNECTORS

> **Repositório:** Connectors (Central de Conectores)  
> **Natureza:** Infra‑grade / Base estrutural de integrações  
> **Status deste documento:** Fonte final de verdade para aceite global do repositório

---

## 🎯 OBJETIVO DESTE DOCUMENTO

Este documento define **os critérios finais e inegociáveis** para que o repositório **Connectors** seja considerado **concluído, pronto para produção e sustentável a longo prazo**.

Ele existe para garantir que:

- Nenhum conector seja entregue de forma parcial ou frágil  
- Nenhuma API seja integrada “pela metade”  
- O código seja limpo, seguro, rastreável e auditável  
- O repositório possa crescer (novos canais) sem gerar dívida técnica  
- O conhecimento fique no código e na documentação — não em pessoas  

> **Princípio central:**  
> **Não queremos apenas “uma funcionalidade” de cada API.  
> Queremos TODAS as funcionalidades oficialmente disponíveis, corretamente suportadas.**

---

## 1. CRITÉRIOS ARQUITETURAIS (ESTRUTURA DO REPOSITÓRIO)

### 1.1 Separação de responsabilidades (obrigatória)

A estrutura do repositório **DEVE** respeitar rigidamente os papéis abaixo:

### `apps/*`
Responsável exclusivamente por:
- Exposição de webhooks (HTTP)
- OAuth / auth flows
- Healthchecks
- Validação de assinatura (HMAC, tokens, secrets)
- Wiring de capabilities → runtime
- Leitura de variáveis de ambiente

🚫 **É proibido em apps/**:
- Parsing de payloads
- Lógica de domínio
- HTTP client direto para providers
- Regras de dedupe ou idempotência

---

### `packages/core-runtime/*`
Responsável exclusivamente por:
- Pipeline batch-safe
- Processamento item‑a‑item
- Deduplicação distribuída
- Controle de rate‑limit
- Orquestração de side‑effects
- Observabilidade transversal

🚫 **É proibido no core-runtime**:
- Conhecer payloads de providers
- Ter lógica específica de canal

---

### `packages/core-meta-*`
Responsável exclusivamente por:
- Integração com APIs externas (providers)
- HTTP clients
- Parsing REAL dos payloads
- Normalização de erros
- Mapeamento provider → domínio canônico

Cada provider deve ter:
- Um package próprio (`core-meta-whatsapp`, `core-meta-instagram`, etc.)
- Bases compartilhadas quando aplicável (ex: `core-meta-graph`)

---

### `packages/core-<domain>/*`
Responsável exclusivamente por:
- Schemas canônicos (Zod ou equivalente)
- Invariantes de domínio
- Helpers puros
- Fixtures congeladas
- Contratos estáveis

🚫 **Domínio nunca depende de provider.**

---

## 2. COBERTURA FUNCIONAL TOTAL POR CONECTOR

### 2.1 Regra absoluta

Um conector **SÓ pode ser considerado concluído** quando:

> **TODAS as funcionalidades oficialmente disponibilizadas pela API do provider estiverem suportadas.**

Não existe:
- “Implementação mínima”
- “Só inbound por enquanto”
- “Outbound depois”

Isso inclui, quando aplicável:

### Comunicação
- Inbound (mensagens, DMs, comentários, eventos)
- Outbound (envio, replies, respostas)
- Status de entrega / leitura / erro
- Threads / conversas / replies encadeados
- Reações

### Tipos de Conteúdo
- Texto
- Áudio
- Imagem
- Vídeo
- Documento
- Localização
- Stickers / attachments / reactions (se a API permitir)

### Metadados
- IDs estáveis (mensagem, conversa, usuário, canal)
- Nome / username / display name
- Foto de perfil (quando disponível)
- Identificadores do tenant / conta / página

❌ **Se a API expõe, o conector deve suportar.**

---

## 3. PARSING REAL (SEM SIMULAÇÕES)

Para **100% dos eventos**:

- Parsing baseado em payload real do provider
- Schemas estritos
- Fixtures reais versionadas
- Compatibilidade com batch (N eventos)
- Rejeição explícita de payload inválido

🚫 É proibido:
- Mock de payload
- Parsing “genérico”
- Campos ignorados sem justificativa

---

## 4. IDEMPOTÊNCIA E EXACTLY‑ONCE (END‑TO‑END)

Para **todo side‑effect** (envio, reply, trigger externo):

### Regras obrigatórias
- `idempotencyKey` **obrigatório**
- `dedupeKey`:
  - Determinístico
  - Estável entre retries
  - Baseado em IDs reais do provider
- Dedupe ocorre **antes** do side‑effect
- `fullyDeduped` corretamente calculado

🚫 É proibido:
- Hash de conteúdo
- Timestamp
- Heurísticas instáveis

---

## 5. OBSERVABILIDADE DE NÍVEL PRODUÇÃO

### 5.1 Logs estruturados (por item)

Cada item processado **DEVE** gerar log com:

- `correlationId`
- `tenantId`
- `connector`
- `capability`
- `provider`
- `providerEventId`
- `dedupeKey`
- `outcome`
- `latencyMs`
- `errorClass` / `errorCode` (se houver)

🚫 Payload bruto ou PII em logs = reprovação.

---

### 5.2 Métricas obrigatórias

Por capability:

- Throughput
- Latência (p50 / p95 / p99)
- Taxa de erro
- Taxa de dedupe
- Retry count
- Rate‑limit hits

As métricas devem permitir:
- Debug
- Auditoria
- SLO / SLA

---

## 6. TESTES (INVIOLÁVEL)

Para cada conector e capability:

- Testes unitários
- Testes de integração
- Testes batch
- Testes de dedupe
- Testes de retry/backoff
- Testes de erro do provider

Fixtures:
- Reais
- Versionadas
- Congeladas

🚫 Testes fake invalidam o aceite.

---

## 7. PLUG‑AND‑PLAY REAL

Um conector **SÓ é aceito** se:

- Funcionar apenas com configuração
- Não exigir código adicional
- Variáveis claramente documentadas:
  - Tokens
  - Secrets
  - IDs
  - URLs

---

## 8. VERSIONAMENTO E GOVERNANÇA

- SemVer por package
- Estratégia B (independente)
- Dependências internas via `workspace:^`
- CHANGELOG claro e rastreável

Breaking changes:
- Exigem nova versão
- Migração documentada
- Comunicação explícita

---

## 9. DOCUMENTAÇÃO COMO FONTE DE VERDADE

- README, architecture e manifests refletem o código
- Nenhuma capability ativa sem cumprir todos os critérios
- Estados claros:
  - planned
  - scaffold
  - active
  - beta
  - prod

---

## 10. CHECKLIST FINAL DE ACEITE GLOBAL

O repositório **SÓ pode ser declarado CONCLUÍDO** se:

- Todos os conectores cumprem critérios individuais
- Todos os TODOs estão fechados
- `pnpm lint` → 0 erros / 0 warnings
- `pnpm build` → sucesso
- `pnpm test` → 100% passing
- Nenhuma dívida técnica aberta
- Observabilidade completa
- Segurança validada
- Documentação coerente

---

## 🏁 DEFINIÇÃO FINAL

> O repositório Connectors está concluído quando pode ser usado como **infra crítica**, por múltiplos produtos e canais, **sem atalhos, sem risco oculto e sem dependência de conhecimento tribal**.
