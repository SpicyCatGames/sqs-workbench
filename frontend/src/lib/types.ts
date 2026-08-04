export interface SqsSettings {
  endpoint: string;
  region: string;
  accessKey: string;
  hasSecretKey: boolean;
  secretKeyMasked: string;
}

export interface UpdateSettingsPayload {
  endpoint?: string;
  region?: string;
  accessKey?: string;
  secretKey?: string;
}

export interface QueueItem {
  name: string;
  url: string;
  arn: string | null;
  attributes: Record<string, string>;
}

export interface CreateQueuePayload {
  name: string;
  fifo: boolean;
  visibilityTimeout?: number;
  messageRetentionPeriod?: number;
  delaySeconds?: number;
  maximumMessageSize?: number;
  receiveMessageWaitTimeSeconds?: number;
  contentBasedDeduplication?: boolean;
}

export interface MessageAttributePayload {
  dataType: string;
  stringValue?: string | null;
}

export interface SendMessagePayload {
  queueUrl: string;
  body: string;
  delaySeconds?: number;
  messageAttributes?: Record<string, MessageAttributePayload>;
  messageGroupId?: string;
  messageDeduplicationId?: string;
}

export interface SendMessageResult {
  messageId: string;
  mD5OfMessageBody?: string | null;
  sequenceNumber?: string | null;
}

export interface ReceivedMessage {
  messageId: string;
  body: string;
  receiptHandle: string;
  mD5OfBody?: string | null;
  attributes: Record<string, string>;
  messageAttributes: Record<string, string>;
}

export interface ReceiveMessagesPayload {
  queueUrl: string;
  maxNumberOfMessages: number;
  visibilityTimeout?: number;
  waitTimeSeconds?: number;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
}
