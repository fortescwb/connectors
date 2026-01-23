import { InstagramOutboundMessageIntentSchema, type InstagramOutboundMessageIntent } from '@connectors/core-messaging';

import { buildInstagramMessagePayload } from './buildPayload.js';
import { InstagramOutboundRequestBodySchema, type InstagramOutboundRequest } from './schemas.js';

export interface InstagramOutboundRequestOptions {
  instagramBusinessAccountId: string;
  apiVersion?: string;
  baseUrl?: string;
  attachmentId?: string;
}

function normalizeSegment(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function buildUrl(options: InstagramOutboundRequestOptions): string {
  const accountId = normalizeSegment(options.instagramBusinessAccountId);
  if (!accountId) {
    throw new Error('instagramBusinessAccountId is required to build outbound request');
  }

  const path = `${accountId}/messages`;
  const version = options.apiVersion ? normalizeSegment(options.apiVersion) : undefined;
  const relativeUrl = version ? `${version}/${path}` : path;

  if (options.baseUrl) {
    const baseUrl = options.baseUrl.replace(/\/+$/g, '');
    return `${baseUrl}/${relativeUrl}`;
  }

  return relativeUrl;
}

export function buildInstagramOutboundRequest(
  intent: InstagramOutboundMessageIntent,
  options: InstagramOutboundRequestOptions
): InstagramOutboundRequest {
  const validatedIntent = InstagramOutboundMessageIntentSchema.parse(intent);
  const body = InstagramOutboundRequestBodySchema.parse(
    buildInstagramMessagePayload(validatedIntent, { attachmentId: options.attachmentId })
  );

  return {
    method: 'POST',
    url: buildUrl(options),
    body
  };
}
