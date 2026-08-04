import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftRight,
  Clock,
  CloudCog,
  Eraser,
  Inbox,
  Layers,
  Mail,
  MessageSquareText,
  PackageSearch,
  ShieldCheck,
  Tags as TagsIcon,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { errorMessage, useToast } from '../lib/context';
import { attrInt, formatBytes, formatNumber, formatSeconds, formatTimestamp, parseRedrivePolicy, prettyJson, queueNameFromArn } from '../lib/format';
import type { QueueItem } from '../lib/types';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, KeyValue, NumberInput, Select, SkeletonRows, Spinner, Tabs, TextInput, Textarea, Toggle } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SendMessageDialog } from '../components/SendMessageDialog';
import { ReceiveMessagesDialog } from '../components/ReceiveMessagesDialog';

export function QueueDetailPage() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [queue, setQueue] = useState<QueueItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const detail = await api.getQueueDetail(name);
      setQueue(detail);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  const isFifo = queue?.attributes.FifoQueue === 'true';

  const handlePurge = async () => {
    if (!queue) return;
    setActionLoading(true);
    try {
      await api.purgeQueue(queue.url);
      toast('success', 'Queue purged');
      setPurgeOpen(false);
      await load();
    } catch (err) {
      toast('error', 'Purge failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!queue) return;
    setActionLoading(true);
    try {
      await api.deleteQueue(queue.url);
      toast('success', 'Queue deleted', `${queue.name} removed.`);
      navigate('/');
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="table-wrap">
          <SkeletonRows rows={5} />
        </div>
      </div>
    );
  }

  if (error || !queue) {
    return (
      <div className="page">
        <div className="breadcrumbs">
          <Link to="/">Queues</Link>
        </div>
        <div className="card">
          <ErrorState message={error || 'Queue not found'} onRetry={() => void load()} />
        </div>
      </div>
    );
  }

  const attrs = queue.attributes;
  const redrive = parseRedrivePolicy(attrs.RedrivePolicy);

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/">Queues</Link>
        <span className="sep">›</span>
        <span>{queue.name}</span>
      </div>

      <div className="card detail-header-card">
        <div style={{ minWidth: 0 }}>
          <div className="detail-title-row">
            <h1 className="detail-name">{queue.name}</h1>
            {isFifo ? <Badge tone="fifo">FIFO</Badge> : <Badge>Standard</Badge>}
            {redrive && <Badge tone="dlq">DLQ configured</Badge>}
          </div>
          <div className="detail-meta">
            <span>
              ARN: <span className="mono">{queue.arn ?? '—'}</span>
            </span>
            <span>
              URL: <span className="mono">{queue.url}</span>
            </span>
          </div>
        </div>
        <div className="page-actions">
          <Button variant="primary" onClick={() => setSendOpen(true)}>
            <Mail size={15} />
            Send message
          </Button>
          <Button variant="secondary" onClick={() => setReceiveOpen(true)}>
            <PackageSearch size={15} />
            Receive messages
          </Button>
          <IconButton title="Purge queue" onClick={() => setPurgeOpen(true)}>
            <Eraser size={16} />
          </IconButton>
          <IconButton className="danger" title="Delete queue" onClick={() => setDeleteOpen(true)}>
            <Trash2 size={16} />
          </IconButton>
        </div>
      </div>

      <div className="stats-row">
        <StatCard icon={<Inbox size={17} />} label="Messages available" value={formatNumber(attrs.ApproximateNumberOfMessages)} />
        <StatCard icon={<ArrowLeftRight size={17} />} label="Messages in flight" value={formatNumber(attrs.ApproximateNumberOfMessagesNotVisible)} />
        <StatCard icon={<Clock size={17} />} label="Messages delayed" value={formatNumber(attrs.ApproximateNumberOfMessagesDelayed)} />
        <StatCard
          icon={<MessageSquareText size={17} />}
          label="Visibility timeout"
          value={formatSeconds(attrInt(attrs, 'VisibilityTimeout', 30))}
        />
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview', icon: <Layers size={14} /> },
          { id: 'configuration', label: 'Configuration', icon: <CloudCog size={14} /> },
          { id: 'permissions', label: 'Permissions', icon: <ShieldCheck size={14} /> },
          { id: 'tags', label: 'Tags', icon: <TagsIcon size={14} /> },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'overview' && <OverviewTab queue={queue} />}
      {activeTab === 'configuration' && <ConfigurationTab queue={queue} onSaved={() => void load()} />}
      {activeTab === 'permissions' && <PermissionsTab queue={queue} onSaved={() => void load()} />}
      {activeTab === 'tags' && <TagsTab queue={queue} />}

      {sendOpen && (
        <SendMessageDialog
          open={sendOpen}
          queueUrl={queue.url}
          queueName={queue.name}
          isFifo={isFifo}
          contentBasedDedup={attrs.ContentBasedDeduplication === 'true'}
          onClose={() => setSendOpen(false)}
        />
      )}

      {receiveOpen && (
        <ReceiveMessagesDialog open={receiveOpen} queueUrl={queue.url} queueName={queue.name} onClose={() => setReceiveOpen(false)} onChanged={() => void load()} />
      )}

      <ConfirmDialog
        open={purgeOpen}
        title="Purge queue?"
        message={<>Delete all messages in <strong>{queue.name}</strong>? This cannot be undone.</>}
        confirmLabel="Purge"
        loading={actionLoading}
        onConfirm={() => void handlePurge()}
        onClose={() => setPurgeOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete queue?"
        message={<>Permanently delete <strong>{queue.name}</strong> and all of its messages? This cannot be undone.</>}
        confirmLabel="Delete queue"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-icon">{icon}</div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ overview

function OverviewTab({ queue }: { queue: QueueItem }) {
  const attrs = queue.attributes;
  const redrive = parseRedrivePolicy(attrs.RedrivePolicy);

  const rows: Array<[string, ReactNode, boolean?]> = [
    ['Queue ARN', <span key="a" className="mono">{queue.arn}</span>, true],
    ['Queue URL', <span key="u" className="mono">{queue.url}</span>, true],
    ['Type', queue.attributes.FifoQueue === 'true' ? 'FIFO' : 'Standard'],
    ['Created', formatTimestamp(attrs.CreatedTimestamp)],
    ['Last modified', formatTimestamp(attrs.LastModifiedTimestamp)],
    ['Visibility timeout', formatSeconds(attrInt(attrs, 'VisibilityTimeout', 30))],
    ['Message retention period', formatSeconds(attrInt(attrs, 'MessageRetentionPeriod', 345600))],
    ['Delivery delay', formatSeconds(attrInt(attrs, 'DelaySeconds', 0))],
    ['Maximum message size', formatBytes(attrInt(attrs, 'MaximumMessageSize', 262144))],
    ['Receive message wait time', formatSeconds(attrInt(attrs, 'ReceiveMessageWaitTimeSeconds', 0))],
    ['Approximate messages available', formatNumber(attrs.ApproximateNumberOfMessages)],
    ['Approximate messages in flight', formatNumber(attrs.ApproximateNumberOfMessagesNotVisible)],
    ['Approximate messages delayed', formatNumber(attrs.ApproximateNumberOfMessagesDelayed)],
    ['Approximate oldest message age', formatSeconds(Number(attrs.ApproximateOldestMessageAge ?? 0))],
    [
      'Dead-letter queue (redrive policy)',
      redrive ? (
        <span>
          Messages go to <strong>{queueNameFromArn(redrive.dlqArn)}</strong> after {redrive.maxReceiveCount} receive attempts.
        </span>
      ) : (
        'Not configured'
      ),
    ],
    ['Content-based deduplication', attrs.ContentBasedDeduplication === 'true' ? 'Enabled' : 'Disabled'],
    ['Deduplication scope', attrs.DeduplicationScope ?? '—'],
    ['FIFO throughput limit', attrs.FifoThroughputLimit ? `${attrs.FifoThroughputLimit} msg/s` : '—'],
    ['SQS managed SSE', attrs.SqsManagedSseEnabled === 'true' ? 'Enabled' : 'Disabled'],
    ['AWS KMS CMK', attrs.KmsMasterKeyId === 'alias/aws/sqs' ? 'AWS managed key' : (attrs.KmsMasterKeyId ?? '—')],
  ];

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <h3 className="card-title">Queue details</h3>
        <p className="card-subtitle">Read-only overview of the queue configuration.</p>
      </div>
      <dl className="kv-grid">
        {rows.map(([label, value, mono]) => (
          <KeyValue key={label} label={label} mono={mono}>
            {value}
          </KeyValue>
        ))}
      </dl>
    </div>
  );
}

// ------------------------------------------------------------- configuration

interface ConfigForm {
  visibilityTimeout: string;
  retention: string;
  delay: string;
  maxSize: string;
  waitTime: string;
  contentBasedDedup: boolean;
  useRedrive: boolean;
  redriveDlqArn: string;
  redriveMaxReceiveCount: string;
  redriveAllowPolicy: string;
}

function ConfigurationTab({ queue, onSaved }: { queue: QueueItem; onSaved: () => void }) {
  const { toast } = useToast();
  const attrs = queue.attributes;
  const isFifo = attrs.FifoQueue === 'true';
  const currentRedrive = parseRedrivePolicy(attrs.RedrivePolicy);

  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [form, setForm] = useState<ConfigForm>(() => buildForm(attrs, currentRedrive));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState(false);

  // `attrs` is a stable object reference between renders, so this only runs when
  // the queue detail is (re)loaded after a save.
  useEffect(() => {
    setForm(buildForm(attrs, parseRedrivePolicy(attrs.RedrivePolicy)));
    setSavedMsg(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrs]);

  useEffect(() => {
    void api
      .listQueues()
      .then((res) => setQueues(res.queues))
      .catch(() => setQueues([]));
  }, []);

  const set = <K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedMsg(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const attributes: Record<string, string> = {
        VisibilityTimeout: String(Number(form.visibilityTimeout) || 30),
        MessageRetentionPeriod: String(Number(form.retention) || 345600),
        DelaySeconds: String(Number(form.delay) || 0),
        MaximumMessageSize: String(Number(form.maxSize) || 262144),
        ReceiveMessageWaitTimeSeconds: String(Number(form.waitTime) || 0),
      };
      if (isFifo) {
        attributes.ContentBasedDeduplication = form.contentBasedDedup ? 'true' : 'false';
      }
      if (form.useRedrive) {
        if (!form.redriveDlqArn) {
          setError('Select a dead-letter queue.');
          setSaving(false);
          return;
        }
        attributes.RedrivePolicy = JSON.stringify({
          deadLetterTargetArn: form.redriveDlqArn,
          maxReceiveCount: String(Number(form.redriveMaxReceiveCount) || 1),
        });
      } else {
        attributes.RedrivePolicy = '';
      }
      if (form.redriveAllowPolicy.trim()) {
        attributes.RedriveAllowPolicy = form.redriveAllowPolicy.trim();
      } else {
        attributes.RedriveAllowPolicy = '';
      }

      await api.setQueueAttributes(queue.url, attributes);
      toast('success', 'Configuration saved');
      setSavedMsg(true);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const dlqOptions = useMemo(() => queues.filter((q) => q.url !== queue.url), [queues, queue.url]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {savedMsg && <div className="inline-info">Configuration saved successfully.</div>}
      {error && <div className="inline-error">{error}</div>}

      <div className="card card-pad">
        <h3 className="card-title">General configuration</h3>
        <p className="card-subtitle" style={{ marginBottom: 16 }}>
          Change how this queue handles messages.
        </p>
        <div className="form-grid">
          <Field label="Visibility timeout (seconds)" hint="1 – 43,200. How long a received message stays hidden from other consumers.">
            <NumberInput min={0} max={43200} value={form.visibilityTimeout} onChange={(e) => set('visibilityTimeout', e.target.value)} />
          </Field>
          <Field label="Message retention period (seconds)" hint="60 – 1,209,600 (14 days). How long a message stays in the queue.">
            <NumberInput min={60} max={1209600} value={form.retention} onChange={(e) => set('retention', e.target.value)} />
          </Field>
          <Field label="Delivery delay (seconds)" hint="0 – 900 (15 min).">
            <NumberInput min={0} max={900} value={form.delay} onChange={(e) => set('delay', e.target.value)} />
          </Field>
          <Field label="Maximum message size (bytes)" hint="1,024 – 262,144 (256 KB).">
            <NumberInput min={1024} max={262144} value={form.maxSize} onChange={(e) => set('maxSize', e.target.value)} />
          </Field>
          <Field label="Receive message wait time (seconds)" hint="0 – 20. Enables long polling.">
            <NumberInput min={0} max={20} value={form.waitTime} onChange={(e) => set('waitTime', e.target.value)} />
          </Field>
          {isFifo && (
            <Field label="Content-based deduplication" hint="Derive the deduplication ID from the message body.">
              <div className="toggle-wrap" style={{ marginTop: 6 }}>
                <Toggle checked={form.contentBasedDedup} onChange={(v) => set('contentBasedDedup', v)} />
              </div>
            </Field>
          )}
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="card-title">Dead-letter queue (redrive policy)</h3>
        <p className="card-subtitle" style={{ marginBottom: 14 }}>
          After a message is received a certain number of times, move it to a dead-letter queue.
        </p>

        <Field label="Use redrive policy" layout="horizontal">
          <div className="toggle-wrap" style={{ marginTop: 2 }}>
            <Toggle checked={form.useRedrive} onChange={(v) => set('useRedrive', v)} />
          </div>
        </Field>

        {form.useRedrive && (
          <div className="redrive-box">
            <Field label="Dead-letter queue" hint="Queue to send failed messages to.">
              <Select value={form.redriveDlqArn} onChange={(e) => set('redriveDlqArn', e.target.value)}>
                <option value="">Select a queue…</option>
                {dlqOptions.map((q) => (
                  <option key={q.arn ?? q.url} value={q.arn ?? q.url}>
                    {q.name} {q.arn ? `(${q.arn})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Maximum receive count" hint="Messages received this many times are moved to the DLQ.">
              <NumberInput min={1} max={1000} value={form.redriveMaxReceiveCount} onChange={(e) => set('redriveMaxReceiveCount', e.target.value)} />
            </Field>
            {currentRedrive && (
              <div className="muted" style={{ fontSize: 12.5 }}>
                Currently: DLQ <strong>{queueNameFromArn(currentRedrive.dlqArn)}</strong>, max receive count {currentRedrive.maxReceiveCount}.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card card-pad">
        <h3 className="card-title">Redrive allow policy</h3>
        <p className="card-subtitle" style={{ marginBottom: 14 }}>
          Controls which source queues can use this queue as their dead-letter queue. JSON policy or empty for default (all queues).
        </p>
        <Field label="Redrive allow policy" hint={'Leave empty to allow any queue. JSON policy like {"redrivePermission":"allowAll"}.'}>
          <Textarea
            rows={3}
            value={form.redriveAllowPolicy}
            onChange={(e) => set('redriveAllowPolicy', e.target.value)}
            placeholder={'{"redrivePermission": "allowAll"}'}
            spellCheck={false}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
          Save configuration
        </Button>
      </div>
    </div>
  );
}

function buildForm(attrs: Record<string, string>, redrive: ReturnType<typeof parseRedrivePolicy>): ConfigForm {
  return {
    visibilityTimeout: String(attrInt(attrs, 'VisibilityTimeout', 30)),
    retention: String(attrInt(attrs, 'MessageRetentionPeriod', 345600)),
    delay: String(attrInt(attrs, 'DelaySeconds', 0)),
    maxSize: String(attrInt(attrs, 'MaximumMessageSize', 262144)),
    waitTime: String(attrInt(attrs, 'ReceiveMessageWaitTimeSeconds', 0)),
    contentBasedDedup: attrs.ContentBasedDeduplication === 'true',
    useRedrive: !!redrive,
    redriveDlqArn: redrive?.dlqArn ?? '',
    redriveMaxReceiveCount: redrive ? String(redrive.maxReceiveCount) : '3',
    redriveAllowPolicy: attrs.RedriveAllowPolicy ?? '',
  };
}

// -------------------------------------------------------------- permissions

function PermissionsTab({ queue, onSaved }: { queue: QueueItem; onSaved: () => void }) {
  const { toast } = useToast();
  const [policy, setPolicy] = useState(prettyJson(queue.attributes.Policy));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPolicy(prettyJson(queue.attributes.Policy));
  }, [queue.attributes.Policy]);

  const handleSave = async (remove: boolean) => {
    setSaving(true);
    setError('');
    try {
      const value = remove ? '' : policy;
      if (!remove) {
        JSON.parse(value); // validate
      }
      await api.setQueueAttributes(queue.url, { Policy: value });
      toast('success', remove ? 'Access policy removed' : 'Access policy saved');
      onSaved();
    } catch (err) {
      setError(err instanceof SyntaxError ? 'Invalid JSON in access policy.' : errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-pad">
      <h3 className="card-title">Access policy</h3>
      <p className="card-subtitle" style={{ marginBottom: 14 }}>
        A resource-based JSON policy controlling who can perform actions on this queue. Leave empty to remove the policy.
      </p>
      {error && <div className="inline-error">{error}</div>}
      {!queue.attributes.Policy && <div className="inline-info">No access policy is currently set on this queue.</div>}
      <Field label="Policy document">
        <Textarea
          rows={12}
          value={policy}
          onChange={(e) => setPolicy(e.target.value)}
          placeholder={'{\n  "Version": "2012-10-17",\n  "Statement": []\n}'}
          spellCheck={false}
        />
      </Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        {queue.attributes.Policy && (
          <Button variant="ghost" onClick={() => void handleSave(true)} loading={saving}>
            Remove policy
          </Button>
        )}
        <Button variant="primary" onClick={() => void handleSave(false)} loading={saving}>
          Save policy
        </Button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- tags

function TagsTab({ queue }: { queue: QueueItem }) {
  const { toast } = useToast();
  const [tags, setTags] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadTags = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getTags(queue.url);
      setTags(res.tags);
    } catch {
      setTags({});
    } finally {
      setLoading(false);
    }
  }, [queue.url]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  const handleAdd = async () => {
    if (!key.trim()) return;
    setAdding(true);
    try {
      await api.setTags(queue.url, { [key.trim()]: value });
      toast('success', 'Tag added', key.trim());
      setKey('');
      setValue('');
      await loadTags();
    } catch (err) {
      toast('error', 'Failed to add tag', errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (tagKey: string) => {
    setDeleting(tagKey);
    try {
      await api.untag(queue.url, [tagKey]);
      await loadTags();
    } catch (err) {
      toast('error', 'Failed to remove tag', errorMessage(err));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="card card-pad">
      <h3 className="card-title">Tags</h3>
      <p className="card-subtitle" style={{ marginBottom: 16 }}>
        Metadata attached to this queue for organisation and billing.
      </p>

      <div className="form-grid" style={{ marginBottom: 16 }}>
        <Field label="Tag key">
          <TextInput value={key} onChange={(e) => setKey(e.target.value)} placeholder="environment" spellCheck={false} />
        </Field>
        <Field label="Tag value">
          <div style={{ display: 'flex', gap: 8 }}>
            <TextInput value={value} onChange={(e) => setValue(e.target.value)} placeholder="production" spellCheck={false} />
            <Button variant="primary" onClick={() => void handleAdd()} disabled={!key.trim()} loading={adding}>
              Add
            </Button>
          </div>
        </Field>
      </div>

      {loading && <Spinner label="Loading tags…" />}

      {!loading && Object.keys(tags).length === 0 && (
        <EmptyState icon={<TagsIcon size={26} />} title="No tags" description="Add a tag above to organise this queue." />
      )}

      {!loading && Object.keys(tags).length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(tags).map(([k, v]) => (
                <tr key={k}>
                  <td className="mono">{k}</td>
                  <td className="mono">{v}</td>
                  <td>
                    <IconButton className="danger" loading={deleting === k} onClick={() => void handleDelete(k)} title="Remove tag">
                      <Trash2 size={15} />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
