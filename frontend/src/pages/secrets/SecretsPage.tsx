import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { secretsManagerApi, type SmSecret } from '../../lib/secretsManagerApi';
import { errorMessage, useToast } from '../../lib/context';
import { Button, EmptyState, ErrorState, IconButton, SkeletonRows, TextInput } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatDate, RotationBadge, useReload } from './SecretsUi';

export function SecretsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [secrets, setSecrets] = useState<SmSecret[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<SmSecret | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const { loading, error, load } = useReload(async () => {
    const res = await secretsManagerApi.listSecrets();
    setSecrets(res.secrets);
    setSelected(new Set());
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return secrets;
    return secrets.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        s.arn.toLowerCase().includes(q) ||
        Object.keys(s.tags).some((k) => k.toLowerCase().includes(q) || (s.tags[k] ?? '').toLowerCase().includes(q)),
    );
  }, [secrets, filter]);

  const toggleSelect = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((s) => s.name))));
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await secretsManagerApi.deleteSecret(deleteTarget.name, { recoveryWindowInDays: 7 });
      toast('success', 'Secret scheduled for deletion', `${deleteTarget.name} will be permanently deleted after 7 days.`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    setActionLoading(true);
    let ok = 0;
    let failed = 0;
    for (const name of selected) {
      try {
        await secretsManagerApi.deleteSecret(name, { recoveryWindowInDays: 7 });
        ok++;
      } catch {
        failed++;
      }
    }
    toast('success', 'Secrets scheduled for deletion', `${ok} deleted, ${failed} failed.`);
    setBulkDeleteOpen(false);
    await load();
    setActionLoading(false);
  };

  const shown = filtered.length;
  const allSelected = shown > 0 && selected.size === shown;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Secrets</h1>
          <p className="page-description">Secrets Manager stores and rotates database credentials, API keys and other secrets on the configured endpoint.</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => void load()} disabled={loading} title="Refresh">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Refresh
          </Button>
          <Button variant="primary" onClick={() => navigate('/secrets/create')}>
            <Plus size={15} />
            Store a new secret
          </Button>
        </div>
      </div>

      <div className="filter-bar">
        <div style={{ position: 'relative', width: '100%', maxWidth: 320 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
          <TextInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter secrets by name, description, ARN or tag…"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <span className="muted" style={{ alignSelf: 'center', fontSize: 12.5 }}>
          {filtered.length} of {secrets.length} secret{secrets.length === 1 ? '' : 's'}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="selection-bar">
          <span>
            <strong>{selected.size}</strong> secret{selected.size === 1 ? '' : 's'} selected
          </span>
          <span style={{ flex: 1 }} />
          <Button variant="danger" size="sm" onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 size={13} />
            Delete
          </Button>
        </div>
      )}

      {loading && (
        <div className="table-wrap">
          <SkeletonRows rows={7} />
        </div>
      )}

      {!loading && error && <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>}

      {!loading && !error && secrets.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<KeyRound size={28} />}
            title="No secrets yet"
            description="Store your first secret — database credentials, API keys or any other sensitive value."
            action={
              <Button variant="primary" onClick={() => navigate('/secrets/create')}>
                <Plus size={15} />
                Store a new secret
              </Button>
            }
          />
        </div>
      )}

      {!loading && !error && secrets.length > 0 && filtered.length === 0 && (
        <div className="card">
          <EmptyState title="No matching secrets" description={`Nothing matches "${filter}".`} />
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" className="row-check" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th>Name</th>
                <th>Description</th>
                <th>Rotation</th>
                <th>Last changed</th>
                <th>Last accessed</th>
                <th>Tags</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.name}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="row-check" checked={selected.has(s.name)} onChange={() => toggleSelect(s.name)} aria-label={`Select ${s.name}`} />
                  </td>
                  <td className="queue-name-cell" onClick={() => navigate(`/secrets/secret/${encodeURIComponent(s.name)}`)}>
                    <div className="qname">{s.name}</div>
                    <div className="qurl">{s.arn}</div>
                  </td>
                  <td style={{ maxWidth: 260 }}>{s.description || <span className="muted">—</span>}</td>
                  <td><RotationBadge enabled={s.rotationEnabled} /></td>
                  <td>{formatDate(s.lastChangedDate)}</td>
                  <td>{formatDate(s.lastAccessedDate)}</td>
                  <td>
                    {Object.entries(s.tags).length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      <span className="tag-chips" style={{ maxWidth: 220 }}>
                        {Object.entries(s.tags).slice(0, 2).map(([k, v]) => (
                          <span key={k} className="tag-chip" style={{ fontSize: 11.5 }}>
                            <span className="tag-chip-key">{k}</span>
                            {v && <span className="tag-chip-value">{v}</span>}
                          </span>
                        ))}
                        {Object.keys(s.tags).length > 2 && <span className="muted" style={{ fontSize: 11.5 }}>+{Object.keys(s.tags).length - 2}</span>}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton className="danger" title="Delete secret" onClick={() => setDeleteTarget(s)}>
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
        Tip: click a secret row to retrieve its value, manage versions, rotation, resource permissions and tags.
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete secret?"
        message={
          <>
            Schedule <strong>{deleteTarget?.name}</strong> for deletion? The secret stays recoverable for 7 days, then is permanently deleted.
          </>
        }
        confirmLabel="Schedule deletion"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={`Delete ${selected.size} secrets?`}
        message={
          <>
            Schedule <strong>{selected.size}</strong> selected secret{selected.size === 1 ? '' : 's'} for deletion? They stay recoverable for 7 days.
          </>
        }
        confirmLabel="Schedule deletion"
        loading={actionLoading}
        onConfirm={() => void handleBulkDelete()}
        onClose={() => setBulkDeleteOpen(false)}
      />
    </div>
  );
}
