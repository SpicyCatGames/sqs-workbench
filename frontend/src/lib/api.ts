import {
  SQSClient,
  type SQSClientConfig,
  CancelMessageMoveTaskCommand,
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListDeadLetterSourceQueuesCommand,
  ListMessageMoveTasksCommand,
  ListQueueTagsCommand,
  ListQueuesCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
  StartMessageMoveTaskCommand,
  TagQueueCommand,
  UntagQueueCommand,
  type Message,
  type MessageAttributeValue,
  type SendMessageCommandInput,
} from '@aws-sdk/client-sqs';
import { queueNameFromUrl } from './format';
import type {
  CreateQueuePayload,
  QueueItem,
  ReceiveMessagesPayload,
  ReceivedMessage,
  RedriveJob,
  RedriveStatus,
  SendMessagePayload,
  SendMessageResult,
  SqsSettings,
  StartRedrivePayload,
  UpdateSettingsPayload,
} from './types';

export class ApiRequestError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
  }
}

// ------------------------------------------------------------ settings (local)

const SETTINGS_KEY = 'sqs-workbench:settings';

interface StoredSettings {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

const DEFAULT_SETTINGS: StoredSettings = {
  endpoint: 'http://localhost:4566',
  region: 'us-east-1',
  accessKey: 'test',
  secretKey: 'test',
};

function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    /* corrupted storage — fall back to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

function storeSettings(s: StoredSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private browsing etc. — settings just won't persist */
  }
}

// ---------------------------------------------------------------- SQS client

let cachedClient: SQSClient | null = null;
let cachedClientKey = '';

function getClient(): SQSClient {
  const s = loadSettings();
  const key = `${s.endpoint}|${s.region}|${s.accessKey}|${s.secretKey}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;

  const config: SQSClientConfig = {
    region: s.region.trim() || 'us-east-1',
    credentials: {
      accessKeyId: s.accessKey.trim() || 'test',
      secretAccessKey: s.secretKey,
    },
  };
  const endpoint = s.endpoint.trim().replace(/\/+$/, '');
  if (endpoint) {
    config.endpoint = endpoint;
  }

  cachedClient = new SQSClient(config);
  cachedClientKey = key;
  return cachedClient;
}

// --------------------------------------------------------------- error mapping

interface SdkErrorLike {
  $metadata?: { httpStatusCode?: number };
  name?: string;
  message?: string;
  Code?: string;
}

/** True when the error came back from the endpoint (as opposed to a network failure). */
function isServiceError(err: unknown): boolean {
  return !!err && typeof err === 'object' && '$metadata' in err;
}

function toApiError(err: unknown): ApiRequestError {
  if (err instanceof ApiRequestError) return err;
  if (isServiceError(err)) {
    const e = err as SdkErrorLike;
    return new ApiRequestError(
      e.message ?? 'The SQS endpoint returned an error.',
      e.Code ?? e.name ?? 'AwsError',
      e.$metadata?.httpStatusCode ?? 502,
    );
  }
  if (err instanceof Error) {
    // SDK fetch failures in the browser surface as generic errors.
    return new ApiRequestError(
      'Cannot reach the SQS endpoint. Check your connection settings and that the endpoint allows cross-origin (CORS) requests.',
      'NetworkError',
      502,
    );
  }
  return new ApiRequestError(String(err), 'UnknownError', 502);
}

// ------------------------------------------------------------------ settings

async function getSettings(): Promise<SqsSettings> {
  const s = loadSettings();
  return {
    endpoint: s.endpoint,
    region: s.region,
    accessKey: s.accessKey,
    hasSecretKey: !!s.secretKey,
    secretKeyMasked: s.secretKey ? '****' : '',
  };
}

async function saveSettings(payload: UpdateSettingsPayload): Promise<{ ok: boolean }> {
  const current = loadSettings();
  const updated: StoredSettings = {
    endpoint: payload.endpoint?.trim() || current.endpoint,
    region: payload.region?.trim() || current.region,
    accessKey: payload.accessKey?.trim() || current.accessKey,
    secretKey: current.secretKey,
  };
  // Empty or masked secret means "keep the existing one".
  if (payload.secretKey && payload.secretKey !== '****' && payload.secretKey !== current.secretKey) {
    updated.secretKey = payload.secretKey;
  }
  storeSettings(updated);
  // Drop the cached client so the next call picks up the new settings.
  cachedClient = null;
  cachedClientKey = '';
  return { ok: true };
}

async function testSettings(): Promise<{ ok: boolean }> {
  try {
    await getClient().send(new ListQueuesCommand({ MaxResults: 1 }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// -------------------------------------------------------------------- queues

async function getQueueAttributesInternal(client: SQSClient, url: string): Promise<Record<string, string>> {
  const resp = await client.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['All'] }));
  return resp.Attributes ?? {};
}

async function listQueuesInternal(client: SQSClient, prefix?: string): Promise<QueueItem[]> {
  const items: QueueItem[] = [];
  let nextToken: string | undefined;
  do {
    const resp = await client.send(
      new ListQueuesCommand({
        QueueNamePrefix: prefix?.trim() ? prefix.trim() : undefined,
        NextToken: nextToken,
        MaxResults: 100,
      }),
    );
    for (const url of resp.QueueUrls ?? []) {
      items.push({ name: queueNameFromUrl(url), url, arn: null, attributes: {} });
    }
    nextToken = resp.NextToken;
  } while (nextToken);

  // Populate attributes (ARN, message counts, ...) with bounded parallelism.
  const THROTTLE = 20;
  for (let i = 0; i < items.length; i += THROTTLE) {
    await Promise.all(
      items.slice(i, i + THROTTLE).map(async (item) => {
        try {
          const attrs = await getQueueAttributesInternal(client, item.url);
          item.attributes = attrs;
          item.arn = attrs.QueueArn ?? null;
        } catch {
          /* keep the queue visible even if attribute fetch fails */
        }
      }),
    );
  }
  return items;
}

async function listQueues(prefix?: string): Promise<{ queues: QueueItem[] }> {
  try {
    return { queues: await listQueuesInternal(getClient(), prefix) };
  } catch (err) {
    throw toApiError(err);
  }
}

async function getQueueDetail(name: string): Promise<QueueItem> {
  try {
    const client = getClient();
    const urlResp = await client.send(new GetQueueUrlCommand({ QueueName: name }));
    const url = urlResp.QueueUrl ?? '';
    const attrs = await getQueueAttributesInternal(client, url);
    return {
      name: queueNameFromUrl(url),
      url,
      arn: attrs.QueueArn ?? null,
      attributes: attrs,
    };
  } catch (err) {
    throw toApiError(err);
  }
}

async function createQueue(payload: CreateQueuePayload): Promise<{ url: string }> {
  const name = payload.name.trim();
  if (!name) {
    throw new ApiRequestError('Queue name is required.', 'BadRequest', 400);
  }
  if (payload.fifo && !name.toLowerCase().endsWith('.fifo')) {
    throw new ApiRequestError('FIFO queue names must end with the .fifo suffix.', 'BadRequest', 400);
  }
  if (!payload.fifo && name.toLowerCase().endsWith('.fifo')) {
    throw new ApiRequestError('Standard queue names cannot end with the .fifo suffix. Enable FIFO to use this name.', 'BadRequest', 400);
  }

  const attributes: Record<string, string> = {
    VisibilityTimeout: String(payload.visibilityTimeout ?? 30),
    MessageRetentionPeriod: String(payload.messageRetentionPeriod ?? 345600),
    DelaySeconds: String(payload.delaySeconds ?? 0),
    MaximumMessageSize: String(payload.maximumMessageSize ?? 262144),
    ReceiveMessageWaitTimeSeconds: String(payload.receiveMessageWaitTimeSeconds ?? 0),
  };
  if (payload.fifo) {
    attributes.FifoQueue = 'true';
    attributes.ContentBasedDeduplication = (payload.contentBasedDeduplication ?? true) ? 'true' : 'false';
  }

  try {
    const resp = await getClient().send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }));
    return { url: resp.QueueUrl ?? '' };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteQueue(url: string): Promise<void> {
  try {
    await getClient().send(new DeleteQueueCommand({ QueueUrl: url }));
  } catch (err) {
    throw toApiError(err);
  }
}

async function purgeQueue(queueUrl: string): Promise<{ ok: boolean }> {
  try {
    await getClient().send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// -------------------------------------------------------------- attributes

async function getQueueAttributes(url: string): Promise<{ attributes: Record<string, string> }> {
  try {
    return { attributes: await getQueueAttributesInternal(getClient(), url) };
  } catch (err) {
    throw toApiError(err);
  }
}

async function setQueueAttributes(queueUrl: string, attributes: Record<string, string>): Promise<{ ok: boolean }> {
  try {
    await getClient().send(new SetQueueAttributesCommand({ QueueUrl: queueUrl, Attributes: attributes }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ------------------------------------------------------------------ messages

async function sendMessage(payload: SendMessagePayload): Promise<SendMessageResult> {
  if (!payload.body.trim()) {
    throw new ApiRequestError('Message body is required.', 'BadRequest', 400);
  }
  try {
    const req: SendMessageCommandInput = {
      QueueUrl: payload.queueUrl,
      MessageBody: payload.body,
    };
    if (payload.delaySeconds !== undefined) req.DelaySeconds = payload.delaySeconds;
    if (payload.messageGroupId) req.MessageGroupId = payload.messageGroupId;
    if (payload.messageDeduplicationId) req.MessageDeduplicationId = payload.messageDeduplicationId;
    if (payload.messageAttributes && Object.keys(payload.messageAttributes).length > 0) {
      req.MessageAttributes = {};
      for (const [key, value] of Object.entries(payload.messageAttributes)) {
        req.MessageAttributes[key] = {
          DataType: value.dataType || 'String',
          StringValue: value.stringValue ?? undefined,
        } satisfies MessageAttributeValue;
      }
    }

    const resp = await getClient().send(new SendMessageCommand(req));
    return {
      messageId: resp.MessageId ?? '',
      mD5OfMessageBody: resp.MD5OfMessageBody,
      sequenceNumber: resp.SequenceNumber,
    };
  } catch (err) {
    throw toApiError(err);
  }
}

async function receiveMessages(payload: ReceiveMessagesPayload): Promise<{ messages: ReceivedMessage[] }> {
  try {
    const resp = await getClient().send(
      new ReceiveMessageCommand({
        QueueUrl: payload.queueUrl,
        MaxNumberOfMessages: Math.min(10, Math.max(1, payload.maxNumberOfMessages)),
        VisibilityTimeout: payload.visibilityTimeout ?? 0,
        WaitTimeSeconds: payload.waitTimeSeconds ?? 0,
        MessageSystemAttributeNames: ['All'],
        MessageAttributeNames: ['All'],
      }),
    );

    const messages: ReceivedMessage[] = (resp.Messages ?? []).map((m) => ({
      messageId: m.MessageId ?? '',
      body: m.Body ?? '',
      receiptHandle: m.ReceiptHandle ?? '',
      mD5OfBody: m.MD5OfBody,
      attributes: m.Attributes ?? {},
      messageAttributes: Object.fromEntries(
        Object.entries(m.MessageAttributes ?? {}).map(([k, v]) => [k, v.StringValue ?? `<binary:${v.DataType ?? 'unknown'}>`]),
      ),
    }));
    return { messages };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteMessage(queueUrl: string, receiptHandle: string): Promise<{ ok: boolean }> {
  try {
    await getClient().send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ---------------------------------------------------------------------- tags

async function getTags(url: string): Promise<{ tags: Record<string, string> }> {
  try {
    const resp = await getClient().send(new ListQueueTagsCommand({ QueueUrl: url }));
    return { tags: resp.Tags ?? {} };
  } catch (err) {
    throw toApiError(err);
  }
}

async function setTags(queueUrl: string, tags: Record<string, string>): Promise<{ ok: boolean }> {
  try {
    await getClient().send(new TagQueueCommand({ QueueUrl: queueUrl, Tags: tags }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function untag(queueUrl: string, tagKeys: string[]): Promise<{ ok: boolean }> {
  try {
    await getClient().send(new UntagQueueCommand({ QueueUrl: queueUrl, TagKeys: tagKeys }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ------------------------------------------------------------------- redrive

/**
 * An in-browser message redrive job. Either wraps the managed SQS message move
 * task API (mode = "managed") or a locally executed receive/send/delete loop
 * (mode = "manual") used when the endpoint does not implement the managed API.
 * Jobs live in memory for the lifetime of the tab.
 */
interface RedriveJobRecord {
  id: string;
  mode: 'managed' | 'manual';
  sourceUrl: string;
  destinationUrl: string;
  sourceArn?: string;
  taskHandle?: string;
  cts?: AbortController;
  maxPerSecond: number;
  status: 'running' | 'completed' | 'stopped' | 'failed';
  moved: number;
  total: number;
  failed: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  scanned: number;
  consecutiveFailures: number;
}

const redriveJobs = new Map<string, RedriveJobRecord>();

/** crypto.randomUUID is only available in secure contexts — fall back for plain-HTTP hosts. */
function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function snapshot(record: RedriveJobRecord): RedriveStatus {
  return {
    jobId: record.id,
    mode: record.mode,
    status: record.status,
    moved: record.moved,
    total: record.total,
    failed: record.failed,
    error: record.error,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  };
}

function finish(record: RedriveJobRecord, status: RedriveJobRecord['status'], error?: string): void {
  if (record.status !== 'running') return; // keep the terminal state once reached
  record.status = status;
  record.error = error;
  record.finishedAt = new Date().toISOString();
}

function pruneFinishedJobs(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, record] of redriveJobs) {
    if (record.finishedAt && new Date(record.finishedAt).getTime() < cutoff) {
      redriveJobs.delete(id);
    }
  }
}

async function getRedriveSources(url: string): Promise<{ sources: QueueItem[] }> {
  try {
    const client = getClient();
    let urls: string[] = [];

    // Preferred path: the managed ListDeadLetterSourceQueues API.
    try {
      const resp = await client.send(new ListDeadLetterSourceQueuesCommand({ QueueUrl: url }));
      urls = resp.queueUrls ?? [];
    } catch {
      /* endpoint does not implement it — scan RedrivePolicies below */
    }

    if (urls.length === 0) {
      // Fallback: scan every queue's RedrivePolicy for a target matching this queue.
      const attrs = await getQueueAttributesInternal(client, url);
      const dlqArn = attrs.QueueArn ?? '';
      if (dlqArn) {
        const all = await listQueuesInternal(client);
        urls = all
          .filter((q) => parseRedriveTargetArn(q.attributes.RedrivePolicy) === dlqArn)
          .map((q) => q.url);
      }
    }

    const sources: QueueItem[] = [];
    for (const queueUrl of urls) {
      try {
        const attrs = await getQueueAttributesInternal(client, queueUrl);
        sources.push({ name: queueNameFromUrl(queueUrl), url: queueUrl, arn: attrs.QueueArn ?? null, attributes: attrs });
      } catch {
        /* skip queues that cannot be loaded */
      }
    }
    return { sources };
  } catch (err) {
    throw toApiError(err);
  }
}

function parseRedriveTargetArn(policy: string | undefined): string {
  if (!policy) return '';
  try {
    const parsed = JSON.parse(policy) as { deadLetterTargetArn?: string };
    return parsed.deadLetterTargetArn ?? '';
  } catch {
    return '';
  }
}

async function startRedrive(payload: StartRedrivePayload): Promise<RedriveJob> {
  if (!payload.sourceQueueUrl || !payload.destinationQueueUrl) {
    throw new ApiRequestError('Source and destination queues are required.', 'BadRequest', 400);
  }
  if (payload.sourceQueueUrl === payload.destinationQueueUrl) {
    throw new ApiRequestError('Source and destination queues must be different.', 'BadRequest', 400);
  }
  if (payload.maxMessagesPerSecond < 0 || payload.maxMessagesPerSecond > 500) {
    throw new ApiRequestError('Max messages per second must be between 0 (system optimized) and 500.', 'BadRequest', 400);
  }

  pruneFinishedJobs();
  const client = getClient();

  // Resolve ARNs and a best-effort total before starting.
  let sourceArn = '';
  let destinationArn = '';
  let total = 0;
  try {
    const [srcAttrs, dstAttrs] = await Promise.all([
      client.send(new GetQueueAttributesCommand({ QueueUrl: payload.sourceQueueUrl, AttributeNames: ['All'] })),
      client.send(new GetQueueAttributesCommand({ QueueUrl: payload.destinationQueueUrl, AttributeNames: ['All'] })),
    ]);
    sourceArn = srcAttrs.Attributes?.QueueArn ?? '';
    destinationArn = dstAttrs.Attributes?.QueueArn ?? '';
    total = Number(srcAttrs.Attributes?.ApproximateNumberOfMessages ?? 0) || 0;
  } catch (err) {
    throw toApiError(err);
  }

  const record: RedriveJobRecord = {
    id: uuid(),
    mode: 'manual',
    sourceUrl: payload.sourceQueueUrl,
    destinationUrl: payload.destinationQueueUrl,
    sourceArn,
    maxPerSecond: payload.maxMessagesPerSecond,
    status: 'running',
    moved: 0,
    total,
    failed: 0,
    startedAt: new Date().toISOString(),
    scanned: 0,
    consecutiveFailures: 0,
  };

  // Preferred path: the managed message move task API (real AWS + emulators that implement it).
  if (sourceArn && destinationArn) {
    try {
      const resp = await client.send(
        new StartMessageMoveTaskCommand({
          SourceArn: sourceArn,
          DestinationArn: destinationArn,
          MaxNumberOfMessagesPerSecond: payload.maxMessagesPerSecond > 0 ? payload.maxMessagesPerSecond : undefined,
        }),
      );
      record.mode = 'managed';
      record.taskHandle = resp.TaskHandle;
      redriveJobs.set(record.id, record);
      return { jobId: record.id, mode: 'managed', total };
    } catch (err) {
      if (!isServiceError(err)) throw toApiError(err);
      // The endpoint answered with an error (managed API not implemented) — fall back to manual.
    }
  }

  record.mode = 'manual';
  record.cts = new AbortController();
  redriveJobs.set(record.id, record);
  void runManualRedrive(record);
  return { jobId: record.id, mode: 'manual', total };
}

async function getRedriveStatus(jobId: string): Promise<RedriveStatus> {
  const record = redriveJobs.get(jobId);
  if (!record) {
    throw new ApiRequestError('Unknown redrive job.', 'BadRequest', 404);
  }

  if (record.mode === 'manual') {
    return snapshot(record);
  }

  // Refresh managed task progress from the endpoint.
  try {
    const resp = await getClient().send(
      new ListMessageMoveTasksCommand({ SourceArn: record.sourceArn, MaxResults: 20 }),
    );
    const task = resp.Results?.find((t) => t.TaskHandle === record.taskHandle);
    if (task) {
      if (record.status === 'running') {
        record.status = mapManagedStatus(task.Status ?? 'RUNNING');
        record.error = task.FailureReason ?? undefined;
        if (record.status !== 'running') record.finishedAt = new Date().toISOString();
      }
      record.moved = task.ApproximateNumberOfMessagesMoved ?? 0;
      if ((task.ApproximateNumberOfMessagesToMove ?? 0) > 0) {
        record.total = task.ApproximateNumberOfMessagesToMove ?? 0;
      }
    }
  } catch {
    /* transient poll error — keep the last known state */
  }
  return snapshot(record);
}

function mapManagedStatus(status: string): RedriveJobRecord['status'] {
  switch (status) {
    case 'COMPLETED':
      return 'completed';
    case 'CANCELLED':
      return 'stopped';
    case 'FAILED':
      return 'failed';
    default:
      return 'running';
  }
}

async function stopRedrive(jobId: string): Promise<{ ok: boolean }> {
  const record = redriveJobs.get(jobId);
  if (!record) {
    throw new ApiRequestError('Unknown redrive job.', 'BadRequest', 404);
  }
  if (record.mode === 'manual') {
    record.cts?.abort();
    return { ok: true };
  }
  if (record.taskHandle) {
    try {
      await getClient().send(new CancelMessageMoveTaskCommand({ TaskHandle: record.taskHandle }));
    } catch (err) {
      throw toApiError(err);
    }
  }
  return { ok: true };
}

/** Manual redrive: receive/send/delete loop with optional rate limiting. */
async function runManualRedrive(record: RedriveJobRecord): Promise<void> {
  const client = getClient();
  const signal = record.cts!.signal;
  try {
    const destAttrs = await getQueueAttributesInternal(client, record.destinationUrl);
    const destIsFifo = destAttrs.FifoQueue === 'true';
    const limiter = record.maxPerSecond > 0 ? new RateLimiter(record.maxPerSecond) : null;

    while (!signal.aborted) {
      const resp = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: record.sourceUrl,
          MaxNumberOfMessages: 10,
          VisibilityTimeout: 30,
          WaitTimeSeconds: 0,
          MessageSystemAttributeNames: ['All'],
          MessageAttributeNames: ['All'],
        }),
        { abortSignal: signal },
      );

      const messages = resp.Messages ?? [];
      if (messages.length === 0) {
        finish(record, 'completed');
        return;
      }

      for (const message of messages) {
        if (signal.aborted) {
          finish(record, 'stopped');
          return;
        }
        if (limiter) await limiter.wait(signal);
        record.scanned++;
        try {
          await client.send(buildRedriveSendCommand(record.destinationUrl, message, destIsFifo), { abortSignal: signal });
          await client.send(
            new DeleteMessageCommand({ QueueUrl: record.sourceUrl, ReceiptHandle: message.ReceiptHandle }),
            { abortSignal: signal },
          );
          record.moved++;
          record.consecutiveFailures = 0;
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') throw err;
          record.failed++;
          record.consecutiveFailures++;
          if (record.consecutiveFailures >= 25) {
            finish(record, 'failed', 'Too many consecutive messages failed to move; redrive aborted.');
            return;
          }
        }
      }
    }
    finish(record, 'stopped');
  } catch (err) {
    if (signal.aborted || (err as Error)?.name === 'AbortError') {
      finish(record, 'stopped');
    } else {
      finish(record, 'failed', toApiError(err).message);
    }
  }
}

function buildRedriveSendCommand(destinationUrl: string, message: Message, destIsFifo: boolean): SendMessageCommand {
  const req: SendMessageCommandInput = {
    QueueUrl: destinationUrl,
    MessageBody: message.Body,
    MessageAttributes: message.MessageAttributes,
  };
  // Preserve FIFO ordering semantics: reuse the original group/dedup IDs when
  // the message has them, otherwise synthesize stable ones from the message ID.
  if (destIsFifo) {
    const groupId = message.Attributes?.MessageGroupId;
    const dedupId = message.Attributes?.MessageDeduplicationId;
    req.MessageGroupId = groupId || 'redrive';
    req.MessageDeduplicationId = dedupId || `redrive-${message.MessageId ?? 'unknown'}`;
  }
  return new SendMessageCommand(req);
}

/** A simple token-bucket rate limiter for the manual redrive path. */
class RateLimiter {
  private tokens: number;
  private lastRefill = performance.now();

  constructor(private readonly maxPerSecond: number) {
    this.tokens = maxPerSecond;
  }

  async wait(signal: AbortSignal): Promise<void> {
    for (;;) {
      const now = performance.now();
      this.tokens = Math.min(this.maxPerSecond, this.tokens + ((now - this.lastRefill) / 1000) * this.maxPerSecond);
      this.lastRefill = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await delay(50, signal);
    }
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = window.setTimeout(() => {
      // Remove the listener on the resolve path so long rate-limited redrives
      // don't accumulate listeners on the same AbortSignal.
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
  });
}

// ----------------------------------------------------------------------- api

export const api = {
  getSettings,
  saveSettings,
  testSettings,
  listQueues,
  getQueueDetail,
  createQueue,
  deleteQueue,
  purgeQueue,
  getQueueAttributes,
  setQueueAttributes,
  sendMessage,
  receiveMessages,
  deleteMessage,
  getTags,
  setTags,
  untag,
  getRedriveSources,
  startRedrive,
  getRedriveStatus,
  stopRedrive,
};
