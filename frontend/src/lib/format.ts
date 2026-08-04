/** Format a number of seconds into a compact human string (e.g. 345600 -> 4 days). */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const minutes = seconds / 60;
  if (minutes < 60) return trim(minutes) + ' min';
  const hours = minutes / 60;
  if (hours < 24) return trim(hours) + ' hours';
  const days = hours / 24;
  return trim(days) + ' days';
}

function trim(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Format a byte count (e.g. 262144 -> 256 KB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${trim(kb / 1024)} MB`;
}

/** Format a unix timestamp (seconds) into a local date-time string. */
export function formatTimestamp(epochSeconds: string | number | undefined | null): string {
  if (epochSeconds === undefined || epochSeconds === null || epochSeconds === '') return '—';
  const secs = typeof epochSeconds === 'string' ? Number(epochSeconds) : epochSeconds;
  if (Number.isNaN(secs) || secs <= 0) return '—';
  return new Date(secs * 1000).toLocaleString();
}

/** Format a large number with thousands separators. */
export function formatNumber(n: string | number | undefined | null): string {
  if (n === undefined || n === null || n === '') return '—';
  const num = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(num)) return String(n);
  return num.toLocaleString();
}

/** Parse a queue attribute to an int, falling back to a default. */
export function attrInt(attributes: Record<string, string>, key: string, fallback: number): number {
  const raw = attributes[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isNaN(n) ? fallback : n;
}

/** Pretty-print JSON if the string is valid JSON, otherwise return as-is. */
export function prettyJson(value: string | undefined | null): string {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/** Parse a RedrivePolicy JSON string into its parts. */
export function parseRedrivePolicy(policy: string | undefined | null): { dlqArn: string; maxReceiveCount: number } | null {
  if (!policy) return null;
  try {
    const parsed = JSON.parse(policy) as { deadLetterTargetArn?: string; maxReceiveCount?: string | number };
    if (!parsed.deadLetterTargetArn) return null;
    return {
      dlqArn: parsed.deadLetterTargetArn,
      maxReceiveCount: Number(parsed.maxReceiveCount ?? 0),
    };
  } catch {
    return null;
  }
}

/** Extract the queue name from a queue ARN. */
export function queueNameFromArn(arn: string): string {
  return arn.split(':').pop() ?? arn;
}

/** Extract the queue name from a queue URL. */
export function queueNameFromUrl(url: string): string {
  return url.replace(/\/+$/, '').split('/').pop() ?? url;
}
