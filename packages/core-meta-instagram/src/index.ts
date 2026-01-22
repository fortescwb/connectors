export {
  InstagramWebhookSchema,
  parseInstagramRuntimeRequest,
  parseInstagramWebhookPayload,
  type InstagramWebhookBody
} from './inbound/parseWebhook.js';
export { buildInstagramMessagePayload } from './outbound/buildPayload.js';
export {
  sendInstagramMessage,
  processInstagramOutbound,
  type InstagramSendMessageConfig,
  type InstagramSendMessageResult,
  type InstagramOutboundBatchOptions
} from './outbound/sendMessage.js';
export { createInstagramGraphClient, uploadAttachmentFromUrl } from './client.js';
export { buildInstagramInboundDedupeKey, buildInstagramOutboundDedupeKey } from './dedupe.js';

export {
  sendCommentReplyBatch,
  type SendCommentReplyBatchOptions,
  type SendCommentReplyResult
} from './replyClient.js';
export { CommentReplyCommandSchema } from '@connectors/core-comments';
