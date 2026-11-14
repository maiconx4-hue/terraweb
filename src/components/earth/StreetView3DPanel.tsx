/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Grip, X } from "lucide-react";
import { isFeature, isShown, type Filter, type GeoNode, type LatLng } from "@/lib/geo/types";
import { buildStreetViewMarkerIcon } from "./streetViewMarkerIcon";
import { StreetViewMiniMap } from "./StreetViewMiniMap";

type StreetViewState = { pos: LatLng; heading: number };
type Props = {
  initialPosition: LatLng;
  initialHeading?: number;
  nodes: GeoNode[];
  filter: Filter;
  onClose: () => void;
  onChange: (state: StreetViewState) => void;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Grava a nova coordenada da CTO ao soltar o arraste. */
  onMoveNode?: (id: string, pos: LatLng) => void;
  /** Posição provisória durante o arraste (para atualizar o mapa 3D em tempo real). */
  onLiveMove?: (live: { id: string; pos: LatLng } | null) => void;
  onAddMarker?: (pos: LatLng) => void;
};

/** Painel Street View compartilhado entre os modos 2D e 3D; não altera o mapa-base. */
export function StreetView3DPanel({
  initialPosition,
  initialHeading = 0,
  nodes,
  filter,
  onClose,
  onChange,
  selectedId = null,
  onSelect,
  onMoveNode,
  onLiveMove,
  onAddMarker,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null);
  const [current, setCurrent] = useState<StreetViewState>({
    pos: initialPosition,
    heading: initialHeading,
  });
  onChangeRef.current = onChange;
  const markersRef = useRef(new Map<string, any>());
  const liveFrameRef = useRef<number | null>(null);
  const [live, setLive] = useState<{ id: string; pos: LatLng } | null>(null);
  const callbacks = useRef({ onSelect, onMoveNode, onLiveMove });
  callbacks.current = { onSelect, onMoveNode, onLiveMove };

  useEffect(() => {
    const g = (window as any).google;
    if (!g?.maps?.StreetViewPanorama || !hostRef.current) return;

    const panorama = new g.maps.StreetViewPanorama(hostRef.current, {
      position: initialPosition,
      pov: { heading: initialHeading, pitch: 0 },
      zoom: 1,
      visible: true,
      addressControl: true,
      fullscreenControl: true,
      linksControl: true,
      motionTracking: false,
      clickToGo: true,
      scrollwheel: true,
      panControl: true,
      zoomControl: true,
    });
    panoramaRef.current = panorama;

    const sync = () => {
      const position = panorama.getPosition?.();
      if (!position) return;
      const next = {
        pos: { lat: position.lat(), lng: position.lng() },
        heading: panorama.getPov?.()?.heading ?? 0,
      };
      setCurrent(next);
      onChangeRef.current(next);
    };
    const listeners = [
      panorama.addListener("position_changed", sync),
      panorama.addListener("pov_changed", sync),
    ];
    sync();

    return () => {
      listeners.forEach((listener: any) => listener.remove?.());
      panorama.setVisible(false);
      panoramaRef.current = null;
    };
  // A montagem única preserva a navegação interna do panorama.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CTOs dentro do Street View (como no modo 2D): visíveis, selecionáveis e, quando
  // selecionadas, arrastáveis. O mini-mapa e o mapa 3D acompanham em tempo real.
  useEffect(() => {
    const g = (window as any).google;
    const panorama = panoramaRef.current;
    if (!g?.maps || !panorama) return;
    const store = markersRef.current;
    const seen = new Set<string>();

    for (const node of nodes) {
      if (!isFeature(node) || node.kind !== "marker") continue;
      if (!isShown(nodes, node, filter)) continue;
      seen.add(node.id);
      const selected = node.id === selectedId;
      let marker = store.get(node.id);
      if (!marker) {
        marker = new g.maps.Marker({ position: node.coords[0] });
        const id = node.id;
        marker.addListener("click", () => callbacks.current.onSelect?.(id));
        marker.addListener("drag", (event: any) => {
          const pos = { lat: event.latLng.lat(), lng: event.latLng.lng() };
          if (liveFrameRef.current !== null) cancelAnimationFrame(liveFrameRef.current);
          liveFrameRef.current = requestAnimationFrame(() => {
            liveFrameRef.current = null;
            setLive({ id, pos });
            callbacks.current.onLiveMove?.({ id, pos });
          });
        });
        marker.addListener("dragend", (event: any) => {
          if (liveFrameRef.current !== null) { cancelAnimationFrame(liveFrameRef.current); liveFrameRef.current = null; }
          const pos = { lat: event.latLng.lat(), lng: event.latLng.lng() };
          callbacks.current.onMoveNode?.(id, pos);
          setLive(null);
          callbacks.current.onLiveMove?.(null);
        });
        store.set(node.id, marker);
      }
      const current = marker.getPosition?.();
      const target = node.coords[0];
      if (target && (!current || current.lat() !== target.lat || current.lng() !== target.lng)) marker.setPosition(target);
      marker.setOptions({
        map: panorama,
        title: node.name,
        draggable: selected,
        clickable: true,
        zIndex: selected ? 1000 : 1,
        icon: buildStreetViewMarkerIcon(g, node.style, selected),
        label: selected && node.name ? { text: node.name, color: "#ffffff", fontSize: "12px", fontWeight: "600" } : null,
      });
    }

    for (const [id, marker] of store) {
      if (seen.has(id)) continue;
      marker.setMap(null);
      store.delete(id);
    }
  }, [nodes, filter, selectedId]);

  useEffect(() => () => {
    markersRef.current.forEach((marker) => { marker.setMap(null); });
    markersRef.current.clear();
    if (liveFrameRef.current !== null) cancelAnimationFrame(liveFrameRef.current);
    callbacks.current.onLiveMove?.(null);
  }, []);

  const addMarker = (ahead: boolean) => {
    let point = current.pos;
    if (ahead) {
      const heading = (current.heading * Math.PI) / 180;
      const distance = 10;
      point = {
        lat: point.lat + (distance * Math.cos(heading)) / 111320,
        lng: point.lng + (distance * Math.sin(heading)) / (111320 * Math.cos((point.lat * Math.PI) / 180)),
      };
    }
    onAddMarker?.(point);
  };

  const moveTo = (position: LatLng) => {
    panoramaRef.current?.setPosition(position);
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const panel = event.currentTarget.parentElement;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const panelRect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    setPanelPosition({ left: panelRect.left - parentRect.left, top: panelRect.top - parentRect.top });
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - panelRect.left, offsetY: event.clientY - panelRect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const dragPanel = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const panel = event.currentTarget.parentElement;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const parentRect = parent.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const left = Math.max(0, Math.min(parentRect.width - panelRect.width, event.clientX - parentRect.left - drag.offsetX));
    const top = Math.max(0, Math.min(parentRect.height - panelRect.height, event.clientY - parentRect.top - drag.offsetY));
    setPanelPosition({ left, top });
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <section
      className="absolute z-30 overflow-hidden rounded-xl border border-border bg-black shadow-2xl"
      style={{
        left: panelPosition?.left, top: panelPosition?.top, right: panelPosition ? undefined : 16, bottom: panelPosition ? undefined : 16,
        width: 'min(1120px, 82vw, calc(100% - 32px))', height: 'min(760px, 82vh, calc(100% - 88px))',
      }}
      aria-label="Street View compartilhado entre os modos 2D e 3D"
    >
      <div ref={hostRef} className="absolute inset-0" style={{ top: 44 }} />
      <div
        className="absolute inset-x-0 top-0 z-20 flex h-11 touch-none cursor-grab items-center gap-2 border-b border-white/15 bg-black/80 px-3 text-xs text-white shadow-lg backdrop-blur active:cursor-grabbing"
        onPointerDown={startDrag}
        onPointerMove={dragPanel}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <Grip className="size-4 shrink-0 text-white/60" />
        <span className="size-2 shrink-0 rounded-full bg-emerald-400" />
        <span className="min-w-0 flex-1 truncate font-mono">{current.pos.lat.toFixed(6)}, {current.pos.lng.toFixed(6)} · {Math.round(((current.heading % 360) + 360) % 360)}°</span>
        {onAddMarker && (
          <>
            <button type="button" onClick={() => addMarker(false)} className="rounded bg-white/10 px-2 py-1 hover:bg-white/20" title="Adicionar CTO na posição atual">+ Marcador aqui</button>
            <button type="button" onClick={() => addMarker(true)} className="rounded bg-yellow-400 px-2 py-1 font-medium text-black hover:bg-yellow-300" title="Adicionar CTO 10 m à frente">+ Marcador à frente</button>
          </>
        )}
        <span className="hidden text-white/50 lg:inline">Selecione uma CTO e arraste-a no Street View</span>
        <button type="button" onClick={onClose} className="ml-1 rounded p-1 hover:bg-white/15" title="Fechar Street View 3D" aria-label="Fechar Street View 3D">
          <X className="size-4" />
        </button>
      </div>
      <StreetViewMiniMap
        pos={current.pos}
        heading={current.heading}
        nodes={nodes}
        filter={filter}
        onMove={moveTo}
        selectedId={selectedId}
        liveMarker={live}
      />
    </section>
  );
}
