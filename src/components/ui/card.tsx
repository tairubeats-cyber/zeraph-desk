import React from "react";
import { cn } from "@/lib/utils";

type CardProps = React.HTMLAttributes<HTMLElement> & { as?: "div" | "article" | "section" };

/** The one card surface. Padding is the caller's call, since a list card and a form card differ. */
export function Card({ as: Tag = "div", className, ...rest }: CardProps) {
  return <Tag className={cn("rounded-card border border-line bg-surface shadow-card", className)} {...rest} />;
}
