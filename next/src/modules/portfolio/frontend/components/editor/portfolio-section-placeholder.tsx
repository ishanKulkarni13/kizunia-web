interface PortfolioSectionPlaceholderProps {
  title: string;
  description?: string;
}

export function PortfolioSectionPlaceholder({
  title,
  description,
}: PortfolioSectionPlaceholderProps) {
  return (
    <div className="space-y-1">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>

      <div className="rounded-xl border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          {description ?? `${title} isn't available to edit yet.`}
        </p>
      </div>
    </div>
  );
}
