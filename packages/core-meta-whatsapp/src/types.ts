export type WhatsAppMetadata = {
  displayPhoneNumber: string;
  phoneNumberId: string;
};

export type WhatsAppContact = {
  waId: string;
  name?: string;
};

export type WhatsAppMessage = {
  id: string;
  from?: string;
  timestamp?: string;
  type: string;
  textBody?: string;
  image?: {
    id?: string;
    mimeType?: string;
    sha256?: string;
    caption?: string;
  };
  document?: {
    id?: string;
    mimeType?: string;
    sha256?: string;
    filename?: string;
  };
  raw: Record<string, unknown>;
};

export type WhatsAppStatus = {
  id?: string;
  status: string;
  timestamp?: string;
  recipientId?: string;
  conversationId?: string;
  raw: Record<string, unknown>;
};

export type WhatsAppMessageEventPayload = {
  object: string;
  metadata: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  message: WhatsAppMessage;
};

export type WhatsAppStatusEventPayload = {
  object: string;
  metadata: WhatsAppMetadata;
  status: WhatsAppStatus;
};
