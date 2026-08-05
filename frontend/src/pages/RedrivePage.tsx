import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Gauge, Loader2, Redo2, Square, Target } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { errorMessage, useToast } from '../lib/context';
import { formatNumber, queueNameFromUrl } from '../lib/format';
import type { QueueItem, RedriveJob, RedriveStatus } from '../lib/types';
import { Badge, Button, ErrorState, Field, NumberInput, Select, SkeletonRows } from '../components/ui';

/**
 * Start message redrive: move every message from this queue to its source queue
 * (when it is a dead-letter queue) or to a custom destination, with an optional
 * velocity cap. Mirrors the AWS console "Start message redrive" wizard.
 */
export function RedrivePage() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [queue, setQueue] = useState<QueueItem | null>(null);
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [sources, setSources] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [destination, setDestination] = useState<'source' | 'custom'>('custom');
  const [sourceQueueUrl, setSourceQueueUrl] = useState('');
  const [customQueueUrl, setCustomQueueUrl] = useState('');
  const [velocity, setVelocity] = useState<'system' | 'custom'>('system');
  const [msgPerSecond, setMsgPerSecond] = useState('10');

  const [job, setJob] = useState<RedriveJob | null>(null);
  const [status, setStatus] = useState<RedriveStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [startError, setStartError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const detail = await api.getQueueDetail(name);
      const [list, src] = await Promise.all([
        api.listQueues(),
        api.getRedriveSources(detail.url).catch(() => ({ sources: [] as QueueItem[] })),
      ]);
      setQueue(detail);
      setQueues(list.queues);
      setSources(src.sources);
      if (src.sources.length > 0) {
        setSourceQueueUrl(src.sources[0].url);
        setDestination('source');
      } else {
        setDestination('custom');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  const customOptions = useMemo(() => queues.filter((q) => q.url !== queue?.url), [queues, queue]);

  const destinationUrl = destination === 'source' ? sourceQueueUrl : customQueueUrl;
  const destinationName =
    destination === 'source'
      ? sources.find((s) => s.url === sourceQueueUrl)?.name ?? ''
      : customOptions.find((q) => q.url === customQueueUrl)?.name ?? '';

  const running = !!job && (status?.status ?? 'running') === 'running';
  const progressPct = status && status.total > 0 ? Math.min(100, Math.round((status.moved / status.total) * 100)) : 0;

  // Poll the job while it is running.
  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    let timer = 0;

    const tick = async () => {
      try {
        const s = await api.getRedriveStatus(job.jobId);
        if (cancelled) return;
        setStatus(s);
        if (s.status !== 'running') {
          window.clearInterval(timer);
          if (s.status === 'completed') {
            toast('success', 'Redrive completed', `${formatNumber(s.moved)} message${s.moved === 1 ? '' : 's'} moved.`);
          } else if (s.status === 'failed') {
            toast('error', 'Redrive failed', s.error ?? undefined);
          } else if (s.status === 'stopped') {
            toast('info', 'Redrive stopped', `${formatNumber(s.moved)} message${s.moved === 1 ? '' : 's'} moved before stopping.`);
          }
        }
      } catch {
        /* transient poll error — keep polling */
      }
    };

    void tick();
    timer = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job, toast]);

  const handleStart = async () => {
    if (!queue) return;
    setStartError('');

    if (!destinationUrl) {
      setStartError(destination === 'source' ? 'No source queue available. Choose a custom destination instead.' : 'Select a destination queue.');
      return;
    }
    if (destinationUrl === queue.url) {
      setStartError('The destination must be a different queue.');
      return;
    }

    const perSecond = velocity === 'custom' ? Number(msgPerSecond) : 0;
    if (velocity === 'custom' && (!Number.isFinite(perSecond) || perSecond < 1 || perSecond > 500)) {
      setStartError('Message per second must be between 1 and 500.');
      return;
    }

    setStarting(true);
    try {
      const res = await api.startRedrive({
        sourceQueueUrl: queue.url,
        destinationQueueUrl: destinationUrl,
        maxMessagesPerSecond: perSecond,
      });
      setJob(res);
      setStatus(null);
    } catch (err) {
      setStartError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!job) return;
    setStopping(true);
    try {
      await api.stopRedrive(job.jobId);
    } catch (err) {
      toast('error', 'Failed to stop redrive', errorMessage(err));
    } finally {
      setStopping(false);
    }
  };

  const reset = () => {
    setJob(null);
    setStatus(null);
    setStartError('');
  };

  if (loading) {
    return (
      <div className="page">
        <div className="table-wrap">
          <SkeletonRows rows={4} />
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

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/">Queues</Link>
        <span className="sep">›</span>
        <Link to={`/queues/${encodeURIComponent(queue.name)}`}>{queue.name}</Link>
        <span className="sep">›</span>
        <span>Start redrive</span>
      </div>

      <div className="card detail-header-card">
        <div style={{ minWidth: 0 }}>
          <div className="detail-title-row">
            <h1 className="detail-name">Start message redrive</h1>
            <Badge tone="warn">DLQ</Badge>
          </div>
          <div className="detail-meta">
            <span>
              Move all messages from <strong>{queue.name}</strong> to another queue — typically back to its source queue.
            </span>
            <span>
              URL: <span className="mono">{queue.url}</span>
            </span>
          </div>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => navigate(`/queues/${encodeURIComponent(queue.name)}`)}>
            Back to queue
          </Button>
        </div>
      </div>

      {!job && (
        <>
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <div className="card-title-row">
              <Target size={16} className="text-info" />
              <h3 className="card-title" style={{ marginBottom: 0 }}>
                Message destination
              </h3>
            </div>
            <p className="card-subtitle" style={{ marginBottom: 14 }}>
              Choose where the messages in this queue are sent.
            </p>

            <div className="radio-group">
              <RadioCard
                checked={destination === 'source'}
                disabled={sources.length === 0}
                title="Redrive to source queue"
                description={
                  sources.length > 0
                    ? `Send messages back to the queue${sources.length > 1 ? 's' : ''} that uses this queue as its dead-letter queue.`
                    : 'No source queue found — this queue is not configured as the dead-letter queue of another queue.'
                }
                onClick={() => setDestination('source')}
              >
                {sources.length > 0 && destination === 'source' && (
                  <div style={{ marginTop: 4, maxWidth: 420 }}>
                    <Select value={sourceQueueUrl} onChange={(e) => setSourceQueueUrl(e.target.value)}>
                      {sources.map((s) => (
                        <option key={s.url} value={s.url}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </RadioCard>

              <RadioCard
                checked={destination === 'custom'}
                title="Redrive to custom destination"
                description="Send messages to any other queue on this endpoint."
                onClick={() => setDestination('custom')}
              >
                {destination === 'custom' && (
                  <div style={{ marginTop: 4, maxWidth: 420 }}>
                    <Select value={customQueueUrl} onChange={(e) => setCustomQueueUrl(e.target.value)}>
                      <option value="">Select a queue…</option>
                      {customOptions.map((q) => (
                        <option key={q.url} value={q.url}>
                          {q.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </RadioCard>
            </div>
          </div>

          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <div className="card-title-row">
              <Gauge size={16} className="text-info" />
              <h3 className="card-title" style={{ marginBottom: 0 }}>
                Velocity control
              </h3>
            </div>
            <p className="card-subtitle" style={{ marginBottom: 14 }}>
              Limit how fast messages are moved, or let the system run as fast as possible.
            </p>

            <div className="radio-group">
              <RadioCard
                checked={velocity === 'system'}
                title="System optimized"
                description="Move messages as fast as possible with no throttling."
                onClick={() => setVelocity('system')}
              />
              <RadioCard
                checked={velocity === 'custom'}
                title="Custom max velocity"
                description="Cap the redrive at a fixed number of messages per second."
                onClick={() => setVelocity('custom')}
              >
                {velocity === 'custom' && (
                  <div style={{ marginTop: 4, maxWidth: 220 }}>
                    <Field label="Message per second" hint="1 – 500.">
                      <NumberInput min={1} max={500} value={msgPerSecond} onChange={(e) => setMsgPerSecond(e.target.value)} />
                    </Field>
                  </div>
                )}
              </RadioCard>
            </div>
          </div>

          {startError && <div className="inline-error">{startError}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="secondary" onClick={() => navigate(`/queues/${encodeURIComponent(queue.name)}`)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleStart()}
              loading={starting}
              disabled={!destinationUrl || !queue.url}
            >
              <Redo2 size={15} />
              Start redrive
            </Button>
          </div>
        </>
      )}

      {job && status && (
        <div className="card card-pad">
          <div className="card-title-row">
            <h3 className="card-title" style={{ marginBottom: 0 }}>
              {running ? 'Redrive in progress' : `Redrive ${status.status}`}
            </h3>
            <StatusBadge status={status.status} />
            <Badge>{status.mode === 'managed' ? 'Managed by SQS' : 'Manual (emulator-compatible)'}</Badge>
          </div>

          <div className="redrive-box" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
              <span className="mono" style={{ fontWeight: 600 }}>
                {queue.name}
              </span>
              <ArrowRight size={14} className="muted" />
              <span className="mono" style={{ fontWeight: 600 }}>
                {destinationName || queueNameFromUrl(destinationUrl)}
              </span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                · {velocity === 'system' ? 'System optimized' : `Max ${msgPerSecond} msg/s`}
              </span>
            </div>
          </div>

          <div className="stats-row" style={{ marginTop: 16, marginBottom: 0 }}>
            <MiniStat label="Messages moved" value={formatNumber(status.moved)} />
            <MiniStat label="Total to move" value={status.total > 0 ? formatNumber(status.total) : '—'} />
            <MiniStat label="Failed" value={formatNumber(status.failed)} tone={status.failed > 0 ? 'bad' : undefined} />
          </div>

          {status.total > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="progress-track">
                <div
                  className={cn('progress-fill', status.status === 'completed' && 'ok', status.status === 'failed' && 'bad')}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {progressPct}% complete
              </div>
            </div>
          )}

          {status.status === 'failed' && status.error && <div className="inline-error" style={{ marginTop: 14 }}>{status.error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            {running && (
              <Button variant="danger" onClick={() => void handleStop()} loading={stopping}>
                <Square size={13} />
                Stop redrive
              </Button>
            )}
            {!running && (
              <>
                <Button variant="secondary" onClick={reset}>
                  Start another redrive
                </Button>
                <Link to={`/queues/${encodeURIComponent(queue.name)}`} className="btn btn-primary btn-md">
                  Back to queue
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- sub-components

function RadioCard({
  checked,
  disabled,
  title,
  description,
  onClick,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  description?: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className={cn('radio-card', checked && 'radio-card-on', disabled && 'radio-card-disabled')}
      onClick={() => !disabled && onClick()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <span className="radio-dot" />
      <span className="radio-body">
        <span className="radio-title">{title}</span>
        {description && <span className="radio-desc">{description}</span>}
        {children}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: RedriveStatus['status'] }) {
  switch (status) {
    case 'running':
      return (
        <Badge tone="warn">
          <Loader2 className="spin" size={12} />
          Running
        </Badge>
      );
    case 'completed':
      return <Badge tone="success">Completed</Badge>;
    case 'stopped':
      return <Badge tone="warn">Stopped</Badge>;
    case 'failed':
      return <Badge tone="dlq">Failed</Badge>;
  }
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="stat">
      <div>
        <div className={cn('stat-value', tone === 'bad' && 'text-danger')}>{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}
