import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getCampaign, pauseCampaign, resumeCampaign, getCampaignRecipients, Campaign } from '../api/campaigns.api';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-yellow-100 text-yellow-700',
  paused: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

interface Recipient {
  id: string;
  email: string;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  error_message: string | null;
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientTotal, setRecipientTotal] = useState(0);
  const [recipientPage, setRecipientPage] = useState(1);
  const [recipientFilter, setRecipientFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCampaign = useCallback(async () => {
    if (!id) return;
    try {
      const c = await getCampaign(id);
      setCampaign(c);
    } catch {
      toast.error('Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchRecipients = useCallback(async () => {
    if (!id) return;
    const params: Record<string, string> = { page: String(recipientPage), limit: '50' };
    if (recipientFilter) params.status = recipientFilter;
    try {
      const res = await getCampaignRecipients(id, params);
      setRecipients(res.data);
      setRecipientTotal(res.pagination.total);
    } catch { /* ignore */ }
  }, [id, recipientPage, recipientFilter]);

  useEffect(() => { fetchCampaign(); }, [fetchCampaign]);
  useEffect(() => { fetchRecipients(); }, [fetchRecipients]);

  // Auto-refresh while sending - fixed interval cleanup
  useEffect(() => {
    if (campaign?.status === 'sending') {
      intervalRef.current = setInterval(() => { fetchCampaign(); fetchRecipients(); }, 5000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [campaign?.status, fetchCampaign, fetchRecipients]);

  function handleExportRecipients() {
    if (!recipients.length) {
      toast.error('No recipients to export');
      return;
    }
    const header = 'Email,Status,Sent At,Opened At,Clicked At,Bounced At,Error\n';
    const rows = recipients.map((r) =>
      [r.email, r.status, r.sent_at || '', r.opened_at || '', r.clicked_at || '', r.bounced_at || '', r.error_message || '']
        .map((v) => `"${v}"`)
        .join(',')
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recipients-${campaign?.name || id}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Recipients exported');
  }

  if (loading) return <div className="flex h-64 items-center justify-center text-gray-500">Loading...</div>;
  if (!campaign) return <div className="p-6">Campaign not found</div>;

  const progress = campaign.total_recipients > 0
    ? Math.round(((Number(campaign.sent_count) + Number(campaign.failed_count)) / Number(campaign.total_recipients)) * 100)
    : 0;

  const sentCount = Number(campaign.sent_count) || 0;
  const failedCount = Number(campaign.failed_count) || 0;
  const bounceCount = Number(campaign.bounce_count) || 0;
  const openCount = Number(campaign.open_count) || 0;
  const clickCount = Number(campaign.click_count) || 0;
  const complaintCount = Number(campaign.complaint_count) || 0;
  const totalRecipients = Number(campaign.total_recipients) || 0;

  const openRate = sentCount > 0 ? ((openCount / sentCount) * 100).toFixed(1) : '0';
  const clickRate = sentCount > 0 ? ((clickCount / sentCount) * 100).toFixed(1) : '0';

  async function handlePause() {
    try { await pauseCampaign(id!); toast.success('Paused'); fetchCampaign(); } catch { toast.error('Failed'); }
  }
  async function handleResume() {
    try { await resumeCampaign(id!); toast.success('Resumed'); fetchCampaign(); } catch { toast.error('Failed'); }
  }

  return (
    <div className="p-6">
      <button onClick={() => navigate('/campaigns')} className="mb-4 text-sm text-primary-600">&larr; Back</button>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{campaign.name}</h1>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[campaign.status] || ''}`}>{campaign.status}</span>
        </div>
        <div className="flex gap-2">
          {campaign.status === 'sending' && <button onClick={handlePause} className="rounded-lg border border-orange-300 px-4 py-2 text-sm text-orange-600">Pause</button>}
          {campaign.status === 'paused' && <button onClick={handleResume} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white">Resume</button>}
        </div>
      </div>

      {/* Progress */}
      {campaign.status === 'sending' && (
        <div className="mt-4">
          <div className="flex justify-between text-sm text-gray-600">
            <span>{sentCount + failedCount} / {totalRecipients}</span>
            <span>{progress}%</span>
          </div>
          <div className="mt-1 h-2 w-full rounded-full bg-gray-200">
            <div className="h-2 rounded-full bg-primary-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {[
          { label: 'Sent', value: sentCount, color: 'text-blue-600' },
          { label: 'Failed', value: failedCount, color: 'text-red-600' },
          { label: 'Bounced', value: bounceCount, color: 'text-orange-600' },
          { label: 'Opens', value: `${openCount} (${openRate}%)`, color: 'text-green-600' },
          { label: 'Clicks', value: `${clickCount} (${clickRate}%)`, color: 'text-purple-600' },
          { label: 'Complaints', value: complaintCount, color: 'text-red-600' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-white p-4 shadow-sm">
            <span className="text-xs text-gray-500">{s.label}</span>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Recipients */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recipients</h2>
          <div className="flex items-center gap-2">
            <button onClick={handleExportRecipients} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Export Recipients</button>
            <select value={recipientFilter} onChange={(e) => { setRecipientFilter(e.target.value); setRecipientPage(1); }} className="rounded border px-2 py-1 text-sm">
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="opened">Opened</option>
              <option value="clicked">Clicked</option>
              <option value="bounced">Bounced</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="mt-4 w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Email</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Sent</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Opened</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Clicked</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recipients.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">No recipients</td></tr>
              ) : recipients.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">{r.email}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${statusColors[r.status] || 'bg-gray-100'}`}>{r.status}</span></td>
                  <td className="px-3 py-2 text-xs">{r.sent_at ? new Date(r.sent_at).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2 text-xs">{r.opened_at ? new Date(r.opened_at).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2 text-xs">{r.clicked_at ? new Date(r.clicked_at).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2 text-xs text-red-500">{r.error_message || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {recipientTotal > 50 && (
          <div className="mt-3 flex justify-end gap-2">
            <button disabled={recipientPage <= 1} onClick={() => setRecipientPage(recipientPage - 1)} className="rounded border px-3 py-1 text-xs disabled:opacity-50 hover:bg-gray-50">Prev</button>
            <span className="px-2 py-1 text-xs">{recipientPage}/{Math.ceil(recipientTotal / 50)}</span>
            <button disabled={recipientPage >= Math.ceil(recipientTotal / 50)} onClick={() => setRecipientPage(recipientPage + 1)} className="rounded border px-3 py-1 text-xs disabled:opacity-50 hover:bg-gray-50">Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
