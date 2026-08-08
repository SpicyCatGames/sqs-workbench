import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/ui';
import { errorMessage } from '../../lib/context';
import { attributeValueToPlain, type AttributeScalarType, type DynamoKeySchemaItem, type DynamoTable } from '../../lib/dynamoApi';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';

// --------------------------------------------------------------------- hook

/** Standard load/error/loading state machine used by the list pages. */
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

// -------------------------------------------------------------------- keys

export function partitionKeyOf(table: DynamoTable): DynamoKeySchemaItem | null {
  return table.keySchema.find((k) => k.keyType === 'HASH') ?? null;
}

export function sortKeyOf(table: DynamoTable): DynamoKeySchemaItem | null {
  return table.keySchema.find((k) => k.keyType === 'RANGE') ?? null;
}

/** Extract the primary-key attributes of an item (used as row ids and deletes). */
export function primaryKeyOfItem(table: DynamoTable, item: Record<string, AttributeValue>): Record<string, AttributeValue> {
  const key: Record<string, AttributeValue> = {};
  for (const k of table.keySchema) {
    const v = item[k.attributeName];
    if (v) key[k.attributeName] = v;
  }
  return key;
}

/** A stable string id for an item within a table. */
export function itemKeyString(table: DynamoTable, item: Record<string, AttributeValue>): string {
  const key = primaryKeyOfItem(table, item);
  return Object.keys(key).length > 0 ? JSON.stringify(key) : JSON.stringify(item);
}

// ------------------------------------------------------------ JSON helpers

/** Pretty-print an item as DynamoDB JSON (typed attribute values, base64 strings for binary). */
export function dynamoJsonOf(item: Record<string, AttributeValue>): string {
  return JSON.stringify(item, (_key, value) => (value instanceof Uint8Array ? arrayToBase64(value) : value), 2);
}

/** Convert an item into plain JSON (binary becomes a $binary object). */
export function itemToPlain(item: Record<string, AttributeValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, attributeValueToPlain(v)]));
}

function arrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// ----------------------------------------------------------------- badges

export function CapacityModeBadge({ mode }: { mode: string | null }) {
  if (mode === 'PAY_PER_REQUEST') return <Badge tone="success">On-demand</Badge>;
  return <Badge>Provisioned</Badge>;
}

export function TableStatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge>—</Badge>;
  if (status === 'ACTIVE') return <Badge tone="success">Active</Badge>;
  if (status === 'CREATING' || status === 'UPDATING') return <Badge tone="warn">Creating / updating</Badge>;
  if (status === 'DELETING') return <Badge tone="dlq">Deleting</Badge>;
  return <Badge tone="warn">{status}</Badge>;
}

export function TableClassBadge({ tableClass }: { tableClass: string | null }) {
  if (tableClass === 'STANDARD_INFREQUENT_ACCESS') return <Badge tone="fifo">Standard-IA</Badge>;
  return <Badge>Standard</Badge>;
}

export function IndexStatusBadge({ status }: { status: string | null }) {
  if (status === 'ACTIVE') return <Badge tone="success">Active</Badge>;
  if (status === 'CREATING' || status === 'UPDATING' || status === 'DELETING') return <Badge tone="warn">{status}</Badge>;
  return <Badge>—</Badge>;
}

/** Small helper for conditional class merging. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type { AttributeScalarType };
