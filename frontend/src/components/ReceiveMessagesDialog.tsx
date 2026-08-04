import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Download, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { errorMessage, useToast } from '../lib/context';
import { formatNumber } from '../lib/format';
import type { ReceivedMessage } from '../lib/types';
import { Button, Field, Modal, NumberInput, Spinner } from './ui';

interface Props {
  open: boolean;
  queueUrl: string;
  queueName: string;
  onClose: () => void;
  onChanged: () => void;
}

export function ReceiveMessagesDialog({ open, queueUrl, queueName, onClose, onChanged }: Props) {
  const { toast } = useToast();
  const [max, setMax] = useState(10);
  const [visibility, setVisibility] = useState(30);
  const [waitTime, setWaitTime] = useState(0);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ReceivedMessage[]>([]);
  const [receivedCount, setReceivedCount] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const receive = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.receiveMessages({
        queueUrl,
        maxNumberOfMessages: max,
        visibilityTimeout: visibility,
        waitTimeSeconds: waitTime,
      });
      setMessages(res.messages);
      setReceivedCount(res.messages.length);
      if (res.messages.length === 0) {
        toast('info', 'No messages available', 'The queue is currently empty.');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (m: ReceivedMessage) => {
    setDeleting(m.receiptHandle);
    try {
      await api.deleteMessage(queueUrl, m.receiptHandle);
      setMessages((prev) => prev.filter((x) => x.receiptHandle !== m.receiptHandle));
      toast('success', 'Message deleted', m.messageId);
      onChanged();
    } catch (err) {
      toast('error', 'Failed to delete message', errorMessage(err));
    } finally {
      setDeleting(null);
    }
  };

  const close = () => {
    setMessages([]);
    setReceivedCount(0);
    setError('');
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Receive messages"
      subtitle={`From queue ${queueName}`}
      onClose={close}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
          <Button variant="primary" onClick={receive} loading={loading}>
            <Download size={15} />
            Receive messages
          </Button>
        </>
      }
    >
      <div className="form-grid" style={{ marginBottom: 8 }}>
        <Field label="Max number of messages" hint="1 – 10.">
          <NumberInput min={1} max={10} value={max} onChange={(e) => setMax(Number(e.target.value))} />
        </Field>
        <Field label="Visibility timeout (seconds)" hint="How long received messages stay hidden.">
          <NumberInput min={0} max={43200} value={visibility} onChange={(e) => setVisibility(Number(e.target.value))} />
        </Field>
        <Field label="Wait time (seconds)" hint="0 – 20. Long polling for empty queues.">
          <NumberInput min={0} max={20} value={waitTime} onChange={(e) => setWaitTime(Number(e.target.value))} />
        </Field>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 0 10px' }}>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {receivedCount > 0 ? `${receivedCount} message${receivedCount === 1 ? '' : 's'} received` : 'No messages received yet'}
        </span>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={receive}>
            <RefreshCw size={13} />
            Receive more
          </Button>
        )}
      </div>

      {loading && <Spinner label="Receiving messages…" />}

      {!loading && messages.length > 0 && (
        <div className="attr-list">
          {messages.map((m) => {
            const isOpen = !!expanded[m.messageId];
            return (
              <div key={m.receiptHandle} className="card" style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setExpanded((prev) => ({ ...prev, [m.messageId]: !isOpen }))}
                        aria-label={isOpen ? 'Collapse' : 'Expand'}
                      >
                        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                      <span className="mono" style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                        {m.messageId}
                      </span>
                      {m.attributes.ApproximateReceiveCount && (
                        <span className="badge badge-warn">receive count {formatNumber(m.attributes.ApproximateReceiveCount)}</span>
                      )}
                    </div>
                    <div className="msg-body-preview">{m.body}</div>
                    {isOpen && (
                      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                        {Object.entries(m.attributes).map(([k, v]) => (
                          <div key={k} className="muted mono" style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span>{k}</span>
                            <span style={{ color: 'var(--text)' }}>{v}</span>
                          </div>
                        ))}
                        {Object.entries(m.messageAttributes).map(([k, v]) => (
                          <div key={k} className="muted mono" style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span>{k} (attr)</span>
                            <span style={{ color: 'var(--text)' }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={deleting === m.receiptHandle}
                    onClick={() => handleDelete(m)}
                    title="Delete (acknowledge) this message"
                  >
                    <Check size={14} />
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && messages.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Button variant="ghost" size="sm" onClick={() => { void (async () => {
            for (const m of [...messages]) await handleDelete(m);
          })(); }}>
            <Trash2 size={13} />
            Delete all received
          </Button>
        </div>
      )}
    </Modal>
  );
}
