export function PortfolioEditorLoading() {
  return (
    <div className="space-y-6 p-6">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <div className="h-64 animate-pulse rounded-xl bg-muted" />

        <div className="space-y-4">
          <div className="h-10 animate-pulse rounded-md bg-muted" />
          <div className="h-10 animate-pulse rounded-md bg-muted" />
          <div className="h-32 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    </div>
  );
}