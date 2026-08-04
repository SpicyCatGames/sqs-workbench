import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Modal } from './ui';

interface Props {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger = true, loading, onConfirm, onClose }: Props) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="inline-error" style={{ marginBottom: 0 }}>
        <AlertTriangle size={16} />
        <span>{message}</span>
      </div>
    </Modal>
  );
}
