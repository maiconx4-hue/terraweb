/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FeatureStyle } from "@/lib/geo/types";

// Mesmos ícones usados pelos marcadores do mapa 2D.
const ICONS: Record<string, { path: string; anchor: [number, number] }> = {
  pin: { path: "M12 2C8 2 5 5 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-4-3-7-7-7zm0 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z", anchor: [12, 22] },
  circle: { path: "M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0z", anchor: [12, 12] },
  square: { path: "M6 6h12v12H6z", anchor: [12, 12] },
  star: { path: "M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z", anchor: [12, 12] },
  triangle: { path: "M12 3L22 20H2z", anchor: [12, 12] },
};

/** Ícone do marcador no Street View: igual ao 2D (selecionado = maior e destacado). */
export function buildStreetViewMarkerIcon(g: any, style: FeatureStyle, selected: boolean) {
  const zf = selected ? 1.6 : 1;
  if (style.icon === "triangle") {
    const px = Math.max(6, Math.round(20 * style.scale * zf));
    const frame = selected ? `<rect x="2" y="2" width="60" height="60" fill="none" stroke="#facc15" stroke-width="5"/>` : "";
    const d = selected ? "M32 14 L52 50 L12 50 Z" : "M32 6 L60 56 L4 56 Z";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${frame}<path fill="${style.color}" stroke="#000" stroke-width="2" stroke-linejoin="round" d="${d}"/></svg>`;
    return {
      url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
      scaledSize: new g.maps.Size(px, px),
      anchor: new g.maps.Point(px / 2, px / 2),
      labelOrigin: new g.maps.Point(px + 4, px / 2),
    };
  }
  const icon = ICONS[style.icon] ?? ICONS.pin!;
  return {
    path: icon.path,
    fillColor: style.color,
    fillOpacity: 1,
    strokeColor: selected ? "#22d3ee" : "#ffffff",
    strokeWeight: selected ? 2.5 : 1.5,
    scale: style.scale * 1.4 * zf,
    anchor: new g.maps.Point(icon.anchor[0], icon.anchor[1]),
    labelOrigin: new g.maps.Point(30, 10),
  };
}
