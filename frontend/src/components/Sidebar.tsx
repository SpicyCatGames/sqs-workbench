import { useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Boxes, ChevronRight, Database, FunctionSquare, HardDrive, KeyRound, Megaphone, PanelLeftClose, PanelLeftOpen, Smartphone } from 'lucide-react';
import { cn } from '../lib/cn';

const COLLAPSE_KEY = 'sqs-workbench:sidebar-collapsed';

interface NavItem {
  label: string;
  path?: string;
  icon?: ReactNode;
  children?: NavItem[];
}

/**
 * Service registry — add a new top-level entry here (plus routes in App.tsx)
 * to surface another AWS service in the sidebar.
 */
const NAV: NavItem[] = [
  {
    label: 'SQS',
    path: '/',
    icon: <Boxes size={17} />,
  },
  {
    label: 'SNS',
    path: '/sns',
    icon: <Megaphone size={17} />,
    children: [
      { label: 'Topics', path: '/sns' },
      { label: 'Subscriptions', path: '/sns/subscriptions' },
      {
        label: 'Mobile',
        icon: <Smartphone size={15} />,
        children: [
          { label: 'Text messaging (SMS)', path: '/sns/mobile/text-messaging' },
          { label: 'Origination numbers', path: '/sns/mobile/origination-numbers' },
        ],
      },
    ],
  },
  {
    label: 'S3',
    path: '/s3',
    icon: <HardDrive size={17} />,
    children: [{ label: 'Buckets', path: '/s3' }],
  },
  {
    label: 'DynamoDB',
    path: '/dynamo',
    icon: <Database size={17} />,
    children: [{ label: 'Tables', path: '/dynamo' }],
  },
  {
    label: 'Secrets Manager',
    path: '/secrets',
    icon: <KeyRound size={17} />,
    children: [{ label: 'Secrets', path: '/secrets' }],
  },
  {
    label: 'Lambda',
    path: '/lambda',
    icon: <FunctionSquare size={17} />,
    children: [{ label: 'Functions', path: '/lambda' }],
  },
];

function matches(item: NavItem, pathname: string): boolean {
  if (!item.path) return false;
  if (item.path === '/') return pathname === '/';
  return pathname === item.path || pathname.startsWith(item.path + '/');
}

function isActive(item: NavItem, pathname: string): boolean {
  return matches(item, pathname);
}

/** True when the current route lives somewhere under this group's subtree. */
function routeInside(item: NavItem, pathname: string): boolean {
  if (matches(item, pathname)) return true;
  return (item.children ?? []).some((c) => routeInside(c, pathname));
}

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  // undefined = follow the route; true/false = user override
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  const effectiveOpen = useMemo(
    () => (item: NavItem) => manualOpen[item.label] ?? routeInside(item, pathname),
    [manualOpen, pathname],
  );

  const go = (item: NavItem) => {
    if (item.path) navigate(item.path);
  };

  const renderItem = (item: NavItem, depth: number): ReactNode => {
    const hasChildren = !!item.children?.length;
    const open = hasChildren && effectiveOpen(item);
    const active = isActive(item, pathname);
    const isGroup = hasChildren && item.path;

    return (
      <div key={item.label} className={cn('nav-branch', depth > 0 && 'nav-branch-child')}>
        <button
          type="button"
          className={cn('nav-item', depth > 0 && 'nav-item-child', active && 'nav-item-active', collapsed && 'nav-item-collapsed')}
          onClick={() => {
            if (collapsed && item.path) {
              go(item);
              return;
            }
            if (hasChildren) {
              if (isGroup) go(item);
              setManualOpen((prev) => ({ ...prev, [item.label]: !open }));
            } else {
              go(item);
            }
          }}
          title={collapsed ? item.label : undefined}
          aria-expanded={hasChildren ? open : undefined}
        >
          <span className="nav-item-icon">{item.icon}</span>
          <span className="nav-item-label">{item.label}</span>
          {hasChildren && !collapsed && (
            <ChevronRight size={14} className={cn('nav-chevron', open && 'nav-chevron-open')} />
          )}
        </button>
        {hasChildren && open && !collapsed && (
          <div className="nav-children">{item.children!.map((c) => renderItem(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <aside className={cn('sidebar', collapsed && 'sidebar-collapsed')} aria-label="Services navigation">
      <div className="sidebar-header">
        {!collapsed && (
          <div className="sidebar-brand">
            <span className="sidebar-logo">A</span>
            <span>Services</span>
          </div>
        )}
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {!collapsed && <div className="sidebar-section">AWS services</div>}

      <nav className="sidebar-nav">{NAV.map((item) => renderItem(item, 0))}</nav>

      <div className="sidebar-footer">{collapsed ? <span className="sidebar-logo">A</span> : <span>AWS Workbench</span>}</div>
    </aside>
  );
}
