// Probe the local emulator's Secrets Manager API surface.
// Run: node scripts/sm-probe.mjs
import {
  SecretsManagerClient,
  CreateSecretCommand,
  ListSecretsCommand,
  GetSecretValueCommand,
  DescribeSecretCommand,
  PutSecretValueCommand,
  ListSecretVersionIdsCommand,
  TagResourceCommand,
  UntagResourceCommand,
  GetResourcePolicyCommand,
  PutResourcePolicyCommand,
  RotateSecretCommand,
  CancelRotateSecretCommand,
  DeleteSecretCommand,
  RestoreSecretCommand,
  UpdateSecretCommand,
} from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  endpoint: 'http://localhost:4566',
});

const NAME = 'probe-secret-' + Date.now();
const out = {};

async function tryOp(label, fn) {
  try {
    const res = await fn();
    out[label] = { ok: true, keys: Object.keys(res ?? {}), sample: JSON.stringify(res).slice(0, 220) };
  } catch (err) {
    out[label] = { ok: false, error: `${err.name}: ${err.message}` };
  }
}

await tryOp('CreateSecret', () =>
  client.send(new CreateSecretCommand({ Name: NAME, SecretString: JSON.stringify({ user: 'admin', pass: 's3cret' }), Description: 'probe', Tags: [{ Key: 'env', Value: 'test' }] })),
);
await tryOp('ListSecrets', () => client.send(new ListSecretsCommand({})));
await tryOp('DescribeSecret', () => client.send(new DescribeSecretCommand({ SecretId: NAME })));
await tryOp('GetSecretValue', () => client.send(new GetSecretValueCommand({ SecretId: NAME })));
await tryOp('PutSecretValue', () => client.send(new PutSecretValueCommand({ SecretId: NAME, SecretString: 'new-value-v2' })));
await tryOp('ListSecretVersionIds', () => client.send(new ListSecretVersionIdsCommand({ SecretId: NAME })));
await tryOp('TagResource', () => client.send(new TagResourceCommand({ SecretId: NAME, Tags: [{ Key: 'team', Value: 'core' }] })));
await tryOp('UntagResource', () => client.send(new UntagResourceCommand({ SecretId: NAME, TagKeys: ['env'] })));
await tryOp('GetResourcePolicy', () => client.send(new GetResourcePolicyCommand({ SecretId: NAME })));
await tryOp('PutResourcePolicy', () =>
  client.send(
    new PutResourcePolicyCommand({
      SecretId: NAME,
      ResourcePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Sid: 'probe', Effect: 'Allow', Principal: '*', Action: 'secretsmanager:GetSecretValue', Resource: '*' }],
      }),
    }),
  ),
);
await tryOp('RotateSecret', () =>
  client.send(new RotateSecretCommand({ SecretId: NAME, RotationLambdaARN: 'arn:aws:lambda:us-east-1:000000000000:function:rotator' })),
);
await tryOp('CancelRotateSecret', () => client.send(new CancelRotateSecretCommand({ SecretId: NAME })));
await tryOp('UpdateSecret', () => client.send(new UpdateSecretCommand({ SecretId: NAME, Description: 'updated desc' })));
await tryOp('DeleteSecret-30d', () => client.send(new DeleteSecretCommand({ SecretId: NAME, RecoveryWindowInDays: 30 })));
await tryOp('DescribeAfterDelete', () => client.send(new DescribeSecretCommand({ SecretId: NAME })));
await tryOp('RestoreSecret', () => client.send(new RestoreSecretCommand({ SecretId: NAME })));
await tryOp('DeleteSecret-force', () => client.send(new DeleteSecretCommand({ SecretId: NAME, ForceDeleteWithoutRecovery: true })));

console.log(JSON.stringify(out, null, 2));
