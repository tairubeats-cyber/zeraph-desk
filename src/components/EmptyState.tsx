import React from "react";

export function EmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative z-10 mx-auto flex max-w-[46ch] flex-col items-center px-4 pt-24 text-center max-md:pt-16">
      <div className="text-ink-tertiary" aria-hidden="true">
        {icon}
      </div>
      <h1 className="mt-4 text-title text-ink">{title}</h1>
      <p className="mt-2 text-body text-ink-tertiary">{description}</p>
      {children}
    </div>
  );
}
