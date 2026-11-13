/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
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

  return (
    <section className="absolute inset-3 z-30 overflow-hidden rounded-xl border border-border bg-black shadow-2xl" aria-label="Street View no modo 3D">
      <div ref={hostRef} className="absolute inset-0" />
      <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-md border border-white/20 bg-black/70 px-3 py-2 text-xs text-white shadow-lg backdrop-blur">
        <span className="size-2 rounded-full bg-emerald-400" />
        <span className="font-mono">{current.pos.lat.toFixed(6)}, {current.pos.lng.toFixed(6)} · {Math.round(((current.heading % 360) + 360) % 360)}°</span>
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
