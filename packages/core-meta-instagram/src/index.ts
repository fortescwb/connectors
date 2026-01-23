export { parseInstagramRuntimeRequest, parseInstagramWebhookPayload } from './inbound/parseWebhook.js';
export { InstagramWebhookSchema, type InstagramWebhookBody } from './inbound/schemas.js';
export { buildInstagramMessagePayload } from './outbound/buildPayload.js';
export { buildInstagramOutboundRequest } from './outbound/buildOutboundRequest.js';
export {
  sendInstagramMessage,
  processInstagramOutbound,
  type InstagramSendMessageConfig,
  type InstagramSendMessageResult,
  type InstagramOutboundBatchOptions
} from './outbound/sendMessage.js';
export { createInstagramGraphClient, uploadAttachmentFromUrl } from './client.js';
export {
  buildInstagramInboundDedupeKey,
  buildInstagramOutboundDedupeKey,
  buildInstagramOutboundDmDedupeKey
} from './dedupe.js';

export {
  sendCommentReplyBatch,
  type SendCommentReplyBatchOptions,
  type SendCommentReplyResult
} from './replyClient.js';
export { CommentReplyCommandSchema } from '@connectors/core-comments';
