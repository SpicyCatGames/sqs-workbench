import { useState, type FormEvent } from 'react';
import { Info } from 'lucide-react';
import { api } from '../lib/api';
import { errorMessage } from '../lib/context';
import { Button, Field, Modal, NumberInput, TextInput, Toggle } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const DEFAULTS = {
  visibilityTimeout: 30,
  messageRetentionPeriod: 345600,
  delaySeconds: 0,
  maximumMessageSize: 262144,
  receiveMessageWaitTimeSeconds: 0,
};

export function CreateQueueDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [fifo, setFifo] = useState(false);
  const [contentBasedDedup, setContentBasedDedup] = useState(true);
  const [visibilityTimeout, setVisibilityTimeout] = useState(DEFAULTS.visibilityTimeout);
  const [retention, setRetention] = useState(DEFAULTS.messageRetentionPeriod);
  const [delay, setDelay] = useState(DEFAULTS.delaySeconds);
  const [maxSize, setMaxSize] = useState(DEFAULTS.maximumMessageSize);
  const [waitTime, setWaitTime] = useState(DEFAULTS.receiveMessageWaitTimeSeconds);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const fifoOk = !fifo || name.trim().toLowerCase().endsWith('.fifo');
  const submitDisabled = !name.trim() || !fifoOk || saving;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitDisabled) return;
    setSaving(true);
    setError('');
    try {
      await api.createQueue({
        name: name.trim(),
        fifo,
        contentBasedDeduplication: fifo ? contentBasedDedup : undefined,
        visibilityTimeout,
        messageRetentionPeriod: retention,
        delaySeconds: delay,
        maximumMessageSize: maxSize,
        receiveMessageWaitTimeSeconds: waitTime,
      });
      onCreated();
      onClose();
      setName('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Create queue"
      subtitle="A new queue is created on the configured SQS endpoint."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitDisabled} loading={saving}>
            Create queue
          </Button>
        </>
      }
    >
      <Field
        label="Queue name"
        hint={fifo ? 'FIFO queue names must end with the .fifo suffix.' : 'Standard queue names cannot end with .fifo.'}
        error={name && !fifoOk ? (fifo ? 'FIFO queue names must end with .fifo.' : 'Standard queue names cannot end with .fifo.') : undefined}
      >
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={fifo ? 'my-queue.fifo' : 'my-queue'}
          spellCheck={false}
        />
      </Field>

      <Field label="Type" hint="FIFO queues preserve strict ordering and exactly-once processing." layout="horizontal">
        <div className="toggle-wrap" style={{ marginTop: 2 }}>
          <Toggle checked={fifo} onChange={setFifo} label="FIFO queue" />
        </div>
      </Field>

      {fifo && (
        <div className="inline-info" style={{ marginTop: -6 }}>
          <Info size={16} />
          <span>
            FIFO queues require a name ending in <code>.fifo</code>. Messages need a message group ID, and a deduplication
            ID unless content-based deduplication is enabled.
          </span>
        </div>
      )}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setAdvanced((v) => !v)}
        style={{ marginBottom: 12 }}
      >
        {advanced ? 'Hide' : 'Show'} configuration
      </button>

      {advanced && (
        <div className="form-grid">
          <Field label="Visibility timeout (seconds)" hint="1 – 43,200. How long a message stays hidden after being received.">
            <NumberInput min={0} max={43200} value={visibilityTimeout} onChange={(e) => setVisibilityTimeout(Number(e.target.value))} />
          </Field>
          <Field label="Message retention period (seconds)" hint="60 – 1,209,600 (14 days).">
            <NumberInput min={60} max={1209600} value={retention} onChange={(e) => setRetention(Number(e.target.value))} />
          </Field>
          <Field label="Delivery delay (seconds)" hint="0 – 900 (15 min).">
            <NumberInput min={0} max={900} value={delay} onChange={(e) => setDelay(Number(e.target.value))} />
          </Field>
          <Field label="Maximum message size (bytes)" hint="1,024 – 262,144 (256 KB).">
            <NumberInput min={1024} max={262144} value={maxSize} onChange={(e) => setMaxSize(Number(e.target.value))} />
          </Field>
          <Field label="Receive message wait time (seconds)" hint="0 – 20. Enables long polling.">
            <NumberInput min={0} max={20} value={waitTime} onChange={(e) => setWaitTime(Number(e.target.value))} />
          </Field>
          {fifo && (
            <Field label="Content-based deduplication" hint="Generates a deduplication ID from the message body.">
              <div className="toggle-wrap" style={{ marginTop: 6 }}>
                <Toggle checked={contentBasedDedup} onChange={setContentBasedDedup} />
              </div>
            </Field>
          )}
        </div>
      )}

      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}
