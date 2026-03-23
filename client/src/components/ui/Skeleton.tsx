/** Base skeleton pulse block */
function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}

/** Animated skeleton for table rows */
export function TableSkeleton({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      {/* Header */}
      <div className="flex gap-4 bg-gray-50 px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <SkeletonBlock key={i} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      <div className="divide-y divide-gray-100">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="flex gap-4 px-4 py-3">
            {Array.from({ length: columns }).map((_, colIdx) => (
              <SkeletonBlock
                key={colIdx}
                className={`h-4 flex-1 ${colIdx === 0 ? 'max-w-[200px]' : ''}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for dashboard stat cards */
export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl bg-white p-5 shadow-sm">
          <SkeletonBlock className="mb-3 h-3 w-20" />
          <SkeletonBlock className="mb-2 h-8 w-24" />
          <SkeletonBlock className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton for form fields */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <SkeletonBlock className="mb-4 h-6 w-48" />
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i}>
            <SkeletonBlock className="mb-2 h-3 w-24" />
            <SkeletonBlock className="h-10 w-full" />
          </div>
        ))}
      </div>
      <SkeletonBlock className="mt-4 h-10 w-32" />
    </div>
  );
}

/** Skeleton for grid card layout (lists, templates) */
export function GridCardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <SkeletonBlock className="h-5 w-32" />
            <SkeletonBlock className="h-4 w-12" />
          </div>
          <SkeletonBlock className="mt-2 h-3 w-48" />
          <SkeletonBlock className="mt-3 h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Full-page loading skeleton with chart areas */
export function DashboardSkeleton() {
  return (
    <div className="p-6">
      <SkeletonBlock className="mb-6 h-8 w-40" />
      <CardSkeleton />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <SkeletonBlock className="mb-4 h-5 w-40" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <SkeletonBlock className="mb-4 h-5 w-40" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}
