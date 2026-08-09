import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Activity, Braces, Code2, FileKey, GitBranch, Plug, Settings2, Tags as TagsIcon, Trash2, Zap } from 'lucide-react';
import { lambdaApi, type FunctionDetail } from '../../lib/lambdaApi';
import { errorMessage, useToast } from '../../lib/context';
import { Button, ErrorState, SkeletonRows, Tabs, type TabDef } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ArnText } from '../sns/SnsUi';
import { ArchitectureBadge, FunctionStateBadge, RuntimeBadge, useReload } from './LambdaUi';
import { OverviewTab } from './OverviewTab';
import { CodeTab } from './CodeTab';
import { TestTab, InvokeDialog } from './TestTab';
import { ConfigurationTab } from './ConfigurationTab';
import { TriggersTab } from './TriggersTab';
import { PermissionsTab } from './PermissionsTab';
import { VersionsAliasesTab } from './VersionsAliasesTab';
import { TagsTab } from './TagsTab';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: <Activity size={14} /> },
  { id: 'code', label: 'Code', icon: <Code2 size={14} /> },
  { id: 'test', label: 'Test', icon: <Braces size={14} /> },
  { id: 'configuration', label: 'Configuration', icon: <Settings2 size={14} /> },
  { id: 'triggers', label: 'Triggers', icon: <Plug size={14} /> },
  { id: 'permissions', label: 'Permissions', icon: <FileKey size={14} /> },
  { id: 'versions', label: 'Versions & aliases', icon: <GitBranch size={14} /> },
  { id: 'tags', label: 'Tags', icon: <TagsIcon size={14} /> },
];

export function FunctionDetailPage() {
  const { name } = useParams<{ name: string }>();
  const functionName = name ?? '';
  const navigate = useNavigate();
  const { toast } = useToast();

  const [fn, setFn] = useState<FunctionDetail | null>(null);
  const [tab, setTab] = useState('overview');
  const [testOpen, setTestOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const { loading, error, load } = useReload(async () => {
    setFn(await lambdaApi.getFunction(functionName));
  }, [functionName]);

  const handleDelete = async () => {
    setActionLoading(true);
    try {
      await lambdaApi.deleteFunction(functionName);
      toast('success', 'Function deleted', functionName);
      navigate('/lambda');
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/lambda">Lambda</Link>
        <span className="sep">/</span>
        <Link to="/lambda">Functions</Link>
        <span className="sep">/</span>
        <span>{functionName}</span>
      </div>

      <div className="detail-header-card">
        <div style={{ minWidth: 0 }}>
          <div className="detail-title-row">
            <h1 className="detail-name">{functionName}</h1>
            {fn && <FunctionStateBadge state={fn.state} />}
            {fn && <RuntimeBadge runtime={fn.runtime} />}
            {fn && <ArchitectureBadge architectures={fn.architectures} />}
          </div>
          <div className="detail-meta">
            <span>
              <ArnText arn={fn?.functionArn ?? null} />
            </span>
            {fn && (
              <span>
                Last modified {new Date(fn.lastModified).toLocaleString()} · {fn.codeSize > 0 ? `${Math.round(fn.codeSize / 1024)} KB code` : ''} · version {fn.version}
              </span>
            )}
          </div>
        </div>
        <div className="page-actions">
          <Button variant="primary" onClick={() => setTestOpen(true)} disabled={!fn}>
            <Zap size={14} />
            Test
          </Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={!fn}>
            <Trash2 size={14} />
            Delete
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

      {!loading && !error && fn && tab === 'overview' && <OverviewTab fn={fn} onChanged={() => void load()} />}

      {!loading && !error && fn && tab === 'code' && (
        <CodeTab fn={fn} onChanged={() => void load()} onTest={() => setTestOpen(true)} />
      )}

      {!loading && !error && fn && tab === 'test' && <TestTab fn={fn} />}

      {!loading && !error && fn && tab === 'configuration' && (
        <ConfigurationTab fn={fn} onChanged={() => void load()} />
      )}

      {!loading && !error && fn && tab === 'triggers' && <TriggersTab fn={fn} />}

      {!loading && !error && fn && tab === 'permissions' && <PermissionsTab fn={fn} />}

      {!loading && !error && fn && tab === 'versions' && <VersionsAliasesTab fn={fn} />}

      {!loading && !error && fn && tab === 'tags' && (
        <TagsTab fn={fn} onChanged={() => void load()} />
      )}

      {fn && testOpen && (
        <InvokeDialog fn={fn} onClose={() => setTestOpen(false)} />
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete function?"
        message={
          <>
            Permanently delete function <strong>{functionName}</strong>? All versions, aliases and event source mappings are removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete function"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
