import { X, Trash2, Crosshair, Download } from "lucide-react";
import { descendantIds, isFeature, type FeatureStyle, type GeoNode, type IconShape } from "@/lib/geo/types";

interface Props {
  node: GeoNode;
  nodes: GeoNode[];
  onChange: (patch: Partial<GeoNode>) => void;
  onDelete: () => void;
  onZoom: () => void;
  onExport: (f: "kml" | "kmz") => void;
  onClose: () => void;
  onFtth?: () => void;
}

const ICONS: { id: IconShape; label: string }[] = [
  { id: "triangle", label: "Triângulo" }, { id: "pin", label: "Alfinete" }, { id: "circle", label: "Círculo" }, { id: "square", label: "Quadrado" }, { id: "star", label: "Estrela" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Range({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="earth-range flex-1" />
      <span className="w-10 text-right font-mono text-xs">{value}</span>
    </div>
  );
}

export function Properties({ node, nodes, onChange, onDelete, onZoom, onExport, onClose, onFtth }: Props) {
  const feature = isFeature(node) ? node : null;
  const pt = feature?.coords[0];
  const setStyle = (patch: Partial<FeatureStyle>) => feature && onChange({ style: { ...feature.style, ...patch } } as Partial<GeoNode>);
  const count = node.kind === "folder" ? descendantIds(nodes, node.id).size - 1 : 0;
  const title = node.kind === "folder" ? "Pasta" : node.kind === "marker" ? "Marcador" : node.kind === "polygon" ? "Polígono" : "Caminho";

  return (
    <section className="earth-panel">
      <header className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">{title}</span>
        <button className="earth-icon-btn" onClick={onClose} aria-label="Fechar"><X className="size-4" /></button>
      </header>

      <Field label="Nome">
        <input className="earth-input w-full" value={node.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <Field label="Descrição">
        <textarea className="earth-input min-h-16 w-full" value={node.description} onChange={(e) => onChange({ description: e.target.value })} />
      </Field>

      {node.kind === "folder" && <p className="text-xs text-muted-foreground">{count} itens dentro desta pasta</p>}

      {feature?.kind === "marker" && pt && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Latitude">
              <input type="number" step="any" className="earth-input w-full font-mono" value={pt.lat}
                onChange={(e) => onChange({ coords: [{ ...pt, lat: parseFloat(e.target.value) || 0 }] })} />
            </Field>
            <Field label="Longitude">
              <input type="number" step="any" className="earth-input w-full font-mono" value={pt.lng}
                onChange={(e) => onChange({ coords: [{ ...pt, lng: parseFloat(e.target.value) || 0 }] })} />
            </Field>
          </div>
          <Field label="Ícone">
            <div className="flex gap-1">
              {ICONS.map((i) => (
                <button key={i.id} data-active={feature.style.icon === i.id} className="earth-chip" onClick={() => setStyle({ icon: i.id })}>{i.label}</button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-[auto_1fr] items-end gap-3">
            <Field label="Cor"><input type="color" className="earth-color" value={feature.style.color} onChange={(e) => setStyle({ color: e.target.value })} /></Field>
            <Field label="Tamanho"><Range value={feature.style.scale} min={0.5} max={3} step={0.1} onChange={(v) => setStyle({ scale: v })} /></Field>
          </div>
        </>
      )}

      {feature && feature.kind !== "marker" && (
        <>
          <div className="grid grid-cols-[auto_1fr] items-end gap-3">
            <Field label="Linha"><input type="color" className="earth-color" value={feature.style.color} onChange={(e) => setStyle({ color: e.target.value })} /></Field>
            <Field label="Largura"><Range value={feature.style.strokeWidth} min={0} max={12} step={0.5} onChange={(v) => setStyle({ strokeWidth: v })} /></Field>
          </div>
          <Field label="Opacidade da linha"><Range value={feature.style.strokeOpacity} min={0} max={1} step={0.05} onChange={(v) => setStyle({ strokeOpacity: v })} /></Field>
          {feature.kind === "polygon" && (
            <div className="grid grid-cols-[auto_1fr] items-end gap-3">
              <Field label="Preench."><input type="color" className="earth-color" value={feature.style.fillColor} onChange={(e) => setStyle({ fillColor: e.target.value })} /></Field>
              <Field label="Opacidade"><Range value={feature.style.fillOpacity} min={0} max={1} step={0.05} onChange={(v) => setStyle({ fillOpacity: v })} /></Field>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{feature.coords.length} vértices · arraste os pontos no mapa para editar</p>
        </>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {feature?.kind === "polygon" && onFtth && (
          <button className="earth-btn-primary w-full justify-center" onClick={onFtth}>Editar cálculo FTTH</button>
        )}
        <button className="earth-btn" onClick={onZoom}><Crosshair className="size-4" /> Ir</button>
        <button className="earth-btn" onClick={() => onExport("kmz")}><Download className="size-4" /> KMZ</button>
        <button className="earth-btn-danger ml-auto" onClick={onDelete}><Trash2 className="size-4" /> Excluir</button>
      </div>
    </section>
  );
}
