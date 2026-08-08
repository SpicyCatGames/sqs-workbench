import { useState } from 'react';
import { Columns3, Info, Plus, Trash2 } from 'lucide-react';
import { dynamoApi, type AttributeScalarType, type DynamoIndex, type DynamoTable } from '../../lib/dynamoApi';
import { errorMessage, useToast } from '../../lib/context';
import { formatBytes, formatNumber } from '../../lib/format';
import { Button, EmptyState, Field, IconButton, Modal, Select, TextInput } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { IndexStatusBadge, partitionKeyOf, sortKeyOf } from './DynamoUi';

interface Props {
  table: DynamoTable;
  onChanged: () => void;
}

const TYPE_OPTIONS: Array<{ value: AttributeScalarType; label: string }> = [
  { value: 'S', label: 'String' },
  { value: 'N', label: 'Number' },
  { value: 'B', label: 'Binary' },
];

export function IndexesTab({ table, onChanged }: Props) {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DynamoIndex | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await dynamoApi.deleteGlobalSecondaryIndex(table.name, deleteTarget.name);
      toast('success', 'Index deleted', `${deleteTarget.name} removed from ${table.name}.`);
      setDeleteTarget(null);
      onChanged();
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const keysLabel = (index: DynamoIndex) => {
    const pk = index.keySchema.find((k) => k.keyType === 'HASH');
    const sk = index.keySchema.find((k) => k.keyType === 'RANGE');
    return pk ? `${pk.attributeName} (${pk.attributeType})${sk ? `, ${sk.attributeName} (${sk.attributeType})` : ''}` : '—';
  };

  const projectionLabel = (index: DynamoIndex) => {
    if (index.projectionType === 'ALL') return 'All attributes';
    if (index.projectionType === 'KEYS_ONLY') return 'Keys only';
    return `Include: ${index.nonKeyAttributes.join(', ')}`;
  };

  return (
    <div className="prop-stack">
      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <div>
            <h3 className="card-title">Global secondary indexes</h3>
            <p className="card-subtitle">An index with a partition key and optional sort key that can be different from the table's primary key.</p>
          </div>
          <span style={{ flex: 1 }} />
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} />
            Create index
          </Button>
        </div>

        {table.gsi.length === 0 ? (
          <EmptyState
            icon={<Columns3 size={26} />}
            title="No global secondary indexes"
            description="Create an index to support queries on attributes other than the primary key."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Index name</th>
                  <th>Status</th>
                  <th>Keys</th>
                  <th>Projection</th>
                  <th className="num-cell">Item count</th>
                  <th className="num-cell">Size</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {table.gsi.map((g) => (
                  <tr key={g.name}>
                    <td>
                      <div className="qname">{g.name}</div>
                      <div className="qurl mono">{g.arn ?? '—'}</div>
                    </td>
                    <td><IndexStatusBadge status={g.status} /></td>
                    <td className="mono" style={{ fontSize: 12.5 }}>{keysLabel(g)}</td>
                    <td>{projectionLabel(g)}</td>
                    <td className="num-cell">{formatNumber(g.itemCount)}</td>
                    <td className="num-cell">{formatBytes(g.indexSizeBytes ?? 0)}</td>
                    <td>
                      <div className="row-actions">
                        <IconButton className="danger" title="Delete index" onClick={() => setDeleteTarget(g)}>
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
      </div>

      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <div>
            <h3 className="card-title">Local secondary indexes</h3>
            <p className="card-subtitle">Indexes that share the table's partition key with a different sort key. Created when the table is created.</p>
          </div>
        </div>
        {table.lsi.length === 0 ? (
          <div className="inline-info" style={{ marginTop: 0, alignItems: 'center' }}>
            <Info size={16} />
            <span>This table has no local secondary indexes. Local secondary indexes can only be added when a table is created.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Index name</th>
                  <th>Keys</th>
                  <th>Projection</th>
                  <th className="num-cell">Item count</th>
                  <th className="num-cell">Size</th>
                </tr>
              </thead>
              <tbody>
                {table.lsi.map((l) => (
                  <tr key={l.name}>
                    <td className="qname">{l.name}</td>
                    <td className="mono" style={{ fontSize: 12.5 }}>{keysLabel(l)}</td>
                    <td>{projectionLabel(l)}</td>
                    <td className="num-cell">{formatNumber(l.itemCount)}</td>
                    <td className="num-cell">{formatBytes(l.indexSizeBytes ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateIndexDialog open={createOpen} table={table} onClose={() => setCreateOpen(false)} onCreated={() => {
        toast('success', 'Index creation started', 'The index may take a moment to become active.');
        setCreateOpen(false);
        onChanged();
      }} />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete index?"
        message={
          <>
            Permanently delete global secondary index <strong>{deleteTarget?.name}</strong> from table <strong>{table.name}</strong>?
          </>
        }
        confirmLabel="Delete index"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------- create index

function CreateIndexDialog({
  open,
  table,
  onClose,
  onCreated,
}: {
  open: boolean;
  table: DynamoTable;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [indexName, setIndexName] = useState('');
  const [pkName, setPkName] = useState('');
  const [pkType, setPkType] = useState<AttributeScalarType>('S');
  const [hasSortKey, setHasSortKey] = useState(false);
  const [skName, setSkName] = useState('');
  const [skType, setSkType] = useState<AttributeScalarType>('S');
  const [projection, setProjection] = useState<'ALL' | 'KEYS_ONLY' | 'INCLUDE'>('ALL');
  const [nonKeyAttrs, setNonKeyAttrs] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const pk = partitionKeyOf(table);
  const sk = sortKeyOf(table);
  const suggestedPk = pk ? pk.attributeName : '';
  const suggestedSk = sk ? sk.attributeName : '';

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await dynamoApi.createGlobalSecondaryIndex(table, {
        indexName,
        partitionKey: { name: pkName, type: pkType },
        sortKey: hasSortKey ? { name: skName, type: skType } : undefined,
        projectionType: projection,
        nonKeyAttributes: projection === 'INCLUDE' ? nonKeyAttrs.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      });
      onCreated();
      onClose();
      setIndexName('');
      setPkName('');
      setPkType('S');
      setHasSortKey(false);
      setSkName('');
      setSkType('S');
      setProjection('ALL');
      setNonKeyAttrs('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Create index"
      subtitle={`A new global secondary index on table ${table.name}.`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={!indexName.trim() || !pkName.trim() || (hasSortKey && !skName.trim()) || saving} loading={saving}>
            Create index
          </Button>
        </>
      }
    >
      <Field label="Index name" hint="A friendly name for this index.">
        <TextInput value={indexName} onChange={(e) => setIndexName(e.target.value)} placeholder="my-gsi" spellCheck={false} />
      </Field>

      <div className="form-section">
        <h3 className="form-section-title">Primary key</h3>
        <div className="form-grid">
          <Field label="Partition key" hint="The attribute to query by.">
            <div className="key-input-row">
              <TextInput value={pkName} onChange={(e) => setPkName(e.target.value)} placeholder={suggestedPk} spellCheck={false} />
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
            <Field label="Sort key" hint="Optionally order items within a partition.">
              <div className="key-input-row">
                <TextInput value={skName} onChange={(e) => setSkName(e.target.value)} placeholder={suggestedSk} spellCheck={false} />
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
        <h3 className="form-section-title">Attributes to project</h3>
        <div className="radio-group">
          <button type="button" className={`radio-card ${projection === 'ALL' ? 'radio-card-on' : ''}`} onClick={() => setProjection('ALL')}>
            <span className="radio-dot" />
            <span className="radio-body">
              <span className="radio-title">All attributes</span>
              <span className="radio-desc">Project every attribute of each item into the index. Larger index, fastest reads.</span>
            </span>
          </button>
          <button type="button" className={`radio-card ${projection === 'KEYS_ONLY' ? 'radio-card-on' : ''}`} onClick={() => setProjection('KEYS_ONLY')}>
            <span className="radio-dot" />
            <span className="radio-body">
              <span className="radio-title">Keys only</span>
              <span className="radio-desc">Project only the primary key, index keys and item key into the index.</span>
            </span>
          </button>
          <button type="button" className={`radio-card ${projection === 'INCLUDE' ? 'radio-card-on' : ''}`} onClick={() => setProjection('INCLUDE')}>
            <span className="radio-dot" />
            <span className="radio-body">
              <span className="radio-title">Include attributes</span>
              <span className="radio-desc">Project the keys plus a specific list of non-key attributes.</span>
            </span>
          </button>
        </div>
        {projection === 'INCLUDE' && (
          <Field label="Non-key attributes" hint="Comma-separated attribute names to project.">
            <TextInput value={nonKeyAttrs} onChange={(e) => setNonKeyAttrs(e.target.value)} placeholder="name, status, createdAt" spellCheck={false} />
          </Field>
        )}
      </div>

      {table.billingMode === 'PROVISIONED' && (
        <div className="inline-info" style={{ marginTop: 4, alignItems: 'center' }}>
          <Info size={16} />
          <span>
            This table uses provisioned capacity — the index inherits the table's {table.provisionedThroughput?.read ?? 5} RCU / {table.provisionedThroughput?.write ?? 5} WCU.
          </span>
        </div>
      )}

      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}
