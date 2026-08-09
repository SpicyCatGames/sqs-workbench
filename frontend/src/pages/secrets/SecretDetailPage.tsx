import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  FileKey,
  History,
  Info,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Tags as TagsIcon,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { secretsManagerApi, isUnsupportedOperation, type RotationConfig, type SecretValue, type SecretVersion, type SmSecret } from '../../lib/secretsManagerApi';
import { errorMessage, useToast } from '../../lib/context';
import { prettyJson } from '../../lib/format';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Modal, NumberInput, Select, SkeletonRows, Stat, Tabs, Textarea, TextInput, Toggle, type TabDef } from '../../components/ui';
import { DeletedBadge, formatDate, parseSecretString, RotationBadge, stringifyPairs, useReload } from './SecretsUi';

let tagId = 0;

// ------------------------------------------------------------ value modal

interface ValueModalProps {
  secretName: string;
  versionId?: string;
  onClose: () => void;
  onChanged: () => void;
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {});
}

/** Show the secret value (key/value table or plaintext) with copy + update actions. */
function ValueModal({ secretName, versionId, onClose, onChanged }: ValueModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [value, setValue] = useState<SecretValue | null>(null);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setValue(await secretsManagerApi.getSecretValue(secretName, versionId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const secretString = value?.secretString ?? '';
  const { pairs, plaintext } = parseSecretString(secretString);

  return (
    <Modal
      open
      title="Secret value"
      subtitle={value ? `${secretName} · version ${value.versionId ?? ''}` : secretName}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {!versionId && value && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Update
            </Button>
          )}
        </>
      }
    >
      {loading && <SkeletonRows rows={5} />}
      {!loading && error && <ErrorState message={error} onRetry={() => void load()} />}

      {!loading && !error && value && !editing && (
        <>
          <div className="card-title-row" style={{ marginBottom: 10 }}>
            <span className="detail-subhead-title">Value</span>
            <span style={{ flex: 1 }} />
            <IconButton title="Copy secret value" onClick={() => copyText(secretString)}>
              <Copy size={15} />
            </IconButton>
          </div>

          {value.secretBinaryBase64 ? (
            <pre className="json-preview">{value.secretBinaryBase64}</pre>
          ) : pairs.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((p) => (
                    <tr key={p.key}>
                      <td style={{ fontWeight: 600 }}>{p.key}</td>
                      <td>
                        <span className="mono">{p.value}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="json-preview" style={{ maxHeight: 360 }}>{plaintext}</pre>
          )}

          <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>
            Staged as: {value.versionStages.join(', ') || '—'} · retrieved {value.createdDate ? formatDate(value.createdDate) : ''}
          </div>
        </>
      )}

      {!loading && !error && editing && (
        <EditValueForm
          secretName={secretName}
          initial={secretString}
          onSaved={(versionIdOut) => {
            toast('success', 'Secret value updated', `New version ${versionIdOut ?? ''} created.`);
            setEditing(false);
            onChanged();
            void load();
          }}
        />
      )}
    </Modal>
  );
}

function EditValueForm({ secretName, initial, onSaved }: { secretName: string; initial: string; onSaved: (versionId?: string) => void }) {
  const initialPairs = parseSecretString(initial);
  const [mode, setMode] = useState<'kv' | 'plaintext'>(initialPairs.pairs.length > 0 ? 'kv' : 'plaintext');
  const [pairs, setPairs] = useState(initialPairs.pairs.map((p) => ({ id: ++tagId, key: p.key, value: p.value })));
  const [plaintext, setPlaintext] = useState(initialPairs.plaintext || initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const finalValue = mode === 'kv' ? stringifyPairs(pairs) : plaintext;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await secretsManagerApi.putSecretValue(secretName, finalValue);
      onSaved(res.versionId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="detail-subhead">
        <span className="detail-subhead-title">Edit value</span>
        <div className="segmented">
          <button type="button" className={cn('segmented-btn', mode === 'kv' && 'segmented-active')} onClick={() => setMode('kv')}>
            Key/value
          </button>
          <button type="button" className={cn('segmented-btn', mode === 'plaintext' && 'segmented-active')} onClick={() => setMode('plaintext')}>
            Plaintext
          </button>
        </div>
      </div>
      {mode === 'kv' ? (
        <div className="tag-editor" style={{ marginBottom: 12 }}>
          {pairs.map((p) => (
            <div key={p.id} className="tag-row">
              <TextInput value={p.key} onChange={(e) => setPairs((prev) => prev.map((x) => (x.id === p.id ? { ...x, key: e.target.value } : x)))} placeholder="Key" spellCheck={false} />
              <TextInput value={p.value} onChange={(e) => setPairs((prev) => prev.map((x) => (x.id === p.id ? { ...x, value: e.target.value } : x)))} placeholder="Value" spellCheck={false} />
              <button type="button" className="icon-btn" onClick={() => setPairs((prev) => prev.filter((x) => x.id !== p.id))}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setPairs((prev) => [...prev, { id: ++tagId, key: '', value: '' }])} type="button" style={{ alignSelf: 'flex-start' }}>
            <Plus size={13} />
            Add key/value pair
          </Button>
        </div>
      ) : (
        <Textarea value={plaintext} onChange={(e) => setPlaintext(e.target.value)} style={{ minHeight: 160, marginBottom: 12 }} spellCheck={false} />
      )}
      <div className="inline-info" style={{ marginBottom: 0 }}>
        <Info size={16} />
        <span>Saving creates a new version and moves it to the AWSCURRENT stage. The previous version becomes AWSPREVIOUS.</span>
      </div>
      {error && <div className="inline-error">{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <Button variant="primary" onClick={() => void handleSave()} loading={saving} disabled={!finalValue.trim()}>
          Save new version
        </Button>
      </div>
    </>
  );
}

// ------------------------------------------------------------- edit secret

function EditSecretModal({ secret, onClose, onSaved }: { secret: SmSecret; onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState(secret.description ?? '');
  const [kmsKeyId, setKmsKeyId] = useState(secret.kmsKeyId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await secretsManagerApi.updateSecret(secret.name, { description, kmsKeyId });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Edit secret"
      subtitle={secret.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <Field label="Description - optional">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 70 }} />
      </Field>
      <Field label="Encryption key" hint="KMS key ID, ARN or alias. Leave blank for the AWS managed key.">
        <TextInput value={kmsKeyId} onChange={(e) => setKmsKeyId(e.target.value)} placeholder="alias/aws/secretsmanager" spellCheck={false} />
      </Field>
      <div className="muted" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertTriangle size={13} />
        Secret name cannot be changed after creation.
      </div>
      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}

// ---------------------------------------------------------- rotation modal

function EditRotationModal({ secret, onClose, onSaved }: { secret: SmSecret; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const rules = secret.rotationRules;
  const [enabled, setEnabled] = useState(secret.rotationEnabled);
  const [lambdaArn, setLambdaArn] = useState(secret.rotationLambdaArn ?? '');
  const [scheduleType, setScheduleType] = useState<'days' | 'cron'>(rules?.scheduleExpression ? 'cron' : 'days');
  const [days, setDays] = useState(rules?.automaticallyAfterDays ?? 30);
  const [cron, setCron] = useState(rules?.scheduleExpression ?? '');
  const [rotateNow, setRotateNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      if (enabled) {
        const config: RotationConfig = {
          enabled,
          lambdaArn,
          automaticallyAfterDays: scheduleType === 'days' ? days : undefined,
          scheduleExpression: scheduleType === 'cron' ? cron : undefined,
          rotateImmediately: rotateNow || undefined,
        };
        await secretsManagerApi.enableRotation(secret.name, config);
        toast('success', 'Rotation configured', rotateNow ? 'Secret rotated immediately.' : undefined);
      } else {
        await secretsManagerApi.disableRotation(secret.name);
        toast('success', 'Rotation disabled');
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      if (isUnsupportedOperation(err)) {
        toast('info', 'Rotation may be unsupported by this endpoint', 'The emulator may not implement automatic rotation.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Edit rotation"
      subtitle={secret.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving} disabled={enabled && !lambdaArn.trim()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Enable automatic rotation" hint="Requires a Lambda function with the rotation logic.">
        <div className="toggle-wrap" style={{ marginTop: 6 }}>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>
      </Field>
      {enabled && (
        <>
          <Field label="Rotation Lambda function ARN">
            <TextInput value={lambdaArn} onChange={(e) => setLambdaArn(e.target.value)} placeholder="arn:aws:lambda:us-east-1:000000000000:function:rotate-secret" spellCheck={false} />
          </Field>
          <Field label="Schedule">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Select value={scheduleType} onChange={(e) => setScheduleType(e.target.value as 'days' | 'cron')} style={{ width: 190 }}>
                <option value="days">Every N days</option>
                <option value="cron">Custom schedule</option>
              </Select>
              {scheduleType === 'days' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <NumberInput value={days} onChange={(e) => setDays(Number(e.target.value))} min={1} max={1000} style={{ width: 90 }} />
                  <span className="muted">days</span>
                </div>
              ) : (
                <TextInput value={cron} onChange={(e) => setCron(e.target.value)} placeholder="cron(0 16 1 * ? *)" style={{ flex: 1, minWidth: 220 }} spellCheck={false} />
              )}
            </div>
          </Field>
          <Field label="Rotate immediately" hint="Invoke the rotation function as soon as this is saved.">
            <div className="toggle-wrap" style={{ marginTop: 6 }}>
              <Toggle checked={rotateNow} onChange={setRotateNow} />
            </div>
          </Field>
        </>
      )}
      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}

// ------------------------------------------------------------ delete modal

function DeleteSecretModal({ secret, onClose, onDeleted }: { secret: SmSecret; onClose: () => void; onDeleted: () => void }) {
  const [mode, setMode] = useState<'schedule' | 'force'>('schedule');
  const [days, setDays] = useState(7);
  const [confirmText, setConfirmText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      await secretsManagerApi.deleteSecret(secret.name, {
        recoveryWindowInDays: mode === 'schedule' ? days : undefined,
        forceDeleteWithoutRecovery: mode === 'force',
      });
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Delete secret"
      subtitle={secret.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void handleDelete()} loading={saving} disabled={mode === 'force' ? confirmText !== secret.name : false}>
            {mode === 'schedule' ? 'Schedule deletion' : 'Delete permanently'}
          </Button>
        </>
      }
    >
      <div className="radio-group" style={{ marginBottom: 14 }}>
        <button type="button" className={cn('radio-card', mode === 'schedule' && 'radio-card-on')} onClick={() => setMode('schedule')}>
          <span className="radio-dot" />
          <span className="radio-body">
            <span className="radio-title">Schedule secret deletion</span>
            <span className="radio-desc">
              Wait a specified number of days before deleting the secret. You can restore it any time before deletion.
            </span>
          </span>
        </button>
        <button type="button" className={cn('radio-card', mode === 'force' && 'radio-card-on')} onClick={() => setMode('force')}>
          <span className="radio-dot" />
          <span className="radio-body">
            <span className="radio-title">Delete secret immediately</span>
            <span className="radio-desc">The secret is permanently deleted right away and cannot be restored.</span>
          </span>
        </button>
      </div>

      {mode === 'schedule' ? (
        <Field label="Recovery window (days)" hint="Between 7 and 30 days.">
          <NumberInput value={days} onChange={(e) => setDays(Number(e.target.value))} min={7} max={30} style={{ width: 120 }} />
        </Field>
      ) : (
        <Field label={`Type "${secret.name}" to confirm permanent deletion`}>
          <TextInput value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={secret.name} spellCheck={false} />
        </Field>
      )}
      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}

// --------------------------------------------------------------- page

const TABS: TabDef[] = [
  { id: 'value', label: 'Secret value', icon: <KeyRound size={14} /> },
  { id: 'config', label: 'Configuration', icon: <Pencil size={14} /> },
  { id: 'versions', label: 'Versions', icon: <History size={14} /> },
  { id: 'rotation', label: 'Rotation', icon: <RefreshCw size={14} /> },
  { id: 'permissions', label: 'Resource permissions', icon: <FileKey size={14} /> },
  { id: 'tags', label: 'Tags', icon: <TagsIcon size={14} /> },
];

export function SecretDetailPage() {
  const { name } = useParams<{ name: string }>();
  const secretName = name ?? '';
  const navigate = useNavigate();
  const { toast } = useToast();

  const [secret, setSecret] = useState<SmSecret | null>(null);
  const [versions, setVersions] = useState<SecretVersion[]>([]);
  const [tab, setTab] = useState('value');

  const [valueOpen, setValueOpen] = useState(false);
  const [valueVersionId, setValueVersionId] = useState<string | undefined>(undefined);
  const [editOpen, setEditOpen] = useState(false);
  const [rotationOpen, setRotationOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const { loading, error, load } = useReload(
    async () => {
      const [s, v] = await Promise.all([secretsManagerApi.getSecret(secretName), secretsManagerApi.listSecretVersions(secretName)]);
      setSecret(s);
      setVersions(v.versions);
    },
    [secretName],
  );

  const deleted = !!secret?.deletedDate;

  const openValue = (versionId?: string) => {
    setValueVersionId(versionId);
    setValueOpen(true);
  };

  const handleRestore = async () => {
    setActionLoading(true);
    try {
      await secretsManagerApi.restoreSecret(secretName);
      toast('success', 'Secret restored', secretName);
      await load();
    } catch (err) {
      toast('error', 'Restore failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRotateNow = async () => {
    setActionLoading(true);
    try {
      await secretsManagerApi.rotateSecretNow(secretName);
      toast('success', 'Rotation started', 'The rotation Lambda function was invoked.');
      await load();
    } catch (err) {
      toast('error', 'Rotation failed', errorMessage(err));
      if (isUnsupportedOperation(err)) {
        toast('info', 'Rotation may be unsupported by this endpoint');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelRotation = async () => {
    setActionLoading(true);
    try {
      await secretsManagerApi.cancelRotation(secretName);
      toast('success', 'Rotation cancelled');
      await load();
    } catch (err) {
      toast('error', 'Cancel failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="breadcrumbs">
          <Link to="/secrets">Secrets Manager</Link>
          <span className="sep">/</span>
          <Link to="/secrets">Secrets</Link>
        </div>
        <div className="table-wrap">
          <SkeletonRows rows={8} />
        </div>
      </div>
    );
  }

  if (error || !secret) {
    return (
      <div className="page">
        <div className="breadcrumbs">
          <Link to="/secrets">Secrets Manager</Link>
          <span className="sep">/</span>
          <Link to="/secrets">Secrets</Link>
        </div>
        <div className="card">
          <ErrorState message={error || 'Secret not found'} onRetry={() => void load()} />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/secrets">Secrets Manager</Link>
        <span className="sep">/</span>
        <Link to="/secrets">Secrets</Link>
        <span className="sep">/</span>
        <span>{secret.name}</span>
      </div>

      <div className="detail-header-card">
        <div style={{ minWidth: 0 }}>
          <div className="detail-title-row">
            <h1 className="detail-name">{secret.name}</h1>
            <RotationBadge enabled={secret.rotationEnabled} />
            <DeletedBadge deletedDate={secret.deletedDate} />
          </div>
          <div className="detail-meta">
            <span className="mono" style={{ wordBreak: 'break-all' }}>{secret.arn}</span>
            <span>Owner: {secret.owningService ? `Managed by ${secret.owningService}` : 'This account'}</span>
          </div>
        </div>
        <div className="page-actions">
          {!deleted && (
            <>
              <Button variant="primary" onClick={() => openValue()}>
                <Eye size={14} />
                Retrieve secret value
              </Button>
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                <Pencil size={14} />
                Edit
              </Button>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={14} />
                Delete
              </Button>
            </>
          )}
          {deleted && (
            <Button variant="secondary" onClick={() => void handleRestore()} loading={actionLoading}>
              <RotateCcw size={14} />
              Restore secret
            </Button>
          )}
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'value' && (
        <SecretValueTab onRetrieve={() => openValue()} />
      )}

      {tab === 'config' && (
        <div className="card card-pad">
          <div className="card-title-row" style={{ marginBottom: 12 }}>
            <h2 className="card-title">Configuration</h2>
            <span style={{ flex: 1 }} />
            {!deleted && (
              <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil size={13} />
                Edit
              </Button>
            )}
          </div>
          <dl className="kv-grid">
            <Kv label="Name" mono>{secret.name}</Kv>
            <Kv label="ARN" mono>{secret.arn}</Kv>
            <Kv label="Description">{secret.description || '—'}</Kv>
            <Kv label="Encryption key" mono>{secret.kmsKeyId ? (secret.kmsKeyId.startsWith('alias/aws/secretsmanager') ? 'aws/secretsmanager (AWS managed key)' : secret.kmsKeyId) : 'aws/secretsmanager (AWS managed key)'}</Kv>
            <Kv label="Created date">{formatDate(secret.createdDate)}</Kv>
            <Kv label="Last changed date">{formatDate(secret.lastChangedDate)}</Kv>
            <Kv label="Last accessed date">{formatDate(secret.lastAccessedDate)}</Kv>
            <Kv label="Rotation status">
              <RotationBadge enabled={secret.rotationEnabled} />
            </Kv>
            {secret.rotationLambdaArn && <Kv label="Rotation Lambda" mono>{secret.rotationLambdaArn}</Kv>}
            <Kv label="Owning service">{secret.owningService || 'This account'}</Kv>
          </dl>
        </div>
      )}

      {tab === 'versions' && (
        <VersionsTab
          secret={secret}
          versions={versions}
          currentVersionId={Object.entries(secret.versionsToStages).find(([, stages]) => stages.includes('AWSCURRENT'))?.[0]}
          onShowValue={openValue}
          onChanged={() => { toast('success', 'Version stage updated'); void load(); }}
        />
      )}

      {tab === 'rotation' && (
        <RotationTab
          secret={secret}
          onEdit={() => setRotationOpen(true)}
          onRotateNow={() => void handleRotateNow()}
          onCancel={() => void handleCancelRotation()}
          actionLoading={actionLoading}
        />
      )}

      {tab === 'permissions' && (
        <PermissionsTab
          secretName={secret.name}
          onChanged={() => { toast('success', 'Resource policy updated'); void load(); }}
        />
      )}

      {tab === 'tags' && (
        <TagsTab
          secret={secret}
          onChanged={() => { toast('success', 'Tags updated'); void load(); }}
        />
      )}

      {valueOpen && (
        <ValueModal
          secretName={secretName}
          versionId={valueVersionId}
          onClose={() => setValueOpen(false)}
          onChanged={() => void load()}
        />
      )}
      {editOpen && <EditSecretModal secret={secret} onClose={() => setEditOpen(false)} onSaved={() => void load()} />}
      {rotationOpen && <EditRotationModal secret={secret} onClose={() => setRotationOpen(false)} onSaved={() => void load()} />}

      {deleteOpen && <DeleteSecretModal secret={secret} onClose={() => setDeleteOpen(false)} onDeleted={() => { toast('success', 'Secret deletion scheduled'); navigate('/secrets'); }} />}
    </div>
  );
}

// ------------------------------------------------------------- sub-tabs

function Kv({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="kv-row">
      <dt className="kv-label">{label}</dt>
      <dd className={cn('kv-value', mono && 'kv-mono')} style={{ margin: 0 }}>{children ?? '—'}</dd>
    </div>
  );
}

function SecretValueTab({ onRetrieve }: { onRetrieve: () => void }) {
  return (
    <div className="card card-pad">
      <h2 className="card-title">Secret value</h2>
      <p className="card-subtitle" style={{ marginBottom: 14 }}>
        The current value of this secret, encrypted at rest with the configured KMS key. Retrieve it to view key/value pairs or plaintext.
      </p>
      <div className="inline-info" style={{ marginBottom: 0 }}>
        <Info size={16} />
        <span>Retrieving the value calls the GetSecretValue API — this does not modify the secret or create log entries beyond normal CloudTrail-style auditing.</span>
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="primary" onClick={onRetrieve}>
          <Eye size={14} />
          Retrieve secret value
        </Button>
      </div>
    </div>
  );
}

function VersionsTab({
  secret,
  versions,
  currentVersionId,
  onShowValue,
  onChanged,
}: {
  secret: SmSecret;
  versions: SecretVersion[];
  currentVersionId?: string;
  onShowValue: (versionId: string) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [actionLoading, setActionLoading] = useState('');

  const promote = async (versionId: string) => {
    setActionLoading(versionId);
    try {
      await secretsManagerApi.setCurrentVersion(secret.name, versionId, currentVersionId);
      onChanged();
    } catch (err) {
      toast('error', 'Failed to promote version', errorMessage(err));
    } finally {
      setActionLoading('');
    }
  };

  const stageLabel = (stages: string[]) =>
    stages.length === 0 ? (
      <span className="muted">—</span>
    ) : (
      stages.map((s) => (
        <Badge key={s} tone={s === 'AWSCURRENT' ? 'success' : s === 'AWSPREVIOUS' ? 'fifo' : 'default'}>
          {s}
        </Badge>
      ))
    );

  return (
    <div className="card card-pad">
      <div className="card-title-row" style={{ marginBottom: 12 }}>
        <h2 className="card-title">Versions</h2>
        <span className="muted" style={{ fontSize: 12.5 }}>{versions.length} total</span>
      </div>
      <p className="card-subtitle" style={{ marginBottom: 12 }}>
        Each update creates a new version. The version staged <Badge tone="success">AWSCURRENT</Badge> is returned by GetSecretValue by default.
      </p>
      {versions.length === 0 ? (
        <EmptyState title="No versions" description="Store a value to create the first version." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Version ID</th>
                <th>Stages</th>
                <th>Created date</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.versionId}>
                  <td className="mono" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.versionId}</td>
                  <td>{stageLabel(v.stages)}</td>
                  <td>{formatDate(v.createdDate)}</td>
                  <td>
                    <div className="row-actions">
                      <IconButton title="View this version's value" onClick={() => onShowValue(v.versionId)}>
                        <Eye size={15} />
                      </IconButton>
                      {!v.stages.includes('AWSCURRENT') && (
                        <IconButton title="Set as current version" loading={actionLoading === v.versionId} onClick={() => void promote(v.versionId)}>
                          <Check size={15} />
                        </IconButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RotationTab({
  secret,
  onEdit,
  onRotateNow,
  onCancel,
  actionLoading,
}: {
  secret: SmSecret;
  onEdit: () => void;
  onRotateNow: () => void;
  onCancel: () => void;
  actionLoading: boolean;
}) {
  const rules = secret.rotationRules;
  const scheduleLabel = rules?.scheduleExpression ?? (rules?.automaticallyAfterDays ? `Every ${rules.automaticallyAfterDays} days` : '—');
  return (
    <>
      <div className="stats-row">
        <Stat label="Rotation status" value={secret.rotationEnabled ? 'Enabled' : 'Disabled'} />
        <Stat label="Last rotated" value={formatDate(secret.lastRotatedDate)} />
        <Stat label="Schedule" value={scheduleLabel} />
      </div>
      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 12 }}>
          <h2 className="card-title">Rotation configuration</h2>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <Pencil size={13} />
            Edit rotation
          </Button>
          {secret.rotationEnabled && (
            <>
              <Button variant="secondary" size="sm" onClick={onRotateNow} loading={actionLoading}>
                <RefreshCw size={13} />
                Rotate immediately
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancel} loading={actionLoading}>
                Cancel rotation
              </Button>
            </>
          )}
        </div>
        {secret.rotationEnabled ? (
          <dl className="kv-grid">
            <Kv label="Rotation Lambda" mono>{secret.rotationLambdaArn || '—'}</Kv>
            <Kv label="Schedule">{scheduleLabel}</Kv>
            {rules?.duration && <Kv label="Rotation duration">{rules.duration}</Kv>}
            <Kv label="Last rotated date">{formatDate(secret.lastRotatedDate)}</Kv>
          </dl>
        ) : (
          <div className="inline-info" style={{ marginBottom: 0 }}>
            <Info size={16} />
            <span>Automatic rotation is disabled. Enable it with a Lambda function to rotate this secret on a schedule. Note: some emulators do not implement rotation.</span>
          </div>
        )}
      </div>
    </>
  );
}

function PermissionsTab({ secretName, onChanged }: { secretName: string; onChanged: () => void }) {
  const [policy, setPolicy] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await secretsManagerApi.getResourcePolicy(secretName);
      setPolicy(prettyJson(res.policy ?? ''));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretName]);

  const handleSave = async () => {
    let parsed: string;
    try {
      parsed = JSON.stringify(JSON.parse(policy), null, 2);
    } catch {
      setError('The policy must be valid JSON.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await secretsManagerApi.putResourcePolicy(secretName, parsed);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      await secretsManagerApi.deleteResourcePolicy(secretName);
      setPolicy('');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-pad">
      <h2 className="card-title">Resource permissions</h2>
      <p className="card-subtitle" style={{ marginBottom: 12 }}>
        A resource-based policy controls which other AWS accounts and principals can access this secret. Changes apply immediately.
      </p>
      <div className="inline-info" style={{ marginTop: 0 }}>
        <Info size={16} />
        <span>By default, secrets are only accessible by your own account. Use a policy like the example below to grant cross-account access.</span>
      </div>
      {loading ? (
        <SkeletonRows rows={4} />
      ) : (
        <Textarea
          value={policy}
          onChange={(e) => setPolicy(e.target.value)}
          spellCheck={false}
          placeholder={JSON.stringify(
            {
              Version: '2012-10-17',
              Statement: [{ Sid: 'cross-account', Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::123456789012:root' }, Action: 'secretsmanager:GetSecretValue', Resource: '*' }],
            },
            null,
            2,
          )}
          style={{ minHeight: 260, fontFamily: 'var(--mono)', fontSize: 12.5 }}
        />
      )}
      {error && <div className="inline-error">{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
        {policy && (
          <Button variant="ghost" onClick={() => void handleDelete()} loading={saving}>
            Delete policy
          </Button>
        )}
        <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
          Save policy
        </Button>
      </div>
    </div>
  );
}

function TagsTab({ secret, onChanged }: { secret: SmSecret; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleAdd = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setError('');
    try {
      await secretsManagerApi.tagSecret(secret.name, { [key.trim()]: value });
      setKey('');
      setValue('');
      setAdding(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tagKey: string) => {
    setSaving(true);
    try {
      await secretsManagerApi.untagSecret(secret.name, [tagKey]);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const entries = Object.entries(secret.tags);

  return (
    <div className="card card-pad">
      <div className="card-title-row" style={{ marginBottom: 12 }}>
        <h2 className="card-title">Tags</h2>
        <span className="muted" style={{ fontSize: 12.5 }}>{entries.length} tag{entries.length === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          <Plus size={13} />
          Add tag
        </Button>
      </div>
      <p className="card-subtitle" style={{ marginBottom: 12 }}>Tags help you organize and identify this secret.</p>

      {error && <div className="inline-error">{error}</div>}

      {entries.length === 0 ? (
        <EmptyState title="No tags" description="Add tags to this secret to organize it." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k}>
                  <td className="mono" style={{ fontWeight: 600 }}>{k}</td>
                  <td>{v || <span className="muted">—</span>}</td>
                  <td>
                    <div className="row-actions">
                      <IconButton className="danger" title="Remove tag" onClick={() => void handleDelete(k)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={adding}
        title="Add tag"
        subtitle="Add a key-value tag to this secret."
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleAdd()} disabled={!key.trim() || saving} loading={saving}>
              Add tag
            </Button>
          </>
        }
      >
        <Field label="Key" hint="Required.">
          <TextInput value={key} onChange={(e) => setKey(e.target.value)} placeholder="environment" spellCheck={false} />
        </Field>
        <Field label="Value" hint="Optional.">
          <TextInput value={value} onChange={(e) => setValue(e.target.value)} placeholder="production" spellCheck={false} />
        </Field>
      </Modal>
    </div>
  );
}
