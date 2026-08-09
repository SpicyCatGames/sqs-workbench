import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { lambdaApi, functionArnFromName, type FunctionDetail } from '../../lib/lambdaApi';
import { errorMessage } from '../../lib/context';
import { Button, EmptyState, Field, IconButton, Modal, TextInput } from '../../components/ui';

interface Props {
  fn: FunctionDetail;
  onChanged: () => void;
}

export function TagsTab({ fn, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const arn = fn.functionArn || functionArnFromName(fn.functionName, 'us-east-1');

  const handleAdd = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setError('');
    try {
      await lambdaApi.tagFunction(arn, { [key.trim()]: value });
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
      await lambdaApi.untagFunction(arn, [tagKey]);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const entries = Object.entries(fn.tags);

  return (
    <div className="card card-pad">
      <div className="card-title-row" style={{ marginBottom: 12 }}>
        <h3 className="card-title">Tags</h3>
        <span className="muted" style={{ fontSize: 12.5 }}>{entries.length} tag{entries.length === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          <Plus size={13} />
          Add tag
        </Button>
      </div>
      <p className="card-subtitle" style={{ marginBottom: 12 }}>Tags help you organize and identify this function.</p>

      {error && <div className="inline-error">{error}</div>}

      {entries.length === 0 ? (
        <EmptyState title="No tags" description="Add tags to this function to organize it." />
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
        subtitle="Add a key-value tag to this function."
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
