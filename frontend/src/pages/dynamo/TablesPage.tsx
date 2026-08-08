import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Plus, RefreshCw, Rows3, Search, Trash2 } from 'lucide-react';
import { dynamoApi, type DynamoTable } from '../../lib/dynamoApi';
import { errorMessage, useToast } from '../../lib/context';
import { formatBytes, formatNumber } from '../../lib/format';
import { Button, EmptyState, ErrorState, IconButton, SkeletonRows, Stat, TextInput } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CapacityModeBadge, TableStatusBadge, useReload } from './DynamoUi';
import { CreateTableDialog } from './CreateTableDialog';

export function TablesPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tables, setTables] = useState<DynamoTable[]>([]);
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DynamoTable | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { loading, error, load } = useReload(async () => {
    const res = await dynamoApi.listTables();
    setTables(res.tables);
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, filter]);

  const totals = useMemo(() => {
    let items = 0;
    let size = 0;
    for (const t of tables) {
      items += t.itemCount ?? 0;
      size += t.tableSizeBytes ?? 0;
    }
    return { items, size };
  }, [tables]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await dynamoApi.deleteTable(deleteTarget.name);
      toast('success', 'Table deleted', `${deleteTarget.name} removed.`);
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
          <h1 className="page-title">Tables</h1>
          <p className="page-description">
            DynamoDB tables on the configured endpoint. Select a table to explore items, indexes, backups and configuration.
          </p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => void load()} disabled={loading} title="Refresh">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Refresh
          </Button>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={15} />
            Create table
          </Button>
        </div>
      </div>

      {!loading && !error && (
        <div className="stats-row">
          <Stat label="Tables" value={formatNumber(tables.length)} icon={<Database size={17} />} />
          <Stat label="Total items" value={formatNumber(totals.items)} icon={<Rows3 size={17} />} />
          <Stat label="Total size" value={formatBytes(totals.size)} icon={<Database size={17} />} />
        </div>
      )}

      <div className="filter-bar">
        <div style={{ position: 'relative', width: '100%', maxWidth: 320 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
          <TextInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tables by name…"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <span className="muted" style={{ alignSelf: 'center', fontSize: 12.5 }}>
          {filtered.length} of {tables.length} table{tables.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading && (
        <div className="table-wrap">
          <SkeletonRows rows={7} />
        </div>
      )}

      {!loading && error && <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>}

      {!loading && !error && tables.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<Database size={28} />}
            title="No tables yet"
            description="Create your first DynamoDB table to start storing and querying items."
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus size={15} />
                Create table
              </Button>
            }
          />
        </div>
      )}

      {!loading && !error && tables.length > 0 && filtered.length === 0 && (
        <div className="card">
          <EmptyState title="No matching tables" description={`Nothing matches "${filter}".`} />
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Table name</th>
                <th>Status</th>
                <th>Capacity mode</th>
                <th className="num-cell">Item count</th>
                <th className="num-cell">Size</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.name}>
                  <td className="queue-name-cell" onClick={() => navigate(`/dynamo/tables/${encodeURIComponent(t.name)}`)}>
                    <div className="qname">{t.name}</div>
                    <div className="qurl">{t.arn ?? `arn:aws:dynamodb:${t.region}:000000000000:table/${t.name}`}</div>
                  </td>
                  <td><TableStatusBadge status={t.status} /></td>
                  <td><CapacityModeBadge mode={t.billingMode} /></td>
                  <td className="num-cell">{formatNumber(t.itemCount)}</td>
                  <td className="num-cell">{formatBytes(t.tableSizeBytes ?? 0)}</td>
                  <td>
                    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton className="danger" title="Delete table" onClick={() => setDeleteTarget(t)}>
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
        Tip: click a table row to open its console — explore items with scans and queries, create items, manage indexes, backups and tags.
      </div>

      <CreateTableDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(name) => {
          toast('success', 'Table created', name);
          void load();
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete table?"
        message={
          <>
            Permanently delete table <strong>{deleteTarget?.name}</strong> and all of its items, indexes and backups? This cannot be undone.
          </>
        }
        confirmLabel="Delete table"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
