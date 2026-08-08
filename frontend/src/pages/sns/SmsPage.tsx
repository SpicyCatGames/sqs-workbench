import { useEffect, useState } from 'react';
import { Check, Info, Pencil, RefreshCw, Send, Undo2 } from 'lucide-react';
import { snsApi, isUnsupportedOperation } from '../../lib/snsApi';
import { errorMessage, useToast } from '../../lib/context';
import { Button, Field, Modal, NumberInput, Select, SkeletonRows, TextInput } from '../../components/ui';
import { UnsupportedBanner } from './SnsUi';

const ATTR_LABELS: Record<string, string> = {
  DefaultSMSType: 'Default message type',
  DefaultSenderID: 'Default sender ID',
  MonthlySpendLimit: 'Monthly spend limit (USD)',
  UsageReportS3Bucket: 'Usage report S3 bucket',
  DeliveryStatusIAMRole: 'Delivery status IAM role',
  DeliveryStatusSuccessSamplingRate: 'Delivery status success sampling rate (%)',
};

const EDITABLE_ATTRS = ['DefaultSMSType', 'DefaultSenderID', 'MonthlySpendLimit', 'UsageReportS3Bucket', 'DeliveryStatusIAMRole', 'DeliveryStatusSuccessSamplingRate'] as const;

export function SmsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [smsAttrs, setSmsAttrs] = useState<Record<string, string> | null>(null);
  const [smsAttrsError, setSmsAttrsError] = useState('');
  const [sandbox, setSandbox] = useState<boolean | null>(null);
  const [optOuts, setOptOuts] = useState<string[] | null>(null);
  const [optOutsError, setOptOutsError] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  // publish form state
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [senderId, setSenderId] = useState('');
  const [smsType, setSmsType] = useState('Transactional');
  const [maxPrice, setMaxPrice] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [publishResult, setPublishResult] = useState('');

  const load = async () => {
    setLoading(true);
    const [attrsRes, sandboxRes, optOutsRes] = await Promise.allSettled([
      snsApi.getSmsAttributes(),
      snsApi.getSmsSandboxStatus(),
      snsApi.listPhoneNumbersOptedOut(),
    ]);

    if (attrsRes.status === 'fulfilled') {
      setSmsAttrs(attrsRes.value.attributes);
      setSmsAttrsError('');
    } else {
      setSmsAttrs(null);
      setSmsAttrsError(errorMessage(attrsRes.reason));
    }
    if (sandboxRes.status === 'fulfilled') {
      setSandbox(sandboxRes.value.isInSandbox);
    } else {
      setSandbox(null);
    }
    if (optOutsRes.status === 'fulfilled') {
      setOptOuts(optOutsRes.value.phoneNumbers);
      setOptOutsError('');
    } else {
      setOptOuts(null);
      setOptOutsError(errorMessage(optOutsRes.reason));
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError('');
    setPublishResult('');
    try {
      const messageAttributes: Record<string, { dataType: string; stringValue: string }> = {};
      if (senderId.trim()) messageAttributes['AWS.SNS.SMS.SenderID'] = { dataType: 'String', stringValue: senderId.trim() };
      if (smsType) messageAttributes['AWS.SNS.SMS.SMSType'] = { dataType: 'String', stringValue: smsType };
      if (maxPrice.trim()) messageAttributes['AWS.SNS.SMS.MaxPrice'] = { dataType: 'String', stringValue: maxPrice.trim() };
      const res = await snsApi.publish({
        phoneNumber: phone.trim(),
        message,
        messageAttributes,
      });
      setPublishResult(res.messageId);
      toast('success', 'SMS message sent', res.messageId);
    } catch (err) {
      setPublishError(errorMessage(err));
    } finally {
      setPublishing(false);
    }
  };

  const handleOptIn = async (number: string) => {
    try {
      await snsApi.optInPhoneNumber(number);
      toast('success', 'Number opted in', number);
      await load();
    } catch (err) {
      toast('error', 'Opt-in failed', errorMessage(err));
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Text messaging (SMS)</h1>
          <p className="page-description">Send text messages, manage your account's SMS settings and opt-out list.</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => void load()} disabled={loading} title="Refresh">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Refresh
          </Button>
        </div>
      </div>

      {loading && (
        <div className="table-wrap">
          <SkeletonRows rows={6} />
        </div>
      )}

      {!loading && (
        <>
          {sandbox === true && (
            <div className="inline-info">
              <Info size={16} />
              <span>
                Your account is in the SMS <strong>sandbox</strong>. You can only send messages to verified phone numbers until you move to production.
              </span>
            </div>
          )}

          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <div className="card-title-row" style={{ marginBottom: 12 }}>
              <h2 className="card-title">SMS account settings</h2>
              <span style={{ flex: 1 }} />
              {smsAttrs && (
                <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil size={13} />
                  Edit
                </Button>
              )}
            </div>

            {smsAttrsError && (
              isUnsupportedOperation(new Error(smsAttrsError)) ? (
                <UnsupportedBanner>SMS account attributes are not implemented by this endpoint. You can still send messages below.</UnsupportedBanner>
              ) : (
                <div className="inline-error">{smsAttrsError}</div>
              )
            )}

            {smsAttrs && Object.keys(smsAttrs).length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>No SMS account attributes are set yet.</p>
            )}

            {smsAttrs && Object.keys(smsAttrs).length > 0 && (
              <dl className="kv-grid">
                {Object.entries(smsAttrs).map(([k, v]) => (
                  <div className="kv-row" key={k}>
                    <dt className="kv-label">{ATTR_LABELS[k] ?? k}</dt>
                    <dd className="kv-value">{v || '—'}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <h2 className="card-title">Publish an SMS message</h2>
            <p className="card-subtitle" style={{ marginBottom: 14 }}>Send a direct text message to a single phone number (E.164 format).</p>

            <div className="form-grid">
              <Field label="Phone number" hint="E.164 format, e.g. +15551234567">
                <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15551234567" spellCheck={false} />
              </Field>
              <Field label="Message type">
                <Select value={smsType} onChange={(e) => setSmsType(e.target.value)}>
                  <option value="Transactional">Transactional</option>
                  <option value="Promotional">Promotional</option>
                </Select>
              </Field>
            </div>
            <Field label="Message">
              <textarea
                className="input textarea"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Hello from AWS Workbench!"
                style={{ minHeight: 80 }}
              />
            </Field>
            <div className="form-grid">
              <Field label="Sender ID" hint="Optional. Alphanumeric, 1–11 characters (where supported).">
                <TextInput value={senderId} onChange={(e) => setSenderId(e.target.value)} maxLength={11} placeholder="MyApp" />
              </Field>
              <Field label="Max price (USD)" hint="Optional. e.g. 0.50">
                <TextInput value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="0.50" spellCheck={false} />
              </Field>
            </div>

            {publishError && <div className="inline-error">{publishError}</div>}
            {publishResult && (
              <div className="inline-info" style={{ marginBottom: 0 }}>
                <Check size={16} style={{ color: 'var(--success)' }} />
                <span>Message sent. Message ID: <span className="mono">{publishResult}</span></span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <Button variant="primary" onClick={() => void handlePublish()} disabled={!phone.trim() || !message.trim() || publishing} loading={publishing}>
                <Send size={14} />
                Send message
              </Button>
            </div>
          </div>

          <div className="card card-pad">
            <h2 className="card-title">Opted-out phone numbers</h2>
            <p className="card-subtitle" style={{ marginBottom: 12 }}>
              Phone numbers that have opted out of receiving SMS messages from your account. You can opt a number back in.
            </p>

            {optOutsError && (
              isUnsupportedOperation(new Error(optOutsError)) ? (
                <UnsupportedBanner>The opt-out list is not implemented by this endpoint.</UnsupportedBanner>
              ) : (
                <div className="inline-error">{optOutsError}</div>
              )
            )}

            {optOuts && optOuts.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No phone numbers have opted out.</p>}

            {optOuts && optOuts.length > 0 && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Phone number</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optOuts.map((n) => (
                      <tr key={n}>
                        <td className="mono">{n}</td>
                        <td>
                          <div className="row-actions">
                            <Button variant="ghost" size="sm" onClick={() => void handleOptIn(n)}>
                              <Undo2 size={13} />
                              Opt in
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {editOpen && smsAttrs && (
        <SmsAttributesDialog
          attributes={smsAttrs}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            toast('success', 'SMS settings updated');
            void load();
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------ edit dialog

function SmsAttributesDialog({ attributes, onClose, onSaved }: { attributes: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const key of EDITABLE_ATTRS) init[key] = attributes[key] ?? '';
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, string> = {};
      for (const key of EDITABLE_ATTRS) {
        const v = form[key].trim();
        if (v !== '') payload[key] = v;
      }
      await snsApi.setSmsAttributes(payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Edit SMS account settings"
      subtitle="These settings apply to all SMS messages sent from this account."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <Field label="Default message type" hint="Transactional messages are higher priority and cost more.">
        <Select value={form.DefaultSMSType} onChange={(e) => setForm((f) => ({ ...f, DefaultSMSType: e.target.value }))}>
          <option value="">—</option>
          <option value="Transactional">Transactional</option>
          <option value="Promotional">Promotional</option>
        </Select>
      </Field>
      <Field label="Default sender ID" hint="Alphanumeric, 1–11 characters (where supported).">
        <TextInput value={form.DefaultSenderID} onChange={(e) => setForm((f) => ({ ...f, DefaultSenderID: e.target.value }))} maxLength={11} placeholder="MyApp" />
      </Field>
      <div className="form-grid">
        <Field label="Monthly spend limit (USD)" hint="Stops sending when the monthly spend reaches this amount.">
          <NumberInput min={0} value={form.MonthlySpendLimit} onChange={(e) => setForm((f) => ({ ...f, MonthlySpendLimit: e.target.value }))} placeholder="10.00" />
        </Field>
        <Field label="Success sampling rate (%)" hint="0 – 100">
          <NumberInput min={0} max={100} value={form.DeliveryStatusSuccessSamplingRate} onChange={(e) => setForm((f) => ({ ...f, DeliveryStatusSuccessSamplingRate: e.target.value }))} placeholder="100" />
        </Field>
      </div>
      <Field label="Usage report S3 bucket" hint="S3 bucket that receives daily usage reports.">
        <TextInput value={form.UsageReportS3Bucket} onChange={(e) => setForm((f) => ({ ...f, UsageReportS3Bucket: e.target.value }))} placeholder="sns-sms-usage-reports" spellCheck={false} />
      </Field>
      <Field label="Delivery status IAM role ARN" hint="IAM role Amazon SNS assumes to write delivery status logs.">
        <TextInput value={form.DeliveryStatusIAMRole} onChange={(e) => setForm((f) => ({ ...f, DeliveryStatusIAMRole: e.target.value }))} placeholder="arn:aws:iam::000000000000:role/sns-delivery-status" spellCheck={false} />
      </Field>
      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}
