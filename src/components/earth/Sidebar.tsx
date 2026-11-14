//coments
import { useRef, useState } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  MapPin,
  Pentagon,
  Route as RouteIcon,
  Eye,
  EyeOff,
  FolderPlus,
  Upload,
  Download,
  Search,
  Globe2,
  UserRound,
} from "lucide-react";

import {
  isFeature,
  passesFilter,
  type FeatureKind,
  type Filter,
  type GeoNode,
} from "@/lib/geo/types";

interface Props {
  nodes: GeoNode[];
  selectedId: string | null;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onSelect: (id: string | null) => void;
  onZoom: (id: string) => void;
  onToggle: (id: string, patch: Partial<GeoNode>) => void;
  onMove: (id: string, parentId: string | null) => void;
  onMoveMany: (ids: string[], parentId: string | null) => void;
  onAddFolder: () => void;
  onImport: (f: File) => void;
  onExport: (f: "kml" | "kmz") => void;
  userId?: string;
  userEmail?: string;
}

const KIND_LABEL: Record<FeatureKind, string> = {
  marker: "Marcadores",
  polygon: "Polígonos",
  path: "Caminhos",
};

export function Sidebar(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const [dragOver, setDragOver] = useState<string | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);

  const filtering =
    !!p.filter.text.trim() ||
    Object.values(p.filter.kinds).some((v) => !v);

  // Identifica os elementos que devem aparecer na árvore durante a filtragem.
  const visibleInTree = new Set<string>();

  if (filtering) {
    const byId = new Map(p.nodes.map((n) => [n.id, n]));

    for (const n of p.nodes) {
      if (isFeature(n) && passesFilter(n, p.filter)) {
        let cur: GeoNode | undefined = n;

        while (cur) {
          visibleInTree.add(cur.id);
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
      }
    }
  }

  // Remove descendentes quando a pasta ancestral também está selecionada.
  // Isso evita movimentar o mesmo elemento mais de uma vez.
  const getRootItems = (ids: string[]): string[] => {
    const selected = new Set(ids);
    const byId = new Map(p.nodes.map((n) => [n.id, n]));

    return ids.filter((id) => {
      let current = byId.get(id);

      while (current?.parentId) {
        if (selected.has(current.parentId)) {
          return false;
        }

        current = byId.get(current.parentId);
      }

      return true;
    });
  };

  // Recebe os itens arrastados e movimenta para a pasta de destino.
  const drop = (e: React.DragEvent, parentId: string | null) => {
    e.preventDefault();
    e.stopPropagation();

    setDragOver(null);

    const raw =
      e.dataTransfer.getData("application/x-terraweb-node-ids") ||
      e.dataTransfer.getData("text/node-id") ||
      e.dataTransfer.getData("text/plain");

    if (!raw) return;

    let ids: string[] = [];

    try {
      const parsed = JSON.parse(raw);
      ids = Array.isArray(parsed) ? parsed : [raw];
    } catch {
      ids = [raw];
    }

    // Aceita somente identificadores existentes.
    ids = [...new Set(
      ids.filter((id) => p.nodes.some((n) => n.id === id))
    )];

    if (!ids.length) return;

    const roots = getRootItems(ids);

    if (!roots.length) return;

    const byId = new Map(p.nodes.map((n) => [n.id, n]));

    // Impede mover uma pasta para dentro dela mesma
    // ou para dentro de qualquer descendente.
    const invalid = roots.some((id) => {
      let current = parentId ? byId.get(parentId) : undefined;

      while (current) {
        if (current.id === id) return true;

        current = current.parentId
          ? byId.get(current.parentId)
          : undefined;
      }

      return false;
    });

    if (invalid) return;

    // Executa a movimentação de todos os itens selecionados.
    p.onMoveMany(roots, parentId);

    setMultiSelectedIds([]);
    p.onSelect(null);
  };

  // Renderização recursiva da árvore de pastas e elementos.
  const render = (
    parentId: string | null,
    depth: number
  ): React.ReactNode =>
    p.nodes
      .filter(
        (n) =>
          n.parentId === parentId &&
          (!filtering || visibleInTree.has(n.id))
      )
      .sort(
        (a, b) =>
          (a.kind === "folder" ? 0 : 1) -
          (b.kind === "folder" ? 0 : 1)
      )
      .map((n) => {
        const isFolder = n.kind === "folder";
        const open = isFolder && (n.open || filtering);

        const Icon = isFolder
          ? open
            ? FolderOpen
            : Folder
          : n.kind === "marker"
            ? MapPin
            : n.kind === "polygon"
              ? Pentagon
              : RouteIcon;

        const color = isFeature(n)
          ? n.kind === "polygon"
            ? n.style.fillColor
            : n.style.color
          : undefined;

        const isMultiSelected = multiSelectedIds.includes(n.id);
        const isSelected = p.selectedId === n.id || isMultiSelected;

        return (
          <div key={n.id}>
            <div
              draggable
              onDragStart={(e) => {
                // Se o item arrastado já está selecionado,
                // leva todos os itens da multisseleção.
                // Caso contrário, arrasta somente ele.
                const ids = multiSelectedIds.includes(n.id)
                  ? multiSelectedIds
                  : [n.id];

                const payload = JSON.stringify(ids);

                e.dataTransfer.effectAllowed = "move";

                e.dataTransfer.setData(
                  "application/x-terraweb-node-ids",
                  payload
                );

                e.dataTransfer.setData("text/plain", payload);

                // Compatibilidade com o formato anterior.
                e.dataTransfer.setData("text/node-id", n.id);
              }}
              onDragEnd={() => setDragOver(null)}
              onDragOver={(e) => {
                if (isFolder) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOver(n.id);
                }
              }}
              onDragLeave={() => {
                setDragOver((d) => (d === n.id ? null : d));
              }}
              onDrop={(e) => {
                if (isFolder) {
                  drop(e, n.id);
                }
              }}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  setMultiSelectedIds((current) =>
                    current.includes(n.id)
                      ? current.filter((id) => id !== n.id)
                      : [...current, n.id]
                  );

                  p.onSelect(n.id);
                } else {
                  setMultiSelectedIds([]);
                  p.onSelect(n.id);
                }
              }}
              onDoubleClick={() => p.onZoom(n.id)}
              data-selected={isSelected}
              data-multi-selected={isMultiSelected}
              data-drop={dragOver === n.id}
              className="earth-row"
              style={{ paddingLeft: 8 + depth * 16 }}
            >
              {isFolder ? (
                <button
                  className="earth-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onToggle(n.id, { open: !n.open });
                  }}
                  aria-label={open ? "Recolher" : "Expandir"}
                >
                  <ChevronRight
                    className="size-3.5 transition-transform"
                    style={{
                      transform: open ? "rotate(90deg)" : undefined,
                    }}
                  />
                </button>
              ) : (
                <span className="w-5" />
              )}

              <button
                className="earth-icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  p.onToggle(n.id, { visible: !n.visible });
                }}
                aria-label={n.visible ? "Ocultar" : "Mostrar"}
              >
                {n.visible ? (
                  <Eye className="size-3.5" />
                ) : (
                  <EyeOff className="size-3.5 opacity-50" />
                )}
              </button>

              <Icon
                className="size-4 shrink-0"
                style={color ? { color } : undefined}
              />

              <span
                className={`truncate ${
                  n.visible ? "" : "opacity-50"
                }`}
              >
                {n.name}
              </span>
            </div>

            {open && render(n.id, depth + 1)}
          </div>
        );
      });

  return (
    <aside className="earth-sidebar">
      <header className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Globe2 className="size-5 shrink-0 text-primary" />
        <h1 className="min-w-0 flex-1 font-display text-lg font-semibold tracking-tight">
          Terra Web
        </h1>
        {p.userId && (
          <a
            href="/conta"
            target="_blank"
            rel="noopener noreferrer"
            title={`${p.userEmail ?? "Minha conta"} — abrir conta em nova aba`}
            aria-label="Minha conta"
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-foreground transition-colors hover:bg-muted"
          >
            <UserRound className="size-4" aria-hidden="true" />
          </a>
        )}
      </header>

      <div className="space-y-2 px-3 pb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

          <input
            value={p.filter.text}
            onChange={(e) =>
              p.onFilter({ ...p.filter, text: e.target.value })
            }
            placeholder="Filtrar lugares…"
            className="earth-input w-full pl-8"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {(Object.keys(KIND_LABEL) as FeatureKind[]).map((k) => (
            <button
              key={k}
              data-active={p.filter.kinds[k]}
              onClick={() =>
                p.onFilter({
                  ...p.filter,
                  kinds: {
                    ...p.filter.kinds,
                    [k]: !p.filter.kinds[k],
                  },
                })
              }
              className="earth-chip"
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-y border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Lugares
        </span>

        <div className="flex gap-1">
          <button
            className="earth-icon-btn"
            title="Nova pasta"
            onClick={p.onAddFolder}
          >
            <FolderPlus className="size-4" />
          </button>

          <button
            className="earth-icon-btn"
            title="Importar KML/KMZ"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-4" />
          </button>

          <button
            className="earth-icon-btn"
            title="Exportar KMZ"
            onClick={() => p.onExport("kmz")}
          >
            <Download className="size-4" />
          </button>

          <input
            ref={fileRef}
            type="file"
            accept=".kml,.kmz"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];

              if (f) p.onImport(f);

              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div
        className="earth-tree"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => drop(e, null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setMultiSelectedIds([]);
            p.onSelect(null);
          }
        }}
      >
        {p.nodes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Nenhum lugar ainda. Escolha uma ferramenta acima do mapa ou
            importe um arquivo KML/KMZ.
          </p>
        ) : (
          render(null, 0)
        )}
      </div>

      <footer className="flex gap-2 border-t border-border p-3">
        <button
          className="earth-btn flex-1"
          onClick={() => p.onExport("kml")}
        >
          Exportar KML
        </button>

        <button
          className="earth-btn-primary flex-1"
          onClick={() => p.onExport("kmz")}
        >
          Exportar KMZ
        </button>
      </footer>
    </aside>
  );
}
