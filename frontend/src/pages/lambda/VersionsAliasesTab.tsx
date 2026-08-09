import { useEffect, useState } from 'react';
import { GitBranch, Pencil, Plus, Trash2 } from 'lucide-react';
import { lambdaApi, type FunctionDetail, type LambdaAlias, type LambdaVersion } from '../../lib/lambdaApi';
import { errorMessage, useToast } from '../../lib/context';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Modal, Select, SkeletonRows, TextInput } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatIso } from './LambdaUi';

interface Props {
  fn: FunctionDetail;
}

export function VersionsAliasesTab({ fn }: Props) {
  const { toast } = useToast();
  const [versions, setVersions] = useState<LambdaVersion[]>([]);
  const [aliases, setAliases] = useState<LambdaAlias[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [createAliasOpen, setCreateAliasOpen] = useState(false);
  const [editAlias, setEditAlias] = useState<LambdaAlias | null>(null);
  const [deleteAlias, setDeleteAlias] = useState<LambdaAlias | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [v, a] = await Promise.all([lambdaApi.listVersions(fn.functionName), lambdaApi.listAliases(fn.functionName)]);
      setVersions(v.versions);
      setAliases(a.aliases);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn.functionName]);

  const handleDeleteAlias = async () => {
    if (!deleteAlias) return;
    setActionLoading(true);
    try {
      await lambdaApi.deleteAlias(fn.functionName, deleteAlias.name);
      toast('success', 'Alias deleted', deleteAlias.name);
      setDeleteAlias(null);
      await load();
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const versionOptions = versions.filter((v) => v.version !== '$LATEST').map((v) => v.version);

  return (
    <div className="prop-stack">
      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 12 }}>
          <h3 className="card-title">Versions</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>{versions.length} version{versions.length === 1 ? '' : 's'}</span>
          <span style={{ flex: 1 }} />
          <Button variant="primary" size="sm" onClick={() => setPublishOpen(true)}>
            <Plus size={13} />
            Publish new version
          </Button>
        </div>
        <p className="card-subtitle" style={{ marginBottom: 12 }}>
          Publishing snapshots the current <span className="mono">$LATEST</span> code and configuration as an immutable version. Aliases and qualifiers can point at a version.
        </p>

        {loading && <SkeletonRows rows={4} />}
        {!loading && error && <ErrorState message={error} onRetry={() => void load()} />}

        {!loading && !error && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Description</th>
                  <th>State</th>
                  <th>Last modified</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.version}>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {v.version === '$LATEST' ? (
                        <>
                          <span className="mono">$LATEST</span> <Badge tone="warn">Unpublished</Badge>
                        </>
                      ) : (
                        v.version
                      )}
                    </td>
                    <td>{v.description || <span className="muted">—</span>}</td>
                    <td>{v.state ?? '—'}</td>
                    <td>{formatIso(v.lastModified)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 12 }}>
          <h3 className="card-title">Aliases</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>{aliases.length} alias{aliases.length === 1 ? '' : 'es'}</span>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" size="sm" onClick={() => setCreateAliasOpen(true)} disabled={versionOptions.length === 0}>
            <Plus size={13} />
            Create alias
          </Button>
        </div>
        <p className="card-subtitle" style={{ marginBottom: 12 }}>
          An alias is a pointer to a version — invoke it through <span className="mono">function:alias</span> and repoint it without changing callers.
        </p>

        {!loading && !error && aliases.length === 0 && (
          <EmptyState
            title="No aliases"
            description={versionOptions.length === 0 ? 'Publish a version first — aliases must point at a published version.' : 'Create an alias to reference a published version by name.'}
            action={
              versionOptions.length === 0 ? undefined : (
                <Button variant="primary" onClick={() => setCreateAliasOpen(true)}>
                  <Plus size={13} />
                  Create alias
                </Button>
              )
            }
          />
        )}

        {!loading && !error && aliases.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Version</th>
                  <th>Description</th>
                  <th>ARN</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {aliases.map((a) => (
                  <tr key={a.name}>
                    <td className="mono" style={{ fontWeight: 600 }}>{a.name}</td>
                    <td className="mono">{a.functionVersion}</td>
                    <td>{a.description || <span className="muted">—</span>}</td>
                    <td className="mono" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.arn}</td>
                    <td>
                      <div className="row-actions">
                        <IconButton title="Edit alias" onClick={() => setEditAlias(a)}>
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton className="danger" title="Delete alias" onClick={() => setDeleteAlias(a)}>
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
      </div>

      {publishOpen && (
        <PublishDialog
          fn={fn}
          onClose={() => setPublishOpen(false)}
          onPublished={() => {
            toast('success', 'Version published');
            setPublishOpen(false);
            void load();
          }}
        />
      )}

      {createAliasOpen && (
        <AliasDialog
          fn={fn}
          versions={versionOptions}
          onClose={() => setCreateAliasOpen(false)}
          onSaved={() => {
            toast('success', 'Alias created');
            setCreateAliasOpen(false);
            void load();
          }}
        />
      )}

      {editAlias && (
        <AliasDialog
          fn={fn}
          versions={versionOptions}
          initial={editAlias}
          onClose={() => setEditAlias(null)}
          onSaved={() => {
            toast('success', 'Alias updated', `${editAlias.name} repointed.`);
            setEditAlias(null);
            void load();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteAlias}
        title="Delete alias?"
        message={
          <>
            Delete alias <strong>{deleteAlias?.name}</strong>? The underlying versions are not deleted.
          </>
        }
        confirmLabel="Delete alias"
        loading={actionLoading}
        onConfirm={() => void handleDeleteAlias()}
        onClose={() => setDeleteAlias(null)}
      />
    </div>
  );
}

// ------------------------------------------------------------- dialogs

function PublishDialog({ fn, onClose, onPublished }: { fn: FunctionDetail; onClose: () => void; onPublished: () => void }) {
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handlePublish = async () => {
    setSaving(true);
    setError('');
    try {
      await lambdaApi.publishVersion(fn.functionName, description);
      onPublished();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Publish new version"
      subtitle={`${fn.functionName} · snapshots $LATEST`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handlePublish()} loading={saving}>
            Publish
          </Button>
        </>
      }
    >
      <Field label="Version description - optional">
        <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. initial release" spellCheck={false} />
      </Field>
      <div className="inline-info" style={{ marginBottom: 0 }}>
        <GitBranch size={16} />
        <span>The new version is immutable — publishing again after code changes creates the next version number.</span>
      </div>
      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}

function AliasDialog({
  fn,
  versions,
  initial,
  onClose,
  onSaved,
}: {
  fn: FunctionDetail;
  versions: string[];
  initial?: LambdaAlias;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [version, setVersion] = useState(initial?.functionVersion ?? versions[0] ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      if (initial) {
        await lambdaApi.updateAlias(fn.functionName, initial.name, version, description);
      } else {
        await lambdaApi.createAlias(fn.functionName, name, version, description);
      }
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
      title={initial ? 'Edit alias' : 'Create alias'}
      subtitle={`${fn.functionName} · alias points to a version`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving} disabled={!initial && !name.trim()}>
            {initial ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      {!initial && (
        <Field label="Alias name" hint="Used to invoke the function as name:alias.">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="live" spellCheck={false} className="mono" />
        </Field>
      )}
      <Field label="Version">
        <Select value={version} onChange={(e) => setVersion(e.target.value)}>
          {versions.map((v) => (
            <option key={v} value={v}>
              Version {v}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Description - optional">
        <TextInput value={description} onChange={(e) => setDescription(e.target.value)} spellCheck={false} />
      </Field>
      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}
