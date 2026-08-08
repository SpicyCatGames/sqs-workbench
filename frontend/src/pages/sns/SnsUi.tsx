import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Info } from 'lucide-react';
import { Badge, Field, TextInput } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/context';
import { prettyJson } from '../../lib/format';

// --------------------------------------------------------------------- hook

/** Standard load/error/loading state machine used by the list pages. */
export function useReload(loader: () => Promise<void>, deps: unknown[] = []) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Keep the latest loader in a ref so `load` (and the initial effect) are
  // stable even when callers pass inline closures.
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await loaderRef.current();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // `deps` re-triggers the initial load when route params (e.g. a topic ARN)
  // change without the component being remounted.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  return { loading, error, load };
}

// -------------------------------------------------------------- protocols

export const PROTOCOL_OPTIONS = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'email', label: 'Email' },
  { value: 'email-json', label: 'Email (JSON)' },
  { value: 'sms', label: 'Short Message Service (SMS)' },
  { value: 'sqs', label: 'Amazon SQS' },
  { value: 'lambda', label: 'AWS Lambda' },
  { value: 'firehose', label: 'Amazon Data Firehose' },
  { value: 'application', label: 'Mobile push (platform application)' },
  { value: 'platform-application-endpoint', label: 'Platform application endpoint' },
];

export function protocolLabel(protocol: string): string {
  return PROTOCOL_OPTIONS.find((p) => p.value === protocol)?.label ?? protocol;
}

// ----------------------------------------------------------------- badges

export function TopicTypeBadge({ attributes }: { attributes: Record<string, string> }) {
  return attributes.FifoTopic === 'true' ? <Badge tone="fifo">FIFO</Badge> : <Badge>Standard</Badge>;
}

export type SubscriptionStatus = 'pending' | 'confirmed' | 'deleted';

export function subscriptionStatus(subscriptionArn: string | null): SubscriptionStatus {
  if (!subscriptionArn) return 'pending';
  // Real AWS returns the literal string "pending confirmation" as the ARN of
  // subscriptions that haven't been confirmed yet (e.g. email / HTTP endpoints).
  if (subscriptionArn === 'pending confirmation' || subscriptionArn.toLowerCase().includes('pending')) return 'pending';
  if (subscriptionArn.includes(':Deleted')) return 'deleted';
  return 'confirmed';
}

export function SubscriptionStatusBadge({ subscriptionArn }: { subscriptionArn: string | null }) {
  const status = subscriptionStatus(subscriptionArn);
  if (status === 'pending') return <Badge tone="warn">Pending</Badge>;
  if (status === 'deleted') return <Badge tone="dlq">Deleted</Badge>;
  return <Badge tone="success">Confirmed</Badge>;
}

// ------------------------------------------------------------------ copy

export function CopyButton({ text, size = 13 }: { text: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn copy-btn"
      title={copied ? 'Copied' : 'Copy'}
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

export function ArnText({ arn, className }: { arn: string | null | undefined; className?: string }) {
  if (!arn) return <span className="muted">—</span>;
  return (
    <span className={cn('arn-text', className)}>
      <span className="arn-text-value">{arn}</span>
      <CopyButton text={arn} size={12} />
    </span>
  );
}

export function EndpointCell({ protocol, endpoint }: { protocol: string; endpoint: string }) {
  return (
    <div className="endpoint-cell">
      {protocol === 'sqs' && <div className="endpoint-name">{endpoint.split(':').pop() ?? endpoint}</div>}
      <div className="endpoint-sub mono">{endpoint}</div>
    </div>
  );
}

// ------------------------------------------------------- delivery policy

export interface DeliveryProtocolConfig {
  successFeedbackRoleArn: string;
  failureFeedbackRoleArn: string;
  successFeedbackSampleRate: string;
}

export const DELIVERY_PROTOCOLS: Array<{ key: string; label: string }> = [
  { key: 'http', label: 'HTTP' },
  { key: 'https', label: 'HTTPS' },
  { key: 'lambda', label: 'AWS Lambda' },
  { key: 'sqs', label: 'Amazon SQS' },
  { key: 'firehose', label: 'Amazon Data Firehose' },
];

function parseDeliveryPolicy(policy: string): Record<string, DeliveryProtocolConfig | undefined> {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(policy || '{}') as Record<string, unknown>;
  } catch {
    /* fall through with empty config */
  }
  const out: Record<string, DeliveryProtocolConfig | undefined> = {};
  for (const p of DELIVERY_PROTOCOLS) {
    const raw = parsed[p.key] as Partial<DeliveryProtocolConfig> | undefined;
    out[p.key] = raw
      ? {
          successFeedbackRoleArn: String(raw.successFeedbackRoleArn ?? ''),
          failureFeedbackRoleArn: String(raw.failureFeedbackRoleArn ?? ''),
          successFeedbackSampleRate: String(raw.successFeedbackSampleRate ?? ''),
        }
      : undefined;
  }
  return out;
}

export function formatDeliveryPolicy(policy: string | undefined | null): string {
  if (!policy) return '';
  return prettyJson(policy);
}

interface DeliveryPolicyFormProps {
  policy: string;
  onChange: (json: string) => void;
}

/** Compact per-protocol delivery status logging editor backed by a DeliveryPolicy JSON. */
export function DeliveryPolicyForm({ policy, onChange }: DeliveryPolicyFormProps) {
  const [protocols, setProtocols] = useState<Record<string, DeliveryProtocolConfig | undefined>>(() =>
    parseDeliveryPolicy(policy),
  );

  useEffect(() => {
    setProtocols(parseDeliveryPolicy(policy));
  }, [policy]);

  const update = (key: string, config: DeliveryProtocolConfig | undefined) => {
    const next = { ...protocols, [key]: config };
    setProtocols(next);
    const out: Record<string, Record<string, string>> = {};
    for (const p of DELIVERY_PROTOCOLS) {
      const cfg = next[p.key];
      if (!cfg) continue;
      const entry: Record<string, string> = {};
      if (cfg.successFeedbackRoleArn.trim()) entry.successFeedbackRoleArn = cfg.successFeedbackRoleArn.trim();
      if (cfg.failureFeedbackRoleArn.trim()) entry.failureFeedbackRoleArn = cfg.failureFeedbackRoleArn.trim();
      if (cfg.successFeedbackSampleRate !== '') entry.successFeedbackSampleRate = cfg.successFeedbackSampleRate;
      if (Object.keys(entry).length > 0) out[p.key] = entry;
    }
    onChange(Object.keys(out).length > 0 ? JSON.stringify(out, null, 2) : '');
  };

  return (
    <div className="delivery-policy-form">
      <p className="field-hint" style={{ marginTop: 0 }}>
        Log the delivery status of messages to Amazon CloudWatch for each protocol. Configure an IAM role that Amazon SNS can assume
        to write logs, and a sample rate between 0 and 100.
      </p>
      {DELIVERY_PROTOCOLS.map((p) => {
        const cfg = protocols[p.key];
        return (
          <div key={p.key} className="delivery-protocol-row">
            <div className="delivery-protocol-head">
              <span className="delivery-protocol-name">{p.label}</span>
              <button
                type="button"
                className={cn('toggle', cfg && 'toggle-on')}
                role="switch"
                aria-checked={!!cfg}
                onClick={() => update(p.key, cfg ? undefined : { successFeedbackRoleArn: '', failureFeedbackRoleArn: '', successFeedbackSampleRate: '100' })}
              >
                <span className="toggle-knob" />
              </button>
            </div>
            {cfg && (
              <div className="delivery-protocol-fields">
                <Field label="Success feedback role ARN">
                  <TextInput
                    value={cfg.successFeedbackRoleArn}
                    onChange={(e) => update(p.key, { ...cfg, successFeedbackRoleArn: e.target.value })}
                    placeholder="arn:aws:iam::000000000000:role/sns-success"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Failure feedback role ARN">
                  <TextInput
                    value={cfg.failureFeedbackRoleArn}
                    onChange={(e) => update(p.key, { ...cfg, failureFeedbackRoleArn: e.target.value })}
                    placeholder="arn:aws:iam::000000000000:role/sns-failure"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Sample rate (%)" hint="0 – 100">
                  <TextInput
                    type="number"
                    min={0}
                    max={100}
                    value={cfg.successFeedbackSampleRate}
                    onChange={(e) => update(p.key, { ...cfg, successFeedbackSampleRate: e.target.value })}
                  />
                </Field>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------- unsupported

export function UnsupportedBanner({ children }: { children: ReactNode }) {
  return (
    <div className="inline-info unsupported-banner">
      <Info size={16} />
      <span>{children}</span>
    </div>
  );
}
