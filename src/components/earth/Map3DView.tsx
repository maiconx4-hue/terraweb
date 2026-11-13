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
  draft?: LatLng[];
  onMapPoint?: (point: LatLng) => void;
  mapStyle?: "hybrid" | "satellite";
};

type OverlayRecord = {
  kind: "marker" | "polygon" | "path";
  element: any;
  signature: string;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

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
  draft = [],
  onMapPoint,
  mapStyle = "hybrid",
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const libraryRef = useRef<any>(null);
  const overlaysRef = useRef(new Map<string, OverlayRecord>());
  const centerListenerRef = useRef<(() => void) | null>(null);
  const onSelectRef = useRef(onSelect);
  const onUpdateRef = useRef(onUpdate);
  const dragMarkerRef = useRef<{ id: string; element: any; pointerId: number; position: LatLng } | null>(null);
  const onCenterChangeRef = useRef(onCenterChange);
  const onMapPointRef = useRef(onMapPoint);
  const modeRef = useRef(mode);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  onSelectRef.current = onSelect;
  onUpdateRef.current = onUpdate;
  onCenterChangeRef.current = onCenterChange;
  onMapPointRef.current = onMapPoint;
  modeRef.current = mode;

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
          mode: mapStyle.toUpperCase(),
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
        const handleMapClick = (event: any) => {
          const position = event?.position;
          if (!position || modeRef.current === "none") return;
          const point = { lat: Number(position.lat), lng: Number(position.lng) };
          if (Number.isFinite(point.lat) && Number.isFinite(point.lng)) onMapPointRef.current?.(point);
        };
        map.addEventListener("gmp-click", handleMapClick);
        (map as any).__terraClickListener = handleMapClick;
        centerListenerRef.current = syncCenter;
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
      ((map as any)?.__terraDraft ?? []).forEach((element: any) => element.remove?.());
      overlaysRef.current.clear();
      map?.removeEventListener?.("gmp-error", handleMapError);
      map?.removeEventListener?.("gmp-map-id-error", handleMapIdError);
      if ((map as any)?.__terraClickListener) map.removeEventListener?.("gmp-click", (map as any).__terraClickListener);
      if (centerListenerRef.current) map?.removeEventListener?.("gmp-centerchange", centerListenerRef.current);
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
      onUpdateRef.current(drag.id, { coords: [drag.position] });
    };
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    return () => {
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
    };
  }, []);

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
      const signature = geometrySignature(node, selected);
      const existing = overlaysRef.current.get(node.id);

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
          element.addEventListener?.("gmp-click", (event: Event) => {
            event.stopPropagation();
            if (!dragMarkerRef.current) onSelectRef.current(node.id);
          });
          // O evento gmp-pointermove fornece a coordenada geográfica real sob o cursor.
          element.addEventListener?.("pointerdown", (event: PointerEvent) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            onSelectRef.current(node.id);
            const current = element.position;
            if (!current) return;
            dragMarkerRef.current = {
              id: node.id, element, pointerId: event.pointerId,
              position: { lat: Number(current.lat), lng: Number(current.lng) },
            };
          });
          element.addEventListener?.("gmp-pointermove", (event: any) => {
            const drag = dragMarkerRef.current;
            const position = event.position;
            if (!drag || drag.id !== node.id || !position) return;
            const next = { lat: Number(position.lat), lng: Number(position.lng) };
            if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return;
            drag.position = next;
            drag.element.position = { ...next, altitude: 0 };
          });
        } else if (node.kind === "polygon" && polygonClass) {
          element = new polygonClass();
          element.addEventListener?.("gmp-click", (event: Event) => { event.stopPropagation(); onSelectRef.current(node.id); });
        } else if (node.kind === "path" && lineClass) {
          element = new lineClass();
          element.addEventListener?.("gmp-click", (event: Event) => { event.stopPropagation(); onSelectRef.current(node.id); });
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
        if (dragMarkerRef.current?.id !== node.id) element.position = coords[0];
        element.label = node.name || "Marcador";
        element.title = node.name || "Marcador";
        element.drawsWhenOccluded = true;
        element.collisionBehavior = "OPTIONAL_AND_HIDES_LOWER_PRIORITY";
        element.zIndex = selected ? 10000 : 1;
        element.style.filter = selected ? "drop-shadow(0 0 5px #facc15) drop-shadow(0 0 2px #facc15)" : "none";
        element.style.cursor = "grab";
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
  }, [nodes, filter, selectedId]);

  useEffect(() => {
    if (mapRef.current) mapRef.current.mode = mapStyle.toUpperCase();
  }, [mapStyle]);

  // Pré-visualização dos desenhos em andamento no próprio mapa 3D.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libraryRef.current;
    if (!map || !lib) return;
    const previous = (map as any).__terraDraft as any[] | undefined;
    previous?.forEach((element) => element.remove?.());
    (map as any).__terraDraft = [];
    if (!draft.length) return;
    const path = draft.map((point) => ({ ...point, altitude: 0 }));
    const lineClass = lib.Polyline3DElement;
    const polygonClass = lib.Polygon3DElement;
    const line = new lineClass({
      path,
      strokeColor: mode === "ruler" ? "#f43f5e" : "#facc15",
      strokeWidth: 3,
      drawsOccludedSegments: true,
      geodesic: true,
    });
    map.append(line);
    (map as any).__terraDraft.push(line);
    if (mode === "polygon" && path.length >= 3 && polygonClass) {
      const polygon = new polygonClass({
        path,
        strokeColor: "#facc15",
        strokeWidth: 2,
        fillColor: "rgba(250, 204, 21, 0.22)",
        drawsOccludedSegments: true,
        geodesic: true,
      });
      map.append(polygon);
      (map as any).__terraDraft.push(polygon);
    }
  }, [draft, mode, status]);

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
