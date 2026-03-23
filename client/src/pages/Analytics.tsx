import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import toast from 'react-hot-toast';
import { getDashboardData, exportAnalytics } from '../api/analytics.api';

export default function Analytics() {
  const [data, setData] = useState<{ stats: Record<string, string>; volume: Array<Record<string, string>> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    getDashboardData(params)
      .then(setData)
      .catch(() => toast.error('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [from, to]);

  if (loading) return <div className="flex h-64 items-center justify-center text-gray-500">Loading...</div>;
  if (!data) return <div className="p-6">Failed to load</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <div className="flex items-center gap-3">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border px-3 py-1.5 text-sm" />
          <span className="text-gray-400">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border px-3 py-1.5 text-sm" />
          <button onClick={() => exportAnalytics({ from, to })} className="rounded-lg border px-4 py-1.5 text-sm hover:bg-gray-50">Export CSV</button>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Emails Sent', value: data.stats.total_sent, color: 'text-blue-600' },
          { label: 'Open Rate', value: `${data.stats.open_rate}%`, color: 'text-green-600' },
          { label: 'Click Rate', value: `${data.stats.click_rate}%`, color: 'text-purple-600' },
          { label: 'Bounce Rate', value: `${data.stats.bounce_rate}%`, color: 'text-red-600' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-white p-5 shadow-sm">
            <span className="text-sm text-gray-500">{s.label}</span>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Send Volume</h3>
          <div className="mt-4 h-72">
            {data.volume.length > 0 ? (
              <ResponsiveContainer>
                <BarChart data={data.volume}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="sent" fill="#3b82f6" name="Sent" />
                  <Bar dataKey="bounced" fill="#ef4444" name="Bounced" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">No data for selected range</div>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Engagement</h3>
          <div className="mt-4 h-72">
            {data.volume.length > 0 ? (
              <ResponsiveContainer>
                <LineChart data={data.volume}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="opened" stroke="#22c55e" name="Opens" />
                  <Line type="monotone" dataKey="clicked" stroke="#a855f7" name="Clicks" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">No data for selected range</div>
            )}
          </div>
        </div>
      </div>

      {/* Additional stats */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl bg-white p-5 shadow-sm text-center">
          <span className="text-sm text-gray-500">Failed Deliveries</span>
          <p className="text-2xl font-bold text-red-600">{data.stats.total_failed}</p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm text-center">
          <span className="text-sm text-gray-500">Complaints</span>
          <p className="text-2xl font-bold text-orange-600">{data.stats.total_complaints}</p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm text-center">
          <span className="text-sm text-gray-500">Unsubscribes</span>
          <p className="text-2xl font-bold text-gray-600">{data.stats.total_unsubscribes}</p>
        </div>
      </div>
    </div>
  );
}
