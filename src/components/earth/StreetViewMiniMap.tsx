/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { isFeature, isShown, type FeatureNode, type Filter, type GeoNode, type LatLng } from "@/lib/geo/types";

type Props = {
  pos: LatLng;
  heading: number;
  nodes: GeoNode[];
  filter: Filter;
  onMove: (p: LatLng) => void;
  /** Destaca a CTO selecionada no mini-mapa (opcional). */
  selectedId?: string | null;
  /** Posição provisória de uma CTO sendo arrastada no Street View (tempo real). */
  liveMarker?: { id: string; pos: LatLng } | null;
};

/** Mini-mapa de orientação exibido sobre o Street View, com seta girando conforme o heading. */
export function StreetViewMiniMap({ pos, heading, nodes, filter, onMove, selectedId, liveMarker }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const arrow = useRef<any>(null);
  const shapes = useRef<any[]>([]);
  const markerById = useRef(new Map<string, any>());
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const g = window.google;
    if (!open || !g || !div.current) return;
    const m = new g.maps.Map(div.current, {
      center: pos, zoom: 18, mapTypeId: "hybrid", disableDefaultUI: true,
      clickableIcons: false, streetViewControl: false, keyboardShortcuts: false,
      gestureHandling: "greedy", tilt: 0,
      styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
    });
    m.addListener("click", (e: any) => moveRef.current({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
    arrow.current = new g.maps.Marker({
      map: m, position: pos, zIndex: 9999, clickable: false,
      icon: {
        path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, rotation: heading,
        fillColor: "#1d4ed8", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2,
      },
    });
    map.current = m;
    return () => { arrow.current?.setMap(null); arrow.current = null; map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Formas do projeto
  useEffect(() => {
    const g = window.google;
    const m = map.current;
    shapes.current.forEach((s) => s.setMap(null));
    shapes.current = [];
    markerById.current.clear();
    if (!g || !m) return;
    for (const n of nodes) {
      if (!isFeature(n)) continue;
      const f = n as FeatureNode;
      if (!isShown(nodes, f, filter)) continue;
      const s = f.style;
      if (f.kind === "polygon") shapes.current.push(new g.maps.Polygon({ map: m, paths: f.coords, clickable: false, strokeColor: s.color, strokeWeight: s.strokeWidth, strokeOpacity: s.strokeOpacity, fillColor: s.fillColor, fillOpacity: s.fillOpacity }));
      else if (f.kind === "path") shapes.current.push(new g.maps.Polyline({ map: m, path: f.coords, clickable: false, strokeColor: s.color, strokeWeight: s.strokeWidth, strokeOpacity: s.strokeOpacity }));
      else {
        const sel = f.id === selectedId;
        const marker = new g.maps.Marker({ map: m, position: f.coords[0], clickable: false, zIndex: sel ? 100 : 1, icon: { path: "M 0 -6 L 6 5 L -6 5 Z", fillColor: s.color, fillOpacity: 1, strokeColor: sel ? "#facc15" : "#000000", strokeWeight: sel ? 2 : 1, scale: sel ? 1.4 : 0.9 } });
        shapes.current.push(marker);
        markerById.current.set(f.id, marker);
      }
    }
  }, [nodes, filter, open, selectedId]);

  // CTO arrastada no Street View: acompanha em tempo real, sem recriar as formas
  useEffect(() => {
    if (liveMarker) markerById.current.get(liveMarker.id)?.setPosition(liveMarker.pos);
  }, [liveMarker]);

  // Posição e direção em tempo real
  useEffect(() => {
    const a = arrow.current;
    if (!a) return;
    a.setPosition(pos);
    const icon = a.getIcon();
    a.setIcon({ ...icon, rotation: heading });
    map.current?.panTo(pos);
  }, [pos.lat, pos.lng, heading, open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute bottom-10 left-0 z-20 overflow-hidden rounded-tr-md border border-border bg-card shadow-lg">
      <button
        className="absolute right-1 top-1 z-10 rounded bg-card/90 px-2 py-0.5 text-xs text-foreground"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Recolher mini-mapa" : "Expandir mini-mapa"}
      >
        {open ? "–" : "Mini-mapa"}
      </button>
      {open ? <div ref={div} style={{ width: 300, height: 220 }} /> : <div style={{ width: 90, height: 28 }} />}
    </div>
  );
}
