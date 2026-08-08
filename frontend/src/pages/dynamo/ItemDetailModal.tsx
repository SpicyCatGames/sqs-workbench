import { useMemo, useState } from 'react';
import { Braces, Code2, Pencil, Trash2 } from 'lucide-react';
import {
  attributePreview,
  attributeTypeLabel,
  attributeTypeOf,
  type AttributeValue,
  type DynamoTable,
} from '../../lib/dynamoApi';
import { Button, Modal } from '../../components/ui';
import { CopyButton } from '../sns/SnsUi';
import { cx, dynamoJsonOf, itemToPlain } from './DynamoUi';

interface Props {
  open: boolean;
  table: DynamoTable;
  item: Record<string, AttributeValue>;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ItemDetailModal({ open, table, item, onClose, onEdit, onDelete }: Props) {
  const [jsonMode, setJsonMode] = useState<'dynamo' | 'plain'>('dynamo');

  const jsonText = useMemo(() => (jsonMode === 'dynamo' ? dynamoJsonOf(item) : JSON.stringify(itemToPlain(item), null, 2)), [item, jsonMode]);

  const entries = useMemo(() => Object.entries(item), [item]);

  return (
    <Modal
      open={open}
      title="Item"
      subtitle={`Item in table ${table.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="danger" onClick={onDelete}>
            <Trash2 size={14} />
            Delete
          </Button>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={onEdit}>
            <Pencil size={14} />
            Edit item
          </Button>
        </>
      }
    >
      <div className="detail-subhead">
        <span className="detail-subhead-title">Attributes</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {entries.length} attribute{entries.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table className="data-table attr-table">
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Type</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, value]) => {
              const type = attributeTypeOf(value);
              return (
                <tr key={name}>
                  <td className="mono" style={{ fontWeight: 600 }}>{name}</td>
                  <td>
                    <span className="attr-type-badge">{attributeTypeLabel(type)}</span>
                  </td>
                  <td className="mono attr-value-cell" title={attributePreview(value, 400)}>
                    {attributePreview(value, 120) || '∅'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="detail-subhead">
        <span className="detail-subhead-title">JSON</span>
        <div className="segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={jsonMode === 'dynamo'}
            className={cx('segmented-btn', jsonMode === 'dynamo' && 'segmented-active')}
            onClick={() => setJsonMode('dynamo')}
          >
            <Braces size={12} />
            DynamoDB JSON
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={jsonMode === 'plain'}
            className={cx('segmented-btn', jsonMode === 'plain' && 'segmented-active')}
            onClick={() => setJsonMode('plain')}
          >
            <Code2 size={12} />
            JSON
          </button>
        </div>
        <CopyButton text={jsonText} size={14} />
      </div>
      <pre className="json-preview">{jsonText}</pre>
    </Modal>
  );
}
