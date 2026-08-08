import { useMemo, useState } from 'react';
import { Archive, Plus, Trash2 } from 'lucide-react';
import { dynamoApi, type DynamoBackup, type DynamoTable } from '../../lib/dynamoApi';
import { isUnsupportedOperation } from '../../lib/snsApi';
import { errorMessage, useToast } from '../../lib/context';
import { formatBytes } from '../../lib/format';
import { Badge, Button, EmptyState, Field, IconButton, Modal, SkeletonRows, TextInput } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { UnsupportedBanner } from '../sns/SnsUi';
import { useReload } from './DynamoUi';

interface Props {
  table: DynamoTable;
}

export function BackupsTab({ table }: Props) {
  const { toast } = useToast();
  const [backups, setBackups] = useState<DynamoBackup[]>([]);
  const [unsupported, setUnsupported] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DynamoBackup | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { loading, error, load } = useReload(async () => {
    setUnsupported(false);
    try {
      const res = await dynamoApi.listBackups(table.name);
      setBackups(res.backups);
    } catch (err) {
      if (isUnsupportedOperation(err)) {
        setUnsupported(true);
      } else {
        throw err;
      }
    }
  });

  const tableBackups = useMemo(() => backups.filter((b) => b.tableName === table.name), [backups, table.name]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await dynamoApi.deleteBackup(deleteTarget.backupArn);
      toast('success', 'Backup deleted', `${deleteTarget.backupName} removed.`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const totalSize = useMemo(() => tableBackups.reduce((sum, b) => sum + (b.sizeBytes ?? 0), 0), [tableBackups]);

  return (
    <div className="prop-stack">
      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <div>
            <h3 className="card-title">Backups</h3>
            <p className="card-subtitle">On-demand backups of {table.name}. Backups are stored until you delete them.</p>
          </div>
          <span style={{ flex: 1 }} />
          {!unsupported && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus size={14} />
              Create backup
            </Button>
          )}
        </div>

        {loading && (
          <div className="table-wrap">
            <SkeletonRows rows={3} />
          </div>
        )}

        {!loading && unsupported && (
          <>
            <UnsupportedBanner>
              The configured endpoint does not implement the DynamoDB backup APIs ({'ListBackups'}, {'CreateBackup'}, {'DeleteBackup'}). Backups are available against real AWS.
            </UnsupportedBanner>
            <EmptyState
              icon={<Archive size={26} />}
              title="Backups are not available"
              description="This feature requires an endpoint that supports on-demand backups."
            />
          </>
        )}

        {!loading && !unsupported && error && <div className="inline-error">{error}</div>}

        {!loading && !unsupported && !error && tableBackups.length === 0 && (
          <EmptyState
            icon={<Archive size={26} />}
            title="No backups yet"
            description="Create an on-demand backup to protect this table against accidental changes or deletions."
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus size={14} />
                Create backup
              </Button>
            }
          />
        )}

        {!loading && !unsupported && !error && tableBackups.length > 0 && (
          <>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
              {tableBackups.length} backup{tableBackups.length === 1 ? '' : 's'} · {formatBytes(totalSize)} total
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Backup name</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th className="num-cell">Size</th>
                    <th>Creation date</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tableBackups.map((b) => (
                    <tr key={b.backupArn}>
                      <td>
                        <div className="qname">{b.backupName}</div>
                        <div className="qurl mono">{b.backupArn}</div>
                      </td>
                      <td>
                        {b.status === 'AVAILABLE' ? <Badge tone="success">Available</Badge> : b.status === 'CREATING' ? <Badge tone="warn">Creating</Badge> : <Badge tone="dlq">{b.status ?? '—'}</Badge>}
                      </td>
                      <td>{b.type === 'USER' ? 'On-demand' : (b.type ?? '—')}</td>
                      <td className="num-cell">{b.sizeBytes != null ? formatBytes(b.sizeBytes) : '—'}</td>
                      <td>{b.creationDate ? new Date(b.creationDate).toLocaleString() : '—'}</td>
                      <td>
                        <div className="row-actions">
                          <IconButton className="danger" title="Delete backup" onClick={() => setDeleteTarget(b)}>
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="card card-pad">
        <h3 className="card-title" style={{ marginBottom: 6 }}>About on-demand backups</h3>
        <p className="card-subtitle" style={{ lineHeight: 1.6 }}>
          On-demand backups create full copies of the table and its data, indexes, and settings. They have no impact on table performance or
          availability while running. Restore to any point in time is not available on the configured endpoint.
        </p>
      </div>

      <CreateBackupDialog
        open={createOpen}
        tableName={table.name}
        onClose={() => setCreateOpen(false)}
        onCreated={(name) => {
          toast('success', 'Backup creation started', name);
          setCreateOpen(false);
          void load();
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete backup?"
        message={
          <>
            Permanently delete backup <strong>{deleteTarget?.backupName}</strong> of table <strong>{deleteTarget?.tableName}</strong>? This cannot be undone.
          </>
        }
        confirmLabel="Delete backup"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function CreateBackupDialog({
  open,
  tableName,
  onClose,
  onCreated,
}: {
  open: boolean;
  tableName: string;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await dynamoApi.createBackup(tableName, name);
      onCreated(name.trim());
      onClose();
      setName('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Create backup"
      subtitle={`Create an on-demand backup of ${tableName}.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={!name.trim() || saving} loading={saving}>
            Create backup
          </Button>
        </>
      }
    >
      <Field label="Backup name" hint="A friendly name for this backup. Backup names must be unique within the account.">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={`${tableName}-backup`} spellCheck={false} />
      </Field>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
        Table: <span className="mono">{tableName}</span> · Region: all backups are stored in the same region as the table.
      </div>
      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}
