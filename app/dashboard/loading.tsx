export default function DashboardLoading() {
  return (
    <main className="mx-auto max-w-3xl space-y-10 px-6 py-12">
      <div className="h-8 w-32 animate-pulse rounded-sm bg-border" />
      <div className="grid gap-8 sm:grid-cols-[1fr,1.2fr]">
        <div className="aspect-square w-full animate-pulse rounded-sm bg-border" />
        <div className="space-y-6">
          <div className="h-10 w-full animate-pulse rounded-sm bg-border" />
          <div className="h-10 w-full animate-pulse rounded-sm bg-border" />
        </div>
      </div>
    </main>
  );
}
