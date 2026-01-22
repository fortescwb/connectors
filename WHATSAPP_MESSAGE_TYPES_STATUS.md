# 📊 WhatsApp Message Types - Status Report

**Data**: 22 de janeiro de 2026  
**Projeto**: Connectors - WhatsApp Outbound  
**Recipient**: +5541988991078 (24h window)  
**Staging URL**: https://whatsapp-connector-staging-otr7m7leza-uc.a.run.app

---

## ✅ Message Types Working (7/11)

| Tipo | Status | Fixture | Método | Observação |
|------|--------|---------|--------|------------|
| **Texto** | ✅ FUNCIONA | `text.json` | `mediaUrl` N/A | Enviado com sucesso |
| **Foto/Imagem** | ✅ FUNCIONA | `image.json` | `mediaUrl` | Enviado com sucesso |
| **Áudio** | ✅ FUNCIONA | `audio.json` | `mediaUrl` | Enviado com sucesso |
| **Localização Fixa** | ✅ FUNCIONA | `location_fixed.json` | Coordenadas | Enviado com sucesso |
| **Contatos** | ✅ FUNCIONA | `contacts.json` | 2+ contatos | Requer múltiplos contatos (2+) |
| **Reação** | ✅ FUNCIONA | `reaction.json` | messageId + emoji | Enviado com sucesso |
| **Template** | ✅ FUNCIONA | `template.json` | `hello_world` | Message status: "accepted" |

---

## ❌ Message Types NOT Working (4/11)

| Tipo | Status | Erro | Problema | Solução |
|------|--------|------|----------|---------|
| **Vídeo** | ❌ FALHA | `(#*00) Param video['id'] is not a valid whatsapp business account media attachment ID` | mediaId fake não funciona | **Requer upload prévio de mídia válida** |
| **Documento** | ❌ FALHA | `(#*00) Param document['id'] is not a valid whatsapp business account media attachment ID` | mediaId fake não funciona | **Requer upload prévio de mídia válida** |
| **Sticker** | ❌ FALHA | `(#*00) Param sticker['id'] is not a valid whatsapp business account media attachment ID` | mediaId fake não funciona | **Requer upload prévio de mídia válida** |
| **Mark Read** | ❌ FALHA | `(#*00) Invalid parameter` | messageId inválido ou limitação Meta | **Pode ser limitação de permissões** |

---

## 📝 Test Scripts

### 1. **test-whatsapp-outbound.sh** (Tipos básicos + reação + template)
```bash
bash test-whatsapp-outbound.sh
```
**Testa**: Texto, Foto, Áudio, Video*, Documento*, Localização, Sticker*, Contatos, Reação, Mark Read*, Template
*_Falhará se mediaId for fake_

**Resultado Esperado**:
- 7 testes: ✅ SENT
- 3 testes: ❌ FAILED (video, document, sticker com mediaId fake)
- 1 teste: ❌ FAILED (mark_read com messageId fake)

### 2. **test-whatsapp-media-upload.sh** (Com upload de mídia real)
```bash
export WHATSAPP_ACCESS_TOKEN="<seu_token>"
export WHATSAPP_PHONE_NUMBER_ID="<seu_phone_id>"
bash test-whatsapp-media-upload.sh
```
**Testa**: Video, Documento, Sticker com mediaIds reais (após upload)  
**Requer**: Credenciais Meta válidas

---

## 🔍 Análise por Tipo

### ✅ Texto
- **Payload**: `{ "type": "text", "text": "..." }`
- **Status**: ✅ Funciona perfeitamente
- **Latência**: ~700ms

### ✅ Foto/Imagem
- **Payload**: `{ "type": "image", "mediaUrl": "...", "caption": "..." }`
- **Status**: ✅ Funciona com mediaUrl público
- **Latência**: ~700ms
- **Nota**: Aceita URL pública direto

### ✅ Áudio
- **Payload**: `{ "type": "audio", "mediaUrl": "..." }`
- **Status**: ✅ Funciona com mediaUrl público
- **Latência**: ~700ms
- **Nota**: Aceita URL pública direto

### ❌ Vídeo
- **Payload**: `{ "type": "video", "mediaId": "...", "caption": "..." }`
- **Status**: ❌ Falha com mediaId fake
- **Requerimento**: **Deve ser mediaId válido** (após upload Graph API)
- **Limite**: Max 16 MB
- **Latência Esperada**: ~900ms

### ❌ Documento
- **Payload**: `{ "type": "document", "mediaId": "...", "filename": "...", "caption": "..." }`
- **Status**: ❌ Falha com mediaId fake
- **Requerimento**: **Deve ser mediaId válido** (após upload Graph API)
- **Formatos**: PDF, Word, Excel, etc.
- **Latência Esperada**: ~700ms

### ✅ Localização Fixa
- **Payload**: `{ "type": "location", "latitude": -23.5505, "longitude": -46.6333, "name": "...", "address": "..." }`
- **Status**: ✅ Funciona perfeitamente
- **Latência**: ~690ms

### ❌ Sticker
- **Payload**: `{ "type": "sticker", "mediaId": "..." }`
- **Status**: ❌ Falha com mediaId fake
- **Requerimento**: **Deve ser mediaId válido** (após upload Graph API)
- **Formato**: WebP recomendado
- **Latência Esperada**: ~700ms

### ✅ Contatos
- **Payload**: `{ "type": "contacts", "contacts": [{ "name": {...}, "phones": [...], "emails": [...] }, ...] }`
- **Status**: ✅ Funciona com 2+ contatos
- **Requerimento**: **Mínimo 2 contatos** (Fixture real usou 2)
- **Latência**: ~685ms
- **Nota**: Com 1 contato falha. Com 2+ funciona!

### ✅ Reação
- **Payload**: `{ "type": "reaction", "messageId": "...", "emoji": "..." }`
- **Status**: ✅ Funciona com messageId válido
- **Latência**: ~765ms
- **Nota**: messageId deve ser válido do histórico de mensagens

### ❌ Mark Read
- **Payload**: `{ "type": "mark_read", "messageId": "..." }`
- **Status**: ❌ Falha mesmo com fixture real
- **Erro**: "(#*00) Invalid parameter"
- **Possível Causa**: Pode ser limitação de permissões ou versão API

### ✅ Template
- **Payload**: `{ "type": "template", "templateName": "hello_world", "languageCode": "en_US" }`
- **Status**: ✅ Funciona com template aprovado
- **Message Status**: "accepted" (enviada para fila de processamento)
- **Latência**: ~1135ms
- **Nota**: Requer template pré-aprovado no Meta Business Manager

---

## 📋 Resumo por Categoria

### Media Types (precisam de upload Graph API)
- ❌ Video - mediaId fake falha
- ❌ Document - mediaId fake falha  
- ❌ Sticker - mediaId fake falha
- ✅ Image - aceita mediaUrl público (não requer upload)
- ✅ Audio - aceita mediaUrl público (não requer upload)

### Interaction Types (precisam de messageId válido)
- ✅ Reaction - funciona com messageId válido
- ❌ Mark Read - falha mesmo com estrutura correta

### Other Types
- ✅ Text - sempre funciona
- ✅ Location - sempre funciona
- ✅ Contacts - funciona com 2+ contatos
- ✅ Template - funciona com template aprovado

---

## 🎯 Próximos Passos

### 1. **Para Vídeo, Documento, Sticker funcionar**:
   - [ ] Usar script de upload de mídia (`test-whatsapp-media-upload.sh`)
   - [ ] Fornecer credenciais Meta (ACCESS_TOKEN + PHONE_NUMBER_ID)
   - [ ] Fazer upload de arquivo real e capturar mediaId
   - [ ] Usar mediaId na chamada de outbound

### 2. **Para Mark Read funcionar**:
   - [ ] Verificar permissões na conta Meta
   - [ ] Validar se é restrição de versão API
   - [ ] Contatar suporte Meta se necessário

### 3. **Para testes em produção**:
   - [ ] Usar fixtures reais (já existem em `packages/core-meta-whatsapp/fixtures/outbound/real/`)
   - [ ] Script de captura: `scripts/w1-capture-fixtures-v2.sh`

---

## 📊 Matriz de Suporte

```
TIPO              | FUNCIONA | MEDIAID/UPLOAD | VALIDADO
─────────────────┼──────────┼────────────────┼──────────
Texto             | ✅       | N/A            | ✅
Foto              | ✅       | mediaUrl só    | ✅
Áudio             | ✅       | mediaUrl só    | ✅
Localização       | ✅       | N/A (coords)   | ✅
Contatos          | ✅       | N/A (structs)  | ✅ (2+)
Reação            | ✅       | messageId      | ✅
Template          | ✅       | N/A (approved) | ✅
─────────────────┼──────────┼────────────────┼──────────
Vídeo             | ❌       | mediaId upload | ⏳ (precisa upload)
Documento         | ❌       | mediaId upload | ⏳ (precisa upload)
Sticker           | ❌       | mediaId upload | ⏳ (precisa upload)
Mark Read         | ❌       | messageId      | ❌ (erro Meta)
─────────────────┴──────────┴────────────────┴──────────
```

---

## 🚀 Recomendações

1. **Para MVP/Produção**: Use os 7 tipos que funcionam (Texto, Foto, Áudio, Localização, Contatos, Reação, Template)

2. **Para Media Types**: Implemente fluxo de upload prévio à Graph API

3. **Para Mark Read**: Confirme com Meta se é restrição de permissões

4. **Documentação**: Todos os tipos estão documentados em:
   - Schema: `packages/core-messaging/src/outbound/OutboundMessageIntent.ts`
   - Builders: `packages/core-meta-whatsapp/src/sendMessage.ts`
   - Tests: `packages/core-meta-whatsapp/tests/sendMessage.test.ts`
   - Fixtures Reais: `packages/core-meta-whatsapp/fixtures/outbound/real/`

