/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { Compass, LocateFixed, LoaderCircle } from "lucide-react";
import { isFeature, passesFilter, type Filter, type GeoNode, type LatLng } from "@/lib/geo/types";

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
  onCreateMarker?: (point: LatLng) => void;
  onDraftPoint?: (point: LatLng) => void;
};

type OverlayRecord = {
  kind: "marker" | "polygon" | "path";
  element: any;
  signature: string;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Quantos marcadores alternados manter conforme a distância da câmera (metros). */
const markerStrideFromRange = (range: number) => {
  if (range < 2_500) return 1;       // visão próxima: todos
  if (range < 8_000) return 2;       // aproximação: 1 a cada 2
  if (range < 20_000) return 4;      // bairro: 1 a cada 4
  if (range < 60_000) return 8;      // cidade: 1 a cada 8
  if (range < 150_000) return 16;   // regional: 1 a cada 16
  return 32;                        // visão muito distante: 1 a cada 32
};

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
  onCreateMarker,
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
  const onDraftPointRef = useRef(onDraftPoint);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [cameraRange, setCameraRange] = useState(20_000_000);

  onSelectRef.current = onSelect;
  onUpdateRef.current = onUpdate;
  onCenterChangeRef.current = onCenterChange;
  modeRef.current = mode;
  onCreateMarkerRef.current = onCreateMarker;
  onDraftPointRef.current = onDraftPoint;

  useEffect(() => {
    const styleId = "terra-cto-selection-pulse";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        @keyframes terra-cto-selection-pulse {
          0%, 100% { filter: drop-shadow(0 0 2px #facc15) drop-shadow(0 0 1px #facc15); }
          50% { filter: drop-shadow(0 0 11px #facc15) drop-shadow(0 0 6px #22d3ee); }
        }
      `;
      document.head.appendChild(style);
    }

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

        const syncCenter = () => {
          const center = map.center;
          if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
            onCenterChangeRef.current?.({ lat: center.lat, lng: center.lng });
          }
        };
        map.addEventListener("gmp-centerchange", syncCenter);
        centerListenerRef.current = syncCenter;
        const syncRange = () => {
          const nextRange = Number(map.range);
          if (Number.isFinite(nextRange) && nextRange > 0) {
            setCameraRange((previous) => previous === nextRange ? previous : nextRange);
          }
        };
        map.addEventListener("gmp-rangechange", syncRange);
        (map as any).__terraSyncRange = syncRange;
        const handleMapClick = (event: any) => {
          const raw = event?.position ?? event?.detail?.position ?? event?.latLngAltitude ?? event?.detail?.latLngAltitude;
          if (!raw) return;
          const point = { lat: Number(raw.lat), lng: Number(raw.lng) };
          if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
          const active = modeRef.current;
          if (active === "marker") onCreateMarkerRef.current?.(point);
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
      if ((map as any)?.__terraSyncRange) map.removeEventListener?.("gmp-rangechange", (map as any).__terraSyncRange);
      centerListenerRef.current = null;
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

  // Alças de edição dos vértices do polígono selecionado.
  // O Maps 3D não oferece a propriedade editable nativa; os handles usam
  // marcadores interativos e gravam a geometria no mesmo reducer compartilhado.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libraryRef.current;
    const selected = nodes.find((node) => node.id === selectedId && node.kind === "polygon");
    if (!map || !lib || !selected || mode !== "none") return;
    const Handle = lib.Marker3DInteractiveElement || lib.Marker3DElement;
    if (!Handle) return;

    const nextCoords = selected.coords.map((point) => ({ ...point }));
    const handles: any[] = [];
    let active: { index: number; pointerId: number; position: LatLng } | null = null;

    const finish = (event: PointerEvent) => {
      if (!active || active.pointerId !== event.pointerId) return;
      const edited = nextCoords.map((point, index) => index === active!.index ? active!.position : point);
      active = null;
      onUpdateRef.current(selected.id, { coords: edited } as Partial<GeoNode>);
    };

    nextCoords.forEach((point, index) => {
      const handle = new Handle();
      handle.position = { ...point, altitude: 2 };
      handle.label = "●";
      handle.title = `Vértice ${index + 1} — arraste para editar`;
      handle.sizePreserved = true;
      handle.drawsWhenOccluded = true;
      handle.zIndex = 20000;
      handle.style.cursor = "move";
      handle.addEventListener("pointerdown", (event: PointerEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        active = { index, pointerId: event.pointerId, position: { ...nextCoords[index]! } };
      });
      handle.addEventListener("gmp-pointermove", (event: any) => {
        if (!active || active.index !== index) return;
        const raw = event?.position ?? event?.detail?.position;
        if (!raw) return;
        const position = { lat: Number(raw.lat), lng: Number(raw.lng) };
        if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return;
        active.position = position;
        handle.position = { ...position, altitude: 2 };
        const live = nextCoords.map((coord, i) => i === index ? position : coord);
        const polygon = overlaysRef.current.get(selected.id)?.element;
        if (polygon) polygon.path = live.map((coord) => ({ ...coord, altitude: 0 }));
      });
      map.append(handle);
      handles.push(handle);
    });

    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    return () => {
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      handles.forEach((handle) => handle.remove?.());
    };
  }, [nodes, selectedId, mode]);

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
    const markerStride = markerStrideFromRange(cameraRange);
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
      const signature = geometrySignature(node, selected);

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
        element.label = node.name || "Marcador";
        element.title = node.name || "Marcador";
        element.drawsWhenOccluded = true;
        element.collisionBehavior = "OPTIONAL_AND_HIDES_LOWER_PRIORITY";
        element.zIndex = selected ? 10000 : 1;

        // Destaque persistente do CTO selecionado: halo amarelo/ciano,
        // leve ampliação e prioridade de renderização acima dos demais.
        element.sizePreserved = true;
        element.style.animation = selected
          ? "terra-cto-selection-pulse 1.15s ease-in-out infinite"
          : "none";
        element.style.transform = selected ? "scale(1.3)" : "scale(1)";
        element.style.transformOrigin = "center center";
        element.style.cursor = selected ? "grab" : "pointer";
        element.style.display = markerVisible ? "" : "none";
      } else if (node.kind === "polygon") {
        // Polygon3D não oferece fillOpacity/strokeOpacity.
        // A transparência é aplicada no próprio valor CSS da cor.
        element.path = coords;
        element.strokeColor = toRgba(selected ? "#facc15" : style.color, selected ? 1 : style.strokeOpacity);
        element.strokeWidth = selected ? Math.max(3, style.strokeWidth) : style.strokeWidth;
        element.fillColor = toRgba(style.fillColor, style.fillOpacity);
        element.drawsOccludedSegments = true;
        element.geodesic = true;
        element.zIndex = selected ? 10000 : 1;
      } else {
        element.path = coords;
        element.strokeColor = toRgba(selected ? "#facc15" : style.color, selected ? 1 : style.strokeOpacity);
        element.strokeWidth = selected ? Math.max(4, style.strokeWidth) : style.strokeWidth;
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
  }, [nodes, filter, selectedId, cameraRange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const currentRange = Number(map.range);
    if (Number.isFinite(currentRange) && currentRange > 0) setCameraRange(currentRange);
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

  return (
    <div className="absolute inset-0">
      <div ref={hostRef} className="absolute inset-0" />

      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-card/90 p-1 shadow-lg backdrop-blur">
        <button className="earth-icon-btn" title="Alinhar câmera ao norte" aria-label="Alinhar câmera ao norte" onClick={resetNorth}>
          <Compass className="size-4" />
        </button>
        <button className="earth-icon-btn" title="Voltar à visão inicial" onClick={resetView}>
          <LocateFixed className="size-4" />
        </button>
      </div>

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