import { Clock, Cpu, FileCode2, HardDrive } from 'lucide-react';
import { type FunctionDetail } from '../../lib/lambdaApi';
import { formatBytes } from '../../lib/format';
import { Badge, KeyValue, Stat } from '../../components/ui';
import { ArnText } from '../sns/SnsUi';
import { ArchitectureBadge, FunctionStateBadge, RuntimeBadge, formatIso } from './LambdaUi';

interface Props {
  fn: FunctionDetail;
  onChanged: () => void;
}

export function OverviewTab({ fn }: Props) {
  return (
    <div className="prop-stack">
      <div className="stats-row">
        <Stat label="Runtime" value={<RuntimeBadge runtime={fn.runtime} />} icon={<FileCode2 size={17} />} />
        <Stat label="Memory" value={`${fn.memorySize} MB`} icon={<Cpu size={17} />} />
        <Stat label="Timeout" value={`${fn.timeout} sec`} icon={<Clock size={17} />} />
        <Stat label="Code size" value={formatBytes(fn.codeSize)} icon={<HardDrive size={17} />} />
      </div>

      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <h3 className="card-title">General information</h3>
        </div>
        <dl className="kv-grid">
          <KeyValue label="Function name">{fn.functionName}</KeyValue>
          <KeyValue label="ARN" mono><ArnText arn={fn.functionArn} /></KeyValue>
          <KeyValue label="Role" mono>{fn.role || '—'}</KeyValue>
          <KeyValue label="Description">{fn.description || '—'}</KeyValue>
          <KeyValue label="Runtime"><RuntimeBadge runtime={fn.runtime} /></KeyValue>
          <KeyValue label="Architectures"><ArchitectureBadge architectures={fn.architectures} /></KeyValue>
          <KeyValue label="Handler" mono>{fn.handler || '—'}</KeyValue>
          <KeyValue label="Package type">{fn.packageType}</KeyValue>
          <KeyValue label="State">
            <FunctionStateBadge state={fn.state} />
            {fn.stateReason && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{fn.stateReason}</div>}
          </KeyValue>
          <KeyValue label="Last update status">
            {fn.lastUpdateStatus ? <Badge tone={fn.lastUpdateStatus === 'Successful' ? 'success' : fn.lastUpdateStatus === 'InProgress' ? 'warn' : 'dlq'}>{fn.lastUpdateStatus}</Badge> : '—'}
            {fn.lastUpdateStatusReason && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{fn.lastUpdateStatusReason}</div>}
          </KeyValue>
          <KeyValue label="Last modified">{formatIso(fn.lastModified)}</KeyValue>
          <KeyValue label="Code SHA-256" mono>
            {fn.codeSha256 ? `${fn.codeSha256.slice(0, 16)}…` : '—'}
          </KeyValue>
        </dl>
      </div>

      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <h3 className="card-title">Resources</h3>
        </div>
        <dl className="kv-grid">
          <KeyValue label="Ephemeral storage" mono>{fn.ephemeralStorageSize ? `${fn.ephemeralStorageSize} MB` : '512 MB (default)'}</KeyValue>
          <KeyValue label="Log group" mono>{fn.loggingConfig?.logGroup || '—'}</KeyValue>
          <KeyValue label="Log format">{fn.loggingConfig?.logFormat || '—'}</KeyValue>
        </dl>
      </div>

      <div className="card card-pad">
        <div className="card-title-row" style={{ marginBottom: 14 }}>
          <h3 className="card-title">Environment variables</h3>
        </div>
        {Object.keys(fn.environment ?? {}).length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>No environment variables configured.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(fn.environment ?? {}).map(([k, v]) => (
                  <tr key={k}>
                    <td className="mono" style={{ fontWeight: 600 }}>{k}</td>
                    <td className="mono">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
