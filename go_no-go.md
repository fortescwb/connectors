# 0. Documentos que devem ser lidos como anexo a esse.

 * conectores_meta-graph.md
 * CRITERIOS_FINAL_ACEITE_REPOSITORIO_CONNECTORS.md
 * TODO_list_roadmap.md

# 🟢🔴 GO / NO-GO — PRODUÇÃO

**Checklist Universal de Prontidão de Conectores**

> **Regra de ouro:**
> Um conector **só pode ser considerado production-ready** quando:
>
> * ✅ **100% dos Critérios de Aceite** estiverem atendidos
> * ✅ **100% deste Go/No-Go** estiverem atendidos
>
> Qualquer item **NO-GO** bloqueia promoção para produção.

---

## 1) Infraestrutura & Boot (Hard Gate)

### 1.1 Fail-Closed obrigatório

* [ ] Em `staging` e `production`, o serviço **não sobe** sem todos os requisitos críticos:

  * secrets obrigatórios
  * dedupe store distribuído
  * credenciais do provider válidas
* [ ] Não existe fallback silencioso em staging/prod.

**Evidência mínima**

* Log explícito de boot validado
* Deploy falha quando secret é removida propositalmente

👉 **Se falhar aqui: NO-GO**

---

### 1.2 Secrets & credenciais

* [ ] 100% das credenciais vêm de **Secret Manager / Vault**
* [ ] Nenhum secret em:

  * env vars hardcoded
  * arquivos `.env`
  * logs
  * exceptions
* [ ] Rotação manual de pelo menos **1 secret** testada em staging

👉 **Se falhar aqui: NO-GO**

---

### 1.3 Runtime versionado e reproduzível

* [ ] Dockerfile alinhado com:

  * Node / runtime suportado no monorepo
  * engines do `package.json`
* [ ] Build reproduzível (mesmo commit → mesma imagem)
* [ ] Build/lint/test **PASS** no monorepo inteiro

👉 **Se falhar aqui: NO-GO**

---

## 2) Inbound (Entrada de eventos)

### 2.1 Verificação e autenticação

* [ ] Endpoint de verificação (ex.: webhook GET) validado em staging
* [ ] Requests sem assinatura / token válido são rejeitados
* [ ] Assinatura inválida nunca chega ao runtime

👉 **Se falhar aqui: NO-GO**

---

### 2.2 Reentrega e retries reais

* [ ] O **mesmo evento inbound** reenviado:

  * não gera duplicação de efeitos
  * não quebra o fluxo
* [ ] Dedupe comprovadamente funcional em staging

**Evidência mínima**

* Reenvio manual do payload
* Logs mostrando `deduped=true`

👉 **Se falhar aqui: NO-GO**

---

## 3) Outbound & Side-Effects (O ponto mais crítico)

> **Regra absoluta:**
> Nenhum conector vai para produção sem side-effects testados **em staging com tráfego real**.

### 3.1 Dedupe antes do efeito externo

* [ ] Dedupe ocorre **antes** da chamada HTTP ao provider
* [ ] Retry, timeout ou crash **não geram duplicação**
* [ ] `intentId` / `idempotencyKey` é estável

👉 **Se falhar aqui: NO-GO IMEDIATO**

---

### 3.2 Funcionalidades “principais” comprovadas

Para cada canal, listar **explicitamente** as funcionalidades suportadas.

Exemplo WhatsApp:

* [ ] text
* [ ] template (uso real)
* [ ] audio
* [ ] document
* [ ] contacts
* [ ] reactions
* [ ] mark_read

Exemplo Instagram:

* [ ] DM inbound
* [ ] DM outbound
* [ ] comment_reply

**Regras**

* Não vale fixture inventada
* Não vale “deve funcionar”
* **Só vale tráfego real em staging**

👉 **Se qualquer principal não for testada: NO-GO**

---

### 3.3 Timeout, retry e erro do provider

* [ ] Timeout simulado
* [ ] Erro 4xx e 5xx reais tratados
* [ ] Erro do provider **não vaza payload nem secret**
* [ ] Retry não gera duplicação

👉 **Se falhar aqui: NO-GO**

---

## 4) Observabilidade & Operação

### 4.1 Logs estruturados e úteis

* [ ] Logs incluem:

  * correlationId
  * dedupeKey
  * connectorId
  * capabilityId
  * outcome (sent / deduped / failed)
* [ ] Logs **não** incluem:

  * payload raw
  * tokens
  * números completos (PII)

👉 **Se falhar aqui: NO-GO**

---

### 4.2 Diagnóstico rápido

* [ ] É possível responder em < 5 minutos:

  * “Por que isso falhou?”
  * “Duplicou?”
  * “Foi retry?”
* [ ] Logs permitem diferenciar:

  * erro de infra
  * erro de provider
  * erro de payload

👉 **Se falhar aqui: NO-GO**

---

## 5) Staging como espelho de produção

### 5.1 Paridade estrutural

* [ ] Mesma infra (Cloud Run / Workers / etc.)
* [ ] Mesmo tipo de Redis / KV / store
* [ ] Mesma política de dedupe
* [ ] Mesmas variáveis obrigatórias

👉 **Se falhar aqui: NO-GO**

---

### 5.2 Rollback testado

* [ ] Pelo menos **1 rollback** feito em staging
* [ ] Versão anterior sobe e funciona
* [ ] Não exige hotfix manual

👉 **Se falhar aqui: NO-GO**

---

## 6) Gate final de promoção

### 6.1 Checklist final

* [ ] Critérios de Aceite: **100% OK**
* [ ] Go/No-Go: **100% OK**
* [ ] Tráfego real validado
* [ ] Side-effects deduplicados
* [ ] Operação consegue diagnosticar falhas

➡️ **GO PARA PRODUÇÃO**

---

## 7) Uso prático deste documento

### Regra organizacional

* Este documento **não é opinativo**
* Não existe “quase pronto”
* Não existe “vamos corrigir em produção”

### Antipadrões explícitos (proibidos)

* “Funciona no teste”
* “O provider deve aceitar”
* “Nunca aconteceu antes”
* “Vamos monitorar depois”

---

## 8) Resultado estratégico

Seguindo esse Go/No-Go:

* staging vira **laboratório de falhas reais**
* produção vira **ambiente previsível**
* conectores deixam de ser “código frágil” e viram **infra confiável**
