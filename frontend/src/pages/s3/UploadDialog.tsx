import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CloudUpload, FileText, Plus, X, XCircle } from 'lucide-react';
import { s3Api } from '../../lib/s3Api';
import { errorMessage } from '../../lib/context';
import { formatBytes } from '../../lib/format';
import { Button, Modal } from '../../components/ui';
import { cx } from './S3Ui';

interface Props {
  open: boolean;
  bucket: string;
  /** Destination prefix (folder path ending with "/"), or '' for the bucket root. */
  prefix: string;
  onClose: () => void;
  onUploaded: () => void;
}

type FileStatus = 'pending' | 'uploading' | 'done' | 'error';

interface UploadEntry {
  id: number;
  file: File;
  status: FileStatus;
  progress: number;
  error?: string;
}

const CONCURRENCY = 3;

export function UploadDialog({ open, bucket, prefix, onClose, onUploaded }: Props) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    if (open) {
      setEntries([]);
      setRunning(false);
    }
  }, [open]);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setEntries((prev) => [
      ...prev,
      ...Array.from(files).map((file) => ({ id: nextId.current++, file, status: 'pending' as FileStatus, progress: 0 })),
    ]);
  };

  const update = (id: number, patch: Partial<UploadEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const runUpload = async () => {
    if (running) return;
    const pending = entries.filter((e) => e.status === 'pending');
    if (pending.length === 0) return;
    setRunning(true);

    let queue = pending.slice();
    let failed = 0;

    const worker = async () => {
      while (queue.length > 0) {
        const entry = queue.shift()!;
        try {
          update(entry.id, { status: 'uploading', progress: 0 });
          await s3Api.uploadObject({
            bucket,
            key: prefix + entry.file.name,
            file: entry.file,
            onProgress: (p) => {
              const pct = p.total && p.total > 0 ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0;
              update(entry.id, { progress: pct });
            },
          });
          update(entry.id, { status: 'done', progress: 100 });
        } catch (err) {
          failed += 1;
          update(entry.id, { status: 'error', error: errorMessage(err) });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()));
    setRunning(false);
    if (failed === 0) onUploaded();
  };

  const done = entries.every((e) => e.status === 'done');
  const canStart = entries.some((e) => e.status === 'pending') && !running;

  return (
    <Modal
      open={open}
      title="Upload"
      subtitle={`Destination: s3://${bucket}/${prefix || '(bucket root)'}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={running}>
            Close
          </Button>
          {!running && (
            <Button variant="primary" onClick={() => void runUpload()} disabled={!canStart}>
              <CloudUpload size={15} />
              Upload {entries.filter((e) => e.status === 'pending').length > 0 ? `${entries.filter((e) => e.status === 'pending').length} files` : ''}
            </Button>
          )}
          {running && <span className="muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>Uploading…</span>}
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {entries.length === 0 ? (
        <button type="button" className="upload-dropzone" onClick={() => inputRef.current?.click()}>
          <CloudUpload size={30} />
          <div className="upload-dropzone-title">Choose files to upload</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Files land in {prefix ? `s3://${bucket}/${prefix}` : `s3://${bucket}/`}. Large files are uploaded with multipart.</div>
        </button>
      ) : (
        <div className="upload-list">
          {entries.map((e) => (
            <div key={e.id} className={cx('upload-item', e.status === 'error' && 'upload-item-error')}>
              <div className="upload-item-head">
                <span className="upload-item-icon"><FileText size={15} /></span>
                <span className="upload-item-name" title={e.file.name}>{e.file.name}</span>
                <span className="upload-item-size">{formatBytes(e.file.size)}</span>
                {e.status === 'done' && <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />}
                {e.status === 'error' && <XCircle size={16} style={{ color: 'var(--danger)' }} />}
                {e.status !== 'uploading' && e.status !== 'done' && (
                  <button type="button" className="icon-btn" title="Remove" onClick={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}>
                    <X size={14} />
                  </button>
                )}
              </div>
              {e.status === 'uploading' && (
                <div className="upload-track">
                  <div className="upload-fill" style={{ width: `${Math.max(2, e.progress)}%` }} />
                </div>
              )}
              {e.status === 'uploading' && <div className="upload-item-status">{e.progress}%</div>}
              {e.status === 'error' && e.error && <div className="upload-item-status error">{e.error}</div>}
            </div>
          ))}
          {!running && (
            <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} style={{ alignSelf: 'flex-start' }}>
              <Plus size={13} />
              Add files
            </Button>
          )}
        </div>
      )}

      {done && entries.length > 0 && <div className="inline-info" style={{ marginBottom: 0 }}>All files uploaded.</div>}
    </Modal>
  );
}
