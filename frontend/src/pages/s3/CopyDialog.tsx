import { useEffect, useState, type FormEvent } from 'react';
import { s3Api, type S3ObjectInfo } from '../../lib/s3Api';
import { errorMessage, useToast } from '../../lib/context';
import { Button, Field, Modal, Select, TextInput } from '../../components/ui';
import { useReload } from './S3Ui';

interface Props {
  open: boolean;
  /** Single or multiple objects to copy. */
  items: S3ObjectInfo[];
  bucket: string;
  onClose: () => void;
  onCopied: () => void;
}

export function CopyDialog({ open, items, bucket, onClose, onCopied }: Props) {
  const { toast } = useToast();
  const [buckets, setBuckets] = useState<string[]>([]);
  const [destBucket, setDestBucket] = useState(bucket);
  const [destKey, setDestKey] = useState('');
  const [prefixOverride, setPrefixOverride] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const single = items.length === 1;
  const singleKey = single ? items[0].key : '';
  const baseName = (k: string) => k.split('/').pop() ?? k;

  useReload(async () => {
    const res = await s3Api.listBuckets();
    setBuckets(res.buckets.map((b) => b.name));
  });

  useEffect(() => {
    if (open) {
      setDestBucket(bucket);
      setDestKey(single ? singleKey : '');
      setPrefixOverride('');
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, single, singleKey, bucket]);

  const duplicate = destBucket === bucket && (single ? destKey.trim() === singleKey : false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      if (single) {
        if (!destKey.trim()) {
          setError('Destination key is required.');
          setSaving(false);
          return;
        }
        await s3Api.copyObject({ sourceBucket: bucket, sourceKey: singleKey, bucket: destBucket, key: destKey.trim() });
      } else {
        const prefix = prefixOverride.trim();
        for (const item of items) {
          if (prefix && prefix.length > 0) {
            const cleanPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
            await s3Api.copyObject({ sourceBucket: bucket, sourceKey: item.key, bucket: destBucket, key: `${cleanPrefix}${baseName(item.key)}` });
          } else {
            await s3Api.copyObject({ sourceBucket: bucket, sourceKey: item.key, bucket: destBucket, key: item.key });
          }
        }
      }
      toast('success', 'Copy complete', `${items.length} object${items.length === 1 ? '' : 's'} copied.`);
      onCopied();
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
      title="Copy objects"
      subtitle={
        single ? `Copy s3://${bucket}/${singleKey}` : `Copy ${items.length} objects from s3://${bucket}/`
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={duplicate || saving} loading={saving}>
            Copy
          </Button>
        </>
      }
    >
      {!single && (
        <div className="inline-info" style={{ marginTop: 0 }}>
          <span>
            {items.length} objects selected. They keep their names; an optional destination prefix can be prepended.
          </span>
        </div>
      )}

      <Field label="Destination bucket">
        <Select value={destBucket} onChange={(e) => setDestBucket(e.target.value)}>
          {buckets.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
      </Field>

      {single ? (
        <Field label="Destination key" hint="Full key of the copied object in the destination bucket.">
          <TextInput value={destKey} onChange={(e) => setDestKey(e.target.value)} spellCheck={false} />
        </Field>
      ) : (
        <Field label="Destination prefix (optional)" hint="Prepended to every object name, e.g. 'archived/'.">
          <TextInput value={prefixOverride} onChange={(e) => setPrefixOverride(e.target.value)} placeholder="archived/" spellCheck={false} />
        </Field>
      )}

      {duplicate && <div className="inline-error">Source and destination are identical.</div>}
      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}
