import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Check,
  FileKey,
  Info,
  Pencil,
  Plus,
  Send,
  Tags as TagsIcon,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { snsApi, topicNameFromArn, type SnsSubscription, type SnsTopic } from '../../lib/snsApi';
import { errorMessage, useToast } from '../../lib/context';
import { formatNumber, prettyJson } from '../../lib/format';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Modal, Select, SkeletonRows, Stat, Tabs, Textarea, TextInput, Toggle, type TabDef } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ArnText, DeliveryPolicyForm, EndpointCell, formatDeliveryPolicy, PROTOCOL_OPTIONS, protocolLabel, SubscriptionStatusBadge, TopicTypeBadge, useReload } from './SnsUi';
import { PublishDialog, PublishForm } from './PublishDialog';

// ------------------------------------------------------------ subscribe

interface SubscribeDialogProps {
  open: boolean;
  topicArn: string;
  onClose: () => void;
  onSubscribed: (subscriptionArn: string | null) => void;
}

function SubscribeDialog({ open, topicArn, onClose, onSubscribed }: SubscribeDialogProps) {
  const [protocol, setProtocol] = useState('sqs');
  const [endpoint, setEndpoint] = useState('');
  const [rawDelivery, setRawDelivery] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [filterPolicy, setFilterPolicy] = useState('');
  const [redrivePolicy, setRedrivePolicy] = useState('');
  const [deliveryPolicy, setDeliveryPolicy] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setProtocol('sqs');
      setEndpoint('');
      setRawDelivery(false);
      setFilterPolicy('');
      setRedrivePolicy('');
      setDeliveryPolicy('');
      setRoleArn('');
      setError('');
    }
  }, [open]);

  const endpointHint =
    protocol === 'sqs'
      ? 'The ARN of the SQS queue, e.g. arn:aws:sqs:us-east-1:000000000000:my-queue'
      : protocol === 'email' || protocol === 'email-json'
        ? 'The email address that receives notifications.'
        : protocol === 'sms'
          ? 'The phone number in E.164 format, e.g. +15551234567.'
          : protocol === 'lambda'
            ? 'The ARN of the Lambda function.'
            : protocol === 'firehose'
              ? 'The ARN of the Firehose delivery stream.'
              : protocol === 'application'
                ? 'The ARN of the mobile platform application.'
                : 'The URL that receives POST notifications.';

  const handleSubscribe = async () => {
    setSaving(true);
    setError('');
    try {
      const attributes: Record<string, string> = {};
      if (rawDelivery) attributes.RawMessageDelivery = 'true';
      if (filterPolicy.trim()) attributes.FilterPolicy = filterPolicy.trim();
      if (redrivePolicy.trim()) attributes.RedrivePolicy = redrivePolicy.trim();
      if (deliveryPolicy.trim()) attributes.DeliveryPolicy = deliveryPolicy.trim();
      if (roleArn.trim()) attributes.SubscriptionRoleArn = roleArn.trim();
      const res = await snsApi.subscribe({ topicArn, protocol, endpoint, attributes: Object.keys(attributes).length ? attributes : undefined });
      onSubscribed(res.subscriptionArn);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Subscribe"
      subtitle={`Create a subscription to ${topicNameFromArn(topicArn)}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSubscribe()} disabled={!endpoint.trim() || saving} loading={saving}>
            Create subscription
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Protocol" hint="The endpoint type that receives messages.">
          <Select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
            {PROTOCOL_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Endpoint" hint={endpointHint}>
          <TextInput value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="…" spellCheck={false} />
        </Field>
      </div>

      <Field label="Enable raw message delivery" hint="Deliver the raw message payload instead of the standard JSON envelope. Only applicable for HTTP/S, SQS and Firehose.">
        <div className="toggle-wrap" style={{ marginTop: 6 }}>
          <Toggle checked={rawDelivery} onChange={setRawDelivery} />
        </div>
      </Field>

      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdvanced((v) => !v)} style={{ marginBottom: 12 }}>
        {advanced ? 'Hide' : 'Show'} advanced subscription settings
      </button>

      {advanced && (
        <>
          <Field label="Filter policy (JSON)" hint="Optional. Only deliver messages whose attributes match this policy.">
            <Textarea value={filterPolicy} onChange={(e) => setFilterPolicy(e.target.value)} placeholder='{"store": ["example_corp"]}' />
          </Field>
          <Field label="Redrive policy (JSON)" hint="Optional. Forward undeliverable messages to a dead-letter queue.">
            <Textarea value={redrivePolicy} onChange={(e) => setRedrivePolicy(e.target.value)} placeholder='{"deadLetterTargetArn": "arn:aws:sqs:us-east-1:000000000000:dlq"}' />
          </Field>
          <Field label="Delivery policy (JSON)" hint="Optional. Retry and throttle behavior for HTTP/S subscriptions.">
            <Textarea value={deliveryPolicy} onChange={(e) => setDeliveryPolicy(e.target.value)} />
          </Field>
          <Field label="Subscription role ARN" hint="Optional. IAM role used by the subscription (e.g. for Firehose).">
            <TextInput value={roleArn} onChange={(e) => setRoleArn(e.target.value)} placeholder="arn:aws:iam::000000000000:role/…" spellCheck={false} />
          </Field>
        </>
      )}

      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}

// --------------------------------------------------------------- page

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'publish', label: 'Publish message', icon: <Send size={14} /> },
  { id: 'access', label: 'Access policy', icon: <FileKey size={14} /> },
  { id: 'delivery', label: 'Delivery status logging', icon: <Activity size={14} /> },
  { id: 'tags', label: 'Tags', icon: <TagsIcon size={14} /> },
];

export function TopicDetailPage() {
  const { arn } = useParams<{ arn: string }>();
  const topicArn = arn ?? '';
  const navigate = useNavigate();
  const { toast } = useToast();

  const [topic, setTopic] = useState<SnsTopic | null>(null);
  const [subscriptions, setSubscriptions] = useState<SnsSubscription[]>([]);
  const [tab, setTab] = useState('overview');

  const [publishOpen, setPublishOpen] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSubTarget, setDeleteSubTarget] = useState<SnsSubscription | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { loading, error, load } = useReload(
    async () => {
      const [t, subs] = await Promise.all([snsApi.getTopic(topicArn), snsApi.listSubscriptionsByTopic(topicArn)]);
      setTopic(t);
      setSubscriptions(subs.subscriptions);
    },
    [topicArn],
  );

  const attrs = topic?.attributes ?? {};
  const fifo = attrs.FifoTopic === 'true';

  const handleDeleteTopic = async () => {
    setActionLoading(true);
    try {
      await snsApi.deleteTopic(topicArn);
      toast('success', 'Topic deleted', topicNameFromArn(topicArn));
      navigate('/sns');
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteSubscription = async (sub: SnsSubscription) => {
    if (!sub.subscriptionArn) return;
    setActionLoading(true);
    try {
      await snsApi.unsubscribe(sub.subscriptionArn);
      toast('success', 'Subscription removed');
      setDeleteSubTarget(null);
      await load();
    } catch (err) {
      toast('error', 'Failed to remove subscription', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="breadcrumbs">
          <Link to="/sns">SNS</Link>
          <span className="sep">/</span>
          <Link to="/sns">Topics</Link>
        </div>
        <div className="table-wrap">
          <SkeletonRows rows={8} />
        </div>
      </div>
    );
  }

  if (error || !topic) {
    return (
      <div className="page">
        <div className="breadcrumbs">
          <Link to="/sns">SNS</Link>
          <span className="sep">/</span>
          <Link to="/sns">Topics</Link>
        </div>
        <div className="card">
          <ErrorState message={error || 'Topic not found'} onRetry={() => void load()} />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/sns">SNS</Link>
        <span className="sep">/</span>
        <Link to="/sns">Topics</Link>
        <span className="sep">/</span>
        <span>{topic.name}</span>
      </div>

      <div className="detail-header-card">
        <div style={{ minWidth: 0 }}>
          <div className="detail-title-row">
            <h1 className="detail-name">{topic.name}</h1>
            <TopicTypeBadge attributes={attrs} />
          </div>
          <div className="detail-meta">
            <span className="mono" style={{ wordBreak: 'break-all' }}>{topic.arn}</span>
            <span>Owner: {attrs.Owner ?? '—'}</span>
          </div>
        </div>
        <div className="page-actions">
          <Button variant="primary" onClick={() => setPublishOpen(true)}>
            <Send size={14} />
            Publish message
          </Button>
          <Button variant="secondary" onClick={() => setSubscribeOpen(true)}>
            <Plus size={14} />
            Subscribe
          </Button>
          <Button variant="secondary" onClick={() => setEditOpen(true)}>
            <Pencil size={14} />
            Edit
          </Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 size={14} />
            Delete
          </Button>
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <>
          <div className="stats-row">
            <Stat label="Confirmed subscriptions" value={formatNumber(attrs.SubscriptionsConfirmed)} />
            <Stat label="Pending subscriptions" value={formatNumber(attrs.SubscriptionsPending)} />
            <Stat label="Deleted subscriptions" value={formatNumber(attrs.SubscriptionsDeleted)} />
          </div>

          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <h2 className="card-title">Topic details</h2>
            <dl className="kv-grid" style={{ marginTop: 12 }}>
              <KeyValue label="ARN" mono>{topic.arn}</KeyValue>
              <KeyValue label="Topic name" mono>{topic.name}</KeyValue>
              <KeyValue label="Owner">{attrs.Owner ?? '—'}</KeyValue>
              <KeyValue label="Type">{fifo ? 'FIFO' : 'Standard'}</KeyValue>
              <KeyValue label="Display name">{attrs.DisplayName || '—'}</KeyValue>
              <KeyValue label="Content-based deduplication">{fifo ? (attrs.ContentBasedDeduplication === 'true' ? 'Enabled' : 'Disabled') : '—'}</KeyValue>
              <KeyValue label="Signature version">{attrs.SignatureVersion ?? '—'}</KeyValue>
              <KeyValue label="KMS master key">{attrs.KmsMasterKeyId === 'alias/aws/sns' ? 'AWS managed key' : (attrs.KmsMasterKeyId || '—')}</KeyValue>
              <KeyValue label="Tracing config">{attrs.TracingConfig || '—'}</KeyValue>
              <KeyValue label="Delivery policy" mono>{formatDeliveryPolicy(attrs.DeliveryPolicy) || '—'}</KeyValue>
            </dl>
          </div>

          <div className="card card-pad">
            <div className="card-title-row" style={{ marginBottom: 12 }}>
              <h2 className="card-title">Subscriptions</h2>
              <span className="muted" style={{ fontSize: 12.5 }}>{subscriptions.length} total</span>
              <span style={{ flex: 1 }} />
              <Button variant="secondary" size="sm" onClick={() => setSubscribeOpen(true)}>
                <Plus size={13} />
                Subscribe
              </Button>
            </div>

            {subscriptions.length === 0 ? (
              <EmptyState
                title="No subscriptions"
                description="Subscribe an endpoint (SQS queue, email, Lambda, …) to receive messages published to this topic."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Endpoint</th>
                      <th>Protocol</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((sub) => (
                      <tr key={sub.subscriptionArn ?? sub.endpoint}>
                        <td><EndpointCell protocol={sub.protocol} endpoint={sub.endpoint} /></td>
                        <td><Badge>{protocolLabel(sub.protocol)}</Badge></td>
                        <td><SubscriptionStatusBadge subscriptionArn={sub.subscriptionArn} /></td>
                        <td>
                          <div className="row-actions">
                            <IconButton className="danger" title="Delete subscription" onClick={() => setDeleteSubTarget(sub)}>
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
        </>
      )}

      {tab === 'publish' && (
        <div className="card card-pad">
          <h2 className="card-title">Publish message</h2>
          <p className="card-subtitle" style={{ marginBottom: 16 }}>Deliver a message to every subscription on this topic.</p>
          <PublishForm
            key={topicArn}
            topicArn={topicArn}
            isFifo={fifo}
            contentBasedDedup={attrs.ContentBasedDeduplication === 'true'}
            onPublished={() => toast('success', 'Message published')}
          />
        </div>
      )}

      {tab === 'access' && <AccessPolicyTab topicArn={topicArn} policy={attrs.Policy ?? ''} onSaved={() => { toast('success', 'Access policy updated'); void load(); }} />}

      {tab === 'delivery' && (
        <DeliveryLoggingTab
          topicArn={topicArn}
          policy={attrs.DeliveryPolicy ?? ''}
          onSaved={() => { toast('success', 'Delivery policy updated'); void load(); }}
        />
      )}

      {tab === 'tags' && (
        <TagsTab
          topic={topic}
          onChanged={() => { toast('success', 'Tags updated'); void load(); }}
        />
      )}

      <PublishDialog
        open={publishOpen}
        title="Publish message"
        subtitle={`To topic ${topic.name}`}
        topicArn={topicArn}
        isFifo={fifo}
        contentBasedDedup={attrs.ContentBasedDeduplication === 'true'}
        onClose={() => setPublishOpen(false)}
        onPublished={() => toast('success', 'Message published')}
      />

      <SubscribeDialog
        open={subscribeOpen}
        topicArn={topicArn}
        onClose={() => setSubscribeOpen(false)}
        onSubscribed={(subArn) => {
          if (subArn) {
            toast('success', 'Subscription created', subArn.includes('pending') || !subArn.startsWith('arn:') ? 'Awaiting confirmation from the endpoint.' : undefined);
          } else {
            toast('info', 'Subscription pending confirmation', 'Confirm the subscription from the endpoint to start receiving messages.');
          }
          void load();
        }}
      />

      {editOpen && (
        <EditTopicDialog topic={topic} onClose={() => setEditOpen(false)} onSaved={() => { toast('success', 'Topic updated'); void load(); }} />
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete topic?"
        message={
          <>
            Permanently delete topic <strong>{topic.name}</strong> and all of its subscriptions? This cannot be undone.
          </>
        }
        confirmLabel="Delete topic"
        loading={actionLoading}
        onConfirm={() => void handleDeleteTopic()}
        onClose={() => setDeleteOpen(false)}
      />

      <ConfirmDialog
        open={!!deleteSubTarget}
        title="Delete subscription?"
        message={
          <>
            Remove the subscription for <strong>{deleteSubTarget?.endpoint}</strong>? It will stop receiving messages from this topic.
          </>
        }
        confirmLabel="Delete subscription"
        loading={actionLoading}
        onConfirm={() => deleteSubTarget && void handleDeleteSubscription(deleteSubTarget)}
        onClose={() => setDeleteSubTarget(null)}
      />
    </div>
  );
}

// ------------------------------------------------------------- sub-tabs

function KeyValue({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="kv-row">
      <dt className="kv-label">{label}</dt>
      <dd className={cn('kv-value', mono && 'kv-mono')} style={{ margin: 0 }}>{children ?? '—'}</dd>
    </div>
  );
}

function AccessPolicyTab({ topicArn, policy, onSaved }: { topicArn: string; policy: string; onSaved: () => void }) {
  const [text, setText] = useState(prettyJson(policy));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setText(prettyJson(policy));
  }, [policy]);

  const handleSave = async () => {
    let parsed: string;
    try {
      parsed = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      setError('The policy must be valid JSON.');
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await snsApi.setTopicAttribute(topicArn, 'Policy', parsed);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-pad">
      <h2 className="card-title">Access policy</h2>
      <p className="card-subtitle" style={{ marginBottom: 12 }}>
        Resource-based policy that controls who can access this topic. Changes apply immediately.
      </p>
      <div className="inline-info" style={{ marginTop: 0 }}>
        <Info size={16} />
        <span>
          The default policy allows your account's principals to perform all actions on this topic. Use{' '}
          <code>aws sns set-topic-attributes</code> syntax — the <code>Policy</code> attribute is set as JSON.
        </span>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        style={{ minHeight: 260, fontFamily: 'var(--mono)', fontSize: 12.5 }}
      />
      {error && <div className="inline-error">{error}</div>}
      {saved && (
        <div className="inline-info" style={{ marginBottom: 0 }}>
          <Check size={16} style={{ color: 'var(--success)' }} />
          Policy saved.
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
          Save policy
        </Button>
      </div>
    </div>
  );
}

function DeliveryLoggingTab({ topicArn, policy, onSaved }: { topicArn: string; policy: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(policy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await snsApi.setTopicAttribute(topicArn, 'DeliveryPolicy', draft);
      onSaved();
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-pad">
      <div className="card-title-row" style={{ marginBottom: 12 }}>
        <h2 className="card-title">Delivery status logging</h2>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          <Pencil size={13} />
          Edit
        </Button>
      </div>
      <p className="card-subtitle" style={{ marginBottom: 12 }}>
        Log delivery statuses to CloudWatch for messages published to this topic.
      </p>

      {formatDeliveryPolicy(policy) ? (
        <pre className="msg-body-preview" style={{ maxHeight: 300 }}>{formatDeliveryPolicy(policy)}</pre>
      ) : (
        <div className="inline-info" style={{ marginTop: 0 }}>
          <Info size={16} />
          <span>Delivery status logging is not configured. Click Edit to enable it for HTTP/S, Lambda, SQS or Firehose subscriptions.</span>
        </div>
      )}

      {editing && (
        <Modal
          open
          title="Edit delivery status logging"
          subtitle="Configure CloudWatch logging of delivery status per protocol."
          onClose={() => setEditing(false)}
          wide
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
                Save changes
              </Button>
            </>
          }
        >
          <DeliveryPolicyForm key={topicArn} policy={policy} onChange={setDraft} />
          {error && <div className="inline-error">{error}</div>}
        </Modal>
      )}
    </div>
  );
}

function TagsTab({ topic, onChanged }: { topic: SnsTopic; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleAdd = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setError('');
    try {
      await snsApi.tagTopic(topic.arn, { [key.trim()]: value });
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
      await snsApi.untagTopic(topic.arn, [tagKey]);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const entries = Object.entries(topic.tags);

  return (
    <div className="card card-pad">
      <div className="card-title-row" style={{ marginBottom: 12 }}>
        <h2 className="card-title">Tags</h2>
        <span className="muted" style={{ fontSize: 12.5 }}>{entries.length} tag{entries.length === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          <Plus size={13} />
          Add tag
        </Button>
      </div>
      <p className="card-subtitle" style={{ marginBottom: 12 }}>Tags help you organize and identify this topic.</p>

      {error && <div className="inline-error">{error}</div>}

      {entries.length === 0 ? (
        <EmptyState title="No tags" description="Add tags to this topic to organize it." />
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
        subtitle="Add a key-value tag to this topic."
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

function EditTopicDialog({ topic, onClose, onSaved }: { topic: SnsTopic; onClose: () => void; onSaved: () => void }) {
  const fifo = topic.attributes.FifoTopic === 'true';
  const [displayName, setDisplayName] = useState(topic.attributes.DisplayName ?? '');
  const [contentBasedDedup, setContentBasedDedup] = useState(topic.attributes.ContentBasedDeduplication === 'true');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      if (!fifo && displayName.trim() !== (topic.attributes.DisplayName ?? '')) {
        await snsApi.setTopicAttribute(topic.arn, 'DisplayName', displayName.trim());
      }
      if (fifo) {
        await snsApi.setTopicAttribute(topic.arn, 'ContentBasedDeduplication', contentBasedDedup ? 'true' : 'false');
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Edit topic"
      subtitle={`${topic.name} · ${fifo ? 'FIFO' : 'Standard'}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      {!fifo && (
        <Field label="Display name" hint="The name shown in email notifications from this topic.">
          <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} />
        </Field>
      )}
      {fifo && (
        <Field label="Content-based deduplication" hint="Generates a deduplication ID from the message body.">
          <div className="toggle-wrap" style={{ marginTop: 6 }}>
            <Toggle checked={contentBasedDedup} onChange={setContentBasedDedup} />
          </div>
        </Field>
      )}
      <div className="muted" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertTriangle size={13} />
        Topic ARN:
        <ArnText arn={topic.arn} />
      </div>
      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}
