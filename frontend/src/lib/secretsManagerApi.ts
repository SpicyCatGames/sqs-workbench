import {
  SecretsManagerClient,
  type SecretsManagerClientConfig,
  CancelRotateSecretCommand,
  CreateSecretCommand,
  DeleteResourcePolicyCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetResourcePolicyCommand,
  GetSecretValueCommand,
  ListSecretVersionIdsCommand,
  ListSecretsCommand,
  PutResourcePolicyCommand,
  PutSecretValueCommand,
  RestoreSecretCommand,
  RotateSecretCommand,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateSecretCommand,
  UpdateSecretVersionStageCommand,
  type RotationRulesType,
} from '@aws-sdk/client-secrets-manager';
import { ApiRequestError, toApiError } from './api';
import { loadSettings } from './settingsStore';

// ------------------------------------------------------------------ types

export interface SmSecret {
  name: string;
  arn: string;
  description?: string;
  tags: Record<string, string>;
  createdDate?: string;
  lastChangedDate?: string;
  lastAccessedDate?: string;
  deletedDate?: string;
  rotationEnabled: boolean;
  rotationLambdaArn?: string;
  rotationRules?: { automaticallyAfterDays?: number; scheduleExpression?: string; duration?: string };
  lastRotatedDate?: string;
  owningService?: string;
  kmsKeyId?: string;
  versionsToStages: Record<string, string[]>;
}

export interface SecretValue {
  name: string;
  arn: string;
  versionId?: string;
  versionStages: string[];
  secretString?: string;
  /** Base64-encoded binary payload (only set when the secret holds a binary value). */
  secretBinaryBase64?: string;
  createdDate?: string;
}

export interface SecretVersion {
  versionId: string;
  stages: string[];
  createdDate?: string;
}

export type SecretType = 'rds' | 'database' | 'other';

export interface CreateSecretPayload {
  name: string;
  description?: string;
  secretString: string;
  kmsKeyId?: string;
  tags?: Record<string, string>;
  rotationLambdaArn?: string;
  /** Number of days between automatic rotations (mutually exclusive with scheduleExpression). */
  automaticallyAfterDays?: number;
  /** Custom schedule expression, e.g. "cron(0 16 1 * ? *)" or "rate(10 days)". */
  scheduleExpression?: string;
}

export interface RotationConfig {
  enabled: boolean;
  lambdaArn?: string;
  automaticallyAfterDays?: number;
  scheduleExpression?: string;
  rotateImmediately?: boolean;
}

// ------------------------------------------------------- Secrets Manager client

let cachedClient: SecretsManagerClient | null = null;
let cachedClientKey = '';

function getSmClient(): SecretsManagerClient {
  const s = loadSettings();
  const key = `${s.endpoint}|${s.region}|${s.accessKey}|${s.secretKey}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;

  const config: SecretsManagerClientConfig = {
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

  cachedClient = new SecretsManagerClient(config);
  cachedClientKey = key;
  return cachedClient;
}

// ------------------------------------------------------------------ helpers

/** True when the endpoint answered but does not implement the operation (emulators). */
export function isUnsupportedOperation(err: unknown): boolean {
  return !!err && typeof err === 'object' && /(not supported|not implemented|not yet implemented|unknown operation|unsupported)/i.test(String((err as { message?: string })?.message ?? ''));
}

/** Extract the secret name from a secret ARN. */
export function secretNameFromArn(arn: string): string {
  // ARN format: arn:aws:secretsmanager:region:account:secret:name-Random6
  const parts = arn.split(':');
  const last = parts[parts.length - 1] ?? arn;
  // Secrets Manager appends a 6-char suffix to the name inside the ARN.
  return last.replace(/-[A-Za-z0-9]{6}$/, '') || last;
}

function iso(date: Date | undefined): string | undefined {
  return date ? date.toISOString() : undefined;
}

function tagsFrom(tags?: Array<{ Key?: string; Value?: string }>): Record<string, string> {
  return Object.fromEntries((tags ?? []).filter((t) => t.Key).map((t) => [t.Key as string, t.Value ?? '']));
}

function rulesFrom(rules?: RotationRulesType): SmSecret['rotationRules'] {
  if (!rules) return undefined;
  return {
    automaticallyAfterDays: rules.AutomaticallyAfterDays,
    scheduleExpression: rules.ScheduleExpression,
    duration: rules.Duration,
  };
}

/** Convert a Uint8Array secret binary to a base64 string (chunked to avoid stack overflow). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ------------------------------------------------------------------- secrets

async function listSecrets(): Promise<{ secrets: SmSecret[] }> {
  try {
    const client = getSmClient();
    const secrets: SmSecret[] = [];
    let nextToken: string | undefined;
    do {
      const resp = await client.send(new ListSecretsCommand({ NextToken: nextToken, MaxResults: 100 }));
      for (const s of resp.SecretList ?? []) {
        secrets.push({
          name: s.Name ?? '',
          arn: s.ARN ?? '',
          description: s.Description,
          tags: tagsFrom(s.Tags),
          createdDate: iso(s.CreatedDate),
          lastChangedDate: iso(s.LastChangedDate),
          lastAccessedDate: iso(s.LastAccessedDate),
          deletedDate: iso(s.DeletedDate),
          rotationEnabled: s.RotationEnabled === true,
          rotationLambdaArn: s.RotationLambdaARN,
          rotationRules: rulesFrom(s.RotationRules),
          owningService: s.OwningService,
          kmsKeyId: s.KmsKeyId,
          versionsToStages: Object.fromEntries(Object.entries(s.SecretVersionsToStages ?? {}).map(([k, v]) => [k, v ?? []])),
        });
      }
      nextToken = resp.NextToken;
    } while (nextToken);
    return { secrets };
  } catch (err) {
    throw toApiError(err);
  }
}

async function getSecret(nameOrArn: string): Promise<SmSecret> {
  try {
    const resp = await getSmClient().send(new DescribeSecretCommand({ SecretId: nameOrArn }));
    return {
      name: resp.Name ?? '',
      arn: resp.ARN ?? '',
      description: resp.Description,
      tags: tagsFrom(resp.Tags),
      createdDate: iso(resp.CreatedDate),
      lastChangedDate: iso(resp.LastChangedDate),
      lastAccessedDate: iso(resp.LastAccessedDate),
      deletedDate: iso(resp.DeletedDate),
      rotationEnabled: resp.RotationEnabled === true,
      rotationLambdaArn: resp.RotationLambdaARN,
      rotationRules: rulesFrom(resp.RotationRules),
      lastRotatedDate: iso(resp.LastRotatedDate),
      owningService: resp.OwningService,
      kmsKeyId: resp.KmsKeyId,
      versionsToStages: Object.fromEntries(Object.entries(resp.VersionIdsToStages ?? {}).map(([k, v]) => [k, v ?? []])),
    };
  } catch (err) {
    throw toApiError(err);
  }
}

async function createSecret(payload: CreateSecretPayload): Promise<{ arn: string; versionId?: string }> {
  const name = payload.name.trim();
  if (!name) {
    throw new ApiRequestError('Secret name is required.', 'BadRequest', 400);
  }
  if (!payload.secretString) {
    throw new ApiRequestError('A secret value is required.', 'BadRequest', 400);
  }
  try {
    const client = getSmClient();
    const resp = await client.send(
      new CreateSecretCommand({
        Name: name,
        Description: payload.description?.trim() || undefined,
        SecretString: payload.secretString,
        KmsKeyId: payload.kmsKeyId?.trim() || undefined,
        Tags: payload.tags && Object.keys(payload.tags).length > 0 ? Object.entries(payload.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
      }),
    );

    if (payload.rotationLambdaArn?.trim()) {
      try {
        await enableRotationInternal(name, {
          enabled: true,
          lambdaArn: payload.rotationLambdaArn.trim(),
          automaticallyAfterDays: payload.automaticallyAfterDays,
          scheduleExpression: payload.scheduleExpression,
        });
      } catch {
        /* rotation is best-effort on emulators that do not implement it */
      }
    }

    return { arn: resp.ARN ?? '', versionId: resp.VersionId };
  } catch (err) {
    throw toApiError(err);
  }
}

async function updateSecret(secretId: string, patch: { description?: string; kmsKeyId?: string }): Promise<{ ok: boolean }> {
  try {
    await getSmClient().send(
      new UpdateSecretCommand({
        SecretId: secretId,
        Description: patch.description?.trim() || undefined,
        KmsKeyId: patch.kmsKeyId?.trim() || undefined,
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteSecret(secretId: string, opts: { recoveryWindowInDays?: number; forceDeleteWithoutRecovery?: boolean }): Promise<{ deletionDate?: string }> {
  if (!opts.forceDeleteWithoutRecovery && !opts.recoveryWindowInDays) {
    throw new ApiRequestError('Choose either a recovery window or force deletion.', 'BadRequest', 400);
  }
  try {
    const resp = await getSmClient().send(
      new DeleteSecretCommand({
        SecretId: secretId,
        RecoveryWindowInDays: opts.forceDeleteWithoutRecovery ? undefined : opts.recoveryWindowInDays,
        ForceDeleteWithoutRecovery: opts.forceDeleteWithoutRecovery || undefined,
      }),
    );
    return { deletionDate: iso(resp.DeletionDate) };
  } catch (err) {
    throw toApiError(err);
  }
}

async function restoreSecret(secretId: string): Promise<{ ok: boolean }> {
  try {
    await getSmClient().send(new RestoreSecretCommand({ SecretId: secretId }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ------------------------------------------------------------- secret value

async function getSecretValue(nameOrArn: string, versionId?: string): Promise<SecretValue> {
  try {
    const resp = await getSmClient().send(new GetSecretValueCommand({ SecretId: nameOrArn, VersionId: versionId || undefined }));
    let binary: string | undefined;
    if (resp.SecretBinary) {
      binary = bytesToBase64(resp.SecretBinary);
    }
    return {
      name: resp.Name ?? '',
      arn: resp.ARN ?? '',
      versionId: resp.VersionId,
      versionStages: resp.VersionStages ?? [],
      secretString: resp.SecretString,
      secretBinaryBase64: binary,
      createdDate: iso(resp.CreatedDate),
    };
  } catch (err) {
    throw toApiError(err);
  }
}

async function putSecretValue(secretId: string, secretString: string): Promise<{ versionId?: string }> {
  if (!secretString) {
    throw new ApiRequestError('The secret value cannot be empty.', 'BadRequest', 400);
  }
  try {
    const resp = await getSmClient().send(new PutSecretValueCommand({ SecretId: secretId, SecretString: secretString }));
    return { versionId: resp.VersionId };
  } catch (err) {
    throw toApiError(err);
  }
}

async function listSecretVersions(secretId: string): Promise<{ versions: SecretVersion[] }> {
  try {
    const resp = await getSmClient().send(new ListSecretVersionIdsCommand({ SecretId: secretId }));
    const versions: SecretVersion[] = (resp.Versions ?? [])
      .map((v) => ({
        versionId: v.VersionId ?? '',
        stages: v.VersionStages ?? [],
        createdDate: iso(v.CreatedDate),
      }))
      .sort((a, b) => (b.createdDate ?? '').localeCompare(a.createdDate ?? ''));
    return { versions };
  } catch (err) {
    throw toApiError(err);
  }
}

/** Move the AWSCURRENT stage onto a specific version (roll back / promote). */
async function setCurrentVersion(secretId: string, versionId: string, removeFromVersionId?: string): Promise<{ ok: boolean }> {
  try {
    await getSmClient().send(
      new UpdateSecretVersionStageCommand({
        SecretId: secretId,
        VersionStage: 'AWSCURRENT',
        MoveToVersionId: versionId,
        RemoveFromVersionId: removeFromVersionId,
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// --------------------------------------------------------------------- tags

async function tagSecret(secretId: string, tags: Record<string, string>): Promise<{ ok: boolean }> {
  try {
    await getSmClient().send(
      new TagResourceCommand({ SecretId: secretId, Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function untagSecret(secretId: string, tagKeys: string[]): Promise<{ ok: boolean }> {
  try {
    await getSmClient().send(new UntagResourceCommand({ SecretId: secretId, TagKeys: tagKeys }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// --------------------------------------------------------- resource policy

async function getResourcePolicy(secretId: string): Promise<{ policy?: string }> {
  try {
    const resp = await getSmClient().send(new GetResourcePolicyCommand({ SecretId: secretId }));
    return { policy: resp.ResourcePolicy };
  } catch (err) {
    throw toApiError(err);
  }
}

async function putResourcePolicy(secretId: string, policyJson: string): Promise<{ ok: boolean }> {
  try {
    await getSmClient().send(new PutResourcePolicyCommand({ SecretId: secretId, ResourcePolicy: policyJson }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteResourcePolicy(secretId: string): Promise<{ ok: boolean }> {
  try {
    await getSmClient().send(new DeleteResourcePolicyCommand({ SecretId: secretId }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ----------------------------------------------------------------- rotation

async function enableRotationInternal(secretId: string, config: RotationConfig): Promise<{ ok: boolean }> {
  const lambdaArn = config.lambdaArn?.trim();
  if (config.enabled && !lambdaArn) {
    throw new ApiRequestError('A rotation Lambda function ARN is required to enable rotation.', 'BadRequest', 400);
  }
  const rules: RotationRulesType = {};
  if (config.automaticallyAfterDays) {
    rules.AutomaticallyAfterDays = config.automaticallyAfterDays;
  }
  if (config.scheduleExpression?.trim()) {
    rules.ScheduleExpression = config.scheduleExpression.trim();
  }
  await getSmClient().send(
    new RotateSecretCommand({
      SecretId: secretId,
      RotationLambdaARN: config.enabled ? lambdaArn : undefined,
      RotationRules: Object.keys(rules).length > 0 ? rules : undefined,
      RotateImmediately: config.rotateImmediately || undefined,
    }),
  );
  return { ok: true };
}

async function enableRotation(secretId: string, config: RotationConfig): Promise<{ ok: boolean }> {
  try {
    return await enableRotationInternal(secretId, config);
  } catch (err) {
    throw toApiError(err);
  }
}

/** Disable automatic rotation. Falls back to cancelling any in-progress rotation. */
async function disableRotation(secretId: string): Promise<{ ok: boolean }> {
  try {
    await getSmClient().send(new CancelRotateSecretCommand({ SecretId: secretId }));
    return { ok: true };
  } catch (err) {
    if (isUnsupportedOperation(err)) {
      throw new ApiRequestError('Automatic rotation cannot be disabled on this endpoint (operation not supported).', 'UnsupportedOperation', 501);
    }
    throw toApiError(err);
  }
}

async function rotateSecretNow(secretId: string): Promise<{ ok: boolean }> {
  try {
    await getSmClient().send(new RotateSecretCommand({ SecretId: secretId, RotateImmediately: true }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function cancelRotation(secretId: string): Promise<{ ok: boolean }> {
  try {
    await getSmClient().send(new CancelRotateSecretCommand({ SecretId: secretId }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ----------------------------------------------------------------------- api

export const secretsManagerApi = {
  listSecrets,
  getSecret,
  createSecret,
  updateSecret,
  deleteSecret,
  restoreSecret,
  getSecretValue,
  putSecretValue,
  listSecretVersions,
  setCurrentVersion,
  tagSecret,
  untagSecret,
  getResourcePolicy,
  putResourcePolicy,
  deleteResourcePolicy,
  enableRotation,
  disableRotation,
  rotateSecretNow,
  cancelRotation,
};
