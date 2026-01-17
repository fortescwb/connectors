Connectors monorepo para canais integrados ao Pyloto CRM. Cada app em `apps/*` é deployável isoladamente e reutiliza os pacotes em `packages/*`.

## Requisitos rápidos
- Node 18+ e pnpm 8+
- Instalação: `pnpm install`
- Scripts gerais: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format`

## Estrutura
- `apps/whatsapp`: servidor HTTP com `/health` e placeholder `/webhook`
- `packages/core-events`: contratos, schemas Zod e helpers de eventos
- `packages/core-validation`: utilitário `safeParseOrThrow`
- `packages/core-tenant`: tipos/guardas de tenant
- `packages/core-logging`: logger estruturado (console JSON)
- `packages/core-webhooks`: processamento agnóstico de webhooks com dedupe e logging
- `packages/adapter-express`: adapter Express para o processor de webhooks
- `tooling/`: configs compartilhadas (eslint, prettier, vitest)
- `docs/architecture.md`: convenções de eventos, idempotência e multi-tenant

## Convenções
- Sempre use envelopes de evento padronizados (`eventId`, `eventType`, `occurredAt`, `tenantId`, `source`, `correlationId`, `causationId`, `dedupeKey`, `payload`, `meta`).
- Use `buildDedupeKey(channel, externalId)` para dedupe e mantenha `dedupeKey` obrigatório.
- Apps nunca importam código de outras apps; apenas de `packages/*`.
- Logging estruturado: utilize `createLogger` e inclua `tenantId`, `correlationId`, `eventId`, `eventType` quando disponíveis.

## Rodando localmente
```bash
pnpm install
pnpm build   # compila todos os pacotes e apps
pnpm test    # roda Vitest em todos os workspaces
pnpm lint    # ESLint flat config
```

## Próximos passos sugeridos
- Conectar webhooks reais por canal reutilizando `core-events` para validação e idempotência.
- Adicionar autenticação/assinatura dos webhooks na camada de app.
- Publicar os pacotes em um registry privado para consumo pelos conectores.
