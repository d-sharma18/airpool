import type { ButtonHTMLAttributes, ComponentProps, ReactNode, SelectHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "ghost" | "danger" | "outline";

export function buttonClass(variant: Variant = "primary", full = false) {
  return cx(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 h-12 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none",
    full && "w-full",
    variant === "primary" && "bg-accent text-accent-ink hover:brightness-110",
    variant === "ghost" && "bg-surface-2 text-ink hover:bg-line",
    variant === "outline" && "border border-line text-ink hover:bg-surface-2",
    variant === "danger" && "bg-danger/15 text-danger hover:bg-danger/25",
  );
}

export function Button({
  variant = "primary",
  full,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; full?: boolean }) {
  return <button className={cx(buttonClass(variant, full), className)} {...props} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl border border-line bg-surface p-4", className)}>{children}</div>;
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-muted">
      <span>{children}</span>
      {hint && <span className="text-xs font-normal">{hint}</span>}
    </span>
  );
}

/** Label + control + inline error, with the error linked for screen readers. */
export function Field({
  label,
  hint,
  error,
  id,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  id: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id}>
        <Label hint={hint}>{label}</Label>
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const fieldClass =
  "h-12 w-full rounded-xl border border-line bg-surface-2 px-3.5 text-ink placeholder:text-muted/60 outline-none focus:border-accent";

// React 19 passes `ref` through as a normal prop, so it lands on the <input>.
export function Input({ className, invalid, ...props }: ComponentProps<"input"> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && props.id ? `${props.id}-error` : undefined}
      className={cx(fieldClass, invalid && "border-danger! focus:border-danger!", className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(fieldClass, "appearance-none", className)} {...props} />;
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "ok" | "women" | "danger";
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "muted" && "bg-surface-2 text-muted",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "ok" && "bg-ok/15 text-ok",
        tone === "women" && "bg-women/15 text-women",
        tone === "danger" && "bg-danger/15 text-danger",
      )}
    >
      {children}
    </span>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 h-12">
      <span className="text-sm text-muted">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Fewer ${label}`}
          className="size-8 rounded-lg bg-line text-lg leading-none disabled:opacity-30"
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          −
        </button>
        <span className="w-5 text-center font-mono tabular-nums">{value}</span>
        <button
          type="button"
          aria-label={`More ${label}`}
          className="size-8 rounded-lg bg-line text-lg leading-none disabled:opacity-30"
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{children}</p>;
}

export function Spinner() {
  return <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export { cx };
