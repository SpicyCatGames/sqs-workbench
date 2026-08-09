import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FunctionSquare, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { lambdaApi, type LambdaFunctionSummary } from '../../lib/lambdaApi';
import { errorMessage, useToast } from '../../lib/context';
import { formatBytes } from '../../lib/format';
import { Button, EmptyState, ErrorState, IconButton, SkeletonRows, TextInput } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ArchitectureBadge, FunctionStateBadge, RuntimeBadge, formatIso, useReload } from './LambdaUi';

export function FunctionsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [functions, setFunctions] = useState<LambdaFunctionSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<LambdaFunctionSummary | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { loading, error, load } = useReload(async () => {
    const res = await lambdaApi.listFunctions();
    setFunctions(res.functions);
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return functions;
    return functions.filter(
      (fn) =>
        fn.functionName.toLowerCase().includes(q) ||
        fn.description.toLowerCase().includes(q) ||
        fn.runtime.toLowerCase().includes(q) ||
        Object.keys(fn.tags).some((k) => k.toLowerCase().includes(q) || (fn.tags[k] ?? '').toLowerCase().includes(q)),
    );
  }, [functions, filter]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await lambdaApi.deleteFunction(deleteTarget.functionName);
      toast('success', 'Function deleted', `${deleteTarget.functionName} removed.`);
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
          <h1 className="page-title">Functions</h1>
          <p className="page-description">
            Lambda functions on the configured endpoint. Select a function to inspect its code, run tests, manage versions, aliases, triggers and tags.
          </p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => void load()} disabled={loading} title="Refresh">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Refresh
          </Button>
          <Button variant="primary" onClick={() => navigate('/lambda/create')}>
            <Plus size={15} />
            Create function
          </Button>
        </div>
      </div>

      <div className="filter-bar">
        <div style={{ position: 'relative', width: '100%', maxWidth: 320 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
          <TextInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter functions by name, runtime, description or tag…"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <span className="muted" style={{ alignSelf: 'center', fontSize: 12.5 }}>
          {filtered.length} of {functions.length} function{functions.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading && (
        <div className="table-wrap">
          <SkeletonRows rows={7} />
        </div>
      )}

      {!loading && error && <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>}

      {!loading && !error && functions.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<FunctionSquare size={28} />}
            title="No functions yet"
            description="Create your first Lambda function to run code without provisioning servers."
            action={
              <Button variant="primary" onClick={() => navigate('/lambda/create')}>
                <Plus size={15} />
                Create function
              </Button>
            }
          />
        </div>
      )}

      {!loading && !error && functions.length > 0 && filtered.length === 0 && (
        <div className="card">
          <EmptyState title="No matching functions" description={`Nothing matches "${filter}".`} />
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Function name</th>
                <th>Runtime</th>
                <th>Architectures</th>
                <th>Description</th>
                <th className="num-cell">Code size</th>
                <th>Last modified</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((fn) => (
                <tr key={fn.functionArn}>
                  <td className="queue-name-cell" onClick={() => navigate(`/lambda/functions/${encodeURIComponent(fn.functionName)}`)}>
                    <div className="qname">{fn.functionName}</div>
                    <div className="qurl">
                      <FunctionStateBadge state={fn.state} /> {fn.functionArn}
                    </div>
                  </td>
                  <td><RuntimeBadge runtime={fn.runtime} /></td>
                  <td><ArchitectureBadge architectures={fn.architectures} /></td>
                  <td style={{ maxWidth: 240 }}>{fn.description || <span className="muted">—</span>}</td>
                  <td className="num-cell">{formatBytes(fn.codeSize)}</td>
                  <td>{formatIso(fn.lastModified)}</td>
                  <td>
                    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton className="danger" title="Delete function" onClick={() => setDeleteTarget(fn)}>
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
        Tip: click a function row to open its console — view code, invoke tests, edit configuration, add triggers, publish versions and manage aliases.
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete function?"
        message={
          <>
            Permanently delete function <strong>{deleteTarget?.functionName}</strong>? All versions, aliases and event source mappings are removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete function"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
