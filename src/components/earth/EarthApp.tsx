import { supabase } from "@/integrations/supabase/client";
import { MousePointer2, MapPin, Pentagon, Route as RouteIcon, Ruler, MapPinned, Grip } from "lucide-react";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import {
  defaultStyle, descendantIds, isFeature, isShown, uid,
  type FeatureKind, type FeatureNode, type Filter, type GeoNode, type LatLng,
} from "@/lib/geo/types";
import { buildKml, buildKmz, downloadBlob, readGeoFile } from "@/lib/geo/kml";
import { Sidebar } from "./Sidebar";
import { Properties } from "./Properties";
import { FtthDialog } from "./FtthDialog";
import { StreetViewMiniMap } from "./StreetViewMiniMap";
import { Map3DView } from "./Map3DView";
import { StreetView3DPanel } from "./StreetView3DPanel";
import { showDraftVertices } from "./draftVertices";
import {
  MARKER_DEFAULT_NAME, POLYGON_DEFAULT_DESCRIPTION, POLYGON_DEFAULT_NAME,
  fmtM, pathLengthM, polygonCellLength,
} from "@/lib/geo/ftth";

declare global {
  interface Window {
    __initEarthMap?: () => void;
    google?: any;
  }
}

type Mode = "none" | FeatureKind | "ruler";

type Action =
  | { type: "set"; nodes: GeoNode[] }
  | { type: "add"; nodes: GeoNode[] }
  | { type: "update"; id: string; patch: Partial<GeoNode> }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; parentId: string | null }
  | { type: "moveMany"; ids: string[]; parentId: string | null };

function reducer(state: GeoNode[], a: Action): GeoNode[] {
  switch (a.type) {
    case "set": return a.nodes;
    case "add": return [...state, ...a.nodes];
    case "update": return state.map((n) => (n.id === a.id ? ({ ...n, ...a.patch } as GeoNode) : n));
    case "remove": {
      const ids = descendantIds(state, a.id);
      return state.filter((n) => !ids.has(n.id));
    }
    case "move": {
      if (a.parentId && descendantIds(state, a.id).has(a.parentId)) return state;
      return state.map((n) => (n.id === a.id ? { ...n, parentId: a.parentId } : n));
    }
    case "moveMany": {
      const selected = new Set(a.ids);
      const roots = a.ids.filter((id) => {
        let current = state.find((n) => n.id === id);
        while (current?.parentId) {
          if (selected.has(current.parentId)) return false;
          current = state.find((n) => n.id === current!.parentId);
        }
        return true;
      });
      if (a.parentId && roots.some((id) => descendantIds(state, id).has(a.parentId!))) return state;
      const moving = new Set(roots);
      return state.map((n) => moving.has(n.id) ? { ...n, parentId: a.parentId } : n);
    }
  }
}

const STORAGE_BASE = "earth-web-nodes-v1";

const ICONS: Record<"pin" | "circle" | "square" | "star" | "triangle", { path: string; anchor: [number, number] }> = {
  pin: { path: "M12 2C8 2 5 5 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-4-3-7-7-7zm0 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z", anchor: [12, 22] },
  circle: { path: "M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0z", anchor: [12, 12] },
  square: { path: "M6 6h12v12H6z", anchor: [12, 12] },
  star: { path: "M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z", anchor: [12, 12] },
  triangle: { path: "M12 3L22 20H2z", anchor: [12, 12] },
};

let loader: Promise<void> | null = null;
function loadMaps(): Promise<void> {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    window.__initEarthMap = () => resolve();
    const key = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"];
    const ch = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"];
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&callback=__initEarthMap&channel=${ch}&v=weekly&language=pt-BR`;
    s.async = true;
    s.onerror = () => reject(new Error("Falha ao carregar o Google Maps"));
    document.head.appendChild(s);
  });
  return loader;
}

const sameCoords = (a: LatLng[], b: LatLng[]) =>
  a.length === b.length && a.every((p, i) => Math.abs(p.lat - b[i]!.lat) < 1e-10 && Math.abs(p.lng - b[i]!.lng) < 1e-10);

const pathToCoords = (path: any): LatLng[] => path.getArray().map((p: any) => ({ lat: p.lat(), lng: p.lng() }));

export default function EarthApp({ userId, userEmail }: { userId?: string; userEmail?: string } = {}) {
  const STORAGE = userId ? `${STORAGE_BASE}-${userId}` : STORAGE_BASE;
  const VIEW_KEY = `${STORAGE}-view`;
  const [nodes, dispatch] = useReducer(reducer, []);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("none");
  const [draft, setDraft] = useState<LatLng[]>([]);
  const draftRef = useRef<LatLng[]>([]);
  const updateDraft = useCallback((value: LatLng[] | ((previous: LatLng[]) => LatLng[])) => {
    const next = typeof value === "function" ? value(draftRef.current) : value;
    draftRef.current = next;
    setDraft(next);
  }, []);
  const [zoom, setZoom] = useState(4);
  const [filter, setFilter] = useState<Filter>({ text: "", kinds: { marker: true, polygon: true, path: true } });
  const [mapType, setMapType] = useState("hybrid");
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [hasOpened3D, setHasOpened3D] = useState(false);
  const [focus3D, setFocus3D] = useState<{ center: LatLng; nonce: number } | null>(null);
  const [center3D, setCenter3D] = useState<LatLng>({ lat: -15.78, lng: -47.93 });
  const [sv, setSv] = useState<{ visible: boolean; pos: LatLng | null; heading: number }>({ visible: false, pos: null, heading: 0 });
  const [sv3dOpen, setSv3dOpen] = useState(false);
  const [sv3dPosition, setSv3dPosition] = useState<LatLng | null>(null);
  const [sv3dHeading, setSv3dHeading] = useState(0);
  const [goto, setGoto] = useState("");
  const [ftthOpen, setFtthOpen] = useState(false);
  const [savedMeasure, setSavedMeasure] = useState<number | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState({ x: 12, y: 12 });
  const toolbarDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const startToolbarDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const toolbar = event.currentTarget.parentElement;
    const bounds = toolbar?.parentElement?.getBoundingClientRect();
    if (!toolbar || !bounds) return;
    event.preventDefault();
    event.stopPropagation();
    toolbarDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: toolbarPosition.x,
      originY: toolbarPosition.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveToolbarDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = toolbarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const toolbar = event.currentTarget.parentElement;
    const bounds = toolbar?.parentElement?.getBoundingClientRect();
    if (!toolbar || !bounds) return;
    const maxX = Math.max(0, bounds.width - toolbar.offsetWidth);
    const maxY = Math.max(0, bounds.height - toolbar.offsetHeight);
    setToolbarPosition({
      x: Math.min(maxX, Math.max(0, drag.originX + event.clientX - drag.startX)),
      y: Math.min(maxY, Math.max(0, drag.originY + event.clientY - drag.startY)),
    });
    event.preventDefault();
    event.stopPropagation();
  };

  const stopToolbarDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (toolbarDragRef.current?.pointerId !== event.pointerId) return;
    toolbarDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.stopPropagation();
  };

  const mapDiv = useRef<HTMLDivElement>(null);
  const cursorDisplayRef = useRef<HTMLDivElement>(null);
  const cursorFrameRef = useRef<number | null>(null);
  const pendingCursorRef = useRef<LatLng | null>(null);
  const mapRef = useRef<any>(null);
  const overlays = useRef(new Map<string, any>());
  const draftOverlay = useRef<any>(null);
  const info = useRef<any>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  // ---- persistence ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) {
        const parsed = (JSON.parse(raw) as GeoNode[]).map((n) => {
          if (n.kind === "polygon") return { ...n, style: { ...n.style, color: "#ffffff", strokeWidth: 1, strokeOpacity: 1 } };
          // marcadores criados antes do padrão vermelho (branco) passam a ser vermelhos
          if (n.kind === "marker" && ["#ffffff","#ff0000"].includes(n.style.color.toLowerCase()))
            return { ...n, style: { ...n.style, color: "#c60000", fillColor: "#c60000" } };
          return n;
        });
        dispatch({ type: "set", nodes: parsed });
      }
    } catch { /* ignore */ }
    if (!userId) { setLoaded(true); return; }
    // projeto do usuário na nuvem (prevalece sobre a cópia local)
    supabase.from("projects").select("nodes").eq("owner_id", userId).maybeSingle().then(({ data }) => {
      const cloud = data?.nodes as unknown as GeoNode[] | undefined;
      if (cloud && cloud.length) dispatch({ type: "set", nodes: cloud });
      setLoaded(true);
    }, () => setLoaded(true));
  }, [STORAGE, userId]);
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(STORAGE, JSON.stringify(nodes));
    if (!userId) return;
    const t = setTimeout(() => {
      supabase.from("projects").upsert({ owner_id: userId, nodes: nodes as any, updated_at: new Date().toISOString() }, { onConflict: "owner_id" })
        .then(({ error }) => { if (error) console.error(error); });
    }, 1500);
    return () => clearTimeout(t);
  }, [nodes, loaded, STORAGE, userId]);

  const targetFolder = useCallback((): string | null => {
    const sel = nodesRef.current.find((n) => n.id === selectedRef.current);
    if (!sel) return null;
    return sel.kind === "folder" ? sel.id : sel.parentId;
  }, []);

  const createFeature = useCallback((kind: FeatureKind, coords: LatLng[], name?: string) => {
    const count = nodesRef.current.filter((n) => n.kind === kind).length + 1;
    const defName = kind === "marker" ? MARKER_DEFAULT_NAME : kind === "polygon" ? POLYGON_DEFAULT_NAME : `Caminho ${count}`;
    const f: FeatureNode = {
      id: uid(), kind, name: name ?? defName, description: kind === "polygon" ? POLYGON_DEFAULT_DESCRIPTION : "",
      parentId: targetFolder(), visible: true, coords, style: defaultStyle(kind),
    };
    dispatch({ type: "add", nodes: [f] });
    setSelectedId(f.id);
    return f;
  }, [targetFolder]);

  // ---- map init ----
  useEffect(() => {
    let cancelled = false;
    loadMaps()
      .then(() => {
        if (cancelled || !mapDiv.current) return;
        const g = window.google;
        const map = new g.maps.Map(mapDiv.current, {
          ...(() => {
            try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? ""); if (v?.center && v.zoom) return { center: v.center, zoom: v.zoom }; } catch { /* sem vista salva */ }
            return { center: { lat: -15.78, lng: -47.93 }, zoom: 4 };
          })(),
          mapTypeId: "hybrid",
          // VECTOR habilita WebGL, zoom fracionário e interações modernas.
          // O DEMO_MAP_ID é fallback de desenvolvimento; configure VITE_GOOGLE_MAP_ID
          // com um Map ID próprio no Google Cloud para produção.
          mapId: import.meta.env["VITE_GOOGLE_MAP_ID"] || g.maps.Map.DEMO_MAP_ID,
          renderingType: g.maps.RenderingType?.VECTOR ?? "VECTOR",
          isFractionalZoomEnabled: true,
          tiltInteractionEnabled: true,
          headingInteractionEnabled: true,
          clickableIcons: false,
          streetViewControl: true,
          fullscreenControl: false,
          mapTypeControl: false,
          rotateControl: true,
        });
        mapRef.current = map;
        setZoom(map.getZoom?.() ?? 4);
        map.addListener("idle", () => {
          const currentZoom = map.getZoom() ?? 4;
          setZoom((previous) => previous === currentZoom ? previous : currentZoom);
          const c = map.getCenter();
          if (c) localStorage.setItem(VIEW_KEY, JSON.stringify({ center: { lat: c.lat(), lng: c.lng() }, zoom: currentZoom, mapTypeId: map.getMapTypeId() }));
        });
        info.current = new g.maps.InfoWindow();
        map.addListener("mousemove", (e: any) => {
          if (!e.latLng) return;
          pendingCursorRef.current = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          if (cursorFrameRef.current !== null) return;
          cursorFrameRef.current = window.requestAnimationFrame(() => {
            cursorFrameRef.current = null;
            const point = pendingCursorRef.current;
            if (point && cursorDisplayRef.current) {
              cursorDisplayRef.current.textContent = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
            }
          });
        });
        map.addListener("click", (e: any) => {
          const m = modeRef.current;
          const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          if (m === "marker") createFeature("marker", [p]);
          else if (m === "polygon" || m === "path" || m === "ruler") updateDraft((d) => {
            const last = d.at(-1);
            return last && last.lat === p.lat && last.lng === p.lng ? d : [...d, p];
          });
          else info.current?.close();
        });
        const pano = map.getStreetView();
        const syncSv = () => {
          const pos = pano.getPosition();
          setSv({ visible: pano.getVisible(), pos: pos ? { lat: pos.lat(), lng: pos.lng() } : null, heading: pano.getPov()?.heading ?? 0 });
        };
        pano.addListener("visible_changed", syncSv);
        pano.addListener("position_changed", syncSv);
        pano.addListener("pov_changed", syncSv);
        setReady(true);
      })
      .catch((e) => toast.error(e.message));
    return () => {
      cancelled = true;
      if (cursorFrameRef.current !== null) {
        window.cancelAnimationFrame(cursorFrameRef.current);
        cursorFrameRef.current = null;
      }
    };
  }, [createFeature, updateDraft]);

  useEffect(() => { mapRef.current?.setMapTypeId(mapType); }, [mapType, ready]);

  useEffect(() => {
    if (viewMode === "2d" && ready && mapRef.current) {
      // O mapa 2D permanece montado durante a exploração 3D.
      window.setTimeout(() => window.google?.maps?.event?.trigger(mapRef.current, "resize"), 0);
    }
  }, [viewMode, ready]);
  useEffect(() => {
    mapRef.current?.setOptions({ disableDoubleClickZoom: mode === "polygon" || mode === "path" || mode === "ruler", draggableCursor: mode === "none" ? null : "crosshair" });
  }, [mode, ready]);

  // ---- draft drawing ----
  const finishDraft = useCallback(() => {
    const m = modeRef.current;
    if (m !== "polygon" && m !== "path") return;
    const points = draftRef.current;
    // Consume the draft before dispatching: React may replay state updaters,
    // and completion can arrive twice before the next render.
    modeRef.current = "none";
    updateDraft([]);
    if (m === "polygon" && points.length >= 3) createFeature("polygon", points);
    else if (m === "path" && points.length >= 2) createFeature("path", points);
    else if (points.length) toast.message(m === "polygon" ? "Um polígono precisa de 3 pontos" : "Um caminho precisa de 2 pontos");
    setMode("none");
  }, [createFeature, updateDraft]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const l = map.addListener("dblclick", () => {
      if (modeRef.current === "polygon" || modeRef.current === "path") finishDraft();
    });
    return () => l.remove();
  }, [ready, finishDraft]);

  useEffect(() => {
    if (!ready) return;
    const g = window.google;
    draftOverlay.current?.setMap(null);
    draftOverlay.current = null;
    if (!draft.length) return;
    const opts = { map: mapRef.current, path: draft, clickable: false, strokeColor: mode === "ruler" ? "#f43f5e" : "#facc15", strokeWeight: 2, strokeOpacity: 1 };
    draftOverlay.current = mode === "polygon"
      ? new g.maps.Polygon({ ...opts, fillColor: "#facc15", fillOpacity: 0.2 })
      : new g.maps.Polyline(opts);
  }, [draft, mode, ready]);

  useEffect(() => {
    if (!ready || (mode !== "polygon" && mode !== "ruler") || !draft.length) return;
    return showDraftVertices(window.google, mapRef.current, draft);
  }, [draft, mode, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === "Escape") { updateDraft([]); modeRef.current = "none"; setMode("none"); }
      if (e.key === "Enter") finishDraft();
      if (e.key === "Backspace" && draft.length) updateDraft((d) => d.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishDraft, draft.length, updateDraft]);

  // ---- overlay sync ----
  useEffect(() => {
    if (!ready) return;
    const g = window.google;
    const map = mapRef.current;
    const store = overlays.current;
    const live = new Set<string>();
    const interactive = mode === "none";

    const attachPath = (ov: any, id: string) => {
      ov.__pathListeners?.forEach((l: any) => l.remove());
      const path = ov.getPath();
      const upd = () => dispatch({ type: "update", id, patch: { coords: pathToCoords(path) } });
      ov.__pathListeners = ["set_at", "insert_at", "remove_at"].map((ev) => path.addListener(ev, upd));
    };

    let markerIdx = -1;
    for (const n of nodes) {
      if (!isFeature(n)) continue;
      live.add(n.id);
      const sel = n.id === selectedId;
      const s = n.style;
      let ov = store.get(n.id);
      if (ov && ov.__kind !== n.kind) { ov.setMap(null); store.delete(n.id); ov = undefined; }
      if (!ov) {
        if (n.kind === "marker") {
          ov = new g.maps.Marker({ position: n.coords[0] });
          ov.addListener("dragend", (e: any) => dispatch({ type: "update", id: n.id, patch: { coords: [{ lat: e.latLng.lat(), lng: e.latLng.lng() }] } }));
        } else {
          ov = n.kind === "polygon" ? new g.maps.Polygon({ paths: n.coords }) : new g.maps.Polyline({ path: n.coords });
          attachPath(ov, n.id);
        }
        ov.__kind = n.kind;
        ov.addListener("click", (e: any) => {
          setSelectedId(n.id);
          const cur = nodesRef.current.find((x) => x.id === n.id);
          if (!cur) return;
          const box = document.createElement("div");
          box.className = "earth-info";
          const h = document.createElement("strong");
          h.textContent = cur.name;
          box.appendChild(h);
          if (cur.description) {
            const p = document.createElement("p");
            p.textContent = cur.description;
            box.appendChild(p);
          }
          info.current.setContent(box);
          if (n.kind === "marker") info.current.open({ map, anchor: ov });
          else { info.current.setPosition(e.latLng); info.current.open({ map }); }
        });
        store.set(n.id, ov);
      }

      if (n.kind === "marker") {
        const pos = ov.getPosition();
        if (!pos || !sameCoords([{ lat: pos.lat(), lng: pos.lng() }], n.coords.slice(0, 1))) ov.setPosition(n.coords[0]);
        markerIdx++;
        // Rótulos graduais: zoom alto mostra todos; médio alterna parte; baixo esconde (exceto selecionado)
        void markerIdx;
        // Como no Google Earth Pro (~293 m de altitude ≈ zoom 18): todos os rótulos visíveis
        const showLabel = sel || zoom >= 18;
        // Tamanho gradual pelo zoom: visão geral = ícones pequenos, perto (zoom ≥ 17) = tamanho Earth Pro
        const zf = sel ? 1.6 : Math.min(1, Math.max(0.4, 0.4 + (zoom - 11) * (0.6 / 6)));
        const px = Math.max(6, Math.round(20 * s.scale * zf));
        const iconOpt = s.icon === "triangle" ? {
          url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${sel ? `<rect x="2" y="2" width="60" height="60" fill="none" stroke="#facc15" stroke-width="5"/>` : ""}<path fill="${s.color}" stroke="#000" stroke-width="2" stroke-linejoin="round" d="${sel ? "M32 14 L52 50 L12 50 Z" : "M32 6 L60 56 L4 56 Z"}"/></svg>`),
          scaledSize: new g.maps.Size(px, px), anchor: new g.maps.Point(px / 2, px / 2),
          labelOrigin: new g.maps.Point(px + 4, px / 2),
        } : (() => {
              const icon = ICONS[s.icon as keyof typeof ICONS] ?? ICONS.pin;
              return {
                path: icon.path, fillColor: s.color, fillOpacity: 1,
                strokeColor: sel ? "#22d3ee" : "#ffffff", strokeWeight: sel ? 2.5 : 1.5,
                scale: s.scale * 1.4 * zf, anchor: new g.maps.Point(icon.anchor[0], icon.anchor[1]),
                labelOrigin: new g.maps.Point(30, 10),
              };
            })();
        ov.setOptions({
          title: n.name,
          draggable: sel && interactive,
          clickable: interactive,
          zIndex: sel ? 1000 : 1,
          icon: iconOpt,
          label: n.name && showLabel ? { text: n.name, color: "#ffffff", fontSize: `${Math.max(9, Math.round(13 * s.scale))}px`, fontWeight: "500", className: "earth-marker-label" } : null,
        });
      } else {
        if (!sameCoords(pathToCoords(ov.getPath()), n.coords)) {
          ov.setPath(n.coords);
          attachPath(ov, n.id);
        }
        ov.setOptions({
          strokeColor: s.color, strokeOpacity: s.strokeOpacity, strokeWeight: s.strokeWidth,
          ...(n.kind === "polygon" ? { fillColor: s.fillColor, fillOpacity: s.fillOpacity } : {}),
          editable: sel && interactive, clickable: interactive, zIndex: sel ? 1000 : 1,
        });
      }
      const shown = isShown(nodes, n, filter);
      if (shown && ov.getMap() !== map) ov.setMap(map);
      if (!shown && ov.getMap()) ov.setMap(null);
    }
    for (const [id, ov] of store) {
      if (!live.has(id)) {
        ov.__pathListeners?.forEach((l: any) => l.remove());
        g.maps.event.clearInstanceListeners(ov);
        ov.setMap(null);
        store.delete(id);
      }
    }
  }, [nodes, selectedId, filter, ready, mode, zoom]);

  // ---- actions ----
  const zoomTo = useCallback((id: string) => {
    const g = window.google;
    const map = mapRef.current;
    if (!g || !map) return;
    const ids = descendantIds(nodesRef.current, id);
    const pts = nodesRef.current.filter((n) => ids.has(n.id) && isFeature(n)).flatMap((n) => (n as FeatureNode).coords);
    if (!pts.length) return;
    if (viewMode === "3d") {
      const center = pts.reduce((acc, point) => ({ lat: acc.lat + point.lat / pts.length, lng: acc.lng + point.lng / pts.length }), { lat: 0, lng: 0 });
      setFocus3D({ center, nonce: Date.now() });
      return;
    }
    if (map.getStreetView().getVisible()) map.getStreetView().setVisible(false);
    if (pts.length === 1) { map.setCenter(pts[0]!); map.setZoom(18); return; }
    const b = new g.maps.LatLngBounds();
    pts.forEach((p) => b.extend(p));
    map.fitBounds(b, 60);
  }, [viewMode]);

  const addFolder = () => {
    const f: GeoNode = { id: uid(), kind: "folder", name: "Nova pasta", description: "", parentId: targetFolder(), visible: true, open: true };
    dispatch({ type: "add", nodes: [f] });
    setSelectedId(f.id);
  };

  const onImport = async (file: File) => {
    try {
      const imported = await readGeoFile(file);
      dispatch({ type: "add", nodes: imported });
      const n = imported.filter(isFeature).length;
      toast.success(`${n} itens importados de ${file.name}`);
      setTimeout(() => imported[0] && zoomTo(imported[0].id), 50);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível importar");
    }
  };

  const onExport = async (format: "kml" | "kmz", rootId: string | null = null) => {
    const root = rootId ? nodes.find((n) => n.id === rootId) : null;
    const name = root?.name ?? "Meus lugares";
    const kml = buildKml(nodes, name, rootId);
    const safe = name.replace(/[^\w\-À-ú ]+/g, "_");
    if (format === "kml") downloadBlob(new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }), `${safe}.kml`);
    else downloadBlob(await buildKmz(kml), `${safe}.kmz`);
  };

  const addSvMarker = (ahead: boolean) => {
    if (!sv.pos) return;
    let p = sv.pos;
    if (ahead) {
      const d = 10;
      const h = (sv.heading * Math.PI) / 180;
      p = { lat: p.lat + (d * Math.cos(h)) / 111320, lng: p.lng + (d * Math.sin(h)) / (111320 * Math.cos((p.lat * Math.PI) / 180)) };
    }
    createFeature("marker", [p]);
    toast.success("Marcador adicionado no Street View");
  };

  const onGoto = () => {
    const m = goto.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) { toast.error("Use o formato: latitude, longitude"); return; }
    const p = { lat: parseFloat(m[1]!), lng: parseFloat(m[2]!) };
    if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) { toast.error("Coordenadas fora do intervalo"); return; }
    mapRef.current?.getStreetView().setVisible(false);
    mapRef.current?.setCenter(p);
    mapRef.current?.setZoom(17);
    if (viewMode === "3d") setFocus3D({ center: p, nonce: Date.now() });
  };

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const tools: { id: Mode; label: string; hint: string }[] = [
    { id: "none", label: "Navegar", hint: "Mover o mapa", Icon: MousePointer2 },
    { id: "marker", label: "Marcador", hint: "Clique no mapa", Icon: MapPin },
    { id: "polygon", label: "Polígono", hint: "Clique os vértices, duplo clique conclui", Icon: Pentagon },
    { id: "path", label: "Caminho", hint: "Clique os pontos, duplo clique conclui", Icon: RouteIcon },
    { id: "ruler", label: "Régua", hint: "Clique os pontos para medir", Icon: Ruler },
  ];

  return (
    <div className="earth-shell">
      <Sidebar
        nodes={nodes}
        selectedId={selectedId}
        filter={filter}
        onFilter={setFilter}
        onSelect={setSelectedId}
        onZoom={zoomTo}
        onToggle={(id, patch) => dispatch({ type: "update", id, patch })}
        onMove={(id, parentId) => dispatch({ type: "move", id, parentId })}
        onMoveMany={(ids, parentId) => dispatch({ type: "moveMany", ids, parentId })}
        onAddFolder={addFolder}
        onImport={onImport}
        onExport={(f) => onExport(f)}
        userId={userId}
        userEmail={userEmail}
      />

      <main className="earth-main">
        <div ref={mapDiv} className="earth-map" style={{ display: viewMode === "2d" ? "block" : "none" }} />
        {hasOpened3D && (
          <div className="absolute inset-0" style={{ display: viewMode === "3d" ? "block" : "none" }}>
            <Map3DView
              nodes={nodes}
              filter={filter}
              selectedId={selectedId}
              initialCenter={mapRef.current?.getCenter?.() ? { lat: mapRef.current.getCenter().lat(), lng: mapRef.current.getCenter().lng() } : { lat: -15.78, lng: -47.93 }}
              initialZoom={mapRef.current?.getZoom?.() ?? zoom}
              focusRequest={focus3D}
              onSelect={setSelectedId}
              onUpdate={(id, patch) => dispatch({ type: "update", id, patch })}
              onCenterChange={setCenter3D}
              mode={mode}
              onCreateMarker={(point) => createFeature("marker", [point])}
              onDraftPoint={(point) => updateDraft((d) => {
                const last = d.at(-1);
                return last && last.lat === point.lat && last.lng === point.lng ? d : [...d, point];
              })}
            />
          </div>
        )}

        <div className="earth-toolbar" style={{ left: toolbarPosition.x, top: toolbarPosition.y }}>
          <button
            type="button"
            className="earth-toolbar-drag"
            title="Arrastar barra de ferramentas"
            aria-label="Arrastar barra de ferramentas"
            onPointerDown={startToolbarDrag}
            onPointerMove={moveToolbarDrag}
            onPointerUp={stopToolbarDrag}
            onPointerCancel={stopToolbarDrag}
          >
            <Grip className="size-4" aria-hidden="true" />
          </button>
          <div className="earth-seg mr-1">
            <button className="earth-seg-btn" data-active={viewMode === "2d"} onClick={() => {
              if (viewMode === "3d" && sv3dOpen && sv3dPosition) {
                const pano = mapRef.current?.getStreetView();
                pano?.setPosition(sv3dPosition);
                pano?.setPov({ heading: sv3dHeading, pitch: 0 });
                pano?.setVisible(true);
                setSv3dOpen(false);
              }
              setViewMode("2d");
            }} title="Mapa vetorial 2D">2D</button>
            <button className="earth-seg-btn" data-active={viewMode === "3d"} onClick={() => {
              updateDraft([]); modeRef.current = "none"; setMode("none"); setHasOpened3D(true);
              const pano = mapRef.current?.getStreetView();
              if (pano?.getVisible()) {
                const pos = pano.getPosition();
                if (pos) setSv3dPosition({ lat: pos.lat(), lng: pos.lng() });
                setSv3dHeading(pano.getPov()?.heading ?? 0);
                pano.setVisible(false);
                setSv3dOpen(true);
              }
              setViewMode("3d");
            }} title="Exploração orbital 3D" disabled={!ready}>3D Orbital</button>
          </div>
          <button
            type="button"
            className="earth-seg-btn earth-tool-icon"
            title={viewMode === "2d" ? (sv.visible ? "Fechar Street View" : "Abrir Street View no modo 2D") : (sv3dOpen ? "Fechar Street View" : "Abrir Street View no modo 3D")}
            aria-label="Street View"
            data-active={viewMode === "2d" ? sv.visible : sv3dOpen}
            onClick={() => {
              if (viewMode === "2d") {
                const pano = mapRef.current?.getStreetView();
                if (pano?.getVisible()) { pano.setVisible(false); return; }
                const center = mapRef.current?.getCenter?.();
                const start = sv3dPosition ?? (center ? { lat: center.lat(), lng: center.lng() } : { lat: -15.78, lng: -47.93 });
                pano?.setPosition(sv.pos ?? start);
                pano?.setPov({ heading: sv.heading ?? sv3dHeading, pitch: 0 });
                pano?.setVisible(true);
                return;
              }
              if (sv3dOpen) { setSv3dOpen(false); return; }
              const center = mapRef.current?.getCenter?.();
              const start = sv.visible && sv.pos ? sv.pos : sv3dPosition ?? center3D ?? (center ? { lat: center.lat(), lng: center.lng() } : { lat: -15.78, lng: -47.93 });
              setSv3dPosition(start);
              setSv3dHeading(sv.visible ? sv.heading ?? 0 : sv3dHeading);
              setSv3dOpen(true);
            }}
          >
            <MapPinned className="size-4" aria-hidden="true" />
          </button>
          <div className="earth-seg">
            {tools.map((t) => (
              <button
                key={t.id}
                type="button"
                title={`${t.label} — ${t.hint}`}
                aria-label={t.label}
                data-active={mode === t.id}
                onClick={() => { updateDraft([]); modeRef.current = t.id; setMode(t.id); }}
                className="earth-seg-btn earth-tool-icon"
              >
                <t.Icon className="size-4" aria-hidden="true" />
              </button>
            ))}
          </div>
          {viewMode === "2d" && (
            <select value={mapType} onChange={(e) => setMapType(e.target.value)} className="earth-input w-36">
              <option value="hybrid">Satélite + rótulos</option>
              <option value="satellite">Satélite</option>
              <option value="terrain">Relevo</option>
              <option value="roadmap">Mapa</option>
            </select>
          )}
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); onGoto(); }}>
            <input value={goto} onChange={(e) => setGoto(e.target.value)} placeholder="-23.5505, -46.6333" className="earth-input w-48 font-mono" />
            <button className="earth-btn">Ir</button>
          </form>
        </div>

        {mode === "ruler" && (
          <div className="earth-float bottom-14 left-1/2 -translate-x-1/2">
            <span className="font-mono text-sm">{fmtM(pathLengthM(draft))} m</span>
            <button className="earth-btn" onClick={() => updateDraft((d) => d.slice(0, -1))} disabled={!draft.length}>Desfazer</button>
            <button className="earth-btn" onClick={() => updateDraft([])} disabled={!draft.length}>Limpar</button>
            <button className="earth-btn-primary" disabled={draft.length < 2} onClick={() => {
              const v = Math.round(pathLengthM(draft) * 10) / 10;
              setSavedMeasure(v);
              toast.success(`Medida guardada: ${fmtM(v)} m`);
            }}>Guardar medida</button>
            {savedMeasure != null && <span className="text-xs text-muted-foreground">Guardada: {fmtM(savedMeasure)} m</span>}
            {savedMeasure != null && <button className="earth-btn" onClick={() => { setSavedMeasure(null); toast.success("Medida guardada apagada"); }}>Limpar guardada</button>}
          </div>
        )}

        {(mode === "polygon" || mode === "path") && (
          <div className="earth-float bottom-14 left-1/2 -translate-x-1/2">
            <span className="text-sm">{draft.length} pontos · clique nos pontos e conclua · Esc cancela</span>
            <button className="earth-btn" onClick={() => updateDraft((d) => d.slice(0, -1))} disabled={!draft.length}>Desfazer</button>
            <button className="earth-btn-primary" onClick={finishDraft}>Concluir</button>
          </div>
        )}

        {viewMode === "2d" && sv.visible && sv.pos && (
          <div className="earth-float top-16 left-1/2 -translate-x-1/2">
            <span className="font-mono text-xs">
              {sv.pos.lat.toFixed(6)}, {sv.pos.lng.toFixed(6)} · {Math.round(((sv.heading % 360) + 360) % 360)}°
            </span>
            <button className="earth-btn" onClick={() => addSvMarker(false)}>+ Marcador aqui</button>
            <button className="earth-btn-primary" onClick={() => addSvMarker(true)}>+ Marcador à frente</button>
          </div>
        )}

        {viewMode === "2d" && sv.visible && sv.pos && (
          <StreetViewMiniMap
            pos={sv.pos} heading={sv.heading} nodes={nodes} filter={filter}
            onMove={(p) => mapRef.current?.getStreetView().setPosition(p)}
          />
        )}

        {viewMode === "3d" && sv3dOpen && sv3dPosition && (
          <StreetView3DPanel
            initialPosition={sv3dPosition}
            initialHeading={sv3dHeading}
            nodes={nodes}
            filter={filter}
            onClose={() => setSv3dOpen(false)}
            onChange={({ pos, heading }) => { setSv3dPosition(pos); setSv3dHeading(heading); }}
          />
        )}

        <div ref={cursorDisplayRef} className="earth-status">—</div>

        {selected && (
          <Properties
            node={selected}
            nodes={nodes}
            onChange={(patch) => dispatch({ type: "update", id: selected.id, patch })}
            onDelete={() => { dispatch({ type: "remove", id: selected.id }); setSelectedId(null); info.current?.close(); }}
            onZoom={() => zoomTo(selected.id)}
            onExport={(f) => onExport(f, selected.id)}
            onClose={() => setSelectedId(null)}
            onFtth={() => setFtthOpen(true)}
          />
        )}

        {ftthOpen && selected && isFeature(selected) && selected.kind === "polygon" && (
          <FtthDialog
            currentName={selected.name}
            currentDescription={selected.description}
            initialResidences={parseInt(selected.name.match(/RESID[ÊE]NCIAS:\s*(\d+)/i)?.[1] ?? "", 10) || null}
            shapeLength={polygonCellLength(selected.coords)}
            savedMeasure={savedMeasure}
            onApply={(name, description) => dispatch({ type: "update", id: selected.id, patch: { name, description } })}
            onClose={() => setFtthOpen(false)}
          />
        )}
      </main>
    </div>
  );
}
