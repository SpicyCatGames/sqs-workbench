import {
  BatchWriteItemCommand,
  CreateBackupCommand,
  CreateTableCommand,
  DeleteBackupCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  DynamoDBClient,
  type DynamoDBClientConfig,
  ListBackupsCommand,
  ListTablesCommand,
  ListTagsOfResourceCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateItemCommand,
  UpdateTableCommand,
  UpdateTimeToLiveCommand,
  type AttributeValue,
  type GlobalSecondaryIndexDescription,
  type KeySchemaElement,
  type LocalSecondaryIndexDescription,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';
import { ApiRequestError, toApiError } from './api';
import { loadSettings } from './settingsStore';

export type { AttributeValue } from '@aws-sdk/client-dynamodb';

// ------------------------------------------------------------------ types

export type AttributeScalarType = 'S' | 'N' | 'B';

export interface DynamoKeySchemaItem {
  attributeName: string;
  keyType: 'HASH' | 'RANGE';
  attributeType: AttributeScalarType;
}

export interface DynamoIndex {
  name: string;
  keySchema: DynamoKeySchemaItem[];
  projectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
  nonKeyAttributes: string[];
  status: string | null;
  itemCount: number | null;
  indexSizeBytes: number | null;
  arn: string | null;
}

export interface DynamoTable {
  name: string;
  arn: string | null;
  tableId: string | null;
  region: string;
  status: string | null;
  itemCount: number | null;
  tableSizeBytes: number | null;
  creationDate: string | null;
  billingMode: 'PAY_PER_REQUEST' | 'PROVISIONED' | null;
  provisionedThroughput: {
    read: number;
    write: number;
    lastIncreaseDateTime?: string | null;
    lastDecreaseDateTime?: string | null;
    numberOfDecreasesToday?: number | null;
  } | null;
  tableClass: string | null;
  keySchema: DynamoKeySchemaItem[];
  gsi: DynamoIndex[];
  lsi: DynamoIndex[];
  streamEnabled: boolean;
  streamArn: string | null;
  streamViewType: string | null;
  sseType: string | null;
  sseStatus: string | null;
  deletionProtectionEnabled: boolean | null;
  ttlStatus: string | null;
  ttlAttributeName: string | null;
  tags: Record<string, string>;
}

export interface CreateTablePayload {
  name: string;
  partitionKey: { name: string; type: AttributeScalarType };
  sortKey?: { name: string; type: AttributeScalarType };
  billingMode: 'PAY_PER_REQUEST' | 'PROVISIONED';
  readCapacity?: number;
  writeCapacity?: number;
  tableClass: 'STANDARD' | 'STANDARD_INFREQUENT_ACCESS';
  deletionProtectionEnabled: boolean;
  tags?: Record<string, string>;
}

export interface ScanQueryResult {
  items: Record<string, AttributeValue>[];
  count: number;
  scannedCount: number;
  lastEvaluatedKey: Record<string, AttributeValue> | null;
  capacityUnits: number | null;
}

/** One row of the attribute filter builder used by the items explorer. */
export interface ItemFilterCondition {
  attribute: string;
  operator: '=' | '<>' | '<' | '<=' | '>' | '>=' | 'BETWEEN' | 'BEGINS_WITH' | 'CONTAINS';
  value1: string;
  value2?: string;
  valueType: AttributeScalarType | 'BOOL';
  /** Join to the previous condition (required for the second condition onwards). */
  join?: 'AND' | 'OR';
}

export interface SortKeyCondition {
  operator: '=' | '<' | '<=' | '>' | '>=' | 'BETWEEN' | 'BEGINS_WITH';
  value1: string;
  value2?: string;
}

export interface DynamoBackup {
  backupName: string;
  backupArn: string;
  tableName: string;
  status: string | null;
  type: string | null;
  sizeBytes: number | null;
  creationDate: string | null;
}

// ------------------------------------------------------------ Dynamo client

let cachedClient: DynamoDBClient | null = null;
let cachedClientKey = '';

function getRegion(): string {
  return loadSettings().region.trim() || 'us-east-1';
}

function getDynamoClient(): DynamoDBClient {
  const s = loadSettings();
  const key = `${s.endpoint}|${s.region}|${s.accessKey}|${s.secretKey}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;

  const config: DynamoDBClientConfig = {
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

  cachedClient = new DynamoDBClient(config);
  cachedClientKey = key;
  return cachedClient;
}

// ------------------------------------------------------------ marshalling

/** Base64-encode binary bytes (for display / user input). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Base64-decode user input into binary bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new ApiRequestError('Invalid base64 value — binary attributes expect standard base64 text.', 'BadRequest', 400);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** The scalar type tag of an AttributeValue (S, N, B, SS, ..., NULL). */
export function attributeTypeOf(v: AttributeValue | undefined): string {
  if (!v) return 'NULL';
  if (v.S !== undefined) return 'S';
  if (v.N !== undefined) return 'N';
  if (v.B !== undefined) return 'B';
  if (v.SS !== undefined) return 'SS';
  if (v.NS !== undefined) return 'NS';
  if (v.BS !== undefined) return 'BS';
  if (v.M !== undefined) return 'M';
  if (v.L !== undefined) return 'L';
  if (v.BOOL !== undefined) return 'BOOL';
  return 'NULL';
}

/** Marshal a plain-JSON value into an AttributeValue by inference. */
export function plainToAttributeValue(v: unknown): AttributeValue {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === 'boolean') return { BOOL: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new ApiRequestError('Numbers must be finite.', 'BadRequest', 400);
    return { N: String(v) };
  }
  if (typeof v === 'string') return { S: v };
  if (v instanceof Uint8Array) return { B: v };
  if (Array.isArray(v)) {
    if (v.length === 0) throw new ApiRequestError('Empty arrays cannot be stored. Use an empty DynamoDB set (SS/NS/BS) instead.', 'BadRequest', 400);
    const items = v.map(plainToAttributeValue);
    // Homogeneous scalar arrays become DynamoDB sets, matching the AWS console.
    if (items.every((i) => i.S !== undefined)) return { SS: items.map((i) => i.S ?? '') };
    if (items.every((i) => i.N !== undefined)) return { NS: items.map((i) => i.N ?? '') };
    if (items.every((i) => i.B !== undefined)) return { BS: items.map((i) => i.B ?? new Uint8Array()) };
    return { L: items };
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    // Binary escape hatch so plain-JSON round trips survive binary attributes.
    if (Object.keys(obj).length === 1 && typeof obj.$binary === 'string') {
      return { B: base64ToBytes(obj.$binary) };
    }
    const map: Record<string, AttributeValue> = {};
    for (const [key, val] of Object.entries(obj)) {
      map[key] = plainToAttributeValue(val);
    }
    return { M: map };
  }
  throw new ApiRequestError(`Unsupported JSON value: ${String(v)}`, 'BadRequest', 400);
}

/** Convert an AttributeValue into plain JSON (binary becomes a $binary object). */
export function attributeValueToPlain(v: AttributeValue): unknown {
  const type = attributeTypeOf(v);
  switch (type) {
    case 'S':
      return v.S;
    case 'N':
      return v.N;
    case 'B':
      return { $binary: bytesToBase64(v.B ?? new Uint8Array()) };
    case 'SS':
      return v.SS;
    case 'NS':
      return v.NS;
    case 'BS':
      return (v.BS ?? []).map((b) => ({ $binary: bytesToBase64(b) }));
    case 'BOOL':
      return v.BOOL;
    case 'NULL':
      return null;
    case 'L':
      return (v.L ?? []).map(attributeValueToPlain);
    case 'M': {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(v.M ?? {})) {
        out[key] = attributeValueToPlain(val);
      }
      return out;
    }
    default:
      return null;
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;
}

/** A compact single-line preview of an attribute value. */
export function attributePreview(v: AttributeValue, maxLength = 60): string {
  const type = attributeTypeOf(v);
  switch (type) {
    case 'S':
      return truncate(v.S ?? '', maxLength);
    case 'N':
      return truncate(v.N ?? '', maxLength);
    case 'BOOL':
      return v.BOOL ? 'true' : 'false';
    case 'NULL':
      return 'null';
    case 'B':
      return truncate(`binary ${bytesToBase64(v.B ?? new Uint8Array())}`, maxLength);
    case 'SS':
    case 'NS':
      return truncate((v.SS ?? v.NS ?? []).join(', '), maxLength);
    case 'BS':
      return `${(v.BS ?? []).length} binary value(s)`;
    case 'L':
      return `[${(v.L ?? []).length} elements]`;
    case 'M': {
      const keys = Object.keys(v.M ?? {});
      return truncate(`{ ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? `, …(+${keys.length - 3})` : ''} }`, maxLength);
    }
    default:
      return '';
  }
}

/** Human label for an attribute type tag. */
export function attributeTypeLabel(type: string): string {
  switch (type) {
    case 'S':
      return 'String';
    case 'N':
      return 'Number';
    case 'B':
      return 'Binary';
    case 'SS':
      return 'String set';
    case 'NS':
      return 'Number set';
    case 'BS':
      return 'Binary set';
    case 'M':
      return 'Map';
    case 'L':
      return 'List';
    case 'BOOL':
      return 'Boolean';
    case 'NULL':
      return 'Null';
    default:
      return type;
  }
}

// ------------------------------------------------------------- describe map

function mapKeySchema(desc: TableDescription | undefined): DynamoKeySchemaItem[] {
  const types = new Map((desc?.AttributeDefinitions ?? []).map((a) => [a.AttributeName ?? '', a.AttributeType ?? 'S']));
  return (desc?.KeySchema ?? []).map((k) => ({
    attributeName: k.AttributeName ?? '',
    keyType: k.KeyType ?? 'HASH',
    attributeType: (types.get(k.AttributeName ?? '') as AttributeScalarType) ?? 'S',
  }));
}

function mapIndex(
  index: GlobalSecondaryIndexDescription | LocalSecondaryIndexDescription,
  attrTypes: Map<string, string>,
): DynamoIndex {
  return {
    name: index.IndexName ?? '',
    keySchema: (index.KeySchema ?? []).map((k) => ({
      attributeName: k.AttributeName ?? '',
      keyType: k.KeyType ?? 'HASH',
      attributeType: (attrTypes.get(k.AttributeName ?? '') as AttributeScalarType) ?? 'S',
    })),
    projectionType: (index.Projection?.ProjectionType ?? 'ALL') as DynamoIndex['projectionType'],
    nonKeyAttributes: index.Projection?.NonKeyAttributes ?? [],
    status: (index as GlobalSecondaryIndexDescription).IndexStatus ?? null,
    itemCount: index.ItemCount ?? null,
    indexSizeBytes: index.IndexSizeBytes ?? null,
    arn: index.IndexArn ?? null,
  };
}

function tableFromDescription(desc: TableDescription | undefined, region: string): DynamoTable {
  const p = desc?.ProvisionedThroughput;
  const billing = desc?.BillingModeSummary?.BillingMode;
  const attrTypes = new Map((desc?.AttributeDefinitions ?? []).map((a) => [a.AttributeName ?? '', a.AttributeType ?? 'S']));
  return {
    name: desc?.TableName ?? '',
    arn: desc?.TableArn ?? null,
    tableId: desc?.TableId ?? null,
    region,
    status: desc?.TableStatus ?? null,
    itemCount: desc?.ItemCount ?? null,
    tableSizeBytes: desc?.TableSizeBytes ?? null,
    creationDate: desc?.CreationDateTime ? desc.CreationDateTime.toISOString() : null,
    billingMode: billing === 'PAY_PER_REQUEST' ? 'PAY_PER_REQUEST' : 'PROVISIONED',
    provisionedThroughput: p
      ? {
          read: p.ReadCapacityUnits ?? 0,
          write: p.WriteCapacityUnits ?? 0,
          lastIncreaseDateTime: p.LastIncreaseDateTime?.toISOString() ?? null,
          lastDecreaseDateTime: p.LastDecreaseDateTime?.toISOString() ?? null,
          numberOfDecreasesToday: p.NumberOfDecreasesToday ?? null,
        }
      : null,
    tableClass: desc?.TableClassSummary?.TableClass ?? null,
    keySchema: mapKeySchema(desc),
    gsi: (desc?.GlobalSecondaryIndexes ?? []).map((g) => mapIndex(g, attrTypes)),
    lsi: (desc?.LocalSecondaryIndexes ?? []).map((l) => mapIndex(l, attrTypes)),
    streamEnabled: desc?.StreamSpecification?.StreamEnabled ?? false,
    streamArn: desc?.LatestStreamArn ?? null,
    streamViewType: desc?.StreamSpecification?.StreamViewType ?? null,
    sseType: desc?.SSEDescription?.SSEType ?? null,
    sseStatus: desc?.SSEDescription?.Status ?? null,
    deletionProtectionEnabled: desc?.DeletionProtectionEnabled ?? null,
    ttlStatus: null,
    ttlAttributeName: null,
    tags: {},
  };
}

async function listTagsInternal(client: DynamoDBClient, arn: string): Promise<Record<string, string>> {
  const tags: Record<string, string> = {};
  let nextToken: string | undefined;
  do {
    const resp = await client.send(new ListTagsOfResourceCommand({ ResourceArn: arn, NextToken: nextToken }));
    for (const t of resp.Tags ?? []) {
      tags[t.Key ?? ''] = t.Value ?? '';
    }
    nextToken = resp.NextToken;
  } while (nextToken);
  return tags;
}

// ------------------------------------------------------------------ tables

async function listTables(): Promise<{ tables: DynamoTable[] }> {
  const client = getDynamoClient();
  const region = getRegion();
  const names: string[] = [];
  let next: string | undefined;
  do {
    const resp = await client.send(new ListTablesCommand({ ExclusiveStartTableName: next, Limit: 100 }));
    names.push(...(resp.TableNames ?? []));
    next = resp.LastEvaluatedTableName;
  } while (next);

  const tables: DynamoTable[] = names.map((name) => ({ ...tableFromDescription(undefined, region), name }));

  // Populate live stats with bounded parallelism.
  const THROTTLE = 20;
  for (let i = 0; i < tables.length; i += THROTTLE) {
    await Promise.all(
      tables.slice(i, i + THROTTLE).map(async (table) => {
        try {
          const resp = await client.send(new DescribeTableCommand({ TableName: table.name }));
          const full = tableFromDescription(resp.Table, region);
          table.arn = full.arn;
          table.status = full.status;
          table.itemCount = full.itemCount;
          table.tableSizeBytes = full.tableSizeBytes;
          table.creationDate = full.creationDate;
          table.billingMode = full.billingMode;
          table.tableClass = full.tableClass;
          table.deletionProtectionEnabled = full.deletionProtectionEnabled;
        } catch {
          /* keep the table visible even if the describe fails */
        }
      }),
    );
  }
  return { tables };
}

async function getTable(name: string): Promise<DynamoTable> {
  try {
    const client = getDynamoClient();
    const region = getRegion();
    const descResp = await client.send(new DescribeTableCommand({ TableName: name }));
    const table = tableFromDescription(descResp.Table, region);

    const [ttl, tags] = await Promise.allSettled([
      client.send(new DescribeTimeToLiveCommand({ TableName: name })),
      table.arn ? listTagsInternal(client, table.arn) : Promise.resolve({} as Record<string, string>),
    ]);
    if (ttl.status === 'fulfilled') {
      table.ttlStatus = ttl.value.TimeToLiveDescription?.TimeToLiveStatus ?? null;
      table.ttlAttributeName = ttl.value.TimeToLiveDescription?.AttributeName ?? null;
    }
    if (tags.status === 'fulfilled') table.tags = tags.value;
    return table;
  } catch (err) {
    throw toApiError(err);
  }
}

const TABLE_NAME_RE = /^[a-zA-Z0-9_.-]{3,255}$/;
const KEY_NAME_RE = /^[a-zA-Z0-9_.-]{1,255}$/;

async function createTable(payload: CreateTablePayload): Promise<{ name: string }> {
  const name = payload.name.trim();
  if (!TABLE_NAME_RE.test(name)) {
    throw new ApiRequestError('Table names must be 3–255 characters using letters, numbers, underscores, periods or hyphens.', 'BadRequest', 400);
  }
  if (!payload.partitionKey.name.trim()) {
    throw new ApiRequestError('Partition key name is required.', 'BadRequest', 400);
  }
  if (!KEY_NAME_RE.test(payload.partitionKey.name.trim())) {
    throw new ApiRequestError('Partition key name contains invalid characters.', 'BadRequest', 400);
  }
  if (payload.sortKey && !KEY_NAME_RE.test(payload.sortKey.name.trim())) {
    throw new ApiRequestError('Sort key name contains invalid characters.', 'BadRequest', 400);
  }

  const attributeDefinitions = [
    { AttributeName: payload.partitionKey.name.trim(), AttributeType: payload.partitionKey.type },
  ];
  if (payload.sortKey) {
    attributeDefinitions.push({ AttributeName: payload.sortKey.name.trim(), AttributeType: payload.sortKey.type });
  }
  const keySchema: KeySchemaElement[] = [{ AttributeName: payload.partitionKey.name.trim(), KeyType: 'HASH' }];
  if (payload.sortKey) {
    keySchema.push({ AttributeName: payload.sortKey.name.trim(), KeyType: 'RANGE' });
  }

  try {
    await getDynamoClient().send(
      new CreateTableCommand({
        TableName: name,
        AttributeDefinitions: attributeDefinitions,
        KeySchema: keySchema,
        BillingMode: payload.billingMode,
        TableClass: payload.tableClass,
        DeletionProtectionEnabled: payload.deletionProtectionEnabled,
        Tags: Object.entries(payload.tags ?? {}).map(([Key, Value]) => ({ Key, Value })),
        ...(payload.billingMode === 'PROVISIONED'
          ? { ProvisionedThroughput: { ReadCapacityUnits: payload.readCapacity ?? 5, WriteCapacityUnits: payload.writeCapacity ?? 5 } }
          : {}),
      }),
    );
    return { name };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteTable(name: string): Promise<{ ok: boolean }> {
  try {
    await getDynamoClient().send(new DeleteTableCommand({ TableName: name }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function setBillingMode(
  name: string,
  mode: 'PAY_PER_REQUEST' | 'PROVISIONED',
  readCapacity: number,
  writeCapacity: number,
): Promise<{ ok: boolean }> {
  try {
    await getDynamoClient().send(
      new UpdateTableCommand({
        TableName: name,
        BillingMode: mode,
        ...(mode === 'PROVISIONED'
          ? { ProvisionedThroughput: { ReadCapacityUnits: readCapacity, WriteCapacityUnits: writeCapacity } }
          : {}),
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function setTimeToLive(name: string, enabled: boolean, attributeName: string): Promise<{ ok: boolean }> {
  if (enabled && !attributeName.trim()) {
    throw new ApiRequestError('Time to live attribute name is required.', 'BadRequest', 400);
  }
  try {
    await getDynamoClient().send(
      new UpdateTimeToLiveCommand({
        TableName: name,
        TimeToLiveSpecification: { Enabled: enabled, AttributeName: attributeName.trim() },
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ------------------------------------------------------------------- items

async function scanTable(
  name: string,
  opts: {
    limit?: number;
    exclusiveStartKey?: Record<string, AttributeValue>;
    filterExpression?: string;
    expressionAttributeNames?: Record<string, string>;
    expressionAttributeValues?: Record<string, AttributeValue>;
  },
): Promise<ScanQueryResult> {
  try {
    const resp = await getDynamoClient().send(
      new ScanCommand({
        TableName: name,
        Limit: opts.limit,
        ExclusiveStartKey: opts.exclusiveStartKey ?? undefined,
        FilterExpression: opts.filterExpression ?? undefined,
        ExpressionAttributeNames: opts.expressionAttributeNames ?? undefined,
        ExpressionAttributeValues: opts.expressionAttributeValues ?? undefined,
        ReturnConsumedCapacity: 'TOTAL',
      }),
    );
    return {
      items: resp.Items ?? [],
      count: resp.Count ?? 0,
      scannedCount: resp.ScannedCount ?? 0,
      lastEvaluatedKey: resp.LastEvaluatedKey ?? null,
      capacityUnits: resp.ConsumedCapacity?.CapacityUnits ?? null,
    };
  } catch (err) {
    throw toApiError(err);
  }
}

async function queryTable(
  name: string,
  opts: {
    limit?: number;
    exclusiveStartKey?: Record<string, AttributeValue>;
    keyConditionExpression: string;
    expressionAttributeNames?: Record<string, string>;
    expressionAttributeValues?: Record<string, AttributeValue>;
    filterExpression?: string;
  },
): Promise<ScanQueryResult> {
  try {
    const resp = await getDynamoClient().send(
      new QueryCommand({
        TableName: name,
        Limit: opts.limit,
        ExclusiveStartKey: opts.exclusiveStartKey ?? undefined,
        KeyConditionExpression: opts.keyConditionExpression,
        ExpressionAttributeNames: opts.expressionAttributeNames ?? undefined,
        ExpressionAttributeValues: opts.expressionAttributeValues ?? undefined,
        FilterExpression: opts.filterExpression ?? undefined,
        ReturnConsumedCapacity: 'TOTAL',
      }),
    );
    return {
      items: resp.Items ?? [],
      count: resp.Count ?? 0,
      scannedCount: resp.ScannedCount ?? 0,
      lastEvaluatedKey: resp.LastEvaluatedKey ?? null,
      capacityUnits: resp.ConsumedCapacity?.CapacityUnits ?? null,
    };
  } catch (err) {
    throw toApiError(err);
  }
}

async function putItem(table: string, item: Record<string, AttributeValue>): Promise<{ ok: boolean }> {
  try {
    await getDynamoClient().send(new PutItemCommand({ TableName: table, Item: item }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

/** Build an UpdateItem SET/REMOVE expression replacing `oldItem` with `newItem`. */
export function buildUpdateExpression(
  table: DynamoTable,
  newItem: Record<string, AttributeValue>,
  oldItem: Record<string, AttributeValue>,
): {
  key: Record<string, AttributeValue>;
  updateExpression: string;
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, AttributeValue>;
} {
  const keyNames = new Set(table.keySchema.map((k) => k.attributeName));
  const key: Record<string, AttributeValue> = {};
  for (const k of table.keySchema) {
    const v = oldItem[k.attributeName];
    if (!v) throw new ApiRequestError(`Primary key attribute "${k.attributeName}" is missing from the item.`, 'BadRequest', 400);
    key[k.attributeName] = v;
  }

  const sets: string[] = [];
  const removes: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = {};
  let i = 0;
  for (const [attr, value] of Object.entries(newItem)) {
    if (keyNames.has(attr)) continue;
    const ph = `#a${i}`;
    const vph = `:v${i}`;
    names[ph] = attr;
    values[vph] = value;
    sets.push(`${ph} = ${vph}`);
    i++;
  }
  for (const attr of Object.keys(oldItem)) {
    if (keyNames.has(attr)) continue;
    if (!(attr in newItem)) {
      names[`#r${i}`] = attr;
      removes.push(`#r${i}`);
      i++;
    }
  }

  const parts: string[] = [];
  if (sets.length > 0) parts.push(`SET ${sets.join(', ')}`);
  if (removes.length > 0) parts.push(`REMOVE ${removes.join(', ')}`);
  if (parts.length === 0) {
    throw new ApiRequestError('The item was not changed.', 'BadRequest', 400);
  }

  return { key, updateExpression: parts.join(' '), expressionAttributeNames: names, expressionAttributeValues: values };
}

async function updateItem(
  table: DynamoTable,
  newItem: Record<string, AttributeValue>,
  oldItem: Record<string, AttributeValue>,
): Promise<{ ok: boolean }> {
  const expr = buildUpdateExpression(table, newItem, oldItem);
  try {
    await getDynamoClient().send(
      new UpdateItemCommand({
        TableName: table.name,
        Key: expr.key,
        UpdateExpression: expr.updateExpression,
        ExpressionAttributeNames: expr.expressionAttributeNames,
        ExpressionAttributeValues: expr.expressionAttributeValues,
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteItems(table: string, keys: Record<string, AttributeValue>[]): Promise<{ deleted: number }> {
  const client = getDynamoClient();
  let deleted = 0;
  try {
    for (let i = 0; i < keys.length; i += 25) {
      const chunk = keys.slice(i, i + 25);
      const resp = await client.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [table]: chunk.map((key) => ({ DeleteRequest: { Key: key } })),
          },
        }),
      );
      const unprocessed = resp.UnprocessedItems?.[table] ?? [];
      deleted += chunk.length - unprocessed.length;
      // One retry pass for unprocessed items.
      if (unprocessed.length > 0) {
        const retry = await client.send(
          new BatchWriteItemCommand({
            RequestItems: { [table]: unprocessed },
          }),
        );
        deleted += unprocessed.length - (retry.UnprocessedItems?.[table]?.length ?? 0);
      }
    }
    return { deleted };
  } catch (err) {
    throw toApiError(err);
  }
}

// ------------------------------------------------------- filter expressions

function marshalFilterValue(cond: ItemFilterCondition, which: 'value1' | 'value2'): AttributeValue {
  const raw = cond[which] ?? '';
  if (cond.valueType === 'N') {
    if (raw.trim() === '' || Number.isNaN(Number(raw))) {
      throw new ApiRequestError(`"${raw}" is not a valid number.`, 'BadRequest', 400);
    }
    return { N: String(Number(raw)) };
  }
  if (cond.valueType === 'BOOL') return { BOOL: raw.toLowerCase() === 'true' };
  if (cond.valueType === 'B') {
    if (!raw.trim()) throw new ApiRequestError('A binary value is required.', 'BadRequest', 400);
    return { B: base64ToBytes(raw.trim()) };
  }
  return { S: raw };
}

/** Build a scan/query FilterExpression from the filter builder rows. */
export function buildFilterExpression(
  conditions: ItemFilterCondition[],
): {
  FilterExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, AttributeValue>;
} | null {
  const active = conditions.filter((c) => c.attribute.trim());
  if (active.length === 0) return null;

  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = {};
  const parts: string[] = [];
  active.forEach((cond, i) => {
    const attrPh = `#f${i}`;
    const v1Ph = `:f${i}a`;
    const v2Ph = `:f${i}b`;
    names[attrPh] = cond.attribute.trim();

    let expr: string;
    switch (cond.operator) {
      case 'BETWEEN': {
        if (!cond.value1.trim() || !cond.value2?.trim()) {
          throw new ApiRequestError(`Condition "${cond.attribute}" requires two values.`, 'BadRequest', 400);
        }
        values[v1Ph] = marshalFilterValue(cond, 'value1');
        values[v2Ph] = marshalFilterValue(cond, 'value2');
        expr = `${attrPh} BETWEEN ${v1Ph} AND ${v2Ph}`;
        break;
      }
      case 'BEGINS_WITH':
      case 'CONTAINS': {
        if (!cond.value1.trim()) {
          throw new ApiRequestError(`Condition "${cond.attribute}" requires a value.`, 'BadRequest', 400);
        }
        values[v1Ph] = marshalFilterValue(cond, 'value1');
        expr = `${cond.operator === 'BEGINS_WITH' ? 'begins_with' : 'contains'}(${attrPh}, ${v1Ph})`;
        break;
      }
      default: {
        if (!cond.value1.trim()) {
          throw new ApiRequestError(`Condition "${cond.attribute}" requires a value.`, 'BadRequest', 400);
        }
        values[v1Ph] = marshalFilterValue(cond, 'value1');
        expr = `${attrPh} ${cond.operator} ${v1Ph}`;
      }
    }
    const join = i === 0 ? '' : ` ${cond.join === 'OR' ? 'OR' : 'AND'} `;
    parts.push(join + expr);
  });

  return { FilterExpression: parts.join(''), ExpressionAttributeNames: names, ExpressionAttributeValues: values };
}

/** Build the KeyConditionExpression for a query plus its placeholders. */
export function buildKeyConditionExpression(
  table: DynamoTable,
  partitionKeyValue: string,
  sortKey?: SortKeyCondition | null,
): {
  KeyConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, AttributeValue>;
} {
  const pk = table.keySchema.find((k) => k.keyType === 'HASH');
  if (!pk) throw new ApiRequestError('The table has no partition key.', 'BadRequest', 400);

  const names: Record<string, string> = { '#pk': pk.attributeName };
  const values: Record<string, AttributeValue> = {};

  const raw = partitionKeyValue.trim();
  if (!raw) throw new ApiRequestError('A partition key value is required.', 'BadRequest', 400);
  if (pk.attributeType === 'N') {
    if (Number.isNaN(Number(raw))) throw new ApiRequestError('Partition key value must be a number.', 'BadRequest', 400);
    values[':pkv'] = { N: String(Number(raw)) };
  } else if (pk.attributeType === 'B') {
    values[':pkv'] = { B: base64ToBytes(raw) };
  } else {
    values[':pkv'] = { S: raw };
  }

  let expr = '#pk = :pkv';

  if (sortKey && sortKey.value1.trim()) {
    const sk = table.keySchema.find((k) => k.keyType === 'RANGE');
    if (!sk) throw new ApiRequestError('This table has no sort key.', 'BadRequest', 400);
    names['#sk'] = sk.attributeName;

    const mk = (val: string): AttributeValue => {
      if (sk.attributeType === 'N') {
        if (Number.isNaN(Number(val))) throw new ApiRequestError('Sort key value must be a number.', 'BadRequest', 400);
        return { N: String(Number(val)) };
      }
      if (sk.attributeType === 'B') return { B: base64ToBytes(val) };
      return { S: val };
    };

    let skExpr: string;
    if (sortKey.operator === 'BETWEEN') {
      if (!sortKey.value2?.trim()) throw new ApiRequestError('BETWEEN requires two sort key values.', 'BadRequest', 400);
      values[':sk1'] = mk(sortKey.value1.trim());
      values[':sk2'] = mk(sortKey.value2.trim());
      skExpr = '#sk BETWEEN :sk1 AND :sk2';
    } else if (sortKey.operator === 'BEGINS_WITH') {
      if (sk.attributeType !== 'S') {
        throw new ApiRequestError('begins_with is only valid for String sort keys.', 'BadRequest', 400);
      }
      values[':sk1'] = mk(sortKey.value1.trim());
      skExpr = 'begins_with(#sk, :sk1)';
    } else {
      values[':sk1'] = mk(sortKey.value1.trim());
      skExpr = `#sk ${sortKey.operator} :sk1`;
    }
    expr += ` AND ${skExpr}`;
  }

  return { KeyConditionExpression: expr, ExpressionAttributeNames: names, ExpressionAttributeValues: values };
}

// ----------------------------------------------------------------- indexes

async function createGlobalSecondaryIndex(
  table: DynamoTable,
  payload: {
    indexName: string;
    partitionKey: { name: string; type: AttributeScalarType };
    sortKey?: { name: string; type: AttributeScalarType };
    projectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
    nonKeyAttributes?: string[];
  },
): Promise<{ ok: boolean }> {
  const indexName = payload.indexName.trim();
  if (!KEY_NAME_RE.test(indexName)) {
    throw new ApiRequestError('Index name contains invalid characters.', 'BadRequest', 400);
  }
  if (!payload.partitionKey.name.trim()) {
    throw new ApiRequestError('Index partition key name is required.', 'BadRequest', 400);
  }
  if (payload.projectionType === 'INCLUDE' && (payload.nonKeyAttributes ?? []).length === 0) {
    throw new ApiRequestError('The INCLUDE projection requires at least one non-key attribute.', 'BadRequest', 400);
  }

  const keySchema: KeySchemaElement[] = [{ AttributeName: payload.partitionKey.name.trim(), KeyType: 'HASH' }];
  if (payload.sortKey) {
    keySchema.push({ AttributeName: payload.sortKey.name.trim(), KeyType: 'RANGE' });
  }

  // Key attributes of a new index must be declared in AttributeDefinitions (real AWS behavior).
  const defs = new Map(table.keySchema.map((k) => [k.attributeName, k.attributeType]));
  defs.set(payload.partitionKey.name.trim(), payload.partitionKey.type);
  if (payload.sortKey) defs.set(payload.sortKey.name.trim(), payload.sortKey.type);
  const attributeDefinitions = Array.from(defs.entries()).map(([AttributeName, AttributeType]) => ({ AttributeName, AttributeType }));

  try {
    await getDynamoClient().send(
      new UpdateTableCommand({
        TableName: table.name,
        AttributeDefinitions: attributeDefinitions,
        GlobalSecondaryIndexUpdates: [
          {
            Create: {
              IndexName: indexName,
              KeySchema: keySchema,
              Projection: {
                ProjectionType: payload.projectionType,
                ...(payload.projectionType === 'INCLUDE' ? { NonKeyAttributes: payload.nonKeyAttributes } : {}),
              },
              // Provisioned tables require throughput on new indexes; on-demand tables inherit it.
              ...(table.billingMode === 'PROVISIONED' && table.provisionedThroughput
                ? {
                    ProvisionedThroughput: {
                      ReadCapacityUnits: table.provisionedThroughput.read,
                      WriteCapacityUnits: table.provisionedThroughput.write,
                    },
                  }
                : {}),
            },
          },
        ],
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteGlobalSecondaryIndex(tableName: string, indexName: string): Promise<{ ok: boolean }> {
  try {
    await getDynamoClient().send(
      new UpdateTableCommand({
        TableName: tableName,
        GlobalSecondaryIndexUpdates: [{ Delete: { IndexName: indexName } }],
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ----------------------------------------------------------------- backups

async function listBackups(tableName?: string): Promise<{ backups: DynamoBackup[] }> {
  try {
    const client = getDynamoClient();
    const backups: DynamoBackup[] = [];
    let next: string | undefined;
    do {
      const resp = await client.send(new ListBackupsCommand({ TableName: tableName, ExclusiveStartBackupArn: next }));
      for (const b of resp.BackupSummaries ?? []) {
        backups.push({
          backupName: b.BackupName ?? '',
          backupArn: b.BackupArn ?? '',
          tableName: b.TableName ?? '',
          status: b.BackupStatus ?? null,
          type: b.BackupType ?? null,
          sizeBytes: b.BackupSizeBytes ?? null,
          creationDate: b.BackupCreationDateTime ? b.BackupCreationDateTime.toISOString() : null,
        });
      }
      next = resp.LastEvaluatedBackupArn;
    } while (next);
    return { backups };
  } catch (err) {
    throw toApiError(err);
  }
}

async function createBackup(tableName: string, backupName: string): Promise<{ ok: boolean }> {
  if (!backupName.trim()) {
    throw new ApiRequestError('Backup name is required.', 'BadRequest', 400);
  }
  try {
    await getDynamoClient().send(new CreateBackupCommand({ TableName: tableName, BackupName: backupName.trim() }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteBackup(backupArn: string): Promise<{ ok: boolean }> {
  try {
    await getDynamoClient().send(new DeleteBackupCommand({ BackupArn: backupArn }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// -------------------------------------------------------------------- tags

async function getTableTags(arn: string): Promise<{ tags: Record<string, string> }> {
  try {
    return { tags: await listTagsInternal(getDynamoClient(), arn) };
  } catch (err) {
    throw toApiError(err);
  }
}

async function tagTable(arn: string, tags: Record<string, string>): Promise<{ ok: boolean }> {
  try {
    await getDynamoClient().send(
      new TagResourceCommand({ ResourceArn: arn, Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function untagTable(arn: string, tagKeys: string[]): Promise<{ ok: boolean }> {
  try {
    await getDynamoClient().send(new UntagResourceCommand({ ResourceArn: arn, TagKeys: tagKeys }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ----------------------------------------------------------------------- api

export const dynamoApi = {
  listTables,
  getTable,
  createTable,
  deleteTable,
  setBillingMode,
  setTimeToLive,
  scanTable,
  queryTable,
  putItem,
  updateItem,
  deleteItems,
  createGlobalSecondaryIndex,
  deleteGlobalSecondaryIndex,
  listBackups,
  createBackup,
  deleteBackup,
  getTableTags,
  tagTable,
  untagTable,
};
