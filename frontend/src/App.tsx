import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { SettingsDialog } from './components/SettingsDialog';
import { QueuesPage } from './pages/QueuesPage';
import { QueueDetailPage } from './pages/QueueDetailPage';
import { useSettings, useToast } from './lib/context';

export default function App() {
  const { reloadSettings } = useSettings();
  const { toasts, dismissToast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void reloadSettings().catch(() => {
      /* settings endpoint unavailable — the top bar shows "not configured" */
    });
  }, [reloadSettings]);

  return (
    <>
      <TopBar onOpenSettings={() => setSettingsOpen(true)} />
      <main>
        <Routes>
          <Route path="/" element={<QueuesPage />} />
          <Route path="/queues/:name" element={<QueueDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)} role="status">
            <div className="toast-icon">
              {t.kind === 'success' ? <CheckCircle2 size={18} /> : t.kind === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}
            </div>
            <div>
              <div className="toast-title">{t.title}</div>
              {t.detail && <div className="toast-detail">{t.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
