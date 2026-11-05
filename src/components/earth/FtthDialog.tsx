import { useState } from "react";
import { X, Copy, AlertTriangle, CheckCircle2, Ruler } from "lucide-react";
import { toast } from "sonner";
import {
  CTO_CAPACITY, MAX_CELL_LENGTH_M, RECOMMENDED_MAX, RECOMMENDED_MIN,
  displayRate, fmtM, ftthDescription, ftthTitle, rateStatus, rawRate,
} from "@/lib/geo/ftth";

interface Props {
  currentName: string;
  currentDescription: string;
  initialResidences: number | null;
  shapeLength: number;
  savedMeasure: number | null;
  onApply: (name: string, description: string) => void;
  onClose: () => void;
}

const copy = async (t: string, what: string) => {
  try { await navigator.clipboard.writeText(t); toast.success(`${what} copiado`); }
  catch { toast.error("Não foi possível copiar"); }
};

export function FtthDialog(p: Props) {
  const [res, setRes] = useState(p.initialResidences ? String(p.initialResidences) : "");
  const [ctos, setCtos] = useState(1);
  const initLen = p.savedMeasure ?? (p.shapeLength > 0 ? Math.round(p.shapeLength) : 0);
  const [len, setLen] = useState(initLen ? String(initLen) : "");
  const [preview, setPreview] = useState(false);

  const r = parseInt(res, 10);
  const l = parseFloat(len.replace(",", "."));
  const valid = r > 0 && l > 0;
  const rate = valid ? displayRate(r, ctos) : 0;
  const status = rateStatus(rate);
  const title = valid ? ftthTitle(r) : "";
  const desc = valid ? ftthDescription(r, ctos, l) : "";

  return (
    <div className="earth-modal-backdrop" onClick={p.onClose}>
      <div className="earth-modal" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between">
          <span className="text-sm font-semibold text-primary">Cálculo de célula FTTH</span>
          <button className="earth-icon-btn" onClick={p.onClose} aria-label="Fechar"><X className="size-4" /></button>
        </header>

        {!preview ? (
          <>
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Nº de residências contadas</span>
              <input type="number" min={1} className="earth-input w-full" value={res} onChange={(e) => setRes(e.target.value)} autoFocus />
            </label>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">CTOs (1 CTO = {CTO_CAPACITY} residências)</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button key={n} className="earth-chip flex-1" data-active={ctos === n} onClick={() => setCtos(n)}>{n}</button>
                ))}
              </div>
            </div>
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Comprimento da célula (m)</span>
              <input type="text" inputMode="decimal" className="earth-input w-full" value={len} onChange={(e) => setLen(e.target.value)} />
              <span className="flex flex-wrap gap-1 pt-1">
                {p.shapeLength > 0 && <button className="earth-chip" onClick={() => setLen(String(Math.round(p.shapeLength)))}>Da forma: {Math.round(p.shapeLength)} m</button>}
                {p.savedMeasure != null && <button className="earth-chip" onClick={() => setLen(String(p.savedMeasure))}><Ruler className="inline size-3" /> Régua: {fmtM(p.savedMeasure)} m</button>}
              </span>
            </label>

            {valid && (
              <div className="space-y-2 rounded-md border border-border p-2 text-xs">
                <div className="flex items-center gap-2">
                  {status === "ok" ? <CheckCircle2 className="size-4 text-primary" /> : <AlertTriangle className="size-4 text-destructive" />}
                  <span>
                    Taxa {rawRate(r, ctos).toFixed(1).replace(".", ",")}% → {rate}%
                    {status !== "ok" && ` · fora da faixa recomendada (${RECOMMENDED_MIN}–${RECOMMENDED_MAX}%)`}
                  </span>
                </div>
                {l > MAX_CELL_LENGTH_M && (
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="size-4" /> Comprimento acima de {MAX_CELL_LENGTH_M} m
                  </div>
                )}
                <Out label="Título" value={title} />
                <Out label="Descrição" value={desc} />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button className="earth-btn" onClick={p.onClose}>Cancelar</button>
              <button className="earth-btn-primary" disabled={!valid} onClick={() => setPreview(true)}>Recalcular…</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Confira antes de substituir:</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="space-y-1"><b>Antes</b><pre className="earth-pre">{p.currentName}{"\n\n"}{p.currentDescription || "(vazio)"}</pre></div>
              <div className="space-y-1"><b>Depois</b><pre className="earth-pre">{title}{"\n\n"}{desc}</pre></div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="earth-btn" onClick={() => setPreview(false)}>Voltar</button>
              <button className="earth-btn" onClick={p.onClose}>Cancelar</button>
              <button className="earth-btn-primary" onClick={() => { p.onApply(title, desc); p.onClose(); }}>Aplicar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Out({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <button className="earth-icon-btn" onClick={() => copy(value, label)} aria-label={`Copiar ${label}`}><Copy className="size-3.5" /></button>
      </div>
      <pre className="earth-pre">{value}</pre>
    </div>
  );
}
