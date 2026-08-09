import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { lambdaApi, type FunctionDetail } from '../../lib/lambdaApi';
import { errorMessage, useToast } from '../../lib/context';
import { Button, Field, KeyValue, Modal, NumberInput, TextInput } from '../../components/ui';
import { ArchitectureBadge, RuntimeBadge, formatIso } from './LambdaUi';

interface Props {
  fn: FunctionDetail;
  onChanged: () => void;
}

export function ConfigurationTab({ fn, onChanged }: Props) {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);

  return (
    <div className="prop-stack">
      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <h3 className="card-title">General configuration</h3>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil size={13} />
            Edit
          </Button>
        </div>
        <dl className="kv-grid">
          <KeyValue label="Description">{fn.description || '—'}</KeyValue>
          <KeyValue label="Runtime"><RuntimeBadge runtime={fn.runtime} /></KeyValue>
          <KeyValue label="Handler" mono>{fn.handler || '—'}</KeyValue>
          <KeyValue label="Execution role" mono>{fn.role || '—'}</KeyValue>
          <KeyValue label="Memory" mono>{fn.memorySize} MB</KeyValue>
          <KeyValue label="Timeout" mono>{fn.timeout} seconds</KeyValue>
          <KeyValue label="Ephemeral storage" mono>{fn.ephemeralStorageSize ? `${fn.ephemeralStorageSize} MB` : '512 MB'}</KeyValue>
          <KeyValue label="Architectures"><ArchitectureBadge architectures={fn.architectures} /></KeyValue>
          <KeyValue label="Last modified">{formatIso(fn.lastModified)}</KeyValue>
          <KeyValue label="Revision ID" mono>{fn.revisionId ? fn.revisionId.slice(0, 16) + '…' : '—'}</KeyValue>
        </dl>
      </div>

      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 12 }}>
          <h3 className="card-title">Environment variables</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {Object.keys(fn.environment ?? {}).length} variable{Object.keys(fn.environment ?? {}).length === 1 ? '' : 's'}
          </span>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" size="sm" onClick={() => setEnvOpen(true)}>
            <Pencil size={13} />
            Edit
          </Button>
        </div>
        {Object.keys(fn.environment ?? {}).length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>No environment variables configured.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(fn.environment ?? {}).map(([k, v]) => (
                  <tr key={k}>
                    <td className="mono" style={{ fontWeight: 600 }}>{k}</td>
                    <td className="mono" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editOpen && (
        <GeneralEditDialog
          fn={fn}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            toast('success', 'Configuration updated');
            setEditOpen(false);
            onChanged();
          }}
        />
      )}

      {envOpen && (
        <EnvEditDialog
          fn={fn}
          onClose={() => setEnvOpen(false)}
          onSaved={() => {
            toast('success', 'Environment variables updated');
            setEnvOpen(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------- general settings

function GeneralEditDialog({ fn, onClose, onSaved }: { fn: FunctionDetail; onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState(fn.description ?? '');
  const [memory, setMemory] = useState(fn.memorySize || 128);
  const [timeout, setTimeoutSec] = useState(fn.timeout || 3);
  const [ephemeralStorage, setEphemeralStorage] = useState(fn.ephemeralStorageSize ?? 512);
  const [handler, setHandler] = useState(fn.handler ?? '');
  const [role, setRole] = useState(fn.role ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await lambdaApi.updateFunctionConfiguration(fn.functionName, {
        description,
        memorySize: Math.max(128, Math.round(memory) || 128),
        timeout: Math.min(900, Math.max(1, Math.round(timeout) || 1)),
        ephemeralStorageSize: Math.max(512, Math.round(ephemeralStorage) || 512),
        handler: handler.trim(),
        role: role.trim(),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Edit general configuration"
      subtitle={fn.functionName}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving} disabled={!handler.trim() || !role.trim()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Description">
        <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this function do?" spellCheck={false} />
      </Field>
      <div className="form-grid">
        <Field label="Memory (MB)" hint="128 – 10240.">
          <NumberInput value={memory} onChange={(e) => setMemory(Number(e.target.value))} min={128} max={10240} />
        </Field>
        <Field label="Timeout (seconds)" hint="1 – 900.">
          <NumberInput value={timeout} onChange={(e) => setTimeoutSec(Number(e.target.value))} min={1} max={900} />
        </Field>
        <Field label="Ephemeral storage (MB)" hint="512 – 10240.">
          <NumberInput value={ephemeralStorage} onChange={(e) => setEphemeralStorage(Number(e.target.value))} min={512} max={10240} />
        </Field>
      </div>
      <Field label="Handler" hint="Function entry point, e.g. index.handler.">
        <TextInput value={handler} onChange={(e) => setHandler(e.target.value)} placeholder="index.handler" spellCheck={false} className="mono" />
      </Field>
      <Field label="Execution role ARN">
        <TextInput value={role} onChange={(e) => setRole(e.target.value)} spellCheck={false} className="mono" />
      </Field>
      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}

// ---------------------------------------------------------------- env vars

interface EnvRow {
  id: number;
  key: string;
  value: string;
}

let envId = 0;

function EnvEditDialog({ fn, onClose, onSaved }: { fn: FunctionDetail; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<EnvRow[]>(() => {
    const base = Object.entries(fn.environment ?? {}).map(([key, value]) => ({ id: ++envId, key, value }));
    return base.length > 0 ? base : [{ id: ++envId, key: '', value: '' }];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const variables: Record<string, string> = {};
    for (const row of rows) {
      if (row.key.trim()) variables[row.key.trim()] = row.value;
    }
    setSaving(true);
    setError('');
    try {
      await lambdaApi.updateFunctionConfiguration(fn.functionName, { environment: variables });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Edit environment variables"
      subtitle={`${fn.functionName} · an empty value deletes the variable`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="tag-editor">
        {rows.map((row) => (
          <div key={row.id} className="tag-row">
            <TextInput
              value={row.key}
              onChange={(e) => setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, key: e.target.value } : x)))}
              placeholder="KEY"
              spellCheck={false}
            />
            <TextInput
              value={row.value}
              onChange={(e) => setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, value: e.target.value } : x)))}
              placeholder="Value"
              spellCheck={false}
            />
            <button type="button" className="icon-btn" title="Delete variable" onClick={() => setRows((prev) => prev.filter((x) => x.id !== row.id))}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={() => setRows((prev) => [...prev, { id: ++envId, key: '', value: '' }])} type="button">
        <Plus size={13} />
        Add environment variable
      </Button>
      <div className="inline-info" style={{ marginTop: 12 }}>
        <span>Environment variables are stored encrypted at rest on real AWS and visible to the function at runtime.</span>
      </div>
      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}
