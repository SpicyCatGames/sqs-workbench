import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Search, Send, Trash2 } from 'lucide-react';
import { snsApi, type SnsTopic } from '../../lib/snsApi';
import { errorMessage, useToast } from '../../lib/context';
import { formatNumber } from '../../lib/format';
import { Button, EmptyState, ErrorState, IconButton, SkeletonRows, TextInput } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TopicTypeBadge, useReload } from './SnsUi';
import { PublishDialog } from './PublishDialog';

export function TopicsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [topics, setTopics] = useState<SnsTopic[]>([]);
  const [filter, setFilter] = useState('');
  const [publishTarget, setPublishTarget] = useState<SnsTopic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SnsTopic | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { loading, error, load } = useReload(async () => {
    const res = await snsApi.listTopics();
    setTopics(res.topics);
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter((t) => t.name.toLowerCase().includes(q) || t.arn.toLowerCase().includes(q));
  }, [topics, filter]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await snsApi.deleteTopic(deleteTarget.arn);
      toast('success', 'Topic deleted', `${deleteTarget.name} removed.`);
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
          <h1 className="page-title">Topics</h1>
          <p className="page-description">SNS topics on the configured endpoint. Select a topic to view subscriptions and publish messages.</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => void load()} disabled={loading} title="Refresh">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Refresh
          </Button>
          <Button variant="primary" onClick={() => navigate('/sns/create')}>
            <Plus size={15} />
            Create topic
          </Button>
        </div>
      </div>

      <div className="filter-bar">
        <div style={{ position: 'relative', width: '100%', maxWidth: 320 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
          <TextInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter topics by name or ARN…"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <span className="muted" style={{ alignSelf: 'center', fontSize: 12.5 }}>
          {filtered.length} of {topics.length} topic{topics.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading && (
        <div className="table-wrap">
          <SkeletonRows rows={7} />
        </div>
      )}

      {!loading && error && <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>}

      {!loading && !error && topics.length === 0 && (
        <div className="card">
          <EmptyState
            title="No topics yet"
            description="Create your first SNS topic to start publishing messages to subscribers."
            action={
              <Button variant="primary" onClick={() => navigate('/sns/create')}>
                <Plus size={15} />
                Create topic
              </Button>
            }
          />
        </div>
      )}

      {!loading && !error && topics.length > 0 && filtered.length === 0 && (
        <div className="card">
          <EmptyState title="No matching topics" description={`Nothing matches "${filter}".`} />
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Display name</th>
                <th className="num-cell">Confirmed</th>
                <th className="num-cell">Pending</th>
                <th className="num-cell">Deleted</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((topic) => (
                <tr key={topic.arn}>
                  <td className="queue-name-cell" onClick={() => navigate(`/sns/topics/${encodeURIComponent(topic.arn)}`)}>
                    <div className="qname">{topic.name}</div>
                    <div className="qurl">{topic.arn}</div>
                  </td>
                  <td><TopicTypeBadge attributes={topic.attributes} /></td>
                  <td>{topic.attributes.DisplayName || <span className="muted">—</span>}</td>
                  <td className="num-cell">{formatNumber(topic.attributes.SubscriptionsConfirmed)}</td>
                  <td className="num-cell">{formatNumber(topic.attributes.SubscriptionsPending)}</td>
                  <td className="num-cell">{formatNumber(topic.attributes.SubscriptionsDeleted)}</td>
                  <td>
                    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton title="Publish message" onClick={() => setPublishTarget(topic)}>
                        <Send size={15} />
                      </IconButton>
                      <IconButton className="danger" title="Delete topic" onClick={() => setDeleteTarget(topic)}>
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

      <div className="muted" style={{ marginTop: 14, fontSize: 12 }}>
        Tip: click a topic row to open its console — subscribe endpoints, publish messages, manage access policy, delivery status logging and tags.
      </div>

      {publishTarget && (
        <PublishDialog
          open={!!publishTarget}
          title="Publish message"
          subtitle={`To topic ${publishTarget.name}`}
          topicArn={publishTarget.arn}
          isFifo={publishTarget.attributes.FifoTopic === 'true'}
          contentBasedDedup={publishTarget.attributes.ContentBasedDeduplication === 'true'}
          onClose={() => setPublishTarget(null)}
          onPublished={() => toast('success', 'Message published')}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete topic?"
        message={
          <>
            Permanently delete topic <strong>{deleteTarget?.name}</strong> and all of its subscriptions? This cannot be undone.
          </>
        }
        confirmLabel="Delete topic"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
