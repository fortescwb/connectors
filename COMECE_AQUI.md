# ▶️ COMECE AQUI — 5 Passos para Iniciar W1-W5

**Leia isto primeiro. Tudo começa daqui.**

---

## 🎯 O Objetivo

Levar WhatsApp Outbound de 🟡 ACTIVE (código-pronto) para:
1. ✅ Fixtures reais capturados (W1)
2. ✅ Staging validado (W2)
3. ✅ Status atualizado 🟢 REAL (W3)
4. ✅ Go/No-Go aprovado (W4)
5. ✅ Produção pronta (W5)

**Tempo total:** 5-8 dias

---

## 📋 Seu Checklist Pessoal

### Antes de Começar

- [x] Você tem acesso ao staging Cloud Run
- [x] Você tem `STAGING_OUTBOUND_TOKEN` definido em Secret Manager
- [x] Você tem `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` em Secret Manager
- [x] O número +554284027199 está cadastrado na WABA
- [x] Webhook da Meta está conectado no staging
- [x] Você pode fazer curl/http requests para o staging
- [x] Você tem git access para commitar mudanças

**Falta algo?** Peça ao seu tech lead antes de continuar.

---

## 🚀 5 Passos para Começar W1

### Passo 1: Clone/Acesse o Repositório

```bash
cd /home/fortes/Repositórios/connectors
```

### Passo 2: Defina as Credenciais

```bash
# Obter valores de Secret Manager ou .env
export STAGING_URL="https://seu-staging-cloud-run-url.run.app"
export STAGING_TOKEN="seu-staging-outbound-token-aqui"
export PHONE_TO="+554284027199"

# Verificar que não está vazio
echo "URL: $STAGING_URL"
echo "Token: ${STAGING_TOKEN:0:10}***"
echo "Phone: $PHONE_TO"
```

### Passo 3: Prepare o Script

```bash
# Dar permissão de execução
chmod +x scripts/w1-capture-fixtures.sh

# Verificar que existe
ls -l scripts/w1-capture-fixtures.sh
```

### Passo 4: Execute W1

```bash
# Navegar para root do projeto
cd /home/fortes/Repositórios/connectors

# Rodar captura
./scripts/w1-capture-fixtures.sh \
  --url "$STAGING_URL" \
  --token "$STAGING_TOKEN" \
  --phone-to "$PHONE_TO"

# Será levado 5-10 minutos
```

### Passo 5: Valide o Resultado

```bash
# Verificar que 7 fixtures foram criados
ls -lh packages/core-meta-whatsapp/fixtures/outbound/real/

# Esperado:
# text.json
# audio.json
# document.json
# contacts.json
# reaction.json
# template.json
# mark_read.json

# Verificar que JSON é válido
jq '.' packages/core-meta-whatsapp/fixtures/outbound/real/text.json
```

---

## ✅ Se W1 Funcionou

Você verá:
```
✓ Capturados: 7
✗ Falhados: 0
Fixtures em: packages/core-meta-whatsapp/fixtures/outbound/real
✓ W1 COMPLETO — Pronto para W2
```

**Próximo:** Vá para [W2_VALIDACAO_OPERACIONAL.md](./W2_VALIDACAO_OPERACIONAL.md)

---

## ❌ Se W1 Falhou

### Erro: "curl: command not found"
**Solução:** Instalar curl
```bash
# No Linux
sudo apt-get install curl

# No macOS
brew install curl
```

### Erro: "jq: command not found"
**Solução:** Instalar jq
```bash
# No Linux
sudo apt-get install jq

# No macOS
brew install jq
```

### Erro: "Invalid staging token"
**Verificar:**
```bash
# Token está correto?
echo $STAGING_TOKEN

# Revisar em Secret Manager
gcloud secrets versions access latest --secret="STAGING_OUTBOUND_TOKEN"
```

### Erro: "Phone number not registered"
**Verificar:**
- Ir ao Meta Business Manager
- Confirmar que +554284027199 está em WABA
- Confirmar que foi adicionado ao app WhatsApp

### Erro: "Connection refused"
**Verificar:**
- URL é correta?
- Staging está UP?
```bash
curl -s $STAGING_URL/health
# Deve retornar JSON com status
```

### Erro: "fixtures/outbound/real não existe"
**Solução:** Script criará o diretório automaticamente, mas se não funcionar:
```bash
mkdir -p packages/core-meta-whatsapp/fixtures/outbound/real
```

---

## 📚 Documentação de Referência

| Se você quiser... | Leia... |
|------|---------|
| Entender o plano completo | [W1-W5_PLANO_EXECUCAO.md](./W1-W5_PLANO_EXECUCAO.md) |
| Entender arquitetura | [WHATSAPP_OUTBOUND_COMPLETE.md](./WHATSAPP_OUTBOUND_COMPLETE.md) |
| Executar W1 manualmente | [W1_CAPTURA_FIXTURES.md](./W1_CAPTURA_FIXTURES.md) |
| Entender W2 | [W2_VALIDACAO_OPERACIONAL.md](./W2_VALIDACAO_OPERACIONAL.md) |
| Ver exemplos de payloads | [FIXTURES_CAPTURE_GUIDE.md](./FIXTURES_CAPTURE_GUIDE.md) |
| Ver estado do código | [packages/core-meta-whatsapp/README.md](./packages/core-meta-whatsapp/README.md) |

---

## 🎓 O Que Esperar

### Durante W1 (captura)
- Script conectará ao staging
- Enviará 7 tipos diferentes de mensagens
- Capturará as respostas
- Sanitizará dados (sem phone real, sem tokens)
- Salvará em JSON

### Tempo
- ~1-2 minutos no total
- Maioria do tempo é network latency
- Log detalhado em `W1_CAPTURE_*.log`

### Saída
- 7 arquivos JSON
- 1 arquivo de log
- 1 arquivo de validação

---

## 🎯 Sucesso = W1 Completo

✅ Quando ver isto, W1 está COMPLETO:

```
✓ TEXT MESSAGE capturado → ./fixtures/outbound/real/text.json
✓ AUDIO MESSAGE capturado → ./fixtures/outbound/real/audio.json
✓ DOCUMENT MESSAGE capturado → ./fixtures/outbound/real/document.json
✓ CONTACTS MESSAGE capturado → ./fixtures/outbound/real/contacts.json
✓ REACTION MESSAGE capturado → ./fixtures/outbound/real/reaction.json
✓ TEMPLATE MESSAGE capturado → ./fixtures/outbound/real/template.json
✓ MARK READ capturado → ./fixtures/outbound/real/mark_read.json

✓ W1 COMPLETO — Pronto para W2
```

---

## 🚨 Importante

### Não Modifique Fixtures Manualmente
Os fixtures capturados são dados **reais** do staging. Não edite manualmente.

Se encontrar PII (phone número real, token), o script já santiza automaticamente. Se não, abra issue.

### Teste em Staging, Não em Produção
W1-W5 são **TODOS** em staging. Nada vai para produção até W5 completo + W4 GO + sua aprovação explícita.

### Commit após W1
Após W1, você vai fazer:
```bash
git add packages/core-meta-whatsapp/fixtures/outbound/real/
git commit -m "W1: Capture real WhatsApp fixtures"
```

---

## 🔗 Próximo Passo

**Faça W1 agora:**

```bash
cd /home/fortes/Repositórios/connectors
./scripts/w1-capture-fixtures.sh \
  --url "$STAGING_URL" \
  --token "$STAGING_TOKEN" \
  --phone-to "$PHONE_TO"
```

**Depois, quando W1 terminar:** Leia [W2_VALIDACAO_OPERACIONAL.md](./W2_VALIDACAO_OPERACIONAL.md)

---

## ✅ W1 Fonte de Verdade: Tipos Suportados

**Depois que W1 completa, estes são os tipos confirmadamente suportados pelo Cloud API:**

### Suportados (10 tipos)
- `text` — Mensagens de texto
- `audio` — Voice notes (Opus, mono, 16kHz)
- `image` — JPEG/PNG com caption opcional
- `video` — MP4/H.264 com caption opcional
- `document` — PDF/Word/Excel com filename
- `sticker` — WebP stickers
- `contacts` — vCard (1+ contacts com phones/emails)
- `location` — Localização fixa (abre mapa no WhatsApp)
- `reaction` — Emoji reactions a mensagens
- `template` — Mensagens template pré-aprovadas

### Informacional (1)
- `mark_read` — Read receipts (invisível ao usuário)

### Não Suportados (Removidos)
- ❌ `location_live` — API não permite outbound live_location
- ❌ `location_request` — Requer conversa 24h + perms WABA

**Referência oficial:** [packages/core-meta-whatsapp/fixtures/outbound/real/README.md](packages/core-meta-whatsapp/fixtures/outbound/real/README.md)

---

## 💬 Precisa de Ajuda?

1. **Dúvida técnica?** → Consulte W1_CAPTURA_FIXTURES.md
2. **Script não funciona?** → Veja seção "Se W1 Falhou" acima
3. **Bloqueado?** → Abra uma issue no repositório
4. **Precisa urgente?** → Contacte seu tech lead

---

**🚀 Você está pronto. Vamos lá!**
