import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { TenantId } from '@connectors/core-tenant';
import { safeParseOrThrow } from '@connectors/core-validation';

export const EVENT_TYPES = {
  ConversationMessageReceived: 'ConversationMessageReceived',
  ConversationMessageStatusUpdated: 'ConversationMessageStatusUpdated',
  LeadCaptured: 'LeadCaptured',
  CommentReceived: 'CommentReceived',
  ConversationStateChanged: 'ConversationStateChanged',
  ChannelHealthStatusChanged: 'ChannelHealthStatusChanged'
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

const isoDateStringSchema = z.string().datetime();
const tenantIdSchema = z.string().min(1).transform((value) => value as TenantId);
const metadataSchema = z.record(z.unknown()).optional();

const baseEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  occurredAt: isoDateStringSchema,
  tenantId: tenantIdSchema,
  source: z.string().min(1),
  correlationId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  dedupeKey: z.string().min(1),
  meta: metadataSchema
});

const participantSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional()
});

const messageContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string().min(1)
  }),
  z.object({
    type: z.literal('image'),
    url: z.string().url(),
    caption: z.string().optional()
  }),
  z.object({
    type: z.literal('video'),
    url: z.string().url(),
    caption: z.string().optional()
  }),
  z.object({
    type: z.literal('audio'),
    url: z.string().url(),
    durationMs: z.number().int().nonnegative().optional()
  }),
  z.object({
    type: z.literal('document'),
    url: z.string().url(),
    filename: z.string().optional()
  })
]);

const conversationMessageReceivedPayloadSchema = z.object({
  channel: z.string().min(1),
  externalMessageId: z.string().min(1),
  conversationId: z.string().min(1),
  direction: z.enum(['inbound', 'outbound']),
  sender: participantSchema,
  recipient: participantSchema,
  content: messageContentSchema,
  receivedAt: isoDateStringSchema.optional(),
  metadata: metadataSchema
});

const conversationMessageStatusUpdatedPayloadSchema = z.object({
  channel: z.string().min(1),
  externalMessageId: z.string().min(1),
  conversationId: z.string().min(1),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  statusAt: isoDateStringSchema.optional(),
  providerStatus: z.string().optional(),
  reason: z.string().optional(),
  metadata: metadataSchema
});

const leadCapturedPayloadSchema = z.object({
  channel: z.string().min(1),
  leadId: z.string().min(1),
  externalLeadId: z.string().min(1).optional(),
  contact: z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    locale: z.string().optional()
  }),
  sourceContext: z
    .object({
      campaign: z.string().optional(),
      medium: z.string().optional(),
      referrer: z.string().optional()
    })
    .optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  metadata: metadataSchema
});

const conversationStateSchema = z.enum(['open', 'pending', 'closed', 'snoozed']);

const conversationStateChangedPayloadSchema = z
  .object({
    channel: z.string().min(1),
    conversationId: z.string().min(1),
    previousState: conversationStateSchema,
    currentState: conversationStateSchema,
    reason: z.string().optional(),
    changedBy: z
      .object({
        type: z.enum(['system', 'user']),
        userId: z.string().optional(),
        name: z.string().optional()
      })
      .optional(),
    metadata: metadataSchema
  })
  .refine((value) => value.previousState !== value.currentState, {
    message: 'previousState and currentState must differ',
    path: ['currentState']
  });

const channelHealthStatusChangedPayloadSchema = z.object({
  channel: z.string().min(1),
  status: z.enum(['healthy', 'degraded', 'down']),
  checkedAt: isoDateStringSchema.optional(),
  region: z.string().optional(),
  details: z.string().optional(),
  metadata: metadataSchema
});

const commentReceivedPayloadSchema = z.object({
  channel: z.string().min(1),
  externalCommentId: z.string().min(1),
  externalPostId: z.string().min(1),
  parentCommentId: z.string().optional(),
  threadId: z.string().optional(),
  author: z.object({
    externalUserId: z.string().min(1),
    displayName: z.string().optional(),
    username: z.string().optional(),
    avatarUrl: z.string().url().optional(),
    isOwner: z.boolean().default(false)
  }),
  content: z.object({
    type: z.enum(['text', 'image', 'video', 'sticker', 'emoji']),
    text: z.string().optional(),
    mediaUrl: z.string().url().optional()
  }),
  isReply: z.boolean().default(false),
  isHidden: z.boolean().default(false),
  commentedAt: isoDateStringSchema.optional(),
  metadata: metadataSchema
});

const conversationMessageReceivedEnvelopeSchema = baseEnvelopeSchema.extend({
  eventType: z.literal(EVENT_TYPES.ConversationMessageReceived),
  payload: conversationMessageReceivedPayloadSchema
});

const conversationMessageStatusUpdatedEnvelopeSchema = baseEnvelopeSchema.extend({
  eventType: z.literal(EVENT_TYPES.ConversationMessageStatusUpdated),
  payload: conversationMessageStatusUpdatedPayloadSchema
});

const leadCapturedEnvelopeSchema = baseEnvelopeSchema.extend({
  eventType: z.literal(EVENT_TYPES.LeadCaptured),
  payload: leadCapturedPayloadSchema
});

const conversationStateChangedEnvelopeSchema = baseEnvelopeSchema.extend({
  eventType: z.literal(EVENT_TYPES.ConversationStateChanged),
  payload: conversationStateChangedPayloadSchema
});

const channelHealthStatusChangedEnvelopeSchema = baseEnvelopeSchema.extend({
  eventType: z.literal(EVENT_TYPES.ChannelHealthStatusChanged),
  payload: channelHealthStatusChangedPayloadSchema
});

const commentReceivedEnvelopeSchema = baseEnvelopeSchema.extend({
  eventType: z.literal(EVENT_TYPES.CommentReceived),
  payload: commentReceivedPayloadSchema
});

export const eventEnvelopeSchema = z.discriminatedUnion('eventType', [
  conversationMessageReceivedEnvelopeSchema,
  conversationMessageStatusUpdatedEnvelopeSchema,
  leadCapturedEnvelopeSchema,
  commentReceivedEnvelopeSchema,
  conversationStateChangedEnvelopeSchema,
  channelHealthStatusChangedEnvelopeSchema
]);

const eventEnvelopeSchemas = {
  [EVENT_TYPES.ConversationMessageReceived]: conversationMessageReceivedEnvelopeSchema,
  [EVENT_TYPES.ConversationMessageStatusUpdated]: conversationMessageStatusUpdatedEnvelopeSchema,
  [EVENT_TYPES.LeadCaptured]: leadCapturedEnvelopeSchema,
  [EVENT_TYPES.CommentReceived]: commentReceivedEnvelopeSchema,
  [EVENT_TYPES.ConversationStateChanged]: conversationStateChangedEnvelopeSchema,
  [EVENT_TYPES.ChannelHealthStatusChanged]: channelHealthStatusChangedEnvelopeSchema
} as const;

export type EventPayloadMap = {
  [EVENT_TYPES.ConversationMessageReceived]: z.infer<typeof conversationMessageReceivedPayloadSchema>;
  [EVENT_TYPES.ConversationMessageStatusUpdated]: z.infer<
    typeof conversationMessageStatusUpdatedPayloadSchema
  >;
  [EVENT_TYPES.LeadCaptured]: z.infer<typeof leadCapturedPayloadSchema>;
  [EVENT_TYPES.CommentReceived]: z.infer<typeof commentReceivedPayloadSchema>;
  [EVENT_TYPES.ConversationStateChanged]: z.infer<typeof conversationStateChangedPayloadSchema>;
  [EVENT_TYPES.ChannelHealthStatusChanged]: z.infer<
    typeof channelHealthStatusChangedPayloadSchema
  >;
};

type EventEnvelopeBySchema<T extends EventType> = z.infer<(typeof eventEnvelopeSchemas)[T]>;
type BaseEnvelopeFields = z.infer<typeof baseEnvelopeSchema>;

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type ConversationMessageReceivedEvent =
  z.infer<typeof conversationMessageReceivedEnvelopeSchema>;
export type ConversationMessageStatusUpdatedEvent =
  z.infer<typeof conversationMessageStatusUpdatedEnvelopeSchema>;
export type LeadCapturedEvent = z.infer<typeof leadCapturedEnvelopeSchema>;
export type CommentReceivedEvent = z.infer<typeof commentReceivedEnvelopeSchema>;
export type ConversationStateChangedEvent = z.infer<typeof conversationStateChangedEnvelopeSchema>;
export type ChannelHealthStatusChangedEvent =
  z.infer<typeof channelHealthStatusChangedEnvelopeSchema>;

type EnvelopeFactoryParams<T extends EventType> = {
  tenantId: TenantId;
  source: string;
  payload: EventPayloadMap[T];
  dedupeKey: string;
  eventId?: string;
  occurredAt?: string;
  correlationId?: string;
  causationId?: string;
  meta?: BaseEnvelopeFields['meta'];
  eventType: T;
};

export function buildDedupeKey(channel: string, externalId: string): string {
  const normalizedChannel = channel?.trim();
  const normalizedId = externalId?.trim();
  if (!normalizedChannel) {
    throw new Error('Cannot build dedupeKey: channel is required');
  }
  if (!normalizedId) {
    throw new Error('Cannot build dedupeKey: external id is required');
  }
  return `${normalizedChannel.toLowerCase()}:${normalizedId}`;
}

export function makeEventEnvelope<T extends EventType>(
  params: EnvelopeFactoryParams<T>
): EventEnvelopeBySchema<T> {
  const envelope = {
    eventId: params.eventId ?? randomUUID(),
    occurredAt: params.occurredAt ?? new Date().toISOString(),
    tenantId: params.tenantId,
    source: params.source,
    correlationId: params.correlationId,
    causationId: params.causationId,
    dedupeKey: params.dedupeKey,
    meta: params.meta,
    eventType: params.eventType,
    payload: params.payload
  };

  const schema = eventEnvelopeSchemas[params.eventType];
  return safeParseOrThrow(schema, envelope, `makeEventEnvelope(${params.eventType})`) as EventEnvelopeBySchema<T>;
}

type EventBuilderBase<T extends EventType> = Omit<
  EnvelopeFactoryParams<T>,
  'eventType' | 'dedupeKey'
> & { dedupeKey?: string };

export function makeConversationMessageReceived(
  params: EventBuilderBase<typeof EVENT_TYPES.ConversationMessageReceived>
): ConversationMessageReceivedEvent {
  const dedupeKey =
    params.dedupeKey ??
    buildDedupeKey(params.payload.channel, params.payload.externalMessageId);

  return makeEventEnvelope({
    ...params,
    dedupeKey,
    eventType: EVENT_TYPES.ConversationMessageReceived
  });
}

export function makeConversationMessageStatusUpdated(
  params: EventBuilderBase<typeof EVENT_TYPES.ConversationMessageStatusUpdated>
): ConversationMessageStatusUpdatedEvent {
  const dedupeKey =
    params.dedupeKey ??
    buildDedupeKey(params.payload.channel, params.payload.externalMessageId);

  return makeEventEnvelope({
    ...params,
    dedupeKey,
    eventType: EVENT_TYPES.ConversationMessageStatusUpdated
  });
}

export function makeLeadCaptured(
  params: EventBuilderBase<typeof EVENT_TYPES.LeadCaptured>
): LeadCapturedEvent {
  const dedupeKey =
    params.dedupeKey ??
    buildDedupeKey(params.payload.channel, params.payload.externalLeadId ?? params.payload.leadId);

  return makeEventEnvelope({
    ...params,
    dedupeKey,
    eventType: EVENT_TYPES.LeadCaptured
  });
}

export function makeCommentReceived(
  params: EventBuilderBase<typeof EVENT_TYPES.CommentReceived>
): CommentReceivedEvent {
  const dedupeKey =
    params.dedupeKey ??
    buildDedupeKey(params.payload.channel, params.payload.externalCommentId);

  return makeEventEnvelope({
    ...params,
    dedupeKey,
    eventType: EVENT_TYPES.CommentReceived
  });
}

export function makeConversationStateChanged(
  params: EventBuilderBase<typeof EVENT_TYPES.ConversationStateChanged>
): ConversationStateChangedEvent {
  const dedupeKey =
    params.dedupeKey ??
    buildDedupeKey(
      params.payload.channel,
      `${params.payload.conversationId}:${params.payload.currentState}`
    );

  return makeEventEnvelope({
    ...params,
    dedupeKey,
    eventType: EVENT_TYPES.ConversationStateChanged
  });
}

export function makeChannelHealthStatusChanged(
  params: EventBuilderBase<typeof EVENT_TYPES.ChannelHealthStatusChanged>
): ChannelHealthStatusChangedEvent {
  const dedupeKey =
    params.dedupeKey ??
    buildDedupeKey(
      params.payload.channel,
      `${params.payload.status}:${params.payload.region ?? 'global'}`
    );

  return makeEventEnvelope({
    ...params,
    dedupeKey,
    eventType: EVENT_TYPES.ChannelHealthStatusChanged
  });
}

export function parseEventEnvelope(data: unknown): EventEnvelope {
  return safeParseOrThrow(eventEnvelopeSchema, data, 'eventEnvelope');
}
