import { useEffect, useMemo, useState } from 'react';
import { Braces, CheckCircle2, Clock, Play, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { lambdaApi, type FunctionDetail, type InvocationType, type InvokeResult } from '../../lib/lambdaApi';
import { errorMessage, useToast } from '../../lib/context';
import { prettyJson } from '../../lib/format';
import { Button, Field, Modal, Select, Textarea } from '../../components/ui';
import { formatIso } from './LambdaUi';

const TEMPLATES: Array<{ label: string; value: string }> = [
  {
    label: 'Hello World',
    value: JSON.stringify({ key1: 'value1', key2: 'value2', key3: 'value3' }, null, 2),
  },
  {
    label: 'SQS event',
    value: JSON.stringify(
      {
        Records: [
          {
            messageId: '19dd0b57-b21e-4ac1-bd88-01bbb068cb78',
            receiptHandle: 'MessageReceiptHandle',
            body: 'Hello from SQS!',
            attributes: { ApproximateReceiveCount: '1', SentTimestamp: '1523232000000', SenderId: '123456789012', ApproximateFirstReceiveTimestamp: '1523232000001' },
            messageAttributes: {},
            md5OfBody: '7b270e59b47ff90a553787216d55d91d',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:my-queue',
            awsRegion: 'us-east-1',
          },
        ],
      },
      null,
      2,
    ),
  },
  {
    label: 'S3 event',
    value: JSON.stringify(
      {
        Records: [
          {
            eventVersion: '2.0',
            eventSource: 'aws:s3',
            awsRegion: 'us-east-1',
            eventTime: '1970-01-01T00:00:00.000Z',
            eventName: 'ObjectCreated:Put',
            s3: { bucket: { name: 'my-bucket' }, object: { key: 'test/key' } },
          },
        ],
      },
      null,
      2,
    ),
  },
  {
    label: 'API Gateway',
    value: JSON.stringify(
      {
        resource: '/{proxy+}',
        path: '/hello',
        httpMethod: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"message":"hello"}',
      },
      null,
      2,
    ),
  },
  {
    label: 'CloudWatch Logs',
    value: JSON.stringify(
      {
        awslogs: {
          data: toBase64(JSON.stringify({ messageType: 'DATA_MESSAGE', logEvents: [{ message: 'log line 1' }] })),
        },
      },
      null,
      2,
    ),
  },
];

interface QualifierOption {
  value: string;
  label: string;
}

// ------------------------------------------------------------- invoke form

function InvokeForm({ fn }: { fn: FunctionDetail }) {
  const { toast } = useToast();
  const [invocationType, setInvocationType] = useState<InvocationType>('RequestResponse');
  const [payload, setPayload] = useState(TEMPLATES[0].value);
  const [qualifiers, setQualifiers] = useState<QualifierOption[]>([]);
  const [qualifier, setQualifier] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<InvokeResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [versionsRes, aliasesRes] = await Promise.all([lambdaApi.listVersions(fn.functionName), lambdaApi.listAliases(fn.functionName)]);
        if (cancelled) return;
        const opts: QualifierOption[] = [{ value: '', label: '$LATEST' }];
        for (const v of versionsRes.versions) opts.push({ value: v.version, label: `Version ${v.version}` });
        for (const a of aliasesRes.aliases) opts.push({ value: a.name, label: `Alias ${a.name}` });
        setQualifiers(opts);
      } catch {
        /* qualifiers are optional — fall back to $LATEST */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fn.functionName]);

  const validPayload = useMemo(() => {
    try {
      JSON.parse(payload);
      return true;
    } catch {
      return false;
    }
  }, [payload]);

  const handleRun = async () => {
    if (!validPayload) {
      setError('The test event must be valid JSON.');
      return;
    }
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const res = await lambdaApi.invoke({
        functionName: fn.functionName,
        invocationType,
        payload,
        qualifier: qualifier || undefined,
      });
      setResult(res);
      if (res.functionError) {
        toast('error', 'Invocation failed', `${res.functionError} — the function returned an error.`);
      } else {
        toast('success', 'Invocation succeeded', `Status ${res.statusCode ?? ''} · ${res.durationMs} ms`);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  const logs = result?.logResult ? decodeLogs(result.logResult) : '';

  return (
    <>
      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 12 }}>
          <h3 className="card-title">Test event</h3>
          <span style={{ flex: 1 }} />
          <Select value={qualifier} onChange={(e) => setQualifier(e.target.value)} style={{ width: 170 }} title="Qualifier">
            {qualifiers.length === 0 && <option key="latest" value="">$LATEST</option>}
            {qualifiers.map((q) => (
              <option key={q.value ? `opt-${q.value}` : 'latest'} value={q.value}>
                {q.label}
              </option>
            ))}
          </Select>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              className={cn('chip-btn', payload === t.value && 'chip-btn-on')}
              onClick={() => {
                setPayload(t.value);
                setError('');
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Textarea
          value={payload}
          onChange={(e) => {
            setPayload(e.target.value);
            setError('');
          }}
          spellCheck={false}
          style={{ minHeight: 200, fontFamily: 'var(--mono)', fontSize: 12.5 }}
        />

        {error && <div className="inline-error">{error}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
          <Field label="Invocation type" layout="horizontal" className="invoke-type-field">
            <Select value={invocationType} onChange={(e) => setInvocationType(e.target.value as InvocationType)} style={{ width: 220 }}>
              <option value="RequestResponse">RequestResponse — wait for result</option>
              <option value="Event">Event — fire and forget</option>
              <option value="DryRun">DryRun — validate only</option>
            </Select>
          </Field>
          <span style={{ flex: 1 }} />
          <Button variant="primary" onClick={() => void handleRun()} loading={running} disabled={!payload.trim()}>
            <Play size={14} />
            Test
          </Button>
        </div>
      </div>

      {result && (
        <div className="card card-pad">
          <div className="card-title-row" style={{ marginBottom: 12 }}>
            <h3 className="card-title">Result</h3>
            <span style={{ flex: 1 }} />
            <span className={cn('invoke-status', result.functionError ? 'invoke-status-error' : 'invoke-status-ok')}>
              {result.functionError ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
              {result.functionError ? result.functionError : 'Success'}
            </span>
          </div>

          <div className="stats-row" style={{ marginBottom: 14 }}>
            <Stat2 label="Status" value={result.statusCode ?? '—'} />
            <Stat2 label="Duration" value={`${result.durationMs} ms`} />
            <Stat2 label="Executed version" value={result.executedVersion ?? '—'} />
            <Stat2 label="Request ID" value={result.requestId ? result.requestId.slice(0, 12) + '…' : '—'} />
          </div>

          <div className="form-section-title" style={{ marginBottom: 6 }}>Response payload</div>
          <pre className="json-preview" style={{ maxHeight: 300 }}>
            {prettyJson(result.payload) || '(empty response)'}
          </pre>

          {logs && (
            <>
              <div className="form-section-title" style={{ marginBottom: 6, marginTop: 14 }}>Function logs</div>
              <pre className="json-preview log-preview" style={{ maxHeight: 200 }}>
                {logs}
              </pre>
            </>
          )}
          {!logs && result.logResult !== undefined && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              This endpoint returned no function logs (LogType=Tail was requested).
            </div>
          )}
        </div>
      )}

      <div className="muted" style={{ fontSize: 12 }}>
        <Clock size={12} style={{ verticalAlign: -2 }} /> Invocations run inside the emulator. Logs may not be returned by all emulators.
      </div>
    </>
  );
}

/** Base64-encode a UTF-8 string without Node's Buffer (browser-safe). */
function toBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function decodeLogs(base64: string): string {
  try {
    const bin = atob(base64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return base64;
  }
}

function Stat2({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- tab

export function TestTab({ fn }: { fn: FunctionDetail }) {
  return (
    <div className="prop-stack">
      <div className="inline-info">
        <Braces size={16} />
        <span>
          Invoke <strong>{fn.functionName}</strong> with a JSON test event. Choose RequestResponse to see the returned payload.
        </span>
      </div>
      <InvokeForm fn={fn} />
    </div>
  );
}

// ----------------------------------------------------------------- dialog

export function InvokeDialog({ fn, onClose }: { fn: FunctionDetail; onClose: () => void }) {
  return (
    <Modal open title="Test function" subtitle={`${fn.functionName} · latest modified ${formatIso(fn.lastModified)}`} onClose={onClose} wide>
      <InvokeForm fn={fn} />
    </Modal>
  );
}
