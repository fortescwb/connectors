### TODO geral

1. **Limpar variáveis/imports não utilizados**

   * ✅ Removida constante `_defaultLogger` não utilizada em `buildWebhookHandlers`
   * ✅ Revisados testes — imports estão corretos

2. **Gerenciar backlog e tarefas**

   * ✅ `.local/` está no `.gitignore` e não entra no fluxo.
   * Para backlog formal rastreável, utilize GitHub Issues.

3. **Atualizar documentação**

   * ✅ README atualizado com estrutura atual e próximos passos
   * ✅ `docs/architecture.md` atualizado com domínios planejados e RedisDedupeStore

4. **Planejar novos domínios e pacotes**

   * ✅ Domínios `core-messaging` e `core-reactions` documentados em `docs/architecture.md`
   * Próximo: implementar os pacotes quando houver demanda real de conectores

5. **Implementar `DedupeStore` persistente**

   * ✅ `RedisDedupeStore` implementado em `core-runtime` com:
     - Interface `RedisClient` compatível com ioredis/node-redis
     - Fail modes: `open` (bloqueia em erro) e `closed` (permite em erro)
     - TTL configurável via parâmetro
     - Documentação no README do `core-runtime`

6. **Desenvolver conectores para calendários e automação**

   * ✅ Scaffolds criados em `apps/calendar` e `apps/automation`:
     - ConnectorManifest com capabilities planejadas
     - Health endpoint funcional
     - parseEvent stub com TODO explícito
     - Testes mínimos (health + webhook 400/503)
   * Próximo passo: implementar integração real com provedores (Google Calendar, Zapier, etc.)

7. **Publicação e uso de pacotes**

   * Se os pacotes `@connectors/core-*` serão consumidos por outros repositórios, definir um processo de publicação em registry privado (npm privado). Atualizar `package.json` com `publishConfig` apropriado e ajustar pipelines de CI/CD para gerar e publicar os artefatos.

8. **Checklist para novos conectores**

   * Manter um checklist de criação de novos conectores com as etapas básicas (manifest, auth, webhook signature, raw body, endpoints `/webhook` e `/health`, testes mínimos, documentação) alinhadas ao runtime unificado.
   * Usar o `core-runtime` para evitar duplicação de lógica em correlação, assinatura, dedupe e rate‑limit.
