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
import {
  useCustomVariables,
  useCreateCustomVariable,
  useUpdateCustomVariable,
  useDeleteCustomVariable,
  useReorderCustomVariables,
} from '../hooks/useCustomVariables';
import { CustomVariable } from '../api/customVariables.api';
import { FormSkeleton } from '../components/ui/Skeleton';
import ErrorBoundary from '../components/ErrorBoundary';
import AdminPasswordModal from '../components/ui/AdminPasswordModal';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

function SettingsContent() {
  const { data: settingsData, isLoading, isError } = useSettings();

  const [provider, setProvider] = useState<'gmail' | 'ses'>('ses');
  const [gmail, setGmail] = useState({ host: 'smtp.gmail.com', port: 587, user: '', pass: '' });
  const [ses, setSes] = useState({ region: 'ap-south-1', accessKeyId: '', secretAccessKey: '', fromEmail: '', fromName: '' });
  const [throttle, setThrottle] = useState({ perSecond: 5, perHour: 5000 });
  const [replyTo, setReplyTo] = useState('');
  const [replyToError, setReplyToError] = useState('');
  const [testTo, setTestTo] = useState('');

  const [gmailStatus, setGmailStatus] = useState<ConnectionStatus>('idle');
  const [sesStatus, setSesStatus] = useState<ConnectionStatus>('idle');

  const [gmailErrors, setGmailErrors] = useState<Record<string, string>>({});
  const [sesErrors, setSesErrors] = useState<Record<string, string>>({});

  const [clearHistoryModal, setClearHistoryModal] = useState<'campaigns' | 'contacts' | 'all' | null>(null);

  // Custom Variables state
  const { data: customVariables = [], isLoading: cvLoading } = useCustomVariables();
  const createCVMutation = useCreateCustomVariable();
  const updateCVMutation = useUpdateCustomVariable();
  const deleteCVMutation = useDeleteCustomVariable();
  const reorderCVMutation = useReorderCustomVariables();
  const [showCVForm, setShowCVForm] = useState(false);
  const [editingCV, setEditingCV] = useState<CustomVariable | null>(null);
  const [cvForm, setCVForm] = useState({ name: '', type: 'text' as CustomVariable['type'], options: '' as string, required: false, default_value: '' });

  function resetCVForm() {
    setCVForm({ name: '', type: 'text', options: '', required: false, default_value: '' });
    setEditingCV(null);
    setShowCVForm(false);
  }

  function openEditCV(cv: CustomVariable) {
    setEditingCV(cv);
    setCVForm({
      name: cv.name,
      type: cv.type,
      options: cv.options.join(', '),
      required: cv.required,
      default_value: cv.default_value || '',
    });
    setShowCVForm(true);
  }

  async function handleSaveCV(e: FormEvent) {
    e.preventDefault();
    if (!cvForm.name.trim()) return;
    const payload = {
      name: cvForm.name,
      type: cvForm.type,
      options: cvForm.type === 'select' ? cvForm.options.split(',').map(o => o.trim()).filter(Boolean) : [],
      required: cvForm.required,
      default_value: cvForm.default_value || null,
    };
    if (editingCV) {
      await updateCVMutation.mutateAsync({ id: editingCV.id, data: payload });
    } else {
      await createCVMutation.mutateAsync(payload);
    }
    resetCVForm();
  }

  function handleMoveCV(idx: number, direction: 'up' | 'down') {
    const vars = [...customVariables];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= vars.length) return;
    const order = vars.map((v, i) => ({
      id: v.id,
      sort_order: i === idx ? swapIdx : i === swapIdx ? idx : i,
    }));
    reorderCVMutation.mutate(order);
  }

  const updateProviderMutation = useUpdateProvider();
  const updateGmailMutation = useUpdateGmailConfig();
  const updateSesMutation = useUpdateSesConfig();
  const updateThrottleMutation = useUpdateThrottleDefaults();
  const updateReplyToMutation = useUpdateReplyTo();

  // Populate form when settings load — replace masked values with empty string + placeholder
  useEffect(() => {
    if (settingsData) {
      if (settingsData.email_provider) setProvider(settingsData.email_provider);
      if (settingsData.gmail_config) {
        const gc = { ...settingsData.gmail_config };
        // If pass is masked, show empty — user must re-enter to change
        if (typeof gc.pass === 'string' && gc.pass.startsWith('****')) gc.pass = '';
        setGmail(gc);
      }
      if (settingsData.ses_config) {
        const sc = { ...settingsData.ses_config };
        // If keys are masked, show empty — user must re-enter to change
        if (typeof sc.accessKeyId === 'string' && sc.accessKeyId.startsWith('****')) sc.accessKeyId = '';
        if (typeof sc.secretAccessKey === 'string' && sc.secretAccessKey.startsWith('****')) sc.secretAccessKey = '';
        // Ensure fromName always exists in state
        if (!sc.fromName) sc.fromName = '';
        setSes(sc);
      }
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
    const hasSavedPass = settingsData?.gmail_config?.pass;
    if (!gmail.pass.trim() && !hasSavedPass) errors.pass = 'App password is required';
    setGmailErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function validateSes(): boolean {
    const errors: Record<string, string> = {};
    if (!ses.region.trim()) errors.region = 'AWS Region is required';
    if (!ses.fromEmail.trim()) errors.fromEmail = 'From email is required';
    // Keys are only required if not already saved (placeholder shows "saved" state)
    const hasSavedKeys = settingsData?.ses_config?.accessKeyId;
    if (!ses.accessKeyId.trim() && !hasSavedKeys) errors.accessKeyId = 'Access Key ID is required';
    if (!ses.secretAccessKey.trim() && !hasSavedKeys) errors.secretAccessKey = 'Secret Access Key is required';
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
    // Explicitly include all fields to ensure fromName is sent
    updateSesMutation.mutate({
      region: ses.region,
      accessKeyId: ses.accessKeyId,
      secretAccessKey: ses.secretAccessKey,
      fromEmail: ses.fromEmail,
      fromName: ses.fromName || '',
    });
  }

  async function handleTestSes() {
    if (!validateSes()) return;
    setSesStatus('testing');
    try {
      await updateSesMutation.mutateAsync({
        region: ses.region,
        accessKeyId: ses.accessKeyId,
        secretAccessKey: ses.secretAccessKey,
        fromEmail: ses.fromEmail,
        fromName: ses.fromName || '',
      });
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
              <input type="password" placeholder={settingsData?.gmail_config?.pass ? '••••••• (saved — leave blank to keep)' : 'Enter app password'} value={gmail.pass} onChange={(e) => { setGmail({ ...gmail, pass: e.target.value }); setGmailErrors((p) => ({ ...p, pass: '' })); }} className={inputClass(gmailErrors.pass)} />
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
              <label className="block text-sm font-medium text-gray-700">From Name</label>
              <input type="text" placeholder="e.g. BITS PILANI - YEB" value={ses.fromName} onChange={(e) => setSes({ ...ses, fromName: e.target.value })} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border" />
              <p className="mt-1 text-xs text-gray-500">Display name shown in recipient's inbox</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Access Key ID *</label>
              <input type="password" placeholder={settingsData?.ses_config?.accessKeyId ? '••••••• (saved — leave blank to keep)' : 'AKIA...'} value={ses.accessKeyId} onChange={(e) => { setSes({ ...ses, accessKeyId: e.target.value }); setSesErrors((p) => ({ ...p, accessKeyId: '' })); }} className={inputClass(sesErrors.accessKeyId)} />
              {sesErrors.accessKeyId && <p className="mt-1 text-xs text-red-500">{sesErrors.accessKeyId}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Secret Access Key *</label>
              <input type="password" placeholder={settingsData?.ses_config?.secretAccessKey ? '••••••• (saved — leave blank to keep)' : 'Enter secret key'} value={ses.secretAccessKey} onChange={(e) => { setSes({ ...ses, secretAccessKey: e.target.value }); setSesErrors((p) => ({ ...p, secretAccessKey: '' })); }} className={inputClass(sesErrors.secretAccessKey)} />
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

      {/* Custom Variables */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Custom Variables</h2>
            <p className="mt-1 text-sm text-gray-500">
              Define custom template variables (e.g. principal_name, phone). These appear in contact forms, CSV import, and as {'{{key}}'} in templates.
            </p>
          </div>
          <button
            onClick={() => { resetCVForm(); setShowCVForm(true); }}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
          >
            Add Variable
          </button>
        </div>

        {/* Variable Form */}
        {showCVForm && (
          <form onSubmit={handleSaveCV} className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Display Name *</label>
                <input
                  type="text"
                  value={cvForm.name}
                  onChange={(e) => setCVForm({ ...cvForm, name: e.target.value })}
                  placeholder="e.g. Principal Name"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Type</label>
                <select
                  value={cvForm.type}
                  onChange={(e) => setCVForm({ ...cvForm, type: e.target.value as CustomVariable['type'] })}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="select">Select (dropdown)</option>
                </select>
              </div>
              {cvForm.type === 'select' && (
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">Options (comma-separated)</label>
                  <input
                    type="text"
                    value={cvForm.options}
                    onChange={(e) => setCVForm({ ...cvForm, options: e.target.value })}
                    placeholder="Option A, Option B, Option C"
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700">Default Value</label>
                <input
                  type="text"
                  value={cvForm.default_value}
                  onChange={(e) => setCVForm({ ...cvForm, default_value: e.target.value })}
                  placeholder="Optional"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cvForm.required}
                    onChange={(e) => setCVForm({ ...cvForm, required: e.target.checked })}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  Required field
                </label>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="submit"
                disabled={createCVMutation.isPending || updateCVMutation.isPending}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {editingCV ? 'Update Variable' : 'Create Variable'}
              </button>
              <button
                type="button"
                onClick={resetCVForm}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Variables List */}
        {cvLoading ? (
          <div className="mt-4 text-sm text-gray-400">Loading variables...</div>
        ) : customVariables.length === 0 ? (
          <div className="mt-4 rounded-lg border-2 border-dashed border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-500">No custom variables defined yet.</p>
            <p className="mt-1 text-xs text-gray-400">Custom variables let you store extra data per contact and use it in email templates.</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Order</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Key</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Type</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Required</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customVariables.map((cv, idx) => (
                  <tr key={cv.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleMoveCV(idx, 'up')}
                          disabled={idx === 0}
                          className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          title="Move up"
                        >
                          &#9650;
                        </button>
                        <button
                          onClick={() => handleMoveCV(idx, 'down')}
                          disabled={idx === customVariables.length - 1}
                          className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          title="Move down"
                        >
                          &#9660;
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">{cv.name}</td>
                    <td className="px-3 py-2">
                      <code className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">{`{{${cv.key}}}`}</code>
                    </td>
                    <td className="px-3 py-2 capitalize text-gray-600">{cv.type}</td>
                    <td className="px-3 py-2">{cv.required ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => openEditCV(cv)}
                        className="mr-2 text-primary-600 hover:text-primary-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete variable "${cv.name}"?`)) {
                            deleteCVMutation.mutate(cv.id);
                          }
                        }}
                        className="text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
