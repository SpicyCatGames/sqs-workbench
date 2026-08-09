import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/ui';
import { errorMessage } from '../../lib/context';

// --------------------------------------------------------------------- hook

/** Standard load/error/loading state machine used by the Lambda pages. */
export function useReload(loader: () => Promise<void>, deps: unknown[] = []) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  return { loading, error, load };
}

// ------------------------------------------------------------------- dates

/** Format an ISO timestamp (the format Lambda's LastModified uses). */
export function formatIso(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// ------------------------------------------------------------------ badges

export function RuntimeBadge({ runtime }: { runtime: string }) {
  if (runtime.startsWith('nodejs')) return <Badge tone="fifo">{runtime}</Badge>;
  if (runtime.startsWith('python')) return <Badge tone="success">{runtime}</Badge>;
  return <Badge>{runtime || '—'}</Badge>;
}

export function ArchitectureBadge({ architectures }: { architectures?: string[] }) {
  const arch = architectures?.join(', ') ?? 'x86_64';
  return <Badge tone="warn">{arch}</Badge>;
}

export function FunctionStateBadge({ state }: { state?: string }) {
  if (!state) return null;
  if (state === 'Active') return <Badge tone="success">Active</Badge>;
  if (state === 'Pending') return <Badge tone="warn">Pending</Badge>;
  if (state === 'Failed') return <Badge tone="dlq">Failed</Badge>;
  return <Badge>{state}</Badge>;
}

// ----------------------------------------------------------- arn helpers

/** Short label for an event source ARN, e.g. the SQS queue or DynamoDB table name. */
export function eventSourceLabel(arn: string): string {
  const service = arn.split(':')[2] ?? '';
  const resource = arn.split(':').pop() ?? arn;
  const name = resource.includes('/') ? resource.split('/').pop() ?? resource : resource;
  switch (service) {
    case 'sqs':
      return `SQS · ${name}`;
    case 'sns':
      return `SNS · ${name}`;
    case 's3':
      return `S3 · ${name}`;
    case 'dynamodb':
      return `DynamoDB · ${name}`;
    case 'kinesis':
      return `Kinesis · ${name}`;
    case 'events':
      return `EventBridge · ${name}`;
    default:
      return name;
  }
}
