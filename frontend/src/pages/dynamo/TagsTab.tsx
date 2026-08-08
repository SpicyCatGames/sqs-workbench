import { useState } from 'react';
import { Info, Plus, Trash2 } from 'lucide-react';
import { dynamoApi, type DynamoTable } from '../../lib/dynamoApi';
import { errorMessage, useToast } from '../../lib/context';
import { Button, TextInput } from '../../components/ui';

interface Props {
  table: DynamoTable;
  onChanged: () => void;
}

interface TagRow {
  key: string;
  value: string;
}

export function TagsTab({ table, onChanged }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<TagRow[]>(() => Object.entries(table.tags).map(([key, value]) => ({ key, value })));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const current = Object.entries(table.tags);
      const next = new Map(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));
      const added: Record<string, string> = {};
      const removed: string[] = [];
      for (const [k, v] of next) {
        if (current.find(([ck]) => ck === k) === undefined) added[k] = v;
      }
      for (const [k] of current) {
        if (!next.has(k)) removed.push(k);
      }
      const changed = current.filter(([k, v]) => next.has(k) && next.get(k) !== v);

      if (table.arn) {
        if (Object.keys(added).length > 0) await dynamoApi.tagTable(table.arn, added);
        if (removed.length > 0) await dynamoApi.untagTable(table.arn, removed);
        if (changed.length > 0) {
          const updates: Record<string, string> = {};
          for (const [k] of changed) updates[k] = next.get(k) ?? '';
          await dynamoApi.tagTable(table.arn, updates);
        }
      }
      if (Object.keys(added).length === 0 && removed.length === 0 && changed.length === 0) {
        toast('info', 'No changes', 'The tags are already up to date.');
      } else {
        toast('success', 'Tags saved', `${Object.keys(added).length} added, ${changed.length} updated, ${removed.length} removed.`);
        onChanged();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-pad">
      <div className="card-title-row" style={{ marginBottom: 6 }}>
        <div>
          <h3 className="card-title">Tags</h3>
          <p className="card-subtitle">Tags are key–value pairs that help you identify and organize {table.name}. Tag keys must be unique.</p>
        </div>
      </div>

      <div className="inline-info" style={{ marginTop: 12, alignItems: 'center' }}>
        <Info size={16} />
        <span>
          Resource ARN: <span className="mono" style={{ wordBreak: 'break-all' }}>{table.arn ?? '—'}</span>
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 13, margin: '8px 0 14px' }}>No tags associated with this table.</div>
      ) : (
        <div className="tag-editor" style={{ margin: '10px 0 14px' }}>
          {rows.map((r, i) => (
            <div className="tag-row" key={i}>
              <TextInput
                value={r.key}
                onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                placeholder="Key (e.g. environment)"
                spellCheck={false}
              />
              <TextInput
                value={r.value}
                onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                placeholder="Value (e.g. production)"
                spellCheck={false}
              />
              <button type="button" className="icon-btn danger" title="Remove tag" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card-title-row">
        <Button variant="secondary" size="sm" onClick={() => setRows((r) => [...r, { key: '', value: '' }])}>
          <Plus size={13} />
          Add tag
        </Button>
        <span style={{ flex: 1 }} />
        <Button variant="primary" onClick={() => void save()} disabled={saving} loading={saving}>
          Save changes
        </Button>
      </div>

      {error && <div className="inline-error" style={{ marginBottom: 0, marginTop: 12 }}>{error}</div>}
    </div>
  );
}
