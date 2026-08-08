import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Filter, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import {
  attributePreview,
  attributeTypeOf,
  buildFilterExpression,
  buildKeyConditionExpression,
  dynamoApi,
  type AttributeValue,
  type DynamoTable,
  type ItemFilterCondition,
  type SortKeyCondition,
} from '../../lib/dynamoApi';
import { errorMessage, useToast } from '../../lib/context';
import { Button, EmptyState, IconButton, NumberInput, Select, TextInput } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { cx, itemKeyString, partitionKeyOf, primaryKeyOfItem, sortKeyOf } from './DynamoUi';
import { ItemDetailModal } from './ItemDetailModal';
import { ItemEditorDialog } from './ItemEditorDialog';

interface Props {
  table: DynamoTable;
  /** Increment to open the create-item editor. */
  createSignal: number;
  /** Called after items change so the header can refresh stats. */
  onDataChanged: () => void;
}

const FILTER_OPS: Array<{ value: ItemFilterCondition['operator']; label: string }> = [
  { value: '=', label: '=' },
  { value: '<>', label: '<>' },
  { value: '<', label: '<' },
  { value: '<=', label: '<=' },
  { value: '>', label: '>' },
  { value: '>=', label: '>=' },
  { value: 'BETWEEN', label: 'between' },
  { value: 'BEGINS_WITH', label: 'begins_with' },
  { value: 'CONTAINS', label: 'contains' },
];

const SK_OPS: Array<{ value: SortKeyCondition['operator']; label: string }> = [
  { value: '=', label: '=' },
  { value: '<', label: '<' },
  { value: '<=', label: '<=' },
  { value: '>', label: '>' },
  { value: '>=', label: '>=' },
  { value: 'BETWEEN', label: 'between' },
  { value: 'BEGINS_WITH', label: 'begins_with' },
];

const VALUE_TYPES: Array<{ value: ItemFilterCondition['valueType']; label: string }> = [
  { value: 'S', label: 'String' },
  { value: 'N', label: 'Number' },
  { value: 'BOOL', label: 'Boolean' },
  { value: 'B', label: 'Binary' },
];

const MAX_COLUMNS = 7;

function emptyCondition(): ItemFilterCondition {
  return { attribute: '', operator: '=', value1: '', value2: '', valueType: 'S' };
}

export function ItemsTab({ table, createSignal, onDataChanged }: Props) {
  const { toast } = useToast();

  const [operation, setOperation] = useState<'scan' | 'query'>('scan');
  const [limit, setLimit] = useState('25');
  const [pkValue, setPkValue] = useState('');
  const [skOperator, setSkOperator] = useState<SortKeyCondition['operator']>('=');
  const [skValue1, setSkValue1] = useState('');
  const [skValue2, setSkValue2] = useState('');
  const [conditions, setConditions] = useState<ItemFilterCondition[]>(() => [emptyCondition()]);

  const [items, setItems] = useState<Record<string, AttributeValue>[]>([]);
  const [lastEvaluatedKey, setLastEvaluatedKey] = useState<Record<string, AttributeValue> | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [totals, setTotals] = useState({ returned: 0, scanned: 0, capacity: 0 });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<Record<string, AttributeValue> | null>(null);
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; item: Record<string, AttributeValue> } | null>(null);
  const [deleteKeys, setDeleteKeys] = useState<Record<string, AttributeValue>[] | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const pk = partitionKeyOf(table);
  const sk = sortKeyOf(table);

  const itemById = useMemo(() => {
    const m = new Map<string, Record<string, AttributeValue>>();
    for (const item of items) m.set(itemKeyString(table, item), item);
    return m;
  }, [items, table]);

  const attrTypes = useMemo(() => {
    const m = new Map<string, string>();
    for (const item of items) {
      for (const [k, v] of Object.entries(item)) {
        if (!m.has(k)) m.set(k, attributeTypeOf(v));
      }
    }
    return m;
  }, [items]);

  const columns = useMemo(() => {
    const cols: string[] = [];
    for (const item of items) {
      for (const k of Object.keys(item)) {
        if (!cols.includes(k)) cols.push(k);
      }
    }
    return cols;
  }, [items]);

  const visibleColumns = columns.slice(0, MAX_COLUMNS);
  const hiddenCount = columns.length - visibleColumns.length;

  const limitNum = useMemo(() => {
    const n = Math.round(Number(limit));
    if (Number.isNaN(n)) return 25;
    return Math.min(1000, Math.max(1, n));
  }, [limit]);

  const resetResults = useCallback(() => {
    setItems([]);
    setLastEvaluatedKey(null);
    setSelected(new Set());
    setTotals({ returned: 0, scanned: 0, capacity: 0 });
  }, []);

  const exec = useCallback(
    async (startKey?: Record<string, AttributeValue>) => {
      setError('');
      const filter = buildFilterExpression(conditions);
      let res;
      if (operation === 'query') {
        const key = buildKeyConditionExpression(table, pkValue, skValue1.trim() ? { operator: skOperator, value1: skValue1, value2: skValue2 } : null);
        res = await dynamoApi.queryTable(table.name, {
          limit: limitNum,
          exclusiveStartKey: startKey,
          keyConditionExpression: key.KeyConditionExpression,
          expressionAttributeNames: { ...key.ExpressionAttributeNames, ...(filter?.ExpressionAttributeNames ?? {}) },
          expressionAttributeValues: { ...key.ExpressionAttributeValues, ...(filter?.ExpressionAttributeValues ?? {}) },
          filterExpression: filter?.FilterExpression,
        });
      } else {
        res = await dynamoApi.scanTable(table.name, {
          limit: limitNum,
          exclusiveStartKey: startKey,
          filterExpression: filter?.FilterExpression,
          expressionAttributeNames: filter?.ExpressionAttributeNames,
          expressionAttributeValues: filter?.ExpressionAttributeValues,
        });
      }
      return res;
    },
    [operation, conditions, table, pkValue, skOperator, skValue1, skValue2, limitNum],
  );

  const run = useCallback(async () => {
    setRunning(true);
    setHasRun(true);
    try {
      const res = await exec();
      setItems(res.items);
      setLastEvaluatedKey(res.lastEvaluatedKey);
      setTotals({ returned: res.count, scanned: res.scannedCount, capacity: res.capacityUnits ?? 0 });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }, [exec]);

  const loadMore = useCallback(async () => {
    if (!lastEvaluatedKey || running) return;
    setRunning(true);
    try {
      const res = await exec(lastEvaluatedKey);
      setItems((prev) => [...prev, ...res.items]);
      setLastEvaluatedKey(res.lastEvaluatedKey);
      setTotals((t) => ({ returned: t.returned + res.count, scanned: t.scanned + res.scannedCount, capacity: t.capacity + (res.capacityUnits ?? 0) }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }, [lastEvaluatedKey, running, exec]);

  // "Create item" triggered from the detail page header.
  useEffect(() => {
    if (createSignal > 0) {
      setEditor({ mode: 'create' });
    }
  }, [createSignal]);

  const refresh = async () => {
    await run();
  };

  const handleSaved = () => {
    toast('success', 'Item saved');
    setDetailItem(null);
    void refresh();
    onDataChanged();
  };

  const handleDeleted = async (keys: Record<string, AttributeValue>[]) => {
    setActionLoading(true);
    try {
      const res = await dynamoApi.deleteItems(table.name, keys);
      toast('success', 'Items deleted', `${res.deleted} item(s) removed.`);
      setDeleteKeys(null);
      setSelected(new Set());
      setDetailItem(null);
      await run();
      onDataChanged();
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allOnPageSelected = items.length > 0 && items.every((item) => selected.has(itemKeyString(table, item)));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const item of items) next.delete(itemKeyString(table, item));
      } else {
        for (const item of items) next.add(itemKeyString(table, item));
      }
      return next;
    });
  };

  const updateCondition = (i: number, patch: Partial<ItemFilterCondition>) => {
    setConditions((prev) => {
      const next = prev.map((c, j) => (j === i ? { ...c, ...patch } : c));
      // Auto-select the value type from attributes seen in the results.
      if (patch.attribute && attrTypes.has(patch.attribute.trim()) && next[i].valueType === 'S') {
        const known = attrTypes.get(patch.attribute.trim());
        if (known === 'N' || known === 'BOOL') next[i] = { ...next[i], valueType: known };
      }
      return next;
    });
  };

  const pkHint = pk ? `Type: ${pk.attributeType === 'S' ? 'string' : pk.attributeType === 'N' ? 'number' : 'base64 binary'}` : '';

  return (
    <div>
      <div className="items-toolbar">
        <div className="segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={operation === 'scan'}
            className={cx('segmented-btn', operation === 'scan' && 'segmented-active')}
            onClick={() => {
              setOperation('scan');
              resetResults();
            }}
          >
            Scan
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={operation === 'query'}
            className={cx('segmented-btn', operation === 'query' && 'segmented-active')}
            onClick={() => {
              setOperation('query');
              resetResults();
            }}
          >
            Query
          </button>
        </div>

        {operation === 'query' && (
          <>
            <div className="query-key">
              <span className="query-key-label">{pk?.attributeName ?? 'Partition key'}</span>
              <TextInput value={pkValue} onChange={(e) => setPkValue(e.target.value)} placeholder={pk?.attributeType === 'S' ? 'value' : pk?.attributeType === 'N' ? '123' : 'base64'} style={{ width: 150 }} spellCheck={false} />
            </div>
            {sk && (
              <div className="query-key">
                <span className="query-key-label">{sk.attributeName}</span>
                <Select value={skOperator} onChange={(e) => setSkOperator(e.target.value as SortKeyCondition['operator'])} style={{ width: 110 }}>
                  {SK_OPS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <TextInput value={skValue1} onChange={(e) => setSkValue1(e.target.value)} placeholder="value" style={{ width: 120 }} spellCheck={false} />
                {skOperator === 'BETWEEN' && (
                  <TextInput value={skValue2} onChange={(e) => setSkValue2(e.target.value)} placeholder="and" style={{ width: 100 }} spellCheck={false} />
                )}
              </div>
            )}
          </>
        )}

        <div className="query-key">
          <span className="query-key-label">Limit</span>
          <NumberInput value={limit} onChange={(e) => setLimit(e.target.value)} min={1} max={1000} style={{ width: 80 }} />
        </div>

        <Button variant="primary" onClick={() => void run()} disabled={running || (operation === 'query' && !pkValue.trim())}>
          <Play size={14} />
          Run
        </Button>
        <Button variant="secondary" onClick={() => setEditor({ mode: 'create' })}>
          <Plus size={14} />
          Create item
        </Button>
        <span style={{ flex: 1 }} />
        {selected.size > 0 && (
          <Button variant="danger" size="sm" onClick={() => setDeleteKeys(Array.from(selected).map((id) => primaryKeyOfItem(table, itemById.get(id) ?? {})))}>
            <Trash2 size={14} />
            Delete selected ({selected.size})
          </Button>
        )}
      </div>

      <div className="filter-box">
        <div className="filter-box-head">
          <Filter size={14} />
          <span>Attribute filters</span>
          <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
            Applied after {operation === 'query' ? 'the query' : 'the scan'}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConditions((c) => [...c, { ...emptyCondition(), join: 'AND' }])} disabled={conditions.length >= 4}>
            + Add condition
          </button>
        </div>
        {conditions.map((cond, i) => (
          <div className="filter-row" key={i}>
            {i > 0 ? (
              <Select
                value={cond.join ?? 'AND'}
                onChange={(e) => updateCondition(i, { join: e.target.value as 'AND' | 'OR' })}
                style={{ width: 74 }}
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </Select>
            ) : (
              <span className="filter-row-placeholder">Where</span>
            )}
            <TextInput
              value={cond.attribute}
              onChange={(e) => updateCondition(i, { attribute: e.target.value })}
              placeholder="attribute name"
              style={{ width: 170 }}
              list={`dyn-attrs-${table.name}`}
              spellCheck={false}
            />
            <Select value={cond.operator} onChange={(e) => updateCondition(i, { operator: e.target.value as ItemFilterCondition['operator'] })} style={{ width: 130 }}>
              {FILTER_OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <TextInput value={cond.value1} onChange={(e) => updateCondition(i, { value1: e.target.value })} placeholder="value" style={{ width: 140 }} spellCheck={false} />
            {cond.operator === 'BETWEEN' && (
              <TextInput value={cond.value2 ?? ''} onChange={(e) => updateCondition(i, { value2: e.target.value })} placeholder="and" style={{ width: 110 }} spellCheck={false} />
            )}
            <Select value={cond.valueType} onChange={(e) => updateCondition(i, { valueType: e.target.value as ItemFilterCondition['valueType'] })} style={{ width: 110 }}>
              {VALUE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
            {conditions.length > 1 && (
              <IconButton className="danger" title="Remove condition" onClick={() => setConditions((c) => c.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </IconButton>
            )}
          </div>
        ))}
        <datalist id={`dyn-attrs-${table.name}`}>
          {columns.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      {operation === 'query' && (
        <div className="muted" style={{ fontSize: 12.5, margin: '0 0 12px 2px' }}>
          {pkHint} — a query requires the partition key value; the sort key condition is optional.
        </div>
      )}

      {error && <div className="inline-error">{error}</div>}

      {!error && hasRun && items.length === 0 && !running && (
        <div className="card">
          <EmptyState
            icon={<Eye size={28} />}
            title={operation === 'query' ? 'No items matched the query' : 'No items found'}
            description={
              operation === 'query'
                ? `Nothing matched partition key ${pk?.attributeName ?? ''}${sk && skValue1.trim() ? ` with sort key ${sk.attributeName} ${skOperator} ${skValue1}` : ''}.`
                : 'The scan returned no items. Check the attribute filters, or create an item.'
            }
          />
        </div>
      )}

      {!error && !hasRun && (
        <div className="card">
          <EmptyState
            icon={<Eye size={28} />}
            title="Explore items"
            description="Run a scan of the whole table or a query by partition key to start exploring items."
            action={
              <Button variant="primary" onClick={() => void run()} disabled={running}>
                <Play size={14} />
                Run {operation}
              </Button>
            }
          />
        </div>
      )}

      {hasRun && items.length > 0 && (
        <>
          <div className="results-summary">
            <span>
              Showing <strong>{items.length}</strong> item{items.length === 1 ? '' : 's'} · returned {totals.returned}, scanned {totals.scanned}
            </span>
            <span className="muted">Consumed {totals.capacity.toFixed(2)} read capacity unit(s)</span>
          </div>
          <div className="table-wrap">
            <table className="data-table items-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input type="checkbox" className="row-check" checked={allOnPageSelected} onChange={toggleAll} title="Select all on page" />
                  </th>
                  {visibleColumns.map((col) => (
                    <th key={col}>
                      <span className="col-name">{col}</span>
                      {attrTypes.has(col) && <span className="col-type">{attrTypes.get(col)}</span>}
                    </th>
                  ))}
                  {hiddenCount > 0 && <th>+{hiddenCount} more</th>}
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const id = itemKeyString(table, item);
                  const isSelected = selected.has(id);
                  return (
                    <tr key={id} className={cx(isSelected && 'row-selected')} onClick={() => setDetailItem(item)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="row-check" checked={isSelected} onChange={() => toggleSelected(id)} />
                      </td>
                      {visibleColumns.map((col) => {
                        const v = item[col];
                        return (
                          <td key={col} className="item-value-cell mono" title={v ? attributePreview(v, 400) : undefined}>
                            {v ? attributePreview(v, 40) : <span className="muted">∅</span>}
                          </td>
                        );
                      })}
                      {hiddenCount > 0 && <td className="muted">…</td>}
                      <td>
                        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                          <IconButton title="View item" onClick={() => setDetailItem(item)}>
                            <Eye size={14} />
                          </IconButton>
                          <IconButton title="Edit item" onClick={() => setEditor({ mode: 'edit', item })}>
                            <Pencil size={14} />
                          </IconButton>
                          <IconButton className="danger" title="Delete item" onClick={() => setDeleteKeys([primaryKeyOfItem(table, item)])}>
                            <Trash2 size={14} />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {lastEvaluatedKey && (
              <div className="load-more-row">
                <Button variant="secondary" size="sm" onClick={() => void loadMore()} disabled={running}>
                  {running ? 'Loading…' : 'Load more items'}
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {detailItem && (
        <ItemDetailModal
          open={!!detailItem}
          table={table}
          item={detailItem}
          onClose={() => setDetailItem(null)}
          onEdit={() => {
            setEditor({ mode: 'edit', item: detailItem });
            setDetailItem(null);
          }}
          onDelete={() => {
            setDeleteKeys([primaryKeyOfItem(table, detailItem)]);
            setDetailItem(null);
          }}
        />
      )}

      {editor && (
        <ItemEditorDialog
          open={!!editor}
          mode={editor.mode}
          table={table}
          item={editor.mode === 'edit' ? editor.item : undefined}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
        />
      )}

      <ConfirmDialog
        open={!!deleteKeys}
        title={`Delete ${deleteKeys?.length === 1 ? 'item' : 'items'}?`}
        message={
          <>
            Permanently delete {deleteKeys?.length ?? 0} item{deleteKeys?.length === 1 ? '' : 's'} from table <strong>{table.name}</strong>? This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        loading={actionLoading}
        onConfirm={() => deleteKeys && void handleDeleted(deleteKeys)}
        onClose={() => setDeleteKeys(null)}
      />
    </div>
  );
}
