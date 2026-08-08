import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Activity, Archive, Gauge, ListTree, Plus, Rows3, Tags as TagsIcon, Trash2 } from 'lucide-react';
import { dynamoApi, type DynamoTable } from '../../lib/dynamoApi';
import { errorMessage, useToast } from '../../lib/context';
import { Badge, Button, ErrorState, SkeletonRows, Tabs, type TabDef } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ArnText } from '../sns/SnsUi';
import { CapacityModeBadge, TableStatusBadge, useReload } from './DynamoUi';
import { OverviewTab } from './OverviewTab';
import { ItemsTab } from './ItemsTab';
import { IndexesTab } from './IndexesTab';
import { BackupsTab } from './BackupsTab';
import { TagsTab } from './TagsTab';
import { MonitorTab } from './MonitorTab';

export function TableDetailPage() {
  const { name } = useParams<{ name: string }>();
  const tableName = name ?? '';
  const navigate = useNavigate();
  const { toast } = useToast();

  const [table, setTable] = useState<DynamoTable | null>(null);
  const [tab, setTab] = useState('overview');
  const [createSignal, setCreateSignal] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const { loading, error, load } = useReload(async () => {
    setTable(await dynamoApi.getTable(tableName));
  }, [tableName]);

  const TABS: TabDef[] = [
    { id: 'overview', label: 'Overview', icon: <Gauge size={14} /> },
    { id: 'items', label: 'Items', icon: <Rows3 size={14} /> },
    { id: 'indexes', label: 'Indexes', icon: <ListTree size={14} /> },
    { id: 'backups', label: 'Backups', icon: <Archive size={14} /> },
    { id: 'tags', label: 'Tags', icon: <TagsIcon size={14} /> },
    { id: 'monitor', label: 'Monitor', icon: <Activity size={14} /> },
  ];

  const openCreateItem = () => {
    setTab('items');
    setCreateSignal((n) => n + 1);
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try {
      await dynamoApi.deleteTable(tableName);
      toast('success', 'Table deleted', tableName);
      navigate('/dynamo');
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/dynamo">DynamoDB</Link>
        <span className="sep">/</span>
        <Link to="/dynamo">Tables</Link>
        <span className="sep">/</span>
        <span>{tableName}</span>
      </div>

      <div className="detail-header-card">
        <div style={{ minWidth: 0 }}>
          <div className="detail-title-row">
            <h1 className="detail-name">{tableName}</h1>
            {table && <TableStatusBadge status={table.status} />}
            {table && <CapacityModeBadge mode={table.billingMode} />}
            <Badge>{table?.region ?? '…'}</Badge>
          </div>
          <div className="detail-meta">
            <span>
              <ArnText arn={table?.arn ?? null} />
            </span>
            <span>
              Created {table?.creationDate ? new Date(table.creationDate).toLocaleString() : '—'} · {table?.itemCount ?? 0} item{table?.itemCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="page-actions">
          <Button variant="primary" onClick={openCreateItem} disabled={!table}>
            <Plus size={14} />
            Create item
          </Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={!table}>
            <Trash2 size={14} />
            Delete table
          </Button>
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {loading && (
        <div className="table-wrap">
          <SkeletonRows rows={7} />
        </div>
      )}

      {!loading && error && (
        <div className="card">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      )}

      {!loading && !error && table && tab === 'overview' && (
        <OverviewTab
          table={table}
          onChanged={() => void load()}
          onGoToIndexes={() => setTab('indexes')}
          onGoToTags={() => setTab('tags')}
        />
      )}

      {!loading && !error && table && tab === 'items' && (
        <ItemsTab table={table} createSignal={createSignal} onDataChanged={() => void load()} />
      )}

      {!loading && !error && table && tab === 'indexes' && <IndexesTab table={table} onChanged={() => void load()} />}

      {!loading && !error && table && tab === 'backups' && <BackupsTab table={table} />}

      {!loading && !error && table && tab === 'tags' && <TagsTab table={table} onChanged={() => void load()} />}

      {!loading && !error && table && tab === 'monitor' && <MonitorTab table={table} />}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete table?"
        message={
          <>
            Permanently delete table <strong>{tableName}</strong> and all of its items, indexes and backups? This cannot be undone.
            {table?.deletionProtectionEnabled ? (
              <div className="inline-info" style={{ marginTop: 10, marginBottom: 0, alignItems: 'center' }}>
                Deletion protection is enabled on this table — turn it off (via the capacity settings) before deleting.
              </div>
            ) : null}
          </>
        }
        confirmLabel="Delete table"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
