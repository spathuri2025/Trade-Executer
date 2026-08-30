import { useEffect, useState, type ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown } from "lucide-react";

/**
 * A section whose body folds away behind its heading.
 *
 * Two looks, because the app already has two heading styles and neither should
 * change appearance: `card` wraps the existing Card used by Settings, Scanner
 * and Instruments; `label` matches the bare uppercase heading Dashboard and
 * Charts use.
 *
 * Deliberately NOT applied to every heading in the app: each page defines its
 * own `SectionLabel`, and it doubles as a TABLE COLUMN header (see the <th> in
 * trades.tsx). Collapsing those would fold table headings away, so sections are
 * chosen per page rather than swept up by pattern.
 */

const STORAGE_PREFIX = "tb.section.";

/**
 * Remembered per section, per browser. Wrapped because localStorage *throws*
 * (not returns null) in private windows and where site data is blocked — the
 * same defensiveness used elsewhere for browser storage.
 */
function readStored(id: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    return raw === null ? null : raw === "1";
  } catch {
    return null;
  }
}

function writeStored(id: string, open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, open ? "1" : "0");
  } catch {
    /* Storage unavailable — the section still works, it just won't be remembered. */
  }
}

export interface CollapsibleSectionProps {
  /** Stable key for remembering this section's state, e.g. "settings.broker". */
  id: string;
  title: ReactNode;
  /** Used when nothing has been remembered yet. */
  defaultOpen?: boolean;
  /**
   * Kept visible in the header even when collapsed — counts, countdowns,
   * status badges. Hiding a "3 pending" badge inside the thing it's telling you
   * to open would defeat the point.
   */
  meta?: ReactNode;
  /** Optional one-line explanation under the title. */
  description?: ReactNode;
  variant?: "card" | "label";
  className?: string;
  /** Passed to the inner CardContent so each section keeps its own layout classes. */
  contentClassName?: string;
  children: ReactNode;
}

export function CollapsibleSection({
  id,
  title,
  defaultOpen = true,
  meta,
  description,
  variant = "card",
  className,
  contentClassName,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Read stored state after mount rather than in useState's initialiser: the
  // initialiser would run during SSR/first paint where `window` may not exist.
  useEffect(() => {
    const stored = readStored(id);
    if (stored !== null) setOpen(stored);
  }, [id]);

  function handleChange(next: boolean) {
    setOpen(next);
    writeStored(id, next);
  }

  const chevron = (
    <ChevronDown
      className={`h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
        open ? "" : "-rotate-90"
      }`}
      aria-hidden="true"
    />
  );

  if (variant === "label") {
    return (
      <Collapsible open={open} onOpenChange={handleChange} className={className}>
        <div className="flex items-center gap-3 flex-wrap">
          <CollapsibleTrigger
            className="flex items-center gap-2 text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            data-testid={`section-toggle-${id}`}
          >
            <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground">
              {title}
            </span>
            {chevron}
          </CollapsibleTrigger>
          {meta}
        </div>
        <CollapsibleContent className="pt-5 data-[state=closed]:hidden">{children}</CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={handleChange} asChild>
      <Card className={className}>
        <div className="flex items-start justify-between gap-4 p-6 pb-0">
          <CollapsibleTrigger
            className="flex items-start gap-2 text-left flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            data-testid={`section-toggle-${id}`}
          >
            <div className="flex flex-col gap-1.5">
              <span className="font-semibold leading-none tracking-tight">{title}</span>
              {description && <span className="text-sm text-muted-foreground">{description}</span>}
            </div>
            <span className="pt-0.5">{chevron}</span>
          </CollapsibleTrigger>
          {meta}
        </div>
        <CollapsibleContent className="data-[state=closed]:hidden">
          <CardContent className={contentClassName ? `pt-6 ${contentClassName}` : "pt-6"}>{children}</CardContent>
        </CollapsibleContent>
        {/* Closed cards would otherwise end flush against their header. */}
        {!open && <div className="pb-6" />}
      </Card>
    </Collapsible>
  );
}
