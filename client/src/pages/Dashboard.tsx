export default function Dashboard() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-2 text-gray-600">
        Overview of your email campaigns. Full analytics coming in Sprint 7.
      </p>

      {/* Stats cards - placeholder */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Sent', value: '0', color: 'bg-blue-500' },
          { label: 'Delivered', value: '0', color: 'bg-green-500' },
          { label: 'Bounced', value: '0', color: 'bg-red-500' },
          { label: 'Open Rate', value: '0%', color: 'bg-purple-500' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${stat.color}`} />
              <span className="text-sm text-gray-500">{stat.label}</span>
            </div>
            <p className="mt-2 text-3xl font-bold text-gray-900">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Recent campaigns placeholder */}
      <div className="mt-8 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Recent Campaigns</h2>
        <p className="mt-4 text-center text-gray-400">
          No campaigns yet. Create your first campaign to get started.
        </p>
      </div>
    </div>
  );
}
