/** Shown instantly while a page's data loads. */
export default function Loading() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
      <div className="h-8 w-56 animate-pulse rounded-lg bg-surface-2" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-2xl border border-line bg-surface" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}
