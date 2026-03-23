import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import toast from 'react-hot-toast';
import { getDashboardData } from '../api/analytics.api';

interface DashboardData {
  stats: {
    total_sent: string;
    total_bounced: string;
    total_opens: string;
    total_clicks: string;
    total_complaints: string;
    total_failed: string;
    total_campaigns: string;
    open_rate: string;
    click_rate: string;
    bounce_rate: string;
  };
  volume: Array<{ date: string; sent: string; opened: string; clicked: string; bounced: string }>;
  recentCampaigns: Array<{ id: string; name: string; status: string; sent_count: number; open_count: number; click_count: number; total_recipients: number; created_at: string }>;
  contactStats: { total: string; active: string; bounced: string; complained: string; unsubscribed: string };
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

/** Safely convert a postgres string to a formatted number */
function num(val: string | number | undefined | null): string {
  const n = Number(val) || 0;
  return n.toLocaleString();
}

/** Safely convert to number for calculations */
function toNum(val: string | number | undefined | null): number {
  return Number(val) || 0;
}

/** Format rate values that come as strings */
function rate(val: string | number | undefined | null): string {
  const n = Number(val) || 0;
  return n.toFixed(1);
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getDashboardData()
      .then(setData)
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex h-64 items-center justify-center text-gray-500">Loading dashboard...</div>;
  if (!data) return <div className="p-6">Failed to load data</div>;

  const { stats, volume, recentCampaigns, contactStats } = data;

  // Convert volume data from strings to numbers for charts
  const volumeData = volume.map((v) => ({
    date: v.date,
    sent: toNum(v.sent),
    opened: toNum(v.opened),
    clicked: toNum(v.clicked),
    bounced: toNum(v.bounced),
  }));

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Stats cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Total Sent', value: num(stats.total_sent), sub: `${num(stats.total_campaigns)} campaigns`, color: 'text-blue-600' },
          { label: 'Open Rate', value: `${rate(stats.open_rate)}%`, sub: `${num(stats.total_opens)} opens`, color: 'text-green-600' },
          { label: 'Click Rate', value: `${rate(stats.click_rate)}%`, sub: `${num(stats.total_clicks)} clicks`, color: 'text-purple-600' },
          { label: 'Bounce Rate', value: `${rate(stats.bounce_rate)}%`, sub: `${num(stats.total_bounced)} bounced`, color: 'text-red-600' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-white p-5 shadow-sm">
            <span className="text-sm text-gray-500">{s.label}</span>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            <span className="text-xs text-gray-400">{s.sub}</span>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Send volume chart */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-gray-900">Send Volume (30 days)</h3>
          <div className="mt-4 h-64">
            {volumeData.length > 0 ? (
              <ResponsiveContainer>
                <BarChart data={volumeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="sent" fill="#3b82f6" name="Sent" />
                  <Bar dataKey="bounced" fill="#ef4444" name="Bounced" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">No data yet</div>
            )}
          </div>
        </div>

        {/* Engagement chart */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-gray-900">Engagement (30 days)</h3>
          <div className="mt-4 h-64">
            {volumeData.length > 0 ? (
              <ResponsiveContainer>
                <LineChart data={volumeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="opened" stroke="#22c55e" name="Opens" />
                  <Line type="monotone" dataKey="clicked" stroke="#a855f7" name="Clicks" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">No data yet</div>
            )}
          </div>
        </div>
      </div>

      {/* Contact stats */}
      <div className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-gray-900">Contact Health</h3>
        <div className="mt-3 grid grid-cols-5 gap-3 text-center text-sm">
          <div><p className="text-2xl font-bold text-gray-900">{num(contactStats.total)}</p><span className="text-gray-500">Total</span></div>
          <div><p className="text-2xl font-bold text-green-600">{num(contactStats.active)}</p><span className="text-gray-500">Active</span></div>
          <div><p className="text-2xl font-bold text-red-600">{num(contactStats.bounced)}</p><span className="text-gray-500">Bounced</span></div>
          <div><p className="text-2xl font-bold text-orange-600">{num(contactStats.complained)}</p><span className="text-gray-500">Complained</span></div>
          <div><p className="text-2xl font-bold text-gray-500">{num(contactStats.unsubscribed)}</p><span className="text-gray-500">Unsubscribed</span></div>
        </div>
      </div>

      {/* Recent campaigns */}
      <div className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Recent Campaigns</h3>
          <button onClick={() => navigate('/campaigns')} className="text-sm text-primary-600">View All</button>
        </div>
        <div className="overflow-x-auto">
          <table className="mt-4 w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Sent</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Opens</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Clicks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentCampaigns.length === 0 ? (
                <tr><td colSpan={5} className="py-4 text-center text-gray-400">No campaigns yet</td></tr>
              ) : recentCampaigns.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/campaigns/${c.id}`)}>
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${statusColors[c.status] || ''}`}>{c.status}</span></td>
                  <td className="px-3 py-2">{toNum(c.sent_count)}/{toNum(c.total_recipients)}</td>
                  <td className="px-3 py-2">{toNum(c.open_count)}</td>
                  <td className="px-3 py-2">{toNum(c.click_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
