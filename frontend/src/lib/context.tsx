import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiRequestError } from './api';
import type { SqsSettings } from './types';

// ------------------------------------------------------------------ settings

interface SettingsContextValue {
  settings: SqsSettings | null;
  reloadSettings: () => Promise<void>;
  updateSettings: (payload: Parameters<typeof api.saveSettings>[0]) => Promise<void>;
  testSettings: () => Promise<void>;
  testing: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SqsSettings | null>(null);
  const [testing, setTesting] = useState(false);

  const reloadSettings = useCallback(async () => {
    setSettings(await api.getSettings());
  }, []);

  const updateSettings = useCallback(async (payload: Parameters<typeof api.saveSettings>[0]) => {
    await api.saveSettings(payload);
    setSettings(await api.getSettings());
  }, []);

  const testSettings = useCallback(async () => {
    setTesting(true);
    try {
      await api.testSettings();
    } finally {
      setTesting(false);
    }
  }, []);

  const value = useMemo(
    () => ({ settings, reloadSettings, updateSettings, testSettings, testing }),
    [settings, reloadSettings, updateSettings, testSettings, testing],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

// --------------------------------------------------------------------- toasts

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (kind: Toast['kind'], title: string, detail?: string) => void;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (kind: Toast['kind'], title: string, detail?: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-3), { id, kind, title, detail }]);
      window.setTimeout(() => dismissToast(id), kind === 'error' ? 8000 : 5000);
    },
    [dismissToast],
  );

  const value = useMemo(() => ({ toasts, toast, dismissToast }), [toasts, toast, dismissToast]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

/** Extract a friendly message from an unknown error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
