import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { listCampaigns, deleteCampaign, Campaign } from '../api/campaigns.api';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-yellow-100 text-yellow-700',
  paused: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const navigate = useNavigate();

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '20' };
      if (statusFilter) params.status = statusFilter;
      const res = await listCampaigns(params);
      setCampaigns(res.data);
      setTotal(res.pagination.total);
    } catch {
      toast.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this draft campaign?')) return;
    try {
      await deleteCampaign(id);
      toast.success('Campaign deleted');
      fetchCampaigns();
    } catch {
      toast.error('Failed to delete');
    }
  }

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
        <button onClick={() => navigate('/campaigns/new')} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700">
          New Campaign
        </button>
      </div>

      <div className="mt-4">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-lg border px-3 py-2 text-sm">
          <option value="">All Status</option>
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="sending">Sending</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Provider</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Sent</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Opens</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Clicks</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Bounced</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : campaigns.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No campaigns found</td></tr>
            ) : campaigns.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/campaigns/${c.id}`)}>
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[c.status] || ''}`}>{c.status}</span>
                </td>
                <td className="px-4 py-3 uppercase text-xs">{c.provider}</td>
                <td className="px-4 py-3">{c.sent_count}/{c.total_recipients}</td>
                <td className="px-4 py-3">{c.open_count}</td>
                <td className="px-4 py-3">{c.click_count}</td>
                <td className="px-4 py-3">{c.bounce_count}</td>
                <td className="px-4 py-3">
                  {c.status === 'draft' && (
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }} className="text-xs text-red-500">Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>{total} campaigns total</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-50">Prev</button>
            <span className="px-3 py-1">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-50">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
