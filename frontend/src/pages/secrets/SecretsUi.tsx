import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/ui';
import { errorMessage } from '../../lib/context';

// --------------------------------------------------------------------- hook

/** Standard load/error/loading state machine used by the Secrets Manager pages. */
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

// ------------------------------------------------------------------ badges

export function RotationBadge({ enabled }: { enabled?: boolean }) {
  if (enabled) return <Badge tone="success">Rotation enabled</Badge>;
  return <Badge>Rotation off</Badge>;
}

export function DeletedBadge({ deletedDate }: { deletedDate?: string }) {
  if (!deletedDate) return null;
  return (
    <Badge tone="dlq">
      Deleted · restores {new Date(deletedDate).toLocaleDateString()}
    </Badge>
  );
}

// ------------------------------------------------------------ secret values

export interface KeyValuePair {
  key: string;
  value: string;
  type: string;
}

/**
 * Parse a secret string for display. When it is a flat JSON object of scalar
 * values, return it as key/value pairs; otherwise return plaintext.
 */
export function parseSecretString(secretString: string): { pairs: KeyValuePair[]; plaintext: string } {
  try {
    const parsed = JSON.parse(secretString) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const pairs = Object.entries(parsed as Record<string, unknown>).map(([key, raw]) => ({
        key,
        value: raw === null ? 'null' : typeof raw === 'string' ? raw : JSON.stringify(raw),
        type: raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw,
      }));
      return { pairs, plaintext: '' };
    }
  } catch {
    /* not JSON — fall through to plaintext */
  }
  return { pairs: [], plaintext: secretString };
}

/**
 * Serialize key/value pairs back into JSON. Scalar types (numbers, booleans,
 * null) and nested JSON values are preserved so editing a secret like
 * {"port": 5432} does not turn the number into the string "5432".
 */
export function stringifyPairs(pairs: Array<{ key: string; value: string }>): string {
  const obj: Record<string, unknown> = {};
  for (const p of pairs) {
    if (!p.key.trim()) continue;
    const value = p.value.trim();
    try {
      const parsed = JSON.parse(value) as unknown;
      // Keep unambiguous typed values as their type; keep everything else a string.
      if (parsed === null || typeof parsed !== 'string') {
        obj[p.key.trim()] = parsed;
      } else {
        obj[p.key.trim()] = value;
      }
    } catch {
      obj[p.key.trim()] = value;
    }
  }
  return JSON.stringify(obj, null, 2);
}

/** Format an ISO date for display. */
export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
