import { useEffect, useState, type FormEvent } from 'react';
import { s3Api } from '../../lib/s3Api';
import { errorMessage } from '../../lib/context';
import { Button, Field, Modal, TextInput } from '../../components/ui';

interface Props {
  open: boolean;
  bucket: string;
  /** Current folder prefix (ends with "/", or '' at root). */
  prefix: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateFolderDialog({ open, bucket, prefix, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setError('');
    }
  }, [open]);

  const trimmed = name.trim();
  const invalid = trimmed.length === 0 || trimmed.includes('/');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (invalid || saving) return;
    setSaving(true);
    setError('');
    try {
      await s3Api.putObject(bucket, `${prefix}${trimmed}/`, '', 'application/x-directory');
      onCreated();
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
      title="Create folder"
      subtitle={`In s3://${bucket}/${prefix || '(bucket root)'}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={invalid || saving} loading={saving}>
            Create folder
          </Button>
        </>
      }
    >
      <Field
        label="Folder name"
        hint="A folder is a zero-byte object ending with a slash. You cannot include '/' in the name."
        error={trimmed.includes('/') ? 'Folder names cannot contain "/".' : undefined}
      >
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="my-folder" spellCheck={false} autoFocus />
      </Field>
      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}
