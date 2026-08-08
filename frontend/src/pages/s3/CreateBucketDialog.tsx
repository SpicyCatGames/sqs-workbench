import { useState, type FormEvent } from 'react';
import { Info, Plus, Trash2 } from 'lucide-react';
import { s3Api, validateBucketName } from '../../lib/s3Api';
import { errorMessage } from '../../lib/context';
import { Button, Field, Modal, Select, TextInput, Toggle } from '../../components/ui';
import { AWS_REGIONS } from './S3Ui';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}

interface TagRow {
  key: string;
  value: string;
}

export function CreateBucketDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [versioning, setVersioning] = useState(false);
  const [blockPublicAccess, setBlockPublicAccess] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const nameError = name.trim() ? validateBucketName(name) : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (nameError || !name.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const tagMap: Record<string, string> = {};
      for (const t of tags) {
        if (t.key.trim()) tagMap[t.key.trim()] = t.value;
      }
      await s3Api.createBucket({
        name: name.trim(),
        region,
        versioning,
        blockPublicAccess,
        tags: Object.keys(tagMap).length > 0 ? tagMap : undefined,
      });
      onCreated(name.trim());
      onClose();
      setName('');
      setTags([]);
      setAdvanced(false);
      setVersioning(false);
      setBlockPublicAccess(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Create bucket"
      subtitle="A new bucket is created on the configured S3 endpoint."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!!nameError || !name.trim() || saving} loading={saving}>
            Create bucket
          </Button>
        </>
      }
    >
      <Field
        label="Bucket name"
        hint="Unique across all AWS accounts. Lowercase letters, numbers, periods and hyphens."
        error={nameError ?? undefined}
      >
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="my-bucket" spellCheck={false} />
      </Field>

      <Field label="Region" hint="The endpoint emulator stores buckets in this logical region.">
        <Select value={region} onChange={(e) => setRegion(e.target.value)}>
          {AWS_REGIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>

      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdvanced((v) => !v)} style={{ marginBottom: 12 }}>
        {advanced ? 'Hide' : 'Show'} advanced settings
      </button>

      {advanced && (
        <>
          <Field label="Bucket Versioning" hint="Keep multiple versions of every object. Versioned buckets cannot be returned to the unversioned state." layout="horizontal">
            <div className="toggle-wrap" style={{ marginTop: 2 }}>
              <Toggle checked={versioning} onChange={setVersioning} />
            </div>
          </Field>
          <Field
            label="Block all public access"
            hint="Block public ACLs, public bucket policies and access through any public endpoint. On by default, as in the AWS console."
            layout="horizontal"
          >
            <div className="toggle-wrap" style={{ marginTop: 2 }}>
              <Toggle checked={blockPublicAccess} onChange={setBlockPublicAccess} />
            </div>
          </Field>

          <div className="card-title-row" style={{ marginTop: 4, marginBottom: 8 }}>
            <h3 style={{ fontSize: 13.5, fontWeight: 700 }}>Tags</h3>
            <span className="muted" style={{ fontSize: 12 }}>Optional</span>
            <span style={{ flex: 1 }} />
            <Button variant="secondary" size="sm" onClick={() => setTags((t) => [...t, { key: '', value: '' }])}>
              <Plus size={13} />
              Add tag
            </Button>
          </div>
          {tags.length === 0 ? (
            <div className="inline-info" style={{ marginTop: 0 }}>
              <Info size={16} />
              <span>No tags. Tags are key-value pairs that help you track and manage this bucket.</span>
            </div>
          ) : (
            <div className="tag-editor" style={{ marginBottom: 14 }}>
              {tags.map((t, i) => (
                <div className="tag-row" key={i}>
                  <TextInput
                    value={t.key}
                    onChange={(e) => setTags((prev) => prev.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                    placeholder="Key (e.g. environment)"
                    spellCheck={false}
                  />
                  <TextInput
                    value={t.value}
                    onChange={(e) => setTags((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    placeholder="Value (e.g. production)"
                    spellCheck={false}
                  />
                  <IconButtonX onClick={() => setTags((prev) => prev.filter((_, j) => j !== i))} />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}

function IconButtonX({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn danger" title="Remove tag" onClick={onClick}>
      <Trash2 size={15} />
    </button>
  );
}
