// Probe the Lambda API of the configured emulator (floci on :4566, or
// ministack on :4568). Creates a throwaway function from an in-memory zip,
// exercises the API surface this workbench will use, then deletes it.
import {
  LambdaClient,
  CreateFunctionCommand,
  ListFunctionsCommand,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommand,
  UpdateFunctionCodeCommand,
  InvokeCommand,
  PublishVersionCommand,
  CreateAliasCommand,
  ListAliasesCommand,
  ListVersionsByFunctionCommand,
  TagResourceCommand,
  ListTagsCommand,
  UntagResourceCommand,
  AddPermissionCommand,
  GetPolicyCommand,
  RemovePermissionCommand,
  CreateEventSourceMappingCommand,
  ListEventSourceMappingsCommand,
  DeleteEventSourceMappingCommand,
  DeleteFunctionCommand,
} from '@aws-sdk/client-lambda';
import { SQSClient, CreateQueueCommand, GetQueueAttributesCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';

const ENDPOINT = process.env.PROBE_ENDPOINT || 'http://localhost:4566';
const REGION = 'us-east-1';

const client = new LambdaClient({
  region: REGION,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  endpoint: ENDPOINT,
});

// ---------------------------------------------------------------- helpers

/** Minimal ZIP writer (STORE method) for a single file — Lambda accepts it. */
function makeZip(filename, content) {
  const name = Buffer.from(filename, 'utf8');
  const data = Buffer.from(content, 'utf8');
  const crc = crc32(data);
  const local = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(crc), u32(data.length), u32(data.length),
    u16(name.length), u16(0),
    name, data,
  ]);
  const central = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x01, 0x02]),
    u16(0x031e), u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(crc), u32(data.length), u32(data.length),
    u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0),
    name,
  ]);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0), u16(0), u16(1), u16(1),
    u32(central.length), u32(local.length + central.length),
    u16(0),
  ]);
  return Buffer.concat([local, central, eocd]);
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

let passed = 0;
let failed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((out) => {
      passed++;
      console.log(`  ok  ${name}${out !== undefined ? ` -> ${out}` : ''}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  FAIL ${name} -> ${err.name}: ${err.message}`);
    });
}

const NAME = `workbench-probe-${Date.now().toString(36)}`;

async function main() {
  console.log(`Probing Lambda on ${ENDPOINT}`);
  const zip = makeZip('index.js', `
exports.handler = async (event) => {
  console.log('probe invoked with', JSON.stringify(event));
  return { ok: true, echo: event && event.hello ? event.hello : null, source: 'nodejs' };
};
`);

  await check('ListFunctions (empty)', async () => {
    const r = await client.send(new ListFunctionsCommand({}));
    return `${(r.Functions ?? []).length} functions`;
  });

  await check('CreateFunction nodejs20.x (zip)', async () => {
    const r = await client.send(
      new CreateFunctionCommand({
        FunctionName: NAME,
        Runtime: 'nodejs20.x',
        Handler: 'index.handler',
        Role: 'arn:aws:iam::000000000000:role/lambda-role',
        Code: { ZipFile: zip },
        Description: 'probe function',
        Timeout: 30,
        MemorySize: 256,
      }),
    );
    return `${r.FunctionName} ${r.Runtime} state=${r.State}`;
  });

  await check('GetFunction', async () => {
    const r = await client.send(new GetFunctionCommand({ FunctionName: NAME }));
    return `codeLocation=${r.Code && r.Code.Location ? 'yes' : 'no'} size=${r.Configuration?.CodeSize}`;
  });

  await check('GetFunctionConfiguration', async () => {
    const r = await client.send(new GetFunctionConfigurationCommand({ FunctionName: NAME }));
    return `memory=${r.MemorySize} timeout=${r.Timeout} role=${r.Role}`;
  });

  await check('UpdateFunctionConfiguration (env/memory/timeout)', async () => {
    const r = await client.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: NAME,
        MemorySize: 512,
        Timeout: 60,
        Environment: { Variables: { STAGE: 'probe' } },
        Description: 'updated probe',
      }),
    );
    return `memory=${r.MemorySize} timeout=${r.Timeout} env=${r.Environment?.Variables?.STAGE}`;
  });

  await check('Invoke RequestResponse', async () => {
    const r = await client.send(
      new InvokeCommand({
        FunctionName: NAME,
        InvocationType: 'RequestResponse',
        LogType: 'Tail',
        Payload: new TextEncoder().encode(JSON.stringify({ hello: 'world' })),
      }),
    );
    const payload = JSON.parse(Buffer.from(r.Payload ?? []).toString('utf8'));
    return `status=${r.StatusCode} functionError=${r.FunctionError ?? 'none'} logResult=${r.LogResult ? 'yes' : 'no'} payload=${JSON.stringify(payload)}`;
  });

  await check('Invoke DryRun', async () => {
    const r = await client.send(new InvokeCommand({ FunctionName: NAME, InvocationType: 'DryRun' }));
    return `status=${r.StatusCode}`;
  });

  await check('Invoke Event (async)', async () => {
    const r = await client.send(
      new InvokeCommand({ FunctionName: NAME, InvocationType: 'Event', Payload: new TextEncoder().encode('{}') }),
    );
    return `status=${r.StatusCode}`;
  });

  await check('UpdateFunctionCode (new zip)', async () => {
    const zip2 = makeZip('index.js', `exports.handler = async () => ({ ok: true, v: 2 });`);
    const r = await client.send(new UpdateFunctionCodeCommand({ FunctionName: NAME, ZipFile: zip2 }));
    return `codeSize=${r.CodeSize}`;
  });

  await check('PublishVersion', async () => {
    const r = await client.send(new PublishVersionCommand({ FunctionName: NAME, Description: 'v1' }));
    return `${r.Version}`;
  });

  await check('ListVersionsByFunction', async () => {
    const r = await client.send(new ListVersionsByFunctionCommand({ FunctionName: NAME }));
    return `${(r.Versions ?? []).map((v) => v.Version).join(',')}`;
  });

  await check('CreateAlias', async () => {
    const r = await client.send(new CreateAliasCommand({ FunctionName: NAME, Name: 'probe-alias', FunctionVersion: '1' }));
    return `${r.Name} -> ${r.FunctionVersion}`;
  });

  await check('ListAliases', async () => {
    const r = await client.send(new ListAliasesCommand({ FunctionName: NAME }));
    return `${(r.Aliases ?? []).map((a) => a.Name).join(',')}`;
  });

  await check('TagResource + ListTags', async () => {
    await client.send(new TagResourceCommand({ Resource: `arn:aws:lambda:${REGION}:000000000000:function:${NAME}`, Tags: { env: 'probe', team: 'workbench' } }));
    const r = await client.send(new ListTagsCommand({ Resource: `arn:aws:lambda:${REGION}:000000000000:function:${NAME}` }));
    return JSON.stringify(r.Tags);
  });

  await check('UntagResource', async () => {
    await client.send(new UntagResourceCommand({ Resource: `arn:aws:lambda:${REGION}:000000000000:function:${NAME}`, TagKeys: ['team'] }));
    const r = await client.send(new ListTagsCommand({ Resource: `arn:aws:lambda:${REGION}:000000000000:function:${NAME}` }));
    return JSON.stringify(r.Tags);
  });

  await check('GetPolicy (none) -> ResourceNotFound', async () => {
    try {
      await client.send(new GetPolicyCommand({ FunctionName: NAME }));
      return 'unexpected policy present';
    } catch (err) {
      return `${err.name}`;
    }
  });

  await check('AddPermission + GetPolicy', async () => {
    await client.send(
      new AddPermissionCommand({
        FunctionName: NAME,
        StatementId: 'probe-stmt',
        Action: 'lambda:InvokeFunction',
        Principal: 'sqs.amazonaws.com',
        SourceArn: `arn:aws:sqs:${REGION}:000000000000:probe-queue`,
      }),
    );
    const r = await client.send(new GetPolicyCommand({ FunctionName: NAME }));
    const policy = JSON.parse(r.Policy ?? '{}');
    return `policyVersion=${r.RevisionId ?? policy.Version} statements=${(policy.Statement ?? []).map((s) => s.Sid).join(',')}`;
  });

  await check('RemovePermission', async () => {
    await client.send(new RemovePermissionCommand({ FunctionName: NAME, StatementId: 'probe-stmt' }));
    return 'removed';
  });

  // SQS event source mapping
  const sqs = new SQSClient({ region: REGION, credentials: { accessKeyId: 'test', secretAccessKey: 'test' }, endpoint: ENDPOINT });
  let queueArn = '';
  await check('SQS: create queue for ESM', async () => {
    const r = await sqs.send(new CreateQueueCommand({ QueueName: 'lambda-probe-queue' }));
    const url = r.QueueUrl ?? '';
    const attrs = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn'] }));
    queueArn = attrs.Attributes?.QueueArn ?? '';
    return queueArn;
  });

  await check('CreateEventSourceMapping (SQS)', async () => {
    const r = await client.send(
      new CreateEventSourceMappingCommand({
        FunctionName: NAME,
        EventSourceArn: queueArn,
        BatchSize: 5,
        Enabled: true,
        StartingPosition: 'LATEST',
      }),
    );
    return `uuid=${r.UUID} state=${r.State}`;
  });

  await check('ListEventSourceMappings', async () => {
    const r = await client.send(new ListEventSourceMappingsCommand({ FunctionName: NAME }));
    return `${(r.EventSourceMappings ?? []).map((m) => `${m.UUID}:${m.State}`).join(',')}`;
  });

  await check('DeleteEventSourceMapping', async () => {
    const list = await client.send(new ListEventSourceMappingsCommand({ FunctionName: NAME }));
    const uuid = list.EventSourceMappings?.[0]?.UUID;
    if (!uuid) throw new Error('no mapping found');
    const r = await client.send(new DeleteEventSourceMappingCommand({ UUID: uuid }));
    return `uuid=${r.UUID}`;
  });

  await check('DeleteFunction', async () => {
    await client.send(new DeleteFunctionCommand({ FunctionName: NAME }));
    return 'deleted';
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
