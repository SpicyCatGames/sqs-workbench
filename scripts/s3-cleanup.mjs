// Removes leftover probe buckets (all versions + delete markers) from the emulator.
import {
  S3Client,
  ListBucketsCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';

const client = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  forcePathStyle: true,
});

const resp = await client.send(new ListBucketsCommand({}));
const buckets = (resp.Buckets ?? []).map((b) => b.Name ?? '');
const targets = buckets.filter((n) => n.startsWith('wb-probe-') || n.startsWith('wb-errprobe-') || n.startsWith('workbench-probe-'));

for (const bucket of targets) {
  // Delete every version and delete marker.
  let keyMarker;
  let versionIdMarker;
  do {
    const v = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker }));
    const objects = [
      ...(v.Versions ?? []).map((x) => ({ Key: x.Key, VersionId: x.VersionId })),
      ...(v.DeleteMarkers ?? []).map((x) => ({ Key: x.Key, VersionId: x.VersionId })),
    ];
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
    }
    keyMarker = v.NextKeyMarker;
    versionIdMarker = v.NextVersionIdMarker;
  } while (keyMarker);

  try {
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    console.log('Deleted bucket:', bucket);
  } catch (e) {
    console.log('Could not delete', bucket, '-', e.message?.slice(0, 120));
  }
}

console.log('Remaining buckets:', buckets.filter((n) => !targets.includes(n)));
process.exit(0);
