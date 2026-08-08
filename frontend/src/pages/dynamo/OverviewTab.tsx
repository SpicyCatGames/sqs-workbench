import { useEffect, useState } from 'react';
import { Columns3, Database, Gauge, ListTree, Pencil, Rows3, Tags as TagsIcon } from 'lucide-react';
import { dynamoApi, type DynamoTable } from '../../lib/dynamoApi';
import { errorMessage, useToast } from '../../lib/context';
import { formatBytes, formatNumber } from '../../lib/format';
import { Badge, Button, Field, KeyValue, Modal, NumberInput, Stat, TextInput, Toggle } from '../../components/ui';
import { ArnText } from '../sns/SnsUi';
import { CapacityModeBadge, TableClassBadge, TableStatusBadge, partitionKeyOf, sortKeyOf } from './DynamoUi';

interface Props {
  table: DynamoTable;
  onChanged: () => void;
  onGoToIndexes: () => void;
  onGoToTags: () => void;
}

export function OverviewTab({ table, onChanged, onGoToIndexes, onGoToTags }: Props) {
  const { toast } = useToast();
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [ttlOpen, setTtlOpen] = useState(false);

  const pk = partitionKeyOf(table);
  const sk = sortKeyOf(table);

  return (
    <div className="prop-stack">
      <div className="stats-row">
        <Stat label="Item count" value={formatNumber(table.itemCount)} icon={<Rows3 size={17} />} />
        <Stat label="Table size" value={formatBytes(table.tableSizeBytes ?? 0)} icon={<Database size={17} />} />
        <Stat label="Status" value={<TableStatusBadge status={table.status} />} icon={<Gauge size={17} />} />
      </div>

      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <h3 className="card-title">General information</h3>
        </div>
        <dl className="kv-grid">
          <KeyValue label="Table name">{table.name}</KeyValue>
          <KeyValue label="ARN" mono><ArnText arn={table.arn} /></KeyValue>
          <KeyValue label="Table ID" mono>{table.tableId ?? '—'}</KeyValue>
          <KeyValue label="Region">{table.region}</KeyValue>
          <KeyValue label="Creation date">{table.creationDate ? new Date(table.creationDate).toLocaleString() : '—'}</KeyValue>
          <KeyValue label="Table class"><TableClassBadge tableClass={table.tableClass} /></KeyValue>
          <KeyValue label="Status"><TableStatusBadge status={table.status} /></KeyValue>
          <KeyValue label="Capacity mode"><CapacityModeBadge mode={table.billingMode} /></KeyValue>
          <KeyValue label="Deletion protection">
            {table.deletionProtectionEnabled === null ? '—' : table.deletionProtectionEnabled ? <Badge tone="warn">Enabled</Badge> : <Badge>Disabled</Badge>}
          </KeyValue>
          <KeyValue label="Encryption">{table.sseType ? `${table.sseType}${table.sseStatus ? ` (${table.sseStatus})` : ''}` : 'DynamoDB-owned key'}</KeyValue>
        </dl>
      </div>

      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <h3 className="card-title">Keys</h3>
          <span className="muted" style={{ fontSize: 12 }}>Primary key schema</span>
        </div>
        <dl className="kv-grid">
          <KeyValue label="Partition key" mono>{pk ? `${pk.attributeName} (${pk.attributeType})` : '—'}</KeyValue>
          <KeyValue label="Sort key" mono>{sk ? `${sk.attributeName} (${sk.attributeType})` : '—'}</KeyValue>
          <KeyValue label="Global secondary indexes" mono>{table.gsi.length}</KeyValue>
          <KeyValue label="Local secondary indexes" mono>{table.lsi.length}</KeyValue>
        </dl>
      </div>

      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <h3 className="card-title">Indexes</h3>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" size="sm" onClick={onGoToIndexes}>
            <ListTree size={13} />
            Manage indexes
          </Button>
        </div>
        <dl className="kv-grid">
          <KeyValue label="Global secondary indexes">
            <div className="kv-flex">
              <Columns3 size={14} />
              <span>{table.gsi.length} index{table.gsi.length === 1 ? '' : 'es'}</span>
              {table.gsi.length > 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {table.gsi.map((g) => g.name).join(', ')}
                </span>
              )}
            </div>
          </KeyValue>
          <KeyValue label="Local secondary indexes">
            <div className="kv-flex">
              <Columns3 size={14} />
              <span>{table.lsi.length} index{table.lsi.length === 1 ? '' : 'es'}</span>
              {table.lsi.length > 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {table.lsi.map((l) => l.name).join(', ')}
                </span>
              )}
            </div>
          </KeyValue>
        </dl>
      </div>

      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <h3 className="card-title">Capacity</h3>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" size="sm" onClick={() => setCapacityOpen(true)}>
            <Pencil size={13} />
            Edit
          </Button>
        </div>
        <dl className="kv-grid">
          <KeyValue label="Capacity mode"><CapacityModeBadge mode={table.billingMode} /></KeyValue>
          {table.billingMode === 'PROVISIONED' && table.provisionedThroughput ? (
            <>
              <KeyValue label="Read capacity units" mono>{table.provisionedThroughput.read}</KeyValue>
              <KeyValue label="Write capacity units" mono>{table.provisionedThroughput.write}</KeyValue>
              <KeyValue label="Last capacity increase">
                {table.provisionedThroughput.lastIncreaseDateTime ? new Date(table.provisionedThroughput.lastIncreaseDateTime).toLocaleString() : '—'}
              </KeyValue>
              <KeyValue label="Last capacity decrease">
                {table.provisionedThroughput.lastDecreaseDateTime ? new Date(table.provisionedThroughput.lastDecreaseDateTime).toLocaleString() : '—'}
              </KeyValue>
            </>
          ) : (
            <KeyValue label="Billing">
              <div className="kv-flex">
                <span>Pay per request</span>
                <span className="muted" style={{ fontSize: 12 }}>No capacity planning required</span>
              </div>
            </KeyValue>
          )}
        </dl>
      </div>

      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <h3 className="card-title">Time to live (TTL)</h3>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" size="sm" onClick={() => setTtlOpen(true)}>
            <Pencil size={13} />
            Edit
          </Button>
        </div>
        <dl className="kv-grid">
          <KeyValue label="Status">
            {table.ttlStatus === 'ENABLED' ? <Badge tone="success">Enabled</Badge> : table.ttlStatus === 'ENABLING' ? <Badge tone="warn">Enabling</Badge> : <Badge>Disabled</Badge>}
          </KeyValue>
          <KeyValue label="Attribute name" mono>{table.ttlAttributeName ?? '—'}</KeyValue>
        </dl>
      </div>

      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <h3 className="card-title">Tags</h3>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" size="sm" onClick={onGoToTags}>
            <TagsIcon size={13} />
            Manage tags
          </Button>
        </div>
        {Object.keys(table.tags).length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>No tags associated with this table.</div>
        ) : (
          <div className="tag-chips">
            {Object.entries(table.tags).map(([k, v]) => (
              <span className="tag-chip" key={k}>
                <span className="tag-chip-key">{k}</span>
                {v && <span className="tag-chip-value">{v}</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      <CapacityDialog
        open={capacityOpen}
        table={table}
        onClose={() => setCapacityOpen(false)}
        onSaved={(msg) => {
          toast('success', 'Capacity updated', msg);
          setCapacityOpen(false);
          onChanged();
        }}
      />

      <TtlDialog
        open={ttlOpen}
        table={table}
        onClose={() => setTtlOpen(false)}
        onSaved={(msg) => {
          toast('success', 'TTL updated', msg);
          setTtlOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}

// -------------------------------------------------------------- capacity

function CapacityDialog({
  open,
  table,
  onClose,
  onSaved,
}: {
  open: boolean;
  table: DynamoTable;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [mode, setMode] = useState<'PAY_PER_REQUEST' | 'PROVISIONED'>(table.billingMode ?? 'PAY_PER_REQUEST');
  const [read, setRead] = useState(String(table.provisionedThroughput?.read ?? 5));
  const [write, setWrite] = useState(String(table.provisionedThroughput?.write ?? 5));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-sync when the dialog opens with a (possibly refreshed) table.
  useEffect(() => {
    if (!open) return;
    setMode(table.billingMode ?? 'PAY_PER_REQUEST');
    setRead(String(table.provisionedThroughput?.read ?? 5));
    setWrite(String(table.provisionedThroughput?.write ?? 5));
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const r = Math.round(Number(read)) || 1;
      const w = Math.round(Number(write)) || 1;
      await dynamoApi.setBillingMode(table.name, mode, r, w);
      onSaved(mode === 'PAY_PER_REQUEST' ? 'The table now uses on-demand capacity.' : `The table now uses ${r} RCU / ${w} WCU.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Edit capacity"
      subtitle="Adjust how read/write capacity is billed for this table."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving} loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="radio-group" style={{ marginBottom: 14 }}>
        <button type="button" className={`radio-card ${mode === 'PAY_PER_REQUEST' ? 'radio-card-on' : ''}`} onClick={() => setMode('PAY_PER_REQUEST')}>
          <span className="radio-dot" />
          <span className="radio-body">
            <span className="radio-title">On-demand</span>
            <span className="radio-desc">Pay per request; capacity scales automatically.</span>
          </span>
        </button>
        <button type="button" className={`radio-card ${mode === 'PROVISIONED' ? 'radio-card-on' : ''}`} onClick={() => setMode('PROVISIONED')}>
          <span className="radio-dot" />
          <span className="radio-body">
            <span className="radio-title">Provisioned</span>
            <span className="radio-desc">Reserve read/write capacity units.</span>
          </span>
        </button>
      </div>

      {mode === 'PROVISIONED' && (
        <div className="form-grid">
          <Field label="Read capacity units" hint="RCU">
            <NumberInput min={1} max={100000} value={read} onChange={(e) => setRead(e.target.value)} />
          </Field>
          <Field label="Write capacity units" hint="WCU">
            <NumberInput min={1} max={100000} value={write} onChange={(e) => setWrite(e.target.value)} />
          </Field>
        </div>
      )}

      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}

// ------------------------------------------------------------------- TTL

function TtlDialog({
  open,
  table,
  onClose,
  onSaved,
}: {
  open: boolean;
  table: DynamoTable;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [enabled, setEnabled] = useState(table.ttlStatus === 'ENABLED' || table.ttlStatus === 'ENABLING');
  const [attribute, setAttribute] = useState(table.ttlAttributeName ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEnabled(table.ttlStatus === 'ENABLED' || table.ttlStatus === 'ENABLING');
    setAttribute(table.ttlAttributeName ?? '');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await dynamoApi.setTimeToLive(table.name, enabled, attribute);
      onSaved(enabled ? `TTL enabled on attribute "${attribute}".` : 'TTL disabled.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Edit time to live"
      subtitle="Automatically delete items whose TTL attribute is in the past (Unix epoch seconds)."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving} loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <Field label="Enable time to live" layout="horizontal">
        <div className="toggle-wrap" style={{ marginTop: 2 }}>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>
      </Field>
      <Field label="TTL attribute name" hint="A Number attribute storing the expiry time in Unix epoch seconds.">
        <TextInput value={attribute} onChange={(e) => setAttribute(e.target.value)} placeholder="expires" spellCheck={false} />
      </Field>

      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}
