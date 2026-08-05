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

export interface StartRedrivePayload {
  sourceQueueUrl: string;
  destinationQueueUrl: string;
  /** 0 = system optimized; 1–500 = custom max messages per second. */
  maxMessagesPerSecond: number;
}

export interface RedriveJob {
  jobId: string;
  mode: 'managed' | 'manual';
  total: number;
}

export interface RedriveStatus {
  jobId: string;
  status: 'running' | 'completed' | 'stopped' | 'failed';
  mode: 'managed' | 'manual';
  moved: number;
  total: number;
  failed: number;
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
}
