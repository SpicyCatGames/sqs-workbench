import { useMemo, useRef, useState } from 'react';
import { Code2, ExternalLink, FileArchive, Info, Package, UploadCloud } from 'lucide-react';
import { lambdaApi, handlerFileForRuntime, runtimeOption, type FunctionDetail } from '../../lib/lambdaApi';
import { errorMessage, useToast } from '../../lib/context';
import { formatBytes } from '../../lib/format';
import { makeZip } from '../../lib/zip';
import { Button, Field, Modal, Textarea, TextInput } from '../../components/ui';
import { formatIso } from './LambdaUi';

interface Props {
  fn: FunctionDetail;
  onChanged: () => void;
  onTest: () => void;
}

export function CodeTab({ fn, onChanged }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [zipName, setZipName] = useState('');
  const [zipBytes, setZipBytes] = useState<Uint8Array | null>(null);
  const [uploading, setUploading] = useState(false);
  const [inlineOpen, setInlineOpen] = useState(false);
  const [s3Open, setS3Open] = useState(false);
  const [error, setError] = useState('');

  const handleUpload = async () => {
    if (!zipBytes) return;
    setUploading(true);
    setError('');
    try {
      await lambdaApi.updateFunctionCodeZip(fn.functionName, zipBytes);
      toast('success', 'Code updated', `${zipName} uploaded to ${fn.functionName}.`);
      setZipName('');
      setZipBytes(null);
      if (fileRef.current) fileRef.current.value = '';
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="prop-stack">
      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <h3 className="card-title">Code source</h3>
          <span style={{ flex: 1 }} />
          {fn.packageType === 'Image' && <span className="muted" style={{ fontSize: 12.5 }}>Container image</span>}
          {fn.packageType !== 'Image' && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setS3Open(true)}>
                <Package size={13} />
                Upload from Amazon S3
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setInlineOpen(true)}>
                <Code2 size={13} />
                Edit code inline
              </Button>
              <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
                <UploadCloud size={13} />
                Upload .zip
              </Button>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void file.arrayBuffer().then((buf) => {
                setZipBytes(new Uint8Array(buf));
                setZipName(file.name);
              });
            }}
          />
        </div>

        {zipName && (
          <div className="inline-info" style={{ marginTop: 0, marginBottom: 14 }}>
            <FileArchive size={16} />
            <span>
              <strong>{zipName}</strong> selected ({formatBytes(zipBytes?.length ?? 0)})
            </span>
            <span style={{ flex: 1 }} />
            <Button variant="primary" size="sm" onClick={() => void handleUpload()} loading={uploading}>
              Upload and deploy
            </Button>
          </div>
        )}

        {error && <div className="inline-error">{error}</div>}

        <dl className="kv-grid" style={{ marginTop: 12 }}>
          <KeyValue label="Handler" mono>{fn.handler || '—'}</KeyValue>
          <KeyValue label="Runtime" mono>{fn.runtime || '—'}</KeyValue>
          <KeyValue label="Code size">{formatBytes(fn.codeSize)}</KeyValue>
          <KeyValue label="Last modified">{formatIso(fn.lastModified)}</KeyValue>
          <KeyValue label="Code SHA-256" mono>{fn.codeSha256 ? `${fn.codeSha256.slice(0, 24)}…` : '—'}</KeyValue>
          <KeyValue label="Package type">{fn.packageType}</KeyValue>
        </dl>

        {fn.codeLocation && (
          <div className="inline-info" style={{ marginTop: 14, marginBottom: 0 }}>
            <Info size={16} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{fn.codeLocation}</span>
            <a href={fn.codeLocation} target="_blank" rel="noreferrer" className="icon-btn" title="Open code location" style={{ flexShrink: 0 }}>
              <ExternalLink size={14} />
            </a>
          </div>
        )}
      </div>

      {inlineOpen && (
        <InlineEditor
          fn={fn}
          onClose={() => setInlineOpen(false)}
          onSaved={() => {
            toast('success', 'Code updated', 'Inline code was packaged and deployed.');
            setInlineOpen(false);
            onChanged();
          }}
        />
      )}

      {s3Open && (
        <S3UploadDialog
          fn={fn}
          onClose={() => setS3Open(false)}
          onSaved={() => {
            toast('success', 'Code updated', 'Deployment package loaded from S3.');
            setS3Open(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------ inline editor

function InlineEditor({ fn, onClose, onSaved }: { fn: FunctionDetail; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(() => runtimeOption(fn.runtime)?.template ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fileName = useMemo(() => handlerFileForRuntime(fn.runtime, fn.handler), [fn.runtime, fn.handler]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await lambdaApi.updateFunctionCodeZip(fn.functionName, makeZip([{ path: fileName, content: code }]));
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Edit code inline"
      subtitle={`${fn.functionName} · ${fileName}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving} disabled={!code.trim()}>
            Deploy
          </Button>
        </>
      }
    >
      <p className="card-subtitle" style={{ marginBottom: 12 }}>
        Write the handler file for this function. It is packaged into a .zip and uploaded with UpdateFunctionCode — the same as any other deployment.
      </p>
      <Textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        placeholder="exports.handler = async (event) => { ... };"
        style={{ minHeight: 320, fontFamily: 'var(--mono)', fontSize: 12.5 }}
      />
      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}

// -------------------------------------------------------------- s3 upload

function S3UploadDialog({ fn, onClose, onSaved }: { fn: FunctionDetail; onClose: () => void; onSaved: () => void }) {
  const [bucket, setBucket] = useState('');
  const [key, setKey] = useState('');
  const [version, setVersion] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await lambdaApi.updateFunctionCodeFromS3(fn.functionName, bucket, key, version || undefined);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Upload from Amazon S3"
      subtitle={`${fn.functionName} · deployment package`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving} disabled={!bucket.trim() || !key.trim()}>
            Deploy
          </Button>
        </>
      }
    >
      <Field label="S3 bucket">
        <TextInput value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="my-bucket" spellCheck={false} />
      </Field>
      <Field label="S3 key" hint="Path to the .zip object.">
        <TextInput value={key} onChange={(e) => setKey(e.target.value)} placeholder="functions/my-func.zip" spellCheck={false} />
      </Field>
      <Field label="Object version - optional">
        <TextInput value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. v1" spellCheck={false} />
      </Field>
      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}

// ------------------------------------------------------------------- kv

function KeyValue({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="kv-row">
      <dt className="kv-label">{label}</dt>
      <dd className={mono ? 'kv-value kv-mono' : 'kv-value'} style={{ margin: 0 }}>{children ?? '—'}</dd>
    </div>
  );
}
