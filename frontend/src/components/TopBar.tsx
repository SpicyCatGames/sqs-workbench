import { Link } from 'react-router-dom';
import { Boxes, Settings } from 'lucide-react';
import { useSettings } from '../lib/context';

export function TopBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { settings } = useSettings();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link to="/" className="topbar-logo">
          <span className="logo-mark">
            <Boxes size={16} />
          </span>
          <span>
            <div className="topbar-title">Local SQS Admin</div>
            <div className="topbar-subtitle">Queue management console</div>
          </span>
        </Link>
      </div>

      <div className="topbar-right">
        <span className="endpoint-chip" title={settings?.endpoint ?? 'Endpoint not configured'}>
          <span className={settings ? 'endpoint-dot' : 'endpoint-dot offline'} />
          {settings?.endpoint ?? 'Endpoint not configured'}
        </span>
        <button className="topbar-settings" onClick={onOpenSettings}>
          <Settings size={15} />
          Settings
        </button>
      </div>
    </header>
  );
}
