import {
  S3Client,
  type S3ClientConfig,
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteBucketCorsCommand,
  DeleteBucketEncryptionCommand,
  DeleteBucketPolicyCommand,
  DeleteBucketTaggingCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketCorsCommand,
  GetBucketEncryptionCommand,
  GetBucketLocationCommand,
  GetBucketPolicyCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  GetObjectAclCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  GetPublicAccessBlockCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutBucketEncryptionCommand,
  PutBucketPolicyCommand,
  PutBucketTaggingCommand,
  PutBucketVersioningCommand,
  PutObjectAclCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  PutPublicAccessBlockCommand,
  type BucketLocationConstraint,
  type CORSConfiguration,
  type DeleteMarkerEntry,
  type ObjectVersion,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { ApiRequestError, toApiError } from './api';
import { loadSettings } from './settingsStore';

// ------------------------------------------------------------------ types

export interface BucketItem {
  name: string;
  creationDate?: string;
  region?: string;
}

export interface S3ObjectInfo {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
  storageClass?: string;
  isFolder: boolean;
}

export interface S3VersionItem {
  key: string;
  versionId: string;
  isLatest: boolean;
  isDeleteMarker: boolean;
  size: number;
  lastModified?: string;
  etag?: string;
  storageClass?: string;
}

export interface ListObjectsResult {
  folders: S3ObjectInfo[];
  objects: S3ObjectInfo[];
  nextToken?: string;
  isTruncated: boolean;
}

export interface CreateBucketPayload {
  name: string;
  region?: string;
  versioning?: boolean;
  blockPublicAccess?: boolean;
  tags?: Record<string, string>;
}

export interface PublicAccessBlockConfig {
  blockPublicAcls: boolean;
  ignorePublicAcls: boolean;
  blockPublicPolicy: boolean;
  restrictPublicBuckets: boolean;
}

export interface BucketConfig {
  region?: string;
  creationDate?: string;
  versioning?: 'Enabled' | 'Suspended';
  tags: Record<string, string>;
  encryption?: { algorithm: string; keyId?: string } | null;
  policy?: string | null;
  cors?: string | null;
  publicAccessBlock?: PublicAccessBlockConfig | null;
}

export interface ObjectHead {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
  contentType?: string;
  storageClass?: string;
  versionId?: string;
  metadata: Record<string, string>;
}

export interface AclGrant {
  type: string;
  id?: string;
  displayName?: string;
  uri?: string;
  permission: string;
}

export interface ObjectAcl {
  owner?: { id?: string; displayName?: string };
  grants: AclGrant[];
}

export interface UploadProgress {
  loaded: number;
  total?: number;
}

// ---------------------------------------------------------------- S3 client

let cachedClient: S3Client | null = null;
let cachedClientKey = '';

function getS3Client(): S3Client {
  const s = loadSettings();
  const key = `${s.endpoint}|${s.region}|${s.accessKey}|${s.secretKey}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;

  const config: S3ClientConfig = {
    region: s.region.trim() || 'us-east-1',
    credentials: {
      accessKeyId: s.accessKey.trim() || 'test',
      secretAccessKey: s.secretKey,
    },
    // Path-style addressing keeps requests on the configured endpoint host
    // (required for local emulators; virtual-host style would send requests
    // to <bucket>.<endpoint-host>, which fails for localhost).
    forcePathStyle: true,
  };
  const endpoint = s.endpoint.trim().replace(/\/+$/, '');
  if (endpoint) {
    config.endpoint = endpoint;
  }

  cachedClient = new S3Client(config);
  cachedClientKey = key;
  return cachedClient;
}

// ------------------------------------------------------------- error mapping

/** True when the endpoint reports that a bucket/object configuration does not exist (normal S3 "not set" state). */
function isNotConfigured(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; Code?: string; message?: string };
  return /(NoSuchBucketPolicy|NoSuchCORSConfiguration|NoSuchPublicAccessBlockConfiguration|NoSuchTagSet|NoSuchEncryptionConfiguration|NoSuchKey|NotFound)/i.test(
    `${e.name ?? ''} ${e.Code ?? ''} ${e.message ?? ''}`,
  );
}

// ------------------------------------------------------------- bucket names

/** Validate an S3 bucket name with the same rules the AWS console enforces. */
export function validateBucketName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Bucket name is required.';
  if (n.length < 3 || n.length > 63) return 'Bucket names must be between 3 and 63 characters long.';
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(n)) {
    return 'Bucket names can contain only lowercase letters, numbers, periods and hyphens, and must start and end with a letter or number.';
  }
  if (n.includes('..')) return 'Bucket names cannot contain consecutive periods.';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(n)) return 'Bucket names cannot be formatted as an IP address.';
  if (n.startsWith('xn--') || n.endsWith('-s3alias') || n.endsWith('--ol-s3')) return 'This bucket name is reserved.';
  return null;
}

/** Build the canonical ARN for a bucket. */
export function bucketArn(name: string): string {
  return `arn:aws:s3:::${name}`;
}

// ------------------------------------------------------------------ buckets

async function listBuckets(): Promise<{ buckets: BucketItem[] }> {
  try {
    const client = getS3Client();
    const resp = await client.send(new ListBucketsCommand({}));
    const buckets: BucketItem[] = (resp.Buckets ?? []).map((b) => ({
      name: b.Name ?? '',
      creationDate: b.CreationDate?.toISOString(),
    }));

    // Fill in regions with bounded parallelism.
    const THROTTLE = 20;
    for (let i = 0; i < buckets.length; i += THROTTLE) {
      await Promise.all(
        buckets.slice(i, i + THROTTLE).map(async (b) => {
          try {
            const loc = await client.send(new GetBucketLocationCommand({ Bucket: b.name }));
            b.region = loc.LocationConstraint ?? 'us-east-1';
          } catch {
            /* keep the bucket visible even if region fetch fails */
          }
        }),
      );
    }
    return { buckets };
  } catch (err) {
    throw toApiError(err);
  }
}

async function createBucket(payload: CreateBucketPayload): Promise<{ name: string }> {
  const name = payload.name.trim();
  const nameError = validateBucketName(name);
  if (nameError) {
    throw new ApiRequestError(nameError, 'BadRequest', 400);
  }
  try {
    const client = getS3Client();
    // us-east-1 is the default region and has no LocationConstraint.
    const createConfiguration: CreateBucketCommand['input']['CreateBucketConfiguration'] =
      payload.region && payload.region !== 'us-east-1'
        ? { LocationConstraint: payload.region as BucketLocationConstraint }
        : undefined;
    await client.send(new CreateBucketCommand({ Bucket: name, CreateBucketConfiguration: createConfiguration }));

    if (payload.versioning) {
      await client.send(new PutBucketVersioningCommand({ Bucket: name, VersioningConfiguration: { Status: 'Enabled' } }));
    }
    if (payload.blockPublicAccess) {
      await client.send(
        new PutPublicAccessBlockCommand({
          Bucket: name,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        }),
      );
    }
    if (payload.tags && Object.keys(payload.tags).length > 0) {
      await client.send(
        new PutBucketTaggingCommand({
          Bucket: name,
          Tagging: { TagSet: Object.entries(payload.tags).map(([Key, Value]) => ({ Key, Value })) },
        }),
      );
    }
    return { name };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteBucket(name: string): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(new DeleteBucketCommand({ Bucket: name }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ----------------------------------------------------------- bucket config

async function getBucketConfig(name: string): Promise<BucketConfig> {
  const client = getS3Client();
  const out: BucketConfig = { tags: {} };

  await Promise.all([
    (async () => {
      try {
        const [loc, ver, buckets] = await Promise.all([
          client.send(new GetBucketLocationCommand({ Bucket: name })),
          client.send(new GetBucketVersioningCommand({ Bucket: name })),
          client.send(new ListBucketsCommand({})),
        ]);
        out.region = loc.LocationConstraint ?? 'us-east-1';
        out.versioning = ver.Status === 'Enabled' ? 'Enabled' : ver.Status === 'Suspended' ? 'Suspended' : undefined;
        out.creationDate = (buckets.Buckets ?? []).find((b) => b.Name === name)?.CreationDate?.toISOString();
      } catch {
        /* best-effort */
      }
    })(),
    (async () => {
      try {
        const t = await client.send(new GetBucketTaggingCommand({ Bucket: name }));
        out.tags = Object.fromEntries((t.TagSet ?? []).map((x) => [x.Key ?? '', x.Value ?? '']));
      } catch {
        /* no tags configured */
      }
    })(),
    (async () => {
      try {
        const e = await client.send(new GetBucketEncryptionCommand({ Bucket: name }));
        const rule = e.ServerSideEncryptionConfiguration?.Rules?.[0];
        out.encryption = rule?.ApplyServerSideEncryptionByDefault
          ? {
              algorithm: rule.ApplyServerSideEncryptionByDefault.SSEAlgorithm ?? 'AES256',
              keyId: rule.ApplyServerSideEncryptionByDefault.KMSMasterKeyID,
            }
          : null;
      } catch (err) {
        out.encryption = isNotConfigured(err) ? null : undefined;
      }
    })(),
    (async () => {
      try {
        const p = await client.send(new GetBucketPolicyCommand({ Bucket: name }));
        out.policy = p.Policy ?? null;
      } catch (err) {
        out.policy = isNotConfigured(err) ? null : undefined;
      }
    })(),
    (async () => {
      try {
        const c = await client.send(new GetBucketCorsCommand({ Bucket: name }));
        out.cors = Array.isArray(c.CORSRules) ? JSON.stringify({ CORSRules: c.CORSRules }, null, 2) : null;
      } catch (err) {
        out.cors = isNotConfigured(err) ? null : undefined;
      }
    })(),
    (async () => {
      try {
        const p = await client.send(new GetPublicAccessBlockCommand({ Bucket: name }));
        const cfg = p.PublicAccessBlockConfiguration;
        out.publicAccessBlock = cfg
          ? {
              blockPublicAcls: cfg.BlockPublicAcls ?? false,
              ignorePublicAcls: cfg.IgnorePublicAcls ?? false,
              blockPublicPolicy: cfg.BlockPublicPolicy ?? false,
              restrictPublicBuckets: cfg.RestrictPublicBuckets ?? false,
            }
          : null;
      } catch (err) {
        out.publicAccessBlock = isNotConfigured(err) ? null : undefined;
      }
    })(),
  ]);

  return out;
}

async function putBucketVersioning(name: string, status: 'Enabled' | 'Suspended'): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(new PutBucketVersioningCommand({ Bucket: name, VersioningConfiguration: { Status: status } }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function putBucketTags(name: string, tags: Record<string, string>): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(
      new PutBucketTaggingCommand({ Bucket: name, Tagging: { TagSet: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) } }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteBucketTags(name: string): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(new DeleteBucketTaggingCommand({ Bucket: name }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function putBucketPolicy(name: string, policyJson: string): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(new PutBucketPolicyCommand({ Bucket: name, Policy: policyJson }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteBucketPolicy(name: string): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(new DeleteBucketPolicyCommand({ Bucket: name }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function putBucketCors(name: string, corsJson: string): Promise<{ ok: boolean }> {
  try {
    const parsed = JSON.parse(corsJson) as { CORSRules?: unknown };
    if (!Array.isArray(parsed.CORSRules) || parsed.CORSRules.length === 0) {
      throw new ApiRequestError('The CORS configuration must be a JSON object with a non-empty CORSRules array.', 'BadRequest', 400);
    }
    const config = parsed as CORSConfiguration;
    await getS3Client().send(new PutBucketCorsCommand({ Bucket: name, CORSConfiguration: config }));
    return { ok: true };
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ApiRequestError('The CORS configuration must be valid JSON.', 'BadRequest', 400);
    }
    throw toApiError(err);
  }
}

async function deleteBucketCors(name: string): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(new DeleteBucketCorsCommand({ Bucket: name }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function putBucketEncryption(name: string, algorithm: 'AES256' | 'aws:kms', keyId?: string): Promise<{ ok: boolean }> {
  try {
    const rule = algorithm === 'aws:kms' && keyId ? { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: algorithm, KMSMasterKeyID: keyId } } : { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: algorithm } };
    await getS3Client().send(new PutBucketEncryptionCommand({ Bucket: name, ServerSideEncryptionConfiguration: { Rules: [rule] } }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteBucketEncryption(name: string): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(new DeleteBucketEncryptionCommand({ Bucket: name }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function putPublicAccessBlock(name: string, config: PublicAccessBlockConfig): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(
      new PutPublicAccessBlockCommand({
        Bucket: name,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: config.blockPublicAcls,
          IgnorePublicAcls: config.ignorePublicAcls,
          BlockPublicPolicy: config.blockPublicPolicy,
          RestrictPublicBuckets: config.restrictPublicBuckets,
        },
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ------------------------------------------------------------- object list

async function listObjects(bucket: string, prefix: string, continuationToken?: string): Promise<ListObjectsResult> {
  try {
    const resp = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: continuationToken || undefined,
        MaxKeys: 1000,
      }),
    );
    const folders: S3ObjectInfo[] = (resp.CommonPrefixes ?? [])
      .filter((p) => p.Prefix && p.Prefix !== prefix)
      .map((p) => ({ key: p.Prefix!, size: 0, isFolder: true }));
    const folderKeys = new Set(folders.map((f) => f.key));
    const objects: S3ObjectInfo[] = (resp.Contents ?? [])
      .filter((o) => o.Key !== prefix && !(o.Key?.endsWith('/') && folderKeys.has(o.Key)))
      .map((o) => ({
        key: o.Key ?? '',
        size: o.Size ?? 0,
        lastModified: o.LastModified?.toISOString(),
        etag: o.ETag,
        storageClass: o.StorageClass,
        isFolder: false,
      }));
    folders.sort((a, b) => a.key.localeCompare(b.key));
    objects.sort((a, b) => a.key.localeCompare(b.key));
    return { folders, objects, nextToken: resp.NextContinuationToken, isTruncated: resp.IsTruncated === true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function listObjectVersions(
  bucket: string,
  prefix: string,
  markers?: { keyMarker?: string; versionIdMarker?: string },
): Promise<{ versions: S3VersionItem[]; nextMarkers?: { keyMarker: string; versionIdMarker?: string }; isTruncated: boolean }> {
  try {
    const resp = await getS3Client().send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: markers?.keyMarker || undefined,
        VersionIdMarker: markers?.versionIdMarker || undefined,
        MaxKeys: 1000,
      }),
    );
    const versions: S3VersionItem[] = [
      ...(resp.Versions ?? []).map((v: ObjectVersion) => ({
        key: v.Key ?? '',
        versionId: v.VersionId ?? 'null',
        isLatest: v.IsLatest === true,
        isDeleteMarker: false,
        size: v.Size ?? 0,
        lastModified: v.LastModified?.toISOString(),
        etag: v.ETag,
        storageClass: v.StorageClass,
      })),
      ...(resp.DeleteMarkers ?? []).map((d: DeleteMarkerEntry) => ({
        key: d.Key ?? '',
        versionId: d.VersionId ?? 'null',
        isLatest: d.IsLatest === true,
        isDeleteMarker: true,
        size: 0,
        lastModified: d.LastModified?.toISOString(),
      })),
    ];
    return {
      versions,
      nextMarkers:
        resp.NextKeyMarker && resp.NextVersionIdMarker
          ? { keyMarker: resp.NextKeyMarker, versionIdMarker: resp.NextVersionIdMarker }
          : resp.NextKeyMarker
            ? { keyMarker: resp.NextKeyMarker }
            : undefined,
      isTruncated: resp.IsTruncated === true,
    };
  } catch (err) {
    throw toApiError(err);
  }
}

// ------------------------------------------------------------------ objects

async function headObject(bucket: string, key: string, versionId?: string): Promise<ObjectHead> {
  try {
    const resp = await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId || undefined }));
    return {
      key,
      size: resp.ContentLength ?? 0,
      lastModified: resp.LastModified?.toISOString(),
      etag: resp.ETag,
      contentType: resp.ContentType,
      storageClass: resp.StorageClass,
      versionId: resp.VersionId,
      metadata: resp.Metadata ?? {},
    };
  } catch (err) {
    throw toApiError(err);
  }
}

/** Fetch an object body as a Blob (handles both the Blob and byte-stream forms the SDK can return). */
async function getObjectBlob(
  bucket: string,
  key: string,
  opts?: { versionId?: string; range?: string },
): Promise<{ blob: Blob; contentType?: string; contentLength?: number }> {
  try {
    const resp = await getS3Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: key, VersionId: opts?.versionId || undefined, Range: opts?.range || undefined }),
    );
    const body = resp.Body;
    let blob: Blob;
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      blob = body;
    } else if (body && typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
      const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
      blob = new Blob([bytes]);
    } else {
      throw new ApiRequestError('The endpoint returned an unsupported response body.', 'BadResponse', 502);
    }
    return { blob, contentType: resp.ContentType, contentLength: resp.ContentLength };
  } catch (err) {
    throw toApiError(err);
  }
}

/** Simple write (create-folder markers, small text objects). */
async function putObject(bucket: string, key: string, body: string | Blob | Uint8Array, contentType?: string): Promise<{ etag?: string }> {
  try {
    const resp = await getS3Client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    return { etag: resp.ETag };
  } catch (err) {
    throw toApiError(err);
  }
}

/** Upload a File with multipart support and progress reporting (used by the upload dialog). */
async function uploadObject(payload: {
  bucket: string;
  key: string;
  file: File;
  contentType?: string;
  onProgress?: (p: UploadProgress) => void;
}): Promise<{ key: string; etag?: string; versionId?: string }> {
  try {
    const upload = new Upload({
      client: getS3Client(),
      params: {
        Bucket: payload.bucket,
        Key: payload.key,
        Body: payload.file,
        ContentType: payload.contentType || payload.file.type || undefined,
      },
      queueSize: 4,
    });
    upload.on('httpUploadProgress', (p) => payload.onProgress?.({ loaded: p.loaded ?? 0, total: p.total }));
    const done = await upload.done();
    return { key: payload.key, etag: done.ETag, versionId: done.VersionId };
  } catch (err) {
    throw toApiError(err);
  }
}

async function copyObject(payload: {
  sourceBucket: string;
  sourceKey: string;
  sourceVersionId?: string;
  bucket: string;
  key: string;
}): Promise<{ ok: boolean }> {
  try {
    const encodedKey = payload.sourceKey
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    let copySource = `/${payload.sourceBucket}/${encodedKey}`;
    if (payload.sourceVersionId) {
      copySource += `?versionId=${encodeURIComponent(payload.sourceVersionId)}`;
    }
    await getS3Client().send(new CopyObjectCommand({ Bucket: payload.bucket, Key: payload.key, CopySource: copySource }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteObject(bucket: string, key: string, versionId?: string): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId || undefined }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function deleteObjects(bucket: string, items: Array<{ key: string; versionId?: string }>): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: items.map((i) => ({ Key: i.key, VersionId: i.versionId || undefined })) } }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function getObjectTags(bucket: string, key: string, versionId?: string): Promise<{ tags: Record<string, string> }> {
  try {
    const resp = await getS3Client().send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key, VersionId: versionId || undefined }));
    return { tags: Object.fromEntries((resp.TagSet ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])) };
  } catch (err) {
    throw toApiError(err);
  }
}

async function putObjectTags(bucket: string, key: string, tags: Record<string, string>, versionId?: string): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(
      new PutObjectTaggingCommand({
        Bucket: bucket,
        Key: key,
        VersionId: versionId || undefined,
        Tagging: { TagSet: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) },
      }),
    );
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

async function getObjectAcl(bucket: string, key: string, versionId?: string): Promise<ObjectAcl> {
  try {
    const resp = await getS3Client().send(new GetObjectAclCommand({ Bucket: bucket, Key: key, VersionId: versionId || undefined }));
    return {
      owner: resp.Owner ? { id: resp.Owner.ID, displayName: resp.Owner.DisplayName } : undefined,
      grants: (resp.Grants ?? []).map((g) => ({
        type: g.Grantee?.Type ?? '',
        id: g.Grantee?.ID,
        displayName: g.Grantee?.DisplayName,
        uri: g.Grantee?.URI,
        permission: g.Permission ?? '',
      })),
    };
  } catch (err) {
    throw toApiError(err);
  }
}

async function putObjectAcl(bucket: string, key: string, acl: 'private' | 'public-read', versionId?: string): Promise<{ ok: boolean }> {
  try {
    await getS3Client().send(new PutObjectAclCommand({ Bucket: bucket, Key: key, VersionId: versionId || undefined, ACL: acl }));
    return { ok: true };
  } catch (err) {
    throw toApiError(err);
  }
}

// ----------------------------------------------------------------------- api

export const s3Api = {
  listBuckets,
  createBucket,
  deleteBucket,
  getBucketConfig,
  putBucketVersioning,
  putBucketTags,
  deleteBucketTags,
  putBucketPolicy,
  deleteBucketPolicy,
  putBucketCors,
  deleteBucketCors,
  putBucketEncryption,
  deleteBucketEncryption,
  putPublicAccessBlock,
  listObjects,
  listObjectVersions,
  headObject,
  getObjectBlob,
  putObject,
  uploadObject,
  copyObject,
  deleteObject,
  deleteObjects,
  getObjectTags,
  putObjectTags,
  getObjectAcl,
  putObjectAcl,
};
