import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CloudUpload, FileKey, FolderPlus, FolderOpen, Settings2, Trash2 } from 'lucide-react';
import { s3Api, bucketArn, type BucketConfig } from '../../lib/s3Api';
import { errorMessage, useToast } from '../../lib/context';
import { Badge, Button, ErrorState, SkeletonRows, Tabs, type TabDef } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { regionLabel, useReload, VersioningBadge } from './S3Ui';
import { ObjectsTab, type ObjectsTabHandle } from './ObjectsTab';
import { PropertiesTab } from './PropertiesTab';
import { PermissionsTab } from './PermissionsTab';
import { UploadDialog } from './UploadDialog';
import { CreateFolderDialog } from './CreateFolderDialog';

const TABS: TabDef[] = [
  { id: 'objects', label: 'Objects', icon: <FolderOpen size={14} /> },
  { id: 'properties', label: 'Properties', icon: <Settings2 size={14} /> },
  { id: 'permissions', label: 'Permissions', icon: <FileKey size={14} /> },
];

export function BucketDetailPage() {
  const { name } = useParams<{ name: string }>();
  const bucket = name ?? '';
  const navigate = useNavigate();
  const { toast } = useToast();

  const [config, setConfig] = useState<BucketConfig | null>(null);
  const [tab, setTab] = useState('objects');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [uploadPrefix, setUploadPrefix] = useState('');
  const [folderPrefix, setFolderPrefix] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const objectsRef = useRef<ObjectsTabHandle>(null);

  const { loading, error, load } = useReload(async () => {
    setConfig(await s3Api.getBucketConfig(bucket));
  }, [bucket]);

  const openUpload = () => {
    setUploadPrefix(objectsRef.current?.getPrefix() ?? '');
    setUploadOpen(true);
  };

  const openFolder = () => {
    setFolderPrefix(objectsRef.current?.getPrefix() ?? '');
    setFolderOpen(true);
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try {
      await s3Api.deleteBucket(bucket);
      toast('success', 'Bucket deleted', bucket);
      navigate('/s3');
    } catch (err) {
      toast('error', 'Delete failed', errorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/s3">S3</Link>
        <span className="sep">/</span>
        <Link to="/s3">Buckets</Link>
        <span className="sep">/</span>
        <span>{bucket}</span>
      </div>

      <div className="detail-header-card">
        <div style={{ minWidth: 0 }}>
          <div className="detail-title-row">
            <h1 className="detail-name">{bucket}</h1>
            <Badge tone="fifo">{config?.region ?? 'us-east-1'}</Badge>
          </div>
          <div className="detail-meta">
            <span className="mono" style={{ wordBreak: 'break-all' }}>{bucketArn(bucket)}</span>
            <span>
              Created {config?.creationDate ? new Date(config.creationDate).toLocaleString() : '—'}
              {config?.region && ` · ${regionLabel(config.region)}`}
              {config?.versioning ? ` · ` : ''}
              {config?.versioning && <VersioningBadge status={config.versioning} />}
            </span>
          </div>
        </div>
        <div className="page-actions">
          <Button variant="primary" onClick={openUpload}>
            <CloudUpload size={14} />
            Upload
          </Button>
          <Button variant="secondary" onClick={openFolder}>
            <FolderPlus size={14} />
            Create folder
          </Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
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

      {!loading && !error && tab === 'objects' && (
        <ObjectsTab
          ref={objectsRef}
          bucket={bucket}
          onUploadRequest={openUpload}
          onFolderRequest={openFolder}
          refreshSignal={refreshSignal}
        />
      )}

      {!loading && !error && tab === 'properties' && (
        <PropertiesTab
          bucket={bucket}
          config={config}
          onChanged={() => {
            void load();
          }}
        />
      )}

      {!loading && !error && tab === 'permissions' && (
        <PermissionsTab
          bucket={bucket}
          config={config}
          onChanged={() => {
            void load();
          }}
        />
      )}

      <UploadDialog
        open={uploadOpen}
        bucket={bucket}
        prefix={uploadPrefix}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          toast('success', 'Upload complete');
          setRefreshSignal((n) => n + 1);
          setUploadOpen(false);
        }}
      />

      <CreateFolderDialog
        open={folderOpen}
        bucket={bucket}
        prefix={folderPrefix}
        onClose={() => setFolderOpen(false)}
        onCreated={() => {
          toast('success', 'Folder created');
          setRefreshSignal((n) => n + 1);
          setFolderOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete bucket?"
        message={
          <>
            Permanently delete bucket <strong>{bucket}</strong> and all of its objects, versions and configurations? This cannot be undone.
          </>
        }
        confirmLabel="Delete bucket"
        loading={actionLoading}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
