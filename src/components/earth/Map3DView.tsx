/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { Compass, LocateFixed, LoaderCircle } from "lucide-react";
import { isFeature, passesFilter, type Filter, type FeatureNode, type FeatureStyle, type GeoNode, type LatLng } from "@/lib/geo/types";

type Props = {
  nodes: GeoNode[];
  filter: Filter;
  selectedId: string | null;
  initialCenter: LatLng;
  initialZoom: number;
  focusRequest?: { center: LatLng; nonce: number } | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<GeoNode>) => void;
  onCenterChange?: (center: LatLng) => void;
  mode?: "none" | "marker" | "polygon" | "path" | "ruler";
  draft?: LatLng[];
  /** "satellite" = só imagem; qualquer outro valor = satélite + rótulos. */
  mapType?: string;
  /** CTO sendo arrastada no Street View: move o marcador 3D em tempo real. */
  liveMarker?: { id: string; pos: LatLng } | null;
  onCreateMarker?: (point: LatLng) => void;
  onExitMarkerMode?: () => void;
  onDraftPoint?: (point: LatLng) => void;
};

type OverlayRecord = {
  kind: "marker" | "polygon" | "path";
  element: any;
  signature: string;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/*
 * Progressão como no Google Earth Pro. Tudo é medido pela ALTITUDE DO PONTO DE VISÃO
 * (a mesma que o Earth mostra no rodapé): distância da câmera × cos(inclinação).
 * Ajuste os limites abaixo para calibrar com o Earth.
 */
const FOV_DEG = 35;                      // campo de visão vertical aproximado do Maps 3D
const LABEL_MAX_ALTITUDE = 40_000;       // acima disso nenhum título é mostrado
const LABEL_HEIGHT_PX = 14;
const ALWAYS_LABELS_ALTITUDE = 500;      // abaixo disso os títulos nunca somem, nem em movimento
const MOVING_SETTLE_MS = 250;            // tempo parado para os títulos reaparecerem
const ALL_LABELS_ALTITUDE = 4_000;       // até aqui todos os títulos aparecem (como o Earth a ~3,3 km)
const LABEL_OVERLAP_TOLERANCE = 0.6;     // como no Earth, títulos podem se tocar um pouco

/** Quantos ícones manter: todos até bem longe (o Earth só tira os títulos primeiro). */
const markerStrideFromAltitude = (altitude: number) => {
  if (altitude < 20_000) return 1;
  if (altitude < 50_000) return 2;
  if (altitude < 120_000) return 4;
  if (altitude < 300_000) return 16;
  return 64;
};

/** Ícones menores conforme o afastamento (degraus, para não recriar o SVG a cada pixel). */
const iconScaleFromAltitude = (altitude: number) => {
  if (altitude <= 3_500) return 1;
  if (altitude <= 10_000) return 0.85;
  if (altitude <= 25_000) return 0.7;
  if (altitude <= 60_000) return 0.55;
  return 0.45;
};

const iconPx = (style: FeatureStyle, selected: boolean, zf: number) =>
  Math.max(10, Math.round(26 * style.scale * (selected ? 1.6 : zf)));

/** Quantiza a distância da câmera (4 degraus por dobra) para evitar recalcular a cada frame. */
const quantizeRange = (range: number) => 2 ** (Math.round(Math.log2(range) * 4) / 4);
const readCameraView = (map: any) => {
  const range = Number(map.range);
  const tilt = Number(map.tilt);
  const heading = Number(map.heading);
  return {
    range: Number.isFinite(range) && range > 0 ? range : null,
    tilt: Number.isFinite(tilt) ? tilt : null,
    heading: Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : null,
  };
};
const formatAltitude = (meters: number) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(2).replace(".", ",")} km` : `${Math.round(meters)} m`;

/** Converte o zoom 2D em distância de câmera 3D (metros). */
const rangeFromZoom = (zoom: number) =>
  zoom <= 4 ? 20_000_000 : clamp(180 * 2 ** (18 - zoom), 350, 18_000_000);

const toRgba = (color: string, opacity: number) => {
  const alpha = clamp(Number.isFinite(opacity) ? opacity : 1, 0, 1);
  const hex = color.trim();

  // O Maps 3D aceita cor CSS, mas não possui fillOpacity/strokeOpacity.
  // A transparência é incorporada diretamente à cor.
  const shortHex = hex.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    const [r, g, b] = shortHex[1]!.split("").map((v) => parseInt(v + v, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const fullHex = hex.match(/^#([0-9a-f]{6})$/i);
  if (fullHex) {
    const value = fullHex[1]!;
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const rgb = hex.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;

  // Cores CSS nomeadas ou formatos já válidos permanecem utilizáveis.
  return hex || `rgba(255, 255, 255, ${alpha})`;
};


const MARKER_ICON_PATHS: Record<string, string> = {
  pin: "M12 2C8 2 5 5 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-4-3-7-7-7zm0 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
  circle: "M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0z",
  square: "M6 6h12v12H6z",
  star: "M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z",
  triangle: "M12 3L22 20H2z",
};

/**
 * O Maps 3D desenha o marcador em WebGL: animation/transform/filter no elemento
 * não têm efeito. O visual é definido pelo conteúdo (<template> com SVG).
 * Replica o ícone do mapa 2D: selecionado = contorno ciano (ou moldura amarela
 * no triângulo) e tamanho maior (2D usa 1.6x).
 */
const buildIconSvg = (style: FeatureStyle, selected: boolean, zf: number) => {
  const px = iconPx(style, selected, zf);
  const color = style.color || "#c60000";
  if (style.icon === "triangle") {
    const frame = selected
      ? `<rect x="2" y="2" width="60" height="60" fill="none" stroke="#facc15" stroke-width="5"/>`
      : "";
    const d = selected ? "M32 14 L52 50 L12 50 Z" : "M32 6 L60 56 L4 56 Z";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">${frame}<path fill="${color}" stroke="#000" stroke-width="2" stroke-linejoin="round" d="${d}"/></svg>`;
  }
  const path = MARKER_ICON_PATHS[style.icon] ?? MARKER_ICON_PATHS.pin!;
  const stroke = selected ? "#22d3ee" : "#ffffff";
  const sw = selected ? 2.5 : 1.5;
  const halo = selected ? `<circle cx="12" cy="12" r="11.5" fill="none" stroke="#facc15" stroke-width="1.2"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24">${halo}<path fill="${color}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" d="${path}"/></svg>`;
};

let labelCanvas: CanvasRenderingContext2D | null = null;
const measureLabel = (text: string, bold: boolean) => {
  labelCanvas ??= document.createElement("canvas").getContext("2d");
  if (!labelCanvas) return text.length * 6.5;
  labelCanvas.font = `${bold ? "600 " : ""}12px Arial, Helvetica, sans-serif`;
  return labelCanvas.measureText(text).width;
};
const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Ícone + título no mesmo SVG, para controlar o tamanho do texto (o rótulo nativo do
 * Maps 3D é grande demais). Título pequeno à direita do ícone, como no Google Earth Pro;
 * o ícone fica centralizado no SVG para que continue exatamente sobre a coordenada.
 */
const buildMarkerSvg = (style: FeatureStyle, selected: boolean, name: string, side: "l" | "r" | null, zf: number) => {
  const px = iconPx(style, selected, zf);
  const icon = buildIconSvg(style, selected, zf);
  const text = name.trim();
  if (!text || !side) return icon;
  const textWidth = Math.ceil(measureLabel(text, selected));
  const half = Math.ceil(px / 2 + 5 + textWidth + 3);
  const width = half * 2;
  const nested = icon.replace('<svg xmlns="http://www.w3.org/2000/svg"', `<svg x="${half - px / 2}" y="0"`);
  const x = side === "r" ? half + px / 2 + 5 : half - px / 2 - 5;
  const anchor = side === "r" ? "start" : "end";
  const label = `<text x="${x}" y="${px / 2}" text-anchor="${anchor}" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="${selected ? 600 : 400}" fill="#ffffff" stroke="#000000" stroke-opacity="0.85" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${escapeXml(text)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${px}" viewBox="0 0 ${width} ${px}">${nested}${label}</svg>`;
};

type LabelItem = { id: string; lat: number; lng: number; name: string; selected: boolean; px: number };

/**
 * Escolhe o lado do título (esquerda/direita, alternando) e esconde os que colidiriam.
 * O Maps 3D não informa a posição dos pontos na tela; por isso a tela é estimada a partir
 * da câmera (altura, inclinação, direção e campo de visão). Aproximação: melhor em visão
 * mais vertical, menos exata com muita inclinação.
 */
const planLabels = (items: LabelItem[], view: { range: number; tilt: number; heading: number; height: number; showAll: boolean }) => {
  const plan = new Map<string, "l" | "r" | null>();
  if (items.length === 0 || view.height <= 0) return plan;
  const mpp = (2 * view.range * Math.tan((FOV_DEG / 2) * (Math.PI / 180))) / view.height;
  const cosTilt = Math.max(0.25, Math.cos((view.tilt * Math.PI) / 180));
  const sinH = Math.sin((view.heading * Math.PI) / 180);
  const cosH = Math.cos((view.heading * Math.PI) / 180);
  const lat0 = items[0]!.lat;
  const lng0 = items[0]!.lng;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);

  const CELL = 64;
  const grid = new Map<string, number[]>();
  const rects: number[][] = [];
  const cellsOf = (r: number[]) => {
    const out: string[] = [];
    for (let cx = Math.floor(r[0]! / CELL); cx <= Math.floor(r[2]! / CELL); cx++)
      for (let cy = Math.floor(r[1]! / CELL); cy <= Math.floor(r[3]! / CELL); cy++) out.push(`${cx},${cy}`);
    return out;
  };
  const collides = (r: number[]) => {
    for (const key of cellsOf(r)) {
      for (const index of grid.get(key) ?? []) {
        const o = rects[index]!;
        if (r[0]! < o[2]! && r[2]! > o[0]! && r[1]! < o[3]! && r[3]! > o[1]!) return true;
      }
    }
    return false;
  };
  const place = (r: number[]) => {
    rects.push(r);
    for (const key of cellsOf(r)) {
      const list = grid.get(key);
      if (list) list.push(rects.length - 1);
      else grid.set(key, [rects.length - 1]);
    }
  };

  const screen = (item: LabelItem) => {
    const east = (item.lng - lng0) * kx;
    const north = (item.lat - lat0) * 110_574;
    return {
      x: (east * cosH - north * sinH) / mpp,
      y: -((east * sinH + north * cosH) * cosTilt) / mpp,
    };
  };
  const tryPlace = (item: LabelItem, side: "l" | "r", force = false) => {
    const { x, y } = screen(item);
    const width = measureLabel(item.name, item.selected) + 6;
    const edge = item.px / 2 + 3;
    const x0 = side === "r" ? x + edge : x - edge - width;
    // O retângulo de colisão é menor que o título: tolera sobreposição leve.
    const w = width * LABEL_OVERLAP_TOLERANCE;
    const h = LABEL_HEIGHT_PX * LABEL_OVERLAP_TOLERANCE;
    const rect = side === "r"
      ? [x0, y - h / 2, x0 + w, y + h / 2]
      : [x0 + width - w, y - h / 2, x0 + width, y + h / 2];
    if (!force && collides(rect)) return false;
    place(rect);
    return true;
  };

  // O selecionado sempre mostra o título; depois os demais, alternando o lado preferido.
  for (const item of items) if (item.selected) { tryPlace(item, "r", true); plan.set(item.id, "r"); }
  let flip = false;
  for (const item of items) {
    if (item.selected) continue;
    if (!item.name.trim()) { plan.set(item.id, null); continue; }
    const order: Array<"l" | "r"> = flip ? ["l", "r"] : ["r", "l"];
    // Perto: todos os títulos aparecem (lado alternado). Longe: some o que colidir.
    const side = order.find((candidate) => tryPlace(item, candidate)) ?? (view.showAll ? (tryPlace(item, order[0]!, true), order[0]!) : null);
    plan.set(item.id, side);
    if (side) flip = !flip;
  }
  return plan;
};

/** Substitui o conteúdo visual do marcador 3D (sem criar elementos duplicados). */
const applyMarkerContent = (element: any, style: FeatureStyle, selected: boolean, name: string, side: "l" | "r" | null, zf: number) => {
  element.querySelectorAll?.("template").forEach((t: Element) => t.remove());
  const template = document.createElement("template");
  template.innerHTML = buildMarkerSvg(style, selected, name, side, zf);
  element.append(template);
};

/** Vértice do rascunho: círculo branco com contorno laranja, como no mapa 2D. */
const draftVertexSvg = (isNew: boolean) => {
  const px = isNew ? 20 : 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" fill="#ffffff" stroke="${isNew ? "#f97316" : "#f59e0b"}" stroke-width="2.5"/></svg>`;
};

/** Índice onde inserir um novo ponto: após o vértice da aresta mais próxima do clique. */
const nearestEdgeInsertIndex = (coords: LatLng[], point: LatLng, closed: boolean) => {
  const k = Math.cos((point.lat * Math.PI) / 180);
  const toXY = (p: LatLng) => ({ x: p.lng * k, y: p.lat });
  const target = toXY(point);
  let best = coords.length;
  let bestDistance = Infinity;
  const edges = closed ? coords.length : coords.length - 1;
  for (let i = 0; i < edges; i++) {
    const a = toXY(coords[i]!);
    const b = toXY(coords[(i + 1) % coords.length]!);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / len));
    const distance = Math.hypot(target.x - (a.x + t * dx), target.y - (a.y + t * dy));
    if (distance < bestDistance) { bestDistance = distance; best = i + 1; }
  }
  return best;
};

/** Vértice editável: círculo branco; o selecionado fica laranja e maior. */
const editVertexSvg = (selected: boolean) => {
  const px = selected ? 24 : 18;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="${selected ? "#f97316" : "#ffffff"}" stroke="${selected ? "#ffffff" : "#f59e0b"}" stroke-width="3"/></svg>`;
};

const geometrySignature = (node: Extract<GeoNode, { kind: "marker" | "polygon" | "path" }>, selected: boolean) =>
  JSON.stringify({
    kind: node.kind,
    name: node.name,
    coords: node.coords,
    style: node.style,
    selected,
  });

/**
 * Visualizador 3D do Terra Web.
 *
 * Mantém uma única instância do Map3DElement e atualiza os overlays por ID.
 * A câmera permite rotação horizontal livre; o botão de bússola retorna ao norte.
 */
export function Map3DView({
  nodes,
  filter,
  selectedId,
  initialCenter,
  initialZoom,
  focusRequest,
  onSelect,
  onUpdate,
  onCenterChange,
  mode = "none",
  draft,
  mapType,
  liveMarker,
  onCreateMarker,
  onExitMarkerMode,
  onDraftPoint,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const libraryRef = useRef<any>(null);
  const overlaysRef = useRef(new Map<string, OverlayRecord>());
  const centerListenerRef = useRef<(() => void) | null>(null);
  const onSelectRef = useRef(onSelect);
  const onUpdateRef = useRef(onUpdate);
  const dragMarkerRef = useRef<{
    id: string;
    element: any;
    pointerId: number;
    position: LatLng;
    previousGestureHandling: any;
  } | null>(null);
  const onCenterChangeRef = useRef(onCenterChange);
  const modeRef = useRef(mode);
  const onCreateMarkerRef = useRef(onCreateMarker);
  const onExitMarkerModeRef = useRef(onExitMarkerMode);
  const markerClickTsRef = useRef(0);
  const onDraftPointRef = useRef(onDraftPoint);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [cameraRange, setCameraRange] = useState(20_000_000);
  const [cameraTilt, setCameraTilt] = useState(62);
  const [cameraHeading, setCameraHeading] = useState(0);
  const altitudeRef = useRef<HTMLDivElement>(null);
  const [cameraMoving, setCameraMoving] = useState(false);
  const movingTimerRef = useRef<number | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const moveIdRef = useRef<string | null>(null);
  moveIdRef.current = moveId;
  const [editId, setEditId] = useState<string | null>(null);
  const [editVertex, setEditVertex] = useState<number | null>(null);
  const [insertArm, setInsertArm] = useState(false);
  const editIdRef = useRef<string | null>(null);
  const editVertexRef = useRef<number | null>(null);
  const insertArmRef = useRef(false);
  const vertexClickTsRef = useRef(0);
  const nodesLiveRef = useRef(nodes);
  editIdRef.current = editId;
  editVertexRef.current = editVertex;
  insertArmRef.current = insertArm;
  nodesLiveRef.current = nodes;
  const editNode = editId ? nodes.find((node) => node.id === editId) : null;
  const editShape: FeatureNode | null =
    editNode && isFeature(editNode) && (editNode.kind === "polygon" || editNode.kind === "path") ? editNode : null;

  onSelectRef.current = onSelect;
  onUpdateRef.current = onUpdate;
  onCenterChangeRef.current = onCenterChange;
  modeRef.current = mode;
  onCreateMarkerRef.current = onCreateMarker;
  onExitMarkerModeRef.current = onExitMarkerMode;
  onDraftPointRef.current = onDraftPoint;

  useEffect(() => {
    let cancelled = false;
    let map: any;

    const handleMapError = () => {
      if (cancelled) return;
      setError("O Google Maps 3D não conseguiu carregar esta região. Verifique a cobertura 3D, a chave e as permissões da API.");
      setStatus("error");
    };

    const handleMapIdError = () => {
      if (cancelled) return;
      setError("O Map ID configurado não é válido ou não está habilitado para o Google Maps 3D.");
      setStatus("error");
    };

    const init = async () => {
      try {
        const g = (window as any).google;
        if (!g?.maps?.importLibrary || !hostRef.current) {
          throw new Error("Google Maps ainda não foi carregado.");
        }

        const lib = await g.maps.importLibrary("maps3d");
        if (cancelled || !hostRef.current) return;

        libraryRef.current = lib;
        const Map3DElement = lib.Map3DElement;
        if (!Map3DElement) throw new Error("A biblioteca 3D não está disponível para esta chave/API.");

        const mapId = import.meta.env["VITE_GOOGLE_MAP_ID"] || undefined;
        map = new Map3DElement({
          center: { ...initialCenter, altitude: 0 },
          range: rangeFromZoom(initialZoom),
          tilt: initialZoom >= 14 ? 62 : 35,
          heading: 0,
          roll: 0,
          minTilt: 0,
          maxTilt: 85,
          mode: "HYBRID",
          gestureHandling: "GREEDY",
          qualityMode: "PERFORMANCE",
          defaultUIHidden: false,
          ...(mapId ? { mapId } : {}),
        });

        map.style.width = "100%";
        map.style.height = "100%";
        map.style.display = "block";
        map.style.background = "#0b1720";
        map.addEventListener("gmp-error", handleMapError);
        map.addEventListener("gmp-map-id-error", handleMapIdError);

        // Em movimento (arrastar, zoom, girar): os títulos somem e voltam quando a câmera para.
        const markMoving = () => {
          setCameraMoving((previous) => (previous ? previous : true));
          if (movingTimerRef.current !== null) window.clearTimeout(movingTimerRef.current);
          movingTimerRef.current = window.setTimeout(() => {
            movingTimerRef.current = null;
            setCameraMoving(false);
          }, MOVING_SETTLE_MS);
        };
        const syncCenter = () => {
          markMoving();
          const center = map.center;
          if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
            onCenterChangeRef.current?.({ lat: center.lat, lng: center.lng });
          }
        };
        map.addEventListener("gmp-centerchange", syncCenter);
        centerListenerRef.current = syncCenter;
        const syncRange = () => {
          const view = readCameraView(map);
          if (view.range !== null) {
            const next = quantizeRange(view.range);
            setCameraRange((previous) => (previous === next ? previous : next));
          }
          if (view.tilt !== null) {
            const next = Math.round(view.tilt / 5) * 5;
            setCameraTilt((previous) => (previous === next ? previous : next));
          }
          if (view.heading !== null) {
            const next = (Math.round(view.heading / 15) * 15) % 360;
            setCameraHeading((previous) => (previous === next ? previous : next));
          }
          // Altitude do ponto de visão (como o rodapé do Earth Pro), sem re-render.
          if (altitudeRef.current && view.range !== null) {
            const altitude = view.range * Math.cos(((view.tilt ?? 0) * Math.PI) / 180);
            altitudeRef.current.textContent = `Altitude do ponto de visão ${formatAltitude(altitude)}`;
          }
        };
        const onCameraEvent = () => { markMoving(); syncRange(); };
        map.addEventListener("gmp-rangechange", onCameraEvent);
        map.addEventListener("gmp-tiltchange", onCameraEvent);
        map.addEventListener("gmp-headingchange", onCameraEvent);
        (map as any).__terraSyncRange = onCameraEvent;
        (map as any).__terraReadView = syncRange;
        const handleMapClick = (event: any) => {
          const raw = event?.position ?? event?.detail?.position ?? event?.latLngAltitude ?? event?.detail?.latLngAltitude;
          if (!raw) return;
          const point = { lat: Number(raw.lat), lng: Number(raw.lng) };
          if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
          const moving = moveIdRef.current;
          if (moving) {
            // Reposiciona a CTO no ponto clicado; a coordenada é gravada pelo mesmo reducer.
            setMoveId(null);
            onUpdateRef.current(moving, { coords: [point] });
            return;
          }
          if (editIdRef.current) {
            // Edição de vértices: move o vértice selecionado ou insere um ponto na aresta mais próxima.
            // O clique espera um instante para ignorar o clique que apenas selecionou um vértice.
            const clickedAt = performance.now();
            if (clickedAt - vertexClickTsRef.current < 300) return;
            window.setTimeout(() => {
              if (Math.abs(vertexClickTsRef.current - clickedAt) < 300) return;
              const id = editIdRef.current;
              const shape = nodesLiveRef.current.find((node) => node.id === id);
              if (!id || !shape || (shape.kind !== "polygon" && shape.kind !== "path")) return;
              const coords = shape.coords;
              if (insertArmRef.current) {
                const at = nearestEdgeInsertIndex(coords, point, shape.kind === "polygon");
                onUpdateRef.current(id, { coords: [...coords.slice(0, at), point, ...coords.slice(at)] });
                setInsertArm(false);
                setEditVertex(at);
              } else if (editVertexRef.current !== null) {
                const index = editVertexRef.current;
                onUpdateRef.current(id, { coords: coords.map((c, i) => (i === index ? point : c)) });
              }
            }, 100);
            return;
          }
          const active = modeRef.current;
          if (active === "marker") {
            // Se o clique também atingiu uma CTO existente, seleciona-a em vez de criar outra.
            // A criação espera um instante para cobrir qualquer ordem entre os dois eventos.
            const clickedAt = performance.now();
            if (clickedAt - markerClickTsRef.current < 300) return;
            window.setTimeout(() => {
              if (Math.abs(markerClickTsRef.current - clickedAt) < 300) return;
              if (modeRef.current === "marker") onCreateMarkerRef.current?.(point);
            }, 100);
          }
          else if (active === "polygon" || active === "path" || active === "ruler") onDraftPointRef.current?.(point);
        };
        map.addEventListener("gmp-click", handleMapClick);
        (map as any).__terraHandleMapClick = handleMapClick;
        hostRef.current.replaceChildren(map);
        mapRef.current = map;
        syncCenter();
        if (!cancelled) setStatus("ready");
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Não foi possível inicializar o mapa 3D.");
          setStatus("error");
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
      overlaysRef.current.forEach(({ element }) => element.remove?.());
      overlaysRef.current.clear();
      map?.removeEventListener?.("gmp-error", handleMapError);
      map?.removeEventListener?.("gmp-map-id-error", handleMapIdError);
      if ((map as any)?.__terraHandleMapClick) map.removeEventListener?.("gmp-click", (map as any).__terraHandleMapClick);
      if (centerListenerRef.current) map?.removeEventListener?.("gmp-centerchange", centerListenerRef.current);
      if ((map as any)?.__terraSyncRange) {
        map.removeEventListener?.("gmp-rangechange", (map as any).__terraSyncRange);
        map.removeEventListener?.("gmp-tiltchange", (map as any).__terraSyncRange);
        map.removeEventListener?.("gmp-headingchange", (map as any).__terraSyncRange);
      }
      centerListenerRef.current = null;
      if (movingTimerRef.current !== null) window.clearTimeout(movingTimerRef.current);
      mapRef.current = null;
      libraryRef.current = null;
      hostRef.current?.replaceChildren();
    };
    // A instância e a câmera são inicializadas uma única vez por montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Finaliza o arraste de um marcador sem transformar o gesto em navegação da câmera.
  useEffect(() => {
    const finish = (event: PointerEvent) => {
      const drag = dragMarkerRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragMarkerRef.current = null;
      const activeMap = mapRef.current;
      if (activeMap && drag.previousGestureHandling != null) {
        activeMap.gestureHandling = drag.previousGestureHandling;
      }
      onUpdateRef.current(drag.id, { coords: [drag.position] });
    };
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    return () => {
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
    };
  }, []);

  useEffect(() => {
    if (!liveMarker) return;
    const record = overlaysRef.current.get(liveMarker.id);
    if (record?.kind === "marker") record.element.position = { lat: liveMarker.pos.lat, lng: liveMarker.pos.lng, altitude: 0 };
  }, [liveMarker]);

  // Vértices editáveis do polígono/caminho selecionado (sem criar elementos duplicados no
  // desenho final: são marcadores temporários removidos ao concluir).
  const editCoordsKey = editShape ? JSON.stringify(editShape.coords) : "";
  useEffect(() => {
    const map = mapRef.current;
    const lib = libraryRef.current;
    if (!map || !lib || status !== "ready" || !editShape) return;
    const PointClass = lib.Marker3DInteractiveElement || lib.Marker3DElement;
    if (!PointClass) return;
    const created: any[] = [];
    editShape.coords.forEach((point, index) => {
      const vertex = new PointClass();
      vertex.position = { lat: point.lat, lng: point.lng, altitude: 0 };
      vertex.sizePreserved = true;
      vertex.drawsWhenOccluded = true;
      vertex.collisionBehavior = "REQUIRED";
      vertex.zIndex = index === editVertex ? 30001 : 30000;
      const template = document.createElement("template");
      template.innerHTML = editVertexSvg(index === editVertex);
      vertex.append(template);
      vertex.addEventListener?.("gmp-click", () => {
        vertexClickTsRef.current = performance.now();
        setInsertArm(false);
        setEditVertex(index);
      });
      map.append(vertex);
      created.push(vertex);
    });
    return () => created.forEach((element) => element.remove?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCoordsKey, editVertex, status, editId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    map.mode = mapType === "satellite" ? "SATELLITE" : "HYBRID";
  }, [mapType, status]);

  // Rascunho durante a criação (polígono, caminho, régua): linha/área amarela e
  // vértices brancos, como no mapa 2D. Usa elementos não interativos para que os
  // cliques continuem chegando ao mapa.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libraryRef.current;
    if (!map || !lib || status !== "ready") return;
    if (!draft || draft.length === 0) return;
    if (mode !== "polygon" && mode !== "path" && mode !== "ruler") return;

    const LineClass = lib.Polyline3DElement || lib.Polyline3DInteractiveElement;
    const PolyClass = lib.Polygon3DElement || lib.Polygon3DInteractiveElement;
    const PointClass = lib.Marker3DElement || lib.Marker3DInteractiveElement;
    const path = draft.map((point) => ({ lat: point.lat, lng: point.lng, altitude: 0 }));
    const color = mode === "ruler" ? "#f43f5e" : "#facc15";
    const created: any[] = [];

    if (mode === "polygon" && draft.length >= 3 && PolyClass) {
      const area = new PolyClass();
      area.path = path;
      area.strokeColor = color;
      area.strokeWidth = 3;
      area.fillColor = toRgba("#facc15", 0.2);
      area.drawsOccludedSegments = true;
      area.geodesic = true;
      area.zIndex = 20000;
      map.append(area);
      created.push(area);
    } else if (draft.length >= 2 && LineClass) {
      const line = new LineClass();
      line.path = path;
      line.strokeColor = color;
      line.strokeWidth = 3;
      line.drawsOccludedSegments = true;
      line.geodesic = true;
      line.zIndex = 20000;
      map.append(line);
      created.push(line);
    }

    if (PointClass) {
      draft.forEach((point, index) => {
        const vertex = new PointClass();
        vertex.position = { lat: point.lat, lng: point.lng, altitude: 0 };
        vertex.sizePreserved = true;
        vertex.drawsWhenOccluded = true;
        vertex.collisionBehavior = "REQUIRED";
        vertex.zIndex = 20001;
        const template = document.createElement("template");
        template.innerHTML = draftVertexSvg(index === draft.length - 1);
        vertex.append(template);
        map.append(vertex);
        created.push(vertex);
      });
    }

    return () => created.forEach((element) => element.remove?.());
  }, [draft, mode, status]);

  // Sincroniza somente os objetos que realmente mudaram.
  // Selecionar um item não desmonta centenas de outros marcadores.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libraryRef.current;
    if (!map || !lib) return;

    const markerClass = lib.Marker3DInteractiveElement || lib.Marker3DElement;
    const polygonClass = lib.Polygon3DInteractiveElement || lib.Polygon3DElement;
    const lineClass = lib.Polyline3DInteractiveElement || lib.Polyline3DElement;
    const liveIds = new Set<string>();
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const altitude = cameraRange * Math.cos((cameraTilt * Math.PI) / 180);
    const markerStride = markerStrideFromAltitude(altitude);
    const iconZoomFactor = iconScaleFromAltitude(altitude);
    let markerIndex = 0;

    const isVisible = (node: Extract<GeoNode, { kind: "marker" | "polygon" | "path" }>) => {
      if (!node.visible || !passesFilter(node, filter)) return false;
      let parent = node.parentId ? nodesById.get(node.parentId) : undefined;
      while (parent) {
        if (!parent.visible) return false;
        parent = parent.parentId ? nodesById.get(parent.parentId) : undefined;
      }
      return true;
    };

    // Títulos: lado alternado e sem colisão (só abaixo da altitude limite).
    let labelPlan = new Map<string, "l" | "r" | null>();
    const hideWhileMoving = cameraMoving && altitude > ALWAYS_LABELS_ALTITUDE;
    if (altitude < LABEL_MAX_ALTITUDE && !hideWhileMoving) {
      const items: LabelItem[] = [];
      let planIndex = 0;
      for (const node of nodes) {
        if (!isFeature(node) || node.kind !== "marker" || !isVisible(node)) continue;
        const isSelected = node.id === selectedId;
        const shown = isSelected || planIndex % markerStride === 0;
        planIndex += 1;
        const point = node.coords[0];
        if (!shown || !point || !node.name?.trim()) continue;
        items.push({ id: node.id, lat: point.lat, lng: point.lng, name: node.name, selected: isSelected, px: iconPx(node.style, isSelected, iconZoomFactor) });
      }
      labelPlan = planLabels(items, {
        range: cameraRange,
        tilt: cameraTilt,
        heading: cameraHeading,
        height: hostRef.current?.clientHeight ?? 0,
        showAll: altitude <= ALL_LABELS_ALTITUDE,
      });
    }

    for (const node of nodes) {
      if (!isFeature(node)) continue;
      if (!isVisible(node)) continue;

      liveIds.add(node.id);
      const selected = node.id === selectedId;
      const existing = overlaysRef.current.get(node.id);
      let markerVisible = true;
      if (node.kind === "marker") {
        markerVisible = selected || markerIndex % markerStride === 0;
        markerIndex += 1;
        // Não desmonta o marcador: apenas alterna a apresentação, mantendo
        // seleção, arraste geográfico e identidade do elemento intactos.
        if (existing?.kind === "marker") {
          existing.element.style.display = markerVisible ? "" : "none";
        }
      }
      const markerSide = node.kind === "marker" ? labelPlan.get(node.id) ?? null : null;
      const signature = geometrySignature(node, selected) + (node.kind === "marker" ? `|${markerSide}|${selected ? 1 : iconZoomFactor}` : "");

      if (existing && existing.kind === node.kind && existing.signature === signature) {
        continue;
      }

      const coords = node.coords.map((point) => ({
        lat: point.lat,
        lng: point.lng,
        altitude: 0,
      }));

      let record = existing;

      if (!record || record.kind !== node.kind) {
        record?.element.remove?.();

        let element: any;
        if (node.kind === "marker" && markerClass) {
          element = new markerClass();
          element.addEventListener?.("gmp-click", () => {
            if (modeRef.current === "marker") {
              // Clique sobre CTO existente no modo Marcador: seleciona e volta a Navegar.
              markerClickTsRef.current = performance.now();
              onSelectRef.current(node.id);
              onExitMarkerModeRef.current?.();
              return;
            }
            if (modeRef.current !== "none") return;
            if (!dragMarkerRef.current) onSelectRef.current(node.id);
          });
          // O evento gmp-pointermove fornece a coordenada geográfica real sob o cursor.
          element.addEventListener?.("pointerdown", (event: PointerEvent) => {
            if (event.button !== 0 || modeRef.current !== "none") return;
            event.preventDefault();
            event.stopPropagation();
            onSelectRef.current(node.id);

            const current = element.position;
            if (!current) return;

            const activeMap = mapRef.current;
            const previousGestureHandling = activeMap?.gestureHandling;
            // Durante o arraste, reduzimos a captura de gestos da câmera.
            // O ponteiro também fica capturado pelo marcador até o pointerup.
            if (activeMap) activeMap.gestureHandling = "COOPERATIVE";
            try {
              element.setPointerCapture?.(event.pointerId);
            } catch {
              // Alguns builds do elemento 3D não expõem Pointer Capture.
            }

            dragMarkerRef.current = {
              id: node.id,
              element,
              pointerId: event.pointerId,
              previousGestureHandling,
              position: { lat: Number(current.lat), lng: Number(current.lng) },
            };
          });
          element.addEventListener?.("gmp-pointermove", (event: any) => {
            const drag = dragMarkerRef.current;
            if (!drag || drag.id !== node.id) return;

            // A API 3D pode entregar a posição em event.position ou detail.position,
            // dependendo da versão do Maps/encapsulamento do evento.
            const position =
              event?.position ??
              event?.detail?.position ??
              event?.latLngAltitude ??
              event?.detail?.latLngAltitude;

            if (!position) return;

            const next = {
              lat: Number(position.lat),
              lng: Number(position.lng),
            };
            if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return;

            drag.position = next;
            drag.element.position = { ...next, altitude: 0 };
          });
        } else if (node.kind === "polygon" && polygonClass) {
          element = new polygonClass();
          element.addEventListener?.("gmp-click", () => { if (modeRef.current === "none") onSelectRef.current(node.id); });
        } else if (node.kind === "path" && lineClass) {
          element = new lineClass();
          element.addEventListener?.("gmp-click", () => { if (modeRef.current === "none") onSelectRef.current(node.id); });
        }

        if (!element) {
          overlaysRef.current.delete(node.id);
          continue;
        }

        map.append(element);
        record = { kind: node.kind, element, signature: "" };
        overlaysRef.current.set(node.id, record);
      }

      const element = record.element;
      const style = node.style;

      if (node.kind === "marker") {
        element.position = coords[0];
        element.title = node.name || "Marcador";
        element.drawsWhenOccluded = true;
        // REQUIRED: o Google não esconde CTOs por colisão (a largura do SVG inclui o título e fazia
        // marcadores vizinhos sumirem). A limpeza de títulos é feita por planLabels.
        element.collisionBehavior = "REQUIRED";
        // Marcadores sempre acima de polígonos e caminhos (máx. 10000), inclusive do selecionado,
        // para que o clique sobre a CTO não seja capturado pela área do polígono.
        element.zIndex = selected ? 15000 : 12000;

        // Destaque persistente: o ícone (SVG) é recriado com o estilo de seleção do 2D.
        element.sizePreserved = true;
        applyMarkerContent(element, style, selected, node.name || "", markerSide, iconZoomFactor);
        element.style.cursor = selected ? "grab" : "pointer";
        element.style.display = markerVisible ? "" : "none";
      } else if (node.kind === "polygon") {
        // Polygon3D não oferece fillOpacity/strokeOpacity.
        // A transparência é aplicada no próprio valor CSS da cor.
        element.path = coords;
        element.strokeColor = toRgba(selected ? "#facc15" : style.color, selected ? 1 : style.strokeOpacity);
        element.strokeWidth = selected ? 3 : style.strokeWidth;
        element.fillColor = toRgba(style.fillColor, style.fillOpacity);
        element.drawsOccludedSegments = true;
        element.geodesic = true;
        element.zIndex = selected ? 10000 : 1;
      } else {
        element.path = coords;
        element.strokeColor = toRgba(selected ? "#facc15" : style.color, selected ? 1 : style.strokeOpacity);
        element.strokeWidth = selected ? Math.max(7, style.strokeWidth + 4) : style.strokeWidth;
        element.drawsOccludedSegments = true;
        element.geodesic = true;
        element.zIndex = selected ? 10000 : 1;
      }

      record.signature = signature;
    }

    // Remove apenas os elementos excluídos ou ocultados.
    for (const [id, record] of overlaysRef.current) {
      if (!liveIds.has(id)) {
        record.element.remove?.();
        overlaysRef.current.delete(id);
      }
    }
  }, [nodes, filter, selectedId, cameraRange, cameraTilt, cameraHeading, cameraMoving]);

  useEffect(() => {
    if (moveId && (moveId !== selectedId || mode !== "none")) setMoveId(null);
  }, [moveId, selectedId, mode]);

  useEffect(() => {
    if (editId && (editId !== selectedId || mode !== "none")) { setEditId(null); setEditVertex(null); setInsertArm(false); }
  }, [editId, selectedId, mode]);

  useEffect(() => {
    if (!editId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setEditId(null); setEditVertex(null); setInsertArm(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editId]);

  useEffect(() => {
    if (!moveId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMoveId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (map as any).__terraReadView?.();
  }, [status]);

  useEffect(() => {
    if (!focusRequest || !mapRef.current) return;

    const map = mapRef.current;
    map.stopCameraAnimation?.();
    map.flyCameraTo?.({
      endCamera: {
        center: { ...focusRequest.center, altitude: 0 },
        range: 900,
        tilt: 65,
        heading: Number.isFinite(map.heading) ? map.heading : 0,
        roll: Number.isFinite(map.roll) ? map.roll : 0,
      },
      durationMillis: 1800,
    });
  }, [focusRequest]);

  const resetNorth = () => {
    const map = mapRef.current;
    if (!map) return;

    map.stopCameraAnimation?.();
    map.flyCameraTo?.({
      endCamera: {
        center: map.center,
        range: map.range,
        tilt: map.tilt,
        heading: 0,
        roll: 0,
      },
      durationMillis: 700,
    });
  };

  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;

    map.stopCameraAnimation?.();
    map.flyCameraTo?.({
      endCamera: {
        center: { ...initialCenter, altitude: 0 },
        range: rangeFromZoom(initialZoom),
        tilt: initialZoom >= 14 ? 62 : 35,
        heading: 0,
        roll: 0,
      },
      durationMillis: 1200,
    });
  };

  const selectedShape = nodes.find((node) => node.id === selectedId && (node.kind === "polygon" || node.kind === "path")) ?? null;
  const selectedMarker = nodes.find((node) => node.id === selectedId && node.kind === "marker") ?? null;

  return (
    <div className="absolute inset-0">
      <div ref={hostRef} className="absolute inset-0" />

      <div
        ref={altitudeRef}
        className="pointer-events-none absolute bottom-12 right-3 z-10 rounded-md px-2 py-1 font-mono text-xs"
        style={{ background: "var(--glass)" }}
      />

      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-card/90 p-1 shadow-lg backdrop-blur">
        <button className="earth-icon-btn" title="Alinhar câmera ao norte" aria-label="Alinhar câmera ao norte" onClick={resetNorth}>
          <Compass className="size-4" />
        </button>
        <button className="earth-icon-btn" title="Voltar à visão inicial" onClick={resetView}>
          <LocateFixed className="size-4" />
        </button>
      </div>

      {selectedMarker && mode === "none" && (
        <div className="absolute bottom-6 left-1/2 z-20 max-w-[92%] -translate-x-1/2">
          {moveId ? (
            <button className="rounded-lg border border-yellow-400 bg-card/95 px-3 py-2 text-sm font-medium shadow-lg backdrop-blur" onClick={() => setMoveId(null)}>
              Clique no mapa para posicionar a CTO · Cancelar (Esc)
            </button>
          ) : (
            <button className="rounded-lg border border-border bg-card/90 px-3 py-2 text-sm shadow-lg backdrop-blur hover:border-yellow-400" onClick={() => setMoveId(selectedMarker.id)}>
              Mover CTO selecionada
            </button>
          )}
        </div>
      )}

      {!editId && selectedShape && mode === "none" && (
        <div className="absolute bottom-6 left-1/2 z-20 max-w-[92%] -translate-x-1/2">
          <button className="rounded-lg border border-border bg-card/90 px-3 py-2 text-sm shadow-lg backdrop-blur hover:border-yellow-400" onClick={() => { setMoveId(null); setEditId(selectedShape.id); setEditVertex(null); }}>
            Editar vértices
          </button>
        </div>
      )}

      {editShape && mode === "none" && (
        <div className="absolute bottom-6 left-1/2 z-20 flex max-w-[92%] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-lg border border-yellow-400 bg-card/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
          <span>
            {insertArm ? "Clique no mapa para inserir o ponto" : editVertex === null ? "Clique em um vértice para selecioná-lo" : "Clique no mapa para mover o vértice"}
          </span>
          <button className={`rounded border px-2 py-1 ${insertArm ? "border-yellow-400 bg-yellow-400 text-black" : "border-border"}`} onClick={() => setInsertArm((v) => !v)}>
            + Inserir ponto
          </button>
          <button
            className="rounded border border-border px-2 py-1 disabled:opacity-40"
            disabled={editVertex === null || editShape.coords.length <= (editShape.kind === "polygon" ? 3 : 2)}
            onClick={() => {
              if (editVertex === null) return;
              onUpdate(editShape.id, { coords: editShape.coords.filter((_, i) => i !== editVertex) });
              setEditVertex(null);
            }}
          >
            Remover vértice
          </button>
          <button className="rounded border border-border px-2 py-1" onClick={() => { setEditId(null); setEditVertex(null); setInsertArm(false); }}>
            Concluir (Esc)
          </button>
        </div>
      )}

      {status === "loading" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm text-foreground backdrop-blur-sm">
          <LoaderCircle className="mr-2 size-4 animate-spin" /> Inicializando navegação 3D…
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-x-4 top-20 z-20 mx-auto max-w-xl rounded-lg border border-destructive/50 bg-card p-4 text-sm shadow-xl">
          <strong className="text-destructive">Mapa 3D indisponível</strong>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            O modo 2D continua disponível. Confira a ativação da Maps JavaScript API, o faturamento,
            a cobertura da região e as restrições da chave.
          </p>
        </div>
      )}
    </div>
  );
}