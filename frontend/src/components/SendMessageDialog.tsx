import { useState, type FormEvent } from 'react';
import { Info, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { errorMessage, useToast } from '../lib/context';
import { Button, Field, IconButton, Modal, NumberInput, Select, Textarea, TextInput } from './ui';

interface MessageAttrRow {
  key: string;
  dataType: string;
  value: string;
}

interface Props {
  open: boolean;
  queueUrl: string;
  queueName: string;
  isFifo: boolean;
  contentBasedDedup: boolean;
  onClose: () => void;
  onSent?: () => void;
}

export function SendMessageDialog({ open, queueUrl, queueName, isFifo, contentBasedDedup, onClose, onSent }: Props) {
  const { toast } = useToast();
  const [body, setBody] = useState('');
  const [delay, setDelay] = useState(0);
  const [groupId, setGroupId] = useState('');
  const [dedupId, setDedupId] = useState('');
  const [attrs, setAttrs] = useState<MessageAttrRow[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const reset = () => {
    setBody('');
    setDelay(0);
    setGroupId('');
    setDedupId('');
    setAttrs([]);
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const needsDedupId = isFifo && !contentBasedDedup;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim() || sending) return;
    if (needsDedupId && !dedupId.trim()) {
      setError('A message deduplication ID is required for FIFO queues without content-based deduplication.');
      return;
    }
    if (isFifo && !groupId.trim()) {
      setError('A message group ID is required for FIFO queues.');
      return;
    }

    setSending(true);
    setError('');
    try {
      const messageAttributes: Record<string, { dataType: string; stringValue: string }> = {};
      for (const a of attrs) {
        if (!a.key.trim()) continue;
        messageAttributes[a.key.trim()] = { dataType: a.dataType || 'String', stringValue: a.value };
      }

      const result = await api.sendMessage({
        queueUrl,
        body,
        delaySeconds: delay > 0 ? delay : undefined,
        messageGroupId: groupId.trim() || undefined,
        messageDeduplicationId: dedupId.trim() || undefined,
        messageAttributes: Object.keys(messageAttributes).length ? messageAttributes : undefined,
      });

      toast('success', 'Message sent', `Message ID ${result.messageId}`);
      reset();
      onSent?.();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const updateAttr = (i: number, patch: Partial<MessageAttrRow>) => {
    setAttrs((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };

  return (
    <Modal
      open={open}
      title="Send message"
      subtitle={`To queue ${queueName}`}
      onClose={handleClose}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!body.trim() || sending} loading={sending}>
            Send message
          </Button>
        </>
      }
    >
      {isFifo && (
        <div className="inline-info">
          <Info size={16} />
          <span>
            FIFO queue — a message group ID is required{contentBasedDedup ? '; deduplication is content-based.' : ', and a deduplication ID is required.'}
          </span>
        </div>
      )}

      <Field label="Message body" hint="The payload delivered to consumers. JSON, text or binary.">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder='{"hello": "world"}'
          spellCheck={false}
        />
      </Field>

      <div className="form-grid">
        {isFifo && (
          <>
            <Field label="Message group ID" hint="Required for FIFO queues.">
              <TextInput value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="group-1" spellCheck={false} />
            </Field>
            <Field label="Message deduplication ID" hint={contentBasedDedup ? 'Optional — content-based deduplication is enabled.' : 'Required for FIFO queues.'}>
              <TextInput value={dedupId} onChange={(e) => setDedupId(e.target.value)} placeholder="msg-001" spellCheck={false} disabled={contentBasedDedup} />
            </Field>
          </>
        )}
        {!isFifo && (
          <Field label="Delay (seconds)" hint="0 – 900. Deliver after this many seconds.">
            <NumberInput min={0} max={900} value={delay} onChange={(e) => setDelay(Number(e.target.value))} />
          </Field>
        )}
      </div>

      <Field label="Message attributes" hint="Optional custom metadata sent alongside the message.">
        <div className="attr-list">
          {attrs.map((a, i) => (
            <div key={i} className="attr-row">
              <TextInput value={a.key} onChange={(e) => updateAttr(i, { key: e.target.value })} placeholder="Attribute name" spellCheck={false} />
              <Select value={a.dataType} onChange={(e) => updateAttr(i, { dataType: e.target.value })}>
                <option value="String">String</option>
                <option value="Number">Number</option>
              </Select>
              <TextInput value={a.value} onChange={(e) => updateAttr(i, { value: e.target.value })} placeholder="Value" spellCheck={false} />
              <IconButton className="danger" onClick={() => setAttrs((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove attribute">
                <Trash2 size={15} />
              </IconButton>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setAttrs((prev) => [...prev, { key: '', dataType: 'String', value: '' }])}>
            <Plus size={14} />
            Add attribute
          </Button>
        </div>
      </Field>

      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}
