/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { Compass, Orbit, LocateFixed, LoaderCircle } from "lucide-react";
import { isFeature, isShown, type Filter, type GeoNode, type LatLng } from "@/lib/geo/types";

type Props = {
  nodes: GeoNode[];
  filter: Filter;
  selectedId: string | null;
  initialCenter: LatLng;
  initialZoom: number;
  focusRequest?: { center: LatLng; nonce: number } | null;
  onSelect: (id: string) => void;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const rangeFromZoom = (zoom: number) => zoom <= 4 ? 20_000_000 : clamp(180 * 2 ** (18 - zoom), 350, 18_000_000);

/**
 * Mapa de exploração 3D. Os dados continuam no GeoNode compartilhado com o mapa 2D.
 * A edição de geometrias permanece no modo 2D; aqui os objetos são visualizados e selecionados.
 */
export function Map3DView({ nodes, filter, selectedId, initialCenter, initialZoom, focusRequest, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const libraryRef = useRef<any>(null);
  const overlayRef = useRef<any[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [orbiting, setOrbiting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: any;
    const init = async () => {
      try {
        const g = (window as any).google;
        if (!g?.maps?.importLibrary || !hostRef.current) throw new Error("Google Maps ainda não foi carregado.");
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
          mode: "HYBRID",
          gestureHandling: "GREEDY",
          defaultUIHidden: false,
          ...(mapId ? { mapId } : {}),
        });
        map.style.width = "100%";
        map.style.height = "100%";
        map.style.display = "block";
        map.style.background = "#0b1720";
        map.addEventListener("gmp-error", () => {
          if (!cancelled) {
            setError("O Google Maps 3D não conseguiu carregar esta região. Verifique a cobertura 3D, a chave e as permissões da API.");
            setStatus("error");
          }
        });
        map.addEventListener("gmp-map-id-error", () => {
          if (!cancelled) {
            setError("O Map ID configurado não é válido ou não está habilitado para o Google Maps 3D.");
            setStatus("error");
          }
        });
        hostRef.current.replaceChildren(map);
        mapRef.current = map;
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
      overlayRef.current.forEach((item) => item.remove?.());
      overlayRef.current = [];
      mapRef.current = null;
      libraryRef.current = null;
      hostRef.current?.replaceChildren();
    };
    // Inicialização única por montagem: a troca de dados não recria a câmera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualiza apenas os objetos geográficos; a instância e a câmera 3D são preservadas.
  useEffect(() => {
    const map = mapRef.current;
    const g = (window as any).google;
    if (!map || !g?.maps) return;
    overlayRef.current.forEach((item) => item.remove?.());
    overlayRef.current = [];
    const lib = libraryRef.current;
    const markerClass = lib?.Marker3DInteractiveElement || lib?.Marker3DElement;
    const polygonClass = lib?.Polygon3DInteractiveElement || lib?.Polygon3DElement;
    const lineClass = lib?.Polyline3DInteractiveElement || lib?.Polyline3DElement;

    for (const node of nodes) {
      if (!isFeature(node) || !isShown(nodes, node, filter)) continue;
      const selected = node.id === selectedId;
      let element: any;
      const coords = node.coords.map((p) => ({ lat: p.lat, lng: p.lng, altitude: 0 }));
      if (node.kind === "marker" && markerClass) {
        element = new markerClass({
          position: coords[0],
          label: node.name || "Marcador",
          title: node.name,
          drawsWhenOccluded: true,
          collisionBehavior: "OPTIONAL_AND_HIDES_LOWER_PRIORITY",
          zIndex: selected ? 10000 : 1,
        });
        if (element.addEventListener) element.addEventListener("gmp-click", () => onSelect(node.id));
      } else if (node.kind === "polygon" && polygonClass) {
        element = new polygonClass({
          outerCoordinates: coords,
          strokeColor: selected ? "#facc15" : node.style.color,
          strokeWidth: selected ? Math.max(3, node.style.strokeWidth) : node.style.strokeWidth,
          fillColor: node.style.fillColor,
          fillOpacity: node.style.fillOpacity,
          drawsOccludedSegments: true,
        });
        if (element.addEventListener) element.addEventListener("gmp-click", () => onSelect(node.id));
      } else if (node.kind === "path" && lineClass) {
        element = new lineClass({
          coordinates: coords,
          strokeColor: selected ? "#facc15" : node.style.color,
          strokeWidth: selected ? Math.max(4, node.style.strokeWidth) : node.style.strokeWidth,
          drawsOccludedSegments: true,
          geodesic: true,
        });
        if (element.addEventListener) element.addEventListener("gmp-click", () => onSelect(node.id));
      }
      if (element) {
        map.append(element);
        overlayRef.current.push(element);
      }
    }
    return () => {
      overlayRef.current.forEach((item) => item.remove?.());
      overlayRef.current = [];
    };
  }, [nodes, filter, selectedId, onSelect]);

  useEffect(() => {
    if (!focusRequest || !mapRef.current) return;
    mapRef.current.stopCameraAnimation?.();
    mapRef.current.flyCameraTo?.({
      endCamera: {
        center: { ...focusRequest.center, altitude: 0 },
        range: 900,
        tilt: 65,
        heading: mapRef.current.heading ?? 0,
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
      durationMillis: 900,
    });
  };

  const startOrbit = () => {
    const map = mapRef.current;
    if (!map) return;
    if (orbiting) {
      map.stopCameraAnimation?.();
      setOrbiting(false);
      return;
    }
    map.flyCameraAround?.({
      camera: {
        center: map.center,
        range: map.range,
        tilt: Math.max(55, map.tilt ?? 65),
        heading: map.heading ?? 0,
      },
      durationMillis: 30000,
      repeatCount: 1,
    });
    setOrbiting(true);
  };

  return (
    <div className="absolute inset-0">
      <div ref={hostRef} className="absolute inset-0" />
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-card/90 p-1 shadow-lg backdrop-blur">
        <button className="earth-icon-btn" title="Retornar ao norte" onClick={resetNorth}><Compass className="size-4" /></button>
        <button className="earth-icon-btn" title={orbiting ? "Parar órbita" : "Iniciar voo orbital"} onClick={startOrbit}><Orbit className="size-4" /></button>
        <button className="earth-icon-btn" title="Centralizar na visão inicial" onClick={() => mapRef.current?.flyCameraTo?.({ endCamera: { center: { ...initialCenter, altitude: 0 }, range: rangeFromZoom(initialZoom), tilt: 35, heading: 0 }, durationMillis: 1200 })}><LocateFixed className="size-4" /></button>
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
          <p className="mt-2 text-xs text-muted-foreground">O modo 2D continua disponível. Confira a ativação da Maps JavaScript API, o faturamento, a cobertura da região e as restrições da chave.</p>
        </div>
      )}
    </div>
  );
}
