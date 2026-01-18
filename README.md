Connectors monorepo para canais integrados ao Pyloto CRM. Cada app em `apps/*` é deployável isoladamente e reutiliza os pacotes em `packages/*`.

## Requisitos rápidos
- Node 18+ e pnpm 8+
- Instalação: `pnpm install`
- Scripts gerais: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format`

## Estrutura

### Apps (`apps/*`)
Conectores deployáveis que usam o runtime unificado:
- `apps/whatsapp`: conector WhatsApp Business (webhook + health)
- `apps/instagram`: conector Instagram/Meta (comentários, leads, mensagens)
- `apps/calendar`: scaffold para calendários (Google Calendar, Apple Calendar) — *planned*
- `apps/automation`: scaffold para iPaaS (Zapier, Make) — *planned*

### Runtime e Contratos (`packages/*`)
- **`core-runtime`**: runtime unificado — correlationId, assinatura, dedupe, rate-limit, logging
- **`core-connectors`**: manifests, capabilities, contratos de calendário e automação
- **`core-events`**: envelopes de evento padronizados (mensagens, leads, status)

### Domínios
- **`core-ads`**: parsing e normalização de leads (Meta Lead Ads)
- **`core-comments`**: parsing e normalização de comentários (Instagram/Facebook)
- **`core-signature`**: verificação HMAC-SHA256 de webhooks
- **`core-rate-limit`**: rate limiting e retry com backoff

### Infraestrutura
- `core-validation`: `safeParseOrThrow` com Zod
- `core-tenant`: tipos e guardas de tenant
- `core-logging`: logger estruturado (JSON)
- `core-sync`: checkpoints para sync incremental
- `core-auth`: armazenamento de tokens OAuth

### Legado (em depreciação)
- `core-webhooks`, `adapter-express`: substituídos por `core-runtime`

### Tooling
- `tooling/`: configs compartilhadas (eslint, prettier, vitest)
- `docs/architecture.md`: convenções detalhadas

## Convenções
- Apps usam `core-runtime` para webhook handling (não reimplementar correlação/dedupe/assinatura).
- Envelopes de evento padronizados via `core-events`.
- Apps nunca importam código de outras apps; apenas de `packages/*`.
- Logging estruturado via `createLogger` com `tenantId`, `correlationId`, `eventId`.

## Rodando localmente
```bash
pnpm install
pnpm build   # compila todos os pacotes e apps
pnpm test    # roda Vitest em todos os workspaces
pnpm lint    # ESLint flat config
```

## Gerenciamento de tarefas

| Recurso | Propósito |
|---------|----------|
| `TODO_list.md` (raiz) | Lista oficial do próximo ciclo de trabalho |
| `.local/*` | Artefatos locais (histórico, rascunhos) — **não versionados** |
| GitHub Issues | Backlog formal rastreável para tarefas maiores |

## Próximos passos

Prioridades do próximo ciclo (detalhes em [`TODO_list.md`](./TODO_list.md)):

1. **Integrar provedores reais** — Google Calendar, Zapier/Make nos scaffolds existentes
2. **Novos domínios** — `core-messaging` (DMs) e `core-reactions` (likes/emojis)
3. **Publicação de pacotes** — registry npm privado para `@connectors/core-*`

### Concluído recentemente
- ✅ `RedisDedupeStore` para ambientes distribuídos ([docs](./docs/architecture.md#deduplicação-distribuída))
- ✅ Scaffolds `apps/calendar` e `apps/automation`
- ✅ Limpeza de código (variáveis não utilizadas)
