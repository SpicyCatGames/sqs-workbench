// Seeds demo S3 data into the running emulator (floci on :4566) so the UI
// has content to show. Run from the frontend dir for node_modules.
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  PutBucketTaggingCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';

const client = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  forcePathStyle: true,
});

const BUCKET = 'workbench-demo';

async function ok(name, fn) {
  try {
    await fn();
    console.log('OK  ', name);
  } catch (e) {
    console.log('FAIL', name, '-', e.message?.slice(0, 120));
  }
}

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#ec7211" rx="16"/><text x="60" y="72" font-size="48" text-anchor="middle" fill="#fff" font-family="sans-serif">AWS</text></svg>';

await ok('create bucket', () => client.send(new CreateBucketCommand({ Bucket: BUCKET })));
await ok('enable versioning', () =>
  client.send(new PutBucketVersioningCommand({ Bucket: BUCKET, VersioningConfiguration: { Status: 'Enabled' } })),
);
await ok('upload hello.txt v1', () =>
  client.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'hello.txt', Body: 'Hello from AWS Workbench!\nVersion one.', ContentType: 'text/plain' })),
);
await ok('upload hello.txt v2', () =>
  client.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'hello.txt', Body: 'Hello from AWS Workbench!\nVersion two with more content.', ContentType: 'text/plain' })),
);
await ok('upload config.json', () =>
  client.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'config.json', Body: JSON.stringify({ app: 'workbench', region: 'us-east-1', features: ['sqs', 'sns', 's3'] }, null, 2), ContentType: 'application/json' })),
);
await ok('upload folder/readme.md', () =>
  client.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'folder/readme.md', Body: '# Workbench demo\n\nFiles inside a folder.\n', ContentType: 'text/markdown' })),
);
await ok('upload images/logo.svg', () =>
  client.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'images/logo.svg', Body: svg, ContentType: 'image/svg+xml' })),
);
await ok('create empty folder', () =>
  client.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'empty-folder/', Body: '' })),
);
await ok('tag hello.txt', () =>
  client.send(new PutObjectTaggingCommand({ Bucket: BUCKET, Key: 'hello.txt', Tagging: { TagSet: [{ Key: 'team', Value: 'core' }, { Key: 'env', Value: 'demo' }] } })),
);
await ok('bucket tags', () =>
  client.send(new PutBucketTaggingCommand({ Bucket: BUCKET, Tagging: { TagSet: [{ Key: 'project', Value: 'aws-workbench' }] } })),
);
await ok('bucket cors', () =>
  client.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: { CORSRules: [{ AllowedOrigins: ['*'], AllowedMethods: ['GET', 'PUT', 'POST'], AllowedHeaders: ['*'], MaxAgeSeconds: 3000 }] },
    }),
  ),
);
await ok('bucket policy', () =>
  client.send(
    new PutBucketPolicyCommand({
      Bucket: BUCKET,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: `arn:aws:s3:::${BUCKET}/*` }],
      }),
    }),
  ),
);

console.log('Done. Bucket:', BUCKET);
process.exit(0);
