export default function TrackingLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="h-7 w-48 rounded bg-white/5 mb-6" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-white/5" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-white/5" />
    </div>
  );
}
