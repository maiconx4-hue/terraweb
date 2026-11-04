/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import {
  defaultStyle, descendantIds, isFeature, isShown, uid,
  type FeatureKind, type FeatureNode, type Filter, type GeoNode, type LatLng,
} from "@/lib/geo/types";
import { buildKml, buildKmz, downloadBlob, readGeoFile } from "@/lib/geo/kml";
import { Sidebar } from "./Sidebar";
import { Properties } from "./Properties";

declare global {
  interface Window {
    __initEarthMap?: () => void;
    google?: any;
  }
}

type Mode = "none" | FeatureKind;

type Action =
  | { type: "set"; nodes: GeoNode[] }
  | { type: "add"; nodes: GeoNode[] }
  | { type: "update"; id: string; patch: Partial<GeoNode> }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; parentId: string | null };

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
  }
}

const STORAGE = "earth-web-nodes-v1";

const ICONS: Record<string, { path: string; anchor: [number, number] }> = {
  pin: { path: "M12 2C8 2 5 5 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-4-3-7-7-7zm0 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z", anchor: [12, 22] },
  circle: { path: "M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0z", anchor: [12, 12] },
  square: { path: "M6 6h12v12H6z", anchor: [12, 12] },
  star: { path: "M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z", anchor: [12, 12] },
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
  a.length === b.length && a.every((p, i) => Math.abs(p.lat - b[i].lat) < 1e-10 && Math.abs(p.lng - b[i].lng) < 1e-10);

const pathToCoords = (path: any): LatLng[] => path.getArray().map((p: any) => ({ lat: p.lat(), lng: p.lng() }));

export default function EarthApp() {
  const [nodes, dispatch] = useReducer(reducer, []);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("none");
  const [draft, setDraft] = useState<LatLng[]>([]);
  const [filter, setFilter] = useState<Filter>({ text: "", kinds: { marker: true, polygon: true, path: true } });
  const [mapType, setMapType] = useState("hybrid");
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const [sv, setSv] = useState<{ visible: boolean; pos: LatLng | null; heading: number }>({ visible: false, pos: null, heading: 0 });
  const [goto, setGoto] = useState("");

  const mapDiv = useRef<HTMLDivElement>(null);
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
      if (raw) dispatch({ type: "set", nodes: JSON.parse(raw) });
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE, JSON.stringify(nodes));
  }, [nodes, loaded]);

  const targetFolder = useCallback((): string | null => {
    const sel = nodesRef.current.find((n) => n.id === selectedRef.current);
    if (!sel) return null;
    return sel.kind === "folder" ? sel.id : sel.parentId;
  }, []);

  const createFeature = useCallback((kind: FeatureKind, coords: LatLng[], name?: string) => {
    const count = nodesRef.current.filter((n) => n.kind === kind).length + 1;
    const label = kind === "marker" ? "Marcador" : kind === "polygon" ? "Polígono" : "Caminho";
    const f: FeatureNode = {
      id: uid(), kind, name: name ?? `${label} ${count}`, description: "",
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
          center: { lat: -15.78, lng: -47.93 },
          zoom: 4,
          mapTypeId: "hybrid",
          tilt: 45,
          clickableIcons: false,
          streetViewControl: true,
          fullscreenControl: false,
          mapTypeControl: false,
          rotateControl: true,
          styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
        });
        mapRef.current = map;
        info.current = new g.maps.InfoWindow();
        map.addListener("mousemove", (e: any) => setCursor({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
        map.addListener("click", (e: any) => {
          const m = modeRef.current;
          const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          if (m === "marker") createFeature("marker", [p]);
          else if (m === "polygon" || m === "path") setDraft((d) => [...d, p]);
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
    return () => { cancelled = true; };
  }, [createFeature]);

  useEffect(() => { mapRef.current?.setMapTypeId(mapType); }, [mapType, ready]);
  useEffect(() => {
    mapRef.current?.setOptions({ disableDoubleClickZoom: mode === "polygon" || mode === "path", draggableCursor: mode === "none" ? null : "crosshair" });
  }, [mode, ready]);

  // ---- draft drawing ----
  const finishDraft = useCallback(() => {
    const m = modeRef.current;
    setDraft((d) => {
      if (m === "polygon" && d.length >= 3) createFeature("polygon", d);
      else if (m === "path" && d.length >= 2) createFeature("path", d);
      else if (d.length) toast.message(m === "polygon" ? "Um polígono precisa de 3 pontos" : "Um caminho precisa de 2 pontos");
      return [];
    });
    setMode("none");
  }, [createFeature]);

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
    const opts = { map: mapRef.current, path: draft, clickable: false, strokeColor: "#facc15", strokeWeight: 2, strokeOpacity: 1 };
    draftOverlay.current = mode === "polygon"
      ? new g.maps.Polygon({ ...opts, fillColor: "#facc15", fillOpacity: 0.2 })
      : new g.maps.Polyline(opts);
  }, [draft, mode, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === "Escape") { setDraft([]); setMode("none"); }
      if (e.key === "Enter") finishDraft();
      if (e.key === "Backspace" && draft.length) setDraft((d) => d.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishDraft, draft.length]);

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
        const icon = ICONS[s.icon] ?? ICONS.pin;
        ov.setOptions({
          title: n.name,
          draggable: sel && interactive,
          clickable: interactive,
          zIndex: sel ? 1000 : 1,
          icon: {
            path: icon.path, fillColor: s.color, fillOpacity: 1,
            strokeColor: sel ? "#22d3ee" : "#ffffff", strokeWeight: sel ? 2.5 : 1.5,
            scale: s.scale, anchor: new g.maps.Point(icon.anchor[0], icon.anchor[1]),
          },
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
  }, [nodes, selectedId, filter, ready, mode]);

  // ---- actions ----
  const zoomTo = useCallback((id: string) => {
    const g = window.google;
    const map = mapRef.current;
    if (!g || !map) return;
    const ids = descendantIds(nodesRef.current, id);
    const pts = nodesRef.current.filter((n) => ids.has(n.id) && isFeature(n)).flatMap((n) => (n as FeatureNode).coords);
    if (!pts.length) return;
    if (map.getStreetView().getVisible()) map.getStreetView().setVisible(false);
    if (pts.length === 1) { map.setCenter(pts[0]); map.setZoom(18); return; }
    const b = new g.maps.LatLngBounds();
    pts.forEach((p) => b.extend(p));
    map.fitBounds(b, 60);
  }, []);

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
      setTimeout(() => zoomTo(imported[0].id), 50);
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
    const p = { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) { toast.error("Coordenadas fora do intervalo"); return; }
    mapRef.current?.getStreetView().setVisible(false);
    mapRef.current?.setCenter(p);
    mapRef.current?.setZoom(17);
  };

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const tools: { id: Mode; label: string; hint: string }[] = [
    { id: "none", label: "Navegar", hint: "Mover o mapa" },
    { id: "marker", label: "Marcador", hint: "Clique no mapa" },
    { id: "polygon", label: "Polígono", hint: "Clique os vértices, duplo clique conclui" },
    { id: "path", label: "Caminho", hint: "Clique os pontos, duplo clique conclui" },
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
        onAddFolder={addFolder}
        onImport={onImport}
        onExport={(f) => onExport(f)}
      />

      <main className="earth-main">
        <div ref={mapDiv} className="earth-map" />

        <div className="earth-toolbar">
          <div className="earth-seg">
            {tools.map((t) => (
              <button
                key={t.id}
                title={t.hint}
                data-active={mode === t.id}
                onClick={() => { setDraft([]); setMode(t.id); }}
                className="earth-seg-btn"
              >
                {t.label}
              </button>
            ))}
          </div>
          <select value={mapType} onChange={(e) => setMapType(e.target.value)} className="earth-input w-36">
            <option value="hybrid">Satélite + rótulos</option>
            <option value="satellite">Satélite</option>
            <option value="terrain">Relevo</option>
            <option value="roadmap">Mapa</option>
          </select>
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); onGoto(); }}>
            <input value={goto} onChange={(e) => setGoto(e.target.value)} placeholder="-23.5505, -46.6333" className="earth-input w-48 font-mono" />
            <button className="earth-btn">Ir</button>
          </form>
        </div>

        {(mode === "polygon" || mode === "path") && (
          <div className="earth-float bottom-14 left-1/2 -translate-x-1/2">
            <span className="text-sm">{draft.length} pontos · duplo clique ou Enter conclui · Esc cancela</span>
            <button className="earth-btn" onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length}>Desfazer</button>
            <button className="earth-btn-primary" onClick={finishDraft}>Concluir</button>
          </div>
        )}

        {sv.visible && sv.pos && (
          <div className="earth-float top-16 left-1/2 -translate-x-1/2">
            <span className="font-mono text-xs">
              {sv.pos.lat.toFixed(6)}, {sv.pos.lng.toFixed(6)} · {Math.round(((sv.heading % 360) + 360) % 360)}°
            </span>
            <button className="earth-btn" onClick={() => addSvMarker(false)}>+ Marcador aqui</button>
            <button className="earth-btn-primary" onClick={() => addSvMarker(true)}>+ Marcador à frente</button>
          </div>
        )}

        <div className="earth-status">
          {cursor ? `${cursor.lat.toFixed(6)}, ${cursor.lng.toFixed(6)}` : "—"}
        </div>

        {selected && (
          <Properties
            node={selected}
            nodes={nodes}
            onChange={(patch) => dispatch({ type: "update", id: selected.id, patch })}
            onDelete={() => { dispatch({ type: "remove", id: selected.id }); setSelectedId(null); info.current?.close(); }}
            onZoom={() => zoomTo(selected.id)}
            onExport={(f) => onExport(f, selected.id)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </main>
    </div>
  );
}
