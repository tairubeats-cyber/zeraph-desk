import React from "react";

/** Large title, quiet description, and room for the one or two actions that belong to the page. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4 max-md:flex-col max-md:items-start">
      <div className="min-w-0">
        <h1 className="text-title text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-[62ch] text-body text-ink-tertiary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
