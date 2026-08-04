import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpDown, Eraser, Mail, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { errorMessage, useToast } from '../lib/context';
import { formatNumber, formatSeconds, formatTimestamp } from '../lib/format';
import type { QueueItem } from '../lib/types';
import { Badge, Button, EmptyState, ErrorState, IconButton, SkeletonRows, TextInput } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CreateQueueDialog } from '../components/CreateQueueDialog';
import { SendMessageDialog } from '../components/SendMessageDialog';

export function QueuesPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState<QueueItem | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<QueueItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QueueItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listQueues();
      setQueues(res.queues);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return queues;
    return queues.filter((item) => item.name.toLowerCase().includes(q));
  }, [queues, filter]);

  const isFifo = (item: QueueItem) => item.attributes.FifoQueue === 'true';

  const handlePurge = async () => {
    if (!purgeTarget) return;
    setActionLoading(true);
    try {
      await api.purgeQueue(purgeTarget.url);
      toast('success', 'Queue purged', `${purgeTarget.name} cleared.`);
      setPurgeTarget(null);
      await load();
    } catch (err) {
      toast('error', 'Purge failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await api.deleteQueue(deleteTarget.url);
      toast('success', 'Queue deleted', `${deleteTarget.name} removed.`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Queues</h1>
          <p className="page-description">SQS queues on the configured endpoint. Select a queue to manage its configuration.</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => void load()} disabled={loading} title="Refresh">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Refresh
          </Button>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={15} />
            Create queue
          </Button>
        </div>
      </div>

      <div className="filter-bar">
        <div style={{ position: 'relative', width: '100%', maxWidth: 320 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
          <TextInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter queues by name…"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <span className="muted" style={{ alignSelf: 'center', fontSize: 12.5 }}>
          {filtered.length} of {queues.length} queue{queues.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading && (
        <div className="table-wrap">
          <SkeletonRows rows={7} />
        </div>
      )}

      {!loading && error && <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>}

      {!loading && !error && queues.length === 0 && (
        <div className="card">
          <EmptyState
            title="No queues yet"
            description="Create your first SQS queue to get started."
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus size={15} />
                Create queue
              </Button>
            }
          />
        </div>
      )}

      {!loading && !error && queues.length > 0 && filtered.length === 0 && (
        <div className="card">
          <EmptyState title="No matching queues" description={`Nothing matches "${filter}".`} />
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th className="num-cell">Available</th>
                <th className="num-cell">In flight</th>
                <th className="num-cell">Delayed</th>
                <th>Visibility timeout</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.url}>
                  <td className="queue-name-cell" onClick={() => navigate(`/queues/${encodeURIComponent(item.name)}`)}>
                    <div className="qname">{item.name}</div>
                    <div className="qurl">{item.arn ?? item.url}</div>
                  </td>
                  <td>
                    {isFifo(item) ? <Badge tone="fifo">FIFO</Badge> : <Badge>Standard</Badge>}
                    {item.attributes.RedrivePolicy && (
                      <span style={{ marginLeft: 6 }}>
                        <Badge tone="dlq">DLQ</Badge>
                      </span>
                    )}
                  </td>
                  <td className="num-cell">
                    {formatNumber(item.attributes.ApproximateNumberOfMessages)}
                    <span className="sub">messages</span>
                  </td>
                  <td className="num-cell">
                    {formatNumber(item.attributes.ApproximateNumberOfMessagesNotVisible)}
                  </td>
                  <td className="num-cell">
                    {formatNumber(item.attributes.ApproximateNumberOfMessagesDelayed)}
                  </td>
                  <td>{formatSeconds(Number(item.attributes.VisibilityTimeout ?? 30))}</td>
                  <td>{formatTimestamp(item.attributes.CreatedTimestamp)}</td>
                  <td>
                    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton title="Send message" onClick={() => setSendTarget(item)}>
                        <Mail size={15} />
                      </IconButton>
                      <IconButton title="Purge queue" onClick={() => setPurgeTarget(item)}>
                        <Eraser size={15} />
                      </IconButton>
                      <IconButton className="danger" title="Delete queue" onClick={() => setDeleteTarget(item)}>
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

      <div className="muted" style={{ marginTop: 14, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <ArrowUpDown size={13} />
        Tip: click a queue row to open its console — configure visibility timeouts, dead-letter (redrive) policies, permissions and tags.
      </div>

      <CreateQueueDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { toast('success', 'Queue created'); void load(); }} />

      {sendTarget && (
        <SendMessageDialog
          open={!!sendTarget}
          queueUrl={sendTarget.url}
          queueName={sendTarget.name}
          isFifo={isFifo(sendTarget)}
          contentBasedDedup={sendTarget.attributes.ContentBasedDeduplication === 'true'}
          onClose={() => setSendTarget(null)}
        />
      )}

      <ConfirmDialog
        open={!!purgeTarget}
        title="Purge queue?"
        message={
          <>
            Delete all messages in <strong>{purgeTarget?.name}</strong>? This cannot be undone.
          </>
        }
        confirmLabel="Purge"
        loading={actionLoading}
        onConfirm={() => void handlePurge()}
        onClose={() => setPurgeTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete queue?"
        message={
          <>
            Permanently delete queue <strong>{deleteTarget?.name}</strong> and all of its messages? This cannot be undone.
          </>
        }
        confirmLabel="Delete queue"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
