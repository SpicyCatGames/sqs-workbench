import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { lambdaApi, type EventSourceMapping, type FunctionDetail } from '../../lib/lambdaApi';
import { api } from '../../lib/api';
import { dynamoApi, type DynamoTable } from '../../lib/dynamoApi';
import { errorMessage, useToast } from '../../lib/context';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Modal, NumberInput, Select, SkeletonRows, TextInput, Toggle } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { eventSourceLabel, formatIso, useReload } from './LambdaUi';

interface Props {
  fn: FunctionDetail;
}

export function TriggersTab({ fn }: Props) {
  const { toast } = useToast();
  const [mappings, setMappings] = useState<EventSourceMapping[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EventSourceMapping | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { loading, error, load } = useReload(async () => {
    const res = await lambdaApi.listEventSourceMappings(fn.functionName);
    setMappings(res.mappings);
  }, [fn.functionName]);

  const toggleMapping = async (m: EventSourceMapping) => {
    setActionLoading(true);
    try {
      await lambdaApi.updateEventSourceMapping(m.uuid, { enabled: !(m.enabled === true) });
      toast('success', 'Trigger updated', m.enabled ? 'Event source mapping disabled.' : 'Event source mapping enabled.');
      await load();
    } catch (err) {
      toast('error', 'Update failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await lambdaApi.deleteEventSourceMapping(deleteTarget.uuid);
      toast('success', 'Trigger removed', 'Event source mapping deleted.');
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="prop-stack">
      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 12 }}>
          <h3 className="card-title">Event source mappings</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>{mappings.length} trigger{mappings.length === 1 ? '' : 's'}</span>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={13} />
            Add trigger
          </Button>
        </div>

        <p className="card-subtitle" style={{ marginBottom: 12 }}>
          Event source mappings poll SQS queues, DynamoDB streams and Kinesis streams, and invoke this function with each batch of records.
          SNS, S3 and EventBridge triggers are configured through resource permissions on the <strong>Permissions</strong> tab.
        </p>

        {loading && <SkeletonRows rows={4} />}
        {!loading && error && <ErrorState message={error} onRetry={() => void load()} />}

        {!loading && !error && mappings.length === 0 && (
          <EmptyState
            title="No triggers yet"
            description="Add an event source mapping to invoke this function automatically."
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus size={13} />
                Add trigger
              </Button>
            }
          />
        )}

        {!loading && !error && mappings.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Event source</th>
                  <th>Type</th>
                  <th>State</th>
                  <th className="num-cell">Batch size</th>
                  <th className="num-cell">Window (s)</th>
                  <th>Last modified</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => {
                  const sourceArn = m.eventSourceArn ?? '';
                  const type = sourceArn.split(':')[2] ?? '';
                  const isEnabled = m.enabled === true;
                  return (
                    <tr key={m.uuid}>
                      <td className="queue-name-cell">
                        <div className="qname">{eventSourceLabel(sourceArn)}</div>
                        <div className="qurl">{m.uuid}</div>
                      </td>
                      <td>{type || '—'}</td>
                      <td>
                        <Badge tone={m.state === 'Enabled' ? 'success' : m.state === 'Disabled' ? 'default' : m.state === 'Failed' ? 'dlq' : 'warn'}>
                          {m.state ?? '—'}
                        </Badge>
                      </td>
                      <td className="num-cell">{m.batchSize ?? '—'}</td>
                      <td className="num-cell">{m.maximumBatchingWindowInSeconds ?? '—'}</td>
                      <td>{formatIso(m.lastModified)}</td>
                      <td>
                        <div className="row-actions">
                          <Toggle checked={isEnabled} onChange={() => void toggleMapping(m)} />
                          <IconButton className="danger" title="Delete trigger" loading={actionLoading} onClick={() => setDeleteTarget(m)}>
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {createOpen && (
        <CreateMappingDialog
          fn={fn}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            toast('success', 'Trigger added', 'Event source mapping created.');
            setCreateOpen(false);
            void load();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete trigger?"
        message={
          <>
            Remove the event source mapping <strong>{deleteTarget?.uuid}</strong>? The function will stop being invoked by this source.
          </>
        }
        confirmLabel="Delete trigger"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// --------------------------------------------------------- create mapping

type SourceKind = 'sqs' | 'dynamodb' | 'custom';

function CreateMappingDialog({ fn, onClose, onCreated }: { fn: FunctionDetail; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [kind, setKind] = useState<SourceKind>('sqs');
  const [queues, setQueues] = useState<Array<{ name: string; arn: string | null }>>([]);
  const [tables, setTables] = useState<DynamoTable[]>([]);
  const [queueArn, setQueueArn] = useState('');
  const [tableArn, setTableArn] = useState('');
  const [customArn, setCustomArn] = useState('');
  const [batchSize, setBatchSize] = useState(10);
  const [windowSeconds, setWindowSeconds] = useState(0);
  const [startingPosition, setStartingPosition] = useState<'LATEST' | 'TRIM_HORIZON'>('LATEST');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [q, t] = await Promise.all([api.listQueues(), dynamoApi.listTables()]);
        if (cancelled) return;
        setQueues(q.queues.filter((x) => x.arn));
        setTables(t.tables.filter((x) => x.arn));
        if (q.queues[0]?.arn) setQueueArn(q.queues[0].arn);
        if (t.tables[0]?.arn) setTableArn(t.tables[0].arn);
      } catch {
        /* sources are optional — custom ARN always works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sourceArn = kind === 'sqs' ? queueArn : kind === 'dynamodb' ? tableArn : customArn;

  const handleCreate = async () => {
    setSaving(true);
    setError('');
    try {
      await lambdaApi.createEventSourceMapping({
        functionName: fn.functionName,
        eventSourceArn: sourceArn,
        batchSize: Math.max(1, Math.round(batchSize) || 1),
        maximumBatchingWindowInSeconds: windowSeconds > 0 ? Math.round(windowSeconds) : undefined,
        enabled,
        startingPosition: kind === 'dynamodb' ? startingPosition : undefined,
      });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
      toast('error', 'Failed to add trigger', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Add trigger"
      subtitle={`${fn.functionName} · event source mapping`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleCreate()} loading={saving} disabled={!sourceArn}>
            Add
          </Button>
        </>
      }
    >
      <div className="segmented" style={{ marginBottom: 14 }}>
        <button type="button" className={cn('segmented-btn', kind === 'sqs' && 'segmented-active')} onClick={() => setKind('sqs')}>
          SQS queue
        </button>
        <button type="button" className={cn('segmented-btn', kind === 'dynamodb' && 'segmented-active')} onClick={() => setKind('dynamodb')}>
          DynamoDB stream
        </button>
        <button type="button" className={cn('segmented-btn', kind === 'custom' && 'segmented-active')} onClick={() => setKind('custom')}>
          Custom ARN
        </button>
      </div>

      {kind === 'sqs' && (
        <Field label="Queue" hint="Choose an SQS queue on the configured endpoint.">
          {queues.length === 0 ? (
            <TextInput value={customArn} onChange={(e) => setCustomArn(e.target.value)} placeholder="arn:aws:sqs:us-east-1:000000000000:my-queue" spellCheck={false} className="mono" />
          ) : (
            <Select value={queueArn} onChange={(e) => setQueueArn(e.target.value)}>
              {queues.map((q) => (
                <option key={q.arn} value={q.arn ?? ''}>
                  {q.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      {kind === 'dynamodb' && (
        <Field label="Table" hint="Choose a DynamoDB table (its stream must be enabled on the table).">
          {tables.length === 0 ? (
            <TextInput value={customArn} onChange={(e) => setCustomArn(e.target.value)} placeholder="arn:aws:dynamodb:us-east-1:000000000000:table/my-table/stream/…" spellCheck={false} className="mono" />
          ) : (
            <Select value={tableArn} onChange={(e) => setTableArn(e.target.value)}>
              {tables.map((t) => (
                <option key={t.arn} value={t.arn ?? ''}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      {kind === 'custom' && (
        <Field label="Event source ARN" hint="Any stream or queue ARN supported by the endpoint.">
          <TextInput value={customArn} onChange={(e) => setCustomArn(e.target.value)} placeholder="arn:aws:sqs:us-east-1:000000000000:my-queue" spellCheck={false} className="mono" />
        </Field>
      )}

      <div className="form-grid">
        <Field label="Batch size" hint="1 – 10000 records per invocation.">
          <NumberInput value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} min={1} max={10000} />
        </Field>
        <Field label="Batch window (seconds)" hint="0 – 300; how long to wait before invoking with a partial batch.">
          <NumberInput value={windowSeconds} onChange={(e) => setWindowSeconds(Number(e.target.value))} min={0} max={300} />
        </Field>
      </div>

      {kind === 'dynamodb' && (
        <Field label="Starting position" hint="Where to begin reading the stream. Only used on first creation.">
          <Select value={startingPosition} onChange={(e) => setStartingPosition(e.target.value as 'LATEST' | 'TRIM_HORIZON')}>
            <option value="LATEST">Latest — read only new records</option>
            <option value="TRIM_HORIZON">Trim horizon — read all available records</option>
          </Select>
        </Field>
      )}

      <Field label="Enable trigger" hint="Disabled mappings keep the configuration but stop invoking the function.">
        <div className="toggle-wrap" style={{ marginTop: 6 }}>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>
      </Field>

      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}
