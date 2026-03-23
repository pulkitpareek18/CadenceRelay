import { useState, useEffect, useCallback } from 'react';
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

  // Auto-refresh while sending
  useEffect(() => {
    if (campaign?.status === 'sending') {
      const interval = setInterval(() => { fetchCampaign(); fetchRecipients(); }, 5000);
      return () => clearInterval(interval);
    }
  }, [campaign?.status, fetchCampaign, fetchRecipients]);

  if (loading) return <div className="flex h-64 items-center justify-center text-gray-500">Loading...</div>;
  if (!campaign) return <div className="p-6">Campaign not found</div>;

  const progress = campaign.total_recipients > 0
    ? Math.round(((campaign.sent_count + campaign.failed_count) / campaign.total_recipients) * 100)
    : 0;

  const openRate = campaign.sent_count > 0 ? ((campaign.open_count / campaign.sent_count) * 100).toFixed(1) : '0';
  const clickRate = campaign.sent_count > 0 ? ((campaign.click_count / campaign.sent_count) * 100).toFixed(1) : '0';

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
            <span>{campaign.sent_count + campaign.failed_count} / {campaign.total_recipients}</span>
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
          { label: 'Sent', value: campaign.sent_count, color: 'text-blue-600' },
          { label: 'Failed', value: campaign.failed_count, color: 'text-red-600' },
          { label: 'Bounced', value: campaign.bounce_count, color: 'text-orange-600' },
          { label: 'Opens', value: `${campaign.open_count} (${openRate}%)`, color: 'text-green-600' },
          { label: 'Clicks', value: `${campaign.click_count} (${clickRate}%)`, color: 'text-purple-600' },
          { label: 'Complaints', value: campaign.complaint_count, color: 'text-red-600' },
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
              <tr key={r.id}>
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
        {recipientTotal > 50 && (
          <div className="mt-3 flex justify-end gap-2">
            <button disabled={recipientPage <= 1} onClick={() => setRecipientPage(recipientPage - 1)} className="rounded border px-3 py-1 text-xs disabled:opacity-50">Prev</button>
            <span className="px-2 py-1 text-xs">{recipientPage}/{Math.ceil(recipientTotal / 50)}</span>
            <button disabled={recipientPage >= Math.ceil(recipientTotal / 50)} onClick={() => setRecipientPage(recipientPage + 1)} className="rounded border px-3 py-1 text-xs disabled:opacity-50">Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
