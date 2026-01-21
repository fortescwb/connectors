# Fixtures Outbound Reais

Fixtures capturados de envios reais via staging Meta WhatsApp Business API.

## ✅ Fixtures Validados

| Tipo | Status | Observações |
|------|--------|-------------|
| `text.json` | ✅ Enviado e recebido | Mensagem de texto simples |
| `document.json` | ✅ Enviado e recebido | PDF anexado corretamente |
| `contacts.json` | ✅ Enviado e recebido | 2 vCards compartilhados |
| `reaction.json` | ✅ Enviado e recebido | Emoji 👍 reagido a mensagem |
| `mark_read.json` | ✅ Enviado | Marcação de leitura (invisível ao usuário) |
| `template.json` | ⚠️ Falhou | Template "hello_world" não existe na conta |
| `audio.json` | ✅ Enviado e recebido | Mensagem de voz via mediaId (ver abaixo) |

## ✅ Audio: Validado com MediaId

O fixture `audio.json` foi capturado usando o método correto:
1. Upload de arquivo OGG Opus (mono, 16kHz) via Meta Media API
2. Obtenção do `mediaId` retornado
3. Envio usando `mediaId` (não `mediaUrl`)

**Resultado:** Áudio recebido como mensagem de voz nativa no WhatsApp (ícone de microfone)

**Para produção:**
1. Fazer upload do arquivo de áudio via [Upload Media API](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#upload-media)
2. Obter o `media_id` retornado
3. Usar `mediaId` no payload ao invés de `mediaUrl`:
   ```typescript
   {
     type: "audio",
     mediaId: "123456789" // ID retornado pela Upload API
   }
   ```

**Conversão recomendada (ffmpeg):**
```bash
ffmpeg -i input.mp3 -c:a libopus -b:a 16k -vbr on -ar 16000 output.ogg
```

## 📊 Dados de Captura

- **Data:** 21/01/2026
- **Origem:** +554284027199 (Meta WABA)
- **Destino:** +5541988991078
- **Ambiente:** Staging (Cloud Run)
- **API:** Meta WhatsApp Business Cloud API

## 🔒 Sanitização

Todos os fixtures foram sanitizados:
- ✅ Nenhum phone number completo exposto
- ✅ Nenhum token de acesso
- ✅ Message IDs reais preservados (wamid.*)
- ✅ Estruturas de resposta completas da API
