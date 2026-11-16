import type { ReactNode } from "react";

type GlyphProps = { size?: number; className?: string };

function Svg({ size = 16, className, children, filled = false }: GlyphProps & { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export const PlayGlyph = (p: GlyphProps) => (
  <Svg {...p} filled>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
  </Svg>
);

export const PauseGlyph = (p: GlyphProps) => (
  <Svg {...p} filled>
    <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
  </Svg>
);

export const RestartGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.6-5.9" />
    <path d="M4 4v4.5h4.5" />
  </Svg>
);

export const SkipBackGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="m11 7-5 5 5 5" />
    <path d="m18 7-5 5 5 5" />
  </Svg>
);

export const SkipForwardGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="m13 7 5 5-5 5" />
    <path d="m6 7 5 5-5 5" />
  </Svg>
);

export const ChevronGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const UploadGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M5 20h14" />
  </Svg>
);

export const CloseGlyph = (p: GlyphProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const SpinnerGlyph = ({ className = "", ...p }: GlyphProps) => (
  <Svg {...p} className={`motion-safe:animate-spin ${className}`}>
    <circle cx="12" cy="12" r="9" opacity=".25" />
    <path d="M21 12a9 9 0 0 0-9-9" />
  </Svg>
);