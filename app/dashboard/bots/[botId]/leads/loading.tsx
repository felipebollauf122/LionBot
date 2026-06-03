export default function LeadsLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="h-7 w-32 rounded bg-white/5 mb-6" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-white/5" />
        ))}
      </div>
    </div>
  );
}
