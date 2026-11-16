/**
 * Iconos SVG inline para la UI. Se ven igual en todos los navegadores (a
 * diferencia de los emojis, que Chromium headless no renderiza y algunos
 * sistemas muestran como □). Heredan el color del texto (`currentColor`).
 */

type IconProps = {
  /** Tamaño en px. */
  size?: number;
  className?: string;
};

function svgProps({ size = 14, className }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

/** Raid: saqueo rápido a la economía. */
export function RaidIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {/* rayo */}
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Batalla: dos ejércitos chocando. */
export function BattleIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {/* espadas cruzadas */}
      <path d="M3 3l7 7M3 3v3.5M3 3h3.5" />
      <path d="M21 3l-7 7M21 3v3.5M21 3h-3.5" />
      <path d="M10 10l-6.5 6.5a2.1 2.1 0 0 0 3 3L13 13" />
      <path d="M14 10l6.5 6.5a2.1 2.1 0 0 1-3 3L11 13" />
    </svg>
  );
}

/** Pico de APM: actividad de órdenes por minuto. */
export function ApmIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {/* pulso */}
      <path d="M2 12h4l2-7 4 14 3-10 2 3h5" />
    </svg>
  );
}

/** Oro: montoncito con brillo. */
export function GoldIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <ellipse cx="12" cy="17" rx="8" ry="3.5" />
      <ellipse cx="12" cy="12" rx="6" ry="3" />
      <ellipse cx="12" cy="7.5" rx="4" ry="2.5" />
    </svg>
  );
}

/** Piedra: cantería. */
export function StoneIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3 17l4-8 6 2 3-5 5 6-2 5H3z" />
      <path d="M7 9l6 2" />
    </svg>
  );
}

/** Reliquia: cofre con cruz. */
export function RelicIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="5" y="9" width="14" height="11" rx="2" />
      <path d="M9 9V6a3 3 0 0 1 6 0v3" />
      <path d="M12 12v5M9.5 14.5h5" />
    </svg>
  );
}

/** Oveja. */
export function SheepIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      {/* cuerpo lanudo + cabeza */}
      <path d="M6 14a3.5 3.5 0 0 1 0-7c.3-1.8 1.7-3 3.5-3 1 0 2 .4 2.6 1A3.6 3.6 0 0 1 15 5.8c1.4.4 2.3 1.6 2.3 3.2 0 2.8-2 5-4.8 5H6z" />
      <path d="M17 8.5 19 7l1.5 1.5L19 10l-2-.5" fill="currentColor" stroke="none" />
      <path d="M8 14v3M12 14v3" />
    </svg>
  );
}

/** Aldea / centro urbano (TC). */
export function TownCenterIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 21h16M5 21V10h6v11M11 21V10M11 10 8 6 5 10M13 21v-7h6v7M19 14l-3-3.5L13 14" />
    </svg>
  );
}

/** Casa. */
export function HouseIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

/** Castillo militar. */
export function CastleIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M5 21V8h2V5h2v3h2V5h2v3h2V5h2v3h2v13" />
      <path d="M3 21h18" />
      <path d="M10 21v-4a2 2 0 0 1 4 0v4" />
    </svg>
  );
}

/** Fuego: edificio enemigo bajo ataque. */
export function FireIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 2c1 3.5 4 5 4 9a4 4 0 0 1-8 0c0-1.5.5-2.5 1.2-3.6C9.8 9.6 10 11 11 12c.2-2.5-1.5-4.5 1-10Z" />
      <path d="M8.5 14.5a3.5 3.5 0 1 0 7 0" />
    </svg>
  );
}

/** Escombros: edificio demolido por su dueño. */
export function RubbleIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3 21h18" />
      <path d="M6 21l3-7 4 3 2-4 3 8" />
      <path d="M9 8l6-3" />
      <path d="M15 8l-2 2" />
    </svg>
  );
}

/** Paquete: copia local en el navegador. */
export function PackIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8Z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </svg>
  );
}

/** Menú: abrir la sidebar en mobile. */
export function MenuIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}
