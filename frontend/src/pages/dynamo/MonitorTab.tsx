import { Activity, Info } from 'lucide-react';
import type { DynamoTable } from '../../lib/dynamoApi';

interface Props {
  table: DynamoTable;
}

/** Monitor tab: CloudWatch metrics are not available from the local endpoint. */
export function MonitorTab({ table }: Props) {
  return (
    <div className="card card-pad">
      <div className="card-title-row" style={{ marginBottom: 6 }}>
        <div>
          <h3 className="card-title">Monitor</h3>
          <p className="card-subtitle">CloudWatch metrics for {table.name}</p>
        </div>
      </div>

      <div className="inline-info" style={{ marginTop: 12, alignItems: 'center' }}>
        <Info size={16} />
        <span>
          CloudWatch is not reachable from this console's local endpoint, so live metrics (ReadThrottleEvents, WriteThrottleEvents, ConsumedReadCapacityUnits, …)
          are not displayed here. In the AWS console these charts stream from CloudWatch every minute.
        </span>
      </div>

      <div className="monitor-placeholder">
        <Activity size={34} />
        <div className="monitor-placeholder-title">No metric data available</div>
        <div className="monitor-placeholder-sub">
          Connect this UI to a real AWS account (via a proxy with credentials) to see CloudWatch alarms and metric graphs for {table.name}.
        </div>
      </div>
    </div>
  );
}
