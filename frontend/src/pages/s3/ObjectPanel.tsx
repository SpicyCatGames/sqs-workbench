import { useEffect, useState } from 'react';
import { Download, Copy, Eye, FileKey, Globe, Info, Lock, Plus, Tags as TagsIcon, Trash2 } from 'lucide-react';
import { s3Api, type ObjectAcl, type ObjectHead, type S3ObjectInfo, type S3VersionItem } from '../../lib/s3Api';
import { errorMessage, useToast } from '../../lib/context';
import { formatBytes } from '../../lib/format';
import { Badge, Button, EmptyState, Field, Modal, SkeletonRows, Tabs, TextInput, type TabDef } from '../../components/ui';
import { cx, previewKind, StorageClassBadge } from './S3Ui';

interface Props {
  bucket: string;
  object: S3ObjectInfo;
  /** Present when the panel was opened from the versions listing. */
  version?: S3VersionItem;
  onClose: () => void;
  onChanged: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

const TEXT_PREVIEW_LIMIT = 524_288; // 512 KB
const IMAGE_PREVIEW_LIMIT = 25 * 1024 * 1024; // 25 MB

export function ObjectPanel({ bucket, object, version, onClose, onChanged, onDownload, onCopy, onDelete }: Props) {
  const { toast } = useToast();
  const key = object.key;
  const versionId = version?.versionId;

  const [head, setHead] = useState<ObjectHead | null>(null);
  const [tags, setTags] = useState<Record<string, string>>({});
  const [acl, setAcl] = useState<ObjectAcl | null>(null);
  const [tab, setTab] = useState('preview');
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);

  // preview state
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [aclError, setAclError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    setPreviewText(null);
    setPreviewImage(null);
    setPreviewTruncated(false);
    (async () => {
      try {
        const [h, t] = await Promise.all([
          s3Api.headObject(bucket, key, versionId),
          s3Api.getObjectTags(bucket, key, versionId).catch(() => ({ tags: {} })),
        ]);
        if (cancelled) return;
        setHead(h);
        setTags(t.tags);
        setLoaded(true);
      } catch (err) {
        if (!cancelled) {
          setLoadError(errorMessage(err));
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bucket, key, versionId]);

  useEffect(() => {
    if (previewImage) {
      return () => URL.revokeObjectURL(previewImage);
    }
    return undefined;
  }, [previewImage]);

  const loadPreview = async () => {
    if (!head || previewText !== null || previewImage !== null) return;
    const kind = previewKind(key, head.contentType);
    setPreviewLoading(true);
    try {
      if (kind === 'image') {
        if (head.size > IMAGE_PREVIEW_LIMIT) {
          toast('info', 'Image too large to preview', `This image is ${formatBytes(head.size)}. Download it to view it.`);
        } else {
          const { blob } = await s3Api.getObjectBlob(bucket, key, { versionId });
          setPreviewImage(URL.createObjectURL(blob));
        }
      } else if (kind === 'text' || kind === 'json') {
        const { blob } = await s3Api.getObjectBlob(bucket, key, { versionId, range: `bytes=0-${TEXT_PREVIEW_LIMIT - 1}` });
        setPreviewText(await blob.text());
        setPreviewTruncated(head.size > blob.size);
      }
    } catch (err) {
      toast('error', 'Preview failed', errorMessage(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'preview') void loadPreview();
    if (tab === 'permissions' && !acl && !aclError) {
      setAclError('');
      s3Api
        .getObjectAcl(bucket, key, versionId)
        .then(setAcl)
        .catch((err) => setAclError(errorMessage(err)));
    }
    // head is included so the preview loads as soon as the object header arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, head]);

  const kind = previewKind(key, head?.contentType);
  const shortName = key.split('/').pop() ?? key;

  const handleAddTag = async (tagKey: string, tagValue: string) => {
    try {
      const next = { ...tags, [tagKey]: tagValue };
      await s3Api.putObjectTags(bucket, key, next, versionId);
      setTags(next);
      toast('success', 'Tags updated');
      onChanged();
    } catch (err) {
      toast('error', 'Failed to update tags', errorMessage(err));
    }
  };

  const handleRemoveTag = async (tagKey: string) => {
    try {
      const next = { ...tags };
      delete next[tagKey];
      await s3Api.putObjectTags(bucket, key, next, versionId);
      setTags(next);
      toast('success', 'Tag removed');
      onChanged();
    } catch (err) {
      toast('error', 'Failed to remove tag', errorMessage(err));
    }
  };

  const handleAcl = async (aclValue: 'private' | 'public-read') => {
    try {
      await s3Api.putObjectAcl(bucket, key, aclValue, versionId);
      const updated = await s3Api.getObjectAcl(bucket, key, versionId);
      setAcl(updated);
      toast('success', aclValue === 'public-read' ? 'Object is now public' : 'Object is now private');
      onChanged();
    } catch (err) {
      toast('error', 'ACL update failed', errorMessage(err));
    }
  };

  const TABS: TabDef[] = [
    { id: 'preview', label: 'Preview', icon: <Eye size={14} /> },
    { id: 'properties', label: 'Properties', icon: <Info size={14} /> },
    { id: 'tags', label: 'Tags', icon: <TagsIcon size={14} /> },
    { id: 'permissions', label: 'Permissions', icon: <FileKey size={14} /> },
  ];

  return (
    <Modal
      open
      title={shortName}
      subtitle={
        version
          ? `Version ${version.versionId} of s3://${bucket}/${key}`
          : `s3://${bucket}/${key}`
      }
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="danger" onClick={onDelete}>
            <Trash2 size={14} />
            Delete
          </Button>
          <span style={{ flex: 1 }} />
          {!version?.isDeleteMarker && (
            <>
              <Button variant="secondary" onClick={onCopy}>
                <Copy size={14} />
                Copy
              </Button>
              <Button variant="primary" onClick={onDownload}>
                <Download size={14} />
                Download
              </Button>
            </>
          )}
        </>
      }
    >
      {!loaded ? (
        <SkeletonRows rows={5} />
      ) : loadError ? (
        <EmptyState title="Object unavailable" description={loadError} />
      ) : (
        <>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />

          {tab === 'preview' && (
            <div>
              {previewLoading && <div className="spinner-wrap"><span className="muted" style={{ fontSize: 13 }}>Loading preview…</span></div>}
              {!previewLoading && kind === 'none' && (
                <EmptyState
                  title="No preview available"
                  description={`${formatBytes(head?.size ?? 0)} object of type ${head?.contentType || 'unknown'}. Download it to view its contents.`}
                />
              )}
              {!previewLoading && kind === 'image' && previewImage && (
                <div className="preview-image-wrap">
                  <img src={previewImage} alt={shortName} />
                </div>
              )}
              {!previewLoading && (kind === 'text' || kind === 'json') && previewText !== null && (
                <div>
                  {previewTruncated && (
                    <div className="inline-info" style={{ marginTop: 0 }}>
                      <Info size={16} />
                      <span>Preview truncated — showing the first {formatBytes(TEXT_PREVIEW_LIMIT)} of {formatBytes(head?.size ?? 0)}.</span>
                    </div>
                  )}
                  <pre className="msg-body-preview" style={{ maxHeight: 380, minHeight: 120 }}>{previewText}</pre>
                </div>
              )}
            </div>
          )}

          {tab === 'properties' && head && (
            <div>
              <dl className="kv-grid">
                <Kv label="Key" mono>{key}</Kv>
                <Kv label="Size">{formatBytes(head.size)}</Kv>
                <Kv label="Last modified">{head.lastModified ? new Date(head.lastModified).toLocaleString() : '—'}</Kv>
                <Kv label="ETag" mono>{head.etag ?? '—'}</Kv>
                <Kv label="Content type">{head.contentType || '—'}</Kv>
                <Kv label="Storage class"><StorageClassBadge storageClass={head.storageClass} /></Kv>
                <Kv label="Version ID" mono>{head.versionId ?? (version ? version.versionId : '—')}</Kv>
              </dl>
              <h3 className="card-title" style={{ marginTop: 16, marginBottom: 10 }}>Metadata</h3>
              {Object.keys(head.metadata).length === 0 ? (
                <div className="inline-info" style={{ marginTop: 0 }}>
                  <Info size={16} />
                  <span>No user-defined metadata on this object.</span>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>Key</th><th>Value</th></tr>
                    </thead>
                    <tbody>
                      {Object.entries(head.metadata).map(([k, v]) => (
                        <tr key={k}>
                          <td className="mono">{k}</td>
                          <td className="mono">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'tags' && (
            <TagsSection tags={tags} onAdd={handleAddTag} onRemove={handleRemoveTag} />
          )}

          {tab === 'permissions' && (
            <PermissionsSection
              acl={acl}
              loading={!acl && !aclError}
              error={aclError}
              onMakePublic={() => void handleAcl('public-read')}
              onMakePrivate={() => void handleAcl('private')}
            />
          )}
        </>
      )}
    </Modal>
  );
}

function Kv({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="kv-row">
      <dt className="kv-label">{label}</dt>
      <dd className={cx('kv-value', mono && 'kv-mono')} style={{ margin: 0 }}>{children ?? '—'}</dd>
    </div>
  );
}

function TagsSection({
  tags,
  onAdd,
  onRemove,
}: {
  tags: Record<string, string>;
  onAdd: (k: string, v: string) => void;
  onRemove: (k: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const entries = Object.entries(tags);

  const handleAdd = async () => {
    if (!key.trim()) return;
    setSaving(true);
    try {
      await onAdd(key.trim(), value);
      setKey('');
      setValue('');
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="card-title-row" style={{ marginBottom: 12 }}>
        <h2 className="card-title">Object tags</h2>
        <span className="muted" style={{ fontSize: 12.5 }}>{entries.length} tag{entries.length === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          <Plus size={13} />
          Add tag
        </Button>
      </div>
      {entries.length === 0 ? (
        <EmptyState title="No tags" description="Add tags to this object to organize it." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Key</th><th>Value</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
            </thead>
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k}>
                  <td className="mono" style={{ fontWeight: 600 }}>{k}</td>
                  <td>{v || <span className="muted">—</span>}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="icon-btn danger" title="Remove tag" onClick={() => void onRemove(k)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={adding}
        title="Add tag"
        subtitle="Add a key-value tag to this object."
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={() => void handleAdd()} disabled={!key.trim() || saving} loading={saving}>Add tag</Button>
          </>
        }
      >
        <Field label="Key" hint="Required.">
          <TextInput value={key} onChange={(e) => setKey(e.target.value)} placeholder="environment" spellCheck={false} />
        </Field>
        <Field label="Value" hint="Optional.">
          <TextInput value={value} onChange={(e) => setValue(e.target.value)} placeholder="production" spellCheck={false} />
        </Field>
      </Modal>
    </div>
  );
}

function PermissionsSection({
  acl,
  loading,
  error,
  onMakePublic,
  onMakePrivate,
}: {
  acl: ObjectAcl | null;
  loading: boolean;
  error: string;
  onMakePublic: () => void;
  onMakePrivate: () => void;
}) {
  const publicGrant = acl?.grants.some((g) => g.uri?.includes('AllUsers') && g.permission === 'READ');

  return (
    <div>
      <div className="inline-info" style={{ marginTop: 0 }}>
        <Lock size={16} />
        <span>
          Object ACL controls who can read this object. Changes apply immediately to the <strong>current version</strong>.
        </span>
      </div>
      {loading ? (
        <SkeletonRows rows={3} />
      ) : error ? (
        <EmptyState title="Permissions unavailable" description={error} />
      ) : (
        <>
          <div className="card-title-row" style={{ marginBottom: 10 }}>
            <h2 className="card-title">Access control list</h2>
            <span style={{ flex: 1 }} />
            {publicGrant ? (
              <Button variant="secondary" size="sm" onClick={onMakePrivate}>
                <Lock size={13} /> Make private
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={onMakePublic}>
                <Globe size={13} /> Make public
              </Button>
            )}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Grantee</th><th>Type</th><th>Permission</th></tr>
              </thead>
              <tbody>
                {acl?.grants.map((g, i) => (
                  <tr key={i}>
                    <td>{g.uri?.includes('AllUsers') ? 'Everyone (public)' : (g.displayName || g.id || g.uri || '—')}</td>
                    <td><Badge>{g.type.replace('User', ' user')}</Badge></td>
                    <td className="mono">{g.permission}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
