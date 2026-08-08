// Fast smoke test of the exact calls the S3 UI makes, each race-limited so a
// hung emulator fails fast instead of stalling.
import {
  S3Client,
  ListBucketsCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  GetBucketTaggingCommand,
  GetBucketCorsCommand,
  GetBucketPolicyCommand,
  GetPublicAccessBlockCommand,
  GetBucketVersioningCommand,
  GetBucketLocationCommand,
  GetBucketEncryptionCommand,
} from '@aws-sdk/client-s3';

const client = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  forcePathStyle: true,
});

function withTimeout(p, ms = 8000) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${ms}ms`)), ms))]);
}

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await withTimeout(fn());
    console.log(`OK   ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message?.slice(0, 140)}`);
  }
}

await step('ListBuckets', () => client.send(new ListBucketsCommand({})));
await step('ListObjectsV2', () => client.send(new ListObjectsV2Command({ Bucket: 'workbench-demo', Prefix: '', Delimiter: '/' })));
await step('ListObjectVersions', () => client.send(new ListObjectVersionsCommand({ Bucket: 'workbench-demo', Prefix: '' })));
await step('HeadObject hello.txt', () => client.send(new HeadObjectCommand({ Bucket: 'workbench-demo', Key: 'hello.txt' })));
await step('GetObject hello.txt', () => client.send(new GetObjectCommand({ Bucket: 'workbench-demo', Key: 'hello.txt' })));
await step('GetBucketVersioning', () => client.send(new GetBucketVersioningCommand({ Bucket: 'workbench-demo' })));
await step('GetBucketLocation', () => client.send(new GetBucketLocationCommand({ Bucket: 'workbench-demo' })));
await step('GetBucketTagging', () => client.send(new GetBucketTaggingCommand({ Bucket: 'workbench-demo' })));
await step('GetBucketCors', () => client.send(new GetBucketCorsCommand({ Bucket: 'workbench-demo' })));
await step('GetBucketPolicy', () => client.send(new GetBucketPolicyCommand({ Bucket: 'workbench-demo' })));
await step('GetPublicAccessBlock', () => client.send(new GetPublicAccessBlockCommand({ Bucket: 'workbench-demo' })));
await step('GetBucketEncryption', () => client.send(new GetBucketEncryptionCommand({ Bucket: 'workbench-demo' })));
process.exit(0);
