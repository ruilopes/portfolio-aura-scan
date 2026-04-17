export function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      <div className="glass-card p-6 flex items-center gap-6">
        <div className="skeleton h-40 w-40 rounded-full" />
        <div className="flex-1 space-y-3">
          <div className="skeleton h-6 w-1/3 rounded" />
          <div className="skeleton h-4 w-1/2 rounded" />
          <div className="skeleton h-4 w-2/3 rounded" />
        </div>
      </div>
      <div className="skeleton h-72 rounded-xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-64 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
