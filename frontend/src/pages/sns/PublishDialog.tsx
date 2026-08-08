import { useState, type ReactNode } from 'react';
import { Info, Plus, Send, Trash2 } from 'lucide-react';
import { snsApi, type PublishResult } from '../../lib/snsApi';
import { errorMessage } from '../../lib/context';
import { Button, Field, Modal, Select, Textarea, TextInput } from '../../components/ui';
import { CopyButton } from './SnsUi';

// ------------------------------------------------------------------ types

export interface MessageAttrRow {
  id: number;
  key: string;
  dataType: string;
  value: string;
}

interface PublishFormProps {
  topicArn: string;
  isFifo?: boolean;
  contentBasedDedup?: boolean;
  onPublished?: (result: PublishResult) => void;
}

let attrId = 0;

function buildAttributes(rows: MessageAttrRow[]): Record<string, { dataType: string; stringValue: string }> {
  const out: Record<string, { dataType: string; stringValue: string }> = {};
  for (const row of rows) {
    if (!row.key.trim()) continue;
    out[row.key.trim()] = { dataType: row.dataType || 'String', stringValue: row.value };
  }
  return out;
}

export function PublishForm({ topicArn, isFifo, contentBasedDedup, onPublished }: PublishFormProps) {
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [attrs, setAttrs] = useState<MessageAttrRow[]>([]);
  const [groupId, setGroupId] = useState('');
  const [dedupId, setDedupId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PublishResult | null>(null);

  const addAttr = () => {
    setAttrs((prev) => [...prev, { id: ++attrId, key: '', dataType: 'String', value: '' }]);
  };
  const updateAttr = (id: number, patch: Partial<MessageAttrRow>) => {
    setAttrs((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeAttr = (id: number) => {
    setAttrs((prev) => prev.filter((r) => r.id !== id));
  };

  const handlePublish = async () => {
    setSaving(true);
    setError('');
    setResult(null);
    try {
      const messageAttributes = buildAttributes(attrs);
      const res = await snsApi.publish({
        topicArn,
        message,
        subject: subject.trim() || undefined,
        messageAttributes: Object.keys(messageAttributes).length > 0 ? messageAttributes : undefined,
        messageGroupId: groupId.trim() || undefined,
        messageDeduplicationId: dedupId.trim() || undefined,
      });
      setResult(res);
      onPublished?.(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const canPublish = message.trim().length > 0 && !saving;

  return (
    <div className="publish-form">
      {isFifo && (
        <div className="inline-info" style={{ marginTop: 0 }}>
          <Info size={16} />
          <span>
            This is a FIFO topic. Messages are delivered in order. A message group ID is required;{' '}
            {contentBasedDedup ? 'content-based deduplication is enabled, so a deduplication ID is optional.' : 'provide a deduplication ID (or enable content-based deduplication on the topic).'}
          </span>
        </div>
      )}

      <Field label="Message body" hint="The message to deliver to every subscription.">
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Enter your message…" />
      </Field>

      <Field label="Subject" hint="Optional. Used for email protocol subscriptions.">
        <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Optional subject line" />
      </Field>

      {isFifo && (
        <div className="form-grid">
          <Field label="Message group ID" hint="Required for FIFO topics.">
            <TextInput value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="my-group" spellCheck={false} />
          </Field>
          <Field label="Message deduplication ID" hint={contentBasedDedup ? 'Optional — content-based deduplication is enabled.' : 'Required unless content-based deduplication is on.'}>
            <TextInput value={dedupId} onChange={(e) => setDedupId(e.target.value)} placeholder="my-dedup-id" spellCheck={false} />
          </Field>
        </div>
      )}

      <div style={{ margin: '4px 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="field-label" style={{ fontSize: 13.5 }}>Message attributes</span>
        <Button variant="ghost" size="sm" onClick={addAttr} type="button">
          <Plus size={13} />
          Add attribute
        </Button>
      </div>

      {attrs.length > 0 && (
        <div className="attr-list" style={{ marginBottom: 12 }}>
          {attrs.map((row) => (
            <div key={row.id} className="attr-row">
              <TextInput
                value={row.key}
                onChange={(e) => updateAttr(row.id, { key: e.target.value })}
                placeholder="Attribute name"
                spellCheck={false}
              />
              <Select value={row.dataType} onChange={(e) => updateAttr(row.id, { dataType: e.target.value })}>
                <option value="String">String</option>
                <option value="Number">Number</option>
                <option value="Binary">Binary</option>
              </Select>
              <TextInput
                value={row.value}
                onChange={(e) => updateAttr(row.id, { value: e.target.value })}
                placeholder="Attribute value"
                spellCheck={false}
              />
              <IconButtonSmall onClick={() => removeAttr(row.id)} title="Remove attribute">
                <Trash2 size={14} />
              </IconButtonSmall>
            </div>
          ))}
        </div>
      )}

      {error && <div className="inline-error">{error}</div>}

      {result && (
        <div className="inline-info" style={{ marginBottom: 0 }}>
          <Info size={16} />
          <span style={{ flex: 1 }}>
            Message published successfully.
            <div className="mono" style={{ marginTop: 4 }}>
              Message ID: {result.messageId}
              {result.sequenceNumber ? ` · Sequence number: ${result.sequenceNumber}` : ''}
            </div>
          </span>
          <CopyButton text={result.messageId} />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="primary" onClick={() => void handlePublish()} disabled={!canPublish} loading={saving}>
          <Send size={14} />
          Publish message
        </Button>
      </div>
    </div>
  );
}

function IconButtonSmall({ children, onClick, title }: { children: ReactNode; onClick: () => void; title: string }) {
  return (
    <button type="button" className="icon-btn" title={title} onClick={onClick}>
      {children}
    </button>
  );
}

interface PublishDialogProps extends PublishFormProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
}

export function PublishDialog({ open, title, subtitle, onClose, ...formProps }: PublishDialogProps) {
  return (
    <Modal open={open} title={title} subtitle={subtitle} onClose={onClose} wide>
      <PublishForm {...formProps} />
    </Modal>
  );
}
