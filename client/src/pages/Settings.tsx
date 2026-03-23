import { useState, useEffect, FormEvent } from 'react';
import toast from 'react-hot-toast';
import {
  sendTestEmail,
} from '../api/settings.api';
import { clearHistory } from '../api/admin.api';
import {
  useSettings,
  useUpdateProvider,
  useUpdateGmailConfig,
  useUpdateSesConfig,
  useUpdateThrottleDefaults,
  useUpdateReplyTo,
} from '../hooks/useSettings';
import { FormSkeleton } from '../components/ui/Skeleton';
import ErrorBoundary from '../components/ErrorBoundary';
import AdminPasswordModal from '../components/ui/AdminPasswordModal';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

function SettingsContent() {
  const { data: settingsData, isLoading, isError } = useSettings();

  const [provider, setProvider] = useState<'gmail' | 'ses'>('ses');
  const [gmail, setGmail] = useState({ host: 'smtp.gmail.com', port: 587, user: '', pass: '' });
  const [ses, setSes] = useState({ region: 'ap-south-1', accessKeyId: '', secretAccessKey: '', fromEmail: '' });
  const [throttle, setThrottle] = useState({ perSecond: 5, perHour: 5000 });
  const [replyTo, setReplyTo] = useState('');
  const [replyToError, setReplyToError] = useState('');
  const [testTo, setTestTo] = useState('');

  const [gmailStatus, setGmailStatus] = useState<ConnectionStatus>('idle');
  const [sesStatus, setSesStatus] = useState<ConnectionStatus>('idle');

  const [gmailErrors, setGmailErrors] = useState<Record<string, string>>({});
  const [sesErrors, setSesErrors] = useState<Record<string, string>>({});

  const [clearHistoryModal, setClearHistoryModal] = useState<'campaigns' | 'contacts' | 'all' | null>(null);

  const updateProviderMutation = useUpdateProvider();
  const updateGmailMutation = useUpdateGmailConfig();
  const updateSesMutation = useUpdateSesConfig();
  const updateThrottleMutation = useUpdateThrottleDefaults();
  const updateReplyToMutation = useUpdateReplyTo();

  // Populate form when settings load
  useEffect(() => {
    if (settingsData) {
      if (settingsData.email_provider) setProvider(settingsData.email_provider);
      if (settingsData.gmail_config) setGmail(settingsData.gmail_config);
      if (settingsData.ses_config) setSes(settingsData.ses_config);
      if (settingsData.throttle_defaults) setThrottle(settingsData.throttle_defaults);
      if (settingsData.reply_to) setReplyTo(settingsData.reply_to);
    }
  }, [settingsData]);

  async function handleProviderSwitch(p: 'gmail' | 'ses') {
    setProvider(p);
    updateProviderMutation.mutate(p);
  }

  function validateGmail(): boolean {
    const errors: Record<string, string> = {};
    if (!gmail.host.trim()) errors.host = 'SMTP host is required';
    if (!gmail.port || gmail.port <= 0) errors.port = 'Valid port is required';
    if (!gmail.user.trim()) errors.user = 'Gmail address is required';
    if (!gmail.pass.trim()) errors.pass = 'App password is required';
    setGmailErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function validateSes(): boolean {
    const errors: Record<string, string> = {};
    if (!ses.region.trim()) errors.region = 'AWS Region is required';
    if (!ses.fromEmail.trim()) errors.fromEmail = 'From email is required';
    if (!ses.accessKeyId.trim()) errors.accessKeyId = 'Access Key ID is required';
    if (!ses.secretAccessKey.trim()) errors.secretAccessKey = 'Secret Access Key is required';
    setSesErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSaveGmail(e: FormEvent) {
    e.preventDefault();
    if (!validateGmail()) return;
    updateGmailMutation.mutate(gmail);
  }

  async function handleTestGmail() {
    if (!validateGmail()) return;
    setGmailStatus('testing');
    try {
      await updateGmailMutation.mutateAsync(gmail);
      await sendTestEmail(gmail.user);
      setGmailStatus('success');
      toast.success('Gmail connection test passed');
    } catch {
      setGmailStatus('error');
      toast.error('Gmail connection test failed');
    }
  }

  async function handleSaveSes(e: FormEvent) {
    e.preventDefault();
    if (!validateSes()) return;
    updateSesMutation.mutate(ses);
  }

  async function handleTestSes() {
    if (!validateSes()) return;
    setSesStatus('testing');
    try {
      await updateSesMutation.mutateAsync(ses);
      await sendTestEmail(ses.fromEmail);
      setSesStatus('success');
      toast.success('SES connection test passed');
    } catch {
      setSesStatus('error');
      toast.error('SES connection test failed');
    }
  }

  async function handleSaveThrottle(e: FormEvent) {
    e.preventDefault();
    updateThrottleMutation.mutate(throttle);
  }

  async function handleSaveReplyTo(e: FormEvent) {
    e.preventDefault();
    if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
      setReplyToError('Please enter a valid email address');
      return;
    }
    setReplyToError('');
    updateReplyToMutation.mutate(replyTo);
  }

  async function handleTestEmail(e: FormEvent) {
    e.preventDefault();
    try {
      await sendTestEmail(testTo);
      toast.success(`Test email sent to ${testTo}`);
    } catch {
      toast.error('Failed to send test email');
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl p-6 space-y-6">
        <FormSkeleton fields={2} />
        <FormSkeleton fields={4} />
        <FormSkeleton fields={2} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-xl bg-red-50 p-6 text-center">
          <p className="text-red-700 font-medium">Failed to load settings</p>
          <p className="mt-1 text-sm text-red-500">Please try refreshing the page.</p>
        </div>
      </div>
    );
  }

  function StatusIndicator({ status }: { status: ConnectionStatus }) {
    if (status === 'idle') return null;
    if (status === 'testing') return <span className="inline-flex items-center gap-1 text-xs text-yellow-600"><span className="inline-block h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />Testing...</span>;
    if (status === 'success') return <span className="inline-flex items-center gap-1 text-xs text-green-600"><span className="inline-block h-2 w-2 rounded-full bg-green-500" />Connected</span>;
    return <span className="inline-flex items-center gap-1 text-xs text-red-600"><span className="inline-block h-2 w-2 rounded-full bg-red-500" />Failed</span>;
  }

  const inputClass = (error?: string) =>
    `mt-1 block w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-1 ${
      error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
    }`;

  const saving = updateGmailMutation.isPending || updateSesMutation.isPending || updateThrottleMutation.isPending || updateReplyToMutation.isPending;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Provider Toggle */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Email Provider</h2>
        <p className="mt-1 text-sm text-gray-500">Choose which provider to use for sending emails</p>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => handleProviderSwitch('gmail')}
            className={`rounded-lg px-6 py-2 text-sm font-medium transition-colors ${
              provider === 'gmail'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Gmail SMTP
          </button>
          <button
            onClick={() => handleProviderSwitch('ses')}
            className={`rounded-lg px-6 py-2 text-sm font-medium transition-colors ${
              provider === 'ses'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            AWS SES
          </button>
        </div>
      </div>

      {/* Gmail Config */}
      {provider === 'gmail' && (
        <form onSubmit={handleSaveGmail} className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Gmail SMTP Configuration</h2>
            <StatusIndicator status={gmailStatus} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">SMTP Host *</label>
              <input type="text" value={gmail.host} onChange={(e) => { setGmail({ ...gmail, host: e.target.value }); setGmailErrors((p) => ({ ...p, host: '' })); }} className={inputClass(gmailErrors.host)} />
              {gmailErrors.host && <p className="mt-1 text-xs text-red-500">{gmailErrors.host}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Port *</label>
              <input type="number" value={gmail.port} onChange={(e) => { setGmail({ ...gmail, port: parseInt(e.target.value) }); setGmailErrors((p) => ({ ...p, port: '' })); }} className={inputClass(gmailErrors.port)} />
              {gmailErrors.port && <p className="mt-1 text-xs text-red-500">{gmailErrors.port}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Gmail Address *</label>
              <input type="email" value={gmail.user} onChange={(e) => { setGmail({ ...gmail, user: e.target.value }); setGmailErrors((p) => ({ ...p, user: '' })); }} className={inputClass(gmailErrors.user)} />
              {gmailErrors.user && <p className="mt-1 text-xs text-red-500">{gmailErrors.user}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">App Password *</label>
              <input type="password" value={gmail.pass} onChange={(e) => { setGmail({ ...gmail, pass: e.target.value }); setGmailErrors((p) => ({ ...p, pass: '' })); }} className={inputClass(gmailErrors.pass)} />
              {gmailErrors.pass && <p className="mt-1 text-xs text-red-500">{gmailErrors.pass}</p>}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={saving} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Gmail Config'}
            </button>
            <button type="button" onClick={handleTestGmail} disabled={gmailStatus === 'testing'} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">
              {gmailStatus === 'testing' ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
        </form>
      )}

      {/* SES Config */}
      {provider === 'ses' && (
        <form onSubmit={handleSaveSes} className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">AWS SES Configuration</h2>
            <StatusIndicator status={sesStatus} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">AWS Region *</label>
              <input type="text" value={ses.region} onChange={(e) => { setSes({ ...ses, region: e.target.value }); setSesErrors((p) => ({ ...p, region: '' })); }} className={inputClass(sesErrors.region)} />
              {sesErrors.region && <p className="mt-1 text-xs text-red-500">{sesErrors.region}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">From Email *</label>
              <input type="email" value={ses.fromEmail} onChange={(e) => { setSes({ ...ses, fromEmail: e.target.value }); setSesErrors((p) => ({ ...p, fromEmail: '' })); }} className={inputClass(sesErrors.fromEmail)} />
              {sesErrors.fromEmail && <p className="mt-1 text-xs text-red-500">{sesErrors.fromEmail}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Access Key ID *</label>
              <input type="text" value={ses.accessKeyId} onChange={(e) => { setSes({ ...ses, accessKeyId: e.target.value }); setSesErrors((p) => ({ ...p, accessKeyId: '' })); }} className={inputClass(sesErrors.accessKeyId)} />
              {sesErrors.accessKeyId && <p className="mt-1 text-xs text-red-500">{sesErrors.accessKeyId}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Secret Access Key *</label>
              <input type="password" value={ses.secretAccessKey} onChange={(e) => { setSes({ ...ses, secretAccessKey: e.target.value }); setSesErrors((p) => ({ ...p, secretAccessKey: '' })); }} className={inputClass(sesErrors.secretAccessKey)} />
              {sesErrors.secretAccessKey && <p className="mt-1 text-xs text-red-500">{sesErrors.secretAccessKey}</p>}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={saving} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save SES Config'}
            </button>
            <button type="button" onClick={handleTestSes} disabled={sesStatus === 'testing'} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">
              {sesStatus === 'testing' ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
        </form>
      )}

      {/* Reply-To Address */}
      <form onSubmit={handleSaveReplyTo} className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Reply-To Address</h2>
        <p className="mt-1 text-sm text-gray-500">
          Set a custom reply-to email address. When recipients reply to your emails, responses will be sent to this address instead of the sender address. Leave blank to use the default sender address.
        </p>
        <div className="mt-4 max-w-md">
          <label className="block text-sm font-medium text-gray-700">Reply-To Email</label>
          <input
            type="email"
            value={replyTo}
            onChange={(e) => { setReplyTo(e.target.value); setReplyToError(''); }}
            placeholder="replies@yourdomain.com"
            className={inputClass(replyToError)}
          />
          {replyToError && <p className="mt-1 text-xs text-red-500">{replyToError}</p>}
        </div>
        <button type="submit" disabled={saving} className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Reply-To Address'}
        </button>
      </form>

      {/* Throttle Defaults */}
      <form onSubmit={handleSaveThrottle} className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Throttle Defaults</h2>
        <p className="mt-1 text-sm text-gray-500">Default rate limits for new campaigns</p>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Emails per Second</label>
            <input
              type="number"
              value={throttle.perSecond}
              onChange={(e) => setThrottle({ ...throttle, perSecond: parseInt(e.target.value) || 1 })}
              min={1}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Emails per Hour</label>
            <input
              type="number"
              value={throttle.perHour}
              onChange={(e) => setThrottle({ ...throttle, perHour: parseInt(e.target.value) || 1 })}
              min={1}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>
        <button type="submit" disabled={saving} className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Throttle Defaults'}
        </button>
      </form>

      {/* Test Email */}
      <form onSubmit={handleTestEmail} className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Send Test Email</h2>
        <p className="mt-1 text-sm text-gray-500">Verify your email provider is configured correctly</p>
        <div className="mt-4 flex gap-3">
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="recipient@example.com"
            required
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <button type="submit" className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700">
            Send Test
          </button>
        </div>
      </form>

      {/* Clear History / Danger Zone */}
      <div className="mt-10 rounded-xl border-2 border-red-200 bg-red-50 p-6">
        <h2 className="text-lg font-semibold text-red-900">Danger Zone</h2>
        <p className="mt-1 text-sm text-red-700">These actions are irreversible. Proceed with caution.</p>
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-white p-4 shadow-sm">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Clear Campaign History</h3>
              <p className="text-xs text-gray-500">Delete all campaigns, recipients, email events, and unsubscribes</p>
            </div>
            <button
              onClick={() => setClearHistoryModal('campaigns')}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Clear Campaigns
            </button>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-white p-4 shadow-sm">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Clear All Contacts</h3>
              <p className="text-xs text-gray-500">Delete all contacts and their list memberships</p>
            </div>
            <button
              onClick={() => setClearHistoryModal('contacts')}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Clear Contacts
            </button>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-white p-4 shadow-sm">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Clear Everything</h3>
              <p className="text-xs text-gray-500">Delete all campaigns AND contacts. A complete data reset.</p>
            </div>
            <button
              onClick={() => setClearHistoryModal('all')}
              className="rounded-lg bg-red-900 px-4 py-2 text-sm font-medium text-white hover:bg-red-950"
            >
              Clear All Data
            </button>
          </div>
        </div>
      </div>

      {clearHistoryModal && (
        <AdminPasswordModal
          title={
            clearHistoryModal === 'campaigns'
              ? 'Clear all campaign history?'
              : clearHistoryModal === 'contacts'
              ? 'Clear all contacts?'
              : 'Clear ALL data?'
          }
          description={
            clearHistoryModal === 'campaigns'
              ? 'This will permanently delete ALL campaigns, recipients, email events, and unsubscribes. This action cannot be undone.'
              : clearHistoryModal === 'contacts'
              ? 'This will permanently delete ALL contacts and their list memberships. Historical send data will be preserved. This action cannot be undone.'
              : 'This will permanently delete ALL campaigns AND contacts. This is a complete data reset and cannot be undone.'
          }
          confirmLabel={
            clearHistoryModal === 'all' ? 'Delete Everything' : 'Clear History'
          }
          onConfirm={async (password) => {
            await clearHistory(clearHistoryModal, password);
            toast.success(
              clearHistoryModal === 'campaigns'
                ? 'All campaign history cleared'
                : clearHistoryModal === 'contacts'
                ? 'All contacts cleared'
                : 'All data cleared'
            );
            setClearHistoryModal(null);
          }}
          onCancel={() => setClearHistoryModal(null)}
        />
      )}
    </div>
  );
}

export default function Settings() {
  return (
    <ErrorBoundary>
      <SettingsContent />
    </ErrorBoundary>
  );
}
