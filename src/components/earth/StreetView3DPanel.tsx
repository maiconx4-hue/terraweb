/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Grip, X } from "lucide-react";
import type { Filter, GeoNode, LatLng } from "@/lib/geo/types";
import { StreetViewMiniMap } from "./StreetViewMiniMap";

type StreetViewState = { pos: LatLng; heading: number };
type Props = {
  initialPosition: LatLng;
  initialHeading?: number;
  nodes: GeoNode[];
  filter: Filter;
  onClose: () => void;
  onChange: (state: StreetViewState) => void;
};

/** Panorama independente sobre o globo 3D; não altera nem recria o Map3DElement. */
export function StreetView3DPanel({
  initialPosition,
  initialHeading = 0,
  nodes,
  filter,
  onClose,
  onChange,
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
      aria-label="Street View no modo 3D"
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
        <span className="hidden text-white/50 sm:inline">Arraste para mover</span>
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
      />
    </section>
  );
}
