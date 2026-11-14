/**
 * Catálogo y renderizado de edificios de Age of Empires II: Definitive Edition.
 *
 * Mapea IDs de objetos del motor Genie/DE a categorías funcionales, nombres legibles,
 * factores de huella isométrica (footprint) y renderizado de glifos vectoriales en Canvas.
 */

import type { BuildingEvent, ReplayModel } from "./types";

export type BuildingCategory =
  | "town_center"
  | "house"
  | "farm"
  | "mill"
  | "lumber_camp"
  | "mining_camp"
  | "dock"
  | "barracks"
  | "archery_range"
  | "stable"
  | "siege_workshop"
  | "castle"
  | "market"
  | "blacksmith"
  | "monastery"
  | "university"
  | "tower"
  | "gate"
  | "wall"
  | "special"
  | "other";

export type BuildingInfo = {
  name: string;
  category: BuildingCategory;
  /** Multiplicador de huella isométrica respecto a `unit` (ej: 1.8 para TC 4x4, 0.9 para Casa 2x2). */
  footprint: number;
  /** Multiplicador de elevación/altura del volumen (las granjas tienen altura mínima). */
  liftFactor: number;
};

const BUILDING_DATABASE: Record<number, BuildingInfo> = {
  // Centros Urbanos (4x4, gran presencia)
  109: { name: "Centro Urbano", category: "town_center", footprint: 2.1, liftFactor: 1.6 },
  621: { name: "Centro Urbano", category: "town_center", footprint: 2.1, liftFactor: 1.6 },
  71: { name: "Centro Urbano", category: "town_center", footprint: 2.1, liftFactor: 1.6 },

  // Casas (2x2)
  70: { name: "Casa", category: "house", footprint: 0.9, liftFactor: 1.05 },

  // Granjas (3x3, casi a ras de suelo para simular el campo cultivado)
  50: { name: "Granja", category: "farm", footprint: 1.35, liftFactor: 0.25 },

  // Economía / Recursos (2x2)
  68: { name: "Molino", category: "mill", footprint: 1.0, liftFactor: 1.25 },
  562: { name: "Campamento maderero", category: "lumber_camp", footprint: 1.0, liftFactor: 1.05 },
  584: { name: "Campamento minero", category: "mining_camp", footprint: 1.0, liftFactor: 1.05 },

  // Mercado (4x4)
  84: { name: "Mercado", category: "market", footprint: 1.7, liftFactor: 1.35 },

  // Militar básico (3x3)
  12: { name: "Cuartel", category: "barracks", footprint: 1.3, liftFactor: 1.3 },
  87: { name: "Galería de tiro con arco", category: "archery_range", footprint: 1.3, liftFactor: 1.3 },
  101: { name: "Establo", category: "stable", footprint: 1.3, liftFactor: 1.3 },
  49: { name: "Taller de maquinaria de asedio", category: "siege_workshop", footprint: 1.4, liftFactor: 1.35 },
  86: { name: "Taller de maquinaria de asedio", category: "siege_workshop", footprint: 1.4, liftFactor: 1.35 },

  // Castillo (4x4, gran elevación)
  82: { name: "Castillo", category: "castle", footprint: 1.9, liftFactor: 2.1 },

  // Tecnología y religión (3x3)
  103: { name: "Herrería", category: "blacksmith", footprint: 1.2, liftFactor: 1.15 },
  104: { name: "Monasterio", category: "monastery", footprint: 1.3, liftFactor: 1.45 },
  209: { name: "Universidad", category: "university", footprint: 1.35, liftFactor: 1.45 },

  // Naval (3x3)
  45: { name: "Muelle", category: "dock", footprint: 1.35, liftFactor: 1.0 },

  // Defensas (Torres 2x2, Outpost 1x1)
  79: { name: "Torre de guardia", category: "tower", footprint: 0.75, liftFactor: 2.2 },
  234: { name: "Torre de vigilancia", category: "tower", footprint: 0.75, liftFactor: 2.3 },
  235: { name: "Torreón", category: "tower", footprint: 0.75, liftFactor: 2.4 },
  236: { name: "Torre de bombardeo", category: "tower", footprint: 0.85, liftFactor: 2.5 },
  125: { name: "Puesto de avanzada", category: "tower", footprint: 0.55, liftFactor: 1.8 },

  // Murallas y Puertas (1x1 y 2x2)
  72: { name: "Muralla de empalizada", category: "wall", footprint: 0.5, liftFactor: 0.55 },
  117: { name: "Muralla de piedra", category: "wall", footprint: 0.5, liftFactor: 0.65 },
  155: { name: "Puerta de piedra", category: "gate", footprint: 0.8, liftFactor: 0.95 },
  490: { name: "Puerta de empalizada", category: "gate", footprint: 0.8, liftFactor: 0.85 },
  598: { name: "Puerta de empalizada", category: "gate", footprint: 0.8, liftFactor: 0.85 },
  665: { name: "Puerta de piedra", category: "gate", footprint: 0.8, liftFactor: 0.95 },
  673: { name: "Puerta", category: "gate", footprint: 0.8, liftFactor: 0.95 },

  // Unidades/Edificios especiales DE
  487: { name: "Feitoria", category: "special", footprint: 1.9, liftFactor: 1.8 },
  1808: { name: "Iglesia fortificada", category: "monastery", footprint: 1.35, liftFactor: 1.6 },
  1889: { name: "Carreta de mulas", category: "special", footprint: 0.8, liftFactor: 0.85 },
};

const DEFAULT_BUILDING: BuildingInfo = {
  name: "Edificio",
  category: "other",
  footprint: 1.0,
  liftFactor: 1.15,
};

/** Devuelve metadatos, categoría y factores de escala para un typeId de edificio. */
export function getBuildingInfo(typeId: number): BuildingInfo {
  const match = BUILDING_DATABASE[typeId];
  if (match) return match;
  return { ...DEFAULT_BUILDING, name: `Edificio (${typeId})` };
}

/**
 * Traza un glifo vectorial de alta legibilidad en el contexto Canvas 2D.
 * Se dibuja en dos pasadas (sombra exterior oscura + trazo frontal claro) para
 * garantizar contraste óptimo sobre cualquier color de jugador.
 */
export function drawBuildingIcon(
  ctx: CanvasRenderingContext2D,
  category: BuildingCategory,
  cx: number,
  cy: number,
  size: number,
): void {
  // Para tamaños minúsculos no sobrecargar con trazos finos
  if (size < 3.5) {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.5, size * 0.4), 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    return;
  }

  const strokeWidth = Math.max(1.2, Math.min(2.4, size * 0.22));

  function strokeWithContrast(draw: () => void, strokeColor = "#ffffff") {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Pasada 1: halo oscuro exterior para contraste
    ctx.strokeStyle = "rgba(10, 10, 15, 0.85)";
    ctx.lineWidth = strokeWidth + 2;
    draw();
    ctx.stroke();

    // Pasada 2: trazo nítido claro
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    draw();
    ctx.stroke();
    ctx.restore();
  }

  function fillAndStroke(draw: () => void, fillColor = "rgba(255, 255, 255, 0.95)", strokeColor = "rgba(10, 10, 15, 0.85)") {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    draw();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(1, strokeWidth * 0.8);
    ctx.stroke();
    ctx.restore();
  }

  switch (category) {
    case "town_center": {
      // Centro Urbano (TC): Gran pabellón cívico con la emblemática Campana Dorada (Town Bell)
      const w = size * 0.95;
      const h = size * 0.9;

      // 1. Estructura del pabellón / campanario (pilares laterales y frontón superior)
      fillAndStroke(() => {
        ctx.beginPath();
        // Techo frontón
        ctx.moveTo(cx, cy - h * 1.15);
        ctx.lineTo(cx + w, cy - h * 0.45);
        ctx.lineTo(cx + w * 0.75, cy - h * 0.45);
        // Columna derecha
        ctx.lineTo(cx + w * 0.75, cy + h * 0.9);
        ctx.lineTo(cx + w * 0.45, cy + h * 0.9);
        ctx.lineTo(cx + w * 0.45, cy - h * 0.2);
        // Bóveda interior
        ctx.arc(cx, cy - h * 0.2, w * 0.45, 0, Math.PI, true);
        // Columna izquierda
        ctx.lineTo(cx - w * 0.45, cy + h * 0.9);
        ctx.lineTo(cx - w * 0.75, cy + h * 0.9);
        ctx.lineTo(cx - w * 0.75, cy - h * 0.45);
        ctx.lineTo(cx - w, cy - h * 0.45);
        ctx.closePath();
      }, "#f8fafc");

      // 2. La mítica Campana de alarma (Town Bell) dorada y acampanada
      const bw = w * 0.42;
      fillAndStroke(() => {
        ctx.beginPath();
        // Corona/yugo de la campana
        ctx.moveTo(cx - bw * 0.35, cy - h * 0.22);
        ctx.lineTo(cx + bw * 0.35, cy - h * 0.22);
        // Cuerpo curvado acampanado
        ctx.lineTo(cx + bw * 0.3, cy - h * 0.05);
        ctx.quadraticCurveTo(cx + bw * 0.35, cy + h * 0.25, cx + bw * 0.9, cy + h * 0.42);
        ctx.lineTo(cx - bw * 0.9, cy + h * 0.42);
        ctx.quadraticCurveTo(cx - bw * 0.35, cy + h * 0.25, cx - bw * 0.3, cy - h * 0.05);
        ctx.closePath();
      }, "#fbbf24", "rgba(10, 10, 15, 0.9)");

      // 3. Badajo esférico colgando en el centro
      fillAndStroke(() => {
        ctx.beginPath();
        ctx.arc(cx, cy + h * 0.58, bw * 0.22, 0, Math.PI * 2);
      }, "#fef08a", "rgba(10, 10, 15, 0.9)");
      break;
    }

    case "house": {
      // Casa clásica con techo a dos aguas
      const w = size * 0.75;
      const h = size * 0.8;
      fillAndStroke(() => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - h); // Vértice del techo
        ctx.lineTo(cx + w, cy - h * 0.15);
        ctx.lineTo(cx + w * 0.7, cy - h * 0.15);
        ctx.lineTo(cx + w * 0.7, cy + h);
        ctx.lineTo(cx + w * 0.2, cy + h);
        ctx.lineTo(cx + w * 0.2, cy + h * 0.35); // Puerta
        ctx.lineTo(cx - w * 0.2, cy + h * 0.35);
        ctx.lineTo(cx - w * 0.2, cy + h);
        ctx.lineTo(cx - w * 0.7, cy + h);
        ctx.lineTo(cx - w * 0.7, cy - h * 0.15);
        ctx.lineTo(cx - w, cy - h * 0.15);
        ctx.closePath();
      });
      break;
    }

    case "farm": {
      // Parcela de granja con surcos diagonales y espiga
      const r = size * 0.85;
      strokeWithContrast(() => {
        ctx.beginPath();
        // Rombo perimetral
        ctx.moveTo(cx, cy - r * 0.55);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r * 0.55);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
        // Surcos de cultivo
        ctx.moveTo(cx - r * 0.5, cy - r * 0.28);
        ctx.lineTo(cx + r * 0.5, cy + r * 0.28);
        ctx.moveTo(cx - r * 0.5, cy + r * 0.28);
        ctx.lineTo(cx + r * 0.5, cy - r * 0.28);
      }, "#fef08a");
      break;
    }

    case "barracks": {
      // Espadas cruzadas
      const r = size * 0.8;
      strokeWithContrast(() => {
        ctx.beginPath();
        // Espada 1 (\)
        ctx.moveTo(cx - r, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r * 0.35, cy + r * 0.85);
        ctx.lineTo(cx + r * 0.85, cy + r * 0.35);
        // Espada 2 (/)
        ctx.moveTo(cx + r, cy - r);
        ctx.lineTo(cx - r, cy + r);
        ctx.moveTo(cx - r * 0.35, cy + r * 0.85);
        ctx.lineTo(cx - r * 0.85, cy + r * 0.35);
      }, "#fca5a5");
      break;
    }

    case "archery_range": {
      // Arco con flecha apuntando hacia la derecha
      const r = size * 0.85;
      strokeWithContrast(() => {
        ctx.beginPath();
        // Arco curvado
        ctx.arc(cx - r * 0.3, cy, r * 0.75, -Math.PI * 0.45, Math.PI * 0.45);
        // Cuerda
        const ax = cx - r * 0.3 + r * 0.75 * Math.cos(-Math.PI * 0.45);
        const ay = cy + r * 0.75 * Math.sin(-Math.PI * 0.45);
        const bx = cx - r * 0.3 + r * 0.75 * Math.cos(Math.PI * 0.45);
        const by = cy + r * 0.75 * Math.sin(Math.PI * 0.45);
        ctx.moveTo(ax, ay);
        ctx.lineTo(cx - r * 0.55, cy);
        ctx.lineTo(bx, by);
        // Flecha
        ctx.moveTo(cx - r * 0.55, cy);
        ctx.lineTo(cx + r * 0.9, cy);
        // Punta de flecha
        ctx.moveTo(cx + r * 0.55, cy - r * 0.28);
        ctx.lineTo(cx + r * 0.9, cy);
        ctx.lineTo(cx + r * 0.55, cy + r * 0.28);
      }, "#93c5fd");
      break;
    }

    case "stable": {
      // Herradura de caballería
      const r = size * 0.75;
      fillAndStroke(() => {
        ctx.beginPath();
        ctx.arc(cx, cy - r * 0.15, r * 0.7, Math.PI, 0, false);
        ctx.lineTo(cx + r * 0.7, cy + r * 0.75);
        ctx.lineTo(cx + r * 0.32, cy + r * 0.75);
        ctx.lineTo(cx + r * 0.32, cy - r * 0.15);
        ctx.arc(cx, cy - r * 0.15, r * 0.32, 0, Math.PI, true);
        ctx.lineTo(cx - r * 0.32, cy + r * 0.75);
        ctx.lineTo(cx - r * 0.7, cy + r * 0.75);
        ctx.closePath();
      }, "#fde047");
      break;
    }

    case "siege_workshop": {
      // Catapulta / Taller de asedio
      const r = size * 0.8;
      strokeWithContrast(() => {
        ctx.beginPath();
        // Ruedas
        ctx.arc(cx - r * 0.4, cy + r * 0.45, r * 0.28, 0, Math.PI * 2);
        ctx.moveTo(cx + r * 0.68, cy + r * 0.45);
        ctx.arc(cx + r * 0.4, cy + r * 0.45, r * 0.28, 0, Math.PI * 2);
        // Viga base
        ctx.moveTo(cx - r * 0.75, cy + r * 0.45);
        ctx.lineTo(cx + r * 0.75, cy + r * 0.45);
        // Brazo diagonal de tiro
        ctx.moveTo(cx - r * 0.4, cy + r * 0.15);
        ctx.lineTo(cx + r * 0.55, cy - r * 0.75);
        // Proyectil
        ctx.moveTo(cx + r * 0.75, cy - r * 0.75);
        ctx.arc(cx + r * 0.55, cy - r * 0.75, r * 0.2, 0, Math.PI * 2);
      }, "#fdba74");
      break;
    }

    case "castle": {
      // Castillo imponente con almenas y estandarte
      const w = size * 0.95;
      const h = size * 0.95;
      fillAndStroke(() => {
        ctx.beginPath();
        ctx.moveTo(cx - w, cy + h);
        // Torre izquierda
        ctx.lineTo(cx - w, cy - h * 0.45);
        ctx.lineTo(cx - w * 0.65, cy - h * 0.45);
        ctx.lineTo(cx - w * 0.65, cy - h * 0.1);
        // Muro central
        ctx.lineTo(cx - w * 0.35, cy - h * 0.1);
        // Torre central principal
        ctx.lineTo(cx - w * 0.35, cy - h * 0.8);
        ctx.lineTo(cx + w * 0.35, cy - h * 0.8);
        ctx.lineTo(cx + w * 0.35, cy - h * 0.1);
        // Muro derecho
        ctx.lineTo(cx + w * 0.65, cy - h * 0.1);
        // Torre derecha
        ctx.lineTo(cx + w * 0.65, cy - h * 0.45);
        ctx.lineTo(cx + w, cy - h * 0.45);
        ctx.lineTo(cx + w, cy + h);
        // Puerta levadiza
        ctx.lineTo(cx + w * 0.25, cy + h);
        ctx.arc(cx, cy + h, w * 0.25, 0, Math.PI, true);
        ctx.lineTo(cx - w, cy + h);
        ctx.closePath();
      }, "#f3f4f6");
      // Banderín en la torre principal
      strokeWithContrast(() => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - h * 0.8);
        ctx.lineTo(cx, cy - h * 1.25);
        ctx.lineTo(cx + w * 0.35, cy - h * 1.05);
        ctx.lineTo(cx, cy - h * 0.9);
      }, "#f87171");
      break;
    }

    case "mill": {
      // Aspas de molino de viento (cruz 4 aspas)
      const r = size * 0.85;
      fillAndStroke(() => {
        ctx.beginPath();
        // Aspas diagonales con palas rectangulares
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - r, cy - r);
        ctx.lineTo(cx - r * 0.55, cy - r);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + r, cy + r);
        ctx.lineTo(cx + r * 0.55, cy + r);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + r, cy - r);
        ctx.lineTo(cx + r, cy - r * 0.55);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx - r, cy + r);
        ctx.lineTo(cx - r, cy + r * 0.55);
        ctx.closePath();
      }, "#fef08a");
      break;
    }

    case "lumber_camp": {
      // Hacha de leñador
      const r = size * 0.8;
      strokeWithContrast(() => {
        ctx.beginPath();
        // Mango
        ctx.moveTo(cx + r * 0.5, cy + r * 0.65);
        ctx.lineTo(cx - r * 0.35, cy - r * 0.65);
        // Hoja semicircular del hacha
        ctx.moveTo(cx - r * 0.15, cy - r * 0.45);
        ctx.quadraticCurveTo(cx - r * 0.85, cy - r * 0.3, cx - r * 0.6, cy - r * 0.85);
        ctx.lineTo(cx - r * 0.35, cy - r * 0.65);
      }, "#86efac");
      break;
    }

    case "mining_camp": {
      // Pico de minería
      const r = size * 0.8;
      strokeWithContrast(() => {
        ctx.beginPath();
        // Mango
        ctx.moveTo(cx + r * 0.55, cy + r * 0.65);
        ctx.lineTo(cx - r * 0.35, cy - r * 0.45);
        // Cabeza curva del pico
        ctx.moveTo(cx - r * 0.85, cy - r * 0.1);
        ctx.quadraticCurveTo(cx - r * 0.35, cy - r * 0.85, cx + r * 0.3, cy - r * 0.65);
        ctx.lineTo(cx - r * 0.35, cy - r * 0.45);
      }, "#cbd5e1");
      break;
    }

    case "market": {
      // Balanza de mercader
      const r = size * 0.85;
      strokeWithContrast(() => {
        ctx.beginPath();
        // Mástil y base
        ctx.moveTo(cx, cy - r * 0.8);
        ctx.lineTo(cx, cy + r * 0.8);
        ctx.moveTo(cx - r * 0.4, cy + r * 0.8);
        ctx.lineTo(cx + r * 0.4, cy + r * 0.8);
        // Brazo horizontal
        ctx.moveTo(cx - r * 0.75, cy - r * 0.45);
        ctx.lineTo(cx + r * 0.75, cy - r * 0.45);
        // Platillo izquierdo
        ctx.moveTo(cx - r * 0.75, cy - r * 0.45);
        ctx.lineTo(cx - r * 0.95, cy + r * 0.15);
        ctx.lineTo(cx - r * 0.55, cy + r * 0.15);
        ctx.closePath();
        // Platillo derecho
        ctx.moveTo(cx + r * 0.75, cy - r * 0.45);
        ctx.lineTo(cx + r * 0.55, cy + r * 0.15);
        ctx.lineTo(cx + r * 0.95, cy + r * 0.15);
        ctx.closePath();
      }, "#fcd34d");
      break;
    }

    case "blacksmith": {
      // Yunque con martillo
      const r = size * 0.8;
      fillAndStroke(() => {
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.85, cy - r * 0.35); // Punta del yunque
        ctx.lineTo(cx - r * 0.3, cy - r * 0.35);
        ctx.lineTo(cx + r * 0.75, cy - r * 0.35); // Superficie de trabajo
        ctx.lineTo(cx + r * 0.75, cy - r * 0.05);
        ctx.lineTo(cx + r * 0.35, cy + r * 0.1);
        ctx.lineTo(cx + r * 0.55, cy + r * 0.75); // Base
        ctx.lineTo(cx - r * 0.55, cy + r * 0.75);
        ctx.lineTo(cx - r * 0.35, cy + r * 0.1);
        ctx.quadraticCurveTo(cx - r * 0.55, cy - r * 0.05, cx - r * 0.85, cy - r * 0.35);
        ctx.closePath();
      }, "#94a3b8");
      break;
    }

    case "monastery": {
      // Basílica con cruz latina
      const r = size * 0.85;
      strokeWithContrast(() => {
        ctx.beginPath();
        // Cruz en la cúspide
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx, cy + r * 0.8);
        ctx.moveTo(cx - r * 0.55, cy - r * 0.45);
        ctx.lineTo(cx + r * 0.55, cy - r * 0.45);
        // Arco de bóveda
        ctx.moveTo(cx - r * 0.75, cy + r * 0.8);
        ctx.lineTo(cx - r * 0.75, cy + r * 0.1);
        ctx.arc(cx, cy + r * 0.1, r * 0.75, Math.PI, 0);
        ctx.lineTo(cx + r * 0.75, cy + r * 0.8);
      }, "#c084fc");
      break;
    }

    case "university": {
      // Libro abierto del saber
      const r = size * 0.8;
      strokeWithContrast(() => {
        ctx.beginPath();
        // Lomo central
        ctx.moveTo(cx, cy + r * 0.6);
        ctx.lineTo(cx, cy - r * 0.15);
        // Página izquierda
        ctx.quadraticCurveTo(cx - r * 0.45, cy - r * 0.45, cx - r * 0.85, cy - r * 0.25);
        ctx.lineTo(cx - r * 0.85, cy + r * 0.45);
        ctx.quadraticCurveTo(cx - r * 0.45, cy + r * 0.25, cx, cy + r * 0.6);
        // Página derecha
        ctx.moveTo(cx, cy - r * 0.15);
        ctx.quadraticCurveTo(cx + r * 0.45, cy - r * 0.45, cx + r * 0.85, cy - r * 0.25);
        ctx.lineTo(cx + r * 0.85, cy + r * 0.45);
        ctx.quadraticCurveTo(cx + r * 0.45, cy + r * 0.25, cx, cy + r * 0.6);
      }, "#67e8f9");
      break;
    }

    case "dock": {
      // Ancla marítima
      const r = size * 0.85;
      strokeWithContrast(() => {
        ctx.beginPath();
        // Anilla superior
        ctx.arc(cx, cy - r * 0.6, r * 0.22, 0, Math.PI * 2);
        // Caña vertical
        ctx.moveTo(cx, cy - r * 0.38);
        ctx.lineTo(cx, cy + r * 0.65);
        // Cepo horizontal
        ctx.moveTo(cx - r * 0.5, cy - r * 0.15);
        ctx.lineTo(cx + r * 0.5, cy - r * 0.15);
        // Brazos curvos
        ctx.arc(cx, cy + r * 0.2, r * 0.6, 0.15 * Math.PI, 0.85 * Math.PI);
        // Uñas
        ctx.moveTo(cx - r * 0.6 * Math.cos(0.15 * Math.PI), cy + r * 0.2 + r * 0.6 * Math.sin(0.15 * Math.PI));
        ctx.lineTo(cx - r * 0.65, cy + r * 0.2);
        ctx.moveTo(cx + r * 0.6 * Math.cos(0.15 * Math.PI), cy + r * 0.2 + r * 0.6 * Math.sin(0.15 * Math.PI));
        ctx.lineTo(cx + r * 0.65, cy + r * 0.2);
      }, "#38bdf8");
      break;
    }

    case "tower": {
      // Torre defensiva con aspillera vertical
      const w = size * 0.55;
      const h = size * 0.95;
      fillAndStroke(() => {
        ctx.beginPath();
        ctx.moveTo(cx - w, cy + h);
        ctx.lineTo(cx - w * 0.7, cy - h * 0.55);
        ctx.lineTo(cx - w, cy - h * 0.55);
        ctx.lineTo(cx - w, cy - h);
        ctx.lineTo(cx - w * 0.35, cy - h);
        ctx.lineTo(cx - w * 0.35, cy - h * 0.75);
        ctx.lineTo(cx + w * 0.35, cy - h * 0.75);
        ctx.lineTo(cx + w * 0.35, cy - h);
        ctx.lineTo(cx + w, cy - h);
        ctx.lineTo(cx + w, cy - h * 0.55);
        ctx.lineTo(cx + w * 0.7, cy - h * 0.55);
        ctx.lineTo(cx + w, cy + h);
        ctx.closePath();
      }, "#e2e8f0");
      // Aspillera
      strokeWithContrast(() => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - h * 0.25);
        ctx.lineTo(cx, cy + h * 0.25);
      }, "#0f172a");
      break;
    }

    case "gate":
    case "wall": {
      // Muro almenado o puerta
      const w = size * 0.85;
      const h = size * 0.65;
      fillAndStroke(() => {
        ctx.beginPath();
        ctx.moveTo(cx - w, cy + h);
        ctx.lineTo(cx - w, cy - h);
        ctx.lineTo(cx - w * 0.4, cy - h);
        ctx.lineTo(cx - w * 0.4, cy - h * 0.35);
        ctx.lineTo(cx + w * 0.4, cy - h * 0.35);
        ctx.lineTo(cx + w * 0.4, cy - h);
        ctx.lineTo(cx + w, cy - h);
        ctx.lineTo(cx + w, cy + h);
        ctx.closePath();
      }, "#94a3b8");
      break;
    }

    default: {
      // Estrella / diamante genérico
      const r = size * 0.75;
      fillAndStroke(() => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.35, cy - r * 0.35);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx + r * 0.35, cy + r * 0.35);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r * 0.35, cy + r * 0.35);
        ctx.lineTo(cx - r, cy);
        ctx.lineTo(cx - r * 0.35, cy - r * 0.35);
        ctx.closePath();
      }, "#ffffff");
      break;
    }
  }
}

/**
 * Infiere y asegura que cada jugador tenga su Centro Urbano inicial en t=0.
 *
 * En AoE2 estándar cada civilización arranca con un TC en su base, pero las
 * grabaciones sólo registran las acciones BUILD creadas posteriormente.
 * Para jugadores que no construyeron un TC muy temprano (mapas Nomad),
 * estimamos la posición de su base a partir de su cámara inicial o sus primeras órdenes.
 */
export function inferStartingTownCenters(model: ReplayModel): BuildingEvent[] {
  const result: BuildingEvent[] = [];
  const existingTCs = model.buildings.filter(
    (b) => b.typeId === 109 || b.typeId === 621 || b.typeId === 71,
  );

  const initialView = model.viewlocks?.[0];

  for (const player of model.players) {
    // Si ya tiene un TC en t=0 o construyó uno muy temprano (mapa Nomad, t < 5 min), no inferimos
    const hasEarlyTC = existingTCs.some(
      (b) => b.playerId === player.id && b.t < 300_000,
    );
    if (hasEarlyTC) continue;

    const points: Array<{ x: number; y: number; weight: number }> = [];

    // 1. Cámara inicial del jugador (si es el dueño de la grabación, muy precisa)
    if (player.owner && initialView) {
      points.push({ x: initialView[1], y: initialView[2], weight: 6.0 });
    }

    // 2. Interacciones tempranas (recolectar ovejas/árboles en el TC, t < 60s)
    const earlyInteractions = (model.interactions ?? []).filter(
      (i) => i.playerId === player.id && i.t < 60_000,
    );
    for (const inter of earlyInteractions) {
      points.push({ x: inter.x, y: inter.y, weight: 2.5 });
    }

    // 3. Primeras construcciones (casas iniciales alrededor del TC, t < 60s)
    const earlyBuildings = model.buildings.filter(
      (b) => b.playerId === player.id && b.t < 60_000,
    );
    for (const b of earlyBuildings) {
      points.push({ x: b.x, y: b.y, weight: 2.0 });
    }

    // 4. Primeras órdenes de movimiento (t < 40s)
    const earlyMoves = model.moves
      .filter((m) => m.playerId === player.id && m.t < 40_000)
      .slice(0, 8);
    for (const m of earlyMoves) {
      points.push({ x: m.x, y: m.y, weight: 1.0 });
    }

    // Si no hubo acciones en los primeros 60s (jugador AFK o tardío), buscamos sus primeras acciones globales
    if (points.length === 0) {
      const anyInteractions = (model.interactions ?? []).filter((i) => i.playerId === player.id).slice(0, 3);
      for (const inter of anyInteractions) points.push({ x: inter.x, y: inter.y, weight: 2.0 });
      const anyBuildings = model.buildings.filter((b) => b.playerId === player.id).slice(0, 2);
      for (const b of anyBuildings) points.push({ x: b.x, y: b.y, weight: 2.0 });
      const anyMoves = model.moves.filter((m) => m.playerId === player.id).slice(0, 5);
      for (const m of anyMoves) points.push({ x: m.x, y: m.y, weight: 1.0 });
    }

    if (points.length > 0) {
      const totalWeight = points.reduce((acc, p) => acc + p.weight, 0);
      const avgX = points.reduce((acc, p) => acc + p.x * p.weight, 0) / totalWeight;
      const avgY = points.reduce((acc, p) => acc + p.y * p.weight, 0) / totalWeight;

      result.push({
        t: 0,
        playerId: player.id,
        x: Math.round(avgX),
        y: Math.round(avgY),
        typeId: 109,
        objectId: 0,
      });
    }
  }

  return result;
}
