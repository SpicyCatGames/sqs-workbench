import { useEffect, useState } from 'react';
import { Info, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { s3Api, bucketArn, type BucketConfig } from '../../lib/s3Api';
import { errorMessage, useToast } from '../../lib/context';
import { Button, EmptyState, Field, Modal, SkeletonRows, TextInput } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { VersioningBadge } from './S3Ui';

interface Props {
  bucket: string;
  config: BucketConfig | null;
  onChanged: () => void;
}

export function PropertiesTab({ bucket, config, onChanged }: Props) {
  const { toast } = useToast();
  const [versioningConfirm, setVersioningConfirm] = useState<'Enabled' | 'Suspended' | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  if (!config) {
    return (
      <div className="card card-pad">
        <SkeletonRows rows={4} />
      </div>
    );
  }

  const handleVersioning = async () => {
    if (!versioningConfirm) return;
    setActionLoading(true);
    try {
      await s3Api.putBucketVersioning(bucket, versioningConfirm);
      toast('success', versioningConfirm === 'Enabled' ? 'Versioning enabled' : 'Versioning suspended');
      setVersioningConfirm(null);
      onChanged();
    } catch (err) {
      toast('error', 'Failed to update versioning', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const encryptionLabel = (e?: BucketConfig['encryption']) => {
    if (!e) return 'None';
    return e.algorithm === 'aws:kms' ? `SSE-KMS (${e.keyId ?? 'default key'})` : 'SSE-S3 (AES256)';
  };

  return (
    <div className="prop-stack">
      <div className="card card-pad">
        <h2 className="card-title">Bucket overview</h2>
        <p className="card-subtitle" style={{ marginBottom: 14 }}>General information about this bucket.</p>
        <dl className="kv-grid">
          <Kv label="ARN" mono>{bucketArn(bucket)}</Kv>
          <Kv label="Bucket name" mono>{bucket}</Kv>
          <Kv label="Region">{config.region ?? '—'}</Kv>
          <Kv label="Creation date">{config.creationDate ? new Date(config.creationDate).toLocaleString() : '—'}</Kv>
          <Kv label="Versioning"><VersioningBadge status={config.versioning} /></Kv>
          <Kv label="Default encryption">{encryptionLabel(config.encryption)}</Kv>
        </dl>
      </div>

      <div className="card card-pad">
        <div className="card-title-row">
          <h2 className="card-title">Bucket Versioning</h2>
          <span style={{ flex: 1 }} />
          {config.versioning === 'Enabled' ? (
            <Button variant="secondary" size="sm" onClick={() => setVersioningConfirm('Suspended')}>
              <Pencil size={13} />
              Suspend
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setVersioningConfirm('Enabled')}>
              <Pencil size={13} />
              Enable
            </Button>
          )}
        </div>
        <p className="card-subtitle" style={{ marginBottom: 12 }}>
          Keep multiple versions of every object in this bucket, so you can recover from accidental deletions or overwrites.
        </p>
        <div className="inline-info" style={{ marginTop: 0 }}>
          <Info size={16} />
          <span>
            {config.versioning === 'Enabled'
              ? 'Versioning is on. Deletes create delete markers and overwrites create new versions.'
              : 'Versioning is off. Enable it to start keeping versions — existing objects keep their "null" version.'}
          </span>
        </div>
      </div>

      <div className="card card-pad">
        <h2 className="card-title">Default encryption</h2>
        <p className="card-subtitle" style={{ marginBottom: 12 }}>
          Encrypt new objects written to this bucket by default. <strong>{encryptionLabel(config.encryption)}</strong> is currently configured.
        </p>
        <EncryptionEditor bucket={bucket} current={config.encryption ?? null} onSaved={onChanged} />
      </div>

      <BucketTagsCard bucket={bucket} tags={config.tags} onChanged={onChanged} />

      <ConfirmDialog
        open={!!versioningConfirm}
        title={versioningConfirm === 'Enabled' ? 'Enable versioning?' : 'Suspend versioning?'}
        message={
          versioningConfirm === 'Enabled' ? (
            <>
              Turn on versioning for <strong>{bucket}</strong>? Once enabled, you cannot fully disable it — you can only suspend it.
            </>
          ) : (
            <>
              Suspend versioning for <strong>{bucket}</strong>? Existing versions are kept but no new versions will be created.
            </>
          )
        }
        confirmLabel={versioningConfirm === 'Enabled' ? 'Enable versioning' : 'Suspend versioning'}
        loading={actionLoading}
        onConfirm={() => void handleVersioning()}
        onClose={() => setVersioningConfirm(null)}
      />
    </div>
  );
}

function Kv({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="kv-row">
      <dt className="kv-label">{label}</dt>
      <dd className={`kv-value ${mono ? 'kv-mono' : ''}`} style={{ margin: 0 }}>{children ?? '—'}</dd>
    </div>
  );
}

// ------------------------------------------------------------ encryption

function EncryptionEditor({
  bucket,
  current,
  onSaved,
}: {
  bucket: string;
  current: BucketConfig['encryption'];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'AES256' | 'aws:kms'>('AES256');
  const [keyId, setKeyId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setMode(current?.algorithm === 'aws:kms' ? 'aws:kms' : 'AES256');
      setKeyId(current?.keyId ?? '');
      setError('');
    }
  }, [open, current]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      if (mode === 'aws:kms' && !keyId.trim()) {
        setError('A KMS key ID or ARN is required for SSE-KMS.');
        setSaving(false);
        return;
      }
      await s3Api.putBucketEncryption(bucket, mode, mode === 'aws:kms' ? keyId.trim() : undefined);
      toast('success', 'Encryption updated');
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="card-title-row" style={{ marginBottom: 0 }}>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Pencil size={13} />
          Edit
        </Button>
      </div>
      <Modal
        open={open}
        title="Edit default encryption"
        subtitle={`Default encryption for ${bucket}`}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={() => void handleSave()} loading={saving}>Save changes</Button>
          </>
        }
      >
        <div className="radio-group">
          <label className={`radio-card ${mode === 'AES256' ? 'radio-card-on' : ''}`}>
            <span className="radio-dot" />
            <span className="radio-body">
              <span className="radio-title">SSE-S3</span>
              <span className="radio-desc">Amazon S3-managed keys. Uses the AES256 algorithm (recommended for most buckets).</span>
            </span>
            <input type="radio" name="enc" value="AES256" checked={mode === 'AES256'} onChange={() => setMode('AES256')} style={{ display: 'none' }} />
          </label>
          <label className={`radio-card ${mode === 'aws:kms' ? 'radio-card-on' : ''}`}>
            <span className="radio-dot" />
            <span className="radio-body">
              <span className="radio-title">SSE-KMS</span>
              <span className="radio-desc">AWS KMS-managed keys. Enter a KMS key ID or ARN.</span>
            </span>
            <input type="radio" name="enc" value="aws:kms" checked={mode === 'aws:kms'} onChange={() => setMode('aws:kms')} style={{ display: 'none' }} />
          </label>
        </div>
        {mode === 'aws:kms' && (
          <div style={{ marginTop: 14 }}>
          <Field label="KMS key ID / ARN" hint="For example arn:aws:kms:us-east-1:000000000000:key/abcd1234">
            <TextInput value={keyId} onChange={(e) => setKeyId(e.target.value)} spellCheck={false} placeholder="arn:aws:kms:us-east-1:000000000000:key/…" />
          </Field>
          </div>
        )}
        <div className="inline-info" style={{ marginTop: 6, marginBottom: 0 }}>
          <Lock size={16} />
          <span>New objects are encrypted automatically; existing objects are not re-encrypted.</span>
        </div>
        {error && <div className="inline-error">{error}</div>}
      </Modal>
    </>
  );
}

// ------------------------------------------------------------------ tags

function BucketTagsCard({ bucket, tags, onChanged }: { bucket: string; tags: Record<string, string>; onChanged: () => void }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const entries = Object.entries(tags);

  const handleAdd = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setError('');
    try {
      await s3Api.putBucketTags(bucket, { ...tags, [key.trim()]: value });
      setKey('');
      setValue('');
      setAdding(false);
      toast('success', 'Tags updated');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (tagKey: string) => {
    setSaving(true);
    try {
      const next = { ...tags };
      delete next[tagKey];
      await s3Api.putBucketTags(bucket, next);
      toast('success', 'Tag removed');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

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
      <p className="card-subtitle" style={{ marginBottom: 12 }}>Tags help you track and manage this bucket.</p>
      {error && <div className="inline-error">{error}</div>}
      {entries.length === 0 ? (
        <EmptyState title="No tags" description="Add tags to this bucket to organize it." />
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
                      <button type="button" className="icon-btn danger" title="Remove tag" onClick={() => void handleRemove(k)}>
                        <Trash2 size={15} />
                      </button>
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
        subtitle="Add a key-value tag to this bucket."
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={() => void handleAdd()} disabled={!key.trim() || saving} loading={saving}>Add tag</Button>
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
