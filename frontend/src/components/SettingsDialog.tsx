import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { errorMessage, useSettings, useToast } from '../lib/context';
import { Button, Field, Modal, TextInput } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: Props) {
  const { settings, updateSettings, reloadSettings, testSettings, testing } = useSettings();
  const { toast } = useToast();

  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && settings) {
      setEndpoint(settings.endpoint);
      setRegion(settings.region);
      setAccessKey(settings.accessKey);
      setSecretKey('');
      setTestState('idle');
      setTestMessage('');
      setError('');
    }
  }, [open, settings]);

  if (!open) return null;

  const handleTest = async () => {
    setTestState('idle');
    setTestMessage('');
    try {
      // Persist the current form values first so the test uses them, then refresh
      // the context so the top bar reflects the new endpoint immediately.
      await api.saveSettings({
        endpoint,
        region,
        accessKey,
        secretKey: secretKey || '****',
      });
      await reloadSettings();
      await testSettings();
      setTestState('ok');
      setTestMessage('Connection successful.');
    } catch (err) {
      setTestState('fail');
      setTestMessage(errorMessage(err));
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await updateSettings({
        endpoint,
        region,
        accessKey,
        secretKey: secretKey || '****',
      });
      toast('success', 'Settings saved');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Settings"
      subtitle="Connection details for the AWS endpoint this console manages (shared by SQS, SNS and future services)."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={handleTest} loading={testing}>
            Test connection
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      {testState === 'ok' && (
        <div className="inline-info">
          <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />
          {testMessage}
        </div>
      )}
      {testState === 'fail' && (
        <div className="inline-error">
          <XCircle size={16} />
          {testMessage}
        </div>
      )}

      <Field
        label="AWS endpoint URL"
        hint={'For example http://localhost:4566 (floci / LocalStack) or https://sqs.us-east-1.amazonaws.com. Emulator without CORS (fakecloud)? Use http://localhost:3000/aws with "npm run dev", or http://localhost:4567 via "npm run cors-proxy".'}
      >
        <TextInput value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://localhost:4566" spellCheck={false} />
      </Field>

      <div className="form-grid">
        <Field label="Region">
          <TextInput value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" spellCheck={false} />
        </Field>
        <Field label="Access key ID">
          <TextInput value={accessKey} onChange={(e) => setAccessKey(e.target.value)} placeholder="test" spellCheck={false} />
        </Field>
      </div>

      <Field
        label="Secret access key"
        hint={settings?.hasSecretKey ? `Existing key is set (${settings.secretKeyMasked}). Leave blank to keep it.` : 'Not set yet.'}
      >
        <TextInput
          type="password"
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
          placeholder={settings?.hasSecretKey ? settings.secretKeyMasked : 'secret'}
          autoComplete="new-password"
        />
      </Field>

      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}
