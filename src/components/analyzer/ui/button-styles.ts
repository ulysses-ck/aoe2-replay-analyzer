export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0d12]";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "icon" | "iconLg";

const BASE = `inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${focusRing}`;

const VARIANTS: Record<Variant, string> = {
  primary: "bg-violet-600 text-white hover:bg-violet-500",
  secondary: "border border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10",
  ghost: "text-zinc-400 hover:bg-white/10 hover:text-zinc-100",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3",
  md: "h-9 px-4 text-sm",
  icon: "size-8",
  iconLg: "size-10 rounded-full",
};

/** Clases para <button> y <a> con el mismo aspecto. */
export function buttonClass(variant: Variant = "secondary", size: Size = "sm"): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`;
}