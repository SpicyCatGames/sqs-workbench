import {
  LambdaClient,
  type LambdaClientConfig,
  type Architecture,
  type EventSourcePosition,
  type Runtime,
  AddPermissionCommand,
  CreateAliasCommand,
  CreateEventSourceMappingCommand,
  CreateFunctionCommand,
  DeleteAliasCommand,
  DeleteEventSourceMappingCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  GetPolicyCommand,
  InvokeCommand,
  ListAliasesCommand,
  ListEventSourceMappingsCommand,
  ListFunctionsCommand,
  ListTagsCommand,
  ListVersionsByFunctionCommand,
  PublishVersionCommand,
  RemovePermissionCommand,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateAliasCommand,
  UpdateEventSourceMappingCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';
import { ApiRequestError, toApiError } from './api';
import { loadSettings } from './settingsStore';

// ------------------------------------------------------------------ types

export interface LambdaFunctionSummary {
  functionName: string;
  functionArn: string;
  runtime: string;
  handler: string;
  description: string;
  lastModified: string;
  codeSize: number;
  memorySize: number;
  timeout: number;
  architectures: string[];
  version: string;
  packageType: string;
  state?: string;
  lastUpdateStatus?: string;
  role?: string;
  ephemeralStorageSize?: number;
  tags: Record<string, string>;
}

export interface FunctionDetail {
  functionName: string;
  functionArn: string;
  runtime: string;
  handler: string;
  description: string;
  lastModified: string;
  codeSize: number;
  memorySize: number;
  timeout: number;
  architectures: string[];
  version: string;
  packageType: string;
  state?: string;
  stateReason?: string;
  lastUpdateStatus?: string;
  lastUpdateStatusReason?: string;
  role?: string;
  codeSha256?: string;
  revisionId?: string;
  environment?: Record<string, string>;
  ephemeralStorageSize?: number;
  loggingConfig?: { logFormat?: string; logGroup?: string };
  codeLocation?: string;
  tags: Record<string, string>;
}

export interface CreateFunctionPayload {
  name: string;
  runtime: string;
  handler: string;
  description?: string;
  memorySize?: number;
  timeout?: number;
  architectures?: string[];
  role?: string;
  environment?: Record<string, string>;
  tags?: Record<string, string>;
  zipFile?: Uint8Array;
  s3Bucket?: string;
  s3Key?: string;
  s3ObjectVersion?: string;
}

export interface UpdateConfigPayload {
  description?: string;
  handler?: string;
  role?: string;
  memorySize?: number;
  timeout?: number;
  environment?: Record<string, string>;
  ephemeralStorageSize?: number;
}

export type InvocationType = 'RequestResponse' | 'Event' | 'DryRun';

export interface InvokePayload {
  functionName: string;
  invocationType: InvocationType;
  payload: string;
  qualifier?: string;
}

export interface InvokeResult {
  statusCode?: number;
  functionError?: string;
  logResult?: string;
  payload: string;
  executedVersion?: string;
  requestId?: string;
  durationMs: number;
}

export interface LambdaVersion {
  version: string;
  description?: string;
  lastModified?: string;
  codeSize?: number;
  state?: string;
}

export interface LambdaAlias {
  name: string;
  functionVersion: string;
  description?: string;
  arn: string;
  revisionId?: string;
}

export interface EventSourceMapping {
  uuid: string;
  functionArn?: string;
  eventSourceArn?: string;
  state?: string;
  stateTransitionReason?: string;
  batchSize?: number;
  maximumBatchingWindowInSeconds?: number;
  startingPosition?: string;
  lastModified?: string;
  enabled?: boolean;
}

export interface AddPermissionPayload {
  functionName: string;
  statementId: string;
  action: string;
  principal: string;
  sourceArn?: string;
  sourceAccount?: string;
  eventSourceToken?: string;
}

export interface CreateMappingPayload {
  functionName: string;
  eventSourceArn: string;
  batchSize?: number;
  maximumBatchingWindowInSeconds?: number;
  enabled?: boolean;
  startingPosition?: string;
}

// --------------------------------------------------------------- runtimes

export interface RuntimeOption {
  value: string;
  label: string;
  category: 'Node.js' | 'Python';
  file: string;
  handler: string;
  template: string;
}

const NODE_TEMPLATE = `exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    return {
        statusCode: 200,
        body: JSON.stringify('Hello from Lambda!'),
    };
};
`;

const PYTHON_TEMPLATE = `import json


def lambda_handler(event, context):
    print('Received event:', json.dumps(event))
    return {
        "statusCode": 200,
        "body": json.dumps("Hello from Lambda!"),
    }
`;

export const RUNTIME_OPTIONS: RuntimeOption[] = [
  { value: 'nodejs22.x', label: 'Node.js 22.x', category: 'Node.js', file: 'index.js', handler: 'index.handler', template: NODE_TEMPLATE },
  { value: 'nodejs20.x', label: 'Node.js 20.x', category: 'Node.js', file: 'index.js', handler: 'index.handler', template: NODE_TEMPLATE },
  { value: 'nodejs18.x', label: 'Node.js 18.x', category: 'Node.js', file: 'index.js', handler: 'index.handler', template: NODE_TEMPLATE },
  { value: 'nodejs16.x', label: 'Node.js 16.x', category: 'Node.js', file: 'index.js', handler: 'index.handler', template: NODE_TEMPLATE },
  { value: 'python3.13', label: 'Python 3.13', category: 'Python', file: 'lambda_function.py', handler: 'lambda_function.lambda_handler', template: PYTHON_TEMPLATE },
  { value: 'python3.12', label: 'Python 3.12', category: 'Python', file: 'lambda_function.py', handler: 'lambda_function.lambda_handler', template: PYTHON_TEMPLATE },
  { value: 'python3.11', label: 'Python 3.11', category: 'Python', file: 'lambda_function.py', handler: 'lambda_function.lambda_handler', template: PYTHON_TEMPLATE },
  { value: 'python3.10', label: 'Python 3.10', category: 'Python', file: 'lambda_function.py', handler: 'lambda_function.lambda_handler', template: PYTHON_TEMPLATE },
  { value: 'python3.9', label: 'Python 3.9', category: 'Python', file: 'lambda_function.py', handler: 'lambda_function.lambda_handler', template: PYTHON_TEMPLATE },
];

export function runtimeOption(value: string): RuntimeOption | undefined {
  return RUNTIME_OPTIONS.find((r) => r.value === value);
}

export function handlerFileForRuntime(runtime: string, handler: string): string {
  const opt = runtimeOption(runtime);
  if (opt) return opt.file;
  // Fall back to the first segment of the handler ("index" for "index.handler").
  const file = handler.split('.')[0];
  return runtime.startsWith('python') ? `${file}.py` : `${file}.js`;
}

/** The default execution role ARN used by the emulators (any role passes locally). */
export function defaultRoleArn(): string {
  return `arn:aws:iam::000000000000:role/lambda-role`;
}

export function functionArnFromName(name: string, region: string): string {
  return `arn:aws:lambda:${region}:000000000000:function:${name}`;
}

// ---------------------------------------------------------------- client

let cachedClient: LambdaClient | null = null;
let cachedClientKey = '';

function getLambdaClient(): LambdaClient {
  const s = loadSettings();
  const key = `${s.endpoint}|${s.region}|${s.accessKey}|${s.secretKey}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;

  const config: LambdaClientConfig = {
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

  cachedClient = new LambdaClient(config);
  cachedClientKey = key;
  return cachedClient;
}

// ----------------------------------------------------------------- funcs

function toSummary(c: {
  FunctionName?: string;
  FunctionArn?: string;
  Runtime?: string;
  Handler?: string;
  Description?: string;
  LastModified?: string;
  CodeSize?: number;
  MemorySize?: number;
  Timeout?: number;
  Architectures?: string[];
  Version?: string;
  PackageType?: string;
  State?: string;
  LastUpdateStatus?: string;
  Role?: string;
  EphemeralStorage?: { Size?: number };
}): LambdaFunctionSummary {
  return {
    functionName: c.FunctionName ?? '',
    functionArn: c.FunctionArn ?? '',
    runtime: c.Runtime ?? '',
    handler: c.Handler ?? '',
    description: c.Description ?? '',
    lastModified: c.LastModified ?? '',
    codeSize: c.CodeSize ?? 0,
    memorySize: c.MemorySize ?? 0,
    timeout: c.Timeout ?? 0,
    architectures: c.Architectures ?? ['x86_64'],
    version: c.Version ?? '$LATEST',
    packageType: c.PackageType ?? 'Zip',
    state: c.State,
    lastUpdateStatus: c.LastUpdateStatus,
    role: c.Role,
    ephemeralStorageSize: c.EphemeralStorage?.Size,
    tags: {},
  };
}

async function listFunctions(): Promise<{ functions: LambdaFunctionSummary[] }> {
  try {
    const client = getLambdaClient();
    const functions: LambdaFunctionSummary[] = [];
    let marker: string | undefined;
    do {
      const resp = await client.send(new ListFunctionsCommand({ Marker: marker }));
      for (const fn of resp.Functions ?? []) {
        functions.push(toSummary(fn));
      }
      marker = resp.NextMarker;
    } while (marker);

    // Populate tags with bounded parallelism.
    const THROTTLE = 20;
    for (let i = 0; i < functions.length; i += THROTTLE) {
      await Promise.all(
        functions.slice(i, i + THROTTLE).map(async (fn) => {
          try {
            const tagsResp = await client.send(new ListTagsCommand({ Resource: fn.functionArn }));
            fn.tags = tagsResp.Tags ?? {};
          } catch {
            /* keep the function visible even if tag fetch fails */
          }
        }),
      );
    }
    return { functions };
  } catch (err) {
    throw toApiError(err);
  }
}

async function getFunction(name: string): Promise<FunctionDetail> {
  try {
    const client = getLambdaClient();
    const [resp, tagsResp] = await Promise.all([
      client.send(new GetFunctionCommand({ FunctionName: name })),
      client.send(new ListTagsCommand({ Resource: functionArnFromName(name, loadSettings().region.trim() || 'us-east-1') })),
    ]);
    const c = resp.Configuration ?? {};
    return {
      functionName: c.FunctionName ?? name,
      functionArn: c.FunctionArn ?? '',
      runtime: c.Runtime ?? '',
      handler: c.Handler ?? '',
      description: c.Description ?? '',
      lastModified: c.LastModified ?? '',
      codeSize: c.CodeSize ?? 0,
      memorySize: c.MemorySize ?? 0,
      timeout: c.Timeout ?? 0,
      architectures: c.Architectures ?? ['x86_64'],
      version: c.Version ?? '$LATEST',
      packageType: c.PackageType ?? 'Zip',
      state: c.State,
      stateReason: c.StateReason,
      lastUpdateStatus: c.LastUpdateStatus,
      lastUpdateStatusReason: c.LastUpdateStatusReason,
      role: c.Role,
      codeSha256: c.CodeSha256,
      revisionId: c.RevisionId,
      environment: c.Environment?.Variables ?? {},
      ephemeralStorageSize: c.EphemeralStorage?.Size,
      loggingConfig: c.LoggingConfig ? { logFormat: c.LoggingConfig.LogFormat, logGroup: c.LoggingConfig.LogGroup } : undefined,
      codeLocation: resp.Code?.Location,
      tags: tagsResp.Tags ?? {},
    };
  } catch (err) {
    throw toApiError(err);
  }
}

async function createFunction(payload: CreateFunctionPayload): Promise<{ functionName: string }> {
  const name = payload.name.trim();
  if (!name) {
    throw new ApiRequestError('Function name is required.', 'BadRequest', 400);
  }
  if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
    throw new ApiRequestError('Function names can only contain letters, numbers, hyphens and underscores.', 'BadRequest', 400);
  }
  if (!payload.runtime) {
    throw new ApiRequestError('A runtime is required.', 'BadRequest', 400);
  }
  if (!payload.handler?.trim()) {
    throw new ApiRequestError('A handler is required.', 'BadRequest', 400);
  }
  if (!payload.zipFile && !(payload.s3Bucket && payload.s3Key)) {
    throw new ApiRequestError('Function code is required — upload a .zip file or reference a package in S3.', 'BadRequest', 400);
  }
  try {
    await getLambdaClient().send(
      new CreateFunctionCommand({
        FunctionName: name,
        Runtime: payload.runtime as Runtime,
        Handler: payload.handler.trim(),
        Role: payload.role?.trim() || defaultRoleArn(),
        Description: payload.description?.trim() || undefined,
        MemorySize: payload.memorySize ?? 128,
        Timeout: payload.timeout ?? 3,
        Architectures: payload.architectures?.length ? (payload.architectures as Architecture[]) : undefined,
        Environment: payload.environment && Object.keys(payload.environment).length > 0 ? { Variables: payload.environment } : undefined,
        Tags: payload.tags && Object.keys(payload.tags).length > 0 ? payload.tags : undefined,
        Code: payload.zipFile
          ? { ZipFile: payload.zipFile }
          : { S3Bucket: payload.s3Bucket, S3Key: payload.s3Key, S3ObjectVersion: payload.s3ObjectVersion || undefined },
      }),
    );
    return { functionName: name };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteFunction(name: string): Promise<{ ok: boolean }> {
  try {
    await getLambdaClient().send(new DeleteFunctionCommand({ FunctionName: name }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ------------------------------------------------------------------ code

async function updateFunctionCodeZip(name: string, zipFile: Uint8Array): Promise<{ ok: boolean }> {
  try {
    await getLambdaClient().send(new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: zipFile }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function updateFunctionCodeFromS3(
  name: string,
  s3Bucket: string,
  s3Key: string,
  s3ObjectVersion?: string,
): Promise<{ ok: boolean }> {
  if (!s3Bucket.trim() || !s3Key.trim()) {
    throw new ApiRequestError('Bucket and key are required.', 'BadRequest', 400);
  }
  try {
    await getLambdaClient().send(
      new UpdateFunctionCodeCommand({
        FunctionName: name,
        S3Bucket: s3Bucket.trim(),
        S3Key: s3Key.trim(),
        S3ObjectVersion: s3ObjectVersion?.trim() || undefined,
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function updateFunctionConfiguration(name: string, payload: UpdateConfigPayload): Promise<{ ok: boolean }> {
  try {
    await getLambdaClient().send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: name,
        Description: payload.description !== undefined ? payload.description : undefined,
        Handler: payload.handler !== undefined ? payload.handler : undefined,
        Role: payload.role !== undefined ? payload.role : undefined,
        MemorySize: payload.memorySize,
        Timeout: payload.timeout,
        Environment: payload.environment !== undefined ? { Variables: payload.environment } : undefined,
        EphemeralStorage: payload.ephemeralStorageSize !== undefined ? { Size: payload.ephemeralStorageSize } : undefined,
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ----------------------------------------------------------------- invoke

async function invoke(payload: InvokePayload): Promise<InvokeResult> {
  if (!payload.payload.trim()) {
    throw new ApiRequestError('A test event (JSON payload) is required.', 'BadRequest', 400);
  }
  const started = performance.now();
  try {
    const resp = await getLambdaClient().send(
      new InvokeCommand({
        FunctionName: payload.functionName,
        InvocationType: payload.invocationType,
        Qualifier: payload.qualifier || undefined,
        LogType: 'Tail',
        Payload: new TextEncoder().encode(payload.payload),
      }),
    );
    return {
      statusCode: resp.StatusCode,
      functionError: resp.FunctionError,
      logResult: resp.LogResult,
      payload: resp.Payload ? new TextDecoder().decode(resp.Payload) : '',
      executedVersion: resp.ExecutedVersion,
      requestId: resp.$metadata.requestId,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    throw toApiError(err);
  }
}

// ----------------------------------------------------------- versions

async function publishVersion(name: string, description?: string): Promise<{ version: string }> {
  try {
    const resp = await getLambdaClient().send(
      new PublishVersionCommand({ FunctionName: name, Description: description?.trim() || undefined }),
    );
    return { version: resp.Version ?? '' };
  } catch (err) {
    throw toApiError(err);
  }
}

async function listVersions(name: string): Promise<{ versions: LambdaVersion[] }> {
  try {
    const client = getLambdaClient();
    const versions: LambdaVersion[] = [];
    let marker: string | undefined;
    do {
      const resp = await client.send(new ListVersionsByFunctionCommand({ FunctionName: name, Marker: marker }));
      for (const v of resp.Versions ?? []) {
        versions.push({
          version: v.Version ?? '',
          description: v.Description,
          lastModified: v.LastModified,
          codeSize: v.CodeSize,
          state: v.State,
        });
      }
      marker = resp.NextMarker;
    } while (marker);
    return { versions };
  } catch (err) {
    throw toApiError(err);
  }
}

// ----------------------------------------------------------------- aliases

async function listAliases(name: string): Promise<{ aliases: LambdaAlias[] }> {
  try {
    const resp = await getLambdaClient().send(new ListAliasesCommand({ FunctionName: name }));
    return {
      aliases: (resp.Aliases ?? []).map((a) => ({
        name: a.Name ?? '',
        functionVersion: a.FunctionVersion ?? '',
        description: a.Description,
        arn: a.AliasArn ?? '',
        revisionId: a.RevisionId,
      })),
    };
  } catch (err) {
    throw toApiError(err);
  }
}

async function createAlias(
  name: string,
  aliasName: string,
  functionVersion: string,
  description?: string,
): Promise<{ ok: boolean }> {
  if (!aliasName.trim()) {
    throw new ApiRequestError('Alias name is required.', 'BadRequest', 400);
  }
  try {
    await getLambdaClient().send(
      new CreateAliasCommand({
        FunctionName: name,
        Name: aliasName.trim(),
        FunctionVersion: functionVersion,
        Description: description?.trim() || undefined,
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function updateAlias(
  name: string,
  aliasName: string,
  functionVersion?: string,
  description?: string,
): Promise<{ ok: boolean }> {
  try {
    await getLambdaClient().send(
      new UpdateAliasCommand({
        FunctionName: name,
        Name: aliasName,
        FunctionVersion: functionVersion,
        Description: description !== undefined ? description : undefined,
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteAlias(name: string, aliasName: string): Promise<{ ok: boolean }> {
  try {
    await getLambdaClient().send(new DeleteAliasCommand({ FunctionName: name, Name: aliasName }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// -------------------------------------------------------------- policies

async function getFunctionPolicy(name: string): Promise<{ policy: string; revisionId?: string }> {
  try {
    const resp = await getLambdaClient().send(new GetPolicyCommand({ FunctionName: name }));
    return { policy: resp.Policy ?? '', revisionId: resp.RevisionId };
  } catch (err) {
    const e = toApiError(err);
    // No policy attached is a normal state — surface it as empty.
    if (e.name === 'ResourceNotFoundException' || /resource not found/i.test(e.message)) {
      return { policy: '' };
    }
    throw e;
  }
}

async function addPermission(payload: AddPermissionPayload): Promise<{ ok: boolean }> {
  if (!payload.statementId.trim()) {
    throw new ApiRequestError('Statement ID is required.', 'BadRequest', 400);
  }
  if (!payload.action.trim()) {
    throw new ApiRequestError('Action is required.', 'BadRequest', 400);
  }
  if (!payload.principal.trim()) {
    throw new ApiRequestError('Principal is required.', 'BadRequest', 400);
  }
  try {
    await getLambdaClient().send(
      new AddPermissionCommand({
        FunctionName: payload.functionName,
        StatementId: payload.statementId.trim(),
        Action: payload.action.trim(),
        Principal: payload.principal.trim(),
        SourceArn: payload.sourceArn?.trim() || undefined,
        SourceAccount: payload.sourceAccount?.trim() || undefined,
        EventSourceToken: payload.eventSourceToken?.trim() || undefined,
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function removePermission(name: string, statementId: string): Promise<{ ok: boolean }> {
  try {
    await getLambdaClient().send(new RemovePermissionCommand({ FunctionName: name, StatementId: statementId }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ------------------------------------------------- event source mappings

async function listEventSourceMappings(functionName?: string): Promise<{ mappings: EventSourceMapping[] }> {
  try {
    const client = getLambdaClient();
    const mappings: EventSourceMapping[] = [];
    let marker: string | undefined;
    do {
      const resp = await client.send(
        new ListEventSourceMappingsCommand({ FunctionName: functionName, Marker: marker }),
      );
      for (const m of resp.EventSourceMappings ?? []) {
        mappings.push({
          uuid: m.UUID ?? '',
          functionArn: m.FunctionArn,
          eventSourceArn: m.EventSourceArn,
          state: m.State,
          stateTransitionReason: m.StateTransitionReason,
          batchSize: m.BatchSize,
          maximumBatchingWindowInSeconds: m.MaximumBatchingWindowInSeconds,
          startingPosition: m.StartingPosition,
          lastModified: m.LastModified?.toISOString(),
          enabled: m.State === 'Enabled',
        });
      }
      marker = resp.NextMarker;
    } while (marker);
    return { mappings };
  } catch (err) {
    throw toApiError(err);
  }
}

async function createEventSourceMapping(payload: CreateMappingPayload): Promise<{ uuid: string }> {
  if (!payload.eventSourceArn.trim()) {
    throw new ApiRequestError('Event source ARN is required.', 'BadRequest', 400);
  }
  try {
    const resp = await getLambdaClient().send(
      new CreateEventSourceMappingCommand({
        FunctionName: payload.functionName,
        EventSourceArn: payload.eventSourceArn.trim(),
        BatchSize: payload.batchSize,
        MaximumBatchingWindowInSeconds: payload.maximumBatchingWindowInSeconds,
        Enabled: payload.enabled ?? true,
        StartingPosition: payload.startingPosition ? (payload.startingPosition as EventSourcePosition) : undefined,
      }),
    );
    return { uuid: resp.UUID ?? '' };
  } catch (err) {
    throw toApiError(err);
  }
}

async function updateEventSourceMapping(
  uuid: string,
  patch: { batchSize?: number; maximumBatchingWindowInSeconds?: number; enabled?: boolean },
): Promise<{ ok: boolean }> {
  try {
    await getLambdaClient().send(
      new UpdateEventSourceMappingCommand({
        UUID: uuid,
        BatchSize: patch.batchSize,
        MaximumBatchingWindowInSeconds: patch.maximumBatchingWindowInSeconds,
        Enabled: patch.enabled,
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteEventSourceMapping(uuid: string): Promise<{ ok: boolean }> {
  try {
    await getLambdaClient().send(new DeleteEventSourceMappingCommand({ UUID: uuid }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ------------------------------------------------------------------- tags

async function tagFunction(arn: string, tags: Record<string, string>): Promise<{ ok: boolean }> {
  try {
    await getLambdaClient().send(new TagResourceCommand({ Resource: arn, Tags: tags }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function untagFunction(arn: string, tagKeys: string[]): Promise<{ ok: boolean }> {
  try {
    await getLambdaClient().send(new UntagResourceCommand({ Resource: arn, TagKeys: tagKeys }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// -------------------------------------------------------------------- api

export const lambdaApi = {
  listFunctions,
  getFunction,
  createFunction,
  deleteFunction,
  updateFunctionCodeZip,
  updateFunctionCodeFromS3,
  updateFunctionConfiguration,
  invoke,
  publishVersion,
  listVersions,
  listAliases,
  createAlias,
  updateAlias,
  deleteAlias,
  getFunctionPolicy,
  addPermission,
  removePermission,
  listEventSourceMappings,
  createEventSourceMapping,
  updateEventSourceMapping,
  deleteEventSourceMapping,
  tagFunction,
  untagFunction,
};
