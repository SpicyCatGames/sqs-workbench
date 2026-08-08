import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { SettingsDialog } from './components/SettingsDialog';
import { QueuesPage } from './pages/QueuesPage';
import { QueueDetailPage } from './pages/QueueDetailPage';
import { RedrivePage } from './pages/RedrivePage';
import { TopicsPage } from './pages/sns/TopicsPage';
import { CreateTopicPage } from './pages/sns/CreateTopicPage';
import { TopicDetailPage } from './pages/sns/TopicDetailPage';
import { SubscriptionsPage } from './pages/sns/SubscriptionsPage';
import { SmsPage } from './pages/sns/SmsPage';
import { OriginationNumbersPage } from './pages/sns/OriginationNumbersPage';
import { BucketsPage } from './pages/s3/BucketsPage';
import { BucketDetailPage } from './pages/s3/BucketDetailPage';
import { TablesPage } from './pages/dynamo/TablesPage';
import { TableDetailPage } from './pages/dynamo/TableDetailPage';
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
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <TopBar onOpenSettings={() => setSettingsOpen(true)} />
        <main className="app-content">
          <Routes>
            <Route path="/" element={<QueuesPage />} />
            <Route path="/queues/:name" element={<QueueDetailPage />} />
            <Route path="/queues/:name/redrive" element={<RedrivePage />} />
            <Route path="/sns" element={<TopicsPage />} />
            <Route path="/sns/create" element={<CreateTopicPage />} />
            <Route path="/sns/topics/:arn" element={<TopicDetailPage />} />
            <Route path="/sns/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/sns/mobile/text-messaging" element={<SmsPage />} />
            <Route path="/sns/mobile/origination-numbers" element={<OriginationNumbersPage />} />
            <Route path="/s3" element={<BucketsPage />} />
            <Route path="/s3/buckets/:name" element={<BucketDetailPage />} />
            <Route path="/dynamo" element={<TablesPage />} />
            <Route path="/dynamo/tables/:name" element={<TableDetailPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

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
    </div>
  );
}
