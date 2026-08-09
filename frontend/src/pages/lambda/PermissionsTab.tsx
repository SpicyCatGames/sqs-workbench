import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { lambdaApi, type FunctionDetail } from '../../lib/lambdaApi';
import { errorMessage, useToast } from '../../lib/context';
import { prettyJson } from '../../lib/format';
import { Button, EmptyState, ErrorState, Field, Modal, Select, SkeletonRows, TextInput } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface Props {
  fn: FunctionDetail;
}

interface Statement {
  Sid?: string;
  Effect?: string;
  Principal?: unknown;
  Action?: unknown;
  Resource?: unknown;
  SourceArn?: string;
  SourceAccount?: string;
}

const ACTIONS = ['lambda:InvokeFunction', 'lambda:*'];
const PRINCIPALS = [
  'sns.amazonaws.com',
  'sqs.amazonaws.com',
  's3.amazonaws.com',
  'events.amazonaws.com',
  'apigateway.amazonaws.com',
  'lambda.amazonaws.com',
  'logs.amazonaws.com',
  'dynamodb.amazonaws.com',
];

export function PermissionsTab({ fn }: Props) {
  const { toast } = useToast();
  const [policy, setPolicy] = useState('');
  const [statements, setStatements] = useState<Statement[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await lambdaApi.getFunctionPolicy(fn.functionName);
      setPolicy(res.policy);
      setStatements(parseStatements(res.policy));
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

  const handleDelete = async () => {
    if (!deleteTarget?.Sid) return;
    setSaving(true);
    try {
      await lambdaApi.removePermission(fn.functionName, deleteTarget.Sid);
      toast('success', 'Statement removed', deleteTarget.Sid);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast('error', 'Remove failed', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const principalLabel = (p: unknown): string => {
    if (typeof p === 'string') return p;
    if (p && typeof p === 'object') {
      const aws = (p as { AWS?: unknown }).AWS;
      if (typeof aws === 'string') return aws;
      if (Array.isArray(aws)) return aws.join(', ');
      const svc = (p as { Service?: unknown }).Service;
      if (typeof svc === 'string') return svc;
    }
    return JSON.stringify(p);
  };

  return (
    <div className="card card-pad">
      <div className="card-title-row" style={{ marginBottom: 12 }}>
        <h3 className="card-title">Resource-based policy</h3>
        <span className="muted" style={{ fontSize: 12.5 }}>{statements.length} statement{statements.length === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={13} />
          Add permissions
        </Button>
      </div>

      <p className="card-subtitle" style={{ marginBottom: 12 }}>
        The resource policy grants other AWS services (SNS, S3, EventBridge, API Gateway…) and accounts permission to invoke this function.
        Statements appear after calls to <span className="mono">AddPermission</span>.
      </p>

      {loading && <SkeletonRows rows={4} />}
      {!loading && error && <ErrorState message={error} onRetry={() => void load()} />}

      {!loading && !error && statements.length === 0 && (
        <EmptyState
          title="No resource policy"
          description="This function is only invokable by the owner account. Add permissions to allow other services and accounts to invoke it."
          action={
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              <Plus size={13} />
              Add permissions
            </Button>
          }
        />
      )}

      {!loading && !error && statements.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Statement ID</th>
                <th>Effect</th>
                <th>Principal</th>
                <th>Action</th>
                <th>Source ARN</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s, idx) => (
                <tr key={s.Sid ?? `stmt-${idx}`}>
                  <td className="mono" style={{ fontWeight: 600 }}>{s.Sid ?? '—'}</td>
                  <td>{s.Effect ?? '—'}</td>
                  <td className="mono" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{principalLabel(s.Principal)}</td>
                  <td className="mono">{typeof s.Action === 'string' ? s.Action : JSON.stringify(s.Action)}</td>
                  <td className="mono" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.SourceArn ?? '—'}</td>
                  <td>
                    <div className="row-actions">
                      {s.Sid && (
                        <IconButton2 title="Remove statement" onClick={() => setDeleteTarget(s)}>
                          <Trash2 size={15} />
                        </IconButton2>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {policy && (
        <details className="policy-details" style={{ marginTop: 14 }}>
          <summary>Raw policy JSON</summary>
          <pre className="json-preview">{prettyJson(policy)}</pre>
        </details>
      )}

      {addOpen && (
        <AddPermissionDialog
          fn={fn}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            toast('success', 'Permission added', 'The resource policy now grants this statement.');
            setAddOpen(false);
            void load();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove statement?"
        message={
          <>
            Remove statement <strong>{deleteTarget?.Sid}</strong> from the resource policy? The principal will no longer be able to invoke the function through this permission.
          </>
        }
        confirmLabel="Remove"
        loading={saving}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function IconButton2({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-btn danger" title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function parseStatements(policy: string): Statement[] {
  if (!policy) return [];
  try {
    const parsed = JSON.parse(policy) as { Statement?: Statement | Statement[] };
    const list = Array.isArray(parsed.Statement) ? parsed.Statement : parsed.Statement ? [parsed.Statement] : [];
    return list.filter((s) => s && typeof s === 'object');
  } catch {
    return [];
  }
}

// ------------------------------------------------------------ add dialog

function AddPermissionDialog({ fn, onClose, onAdded }: { fn: FunctionDetail; onClose: () => void; onAdded: () => void }) {
  const [statementId, setStatementId] = useState('');
  const [action, setAction] = useState('lambda:InvokeFunction');
  const [principal, setPrincipal] = useState('sns.amazonaws.com');
  const [sourceArn, setSourceArn] = useState('');
  const [sourceAccount, setSourceAccount] = useState('');
  const [eventSourceToken, setEventSourceToken] = useState('');
  const [customAction, setCustomAction] = useState('');
  const [customPrincipal, setCustomPrincipal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const finalAction = useMemo(() => (action === 'lambda:*' ? action : action === 'custom' ? customAction : action), [action, customAction]);
  const finalPrincipal = useMemo(() => (principal === 'custom' ? customPrincipal : principal), [principal, customPrincipal]);

  const handleAdd = async () => {
    setSaving(true);
    setError('');
    try {
      await lambdaApi.addPermission({
        functionName: fn.functionName,
        statementId,
        action: finalAction,
        principal: finalPrincipal,
        sourceArn: sourceArn.trim() || undefined,
        sourceAccount: sourceAccount.trim() || undefined,
        eventSourceToken: eventSourceToken.trim() || undefined,
      });
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Add permissions"
      subtitle={`${fn.functionName} · resource-based policy statement`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleAdd()}
            loading={saving}
            disabled={!statementId.trim() || !finalAction.trim() || !finalPrincipal.trim()}
          >
            Add
          </Button>
        </>
      }
    >
      <Field label="Statement ID" hint="A unique identifier for this statement.">
        <TextInput value={statementId} onChange={(e) => setStatementId(e.target.value)} placeholder="sns-topic-trigger" spellCheck={false} className="mono" />
      </Field>
      <Field label="Action">
        <Select value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </Select>
      </Field>
      {action === 'custom' && (
        <Field label="Custom action">
          <TextInput value={customAction} onChange={(e) => setCustomAction(e.target.value)} placeholder="lambda:InvokeFunctionUrl" spellCheck={false} className="mono" />
        </Field>
      )}
      <Field label="Principal" hint="The AWS service or account granted permission.">
        <Select value={principal} onChange={(e) => setPrincipal(e.target.value)}>
          {PRINCIPALS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </Select>
      </Field>
      {principal === 'custom' && (
        <Field label="Custom principal">
          <TextInput value={customPrincipal} onChange={(e) => setCustomPrincipal(e.target.value)} placeholder="arn:aws:iam::123456789012:role/my-role" spellCheck={false} className="mono" />
        </Field>
      )}
      <Field label="Source ARN - optional" hint="Restrict the permission to a specific resource (e.g. a topic or bucket).">
        <TextInput value={sourceArn} onChange={(e) => setSourceArn(e.target.value)} placeholder="arn:aws:sns:us-east-1:000000000000:my-topic" spellCheck={false} className="mono" />
      </Field>
      <div className="form-grid">
        <Field label="Source account - optional">
          <TextInput value={sourceAccount} onChange={(e) => setSourceAccount(e.target.value)} placeholder="000000000000" spellCheck={false} className="mono" />
        </Field>
        <Field label="Event source token - optional">
          <TextInput value={eventSourceToken} onChange={(e) => setEventSourceToken(e.target.value)} spellCheck={false} className="mono" />
        </Field>
      </div>
      {error && <div className="inline-error" style={{ marginBottom: 0 }}>{error}</div>}
    </Modal>
  );
}
