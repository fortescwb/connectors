### TODO geral

1. **Limpar variáveis/imports não utilizados**

   * Remover ou renomear a constante `_defaultLogger` não utilizada em `buildWebhookHandlers` do `core-runtime` (ex.: renomear para `__unused` ou removê‑la).
   * Revisar os testes em todos os pacotes; eliminar imports que não são usados (como `beforeEach` ou tipos de retorno) ou prefixar com `_` para suprimir warnings de ESLint.

2. **Gerenciar backlog e tarefas**

   * ✅ `.local/` está no `.gitignore` e não entra no fluxo.
   * Para backlog formal rastreável, utilize GitHub Issues.

3. **Atualizar documentação**

   * **README principal**: o texto ainda fala em “próximos passos sugeridos” que já foram parcialmente implementados, como conectar webhooks reais e adicionar assinatura de webhook. Atualize a descrição da estrutura de pacotes para refletir o runtime unificado (`core-runtime`), os novos domínios (`core-ads`, `core-comments`, `core-connectors`), e remova referências a `core-webhooks` e `adapter-express` se não forem mais utilizados. Ajuste a seção de “Próximos passos” para orientar o próximo ciclo (ver itens 5–8 deste TODO).
   * **docs/architecture.md**: revisar a arquitetura para incluir os novos domínios (comentários, leads, calendários, automação). Certificar-se de que as convenções de correlação, dedupe, assinatura e OAuth continuam coerentes após a mudança para `core-runtime`.

4. **Planejar novos domínios e pacotes**

   * Avaliar a criação de pacotes como `core-reactions` (para likes/reações) e `core-messaging` (para mensagens diretas), garantindo a separação de responsabilidades à medida que novos conectores (Instagram Direct/Facebook, calendários, iPaaS) forem adicionados.
   * Atualizar o `core-connectors` para registrar capabilities correspondentes a esses novos domínios.

5. **Implementar `DedupeStore` persistente**

   * ✅ `RedisDedupeStore` implementado em `core-runtime` com:
     - Interface `RedisClient` compatível com ioredis/node-redis
     - Fail modes: `open` (bloqueia em erro) e `closed` (permite em erro)
     - TTL configurável via parâmetro
     - Documentação no README do `core-runtime`

6. **Desenvolver conectores para calendários e automação**

   * Utilizar os contratos de calendário e iPaaS já definidos em `core-connectors` para construir conectores reais (ex.: Google Calendar, Apple Calendar, Zapier/Make). Implementar `parseEvent` e mapeamentos de webhook para cada provedor, além de testes de integração garantindo correlação, dedupe e assinatura.
   * Criar registries de capabilities e eventos específicos para esses domínios, seguindo o padrão do runtime unificado.

7. **Publicação e uso de pacotes**

   * Se os pacotes `@connectors/core-*` serão consumidos por outros repositórios, definir um processo de publicação em registry privado (npm privado). Atualizar `package.json` com `publishConfig` apropriado e ajustar pipelines de CI/CD para gerar e publicar os artefatos.

8. **Checklist para novos conectores**

   * Manter um checklist de criação de novos conectores com as etapas básicas (manifest, auth, webhook signature, raw body, endpoints `/webhook` e `/health`, testes mínimos, documentação) alinhadas ao runtime unificado.
   * Usar o `core-runtime` para evitar duplicação de lógica em correlação, assinatura, dedupe e rate‑limit.
