# @connectors/core-meta-messenger

Scaffold para o conector Meta Messenger usando a base compartilhada `core-meta-graph`.

## Status

- 🚧 **Scaffold somente**: sem fixtures reais, parsing de webhook ainda não implementado.
- Nenhuma capability deve ser marcada como `active` até termos payloads reais + testes.

## O que existe

- Wrapper de cliente Graph (`createMessengerGraphClient`) que aplica contexto de observabilidade do canal e reutiliza retry/backoff/erros do `core-meta-graph`.
- Placeholder `parseMessengerWebhook` com TODO explícito para ser substituído por schemas/fixtures reais.

## TODO antes de ativar

- Capturar fixtures reais do Messenger (webhook inbound, status updates, etc.).
- Implementar schemas/normalização + dedupe keys.
- Adicionar testes unitários com fixtures.
- Documentar capabilities e requisitos de configuração (verify token, webhook secret).

## Desenvolvimento

```bash
pnpm build
pnpm test
pnpm lint
```
