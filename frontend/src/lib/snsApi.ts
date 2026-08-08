import {
  SNSClient,
  type SNSClientConfig,
  CreateTopicCommand,
  DeleteTopicCommand,
  GetSMSAttributesCommand,
  GetSMSSandboxAccountStatusCommand,
  GetSubscriptionAttributesCommand,
  GetTopicAttributesCommand,
  ListOriginationNumbersCommand,
  ListPhoneNumbersOptedOutCommand,
  ListSubscriptionsByTopicCommand,
  ListSubscriptionsCommand,
  ListTagsForResourceCommand,
  ListTopicsCommand,
  OptInPhoneNumberCommand,
  PublishCommand,
  type PublishCommandInput,
  SetSMSAttributesCommand,
  SetSubscriptionAttributesCommand,
  SetTopicAttributesCommand,
  SubscribeCommand,
  TagResourceCommand,
  UnsubscribeCommand,
  UntagResourceCommand,
  type MessageAttributeValue,
} from '@aws-sdk/client-sns';
import { ApiRequestError, toApiError } from './api';
import { loadSettings } from './settingsStore';

// ------------------------------------------------------------------ types

export interface SnsTopic {
  arn: string;
  name: string;
  attributes: Record<string, string>;
  tags: Record<string, string>;
}

export interface SnsSubscription {
  subscriptionArn: string | null;
  topicArn: string;
  protocol: string;
  endpoint: string;
  owner: string;
  attributes: Record<string, string>;
}

export interface CreateTopicPayload {
  name: string;
  fifo: boolean;
  displayName?: string;
  contentBasedDeduplication?: boolean;
}

export interface MessageAttributePayload {
  dataType: string;
  stringValue?: string | null;
}

export interface PublishPayload {
  topicArn?: string;
  targetArn?: string;
  phoneNumber?: string;
  message: string;
  subject?: string;
  messageAttributes?: Record<string, MessageAttributePayload>;
  messageGroupId?: string;
  messageDeduplicationId?: string;
  messageStructure?: string;
}

export interface PublishResult {
  messageId: string;
  sequenceNumber?: string | null;
}

export interface SubscribePayload {
  topicArn: string;
  protocol: string;
  endpoint: string;
  attributes?: Record<string, string>;
}

export interface OriginationNumber {
  phoneNumber: string;
  status: string;
  routeType: string;
  capabilities: string[];
  createdAt?: string;
}

export interface SmsSandboxStatus {
  isInSandbox: boolean;
}

// ---------------------------------------------------------------- SNS client

let cachedClient: SNSClient | null = null;
let cachedClientKey = '';

function getSnsClient(): SNSClient {
  const s = loadSettings();
  const key = `${s.endpoint}|${s.region}|${s.accessKey}|${s.secretKey}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;

  const config: SNSClientConfig = {
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

  cachedClient = new SNSClient(config);
  cachedClientKey = key;
  return cachedClient;
}

// ------------------------------------------------------------------ helpers

/** True when the endpoint answered but does not implement the operation (emulators). */
export function isUnsupportedOperation(err: unknown): boolean {
  return !!err && typeof err === 'object' && /(not supported|not implemented|not yet implemented|unknown operation|unsupported)/i.test(String((err as { message?: string })?.message ?? ''));
}

/** Extract the topic name from a topic ARN. */
export function topicNameFromArn(arn: string): string {
  return arn.split(':').pop() ?? arn;
}

// ------------------------------------------------------------------- topics

async function listTopics(): Promise<{ topics: SnsTopic[] }> {
  try {
    const client = getSnsClient();
    const arns: string[] = [];
    let nextToken: string | undefined;
    do {
      const resp = await client.send(new ListTopicsCommand({ NextToken: nextToken }));
      for (const t of resp.Topics ?? []) {
        if (t.TopicArn) arns.push(t.TopicArn);
      }
      nextToken = resp.NextToken;
    } while (nextToken);

    const topics: SnsTopic[] = arns.map((arn) => ({ arn, name: topicNameFromArn(arn), attributes: {}, tags: {} }));

    // Populate attributes and tags with bounded parallelism.
    const THROTTLE = 20;
    for (let i = 0; i < topics.length; i += THROTTLE) {
      await Promise.all(
        topics.slice(i, i + THROTTLE).map(async (topic) => {
          try {
            const [attrsResp, tagsResp] = await Promise.all([
              client.send(new GetTopicAttributesCommand({ TopicArn: topic.arn })),
              client.send(new ListTagsForResourceCommand({ ResourceArn: topic.arn })),
            ]);
            topic.attributes = attrsResp.Attributes ?? {};
            topic.tags = Object.fromEntries((tagsResp.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']));
          } catch {
            /* keep the topic visible even if attribute fetch fails */
          }
        }),
      );
    }
    return { topics };
  } catch (err) {
    throw toApiError(err);
  }
}

async function getTopic(arn: string): Promise<SnsTopic> {
  try {
    const client = getSnsClient();
    const [attrsResp, tagsResp] = await Promise.all([
      client.send(new GetTopicAttributesCommand({ TopicArn: arn })),
      client.send(new ListTagsForResourceCommand({ ResourceArn: arn })),
    ]);
    return {
      arn,
      name: topicNameFromArn(arn),
      attributes: attrsResp.Attributes ?? {},
      tags: Object.fromEntries((tagsResp.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
    };
  } catch (err) {
    throw toApiError(err);
  }
}

async function createTopic(payload: CreateTopicPayload): Promise<{ arn: string }> {
  const name = payload.name.trim();
  if (!name) {
    throw new ApiRequestError('Topic name is required.', 'BadRequest', 400);
  }
  if (payload.fifo && !name.toLowerCase().endsWith('.fifo')) {
    throw new ApiRequestError('FIFO topic names must end with the .fifo suffix.', 'BadRequest', 400);
  }
  if (!payload.fifo && name.toLowerCase().endsWith('.fifo')) {
    throw new ApiRequestError('Standard topic names cannot end with the .fifo suffix.', 'BadRequest', 400);
  }

  const attributes: Record<string, string> = {};
  if (payload.fifo) {
    attributes.FifoTopic = 'true';
    attributes.ContentBasedDeduplication = (payload.contentBasedDeduplication ?? true) ? 'true' : 'false';
  }
  if (payload.displayName?.trim()) {
    attributes.DisplayName = payload.displayName.trim();
  }

  try {
    const resp = await getSnsClient().send(new CreateTopicCommand({ Name: name, Attributes: attributes }));
    return { arn: resp.TopicArn ?? '' };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteTopic(topicArn: string): Promise<{ ok: boolean }> {
  try {
    await getSnsClient().send(new DeleteTopicCommand({ TopicArn: topicArn }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function setTopicAttribute(topicArn: string, attributeName: string, attributeValue: string): Promise<{ ok: boolean }> {
  try {
    await getSnsClient().send(
      new SetTopicAttributesCommand({ TopicArn: topicArn, AttributeName: attributeName, AttributeValue: attributeValue }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// -------------------------------------------------------------------- tags

async function getTopicTags(arn: string): Promise<{ tags: Record<string, string> }> {
  try {
    const resp = await getSnsClient().send(new ListTagsForResourceCommand({ ResourceArn: arn }));
    return { tags: Object.fromEntries((resp.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])) };
  } catch (err) {
    throw toApiError(err);
  }
}

async function tagTopic(arn: string, tags: Record<string, string>): Promise<{ ok: boolean }> {
  try {
    await getSnsClient().send(
      new TagResourceCommand({ ResourceArn: arn, Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function untagTopic(arn: string, tagKeys: string[]): Promise<{ ok: boolean }> {
  try {
    await getSnsClient().send(new UntagResourceCommand({ ResourceArn: arn, TagKeys: tagKeys }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ----------------------------------------------------------------- publish

async function publish(payload: PublishPayload): Promise<PublishResult> {
  if (!payload.message.trim()) {
    throw new ApiRequestError('Message body is required.', 'BadRequest', 400);
  }
  if (!payload.topicArn && !payload.phoneNumber && !payload.targetArn) {
    throw new ApiRequestError('A topic ARN, target ARN or phone number is required.', 'BadRequest', 400);
  }
  try {
    const req: PublishCommandInput = {
      Message: payload.message,
    };
    if (payload.topicArn) req.TopicArn = payload.topicArn;
    if (payload.targetArn) req.TargetArn = payload.targetArn;
    if (payload.phoneNumber) req.PhoneNumber = payload.phoneNumber;
    if (payload.subject) req.Subject = payload.subject;
    if (payload.messageStructure) req.MessageStructure = payload.messageStructure;
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

    const resp = await getSnsClient().send(new PublishCommand(req));
    return {
      messageId: resp.MessageId ?? '',
      sequenceNumber: resp.SequenceNumber,
    };
  } catch (err) {
    throw toApiError(err);
  }
}

// ------------------------------------------------------------- subscriptions

async function listSubscriptions(): Promise<{ subscriptions: SnsSubscription[] }> {
  try {
    const client = getSnsClient();
    const subscriptions: SnsSubscription[] = [];
    let nextToken: string | undefined;
    do {
      const resp = await client.send(new ListSubscriptionsCommand({ NextToken: nextToken }));
      for (const s of resp.Subscriptions ?? []) {
        subscriptions.push({
          subscriptionArn: s.SubscriptionArn ?? null,
          topicArn: s.TopicArn ?? '',
          protocol: s.Protocol ?? '',
          endpoint: s.Endpoint ?? '',
          owner: s.Owner ?? '',
          attributes: {},
        });
      }
      nextToken = resp.NextToken;
    } while (nextToken);
    return { subscriptions };
  } catch (err) {
    throw toApiError(err);
  }
}

async function listSubscriptionsByTopic(topicArn: string): Promise<{ subscriptions: SnsSubscription[] }> {
  try {
    const client = getSnsClient();
    const subscriptions: SnsSubscription[] = [];
    let nextToken: string | undefined;
    do {
      const resp = await client.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn, NextToken: nextToken }));
      for (const s of resp.Subscriptions ?? []) {
        subscriptions.push({
          subscriptionArn: s.SubscriptionArn ?? null,
          topicArn: s.TopicArn ?? topicArn,
          protocol: s.Protocol ?? '',
          endpoint: s.Endpoint ?? '',
          owner: s.Owner ?? '',
          attributes: {},
        });
      }
      nextToken = resp.NextToken;
    } while (nextToken);
    return { subscriptions };
  } catch (err) {
    throw toApiError(err);
  }
}

async function getSubscriptionAttributes(subscriptionArn: string): Promise<{ attributes: Record<string, string> }> {
  try {
    const resp = await getSnsClient().send(new GetSubscriptionAttributesCommand({ SubscriptionArn: subscriptionArn }));
    return { attributes: resp.Attributes ?? {} };
  } catch (err) {
    throw toApiError(err);
  }
}

async function setSubscriptionAttribute(subscriptionArn: string, attributeName: string, attributeValue: string): Promise<{ ok: boolean }> {
  try {
    await getSnsClient().send(
      new SetSubscriptionAttributesCommand({ SubscriptionArn: subscriptionArn, AttributeName: attributeName, AttributeValue: attributeValue }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function subscribe(payload: SubscribePayload): Promise<{ subscriptionArn: string | null }> {
  if (!payload.topicArn) {
    throw new ApiRequestError('Topic ARN is required.', 'BadRequest', 400);
  }
  if (!payload.protocol) {
    throw new ApiRequestError('Protocol is required.', 'BadRequest', 400);
  }
  if (!payload.endpoint.trim()) {
    throw new ApiRequestError('Endpoint is required.', 'BadRequest', 400);
  }
  try {
    const resp = await getSnsClient().send(
      new SubscribeCommand({
        TopicArn: payload.topicArn,
        Protocol: payload.protocol,
        Endpoint: payload.endpoint.trim(),
        Attributes: payload.attributes && Object.keys(payload.attributes).length > 0 ? payload.attributes : undefined,
      }),
    );
    return { subscriptionArn: resp.SubscriptionArn ?? null };
  } catch (err) {
    throw toApiError(err);
  }
}

async function unsubscribe(subscriptionArn: string): Promise<{ ok: boolean }> {
  try {
    await getSnsClient().send(new UnsubscribeCommand({ SubscriptionArn: subscriptionArn }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ---------------------------------------------------------------------- SMS

async function getSmsAttributes(): Promise<{ attributes: Record<string, string> }> {
  try {
    const resp = await getSnsClient().send(new GetSMSAttributesCommand({}));
    return { attributes: resp.attributes ?? {} };
  } catch (err) {
    throw toApiError(err);
  }
}

async function setSmsAttributes(attributes: Record<string, string>): Promise<{ ok: boolean }> {
  try {
    await getSnsClient().send(new SetSMSAttributesCommand({ attributes }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function listPhoneNumbersOptedOut(): Promise<{ phoneNumbers: string[] }> {
  try {
    const client = getSnsClient();
    const phoneNumbers: string[] = [];
    let nextToken: string | undefined;
    do {
      const resp = await client.send(new ListPhoneNumbersOptedOutCommand({ nextToken }));
      phoneNumbers.push(...(resp.phoneNumbers ?? []));
      nextToken = resp.nextToken;
    } while (nextToken);
    return { phoneNumbers };
  } catch (err) {
    throw toApiError(err);
  }
}

async function optInPhoneNumber(phoneNumber: string): Promise<{ ok: boolean }> {
  try {
    await getSnsClient().send(new OptInPhoneNumberCommand({ phoneNumber }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function getSmsSandboxStatus(): Promise<SmsSandboxStatus> {
  try {
    const resp = await getSnsClient().send(new GetSMSSandboxAccountStatusCommand({}));
    return { isInSandbox: resp.IsInSandbox === true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ------------------------------------------------------- origination numbers

async function listOriginationNumbers(): Promise<{ numbers: OriginationNumber[] }> {
  try {
    const client = getSnsClient();
    const numbers: OriginationNumber[] = [];
    let nextToken: string | undefined;
    do {
      const resp = await client.send(new ListOriginationNumbersCommand({ NextToken: nextToken }));
      for (const p of resp.PhoneNumbers ?? []) {
        numbers.push({
          phoneNumber: p.PhoneNumber ?? '',
          status: p.Status ?? '',
          routeType: p.RouteType ?? '',
          capabilities: p.NumberCapabilities ?? [],
          createdAt: p.CreatedAt?.toISOString(),
        });
      }
      nextToken = resp.NextToken;
    } while (nextToken);
    return { numbers };
  } catch (err) {
    throw toApiError(err);
  }
}

// ----------------------------------------------------------------------- api

export const snsApi = {
  listTopics,
  getTopic,
  createTopic,
  deleteTopic,
  setTopicAttribute,
  getTopicTags,
  tagTopic,
  untagTopic,
  publish,
  listSubscriptions,
  listSubscriptionsByTopic,
  getSubscriptionAttributes,
  setSubscriptionAttribute,
  subscribe,
  unsubscribe,
  getSmsAttributes,
  setSmsAttributes,
  listPhoneNumbersOptedOut,
  optInPhoneNumber,
  getSmsSandboxStatus,
  listOriginationNumbers,
};
