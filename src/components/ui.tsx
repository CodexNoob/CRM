import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/*
 * Core UI primitives. Compact, bordered, low-elevation components used by
 * every screen. Colours and radii come from the tokens in globals.css.
 */

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/* ───────── Buttons ───────── */

const buttonVariants = {
  primary: "bg-brand text-white hover:bg-brand-strong border border-brand",
  secondary: "border border-line bg-surface text-ink hover:bg-hover hover:border-line-strong shadow-sm",
  ghost: "text-muted hover:bg-subtle hover:text-ink border border-transparent",
  danger: "border border-line bg-surface text-danger-ink hover:bg-danger-soft hover:border-danger/40",
};
const buttonSizes = {
  sm: "h-7 px-2.5 text-[12.5px] gap-1.5",
  md: "h-9 px-3 text-[13px] gap-2 sm:h-8",
  lg: "h-10 px-4 text-sm gap-2",
};

export type ButtonVariant = keyof typeof buttonVariants;
export type ButtonSize = keyof typeof buttonSizes;

export function buttonClass(variant: ButtonVariant = "primary", extra?: string, size: ButtonSize = "md") {
  return cx(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    buttonSizes[size],
    buttonVariants[variant],
    extra,
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, className, size)} {...props} />;
}

/* ───────── Page structure ───────── */

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em] text-ink">{title}</h1>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A bordered content section with an optional header row. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  flush,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Remove body padding (tables, lists that run edge to edge). */
  flush?: boolean;
}) {
  return (
    <section className={cx("self-start rounded-lg border border-line bg-surface", className)}>
      {title ? (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
            {description ? <p className="text-[12px] text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx(flush ? "" : "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Back-compat alias used by forms and simple sections. */
export function Card({ children, className, title, description, actions, flush }: { children: ReactNode; className?: string; title?: string; description?: ReactNode; actions?: ReactNode; flush?: boolean }) {
  return (
    <Panel title={title} description={description} actions={actions} className={className} flush={flush}>
      {children}
    </Panel>
  );
}

/** A compact row of statistics separated by dividers (instead of oversized metric cards). */
export function StatStrip({ items, className }: { items: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "default" | "danger" | "warning" | "success" }[]; className?: string }) {
  return (
    <dl className={cx("grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3", items.length > 4 ? "lg:grid-cols-6" : "lg:grid-cols-4", className)}>
      {items.map((s) => {
        const body = (
          <>
            <dt className="truncate text-[12px] font-medium text-muted">{s.label}</dt>
            <dd className={cx("mt-1 text-[20px] font-semibold leading-7 tabular", s.tone === "danger" ? "text-danger-ink" : s.tone === "warning" ? "text-warning-ink" : s.tone === "success" ? "text-success" : "text-ink")}>
              {s.value}
            </dd>
            {s.hint ? <dd className="truncate text-[12px] text-muted">{s.hint}</dd> : null}
          </>
        );
        const cls = "block border-b border-r border-line px-4 py-3";
        return s.href ? (
          <Link key={s.label} href={s.href} className={cx(cls, "hover:bg-hover")}>
            {body}
          </Link>
        ) : (
          <div key={s.label} className={cls}>
            {body}
          </div>
        );
      })}
    </dl>
  );
}

/* ───────── Feedback ───────── */

export function Alert({ tone = "error", children, title }: { tone?: "error" | "success" | "info" | "warning"; children: ReactNode; title?: string }) {
  const styles = {
    error: "border-danger/30 bg-danger-soft text-danger-ink",
    success: "border-success/30 bg-success-soft text-success",
    info: "border-info/25 bg-info-soft text-ink",
    warning: "border-warning/40 bg-warning-soft text-warning-ink",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-[13px]", styles[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

export type Tone = "neutral" | "brand" | "good" | "warn" | "danger" | "info";

const toneStyles: Record<Tone, { pill: string; dot: string }> = {
  neutral: { pill: "bg-subtle text-muted border-line", dot: "bg-faint" },
  brand: { pill: "bg-brand-soft text-brand border-brand/15", dot: "bg-brand" },
  good: { pill: "bg-success-soft text-success border-success/20", dot: "bg-success" },
  warn: { pill: "bg-warning-soft text-warning-ink border-warning/30", dot: "bg-warning" },
  danger: { pill: "bg-danger-soft text-danger-ink border-danger/25", dot: "bg-danger" },
  info: { pill: "bg-info-soft text-info border-info/20", dot: "bg-info" },
};

/** Status pill. With `dot`, a small coloured dot precedes the label (meaning never relies on colour alone). */
export function Badge({ children, tone = "neutral", dot }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return (
    <span className={cx("inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded border px-1.5 text-[11.5px] font-medium", toneStyles[tone].pill)}>
      {dot ? <span aria-hidden className={cx("size-1.5 rounded-full", toneStyles[tone].dot)} /> : null}
      {children}
    </span>
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      {icon ? <div className="mb-3 flex size-9 items-center justify-center rounded-md border border-line bg-subtle text-muted [&_svg]:size-4">{icon}</div> : null}
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {children ? <div className="mt-1 max-w-sm text-[13px] text-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded bg-subtle", className)} aria-hidden />;
}

export function DescriptionList({ items, columns = 2 }: { items: [string, ReactNode][]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cx("grid grid-cols-1 gap-x-6 gap-y-3", columns >= 2 && "sm:grid-cols-2", columns === 3 && "lg:grid-cols-3")}>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[12px] text-muted">{label}</dt>
          <dd className="mt-0.5 wrap-break-word text-[13px] text-ink">{value || <span className="text-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  const s = size === "sm" ? "size-6 text-[10px]" : size === "lg" ? "size-10 text-[13px]" : "size-7 text-[11px]";
  return (
    <span aria-hidden className={cx("inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand", s)}>
      {initials || "?"}
    </span>
  );
}

/** Underlined tab navigation rendered as links, so each tab has its own URL. */
export function TabNav({ items, label }: { items: { href: string; label: string; active: boolean; count?: number }[]; label: string }) {
  return (
    <nav aria-label={label} className="-mb-px flex gap-4 overflow-x-auto border-b border-line">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          scroll={false}
          aria-current={t.active ? "page" : undefined}
          className={cx(
            "inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 text-[13px] font-medium",
            t.active ? "border-brand text-ink" : "border-transparent text-muted hover:border-line-strong hover:text-ink",
          )}
        >
          {t.label}
          {t.count ? <span className="tabular rounded bg-subtle px-1.5 text-[11px] leading-4.5 text-muted">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** A horizontal segmented filter rendered as links (server-friendly). */
export function SegmentedLinks({ items, label }: { items: { href: string; label: ReactNode; active: boolean; count?: number }[]; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-md border border-line bg-surface p-0.5 shadow-sm">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cx(
            "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-[12.5px] font-medium",
            t.active ? "bg-brand text-white" : "text-muted hover:bg-subtle hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className={cx("tabular text-[11.5px]", t.active ? "text-white/80" : "text-faint")}>{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
