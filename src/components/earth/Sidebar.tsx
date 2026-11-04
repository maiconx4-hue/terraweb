import { useRef, useState } from "react";
import { ChevronRight, Folder, FolderOpen, MapPin, Pentagon, Route as RouteIcon, Eye, EyeOff, FolderPlus, Upload, Download, Search, Globe2 } from "lucide-react";
import { isFeature, passesFilter, type FeatureKind, type Filter, type GeoNode } from "@/lib/geo/types";

interface Props {
  nodes: GeoNode[];
  selectedId: string | null;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onSelect: (id: string | null) => void;
  onZoom: (id: string) => void;
  onToggle: (id: string, patch: Partial<GeoNode>) => void;
  onMove: (id: string, parentId: string | null) => void;
  onAddFolder: () => void;
  onImport: (f: File) => void;
  onExport: (f: "kml" | "kmz") => void;
}

const KIND_LABEL: Record<FeatureKind, string> = { marker: "Marcadores", polygon: "Polígonos", path: "Caminhos" };

export function Sidebar(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const filtering = !!p.filter.text.trim() || Object.values(p.filter.kinds).some((v) => !v);

  // Which nodes to show in the tree when filtering
  const visibleInTree = new Set<string>();
  if (filtering) {
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    for (const n of p.nodes) {
      if (isFeature(n) && passesFilter(n, p.filter)) {
        let cur: GeoNode | undefined = n;
        while (cur) { visibleInTree.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
      }
    }
  }

  const drop = (e: React.DragEvent, parentId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/node-id");
    if (id && id !== parentId) p.onMove(id, parentId);
  };

  const render = (parentId: string | null, depth: number): React.ReactNode =>
    p.nodes
      .filter((n) => n.parentId === parentId && (!filtering || visibleInTree.has(n.id)))
      .sort((a, b) => (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1))
      .map((n) => {
        const isFolder = n.kind === "folder";
        const open = isFolder && (n.open || filtering);
        const Icon = isFolder ? (open ? FolderOpen : Folder) : n.kind === "marker" ? MapPin : n.kind === "polygon" ? Pentagon : RouteIcon;
        const color = isFeature(n) ? (n.kind === "polygon" ? n.style.fillColor : n.style.color) : undefined;
        return (
          <div key={n.id}>
            <div
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/node-id", n.id)}
              onDragOver={(e) => { if (isFolder) { e.preventDefault(); setDragOver(n.id); } }}
              onDragLeave={() => setDragOver((d) => (d === n.id ? null : d))}
              onDrop={(e) => isFolder && drop(e, n.id)}
              onClick={() => p.onSelect(n.id)}
              onDoubleClick={() => p.onZoom(n.id)}
              data-selected={p.selectedId === n.id}
              data-drop={dragOver === n.id}
              className="earth-row"
              style={{ paddingLeft: 8 + depth * 16 }}
            >
              {isFolder ? (
                <button
                  className="earth-icon-btn"
                  onClick={(e) => { e.stopPropagation(); p.onToggle(n.id, { open: !n.open }); }}
                  aria-label={open ? "Recolher" : "Expandir"}
                >
                  <ChevronRight className="size-3.5 transition-transform" style={{ transform: open ? "rotate(90deg)" : undefined }} />
                </button>
              ) : <span className="w-5" />}
              <button
                className="earth-icon-btn"
                onClick={(e) => { e.stopPropagation(); p.onToggle(n.id, { visible: !n.visible }); }}
                aria-label={n.visible ? "Ocultar" : "Mostrar"}
              >
                {n.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5 opacity-50" />}
              </button>
              <Icon className="size-4 shrink-0" style={color ? { color } : undefined} />
              <span className={`truncate ${n.visible ? "" : "opacity-50"}`}>{n.name}</span>
            </div>
            {open && render(n.id, depth + 1)}
          </div>
        );
      });

  return (
    <aside className="earth-sidebar">
      <header className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Globe2 className="size-5 text-primary" />
        <h1 className="font-display text-lg font-semibold tracking-tight">Terra Web</h1>
      </header>

      <div className="space-y-2 px-3 pb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={p.filter.text}
            onChange={(e) => p.onFilter({ ...p.filter, text: e.target.value })}
            placeholder="Filtrar lugares…"
            className="earth-input w-full pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(KIND_LABEL) as FeatureKind[]).map((k) => (
            <button
              key={k}
              data-active={p.filter.kinds[k]}
              onClick={() => p.onFilter({ ...p.filter, kinds: { ...p.filter.kinds, [k]: !p.filter.kinds[k] } })}
              className="earth-chip"
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-y border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lugares</span>
        <div className="flex gap-1">
          <button className="earth-icon-btn" title="Nova pasta" onClick={p.onAddFolder}><FolderPlus className="size-4" /></button>
          <button className="earth-icon-btn" title="Importar KML/KMZ" onClick={() => fileRef.current?.click()}><Upload className="size-4" /></button>
          <button className="earth-icon-btn" title="Exportar KMZ" onClick={() => p.onExport("kmz")}><Download className="size-4" /></button>
          <input
            ref={fileRef}
            type="file"
            accept=".kml,.kmz"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImport(f); e.target.value = ""; }}
          />
        </div>
      </div>

      <div
        className="earth-tree"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => drop(e, null)}
        onClick={(e) => { if (e.target === e.currentTarget) p.onSelect(null); }}
      >
        {p.nodes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Nenhum lugar ainda. Escolha uma ferramenta acima do mapa ou importe um arquivo KML/KMZ.
          </p>
        ) : render(null, 0)}
      </div>

      <footer className="flex gap-2 border-t border-border p-3">
        <button className="earth-btn flex-1" onClick={() => p.onExport("kml")}>Exportar KML</button>
        <button className="earth-btn-primary flex-1" onClick={() => p.onExport("kmz")}>Exportar KMZ</button>
      </footer>
    </aside>
  );
}
