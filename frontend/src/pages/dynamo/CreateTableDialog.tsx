import { useState, type FormEvent } from 'react';
import { Info, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { dynamoApi, type AttributeScalarType } from '../../lib/dynamoApi';
import { errorMessage } from '../../lib/context';
import { Button, Field, Modal, NumberInput, Select, TextInput, Toggle } from '../../components/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}

const TYPE_OPTIONS: Array<{ value: AttributeScalarType; label: string }> = [
  { value: 'S', label: 'String' },
  { value: 'N', label: 'Number' },
  { value: 'B', label: 'Binary' },
];

interface TagRow {
  key: string;
  value: string;
}

const TABLE_NAME_RE = /^[a-zA-Z0-9_.-]{3,255}$/;
const KEY_NAME_RE = /^[a-zA-Z0-9_.-]{1,255}$/;

export function CreateTableDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [pkName, setPkName] = useState('id');
  const [pkType, setPkType] = useState<AttributeScalarType>('S');
  const [hasSortKey, setHasSortKey] = useState(false);
  const [skName, setSkName] = useState('');
  const [skType, setSkType] = useState<AttributeScalarType>('S');
  const [capacityMode, setCapacityMode] = useState<'PAY_PER_REQUEST' | 'PROVISIONED'>('PAY_PER_REQUEST');
  const [readCapacity, setReadCapacity] = useState('5');
  const [writeCapacity, setWriteCapacity] = useState('5');
  const [tableClass, setTableClass] = useState<'STANDARD' | 'STANDARD_INFREQUENT_ACCESS'>('STANDARD');
  const [deletionProtection, setDeletionProtection] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const nameError = name.trim() ? (TABLE_NAME_RE.test(name.trim()) ? null : '3–255 characters using letters, numbers, underscores, periods or hyphens.') : null;
  const pkError = pkName.trim() ? (KEY_NAME_RE.test(pkName.trim()) ? null : 'Invalid characters.') : 'Partition key name is required.';
  const skError = hasSortKey && skName.trim() ? (KEY_NAME_RE.test(skName.trim()) ? null : 'Invalid characters.') : hasSortKey ? 'Sort key name is required.' : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (nameError || pkError || skError || !name.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const tagMap: Record<string, string> = {};
      for (const t of tags) {
        if (t.key.trim()) tagMap[t.key.trim()] = t.value;
      }
      await dynamoApi.createTable({
        name: name.trim(),
        partitionKey: { name: pkName.trim(), type: pkType },
        sortKey: hasSortKey ? { name: skName.trim(), type: skType } : undefined,
        billingMode: capacityMode,
        readCapacity: capacityMode === 'PROVISIONED' ? Number(readCapacity) || 5 : undefined,
        writeCapacity: capacityMode === 'PROVISIONED' ? Number(writeCapacity) || 5 : undefined,
        tableClass,
        deletionProtectionEnabled: deletionProtection,
        tags: Object.keys(tagMap).length > 0 ? tagMap : undefined,
      });
      onCreated(name.trim());
      onClose();
      setName('');
      setPkName('id');
      setPkType('S');
      setHasSortKey(false);
      setSkName('');
      setSkType('S');
      setCapacityMode('PAY_PER_REQUEST');
      setReadCapacity('5');
      setWriteCapacity('5');
      setTableClass('STANDARD');
      setDeletionProtection(false);
      setAdvanced(false);
      setTags([]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Create table"
      subtitle="Configure a new DynamoDB table on the configured endpoint."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!!nameError || !!pkError || !!skError || !name.trim() || saving} loading={saving}>
            Create table
          </Button>
        </>
      }
    >
      <div className="form-section">
        <h3 className="form-section-title">Table details</h3>
        <Field label="Table name" hint="Table names are unique per account and region." error={nameError ?? undefined}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="my-table" spellCheck={false} />
        </Field>
      </div>

      <div className="form-section">
        <h3 className="form-section-title">Primary key</h3>
        <div className="form-grid">
          <Field label="Partition key" hint="The attribute that determines which partition an item is stored in." error={pkError ?? undefined}>
            <div className="key-input-row">
              <TextInput value={pkName} onChange={(e) => setPkName(e.target.value)} placeholder="id" spellCheck={false} />
              <Select value={pkType} onChange={(e) => setPkType(e.target.value as AttributeScalarType)} style={{ width: 130 }}>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          {hasSortKey && (
            <Field label="Sort key" hint="Optionally sort items within a partition." error={skError ?? undefined}>
              <div className="key-input-row">
                <TextInput value={skName} onChange={(e) => setSkName(e.target.value)} placeholder="sk" spellCheck={false} />
                <Select value={skType} onChange={(e) => setSkType(e.target.value as AttributeScalarType)} style={{ width: 130 }}>
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
          )}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHasSortKey((v) => !v)}>
          {hasSortKey ? 'Remove sort key' : '+ Add sort key'}
        </button>
      </div>

      <div className="form-section">
        <h3 className="form-section-title">Table settings</h3>
        <Field label="Capacity mode" hint="On-demand scales automatically; provisioned reserves a fixed read/write capacity.">
          <div className="radio-group">
            <button
              type="button"
              className={`radio-card ${capacityMode === 'PAY_PER_REQUEST' ? 'radio-card-on' : ''}`}
              onClick={() => setCapacityMode('PAY_PER_REQUEST')}
            >
              <span className="radio-dot" />
              <span className="radio-body">
                <span className="radio-title">On-demand</span>
                <span className="radio-desc">
                  DynamoDB charges per request and scales capacity automatically. Recommended for most workloads and local testing.
                </span>
              </span>
            </button>
            <button
              type="button"
              className={`radio-card ${capacityMode === 'PROVISIONED' ? 'radio-card-on' : ''}`}
              onClick={() => setCapacityMode('PROVISIONED')}
            >
              <span className="radio-dot" />
              <span className="radio-body">
                <span className="radio-title">Provisioned</span>
                <span className="radio-desc">Specify the read/write capacity units the table reserves.</span>
              </span>
            </button>
          </div>
        </Field>

        {capacityMode === 'PROVISIONED' && (
          <div className="form-grid">
            <Field label="Read capacity units" hint="1 RCU ≈ one strongly-consistent 4 KB read per second.">
              <NumberInput min={1} max={100000} value={readCapacity} onChange={(e) => setReadCapacity(e.target.value)} />
            </Field>
            <Field label="Write capacity units" hint="1 WCU ≈ one 1 KB write per second.">
              <NumberInput min={1} max={100000} value={writeCapacity} onChange={(e) => setWriteCapacity(e.target.value)} />
            </Field>
          </div>
        )}

        <Field label="Table class" hint="Standard-IA offers lower storage cost for tables with infrequent access.">
          <Select value={tableClass} onChange={(e) => setTableClass(e.target.value as 'STANDARD' | 'STANDARD_INFREQUENT_ACCESS')}>
            <option value="STANDARD">DynamoDB Standard</option>
            <option value="STANDARD_INFREQUENT_ACCESS">DynamoDB Standard-Infrequent Access</option>
          </Select>
        </Field>
      </div>

      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdvanced((v) => !v)} style={{ marginBottom: 12 }}>
        {advanced ? 'Hide' : 'Show'} advanced settings
      </button>

      {advanced && (
        <>
          <Field
            label="Deletion protection"
            hint="When enabled, the table cannot be deleted until protection is turned off."
            layout="horizontal"
          >
            <div className="toggle-wrap" style={{ marginTop: 2 }}>
              <Toggle checked={deletionProtection} onChange={setDeletionProtection} />
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
              <span>No tags. Tags help you track and manage resources across the console.</span>
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
                  <button type="button" className="icon-btn danger" title="Remove tag" onClick={() => setTags((prev) => prev.filter((_, j) => j !== i))}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {error && <div className="inline-error">{error}</div>}

      <div className="inline-info" style={{ marginTop: 4, alignItems: 'center' }}>
        <ShieldAlert size={16} />
        <span>Encryption at rest uses the DynamoDB-owned key by default, as in the AWS console.</span>
      </div>
    </Modal>
  );
}
