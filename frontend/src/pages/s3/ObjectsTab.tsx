import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  CheckSquare,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Folder,
  FolderOpen,
  History,
  Layers,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { s3Api, type S3ObjectInfo, type S3VersionItem } from '../../lib/s3Api';
import { errorMessage, useToast } from '../../lib/context';
import { formatBytes } from '../../lib/format';
import { Badge, Button, EmptyState, ErrorState, IconButton, SkeletonRows, TextInput } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { cx, StorageClassBadge, versionToObject } from './S3Ui';
import { CopyDialog } from './CopyDialog';
import { ObjectPanel } from './ObjectPanel';

export interface ObjectsTabHandle {
  refresh: () => void;
  /** Current folder prefix (e.g. 'folder/', or '' at the bucket root). */
  getPrefix: () => string;
}

interface Props {
  bucket: string;
  /** Open the page-level upload dialog (rendered by BucketDetailPage). */
  onUploadRequest: () => void;
  /** Open the page-level create-folder dialog (rendered by BucketDetailPage). */
  onFolderRequest: () => void;
  /** Bumped by the page after external changes (upload, folder creation) to trigger a reload. */
  refreshSignal: number;
}

/** Download a single object (optionally a specific version) into the browser's downloads. */
export async function downloadObject(bucket: string, key: string, versionId?: string): Promise<void> {
  const { blob } = await s3Api.getObjectBlob(bucket, key, { versionId });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = key.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const ObjectsTab = forwardRef<ObjectsTabHandle, Props>(function ObjectsTab(
  { bucket, onUploadRequest, onFolderRequest, refreshSignal },
  ref,
) {
  const { toast } = useToast();

  const [prefix, setPrefix] = useState('');
  const [folders, setFolders] = useState<S3ObjectInfo[]>([]);
  const [objects, setObjects] = useState<S3ObjectInfo[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [isTruncated, setIsTruncated] = useState(false);

  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<S3VersionItem[]>([]);
  const [versionNext, setVersionNext] = useState<{ keyMarker: string; versionIdMarker?: string } | undefined>();
  const [versionsTruncated, setVersionsTruncated] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panelTarget, setPanelTarget] = useState<S3ObjectInfo | null>(null);
  const [panelVersion, setPanelVersion] = useState<S3VersionItem | null>(null);
  const [copyTarget, setCopyTarget] = useState<S3ObjectInfo[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<S3ObjectInfo[] | null>(null);
  const [versionDeleteTarget, setVersionDeleteTarget] = useState<S3VersionItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Guards against stale responses: each load captures a sequence number; a
  // response only applies if it is still the newest request (fast folder
  // navigation must not let an older listing overwrite a newer one).
  const loadSeq = useRef(0);
  const prefixRef = useRef(prefix);
  useEffect(() => {
    prefixRef.current = prefix;
  }, [prefix]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    try {
      const res = await s3Api.listObjects(bucket, prefix);
      if (seq !== loadSeq.current) return;
      setFolders(res.folders);
      setObjects(res.objects);
      setNextToken(res.nextToken);
      setIsTruncated(res.isTruncated);
      setSelected(new Set());
    } catch (err) {
      if (seq === loadSeq.current) setError(errorMessage(err));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [bucket, prefix]);

  const loadVersions = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    try {
      const res = await s3Api.listObjectVersions(bucket, prefix);
      if (seq !== loadSeq.current) return;
      setVersions(res.versions);
      setVersionNext(res.nextMarkers);
      setVersionsTruncated(res.isTruncated);
    } catch (err) {
      if (seq === loadSeq.current) setError(errorMessage(err));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [bucket, prefix]);

  const refresh = useCallback(() => {
    void (showVersions ? loadVersions() : load());
  }, [showVersions, loadVersions, load]);

  useImperativeHandle(
    ref,
    () => ({
      refresh,
      getPrefix: () => prefix,
    }),
    [refresh, prefix],
  );

  useEffect(() => {
    void (showVersions ? loadVersions() : load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, loadVersions, showVersions]);

  useEffect(() => {
    if (refreshSignal > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const parts = useMemo(() => (prefix ? prefix.split('/').filter(Boolean) : []), [prefix]);

  const q = filter.trim().toLowerCase();
  const filteredFolders = useMemo(
    () => (q ? folders.filter((f) => f.key.toLowerCase().includes(q)) : folders),
    [folders, q],
  );
  const filteredObjects = useMemo(
    () => (q ? objects.filter((o) => o.key.toLowerCase().includes(q)) : objects),
    [objects, q],
  );
  const filteredVersions = useMemo(
    () => (q ? versions.filter((v) => v.key.toLowerCase().includes(q)) : versions),
    [versions, q],
  );

  const navigateTo = (depth: number) => {
    if (depth === 0) setPrefix('');
    else setPrefix(`${parts.slice(0, depth).join('/')}/`);
    setFilter('');
  };

  const enterFolder = (folderKey: string) => {
    setPrefix(folderKey);
    setFilter('');
  };

  const toggleSelected = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allSelected = filteredObjects.length > 0 && filteredObjects.every((o) => selected.has(o.key));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(filteredObjects.map((o) => o.key)));
  };

  const selectedObjects = useMemo(() => objects.filter((o) => selected.has(o.key)), [objects, selected]);

  const handleDownload = async (obj: S3ObjectInfo, versionId?: string) => {
    try {
      await downloadObject(bucket, obj.key, versionId);
    } catch (err) {
      toast('error', 'Download failed', errorMessage(err));
    }
  };

  const handleBatchDownload = async () => {
    try {
      for (let i = 0; i < selectedObjects.length; i += 1) {
        await downloadObject(bucket, selectedObjects[i].key);
        // Space downloads out so browsers don't treat them as a popup burst.
        if (i < selectedObjects.length - 1) await new Promise((r) => setTimeout(r, 350));
      }
      toast('success', 'Downloads started', `${selectedObjects.length} object${selectedObjects.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast('error', 'Download failed', errorMessage(err));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await s3Api.deleteObjects(bucket, deleteTarget.map((o) => ({ key: o.key })));
      toast('success', 'Deleted', `${deleteTarget.length} object${deleteTarget.length === 1 ? '' : 's'} removed.`);
      setDeleteTarget(null);
      setPanelTarget(null);
      await load();
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleVersionDelete = async () => {
    if (!versionDeleteTarget) return;
    setActionLoading(true);
    try {
      await s3Api.deleteObject(bucket, versionDeleteTarget.key, versionDeleteTarget.versionId);
      toast('success', 'Version deleted', versionDeleteTarget.versionId);
      setVersionDeleteTarget(null);
      setPanelVersion(null);
      await loadVersions();
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (!nextToken) return;
    const seq = ++loadSeq.current;
    const forPrefix = prefix;
    try {
      const res = await s3Api.listObjects(bucket, forPrefix, nextToken);
      if (seq !== loadSeq.current || prefixRef.current !== forPrefix) return;
      setFolders((prev) => [...prev, ...res.folders]);
      setObjects((prev) => [...prev, ...res.objects]);
      setNextToken(res.nextToken);
      setIsTruncated(res.isTruncated);
    } catch (err) {
      toast('error', 'Failed to load more', errorMessage(err));
    }
  };

  const handleVersionsLoadMore = async () => {
    if (!versionNext) return;
    const seq = ++loadSeq.current;
    const forPrefix = prefix;
    try {
      const res = await s3Api.listObjectVersions(bucket, forPrefix, versionNext);
      if (seq !== loadSeq.current || prefixRef.current !== forPrefix) return;
      setVersions((prev) => [...prev, ...res.versions]);
      setVersionNext(res.nextMarkers);
      setVersionsTruncated(res.isTruncated);
    } catch (err) {
      toast('error', 'Failed to load more', errorMessage(err));
    }
  };

  const deleteLabel = (items: S3ObjectInfo[]) =>
    items.length === 1 ? (
      <>
        Permanently delete {items[0].isFolder ? 'folder' : 'object'} <strong>{items[0].key}</strong>?{' '}
        {items[0].isFolder && 'Only the folder marker is deleted — its contents stay in place.'}
      </>
    ) : (
      <>
        Permanently delete <strong>{items.length} objects</strong>? This cannot be undone.
      </>
    );

  return (
    <div>
      {/* toolbar */}
      <div className="obj-toolbar">
        <div style={{ position: 'relative', width: '100%', maxWidth: 260 }}>
          <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
          <TextInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter objects…"
            style={{ paddingLeft: 30, height: 32, fontSize: 13 }}
          />
        </div>
        <button
          type="button"
          className={cx('versions-toggle', showVersions && 'versions-toggle-on')}
          onClick={() => setShowVersions((v) => !v)}
          title="Show or hide previous object versions"
        >
          <History size={14} />
          Show versions
        </button>
        <IconButton title="Refresh" onClick={refresh}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
        </IconButton>
      </div>

      {/* path breadcrumbs */}
      <div className="path-bar">
        <button type="button" className={cx('path-segment', parts.length === 0 && 'path-segment-current')} onClick={() => navigateTo(0)}>
          <FolderOpen size={13} />
          s3://{bucket}/
        </button>
        {parts.map((p, i) => (
          <span key={`${p}-${i}`} className="path-segment-wrap">
            <ChevronRight size={13} className="path-chevron" />
            <button
              type="button"
              className={cx('path-segment', i === parts.length - 1 && 'path-segment-current')}
              onClick={() => navigateTo(i + 1)}
            >
              {p}
            </button>
          </span>
        ))}
        {parts.length > 0 && (
          <IconButton title="Up one level" onClick={() => navigateTo(parts.length - 1)} style={{ marginLeft: 4 }}>
            <ArrowUp size={14} />
          </IconButton>
        )}
      </div>

      {/* selection bar */}
      {!showVersions && selectedObjects.length > 0 && (
        <div className="selection-bar">
          <CheckSquare size={15} style={{ color: 'var(--accent)' }} />
          <strong>{selectedObjects.length}</strong>
          <span className="muted">object{selectedObjects.length === 1 ? '' : 's'} selected</span>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="secondary" onClick={() => void handleBatchDownload()}>
            <Download size={13} /> Download
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setCopyTarget([...selectedObjects])}>
            <Copy size={13} /> Copy
          </Button>
          <Button size="sm" variant="danger" onClick={() => setDeleteTarget([...selectedObjects])}>
            <Trash2 size={13} /> Delete
          </Button>
        </div>
      )}

      {loading && (
        <div className="table-wrap">
          <SkeletonRows rows={7} />
        </div>
      )}

      {!loading && error && <div className="card"><ErrorState message={error} onRetry={refresh} /></div>}

      {!loading && !error && showVersions && (
        <div className="table-wrap">
          {filteredVersions.length === 0 ? (
            <EmptyState title="No versions" description="This bucket has versioning disabled, or this folder has no objects yet." />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Version ID</th>
                  <th>Status</th>
                  <th>Last modified</th>
                  <th className="num-cell">Size</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredVersions.map((v) => (
                  <tr key={`${v.key}-${v.versionId}`}>
                    <td className="obj-name-cell" onClick={() => setPanelVersion(v)}>
                      <span className="obj-name">
                        <span className={cx('obj-icon', v.isDeleteMarker && 'obj-icon-danger')}>
                          {v.isDeleteMarker ? <Trash2 size={15} /> : <FileText size={15} />}
                        </span>
                        {v.key.slice(prefix.length)}
                      </span>
                    </td>
                    <td className="mono version-id" title={v.versionId}>{v.versionId}</td>
                    <td>
                      {v.isDeleteMarker ? (
                        <Badge tone="dlq">Delete marker</Badge>
                      ) : v.isLatest ? (
                        <Badge tone="success">Latest</Badge>
                      ) : (
                        <Badge>Previous</Badge>
                      )}
                    </td>
                    <td>{v.lastModified ? new Date(v.lastModified).toLocaleString() : '—'}</td>
                    <td className="num-cell">{v.isDeleteMarker ? '—' : formatBytes(v.size)}</td>
                    <td>
                      <div className="row-actions">
                        {!v.isDeleteMarker && (
                          <IconButton title="Download this version" onClick={() => void handleDownload(versionToObject(v), v.versionId)}>
                            <Download size={15} />
                          </IconButton>
                        )}
                        <IconButton className="danger" title="Delete this version" onClick={() => setVersionDeleteTarget(v)}>
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {versionsTruncated && (
            <div className="load-more-row">
              <Button variant="secondary" size="sm" onClick={() => void handleVersionsLoadMore()}>
                <Layers size={13} />
                Load more versions
              </Button>
            </div>
          )}
        </div>
      )}

      {!loading && !error && !showVersions && (filteredFolders.length === 0 && filteredObjects.length === 0 ? (
        <div className="card">
          {q ? (
            <EmptyState title="No matching objects" description={`Nothing matches "${filter}" in this folder.`} />
          ) : (
            <EmptyState
              icon={<FolderOpen size={28} />}
              title={parts.length === 0 ? 'This bucket is empty' : 'This folder is empty'}
              description="Upload files or create a folder to get started."
              action={
                <>
                  <Button variant="primary" onClick={onUploadRequest}>
                    <Download size={15} /> Upload
                  </Button>
                  <Button variant="secondary" onClick={onFolderRequest}>
                    <FolderOpen size={15} /> Create folder
                  </Button>
                </>
              }
            />
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input type="checkbox" className="row-check" checked={allSelected} onChange={toggleAll} title="Select all objects" />
                </th>
                <th>Name</th>
                <th>Type</th>
                <th>Last modified</th>
                <th className="num-cell">Size</th>
                <th>Storage class</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFolders.map((f) => (
                <tr key={f.key}>
                  <td />
                  <td className="obj-name-cell" onClick={() => enterFolder(f.key)}>
                    <span className="obj-name">
                      <span className="obj-icon obj-icon-folder"><Folder size={15} /></span>
                      {f.key.slice(prefix.length).replace(/\/$/, '')}
                    </span>
                  </td>
                  <td><Badge>Folder</Badge></td>
                  <td><span className="muted">—</span></td>
                  <td className="num-cell"><span className="muted">—</span></td>
                  <td><span className="muted">—</span></td>
                  <td>
                    <div className="row-actions">
                      <IconButton title="Copy folder" onClick={() => setCopyTarget([f])}>
                        <Copy size={15} />
                      </IconButton>
                      <IconButton className="danger" title="Delete folder" onClick={() => setDeleteTarget([f])}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredObjects.map((o) => (
                <tr key={o.key}>
                  <td>
                    <input
                      type="checkbox"
                      className="row-check"
                      checked={selected.has(o.key)}
                      onChange={() => toggleSelected(o.key)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="obj-name-cell" onClick={() => setPanelTarget(o)}>
                    <span className="obj-name">
                      <span className="obj-icon"><FileText size={15} /></span>
                      {o.key.slice(prefix.length)}
                    </span>
                  </td>
                  <td><Badge>Object</Badge></td>
                  <td>{o.lastModified ? new Date(o.lastModified).toLocaleString() : '—'}</td>
                  <td className="num-cell">{formatBytes(o.size)}</td>
                  <td><StorageClassBadge storageClass={o.storageClass} /></td>
                  <td>
                    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton title="Download" onClick={() => void handleDownload(o)}>
                        <Download size={15} />
                      </IconButton>
                      <IconButton title="Copy" onClick={() => setCopyTarget([o])}>
                        <Copy size={15} />
                      </IconButton>
                      <IconButton className="danger" title="Delete" onClick={() => setDeleteTarget([o])}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isTruncated && (
            <div className="load-more-row">
              <Button variant="secondary" size="sm" onClick={() => void handleLoadMore()}>
                <Layers size={13} />
                Load more objects
              </Button>
            </div>
          )}
        </div>
      ))}

      {/* panel + dialogs */}
      {panelTarget && (
        <ObjectPanel
          bucket={bucket}
          object={panelTarget}
          onClose={() => setPanelTarget(null)}
          onChanged={() => void load()}
          onDownload={() => void handleDownload(panelTarget)}
          onCopy={() => {
            setCopyTarget([panelTarget]);
            setPanelTarget(null);
          }}
          onDelete={() => {
            setDeleteTarget([panelTarget]);
            setPanelTarget(null);
          }}
        />
      )}

      {panelVersion && (
        <ObjectPanel
          bucket={bucket}
          object={versionToObject(panelVersion)}
          version={panelVersion}
          onClose={() => setPanelVersion(null)}
          onChanged={() => void loadVersions()}
          onDownload={() => void handleDownload(versionToObject(panelVersion), panelVersion.versionId)}
          onCopy={() => {
            setPanelVersion(null);
            setCopyTarget([versionToObject(panelVersion)]);
          }}
          onDelete={() => {
            setVersionDeleteTarget(panelVersion);
            setPanelVersion(null);
          }}
        />
      )}

      {copyTarget && (
        <CopyDialog
          open
          items={copyTarget}
          bucket={bucket}
          onClose={() => setCopyTarget(null)}
          onCopied={() => {
            setCopyTarget(null);
            void load();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete objects?"
        message={deleteTarget ? deleteLabel(deleteTarget) : null}
        confirmLabel={deleteTarget && deleteTarget.length > 1 ? `Delete ${deleteTarget.length} objects` : 'Delete'}
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!versionDeleteTarget}
        title="Delete version?"
        message={
          <>
            Permanently delete version <strong className="mono">{versionDeleteTarget?.versionId}</strong> of{' '}
            <strong>{versionDeleteTarget?.key}</strong>? {versionDeleteTarget?.isDeleteMarker && 'This removes the delete marker and restores the previous version.'}
          </>
        }
        confirmLabel="Delete version"
        loading={actionLoading}
        onConfirm={() => void handleVersionDelete()}
        onClose={() => setVersionDeleteTarget(null)}
      />
    </div>
  );
});
