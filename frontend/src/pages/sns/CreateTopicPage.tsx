import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, Info, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { snsApi } from '../../lib/snsApi';
import { errorMessage, useToast } from '../../lib/context';
import { Button, Field, TextInput, Toggle } from '../../components/ui';
import { DeliveryPolicyForm } from './SnsUi';

interface TagRow {
  id: number;
  key: string;
  value: string;
}

let tagId = 0;

export function CreateTopicPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [type, setType] = useState<'standard' | 'fifo'>('standard');
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [contentBasedDedup, setContentBasedDedup] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [deliveryPolicy, setDeliveryPolicy] = useState('');
  const [tags, setTags] = useState<TagRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fifo = type === 'fifo';
  const fifoOk = !fifo || name.trim().toLowerCase().endsWith('.fifo');
  const canCreate = name.trim().length > 0 && fifoOk && !saving;

  const addTag = () => setTags((prev) => [...prev, { id: ++tagId, key: '', value: '' }]);
  const updateTag = (id: number, patch: Partial<TagRow>) => setTags((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const removeTag = (id: number) => setTags((prev) => prev.filter((t) => t.id !== id));

  const handleCreate = async () => {
    setSaving(true);
    setError('');
    try {
      const { arn } = await snsApi.createTopic({
        name: name.trim(),
        fifo,
        displayName: fifo ? undefined : displayName.trim() || undefined,
        contentBasedDeduplication: fifo ? contentBasedDedup : undefined,
      });
      const warnings: string[] = [];
      const tagEntries = tags
        .filter((t) => t.key.trim())
        .map((t) => ({ key: t.key.trim(), value: t.value }));
      if (tagEntries.length > 0) {
        try {
          await snsApi.tagTopic(arn, Object.fromEntries(tagEntries.map((t) => [t.key, t.value])));
        } catch {
          warnings.push('tags');
        }
      }
      if (deliveryPolicy) {
        try {
          await snsApi.setTopicAttribute(arn, 'DeliveryPolicy', deliveryPolicy);
        } catch {
          warnings.push('delivery policy');
        }
      }
      toast('success', 'Topic created', warnings.length > 0 ? `Note: ${warnings.join(' and ')} could not be applied on this endpoint.` : name.trim());
      navigate(`/sns/topics/${encodeURIComponent(arn)}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/sns">SNS</Link>
        <span className="sep">/</span>
        <Link to="/sns">Topics</Link>
        <span className="sep">/</span>
        <span>Create topic</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Create topic</h1>
          <p className="page-description">Topics are communication channels to which you can publish messages.</p>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <section className="card card-pad sns-section">
        <h2 className="card-title">Details</h2>
        <p className="card-subtitle" style={{ marginBottom: 16 }}>A topic provides an access point for publishers and subscribers to communicate with each other.</p>

        <Field label="Type" hint="FIFO topics preserve strict message ordering and exactly-once delivery." layout="horizontal">
          <div className="radio-group">
            <button
              type="button"
              className={cn('radio-card', type === 'standard' && 'radio-card-on')}
              onClick={() => setType('standard')}
            >
              <span className="radio-dot" />
              <span className="radio-body">
                <span className="radio-title">Standard</span>
                <span className="radio-desc">
                  Topic that optimizes for throughput, cost-efficiency and at-least-once delivery. Messages can be delivered out of order and duplicates are possible.
                </span>
              </span>
            </button>
            <button
              type="button"
              className={cn('radio-card', type === 'fifo' && 'radio-card-on')}
              onClick={() => setType('fifo')}
            >
              <span className="radio-dot" />
              <span className="radio-body">
                <span className="radio-title">FIFO</span>
                <span className="radio-desc">
                  Topic that optimizes for strict message ordering and exactly-once delivery. Topic name must end in <code>.fifo</code> and throughput is limited.
                </span>
              </span>
            </button>
          </div>
        </Field>

        <Field
          label="Name"
          hint={fifo ? 'FIFO topic names must end with the .fifo suffix.' : 'Topic names can contain alphanumeric characters, hyphens and underscores.'}
          error={name && !fifoOk ? (fifo ? 'FIFO topic names must end with .fifo.' : 'Standard topic names cannot end with .fifo.') : undefined}
        >
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={fifo ? 'my-topic.fifo' : 'my-topic'}
            spellCheck={false}
          />
        </Field>

        {fifo ? (
          <div className="inline-info" style={{ marginBottom: 0 }}>
            <Info size={16} />
            <span>
              Display names are not supported for FIFO topics. {contentBasedDedup ? 'Content-based deduplication is enabled.' : 'Content-based deduplication is disabled.'}
            </span>
          </div>
        ) : (
          <Field label="Display name - optional" hint="The name shown in email notifications from this topic (up to 100 characters).">
            <TextInput
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="My Notifications"
              maxLength={100}
            />
          </Field>
        )}

        {fifo && (
          <Field label="Content-based deduplication" hint="Generates a deduplication ID from the message body, so you don't have to provide one.">
            <div className="toggle-wrap" style={{ marginTop: 6 }}>
              <Toggle checked={contentBasedDedup} onChange={setContentBasedDedup} />
            </div>
          </Field>
        )}
      </section>

      <section className="card card-pad sns-section">
        <button type="button" className="btn btn-ghost btn-sm sns-collapse-btn" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Advanced settings
        </button>
        {advanced && (
          <div style={{ marginTop: 14 }}>
            <h3 className="card-title" style={{ fontSize: 14 }}>Delivery status logging</h3>
            <p className="card-subtitle" style={{ marginBottom: 12 }}>Log delivery statuses to CloudWatch for messages published to this topic.</p>
            <DeliveryPolicyForm policy={deliveryPolicy} onChange={setDeliveryPolicy} />
          </div>
        )}
      </section>

      <section className="card card-pad sns-section">
        <div className="card-title-row" style={{ marginBottom: 4 }}>
          <h2 className="card-title">Tags</h2>
          <Button variant="ghost" size="sm" onClick={addTag} type="button">
            <Plus size={13} />
            Add tag
          </Button>
        </div>
        <p className="card-subtitle" style={{ marginBottom: 14 }}>Tag the topic to organize and identify it (up to 50 tags).</p>

        {tags.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No tags added.</p>}

        {tags.length > 0 && (
          <div className="tag-editor">
            {tags.map((t) => (
              <div key={t.id} className="tag-row">
                <TextInput value={t.key} onChange={(e) => updateTag(t.id, { key: e.target.value })} placeholder="Key" spellCheck={false} />
                <TextInput value={t.value} onChange={(e) => updateTag(t.id, { value: e.target.value })} placeholder="Value (optional)" spellCheck={false} />
                <button type="button" className="icon-btn" title="Remove tag" onClick={() => removeTag(t.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <Button variant="secondary" onClick={() => navigate('/sns')}>
          <ArrowLeft size={14} />
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void handleCreate()} disabled={!canCreate} loading={saving}>
          Create topic
        </Button>
      </div>
    </div>
  );
}
