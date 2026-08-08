import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Braces, Code2, Info } from 'lucide-react';
import {
  attributeValueToPlain,
  base64ToBytes,
  dynamoApi,
  plainToAttributeValue,
  type AttributeValue,
  type DynamoTable,
} from '../../lib/dynamoApi';
import { errorMessage } from '../../lib/context';
import { Button, Modal, Textarea } from '../../components/ui';
import { cx, dynamoJsonOf, partitionKeyOf, sortKeyOf } from './DynamoUi';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  table: DynamoTable;
  item?: Record<string, AttributeValue>;
  onClose: () => void;
  onSaved: () => void;
}

const TYPED_KEYS = ['S', 'N', 'B', 'SS', 'NS', 'BS', 'M', 'L', 'BOOL', 'NULL'];

function isAttributeValue(v: unknown): v is AttributeValue {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== 1) return false;
  const k = keys[0];
  if (!TYPED_KEYS.includes(k)) return false;
  const val = (v as Record<string, unknown>)[k];
  switch (k) {
    case 'S':
    case 'N':
      return typeof val === 'string';
    case 'B':
      return typeof val === 'string' || val instanceof Uint8Array;
    case 'BOOL':
    case 'NULL':
      return typeof val === 'boolean';
    case 'SS':
    case 'NS':
      return Array.isArray(val) && val.every((x) => typeof x === 'string');
    case 'BS':
      return Array.isArray(val) && val.every((x) => typeof x === 'string' || x instanceof Uint8Array);
    case 'L':
      return Array.isArray(val) && val.every(isAttributeValue);
    case 'M':
      return !!val && typeof val === 'object' && !Array.isArray(val) && Object.values(val).every(isAttributeValue);
    default:
      return false;
  }
}

/** Deep-convert base64 strings in B/BS attributes into Uint8Array for the SDK. */
function normalizeDynamoJson(v: unknown): unknown {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return v.map(normalizeDynamoJson);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(v)) {
      const nv = normalizeDynamoJson(value);
      if (key === 'B' && typeof nv === 'string') out[key] = base64ToBytes(nv);
      else if (key === 'BS' && Array.isArray(nv)) out[key] = nv.map((x) => (typeof x === 'string' ? base64ToBytes(x) : x));
      else out[key] = nv;
    }
    return out;
  }
  return v;
}

function sampleValue(type: string): unknown {
  if (type === 'N') return 0;
  if (type === 'B') return '';
  return '';
}

export function ItemEditorDialog({ open, mode, table, item, onClose, onSaved }: Props) {
  const [jsonMode, setJsonMode] = useState<'dynamo' | 'plain'>('dynamo');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const pk = partitionKeyOf(table);
  const sk = sortKeyOf(table);

  useEffect(() => {
    if (!open) return;
    setError('');
    if (mode === 'edit' && item) {
      setJsonMode('dynamo');
      setText(dynamoJsonOf(item));
    } else {
      setJsonMode('plain');
      const pkSample = pk ? `"${pk.attributeName}": ${JSON.stringify(sampleValue(pk.attributeType))}` : '';
      const skSample = sk ? `,\n  "${sk.attributeName}": ${JSON.stringify(sampleValue(sk.attributeType))}` : '';
      setText(`{\n  ${pkSample}${skSample}\n}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, item]);

  const switchMode = (next: 'dynamo' | 'plain') => {
    if (next === jsonMode) return;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (next === 'dynamo') {
        // Plain JSON → typed attributes, inferring types.
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            out[k] = plainToAttributeValue(v);
          }
          setText(JSON.stringify(out, null, 2));
        }
      } else {
        // Typed → plain JSON.
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            out[k] = attributeValueToPlain(v as AttributeValue);
          }
          setText(JSON.stringify(out, null, 2));
        }
      }
    } catch {
      /* leave the text untouched; the save handler will surface any issue */
    }
    setJsonMode(next);
  };

  const parsed = useMemo(() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }, [text]);

  const buildItem = (): { item: Record<string, AttributeValue> } => {
    if (parsed === undefined) throw new Error('The JSON is not valid.');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('The item must be a JSON object of attributes.');
    }
    const out: Record<string, AttributeValue> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (jsonMode === 'dynamo') {
        if (!isAttributeValue(v)) {
          throw new Error(`Attribute "${k}" must be a typed DynamoDB value such as { "S": "text" } or { "N": "42" }.`);
        }
        out[k] = normalizeDynamoJson(v) as AttributeValue;
      } else {
        out[k] = plainToAttributeValue(v);
      }
    }
    return { item: out };
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    try {
      const { item: newItem } = buildItem();

      const missing = [pk?.attributeName, sk?.attributeName].filter((n): n is string => !!n && !(n in newItem));
      if (missing.length > 0) {
        throw new Error(`The item is missing primary key attribute(s): ${missing.join(', ')}.`);
      }
      if (mode === 'edit' && item) {
        for (const k of table.keySchema) {
          const oldV = item[k.attributeName];
          const newV = newItem[k.attributeName];
          if (!oldV || JSON.stringify(oldV) !== JSON.stringify(newV)) {
            throw new Error(`The primary key attribute "${k.attributeName}" cannot be changed.`);
          }
        }
        await dynamoApi.updateItem(table, newItem, item);
      } else {
        await dynamoApi.putItem(table.name, newItem);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={mode === 'edit' ? 'Edit item' : 'Create item'}
      subtitle={`${mode === 'edit' ? 'Update' : 'Add'} an item in table ${table.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saving} loading={saving}>
            {mode === 'edit' ? 'Save changes' : 'Create item'}
          </Button>
        </>
      }
    >
      <div className="editor-toolbar">
        <div className="segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={jsonMode === 'dynamo'}
            className={cx('segmented-btn', jsonMode === 'dynamo' && 'segmented-active')}
            onClick={() => switchMode('dynamo')}
          >
            <Braces size={13} />
            DynamoDB JSON
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={jsonMode === 'plain'}
            className={cx('segmented-btn', jsonMode === 'plain' && 'segmented-active')}
            onClick={() => switchMode('plain')}
          >
            <Code2 size={13} />
            JSON
          </button>
        </div>
        {jsonMode === 'plain' ? (
          <span className="muted" style={{ fontSize: 12 }}>
            Types are inferred: string → S, number → N, boolean → BOOL, array → set/list, object → M.
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            Typed attribute values, e.g. <span className="mono">{"{\"name\": {\"S\": \"buffy\"}}"}</span>.
          </span>
        )}
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="json-textarea"
        spellCheck={false}
        placeholder={jsonMode === 'dynamo' ? '{ "id": { "S": "1" } }' : '{ "id": "1" }'}
      />

      <div className="inline-info" style={{ marginTop: 12, alignItems: 'center' }}>
        <Info size={16} />
        <span>
          {mode === 'edit'
            ? `Existing attributes you remove from the JSON are deleted; attributes you add are written. Primary key (${table.keySchema.map((k) => k.attributeName).join(', ')}) is fixed.`
            : `The item must include the primary key: ${[pk?.attributeName, sk?.attributeName].filter(Boolean).join(', ') || 'none'}.`}
        </span>
      </div>

      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}
