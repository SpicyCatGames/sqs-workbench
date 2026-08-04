import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Inbox, Loader2, X } from 'lucide-react';
import { cn } from '../lib/cn';

// ------------------------------------------------------------------ buttons

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={cn('btn', `btn-${variant}`, `btn-${size}`, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="spin" size={15} />}
      {children}
    </button>
  );
}

export function IconButton({ className, children, loading, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button className={cn('icon-btn', className)} {...rest}>
      {loading ? <Loader2 className="spin" size={15} /> : children}
    </button>
  );
}

// -------------------------------------------------------------------- modal

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ open, title, subtitle, onClose, children, footer, wide }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn('modal', wide && 'modal-wide')} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{title}</h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <IconButton onClick={onClose} aria-label="Close">
            <X size={18} />
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------- fields

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
  layout?: 'vertical' | 'horizontal';
}

export function Field({ label, hint, error, children, className, layout = 'vertical' }: FieldProps) {
  return (
    <div className={cn('field', layout === 'horizontal' && 'field-horizontal', className)}>
      <div className="field-label-wrap">
        <label className="field-label">{label}</label>
        {hint && <p className="field-hint">{hint}</p>}
      </div>
      <div className="field-control">
        {children}
        {error && <p className="field-error">{error}</p>}
      </div>
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('input', props.className)} />;
}

export function NumberInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...props} className={cn('input', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn('input select', props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('input textarea', props.className)} />;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="toggle-wrap">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={cn('toggle', checked && 'toggle-on')}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-knob" />
      </button>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}

// ------------------------------------------------------------------- badges

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'fifo' | 'dlq' | 'success' | 'warn' }) {
  return <span className={cn('badge', `badge-${tone}`)}>{children}</span>;
}

// ------------------------------------------------------------------- status

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <Loader2 className="spin" size={26} />
      {label && <p className="spinner-label">{label}</p>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon ?? <Inbox size={28} />}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon error">
        <AlertTriangle size={28} />
      </div>
      <h3>Something went wrong</h3>
      <p>{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row" style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  );
}

// --------------------------------------------------------------------- tabs

export interface TabDef {
  id: string;
  label: string;
  icon?: ReactNode;
}

export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={cn('tab', active === t.id && 'tab-active')}
          onClick={() => onChange(t.id)}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- stat

export function Stat({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <div className="stat">
      {icon && <div className="stat-icon">{icon}</div>}
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- kv row

export function KeyValue({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="kv-row">
      <dt className="kv-label">{label}</dt>
      <dd className={cn('kv-value', mono && 'kv-mono')}>{children ?? '—'}</dd>
    </div>
  );
}
