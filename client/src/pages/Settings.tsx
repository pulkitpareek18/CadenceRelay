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
  useUpdateDailyLimits,
  useDomainHealth,
  useSesQuota,
  useSnsStatus,
  useSetupSns,
  useBouncedEmails,
} from '../hooks/useSettings';
import type { DnsCheck } from '../api/settings.api';
import { getSesQuota } from '../api/settings.api';
import { deleteSuppressedContacts } from '../api/contacts.api';
import { bulkAddToSuppression as bulkAddToSuppressionApi } from '../api/suppression.api';
import {
  useSuppressionList,
  useSuppressionCount,
  useAddToSuppression,
  useBulkAddToSuppression,
  useRemoveFromSuppression,
  useSuppressedDomainList,
  useSuppressedDomainCount,
  useAddSuppressedDomain,
  useBulkAddSuppressedDomains,
  useRemoveSuppressedDomain,
} from '../hooks/useSuppression';
import {
  useCustomVariables,
  useCreateCustomVariable,
  useUpdateCustomVariable,
  useDeleteCustomVariable,
  useReorderCustomVariables,
} from '../hooks/useCustomVariables';
import { CustomVariable } from '../api/customVariables.api';
import { useEmailAccounts, useCreateEmailAccount, useUpdateEmailAccount, useDeleteEmailAccount, useTestEmailAccount } from '../hooks/useEmailAccounts';
import type { EmailAccount } from '../api/emailAccounts.api';
import { FormSkeleton } from '../components/ui/Skeleton';
import ErrorBoundary from '../components/ErrorBoundary';
import AdminPasswordModal from '../components/ui/AdminPasswordModal';
import { downloadBackup, restoreBackup } from '../api/backup.api';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

function DomainHealthStatusIcon({ status }: { status: DnsCheck['status'] }) {
  if (status === 'pass') return <span className="text-green-600 font-bold">&#10003;</span>;
  if (status === 'warning') return <span className="text-yellow-500 font-bold">&#9888;</span>;
  if (status === 'fail') return <span className="text-red-600 font-bold">&#10007;</span>;
  if (status === 'info') return <span className="text-blue-500 font-bold">&#8505;</span>;
  return <span className="text-gray-400 font-bold">?</span>;
}

function MetricGradeColor({ grade }: { grade: string }) {
  if (grade === 'good') return <span className="inline-block h-2 w-2 rounded-full bg-green-500 ml-1" />;
  if (grade === 'warning') return <span className="inline-block h-2 w-2 rounded-full bg-yellow-500 ml-1" />;
  return <span className="inline-block h-2 w-2 rounded-full bg-red-500 ml-1" />;
}

function SettingsContent() {
  const { data: settingsData, isLoading, isError } = useSettings();

  // Domain health — manual trigger
  const [healthEnabled, setHealthEnabled] = useState(false);
  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth } = useDomainHealth(healthEnabled);

  function handleRunHealthCheck() {
    if (healthEnabled) {
      refetchHealth();
    } else {
      setHealthEnabled(true);
    }
  }

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

  // Daily send limits state
  const [dailyLimits, setDailyLimits] = useState({ gmailDailyLimit: 500, sesDailyLimit: 50000 });
  const updateDailyLimitsMutation = useUpdateDailyLimits();

  // SES Quota state
  const [sesQuotaEnabled, setSesQuotaEnabled] = useState(false);
  const { data: sesQuotaData, refetch: refetchSesQuota } = useSesQuota(sesQuotaEnabled);
  const [sesQuotaSyncing, setSesQuotaSyncing] = useState(false);

  // SNS status state
  const [snsStatusEnabled, setSnsStatusEnabled] = useState(false);
  const { data: snsStatusData, isLoading: snsStatusLoading, refetch: refetchSnsStatus } = useSnsStatus(snsStatusEnabled);
  const setupSnsMutation = useSetupSns();

  // Auto-fetch SNS status on mount
  useEffect(() => {
    setSnsStatusEnabled(true);
  }, []);

  async function handleSyncSesQuota() {
    setSesQuotaSyncing(true);
    try {
      const quota = await getSesQuota();
      const newLimit = Math.floor(quota.max24HourSend * 0.95);
      setDailyLimits(prev => ({ ...prev, sesDailyLimit: newLimit }));
      setSesQuotaEnabled(true);
      // Also trigger a refetch so the quota display updates
      if (sesQuotaEnabled) refetchSesQuota();
      toast.success(`SES daily limit synced to ${newLimit.toLocaleString()} (95% of ${quota.max24HourSend.toLocaleString()} quota)`);
    } catch {
      toast.error('Failed to fetch SES quota. Check your IAM permissions (ses:GetSendQuota).');
    } finally {
      setSesQuotaSyncing(false);
    }
  }

  async function handleSetupSns() {
    await setupSnsMutation.mutateAsync();
    refetchSnsStatus();
  }

  // Bounced emails (not yet suppressed) state
  const [bouncedPage, setBouncedPage] = useState(1);
  const { data: bouncedData, refetch: refetchBounced } = useBouncedEmails({ page: bouncedPage, limit: 50 });
  const [bouncedSyncing, setBouncedSyncing] = useState(false);
  const [deleteBouncedModal, setDeleteBouncedModal] = useState(false);

  async function handleAddAllBouncedToSuppression() {
    if (!bouncedData || bouncedData.total === 0) return;
    setBouncedSyncing(true);
    try {
      // Fetch all bounced emails (paginated) and add them to suppression
      let page = 1;
      let totalAdded = 0;
      while (true) {
        const resp = await import('../api/settings.api').then(m => m.getBouncedEmails({ page, limit: 100 }));
        if (resp.data.length === 0) break;
        const emails = resp.data.map((b: { email: string }) => b.email);
        const result = await bulkAddToSuppressionApi(emails, 'auto-bounce-sync');
        totalAdded += result.added;
        if (page >= resp.pagination.totalPages) break;
        page++;
      }
      toast.success(`${totalAdded} bounced emails added to suppression list`);
      refetchBounced();
    } catch {
      toast.error('Failed to add bounced emails to suppression list');
    } finally {
      setBouncedSyncing(false);
    }
  }

  async function handleDeleteSuppressedContacts(adminPassword: string) {
    try {
      const result = await deleteSuppressedContacts(adminPassword);
      toast.success(result.message || `${result.deleted} contacts deleted`);
      setDeleteBouncedModal(false);
      refetchBounced();
    } catch {
      toast.error('Failed to delete suppressed contacts');
    }
  }

  // Suppression list state
  const [suppressionPage, setSuppressionPage] = useState(1);
  const [suppressionSearch, setSuppressionSearch] = useState('');
  const [suppressionAddEmail, setSuppressionAddEmail] = useState('');
  const [suppressionAddReason, setSuppressionAddReason] = useState('');
  const [suppressionBulkText, setSuppressionBulkText] = useState('');
  const { data: suppressionData } = useSuppressionList({
    page: String(suppressionPage),
    limit: '10',
    ...(suppressionSearch ? { search: suppressionSearch } : {}),
  });
  const { data: suppressionCountData } = useSuppressionCount();
  const addSuppressionMutation = useAddToSuppression();
  const bulkAddSuppressionMutation = useBulkAddToSuppression();
  const removeSuppressionMutation = useRemoveFromSuppression();

  // Backup & Restore state
  const [backupExporting, setBackupExporting] = useState(false);
  const [backupRestoreFile, setBackupRestoreFile] = useState<File | null>(null);
  const [backupRestorePassword, setBackupRestorePassword] = useState('');
  const [backupRestoring, setBackupRestoring] = useState(false);
  const [backupShowConfirm, setBackupShowConfirm] = useState(false);

  async function handleBackupExport() {
    setBackupExporting(true);
    try {
      await downloadBackup();
      toast.success('Backup downloaded');
    } catch (err) {
      toast.error('Backup export failed: ' + ((err as Error).message || 'Unknown error'));
    } finally {
      setBackupExporting(false);
    }
  }

  async function handleBackupRestore() {
    if (!backupRestoreFile) { toast.error('Select a backup file first'); return; }
    if (!backupRestorePassword) { toast.error('Admin password required'); return; }
    setBackupRestoring(true);
    try {
      const result = await restoreBackup(backupRestoreFile, backupRestorePassword);
      const total = Object.values(result.restored).reduce((a, b) => a + b, 0);
      toast.success(`Restored ${total} rows. Reloading…`);
      setBackupRestoreFile(null);
      setBackupRestorePassword('');
      setBackupShowConfirm(false);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      const axErr = err as { response?: { data?: { error?: string; message?: string } } };
      toast.error(axErr?.response?.data?.error || axErr?.response?.data?.message || 'Restore failed');
    } finally {
      setBackupRestoring(false);
    }
  }

  // Email Accounts state
  const { data: emailAccounts = [] } = useEmailAccounts();
  const createAccountMutation = useCreateEmailAccount();
  const updateAccountMutation = useUpdateEmailAccount();
  const deleteAccountMutation = useDeleteEmailAccount();
  const testAccountMutation = useTestEmailAccount();
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editAccount, setEditAccount] = useState<{ label: string; fromName: string; fromEmail: string; host: string; port: number; dailyLimit: number; pass: string; accessKeyId: string; secretAccessKey: string }>({ label: '', fromName: '', fromEmail: '', host: 'smtp.gmail.com', port: 587, dailyLimit: 500, pass: '', accessKeyId: '', secretAccessKey: '' });
  const [newAccount, setNewAccount] = useState({ label: '', providerType: 'gmail' as 'gmail' | 'ses', host: 'smtp.gmail.com', port: 587, user: '', pass: '', region: 'us-east-1', accessKeyId: '', secretAccessKey: '', fromEmail: '', fromName: '', dailyLimit: 500 });

  // Domain suppression state
  const [domainSuppPage, setDomainSuppPage] = useState(1);
  const [domainSuppSearch, setDomainSuppSearch] = useState('');
  const [domainSuppAddDomain, setDomainSuppAddDomain] = useState('');
  const [domainSuppAddReason, setDomainSuppAddReason] = useState('');
  const [domainSuppBulkText, setDomainSuppBulkText] = useState('');
  const { data: domainSuppData } = useSuppressedDomainList({
    page: String(domainSuppPage),
    limit: '10',
    ...(domainSuppSearch ? { search: domainSuppSearch } : {}),
  });
  const { data: domainSuppCountData } = useSuppressedDomainCount();
  const addDomainSuppMutation = useAddSuppressedDomain();
  const bulkAddDomainSuppMutation = useBulkAddSuppressedDomains();
  const removeDomainSuppMutation = useRemoveSuppressedDomain();

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
      // Daily limits — stored as individual settings keys
      const gl = settingsData.gmail_daily_limit;
      const sl = settingsData.ses_daily_limit;
      setDailyLimits({
        gmailDailyLimit: typeof gl === 'number' ? gl : (typeof gl === 'string' ? parseInt(gl, 10) || 500 : 500),
        sesDailyLimit: typeof sl === 'number' ? sl : (typeof sl === 'string' ? parseInt(sl, 10) || 50000 : 50000),
      });
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

  const saving = updateGmailMutation.isPending || updateSesMutation.isPending || updateThrottleMutation.isPending || updateReplyToMutation.isPending || updateDailyLimitsMutation.isPending;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Domain Health Dashboard */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Domain Health</h2>
            <p className="mt-1 text-sm text-gray-500">Check DNS configuration and deliverability metrics for your sending domain</p>
          </div>
          <button
            onClick={handleRunHealthCheck}
            disabled={healthLoading}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {healthLoading ? 'Checking...' : healthData ? 'Refresh Health Check' : 'Run Health Check'}
          </button>
        </div>

        {healthLoading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
            Running DNS checks and loading metrics...
          </div>
        )}

        {healthData && !healthLoading && (
          <div className="mt-4 space-y-4">
            {/* Score and Grade */}
            <div className="flex items-center gap-4">
              <div className={`text-3xl font-bold ${
                healthData.healthScore >= 80 ? 'text-green-600' :
                healthData.healthScore >= 50 ? 'text-yellow-600' : 'text-red-600'
              }`}>
                {healthData.healthScore}/100
              </div>
              <div className={`rounded-lg px-3 py-1 text-lg font-bold ${
                healthData.healthScore >= 80 ? 'bg-green-100 text-green-700' :
                healthData.healthScore >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
              }`}>
                Grade: {healthData.grade}
              </div>
              {healthData.domain && (
                <span className="text-sm text-gray-500">Domain: <span className="font-mono font-medium text-gray-700">{healthData.domain}</span></span>
              )}
            </div>

            {/* DNS Checks */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(Object.entries(healthData.checks) as [string, DnsCheck][]).map(([key, check]) => (
                <div
                  key={key}
                  className={`flex items-start gap-2 rounded-lg border p-3 ${
                    check.status === 'pass' ? 'border-green-200 bg-green-50' :
                    check.status === 'warning' ? 'border-yellow-200 bg-yellow-50' :
                    check.status === 'fail' ? 'border-red-200 bg-red-50' :
                    'border-gray-200 bg-gray-50'
                  }`}
                >
                  <DomainHealthStatusIcon status={check.status} />
                  <div className="min-w-0">
                    <span className="text-sm font-semibold uppercase text-gray-700">{key}</span>
                    <p className="text-xs text-gray-600">{check.message}</p>
                    {check.record && (
                      <p className="mt-1 truncate text-xs font-mono text-gray-400" title={check.record}>{check.record}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Deliverability Metrics */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Deliverability Metrics (Last 30 Days)</h3>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
                  <div className="text-lg font-bold text-gray-900">{healthData.metrics.sent30d.toLocaleString()}</div>
                  <div className="text-xs text-gray-500">Sent</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-lg font-bold text-gray-900">{healthData.metrics.bounceRate}%</span>
                    <MetricGradeColor grade={healthData.metrics.bounceRateGrade} />
                  </div>
                  <div className="text-xs text-gray-500">Bounce Rate</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-lg font-bold text-gray-900">{healthData.metrics.complaintRate}%</span>
                    <MetricGradeColor grade={healthData.metrics.complaintRateGrade} />
                  </div>
                  <div className="text-xs text-gray-500">Complaint Rate</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
                  <div className="text-lg font-bold text-gray-900">{healthData.metrics.unsubRate}%</div>
                  <div className="text-xs text-gray-500">Unsub Rate</div>
                </div>
              </div>
            </div>

            {/* Recommendations */}
            {healthData.recommendations.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700">Recommendations</h3>
                <ul className="mt-2 space-y-1">
                  {healthData.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="mt-0.5 text-primary-500">&bull;</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Email Accounts */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Email Accounts
              {emailAccounts.length > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  {emailAccounts.length}
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Add multiple Gmail or SES accounts. Select which account to use when creating a campaign.
            </p>
          </div>
          <button
            onClick={() => setShowAddAccount(!showAddAccount)}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
          >
            {showAddAccount ? 'Cancel' : 'Add Account'}
          </button>
        </div>

        {/* Add Account Form */}
        {showAddAccount && (
          <div className="mt-4 rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600">Label</label>
                <input type="text" value={newAccount.label} onChange={(e) => setNewAccount({ ...newAccount, label: e.target.value })} placeholder="e.g., Office Gmail" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">Provider Type</label>
                <div className="mt-1 flex gap-2">
                  <button onClick={() => setNewAccount({ ...newAccount, providerType: 'gmail', dailyLimit: 500 })} className={`rounded-lg px-3 py-2 text-sm ${newAccount.providerType === 'gmail' ? 'bg-primary-600 text-white' : 'bg-gray-100'}`}>Gmail</button>
                  <button onClick={() => setNewAccount({ ...newAccount, providerType: 'ses', dailyLimit: 50000 })} className={`rounded-lg px-3 py-2 text-sm ${newAccount.providerType === 'ses' ? 'bg-primary-600 text-white' : 'bg-gray-100'}`}>SES</button>
                </div>
              </div>
            </div>
            {newAccount.providerType === 'gmail' ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  Works with Gmail, Brevo, Mailgun, Postmark, or any SMTP relay. If your provider
                  (e.g. Brevo) issues a separate login username, fill in <span className="font-medium">Sender Email</span> with
                  the verified address you actually want recipients to see.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-medium text-gray-600">From Name</label><input type="text" value={newAccount.fromName} onChange={(e) => setNewAccount({ ...newAccount, fromName: e.target.value })} placeholder="e.g., BITS PILANI - YEB" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                  <div><label className="block text-xs font-medium text-gray-600">Auth Email / SMTP Username</label><input type="text" value={newAccount.user} onChange={(e) => setNewAccount({ ...newAccount, user: e.target.value })} placeholder="you@gmail.com or 9abc12@smtp-brevo.com" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                  <div className="col-span-2"><label className="block text-xs font-medium text-gray-600">Sender Email <span className="text-gray-400">(optional — leave blank to use auth email)</span></label><input type="email" value={newAccount.fromEmail} onChange={(e) => setNewAccount({ ...newAccount, fromEmail: e.target.value })} placeholder="hello@yourdomain.com" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                  <div><label className="block text-xs font-medium text-gray-600">App Password</label><input type="password" value={newAccount.pass} onChange={(e) => setNewAccount({ ...newAccount, pass: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                  <div><label className="block text-xs font-medium text-gray-600">SMTP Host</label><input type="text" value={newAccount.host} onChange={(e) => setNewAccount({ ...newAccount, host: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                  <div><label className="block text-xs font-medium text-gray-600">Port</label><input type="number" value={newAccount.port} onChange={(e) => setNewAccount({ ...newAccount, port: parseInt(e.target.value) || 587 })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-gray-600">AWS Region</label><input type="text" value={newAccount.region} onChange={(e) => setNewAccount({ ...newAccount, region: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600">From Email</label><input type="email" value={newAccount.fromEmail} onChange={(e) => setNewAccount({ ...newAccount, fromEmail: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600">Access Key ID</label><input type="password" value={newAccount.accessKeyId} onChange={(e) => setNewAccount({ ...newAccount, accessKeyId: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600">Secret Access Key</label><input type="password" value={newAccount.secretAccessKey} onChange={(e) => setNewAccount({ ...newAccount, secretAccessKey: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600">Daily Send Limit</label>
              <input type="number" value={newAccount.dailyLimit} onChange={(e) => setNewAccount({ ...newAccount, dailyLimit: parseInt(e.target.value) || 500 })} className="mt-1 w-32 rounded-lg border px-3 py-2 text-sm" />
            </div>
            <button
              onClick={() => {
                const config = newAccount.providerType === 'gmail'
                  ? { host: newAccount.host, port: newAccount.port, user: newAccount.user, pass: newAccount.pass, fromName: newAccount.fromName || undefined, fromEmail: newAccount.fromEmail.trim() || undefined }
                  : { region: newAccount.region, accessKeyId: newAccount.accessKeyId, secretAccessKey: newAccount.secretAccessKey, fromEmail: newAccount.fromEmail, fromName: newAccount.fromName };
                createAccountMutation.mutate({ label: newAccount.label, providerType: newAccount.providerType, config, dailyLimit: newAccount.dailyLimit }, {
                  onSuccess: () => { setShowAddAccount(false); setNewAccount({ label: '', providerType: 'gmail', host: 'smtp.gmail.com', port: 587, user: '', pass: '', region: 'us-east-1', accessKeyId: '', secretAccessKey: '', fromEmail: '', fromName: '', dailyLimit: 500 }); },
                });
              }}
              disabled={createAccountMutation.isPending || !newAccount.label.trim()}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {createAccountMutation.isPending ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        )}

        {/* Accounts List */}
        {emailAccounts.length > 0 ? (
          <div className="mt-4 space-y-3">
            {emailAccounts.map((acct: EmailAccount) => (
              <div key={acct.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${acct.provider_type === 'gmail' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                      {acct.provider_type.toUpperCase()}
                    </span>
                    <div>
                      <div className="font-medium text-sm">{acct.label}</div>
                      <div className="text-xs text-gray-500 font-mono">
                        {acct.config.fromName ? `${acct.config.fromName} — ` : ''}{acct.provider_type === 'gmail' ? ((acct.config.fromEmail as string) || (acct.config.user as string) || 'Not configured') : (acct.config.fromEmail as string || 'Not configured')}
                      </div>
                      {acct.provider_type === 'gmail' && Boolean(acct.config.fromEmail) && Boolean(acct.config.user) && acct.config.fromEmail !== acct.config.user && (
                        <div className="text-[10px] text-gray-400 font-mono">auth: {acct.config.user as string}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{acct.daily_limit}/day</span>
                    <button
                      onClick={() => {
                        if (editingAccountId === acct.id) { setEditingAccountId(null); return; }
                        setEditingAccountId(acct.id);
                        setEditAccount({
                          label: acct.label,
                          fromName: (acct.config.fromName as string) || '',
                          fromEmail: (acct.config.fromEmail as string) || '',
                          host: (acct.config.host as string) || 'smtp.gmail.com',
                          port: (acct.config.port as number) || 587,
                          dailyLimit: acct.daily_limit,
                          pass: '',
                          accessKeyId: '',
                          secretAccessKey: '',
                        });
                      }}
                      className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                    >
                      {editingAccountId === acct.id ? 'Cancel' : 'Edit'}
                    </button>
                    <button
                      onClick={() => testAccountMutation.mutate({ id: acct.id })}
                      disabled={testAccountMutation.isPending}
                      className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => { if (confirm(`Delete account "${acct.label}"?`)) deleteAccountMutation.mutate(acct.id); }}
                      className="text-red-600 hover:text-red-800 text-xs"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {/* Inline Edit Form */}
                {editingAccountId === acct.id && (
                  <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Label</label>
                        <input type="text" value={editAccount.label} onChange={(e) => setEditAccount({ ...editAccount, label: e.target.value })} className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600">From Name</label>
                        <input type="text" value={editAccount.fromName} onChange={(e) => setEditAccount({ ...editAccount, fromName: e.target.value })} placeholder="e.g., BITS PILANI - YEB" className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Daily Limit</label>
                        <input type="number" value={editAccount.dailyLimit} onChange={(e) => setEditAccount({ ...editAccount, dailyLimit: parseInt(e.target.value) || 500 })} className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
                      </div>
                    </div>
                    {acct.provider_type === 'gmail' && (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs font-medium text-gray-600">SMTP Host</label>
                            <input type="text" value={editAccount.host} onChange={(e) => setEditAccount({ ...editAccount, host: e.target.value })} className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600">Port</label>
                            <input type="number" value={editAccount.port} onChange={(e) => setEditAccount({ ...editAccount, port: parseInt(e.target.value) || 587 })} className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600">New App Password (blank = keep)</label>
                            <input type="password" value={editAccount.pass} onChange={(e) => setEditAccount({ ...editAccount, pass: e.target.value })} placeholder="Leave blank to keep" className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Sender Email <span className="text-gray-400">(optional — overrides auth email in the From: header; required for Brevo-style relays)</span></label>
                          <input type="email" value={editAccount.fromEmail} onChange={(e) => setEditAccount({ ...editAccount, fromEmail: e.target.value })} placeholder="Leave blank to use auth email" className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
                        </div>
                      </>
                    )}
                    {acct.provider_type === 'ses' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Access Key ID (leave blank to keep)</label>
                          <input type="password" value={editAccount.accessKeyId} onChange={(e) => setEditAccount({ ...editAccount, accessKeyId: e.target.value })} placeholder="Leave blank to keep" className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600">Secret Key (leave blank to keep)</label>
                          <input type="password" value={editAccount.secretAccessKey} onChange={(e) => setEditAccount({ ...editAccount, secretAccessKey: e.target.value })} placeholder="Leave blank to keep" className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        const config: Record<string, unknown> = { fromName: editAccount.fromName || undefined };
                        if (acct.provider_type === 'gmail') {
                          config.host = editAccount.host;
                          config.port = editAccount.port;
                          // Send empty string when cleared so the server can drop the override
                          // (encryptConfig won't touch non-sensitive keys, so the merge will overwrite).
                          config.fromEmail = editAccount.fromEmail.trim();
                          if (editAccount.pass) config.pass = editAccount.pass;
                        }
                        if (acct.provider_type === 'ses' && editAccount.accessKeyId) config.accessKeyId = editAccount.accessKeyId;
                        if (acct.provider_type === 'ses' && editAccount.secretAccessKey) config.secretAccessKey = editAccount.secretAccessKey;
                        updateAccountMutation.mutate({ id: acct.id, data: { label: editAccount.label, config, dailyLimit: editAccount.dailyLimit } }, {
                          onSuccess: () => setEditingAccountId(null),
                        });
                      }}
                      disabled={updateAccountMutation.isPending}
                      className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {updateAccountMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : !showAddAccount ? (
          <div className="mt-4 rounded-lg border-2 border-dashed border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-500">No email accounts yet. Add one to use per-campaign account selection.</p>
          </div>
        ) : null}
      </div>

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
              <input type="text" placeholder="e.g. BITS PILANI - YEB" value={ses.fromName} onChange={(e) => setSes({ ...ses, fromName: e.target.value })} className={inputClass()} />
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

      {/* Daily Send Limits */}
      <form onSubmit={(e) => { e.preventDefault(); updateDailyLimitsMutation.mutate(dailyLimits); }} className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Daily Send Limits</h2>
            <p className="mt-1 text-sm text-gray-500">Maximum emails per day per provider. Campaigns auto-pause when the limit is reached and auto-resume the next day.</p>
          </div>
          <button
            type="button"
            onClick={handleSyncSesQuota}
            disabled={sesQuotaSyncing}
            className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {sesQuotaSyncing ? 'Syncing...' : 'Sync from AWS'}
          </button>
        </div>

        {/* SES Quota Info */}
        {sesQuotaData && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-1">
            {sesQuotaData.sandbox && (
              <div className="flex items-center gap-1.5 rounded bg-yellow-100 border border-yellow-300 px-2 py-1 text-xs font-medium text-yellow-800 mb-2">
                <span>&#9888;</span> SES Sandbox Mode -- You can only send to verified email addresses. Request production access from AWS to lift this restriction.
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-700">SES usage (last 24h):</span>
              <span className="font-semibold text-blue-900">
                {sesQuotaData.sentLast24Hours.toLocaleString()} / {sesQuotaData.max24HourSend.toLocaleString()} sent
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-blue-200">
              <div
                className={`h-1.5 rounded-full transition-all ${sesQuotaData.usagePercent >= 80 ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(100, sesQuotaData.usagePercent)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-blue-600">
              <span>{sesQuotaData.usagePercent}% used ({sesQuotaData.remaining.toLocaleString()} remaining)</span>
              <span>Max rate: {sesQuotaData.maxSendRate} emails/sec</span>
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Gmail Daily Limit</label>
            <input
              type="number"
              value={dailyLimits.gmailDailyLimit}
              onChange={(e) => setDailyLimits({ ...dailyLimits, gmailDailyLimit: parseInt(e.target.value) || 1 })}
              min={1}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">SES Daily Limit</label>
            <input
              type="number"
              value={dailyLimits.sesDailyLimit}
              onChange={(e) => setDailyLimits({ ...dailyLimits, sesDailyLimit: parseInt(e.target.value) || 1 })}
              min={1}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>
        <button type="submit" disabled={saving} className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Daily Limits'}
        </button>
      </form>

      {/* Bounce & Complaint Tracking (SNS Setup) */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Bounce & Complaint Tracking</h2>
        <p className="mt-1 text-sm text-gray-500">
          SES bounce notifications let the platform automatically detect bounced emails and mark contacts accordingly. This prevents sending to invalid addresses and protects your sender reputation.
        </p>

        {snsStatusLoading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
            Checking SNS configuration...
          </div>
        )}

        {snsStatusData && !snsStatusLoading && (
          <div className="mt-4">
            {snsStatusData.configured ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-green-600 font-bold text-lg">&#10003;</span>
                  <span className="text-sm font-medium text-green-700">Configured</span>
                </div>
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-1 text-sm">
                  {snsStatusData.bounceTopicArn && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-gray-700 whitespace-nowrap">Bounces:</span>
                      <span className="text-gray-600 font-mono text-xs break-all">{snsStatusData.bounceTopicArn}</span>
                    </div>
                  )}
                  {snsStatusData.complaintTopicArn && (
                    <div className="flex items-start gap-2">
                      <span className="font-medium text-gray-700 whitespace-nowrap">Complaints:</span>
                      <span className="text-gray-600 font-mono text-xs break-all">{snsStatusData.complaintTopicArn}</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-500">Bounced contacts are automatically marked and added to the suppression list.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-red-600 font-bold text-lg">&#10007;</span>
                  <span className="text-sm font-medium text-red-700">Not configured</span>
                </div>
                <button
                  onClick={handleSetupSns}
                  disabled={setupSnsMutation.isPending}
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {setupSnsMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Setting up...
                    </span>
                  ) : (
                    'Set Up Automatically'
                  )}
                </button>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 space-y-1.5">
                  <p className="font-medium text-gray-700">This will:</p>
                  <ul className="list-disc list-inside space-y-0.5 ml-1">
                    <li>Create an SNS topic &quot;cadencerelay-notifications&quot;</li>
                    <li>Subscribe our webhook endpoint</li>
                    <li>Configure SES to send bounce & complaint notifications</li>
                  </ul>
                  <p className="mt-2 text-gray-500">
                    Required IAM permissions: <span className="font-mono">sns:CreateTopic</span>, <span className="font-mono">sns:Subscribe</span>, <span className="font-mono">ses:SetIdentityNotificationTopic</span>
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {!snsStatusData && !snsStatusLoading && (
          <button
            onClick={() => setSnsStatusEnabled(true)}
            className="mt-4 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Check SNS Status
          </button>
        )}
      </div>

      {/* Bounced Emails Not Yet Suppressed */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Bounced Emails Not Yet Suppressed
              {bouncedData?.total != null && bouncedData.total > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                  {bouncedData.total.toLocaleString()}
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Emails that bounced in campaigns but are not yet on your suppression list.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddAllBouncedToSuppression}
              disabled={bouncedSyncing || !bouncedData || bouncedData.total === 0}
              className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50 transition-colors"
            >
              {bouncedSyncing ? 'Syncing...' : 'Add All to Suppression List'}
            </button>
            <button
              onClick={() => setDeleteBouncedModal(true)}
              disabled={!bouncedData || bouncedData.total === 0}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              Delete All Bounced Contacts
            </button>
          </div>
        </div>

        {bouncedData && bouncedData.data.length > 0 ? (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Email</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Bounced At</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Error</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Times Bounced</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {bouncedData.data.map((entry) => (
                    <tr key={entry.email} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs">{entry.email}</td>
                      <td className="px-3 py-2 text-gray-400 text-xs">
                        {entry.bounced_at ? new Date(entry.bounced_at).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs truncate max-w-xs" title={entry.error_message || ''}>
                        {entry.error_message || 'Permanent bounce'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600 text-xs">{entry.bounce_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {bouncedData.pagination && bouncedData.pagination.totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                <span>
                  Showing {Math.min(bouncedData.pagination.limit, bouncedData.data.length)} of {bouncedData.pagination.total.toLocaleString()}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBouncedPage(Math.max(1, bouncedPage - 1))}
                    disabled={bouncedPage <= 1}
                    className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setBouncedPage(bouncedPage + 1)}
                    disabled={bouncedPage >= bouncedData.pagination.totalPages}
                    className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="mt-4 rounded-lg border-2 border-dashed border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-500">No bounced emails outside the suppression list.</p>
          </div>
        )}
      </div>

      {/* Admin password modal for deleting suppressed contacts */}
      {deleteBouncedModal && (
        <AdminPasswordModal
          title="Delete All Suppressed Contacts"
          description="This will permanently delete all contacts whose email is on the suppression list. Campaign history will be preserved but unlinked. This cannot be undone."
          onConfirm={handleDeleteSuppressedContacts}
          onCancel={() => setDeleteBouncedModal(false)}
        />
      )}

      {/* Suppression List */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Suppression List
              {suppressionCountData?.count != null && (
                <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                  {suppressionCountData.count}
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Emails on this list will never be sent to. Unsubscribes and permanent bounces are auto-added.
            </p>
          </div>
        </div>

        {/* Add single email */}
        <div className="mt-4 flex gap-2">
          <input
            type="email"
            value={suppressionAddEmail}
            onChange={(e) => setSuppressionAddEmail(e.target.value)}
            placeholder="email@example.com"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <input
            type="text"
            value={suppressionAddReason}
            onChange={(e) => setSuppressionAddReason(e.target.value)}
            placeholder="Reason (optional)"
            className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <button
            onClick={() => {
              if (!suppressionAddEmail.trim()) return;
              addSuppressionMutation.mutate({ email: suppressionAddEmail.trim(), reason: suppressionAddReason || undefined });
              setSuppressionAddEmail('');
              setSuppressionAddReason('');
            }}
            disabled={addSuppressionMutation.isPending || !suppressionAddEmail.trim()}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {/* Bulk add */}
        <div className="mt-3">
          <label className="block text-sm font-medium text-gray-700">Bulk Add (one email per line)</label>
          <textarea
            value={suppressionBulkText}
            onChange={(e) => setSuppressionBulkText(e.target.value)}
            placeholder={"bad@example.com\nbounced@test.com"}
            rows={3}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <button
            onClick={() => {
              const emails = suppressionBulkText.split('\n').map(e => e.trim()).filter(e => e.includes('@'));
              if (emails.length === 0) { toast.error('No valid emails found'); return; }
              bulkAddSuppressionMutation.mutate({ emails });
              setSuppressionBulkText('');
            }}
            disabled={bulkAddSuppressionMutation.isPending || !suppressionBulkText.trim()}
            className="mt-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {bulkAddSuppressionMutation.isPending ? 'Adding...' : 'Bulk Add'}
          </button>
        </div>

        {/* Search */}
        <div className="mt-4">
          <input
            type="text"
            value={suppressionSearch}
            onChange={(e) => { setSuppressionSearch(e.target.value); setSuppressionPage(1); }}
            placeholder="Search suppressed emails..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        {/* Table */}
        {suppressionData?.data && suppressionData.data.length > 0 ? (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Email</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Reason</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Added By</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Date</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {suppressionData.data.map((entry: { id: string; email: string; reason: string; added_by: string; created_at: string }) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs">{entry.email}</td>
                      <td className="px-3 py-2 text-gray-600">{entry.reason}</td>
                      <td className="px-3 py-2 text-gray-500">{entry.added_by}</td>
                      <td className="px-3 py-2 text-gray-400 text-xs">{new Date(entry.created_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => {
                            if (confirm(`Remove ${entry.email} from suppression list?`)) {
                              removeSuppressionMutation.mutate(entry.id);
                            }
                          }}
                          className="text-red-600 hover:text-red-800 text-xs"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {suppressionData.pagination && suppressionData.pagination.totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                <span>Page {suppressionData.pagination.page} of {suppressionData.pagination.totalPages} ({suppressionData.pagination.total} total)</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSuppressionPage(Math.max(1, suppressionPage - 1))}
                    disabled={suppressionPage <= 1}
                    className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setSuppressionPage(suppressionPage + 1)}
                    disabled={suppressionPage >= suppressionData.pagination.totalPages}
                    className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="mt-4 rounded-lg border-2 border-dashed border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-500">{suppressionSearch ? 'No matching emails found' : 'No suppressed emails yet'}</p>
          </div>
        )}
      </div>

      {/* Suppressed Domains */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Suppressed Domains
              {domainSuppCountData?.count != null && domainSuppCountData.count > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                  {domainSuppCountData.count}
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              All emails to these domains will be blocked. Use for typo domains like gamil.com, rediffmail.com, etc.
            </p>
          </div>
        </div>

        {/* Add single domain */}
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={domainSuppAddDomain}
            onChange={(e) => setDomainSuppAddDomain(e.target.value)}
            placeholder="gamil.com"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <input
            type="text"
            value={domainSuppAddReason}
            onChange={(e) => setDomainSuppAddReason(e.target.value)}
            placeholder="Reason (optional)"
            className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <button
            onClick={() => {
              if (!domainSuppAddDomain.trim()) return;
              addDomainSuppMutation.mutate({ domain: domainSuppAddDomain.trim(), reason: domainSuppAddReason || undefined });
              setDomainSuppAddDomain('');
              setDomainSuppAddReason('');
            }}
            disabled={addDomainSuppMutation.isPending || !domainSuppAddDomain.trim()}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {/* Bulk add domains */}
        <div className="mt-3">
          <label className="block text-sm font-medium text-gray-700">Bulk Add (one domain per line)</label>
          <textarea
            value={domainSuppBulkText}
            onChange={(e) => setDomainSuppBulkText(e.target.value)}
            placeholder={"gamil.com\nrediffmail.com\nyahoo.co"}
            rows={3}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <button
            onClick={() => {
              const domains = domainSuppBulkText.split('\n').map(d => d.trim().replace(/^@/, '')).filter(d => d.includes('.'));
              if (domains.length === 0) { toast.error('No valid domains found'); return; }
              bulkAddDomainSuppMutation.mutate({ domains });
              setDomainSuppBulkText('');
            }}
            disabled={bulkAddDomainSuppMutation.isPending || !domainSuppBulkText.trim()}
            className="mt-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {bulkAddDomainSuppMutation.isPending ? 'Adding...' : 'Bulk Add'}
          </button>
        </div>

        {/* Search */}
        <div className="mt-4">
          <input
            type="text"
            value={domainSuppSearch}
            onChange={(e) => { setDomainSuppSearch(e.target.value); setDomainSuppPage(1); }}
            placeholder="Search suppressed domains..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        {/* Table */}
        {domainSuppData?.data && domainSuppData.data.length > 0 ? (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Domain</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Reason</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Added By</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Date</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {domainSuppData.data.map((entry: { id: string; domain: string; reason: string; added_by: string; created_at: string }) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs">{entry.domain}</td>
                      <td className="px-3 py-2 text-gray-600">{entry.reason}</td>
                      <td className="px-3 py-2 text-gray-500">{entry.added_by}</td>
                      <td className="px-3 py-2 text-gray-400 text-xs">{new Date(entry.created_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => {
                            if (confirm(`Remove ${entry.domain} from suppressed domains?`)) {
                              removeDomainSuppMutation.mutate(entry.id);
                            }
                          }}
                          className="text-red-600 hover:text-red-800 text-xs"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {domainSuppData.pagination && domainSuppData.pagination.totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                <span>Page {domainSuppData.pagination.page} of {domainSuppData.pagination.totalPages} ({domainSuppData.pagination.total} total)</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDomainSuppPage(Math.max(1, domainSuppPage - 1))}
                    disabled={domainSuppPage <= 1}
                    className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setDomainSuppPage(domainSuppPage + 1)}
                    disabled={domainSuppPage >= domainSuppData.pagination.totalPages}
                    className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="mt-4 rounded-lg border-2 border-dashed border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-500">{domainSuppSearch ? 'No matching domains found' : 'No suppressed domains yet'}</p>
          </div>
        )}
      </div>

      {/* Backup & Restore */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Backup &amp; Restore</h2>
        <p className="mt-1 text-sm text-gray-500">
          Export everything (contacts, templates, campaigns, settings, email accounts, attachments) into a single <code>.crelay</code> file.
          Import that file later to fully restore the platform — including all data and uploaded files.
        </p>

        {/* Export */}
        <div className="mt-4 rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-medium text-gray-900">Export full backup</h3>
              <p className="mt-0.5 text-xs text-gray-500">Downloads a single <code>.crelay</code> archive containing every table and uploaded file. Large databases may take a minute.</p>
            </div>
            <button
              onClick={handleBackupExport}
              disabled={backupExporting}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50 whitespace-nowrap"
            >
              {backupExporting ? 'Exporting…' : 'Download Backup'}
            </button>
          </div>
        </div>

        {/* Restore */}
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50/50 p-4">
          <h3 className="font-medium text-red-900">Restore from backup</h3>
          <p className="mt-0.5 text-xs text-red-700">
            ⚠️ This will <strong>delete all existing data</strong> and replace it with the contents of the backup file. This cannot be undone.
          </p>
          <div className="mt-3 space-y-2">
            <input
              type="file"
              accept=".crelay,.zip"
              onChange={(e) => setBackupRestoreFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-200 file:px-3 file:py-1.5 file:text-sm file:text-gray-700 hover:file:bg-gray-300"
            />
            {backupRestoreFile && (
              <div className="text-xs text-gray-600">
                Selected: <span className="font-mono">{backupRestoreFile.name}</span> ({(backupRestoreFile.size / 1024 / 1024).toFixed(2)} MB)
              </div>
            )}
            <button
              onClick={() => setBackupShowConfirm(true)}
              disabled={!backupRestoreFile || backupRestoring}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
            >
              {backupRestoring ? 'Restoring…' : 'Restore Backup'}
            </button>
          </div>
        </div>

        {backupShowConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-gray-900">Confirm Restore</h3>
              <p className="mt-2 text-sm text-gray-600">
                This will <strong className="text-red-600">permanently delete all existing data</strong> and replace it with the backup file:
                <br />
                <span className="font-mono text-xs">{backupRestoreFile?.name}</span>
              </p>
              <p className="mt-2 text-sm text-gray-600">Enter your admin password to confirm.</p>
              <input
                type="password"
                value={backupRestorePassword}
                onChange={(e) => setBackupRestorePassword(e.target.value)}
                placeholder="Admin password"
                autoFocus
                className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => { setBackupShowConfirm(false); setBackupRestorePassword(''); }}
                  disabled={backupRestoring}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBackupRestore}
                  disabled={!backupRestorePassword || backupRestoring}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {backupRestoring ? 'Restoring…' : 'Yes, Wipe & Restore'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

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
          <button type="submit" className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700">
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
