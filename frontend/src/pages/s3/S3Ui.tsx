import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/ui';
import { errorMessage } from '../../lib/context';
import type { S3ObjectInfo, S3VersionItem } from '../../lib/s3Api';

// --------------------------------------------------------------------- hook

/** Standard load/error/loading state machine used by the S3 pages. */
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

// ----------------------------------------------------------------- regions

export const AWS_REGIONS: Array<{ value: string; label: string }> = [
  { value: 'us-east-1', label: 'US East (N. Virginia) · us-east-1' },
  { value: 'us-east-2', label: 'US East (Ohio) · us-east-2' },
  { value: 'us-west-1', label: 'US West (N. California) · us-west-1' },
  { value: 'us-west-2', label: 'US West (Oregon) · us-west-2' },
  { value: 'af-south-1', label: 'Africa (Cape Town) · af-south-1' },
  { value: 'ap-east-1', label: 'Asia Pacific (Hong Kong) · ap-east-1' },
  { value: 'ap-south-1', label: 'Asia Pacific (Mumbai) · ap-south-1' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo) · ap-northeast-1' },
  { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul) · ap-northeast-2' },
  { value: 'ap-northeast-3', label: 'Asia Pacific (Osaka) · ap-northeast-3' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore) · ap-southeast-1' },
  { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney) · ap-southeast-2' },
  { value: 'ap-southeast-3', label: 'Asia Pacific (Jakarta) · ap-southeast-3' },
  { value: 'ca-central-1', label: 'Canada (Central) · ca-central-1' },
  { value: 'eu-central-1', label: 'Europe (Frankfurt) · eu-central-1' },
  { value: 'eu-west-1', label: 'Europe (Ireland) · eu-west-1' },
  { value: 'eu-west-2', label: 'Europe (London) · eu-west-2' },
  { value: 'eu-west-3', label: 'Europe (Paris) · eu-west-3' },
  { value: 'eu-south-1', label: 'Europe (Milan) · eu-south-1' },
  { value: 'eu-north-1', label: 'Europe (Stockholm) · eu-north-1' },
  { value: 'me-south-1', label: 'Middle East (Bahrain) · me-south-1' },
  { value: 'sa-east-1', label: 'South America (São Paulo) · sa-east-1' },
];

export function regionLabel(value: string): string {
  return AWS_REGIONS.find((r) => r.value === value)?.label ?? value;
}

// ------------------------------------------------------------------ badges

export function VersioningBadge({ status }: { status?: 'Enabled' | 'Suspended' }) {
  if (status === 'Enabled') return <Badge tone="success">Versioning enabled</Badge>;
  if (status === 'Suspended') return <Badge tone="warn">Versioning suspended</Badge>;
  return <Badge>Versioning off</Badge>;
}

export function StorageClassBadge({ storageClass }: { storageClass?: string }) {
  const sc = storageClass || 'STANDARD';
  if (sc === 'STANDARD') return <Badge>Standard</Badge>;
  return <Badge tone="fifo">{sc.replace(/_/g, ' ')}</Badge>;
}

// ------------------------------------------------------------ preview kinds

export type PreviewKind = 'text' | 'json' | 'image' | 'none';

const TEXT_EXT = /\.(txt|log|md|xml|html?|css|js|mjs|ts|tsx|json|yaml|yml|csv|ini|conf|sh|py|java|c|h|cpp|sql|env|gitignore|dockerfile)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;

/** Decide what kind of preview an object supports based on key + content type. */
export function previewKind(key: string, contentType?: string): PreviewKind {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.startsWith('image/') || IMAGE_EXT.test(key)) return 'image';
  if (ct === 'application/json' || /\.json$/i.test(key)) return 'json';
  if (ct.startsWith('text/') || TEXT_EXT.test(key) || ct.includes('json') || ct.includes('xml') || ct.includes('yaml')) return 'text';
  return 'none';
}

/** A short human label for a storage class. */
export function storageClassLabel(sc?: string): string {
  return (sc ?? 'STANDARD').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build an S3ObjectInfo from a version entry so version rows share the object actions. */
export function versionToObject(v: S3VersionItem): S3ObjectInfo {
  return {
    key: v.key,
    size: v.size,
    lastModified: v.lastModified,
    etag: v.etag,
    storageClass: v.storageClass,
    isFolder: false,
  };
}

/** Small helper for conditional class merging. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
