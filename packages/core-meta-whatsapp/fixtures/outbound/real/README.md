# Fixtures Outbound Reais

Fixtures capturados de envios reais via staging Meta WhatsApp Business API.

## ✅ Fixtures Suportados (W1 Real Staging)

**Nota:** Este diretório contém fixtures de tipos **confirmadamente suportados** pelo Cloud API.

| Tipo | Status | Observações |
|------|--------|-------------|
| `text.json` | ✅ Suportado | Texto simples |
| `audio.json` | ✅ Suportado | Voice note (Opus) via `mediaId` (upload Graph) |
| `image.json` | ✅ Suportado | JPEG/PNG via `mediaId` com caption |
| `video.json` | ✅ Suportado | MP4/H.264 via `mediaId` com caption |
| `document.json` | ✅ Suportado | PDF/Word/Excel via `mediaId` com filename |
| `sticker.json` | ✅ Suportado | WebP sticker via `mediaId` |
| `contacts.json` | ✅ Suportado | vCard format (2+ contacts) |
| `location_fixed.json` | ✅ Suportado | Localização fixa (abre mapa) |
| `reaction.json` | ✅ Suportado | Emoji reaction a mensagem anterior |
| `template.json` | ✅ Suportado | Template "hello_world" (pode falhar se não existe em WABA) |
| `mark_read.json` | ℹ️ Informacional | Read receipt (invisível ao usuário; sem response esperada) |

**Tipos Removidos (Não Suportados):**
- ❌ `location_live.json` — Cloud API não suporta outbound live_location
- ❌ `location_request.json` — Requer janela de conversa 24h + permissões WABA

## ✅ Como rodar (captura real)

```bash
chmod +x scripts/w1-capture-fixtures-v2.sh

STAGING_URL="https://whatsapp-connector-staging-693285708638.us-central1.run.app" \
STAGING_TOKEN="$(gcloud secrets versions access latest --secret=staging-outbound-token-staging)" \
GRAPH_TOKEN="$(gcloud secrets versions access latest --secret=whatsapp-access-token-staging)" \
PHONE_NUMBER_ID="$(gcloud secrets versions access latest --secret=whatsapp-phone-number-id-staging)" \
PHONE_TO="+5541988991078" \
./scripts/w1-capture-fixtures-v2.sh --url "$STAGING_URL" --token "$STAGING_TOKEN" \
  --graph-token "$GRAPH_TOKEN" --phone-number-id "$PHONE_NUMBER_ID" --phone-to "$PHONE_TO"
```

Pré-requisitos: `curl`, `jq`, `ffmpeg` instalados; `gcloud` autenticado no projeto `connectors-484919`.
Mídias geradas on-the-fly (ffmpeg) e enviadas via Upload Media API para obter `mediaId`.

## ✅ Audio: Validado com MediaId

O fixture `audio.json` foi capturado usando o método correto:
1. Upload de arquivo OGG Opus (mono, 16kHz) via Meta Media API
2. Obtenção do `mediaId` retornado
3. Envio usando `mediaId` (não `mediaUrl`)

**Resultado:** Áudio recebido como mensagem de voz nativa no WhatsApp (ícone de microfone)

**Para produção:**
1. Upload via Upload Media API (Graph) com `messaging_product=whatsapp`
2. Usar o `mediaId` retornado no payload:
  ```typescript
  { type: 'audio', mediaId: '<graph-media-id>' }
  ```

**Conversão recomendada (ffmpeg):**
```bash
ffmpeg -i input.mp3 -c:a libopus -b:a 16k -vbr on -ar 16000 output.ogg
```

## 🖼️ Image: mediaId

Captura com upload real (JPEG gerado via ffmpeg):
1. Upload via Graph → recebe `mediaId`
2. Envio com payload `{ type: 'image', mediaId, caption }`

Formatos suportados: `image/jpeg`, `image/png`; máx 10 MB.

## 📍 Location (Localização Fixa)

- **Suportado:** Localização fixa com payload `{ type: 'location', latitude, longitude, name?, address? }` abre mapa no WhatsApp.
- **Não Suportado:** 
  - **Live location (outbound):** Cloud API não permite que empresas enviem localização em tempo real; feature desativada.
  - **Location request (interactive):** Requer janela de 24h de conversa ativa + permissões WABA específicas; não funciona como outbound standalone.

## 📊 Dados de Captura

- **Data:** 22/01/2026
- **Ambiente:** Staging (Cloud Run Rev. 00015-w9g)
- **API:** Meta WhatsApp Business Cloud API v19.0
- **Destino:** +5541988991078

## 🔒 Segurança & Sanitização

### Decisão sobre PII (Phone Numbers)

Este repositório é **privado**. Os números de telefone (destino/origem) são mantidos nos fixtures pelos seguintes motivos:

- Necessários para validar contratos (webhook recebe números reais)
- Fixtures sem números perdem significado (não representam flow real)
- Repositório privado minimiza risco de exposição

**Se este repositório virar público**, remover números usando script de sanitização.

### Policies Aplicados

Todos os fixtures foram verificados:
- ✅ **Nenhum token de acesso** (Bearer, EAA, etc.)
- ✅ **Nenhuma credencial Graph** (X-Staging-Token, access_token)
- ✅ **Message IDs reais preservados** (wamid.* para auditoria)
- ✅ **Estruturas de resposta completas** (contratos congelados)

**Verificação:**
```bash
rg -n "(EAA|Bearer |access_token|X-Staging-Token)" fixtures/outbound/real/
# Resultado: nenhuma match (✓ seguro)
```
