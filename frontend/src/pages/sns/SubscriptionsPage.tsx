import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, RefreshCw, Search, Trash2 } from 'lucide-react';
import { snsApi, topicNameFromArn, type SnsSubscription } from '../../lib/snsApi';
import { errorMessage, useToast } from '../../lib/context';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Modal, SkeletonRows, Textarea, TextInput, Toggle } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ArnText, EndpointCell, protocolLabel, SubscriptionStatusBadge, useReload } from './SnsUi';

export function SubscriptionsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [subscriptions, setSubscriptions] = useState<SnsSubscription[]>([]);
  const [filter, setFilter] = useState('');
  const [detailTarget, setDetailTarget] = useState<SnsSubscription | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SnsSubscription | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { loading, error, load } = useReload(async () => {
    const res = await snsApi.listSubscriptions();
    setSubscriptions(res.subscriptions);
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return subscriptions;
    return subscriptions.filter(
      (s) =>
        s.endpoint.toLowerCase().includes(q) ||
        s.topicArn.toLowerCase().includes(q) ||
        s.protocol.toLowerCase().includes(q),
    );
  }, [subscriptions, filter]);

  const handleDelete = async () => {
    if (!deleteTarget?.subscriptionArn) return;
    setActionLoading(true);
    try {
      await snsApi.unsubscribe(deleteTarget.subscriptionArn);
      toast('success', 'Subscription removed', `${deleteTarget.endpoint} unsubscribed.`);
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
          <h1 className="page-title">Subscriptions</h1>
          <p className="page-description">All subscriptions across topics on the configured endpoint.</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => void load()} disabled={loading} title="Refresh">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="filter-bar">
        <div style={{ position: 'relative', width: '100%', maxWidth: 320 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
          <TextInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by endpoint, topic ARN or protocol…"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <span className="muted" style={{ alignSelf: 'center', fontSize: 12.5 }}>
          {filtered.length} of {subscriptions.length} subscription{subscriptions.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading && (
        <div className="table-wrap">
          <SkeletonRows rows={8} />
        </div>
      )}

      {!loading && error && <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>}

      {!loading && !error && subscriptions.length === 0 && (
        <div className="card">
          <EmptyState
            title="No subscriptions"
            description="Open a topic and use Subscribe to connect an endpoint (SQS queue, email, Lambda, …) to it."
            action={
              <Button variant="primary" onClick={() => navigate('/sns')}>
                Go to Topics
              </Button>
            }
          />
        </div>
      )}

      {!loading && !error && subscriptions.length > 0 && filtered.length === 0 && (
        <div className="card">
          <EmptyState title="No matching subscriptions" description={`Nothing matches "${filter}".`} />
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Topic ARN</th>
                <th>Protocol</th>
                <th>Status</th>
                <th>Owner</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sub) => (
                <tr key={sub.subscriptionArn ?? `${sub.topicArn}:${sub.endpoint}`}>
                  <td><EndpointCell protocol={sub.protocol} endpoint={sub.endpoint} /></td>
                  <td>
                    <button
                      type="button"
                      className="arn-link"
                      onClick={() => navigate(`/sns/topics/${encodeURIComponent(sub.topicArn)}`)}
                      title="Open topic"
                    >
                      {topicNameFromArn(sub.topicArn)}
                      <span className="arn-link-sub">{sub.topicArn}</span>
                    </button>
                  </td>
                  <td><Badge>{protocolLabel(sub.protocol)}</Badge></td>
                  <td><SubscriptionStatusBadge subscriptionArn={sub.subscriptionArn} /></td>
                  <td className="mono" style={{ fontSize: 12 }}>{sub.owner || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <IconButton title="View details" onClick={() => setDetailTarget(sub)}>
                        <Eye size={15} />
                      </IconButton>
                      <IconButton className="danger" title="Delete subscription" onClick={() => setDeleteTarget(sub)}>
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

      {detailTarget && (
        <SubscriptionDetailDialog
          subscription={detailTarget}
          onClose={() => setDetailTarget(null)}
          onChanged={() => void load()}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete subscription?"
        message={
          <>
            Remove the subscription for <strong>{deleteTarget?.endpoint}</strong>? It will stop receiving messages from its topic.
          </>
        }
        confirmLabel="Delete subscription"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ------------------------------------------------------------- detail

function SubscriptionDetailDialog({ subscription, onClose, onChanged }: { subscription: SnsSubscription; onClose: () => void; onChanged: () => void }) {
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  // Only set when a fetch actually starts — subscriptions without an ARN
  // (pending confirmation) skip the fetch entirely and must not stay loading.
  const [loading, setLoading] = useState(false);
  const [rawDelivery, setRawDelivery] = useState(false);
  const [filterPolicy, setFilterPolicy] = useState('');
  const [redrivePolicy, setRedrivePolicy] = useState('');
  const [deliveryPolicy, setDeliveryPolicy] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadAttributes = async () => {
    if (!subscription.subscriptionArn) return;
    setLoading(true);
    try {
      const res = await snsApi.getSubscriptionAttributes(subscription.subscriptionArn);
      setAttributes(res.attributes);
      setRawDelivery(res.attributes.RawMessageDelivery === 'true');
      setFilterPolicy(res.attributes.FilterPolicy ?? '');
      setRedrivePolicy(res.attributes.RedrivePolicy ?? '');
      setDeliveryPolicy(res.attributes.DeliveryPolicy ?? '');
      setRoleArn(res.attributes.SubscriptionRoleArn ?? '');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (subscription.subscriptionArn) void loadAttributes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription]);

  const handleSave = async () => {
    if (!subscription.subscriptionArn) return;
    setSaving(true);
    setError('');
    try {
      await snsApi.setSubscriptionAttribute(subscription.subscriptionArn, 'RawMessageDelivery', rawDelivery ? 'true' : 'false');
      if (filterPolicy !== (attributes.FilterPolicy ?? '')) {
        await snsApi.setSubscriptionAttribute(subscription.subscriptionArn, 'FilterPolicy', filterPolicy.trim() || '{}');
      }
      if (redrivePolicy !== (attributes.RedrivePolicy ?? '')) {
        await snsApi.setSubscriptionAttribute(subscription.subscriptionArn, 'RedrivePolicy', redrivePolicy.trim() || '{}');
      }
      if (deliveryPolicy !== (attributes.DeliveryPolicy ?? '')) {
        await snsApi.setSubscriptionAttribute(subscription.subscriptionArn, 'DeliveryPolicy', deliveryPolicy.trim() || '{}');
      }
      if (roleArn !== (attributes.SubscriptionRoleArn ?? '')) {
        await snsApi.setSubscriptionAttribute(subscription.subscriptionArn, 'SubscriptionRoleArn', roleArn.trim() || '');
      }
      onChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const editable =
    subscription.protocol === 'sqs' ||
    subscription.protocol === 'http' ||
    subscription.protocol === 'https' ||
    subscription.protocol === 'lambda' ||
    subscription.protocol === 'firehose' ||
    subscription.protocol === 'application';

  return (
    <Modal
      open
      title="Subscription details"
      subtitle={`${protocolLabel(subscription.protocol)} · ${subscription.endpoint}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Close
          </Button>
          {editable && subscription.subscriptionArn && (
            <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
              Save changes
            </Button>
          )}
        </>
      }
    >
      <div className="attr-list" style={{ gap: 8 }}>
        <div className="kv-grid" style={{ marginBottom: 14 }}>
          <div className="kv-row">
            <dt className="kv-label">Subscription ARN</dt>
            <dd className="kv-value kv-mono"><ArnText arn={subscription.subscriptionArn} /></dd>
          </div>
          <div className="kv-row">
            <dt className="kv-label">Topic ARN</dt>
            <dd className="kv-value kv-mono"><ArnText arn={subscription.topicArn} /></dd>
          </div>
          <div className="kv-row">
            <dt className="kv-label">Protocol</dt>
            <dd className="kv-value">{protocolLabel(subscription.protocol)}</dd>
          </div>
          <div className="kv-row">
            <dt className="kv-label">Status</dt>
            <dd className="kv-value"><SubscriptionStatusBadge subscriptionArn={subscription.subscriptionArn} /></dd>
          </div>
        </div>

        {error && <div className="inline-error">{error}</div>}

        {loading && <div className="muted" style={{ padding: '12px 0', fontSize: 13 }}>Loading attributes…</div>}

        {!loading && editable && subscription.subscriptionArn && (
          <>
            <Field label="Raw message delivery" hint="Deliver the raw payload instead of the standard JSON envelope.">
              <div className="toggle-wrap" style={{ marginTop: 6 }}>
                <Toggle checked={rawDelivery} onChange={setRawDelivery} />
              </div>
            </Field>
            <Field label="Filter policy (JSON)" hint="Only deliver messages whose attributes match this policy.">
              <Textarea value={filterPolicy} onChange={(e) => setFilterPolicy(e.target.value)} spellCheck={false} />
            </Field>
            <Field label="Redrive policy (JSON)" hint="Forward undeliverable messages to a dead-letter queue.">
              <Textarea value={redrivePolicy} onChange={(e) => setRedrivePolicy(e.target.value)} spellCheck={false} />
            </Field>
            <Field label="Delivery policy (JSON)" hint="Retry and throttle behavior for HTTP/S subscriptions.">
              <Textarea value={deliveryPolicy} onChange={(e) => setDeliveryPolicy(e.target.value)} spellCheck={false} />
            </Field>
            <Field label="Subscription role ARN">
              <TextInput value={roleArn} onChange={(e) => setRoleArn(e.target.value)} placeholder="arn:aws:iam::000000000000:role/…" spellCheck={false} />
            </Field>
          </>
        )}

        {!loading && subscription.subscriptionArn && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Attribute</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(attributes).map(([k, v]) => (
                  <tr key={k}>
                    <td className="mono" style={{ fontSize: 12 }}>{k}</td>
                    <td className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>{v || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
