import { useEffect, useState } from 'react';
import { Check, Info, ShieldCheck, Trash2 } from 'lucide-react';
import { s3Api, type BucketConfig } from '../../lib/s3Api';
import { errorMessage, useToast } from '../../lib/context';
import { prettyJson } from '../../lib/format';
import { Button, SkeletonRows, Textarea, Toggle } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface Props {
  bucket: string;
  config: BucketConfig | null;
  onChanged: () => void;
}

export function PermissionsTab({ bucket, config, onChanged }: Props) {
  if (!config) {
    return (
      <div className="card card-pad">
        <SkeletonRows rows={4} />
      </div>
    );
  }
  return (
    <div className="prop-stack">
      <PolicyEditor bucket={bucket} policy={config.policy ?? null} onChanged={onChanged} />
      <CorsEditor bucket={bucket} cors={config.cors ?? null} onChanged={onChanged} />
      <PublicAccessEditor bucket={bucket} config={config.publicAccessBlock ?? null} onChanged={onChanged} />
    </div>
  );
}

// -------------------------------------------------------------- access policy

function PolicyEditor({ bucket, policy, onChanged }: { bucket: string; policy: string | null; onChanged: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState(prettyJson(policy ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setText(prettyJson(policy ?? ''));
  }, [policy]);

  const handleSave = async () => {
    let parsed: string;
    try {
      parsed = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      setError('The policy must be valid JSON.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await s3Api.putBucketPolicy(bucket, parsed);
      toast('success', 'Access policy saved');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      await s3Api.deleteBucketPolicy(bucket);
      setDeleteOpen(false);
      toast('success', 'Access policy deleted');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-pad">
      <div className="card-title-row" style={{ marginBottom: 8 }}>
        <h2 className="card-title">Access policy</h2>
        <span style={{ flex: 1 }} />
        {policy && (
          <Button variant="secondary" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 size={13} />
            Delete policy
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={() => void handleSave()} loading={saving}>
          <Check size={13} />
          Save
        </Button>
      </div>
      <p className="card-subtitle" style={{ marginBottom: 12 }}>
        Resource-based policy that controls who can access this bucket. Changes apply immediately.
      </p>
      <div className="inline-info" style={{ marginTop: 0 }}>
        <Info size={16} />
        <span>
          The default policy allows your account's principals to perform all actions on this bucket. Saved with{' '}
          <code>PutBucketPolicy</code> syntax.
        </span>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder='{\n  "Version": "2012-10-17",\n  "Statement": []\n}'
        style={{ minHeight: 240, fontFamily: 'var(--mono)', fontSize: 12.5 }}
      />
      {error && <div className="inline-error">{error}</div>}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete access policy?"
        message={<>Remove the access policy from <strong>{bucket}</strong>? This cannot be undone.</>}
        confirmLabel="Delete policy"
        loading={saving}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

// ----------------------------------------------------------------------- CORS

function CorsEditor({ bucket, cors, onChanged }: { bucket: string; cors: string | null; onChanged: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState(prettyJson(cors ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setText(prettyJson(cors ?? ''));
  }, [cors]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await s3Api.putBucketCors(bucket, text);
      toast('success', 'CORS configuration saved');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      await s3Api.deleteBucketCors(bucket);
      setDeleteOpen(false);
      toast('success', 'CORS configuration deleted');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-pad">
      <div className="card-title-row" style={{ marginBottom: 8 }}>
        <h2 className="card-title">Cross-origin resource sharing (CORS)</h2>
        <span style={{ flex: 1 }} />
        {cors && (
          <Button variant="secondary" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 size={13} />
            Delete CORS
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={() => void handleSave()} loading={saving}>
          <Check size={13} />
          Save
        </Button>
      </div>
      <p className="card-subtitle" style={{ marginBottom: 12 }}>
        Configure how browsers may access objects in this bucket from other origins.
      </p>
      <div className="inline-info" style={{ marginTop: 0 }}>
        <Info size={16} />
        <span>
          JSON object with a <code>CORSRules</code> array, e.g.{' '}
          <code>{'{"CORSRules":[{"AllowedOrigins":["*"],"AllowedMethods":["GET","PUT"],"AllowedHeaders":["*"],"MaxAgeSeconds":3000}]}'}</code>
        </span>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder='{\n  "CORSRules": []\n}'
        style={{ minHeight: 200, fontFamily: 'var(--mono)', fontSize: 12.5 }}
      />
      {error && <div className="inline-error">{error}</div>}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete CORS configuration?"
        message={<>Remove the CORS configuration from <strong>{bucket}</strong>? This cannot be undone.</>}
        confirmLabel="Delete CORS"
        loading={saving}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

// ----------------------------------------------------------- block public access

function PublicAccessEditor({ bucket, config, onChanged }: { bucket: string; config: BucketConfig['publicAccessBlock']; onChanged: () => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState({
    blockPublicAcls: true,
    ignorePublicAcls: true,
    blockPublicPolicy: true,
    restrictPublicBuckets: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (config) {
      setDraft({
        blockPublicAcls: config.blockPublicAcls,
        ignorePublicAcls: config.ignorePublicAcls,
        blockPublicPolicy: config.blockPublicPolicy,
        restrictPublicBuckets: config.restrictPublicBuckets,
      });
    }
  }, [config]);

  const set = (key: keyof typeof draft, value: boolean) => setDraft((d) => ({ ...d, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await s3Api.putPublicAccessBlock(bucket, draft);
      toast('success', 'Public access settings saved');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggles: Array<{ key: keyof typeof draft; label: string; hint: string }> = [
    { key: 'blockPublicAcls', label: 'Block public ACLs', hint: 'Blocks PUT Bucket acl and PUT Object acl calls that would grant public access.' },
    { key: 'ignorePublicAcls', label: 'Ignore public ACLs', hint: 'Treats public ACLs on objects and buckets as private for access decisions.' },
    { key: 'blockPublicPolicy', label: 'Block public bucket policies', hint: 'Blocks PUT Bucket policy calls that would grant public access.' },
    { key: 'restrictPublicBuckets', label: 'Restrict public bucket policies', hint: 'Limits the principals that can access a bucket that has a public policy.' },
  ];

  return (
    <div className="card card-pad">
      <div className="card-title-row" style={{ marginBottom: 8 }}>
        <h2 className="card-title">Block public access</h2>
        <span style={{ flex: 1 }} />
        <Button variant="primary" size="sm" onClick={() => void handleSave()} loading={saving}>
          <Check size={13} />
          Save
        </Button>
      </div>
      <p className="card-subtitle" style={{ marginBottom: 12 }}>
        This bucket's public access settings are independent of an account-level configuration.
      </p>
      <div className="pab-list">
        {toggles.map((t) => (
          <div className="pab-row" key={t.key}>
            <div>
              <div className="pab-label">{t.label}</div>
              <div className="pab-hint">{t.hint}</div>
            </div>
            <Toggle checked={draft[t.key]} onChange={(v) => set(t.key, v)} />
          </div>
        ))}
      </div>
      <div className="inline-info" style={{ marginTop: 14, marginBottom: 0 }}>
        <ShieldCheck size={16} />
        <span>
          Turning these on helps prevent data leaks through public ACLs or policies. Existing public access is not automatically removed.
        </span>
      </div>
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
}
