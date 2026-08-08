import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { s3Api, type BucketItem } from '../../lib/s3Api';
import { errorMessage, useToast } from '../../lib/context';
import { Button, EmptyState, ErrorState, IconButton, SkeletonRows, TextInput } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CreateBucketDialog } from './CreateBucketDialog';
import { regionLabel } from './S3Ui';

export function BucketsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [buckets, setBuckets] = useState<BucketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BucketItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await s3Api.listBuckets();
      setBuckets(res.buckets);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return buckets;
    return buckets.filter((b) => b.name.toLowerCase().includes(q));
  }, [buckets, filter]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await s3Api.deleteBucket(deleteTarget.name);
      toast('success', 'Bucket deleted', `${deleteTarget.name} removed.`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Buckets</h1>
          <p className="page-description">S3 buckets on the configured endpoint. Select a bucket to view its objects and configuration.</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => void load()} disabled={loading} title="Refresh">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Refresh
          </Button>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={15} />
            Create bucket
          </Button>
        </div>
      </div>

      <div className="filter-bar">
        <div style={{ position: 'relative', width: '100%', maxWidth: 320 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
          <TextInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter buckets by name…"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <span className="muted" style={{ alignSelf: 'center', fontSize: 12.5 }}>
          {filtered.length} of {buckets.length} bucket{buckets.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading && (
        <div className="table-wrap">
          <SkeletonRows rows={7} />
        </div>
      )}

      {!loading && error && <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>}

      {!loading && !error && buckets.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<Archive size={28} />}
            title="No buckets yet"
            description="Create your first S3 bucket to start storing objects."
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus size={15} />
                Create bucket
              </Button>
            }
          />
        </div>
      )}

      {!loading && !error && buckets.length > 0 && filtered.length === 0 && (
        <div className="card">
          <EmptyState title="No matching buckets" description={`Nothing matches "${filter}".`} />
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Region</th>
                <th>Creation date</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.name}>
                  <td className="queue-name-cell" onClick={() => navigate(`/s3/buckets/${encodeURIComponent(b.name)}`)}>
                    <div className="qname">{b.name}</div>
                    <div className="qurl">arn:aws:s3:::{b.name}</div>
                  </td>
                  <td>{b.region ? regionLabel(b.region) : <span className="muted">—</span>}</td>
                  <td>{b.creationDate ? new Date(b.creationDate).toLocaleString() : <span className="muted">—</span>}</td>
                  <td>
                    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton className="danger" title="Delete bucket" onClick={() => setDeleteTarget(b)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="muted" style={{ marginTop: 14, fontSize: 12 }}>
        Tip: click a bucket row to open its console — upload and manage objects, enable versioning, and configure permissions, CORS and tags.
      </div>

      <CreateBucketDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(name) => {
          toast('success', 'Bucket created', name);
          void load();
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete bucket?"
        message={
          <>
            Permanently delete bucket <strong>{deleteTarget?.name}</strong> and all of its objects, versions and configurations? This cannot be undone.
          </>
        }
        confirmLabel="Delete bucket"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
