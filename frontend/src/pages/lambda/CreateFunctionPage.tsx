import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Code2, FileArchive, Info, Package, Plus, Trash2, UploadCloud } from 'lucide-react';
import { cn } from '../../lib/cn';
import { lambdaApi, RUNTIME_OPTIONS, defaultRoleArn, handlerFileForRuntime, type RuntimeOption } from '../../lib/lambdaApi';
import { errorMessage, useToast } from '../../lib/context';
import { makeZip } from '../../lib/zip';
import { Button, Field, NumberInput, TextInput, Textarea, Toggle } from '../../components/ui';

type CodeSource = 'inline' | 'zip' | 's3';

interface EnvRow {
  id: number;
  key: string;
  value: string;
}

let envId = 0;

export function CreateFunctionPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [runtime, setRuntime] = useState('nodejs20.x');
  const [architecture, setArchitecture] = useState<'x86_64' | 'arm64'>('x86_64');
  const [codeSource, setCodeSource] = useState<CodeSource>('inline');
  const [inlineCode, setInlineCode] = useState(RUNTIME_OPTIONS[0].template);
  const [zipName, setZipName] = useState('');
  const [zipBytes, setZipBytes] = useState<Uint8Array | null>(null);
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Key, setS3Key] = useState('');
  const [s3Version, setS3Version] = useState('');
  const [role, setRole] = useState(defaultRoleArn());
  const [description, setDescription] = useState('');
  const [memory, setMemory] = useState(128);
  const [timeout, setTimeoutSec] = useState(3);
  const [ephemeralStorage, setEphemeralStorage] = useState(512);
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [tagKey, setTagKey] = useState('');
  const [tagValue, setTagValue] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const opt = RUNTIME_OPTIONS.find((r) => r.value === runtime) ?? RUNTIME_OPTIONS[0];

  const handler = useMemo(() => opt.handler, [opt]);

  const switchRuntime = (value: string) => {
    setRuntime(value);
    const next = RUNTIME_OPTIONS.find((r) => r.value === value);
    if (next && codeSource === 'inline') {
      setInlineCode(next.template);
    }
  };

  const envEntries = () => {
    const out: Record<string, string> = {};
    for (const row of envRows) {
      if (row.key.trim()) out[row.key.trim()] = row.value;
    }
    return out;
  };

  const canCreate =
    name.trim() &&
    (codeSource === 'inline'
      ? inlineCode.trim().length > 0
      : codeSource === 'zip'
        ? !!zipBytes
        : s3Bucket.trim() && s3Key.trim());

  const handleCreate = async () => {
    setSaving(true);
    setError('');
    try {
      let zip: Uint8Array | undefined;
      if (codeSource === 'inline') {
        zip = makeZip([{ path: handlerFileForRuntime(runtime, handler), content: inlineCode }]);
      } else if (codeSource === 'zip') {
        zip = zipBytes ?? undefined;
      }
      const tags = tagKey.trim() ? { [tagKey.trim()]: tagValue } : undefined;
      await lambdaApi.createFunction({
        name,
        runtime,
        handler,
        role,
        description: description.trim() || undefined,
        memorySize: memory,
        timeout: timeout,
        architectures: [architecture],
        environment: envEntries(),
        tags,
        zipFile: zip,
        s3Bucket: codeSource === 's3' ? s3Bucket : undefined,
        s3Key: codeSource === 's3' ? s3Key : undefined,
        s3ObjectVersion: codeSource === 's3' && s3Version.trim() ? s3Version : undefined,
      });
      toast('success', 'Function created', `${name.trim()} is ready.`);
      navigate(`/lambda/functions/${encodeURIComponent(name.trim())}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/lambda">Lambda</Link>
        <span className="sep">/</span>
        <Link to="/lambda">Functions</Link>
        <span className="sep">/</span>
        <span>Create function</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Create function</h1>
          <p className="page-description">Run code on the configured endpoint without provisioning or managing servers.</p>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <section className="card card-pad sns-section">
        <h2 className="card-title">Basic information</h2>
        <p className="card-subtitle" style={{ marginBottom: 16 }}>Define the function name, runtime and architecture.</p>

        <Field label="Function name" hint="Must be unique in this account and region. Can contain letters, numbers, hyphens and underscores.">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="my-function" spellCheck={false} />
        </Field>

        <div className="form-grid">
          <Field label="Runtime" hint="The language and version your function is written in.">
            <select className="input select" value={runtime} onChange={(e) => switchRuntime(e.target.value)}>
              {(['Node.js', 'Python'] as const).map((cat) => (
                <optgroup key={cat} label={cat}>
                  {RUNTIME_OPTIONS.filter((r) => r.category === cat).map((r: RuntimeOption) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Architecture" hint="arm64 generally costs less; x86_64 has the broadest compatibility.">
            <select className="input select" value={architecture} onChange={(e) => setArchitecture(e.target.value as 'x86_64' | 'arm64')}>
              <option value="x86_64">x86_64</option>
              <option value="arm64">arm64</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="card card-pad sns-section">
        <h2 className="card-title">Code source</h2>
        <p className="card-subtitle" style={{ marginBottom: 16 }}>How do you want to supply the deployment package?</p>

        <div className="radio-group">
          <button type="button" className={cn('radio-card', codeSource === 'inline' && 'radio-card-on')} onClick={() => setCodeSource('inline')}>
            <span className="radio-dot" />
            <span className="radio-body">
              <span className="radio-title">
                <Code2 size={14} /> Write code inline
              </span>
              <span className="radio-desc">
                Start from a sample handler for the selected runtime. The code is packaged into a .zip and uploaded automatically.
              </span>
            </span>
          </button>
          <button type="button" className={cn('radio-card', codeSource === 'zip' && 'radio-card-on')} onClick={() => setCodeSource('zip')}>
            <span className="radio-dot" />
            <span className="radio-body">
              <span className="radio-title">
                <FileArchive size={14} /> Upload a .zip file
              </span>
              <span className="radio-desc">Upload an existing deployment package from your computer.</span>
            </span>
          </button>
          <button type="button" className={cn('radio-card', codeSource === 's3' && 'radio-card-on')} onClick={() => setCodeSource('s3')}>
            <span className="radio-dot" />
            <span className="radio-body">
              <span className="radio-title">
                <Package size={14} /> Upload from Amazon S3
              </span>
              <span className="radio-desc">Reference a deployment package already stored in a bucket on the configured endpoint.</span>
            </span>
          </button>
        </div>

        {codeSource === 'inline' && (
          <>
            <div className="inline-info" style={{ marginTop: 16 }}>
              <Info size={16} />
              <span>
                Handler: <strong className="mono">{handler}</strong> · packaged as{' '}
                <strong className="mono">{handlerFileForRuntime(runtime, handler)}</strong>
              </span>
            </div>
            <Field label="Sample code" hint="Edit freely — the handler signature must stay compatible with the runtime.">
              <Textarea
                value={inlineCode}
                onChange={(e) => setInlineCode(e.target.value)}
                spellCheck={false}
                style={{ minHeight: 220, fontFamily: 'var(--mono)', fontSize: 12.5 }}
              />
            </Field>
          </>
        )}

        {codeSource === 'zip' && (
          <div style={{ marginTop: 16 }}>
            <label className="file-drop">
              <UploadCloud size={22} />
              <span>{zipName || 'Click to choose a .zip file'}</span>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void file.arrayBuffer().then((buf) => {
                    setZipBytes(new Uint8Array(buf));
                    setZipName(file.name);
                  });
                }}
              />
            </label>
            {zipName && (
              <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                {zipName} selected ({Math.round((zipBytes?.length ?? 0) / 1024)} KB)
              </div>
            )}
          </div>
        )}

        {codeSource === 's3' && (
          <div className="form-grid" style={{ marginTop: 16 }}>
            <Field label="S3 bucket">
              <TextInput value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} placeholder="my-bucket" spellCheck={false} />
            </Field>
            <Field label="S3 key" hint="Path to the .zip object inside the bucket.">
              <TextInput value={s3Key} onChange={(e) => setS3Key(e.target.value)} placeholder="functions/my-func.zip" spellCheck={false} />
            </Field>
            <Field label="Object version - optional">
              <TextInput value={s3Version} onChange={(e) => setS3Version(e.target.value)} placeholder="e.g. v1" spellCheck={false} />
            </Field>
          </div>
        )}
      </section>

      <section className="card card-pad sns-section">
        <h2 className="card-title">Permissions</h2>
        <p className="card-subtitle" style={{ marginBottom: 16 }}>
          Lambda assumes this role to access other AWS services. Local emulators accept any role.
        </p>
        <Field label="Execution role">
          <TextInput value={role} onChange={(e) => setRole(e.target.value)} spellCheck={false} className="mono" />
        </Field>
      </section>

      <section className="card card-pad sns-section">
        <div className="card-title-row" style={{ marginBottom: 12 }}>
          <h2 className="card-title">Advanced settings</h2>
          <span style={{ flex: 1 }} />
          <Toggle checked={advancedOpen} onChange={setAdvancedOpen} label={advancedOpen ? 'Collapse' : 'Expand'} />
        </div>

        {advancedOpen && (
          <>
            <div className="form-grid">
              <Field label="Description">
                <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this function do?" spellCheck={false} />
              </Field>
              <Field label="Memory (MB)" hint="128 – 10240, in 1 MB increments. CPU scales with memory.">
                <NumberInput value={memory} onChange={(e) => setMemory(Number(e.target.value))} min={128} max={10240} />
              </Field>
              <Field label="Timeout (seconds)" hint="1 – 900 seconds.">
                <NumberInput value={timeout} onChange={(e) => setTimeoutSec(Number(e.target.value))} min={1} max={900} />
              </Field>
              <Field label="Ephemeral storage (MB)" hint="512 – 10240 MB, used for /tmp.">
                <NumberInput value={ephemeralStorage} onChange={(e) => setEphemeralStorage(Number(e.target.value))} min={512} max={10240} />
              </Field>
            </div>

            <div className="form-section">
              <div className="form-section-title">Environment variables</div>
              {envRows.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No environment variables set.</p>}
              <div className="tag-editor">
                {envRows.map((row) => (
                  <div key={row.id} className="tag-row">
                    <TextInput
                      value={row.key}
                      onChange={(e) => setEnvRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, key: e.target.value } : x)))}
                      placeholder="KEY"
                      spellCheck={false}
                    />
                    <TextInput
                      value={row.value}
                      onChange={(e) => setEnvRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, value: e.target.value } : x)))}
                      placeholder="Value"
                      spellCheck={false}
                    />
                    <button type="button" className="icon-btn" title="Remove variable" onClick={() => setEnvRows((prev) => prev.filter((x) => x.id !== row.id))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEnvRows((prev) => [...prev, { id: ++envId, key: '', value: '' }])} type="button">
                <Plus size={13} />
                Add environment variable
              </Button>
            </div>

            <div className="form-section">
              <div className="form-section-title">Tags</div>
              <div className="tag-row" style={{ maxWidth: 560 }}>
                <TextInput value={tagKey} onChange={(e) => setTagKey(e.target.value)} placeholder="Key" spellCheck={false} />
                <TextInput value={tagValue} onChange={(e) => setTagValue(e.target.value)} placeholder="Value (optional)" spellCheck={false} />
              </div>
            </div>
          </>
        )}
      </section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <Button variant="ghost" onClick={() => navigate('/lambda')}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void handleCreate()} loading={saving} disabled={!canCreate}>
          Create function
        </Button>
      </div>
    </div>
  );
}
