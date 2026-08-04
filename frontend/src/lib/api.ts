import type {
  CreateQueuePayload,
  QueueItem,
  ReceiveMessagesPayload,
  ReceivedMessage,
  SendMessagePayload,
  SendMessageResult,
  SqsSettings,
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

const BASE = '/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      ...options,
    });
  } catch {
    throw new ApiRequestError(
      'Cannot reach the SQS Workbench API. Is the .NET API running?',
      'NetworkError',
      0,
    );
  }

  if (!res.ok) {
    let detail: { error?: string; message?: string } = {};
    try {
      detail = await res.json();
    } catch {
      /* ignore parse errors */
    }
    throw new ApiRequestError(detail.message ?? res.statusText, detail.error ?? `HTTP ${res.status}`, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

const qs = (params: Record<string, string | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const api = {
  // settings
  getSettings: () => request<SqsSettings>('/settings'),
  saveSettings: (payload: UpdateSettingsPayload) => request<{ ok: boolean }>('/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  testSettings: () => request<{ ok: boolean }>('/settings/test', { method: 'POST' }),

  // queues
  listQueues: (prefix?: string) => request<{ queues: QueueItem[] }>(`/queues${qs({ prefix })}`),
  getQueueDetail: (name: string) => request<QueueItem>(`/queues/detail${qs({ name })}`),
  createQueue: (payload: CreateQueuePayload) => request<{ url: string }>('/queues', { method: 'POST', body: JSON.stringify(payload) }),
  deleteQueue: (url: string) => request<void>(`/queues${qs({ url })}`, { method: 'DELETE' }),
  purgeQueue: (queueUrl: string) => request<{ ok: boolean }>('/queues/purge', { method: 'POST', body: JSON.stringify({ queueUrl }) }),
  getQueueAttributes: (url: string) => request<{ attributes: Record<string, string> }>(`/queues/attributes${qs({ url })}`),
  setQueueAttributes: (queueUrl: string, attributes: Record<string, string>) =>
    request<{ ok: boolean }>('/queues/attributes', { method: 'PUT', body: JSON.stringify({ queueUrl, attributes }) }),

  // messages
  sendMessage: (payload: SendMessagePayload) => request<SendMessageResult>('/queues/send-message', { method: 'POST', body: JSON.stringify(payload) }),
  receiveMessages: (payload: ReceiveMessagesPayload) =>
    request<{ messages: ReceivedMessage[] }>('/queues/receive', { method: 'POST', body: JSON.stringify(payload) }),
  deleteMessage: (queueUrl: string, receiptHandle: string) =>
    request<{ ok: boolean }>('/queues/delete-message', { method: 'POST', body: JSON.stringify({ queueUrl, receiptHandle }) }),

  // tags
  getTags: (url: string) => request<{ tags: Record<string, string> }>(`/queues/tags${qs({ url })}`),
  setTags: (queueUrl: string, tags: Record<string, string>) =>
    request<{ ok: boolean }>('/queues/tags', { method: 'PUT', body: JSON.stringify({ queueUrl, tags }) }),
  untag: (queueUrl: string, tagKeys: string[]) =>
    request<{ ok: boolean }>('/queues/untag', { method: 'POST', body: JSON.stringify({ queueUrl, tagKeys }) }),
};
