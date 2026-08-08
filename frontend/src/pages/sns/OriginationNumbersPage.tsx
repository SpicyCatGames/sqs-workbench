import { useState } from 'react';
import { Info, RefreshCw } from 'lucide-react';
import { isUnsupportedOperation, snsApi, type OriginationNumber } from '../../lib/snsApi';
import { formatTimestamp } from '../../lib/format';
import { Badge, Button, EmptyState, ErrorState, SkeletonRows } from '../../components/ui';
import { UnsupportedBanner, useReload } from './SnsUi';

function statusTone(status: string): 'success' | 'warn' | 'dlq' | 'default' {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'PENDING':
    case 'PROVISIONING':
      return 'warn';
    case 'DELETING':
    case 'DELETED':
      return 'dlq';
    default:
      return 'default';
  }
}

export function OriginationNumbersPage() {
  const [numbers, setNumbers] = useState<OriginationNumber[]>([]);

  const { loading, error, load } = useReload(async () => {
    const res = await snsApi.listOriginationNumbers();
    setNumbers(res.numbers);
  });

  const unsupported = error ? isUnsupportedOperation(new Error(error)) : false;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Origination numbers</h1>
          <p className="page-description">Phone numbers that you can use to send SMS and MMS messages from your AWS account.</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => void load()} disabled={loading} title="Refresh">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="inline-info">
        <Info size={16} />
        <span>
          Origination numbers are provisioned by AWS through the console or support. Use the{' '}
          <code>ListOriginationNumbers</code> API to view the numbers on this account; to request new numbers, contact AWS Support.
        </span>
      </div>

      {loading && (
        <div className="table-wrap">
          <SkeletonRows rows={6} />
        </div>
      )}

      {!loading && unsupported && (
        <>
          <UnsupportedBanner>The origination numbers API is not implemented by this endpoint. Connect to an endpoint that supports it (or real AWS) to see your numbers.</UnsupportedBanner>
          <div className="card" style={{ marginTop: 14 }}>
            <EmptyState title="Origination numbers unavailable" description="This endpoint cannot list origination numbers." />
          </div>
        </>
      )}

      {!loading && error && !unsupported && (
        <div className="card">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      )}

      {!loading && !error && numbers.length === 0 && (
        <div className="card">
          <EmptyState title="No origination numbers" description="No origination numbers are associated with this account." />
        </div>
      )}

      {!loading && !error && numbers.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Phone number</th>
                <th>Status</th>
                <th>Route type</th>
                <th>Capabilities</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {numbers.map((n) => (
                <tr key={n.phoneNumber}>
                  <td className="mono" style={{ fontWeight: 600 }}>{n.phoneNumber}</td>
                  <td><Badge tone={statusTone(n.status)}>{n.status || '—'}</Badge></td>
                  <td>{n.routeType || <span className="muted">—</span>}</td>
                  <td>
                    {n.capabilities.length > 0 ? (
                      n.capabilities.map((c) => <Badge key={c}>{c}</Badge>)
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{formatTimestamp(n.createdAt ? new Date(n.createdAt).getTime() / 1000 : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
