import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, Info, KeyRound, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { secretsManagerApi, type SecretType } from '../../lib/secretsManagerApi';
import { errorMessage, useToast } from '../../lib/context';
import { Button, Field, NumberInput, TextInput, Textarea, Toggle } from '../../components/ui';
import { stringifyPairs } from './SecretsUi';

// ------------------------------------------------------------- stepper

const STEPS = [
  { label: 'Select type' },
  { label: 'Configure secret' },
  { label: 'Details' },
  { label: 'Rotation' },
  { label: 'Review' },
];

function Stepper({ current }: { current: number }) {
  return (
    <ol className="sm-steps">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.label} className={cn('sm-step', active && 'sm-step-active', done && 'sm-step-done')}>
            <span className="sm-step-dot">{done ? <Check size={13} /> : i + 1}</span>
            <span className="sm-step-label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------- tag rows

interface TagRow {
  id: number;
  key: string;
  value: string;
}

let tagId = 0;

function TagsEditor({ tags, onChange }: { tags: TagRow[]; onChange: (t: TagRow[]) => void }) {
  const add = () => onChange([...tags, { id: ++tagId, key: '', value: '' }]);
  const update = (id: number, patch: Partial<TagRow>) => onChange(tags.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const remove = (id: number) => onChange(tags.filter((t) => t.id !== id));

  return (
    <div className="sm-tags">
      {tags.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No tags added.</p>}
      {tags.length > 0 && (
        <div className="tag-editor">
          {tags.map((t) => (
            <div key={t.id} className="tag-row">
              <TextInput value={t.key} onChange={(e) => update(t.id, { key: e.target.value })} placeholder="Key" spellCheck={false} />
              <TextInput value={t.value} onChange={(e) => update(t.id, { value: e.target.value })} placeholder="Value (optional)" spellCheck={false} />
              <button type="button" className="icon-btn" title="Remove tag" onClick={() => remove(t.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={add} type="button">
        <Plus size={13} />
        Add tag
      </Button>
    </div>
  );
}

// -------------------------------------------------------------- page

export function CreateSecretPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [step, setStep] = useState(0);

  // step 1 — secret type
  const [secretType, setSecretType] = useState<SecretType>('rds');

  // step 2 — value
  const [rdsUsername, setRdsUsername] = useState('');
  const [rdsPassword, setRdsPassword] = useState('');
  const [dbHost, setDbHost] = useState('');
  const [dbPort, setDbPort] = useState('3306');
  const [dbName, setDbName] = useState('');
  const [dbUsername, setDbUsername] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [kvMode, setKvMode] = useState<'kv' | 'plaintext'>('kv');
  const [pairs, setPairs] = useState<Array<{ id: number; key: string; value: string }>>([]);
  const [plaintext, setPlaintext] = useState('');

  // step 3 — details
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kmsKeyId, setKmsKeyId] = useState('');
  const [tags, setTags] = useState<TagRow[]>([]);

  // step 4 — rotation
  const [rotationEnabled, setRotationEnabled] = useState(false);
  const [rotationLambdaArn, setRotationLambdaArn] = useState('');
  const [rotationScheduleType, setRotationScheduleType] = useState<'days' | 'cron'>('days');
  const [rotationDays, setRotationDays] = useState(30);
  const [rotationCron, setRotationCron] = useState('');
  const [rotateImmediately, setRotateImmediately] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const buildSecretString = (): string => {
    if (secretType === 'rds') {
      return JSON.stringify({ username: rdsUsername.trim(), password: rdsPassword }, null, 2);
    }
    if (secretType === 'database') {
      return JSON.stringify(
        { host: dbHost.trim(), port: Number(dbPort) || 3306, database: dbName.trim(), username: dbUsername.trim(), password: dbPassword },
        null,
        2,
      );
    }
    return kvMode === 'kv' ? stringifyPairs(pairs) : plaintext;
  };

  const stepValid = (): string => {
    if (step === 1) {
      if (secretType === 'rds' && (!rdsUsername.trim() || !rdsPassword)) return 'Enter a user name and password.';
      if (secretType === 'database' && (!dbUsername.trim() || !dbPassword)) return 'Enter a user name and password.';
      if (secretType === 'other') {
        if (kvMode === 'plaintext') {
          if (!plaintext.trim()) return 'Enter the secret value.';
        } else if (!pairs.some((p) => p.key.trim())) {
          return 'Add at least one key/value pair.';
        }
      }
    }
    if (step === 2 && !name.trim()) return 'Secret name is required.';
    if (step === 3 && rotationEnabled && !rotationLambdaArn.trim()) return 'A rotation Lambda ARN is required to enable rotation.';
    return '';
  };

  const canNext = () => !stepValid();

  const next = () => {
    const v = stepValid();
    if (v) {
      setError(v);
      return;
    }
    setError('');
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const back = () => {
    setError('');
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleStore = async () => {
    setSaving(true);
    setError('');
    try {
      const tagEntries = tags.filter((t) => t.key.trim()).map((t) => ({ key: t.key.trim(), value: t.value }));
      await secretsManagerApi.createSecret({
        name: name.trim(),
        description: description.trim() || undefined,
        secretString: buildSecretString(),
        kmsKeyId: kmsKeyId.trim() || undefined,
        tags: Object.fromEntries(tagEntries.map((t) => [t.key, t.value])),
        rotationLambdaArn: rotationEnabled ? rotationLambdaArn.trim() : undefined,
        automaticallyAfterDays: rotationEnabled && rotationScheduleType === 'days' ? rotationDays : undefined,
        scheduleExpression: rotationEnabled && rotationScheduleType === 'cron' ? rotationCron.trim() : undefined,
      });
      toast('success', 'Secret stored', rotationEnabled ? 'Rotation configured (if supported by the endpoint).' : name.trim());
      navigate(`/secrets/secret/${encodeURIComponent(name.trim())}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/secrets">Secrets Manager</Link>
        <span className="sep">/</span>
        <Link to="/secrets">Secrets</Link>
        <span className="sep">/</span>
        <span>Store a new secret</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Store a new secret</h1>
          <p className="page-description">Save credentials, API keys and other sensitive values in encrypted form.</p>
        </div>
      </div>

      <Stepper current={step} />

      {error && <div className="inline-error">{error}</div>}

      <section className="card card-pad sns-section">
        {step === 0 && (
          <>
            <h2 className="card-title">Select secret type</h2>
            <p className="card-subtitle" style={{ marginBottom: 16 }}>Choose the type of secret to store. The stored value is always encrypted at rest.</p>
            <div className="radio-group">
              {(
                [
                  {
                    type: 'rds' as SecretType,
                    title: 'Credentials for Amazon RDS database',
                    desc: 'Store credentials for a relational database hosted by Amazon Relational Database Service (RDS).',
                  },
                  {
                    type: 'database' as SecretType,
                    title: 'Credentials for other database',
                    desc: 'Store credentials for a non-Amazon database such as MySQL, PostgreSQL or Oracle running elsewhere.',
                  },
                  {
                    type: 'other' as SecretType,
                    title: 'Other type of secret',
                    desc: 'Store an API key, OAuth token, or any other secret as a set of key/value pairs or plaintext.',
                  },
                ]
              ).map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  className={cn('radio-card', secretType === opt.type && 'radio-card-on')}
                  onClick={() => setSecretType(opt.type)}
                >
                  <span className="radio-dot" />
                  <span className="radio-body">
                    <span className="radio-title">{opt.title}</span>
                    <span className="radio-desc">{opt.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="card-title">Configure secret value</h2>
            <p className="card-subtitle" style={{ marginBottom: 16 }}>Define the value that will be returned when the secret is retrieved.</p>

            {secretType === 'rds' && (
              <div className="form-grid">
                <Field label="User name" hint="The database user that the credentials belong to.">
                  <TextInput value={rdsUsername} onChange={(e) => setRdsUsername(e.target.value)} placeholder="dbadmin" spellCheck={false} />
                </Field>
                <Field label="Password" hint="Stored encrypted; only shown when you retrieve the secret.">
                  <TextInput type="password" value={rdsPassword} onChange={(e) => setRdsPassword(e.target.value)} placeholder="••••••••" spellCheck={false} />
                </Field>
              </div>
            )}

            {secretType === 'database' && (
              <div className="form-grid">
                <Field label="Host name">
                  <TextInput value={dbHost} onChange={(e) => setDbHost(e.target.value)} placeholder="db.example.com" spellCheck={false} />
                </Field>
                <Field label="Port">
                  <NumberInput value={dbPort} onChange={(e) => setDbPort(e.target.value)} min={1} max={65535} />
                </Field>
                <Field label="Database name">
                  <TextInput value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="appdb" spellCheck={false} />
                </Field>
                <Field label="User name">
                  <TextInput value={dbUsername} onChange={(e) => setDbUsername(e.target.value)} placeholder="dbadmin" spellCheck={false} />
                </Field>
                <Field label="Password" className="span-2">
                  <TextInput type="password" value={dbPassword} onChange={(e) => setDbPassword(e.target.value)} placeholder="••••••••" spellCheck={false} />
                </Field>
              </div>
            )}

            {secretType === 'other' && (
              <>
                <div className="segmented" style={{ marginBottom: 16 }}>
                  <button type="button" className={cn('segmented-btn', kvMode === 'kv' && 'segmented-active')} onClick={() => setKvMode('kv')}>
                    Key/value
                  </button>
                  <button type="button" className={cn('segmented-btn', kvMode === 'plaintext' && 'segmented-active')} onClick={() => setKvMode('plaintext')}>
                    Plaintext
                  </button>
                </div>

                {kvMode === 'kv' ? (
                  <div className="tag-editor">
                    {pairs.length === 0 && <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>No key/value pairs yet.</p>}
                    {pairs.map((p) => (
                      <div key={p.id} className="tag-row">
                        <TextInput value={p.key} onChange={(e) => setPairs((prev) => prev.map((x) => (x.id === p.id ? { ...x, key: e.target.value } : x)))} placeholder="Key" spellCheck={false} />
                        <TextInput value={p.value} onChange={(e) => setPairs((prev) => prev.map((x) => (x.id === p.id ? { ...x, value: e.target.value } : x)))} placeholder="Value" spellCheck={false} />
                        <button type="button" className="icon-btn" title="Remove pair" onClick={() => setPairs((prev) => prev.filter((x) => x.id !== p.id))}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPairs((prev) => [...prev, { id: ++tagId, key: '', value: '' }])}
                      type="button"
                      style={{ alignSelf: 'flex-start' }}
                    >
                      <Plus size={13} />
                      Add key/value pair
                    </Button>
                  </div>
                ) : (
                  <Field label="Plaintext" hint="The exact value stored for this secret.">
                    <Textarea
                      value={plaintext}
                      onChange={(e) => setPlaintext(e.target.value)}
                      placeholder="my-secret-value"
                      spellCheck={false}
                      style={{ minHeight: 140 }}
                    />
                  </Field>
                )}
              </>
            )}

            <div className="inline-info" style={{ marginBottom: 0 }}>
              <Info size={16} />
              <span>Stored value preview:</span>
              <pre className="msg-body-preview" style={{ margin: 0, maxHeight: 160, flex: 1 }}>
                {buildSecretString() || '—'}
              </pre>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="card-title">Secret details</h2>
            <p className="card-subtitle" style={{ marginBottom: 16 }}>Give the secret a name, description, encryption key and tags.</p>

            <Field label="Secret name" hint="Must be unique in this account and region. Can contain alphanumeric characters, hyphens, underscores and slashes.">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="my-api-key" spellCheck={false} />
            </Field>
            <Field label="Description - optional" hint="A short note to help identify this secret.">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="API key for the production gateway" style={{ minHeight: 70 }} />
            </Field>
            <Field
              label="Encryption key - optional"
              hint="Leave empty to use the default AWS managed key (aws/secretsmanager), or enter a KMS key ID / ARN / alias."
            >
              <TextInput value={kmsKeyId} onChange={(e) => setKmsKeyId(e.target.value)} placeholder="alias/aws/secretsmanager" spellCheck={false} />
            </Field>
            <div className="form-section">
              <div className="form-section-title">Tags</div>
              <TagsEditor tags={tags} onChange={setTags} />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="card-title">Automatic rotation</h2>
            <p className="card-subtitle" style={{ marginBottom: 16 }}>
              Rotate the secret on a schedule with a Lambda function. Not every emulator implements rotation — configure it, and errors are surfaced if unsupported.
            </p>

            <Field label="Enable automatic rotation" hint="Requires a rotation Lambda function in the same account and region.">
              <div className="toggle-wrap" style={{ marginTop: 6 }}>
                <Toggle checked={rotationEnabled} onChange={setRotationEnabled} />
              </div>
            </Field>

            {rotationEnabled && (
              <>
                <Field label="Rotation Lambda function ARN" hint="The function invoked to create and store a new version of the secret.">
                  <TextInput
                    value={rotationLambdaArn}
                    onChange={(e) => setRotationLambdaArn(e.target.value)}
                    placeholder="arn:aws:lambda:us-east-1:000000000000:function:rotate-secret"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Schedule" hint="How often the secret is rotated.">
                  <div className="radio-group">
                    <button type="button" className={cn('radio-card', rotationScheduleType === 'days' && 'radio-card-on')} onClick={() => setRotationScheduleType('days')}>
                      <span className="radio-dot" />
                      <span className="radio-body">
                        <span className="radio-title">Every N days</span>
                        <span className="radio-desc" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <NumberInput
                            value={rotationDays}
                            onChange={(e) => setRotationDays(Number(e.target.value))}
                            min={1}
                            max={1000}
                            style={{ width: 90 }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          days
                        </span>
                      </span>
                    </button>
                    <button type="button" className={cn('radio-card', rotationScheduleType === 'cron' && 'radio-card-on')} onClick={() => setRotationScheduleType('cron')}>
                      <span className="radio-dot" />
                      <span className="radio-body">
                        <span className="radio-title">Custom schedule</span>
                        <span className="radio-desc" style={{ display: 'block' }}>
                          <TextInput
                            value={rotationCron}
                            onChange={(e) => setRotationCron(e.target.value)}
                            placeholder="cron(0 16 1 * ? *)"
                            style={{ marginTop: 6 }}
                            spellCheck={false}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </span>
                      </span>
                    </button>
                  </div>
                </Field>
                <Field label="Rotate immediately" hint="Rotate the secret as soon as this configuration is saved.">
                  <div className="toggle-wrap" style={{ marginTop: 6 }}>
                    <Toggle checked={rotateImmediately} onChange={setRotateImmediately} />
                  </div>
                </Field>
              </>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="card-title">Review and store</h2>
            <p className="card-subtitle" style={{ marginBottom: 16 }}>Confirm the details below, then store the secret.</p>
            <dl className="kv-grid" style={{ marginBottom: 16 }}>
              <ReviewRow label="Secret name" value={name.trim() || '—'} mono />
              <ReviewRow label="Secret type" value={secretType === 'rds' ? 'RDS database credentials' : secretType === 'database' ? 'Other database credentials' : 'Other type of secret'} />
              <ReviewRow label="Description" value={description.trim() || '—'} />
              <ReviewRow label="Encryption key" value={kmsKeyId.trim() || 'aws/secretsmanager (AWS managed key)'} mono />
              <ReviewRow label="Value format" value={secretType === 'other' && kvMode === 'plaintext' ? 'Plaintext' : 'Key/value JSON'} />
              <ReviewRow label="Rotation" value={rotationEnabled ? `Enabled (${rotationScheduleType === 'days' ? `every ${rotationDays} days` : rotationCron.trim() || 'custom schedule'})` : 'Disabled'} />
              <ReviewRow label="Tags" value={tags.filter((t) => t.key.trim()).length > 0 ? tags.filter((t) => t.key.trim()).map((t) => `${t.key}=${t.value}`).join(', ') : '—'} />
            </dl>
            <div className="inline-info" style={{ marginBottom: 0 }}>
              <KeyRound size={16} />
              <span>The secret value is stored encrypted and can only be read back with GetSecretValue.</span>
            </div>
          </>
        )}
      </section>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18 }}>
        <Button variant="secondary" onClick={() => (step === 0 ? navigate('/secrets') : back())}>
          <ArrowLeft size={14} />
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" onClick={next} disabled={!canNext()}>
            Next
            <ChevronRight size={14} />
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void handleStore()} loading={saving}>
            Store
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="kv-row">
      <dt className="kv-label">{label}</dt>
      <dd className={cn('kv-value', mono && 'kv-mono')} style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}
