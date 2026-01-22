# WhatsApp Video Requirements - Especificações Técnicas

**Data:** 22 de janeiro de 2026  
**Fonte:** Meta WhatsApp Business Cloud API Documentation

## 📹 Formatos e Codecs Suportados

### Formato Recomendado
- **Container:** `.mp4` (recomendado) ou `.3gp`
- **Codec de Vídeo:** H.264
- **Codec de Áudio:** AAC
- **Perfil:** Main ou Baseline (evitar High com B-frames)

### Motivo do Perfil
O perfil "High" com B-frames pode causar problemas de compatibilidade em dispositivos Android mais antigos. Os perfis "Main" ou "Baseline" garantem melhor compatibilidade.

## 📏 Tamanho e Limites

### Limites de Tamanho
- **Padrão:** 16 MB (limite seguro e compatível)
- **Cloud API:** Até 100 MB (em alguns cenários)
- **Recomendação:** Manter abaixo de 16 MB para evitar falhas

### Duração
- **Recomendado:** Menos de 3 minutos
- **Motivo:** Arquivos muito longos podem exceder o limite de tamanho ou causar timeout no upload

## 🔧 Otimização com FFmpeg

### Comando Recomendado
```bash
ffmpeg -i video_original.mp4 \
  -c:v libx264 \
  -profile:v main \
  -pix_fmt yuv420p \
  -movflags faststart \
  -c:a aac \
  -f mp4 \
  video_final.mp4
```

### Explicação dos Parâmetros
- `-c:v libx264`: Codec de vídeo H.264
- `-profile:v main`: Perfil Main (compatibilidade)
- `-pix_fmt yuv420p`: Formato de pixel compatível
- `-movflags faststart`: **CRUCIAL** - permite reprodução antes do download completo
- `-c:a aac`: Codec de áudio AAC
- `-f mp4`: Formato de saída MP4

### Importância do `faststart`
O flag `-movflags faststart` move os metadados do vídeo para o início do arquivo, permitindo que:
1. O vídeo comece a reproduzir imediatamente
2. Não seja necessário baixar o arquivo completo primeiro
3. A experiência do usuário seja melhor

## 📤 Métodos de Envio

### 1. Por ID de Mídia (Recomendado - Implementado no Connector)
```javascript
// Passo 1: Upload do vídeo
POST /<PHONE_NUMBER_ID>/media
Content-Type: multipart/form-data

messaging_product: whatsapp
file: <video_binary>
type: video/mp4

// Resposta
{
  "id": "MEDIA_ID_123456"
}

// Passo 2: Envio da mensagem
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "5541988991078",
  "type": "video",
  "video": {
    "id": "MEDIA_ID_123456",
    "caption": "Legenda do vídeo (opcional)"
  }
}
```

### 2. Por URL (Link Público)
```javascript
{
  "messaging_product": "whatsapp",
  "to": "5541988991078",
  "type": "video",
  "video": {
    "link": "https://exemplo.com/video.mp4",
    "caption": "Legenda do vídeo"
  }
}
```

**⚠️ Requisitos para URL:**
- URL deve ser pública e acessível
- HTTPS obrigatório (não aceita HTTP)
- Servidor deve responder rapidamente (< 5s)
- Headers corretos (Content-Type: video/mp4)

## 🚀 Como o Connector Funciona

### Auto-Upload Implementado
O WhatsApp Connector implementa **auto-upload automático**:

1. **Interface envia:** `{ type: "video", mediaUrl: "https://..." }`
2. **Connector detecta:** `mediaUrl` sem `mediaId`
3. **Download:** Baixa o vídeo da URL (timeout: 60s)
4. **Upload:** Envia para Meta Graph API com FormData correto:
   ```
   messaging_product: whatsapp
   file: <video_binary>
   type: video/mp4
   ```
5. **Extrai mediaId:** Obtém o ID retornado pela API
6. **Envia mensagem:** Usa o `mediaId` para enviar a mensagem

### Timeouts Configurados
- **Download:** 60 segundos (vídeos podem ser grandes)
- **Upload:** 30 segundos (configurável via `timeoutMs`)
- **Total:** Até 90 segundos para vídeos

## ❌ Problemas Comuns

### 1. "not a valid whatsapp business account media attachment ID"
**Causa:** Tentando enviar com `mediaId` inválido ou sem fazer upload primeiro  
**Solução:** Usar auto-upload (enviar `mediaUrl` em vez de `mediaId`)

### 2. "This operation was aborted" / Timeout
**Causa:** Vídeo muito grande ou URL lenta demais  
**Solução:** 
- Otimizar vídeo com FFmpeg (reduzir tamanho)
- Usar URL mais rápida
- Aumentar `timeoutMs` na configuração

### 3. "The parameter messaging_product is required"
**Causa:** FormData incompleto no upload  
**Solução:** ✅ JÁ CORRIGIDO no connector (v0.3.1)

### 4. "Invalid parameter" ou codec não suportado
**Causa:** Vídeo em formato incompatível  
**Solução:** Converter com FFmpeg usando os parâmetros recomendados

### 5. Vídeo maior que 16 MB
**Causa:** Arquivo excede o limite seguro  
**Solução:** 
- Reduzir qualidade/duração com FFmpeg
- OU enviar como documento em vez de vídeo

## 📊 Métricas de Performance

### Latências Típicas
| Tamanho do Vídeo | Latência Esperada |
|------------------|-------------------|
| < 1 MB | 3-5 segundos |
| 1-5 MB | 5-15 segundos |
| 5-10 MB | 15-30 segundos |
| 10-16 MB | 30-60 segundos |

### Composição da Latência
1. **Download da URL:** 40-80% do tempo
2. **Upload para Meta:** 10-30% do tempo
3. **Processamento Meta:** 5-10% do tempo
4. **Envio da mensagem:** < 5% do tempo

## ✅ Checklist de Validação

Antes de enviar um vídeo para produção, verificar:

- [ ] Formato: MP4 com H.264 + AAC
- [ ] Perfil: Main ou Baseline (não High)
- [ ] Tamanho: < 16 MB
- [ ] Duração: < 3 minutos
- [ ] Flag faststart: Presente (verificar com `ffmpeg -i video.mp4`)
- [ ] URL: Pública, HTTPS, acessível rapidamente
- [ ] Teste: Envio bem-sucedido no ambiente de staging

## 🔍 Verificação de Vídeo

### Verificar Metadados
```bash
ffmpeg -i video.mp4
```

Procurar por:
```
Video: h264 (Main) ...  // Confirma H.264 e perfil Main
Audio: aac ...          // Confirma AAC
```

### Verificar Flag Faststart
```bash
ffmpeg -i video.mp4 2>&1 | grep "major_brand"
```

Se aparecer `isom` ou `mp42`, o faststart está ativado.

## 📝 Exemplo de Conversão Completa

```bash
# 1. Verificar vídeo original
ffmpeg -i original.mov

# 2. Converter para formato WhatsApp
ffmpeg -i original.mov \
  -c:v libx264 \
  -profile:v main \
  -level 3.1 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  -c:a aac \
  -b:a 128k \
  -ar 44100 \
  -f mp4 \
  whatsapp_video.mp4

# 3. Verificar tamanho
ls -lh whatsapp_video.mp4

# 4. Verificar duração e formato
ffprobe whatsapp_video.mp4

# 5. Se > 16 MB, reduzir qualidade
ffmpeg -i whatsapp_video.mp4 \
  -c:v libx264 \
  -profile:v main \
  -crf 28 \
  -preset medium \
  -movflags +faststart \
  -c:a aac \
  -b:a 96k \
  -f mp4 \
  whatsapp_video_compressed.mp4
```

### Parâmetros de Compressão
- **CRF:** 18 (alta qualidade) a 28 (menor tamanho)
- **Preset:** ultrafast, fast, medium, slow (medium recomendado)
- **Bitrate áudio:** 96k (suficiente para voz), 128k (música)

## 🎯 Recomendações Finais

### Para Produção
1. ✅ Sempre converter vídeos com FFmpeg antes de enviar
2. ✅ Manter abaixo de 16 MB
3. ✅ Usar auto-upload do connector (enviar `mediaUrl`)
4. ✅ Hospedar vídeos em CDN rápida (CloudFront, Cloud Storage, etc.)
5. ✅ Testar em staging antes de produção

### Para Desenvolvedores
1. ✅ Nunca enviar `mediaId` fake - sempre usar auto-upload
2. ✅ Configurar timeout adequado para vídeos (60s+)
3. ✅ Adicionar logging detalhado para debug
4. ✅ Implementar retry com exponential backoff
5. ✅ Monitorar latências e taxa de sucesso

## 📚 Referências

- [WhatsApp Business Cloud API - Media Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media)
- [FFmpeg H.264 Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/H.264)
- [WhatsApp Business API - Best Practices](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages)

---

**Última Atualização:** 22/01/2026  
**Versão do Connector:** 0.3.1  
**Status:** ✅ Auto-upload implementado e corrigido
