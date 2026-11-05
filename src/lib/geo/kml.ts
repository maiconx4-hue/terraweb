import JSZip from "jszip";
import { defaultStyle, uid, type FeatureKind, type FeatureNode, type FeatureStyle, type GeoNode, type LatLng } from "./types";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** #rrggbb + opacity -> KML aabbggrr */
export function hexToKml(hex: string, opacity: number): string {
  const h = hex.replace("#", "").padEnd(6, "0");
  const a = Math.round(clamp01(opacity) * 255).toString(16).padStart(2, "0");
  return (a + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2)).toLowerCase();
}

/** KML aabbggrr -> #rrggbb + opacity */
export function kmlToHex(kml: string): { color: string; opacity: number } {
  const s = kml.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{8}$/.test(s)) return { color: "#ffffff", opacity: 1 };
  const a = s.slice(0, 2), b = s.slice(2, 4), g = s.slice(4, 6), r = s.slice(6, 8);
  return { color: `#${r}${g}${b}`.toLowerCase(), opacity: Math.round((parseInt(a, 16) / 255) * 100) / 100 };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const coordStr = (c: LatLng[]) => c.map((p) => `${p.lng},${p.lat},0`).join(" ");

function placemark(f: FeatureNode, ind: string): string {
  const s = f.style;
  let style = "";
  let geom = "";
  if (f.kind === "marker") {
    style = `<IconStyle><color>${hexToKml(s.color, 1)}</color><scale>${s.scale}</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle>`;
    geom = `<Point><coordinates>${coordStr(f.coords.slice(0, 1))}</coordinates></Point>`;
  } else if (f.kind === "path") {
    style = `<LineStyle><color>${hexToKml(s.color, s.strokeOpacity)}</color><width>${s.strokeWidth}</width></LineStyle>`;
    geom = `<LineString><tessellate>1</tessellate><coordinates>${coordStr(f.coords)}</coordinates></LineString>`;
  } else {
    const ring = [...f.coords];
    const a0 = ring[0], aN = ring[ring.length - 1];
    if (a0 && aN && (a0.lat !== aN.lat || a0.lng !== aN.lng)) ring.push(a0);
    style = `<LineStyle><color>${hexToKml(s.color, s.strokeOpacity)}</color><width>${s.strokeWidth}</width></LineStyle><PolyStyle><color>${hexToKml(s.fillColor, s.fillOpacity)}</color></PolyStyle>`;
    geom = `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${coordStr(ring)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  }
  return `${ind}<Placemark><name>${esc(f.name)}</name>${f.description ? `<description>${esc(f.description)}</description>` : ""}<visibility>${f.visible ? 1 : 0}</visibility><Style>${style}</Style>${geom}</Placemark>\n`;
}

export function buildKml(nodes: GeoNode[], docName = "Meus lugares", rootId: string | null = null): string {
  const walk = (parentId: string | null, depth: number): string => {
    const ind = "  ".repeat(depth);
    let out = "";
    for (const n of nodes.filter((x) => x.parentId === parentId)) {
      if (n.kind === "folder") {
        out += `${ind}<Folder><name>${esc(n.name)}</name><visibility>${n.visible ? 1 : 0}</visibility><open>${n.open ? 1 : 0}</open>\n${walk(n.id, depth + 1)}${ind}</Folder>\n`;
      } else out += placemark(n, ind);
    }
    return out;
  };
  let body: string;
  if (rootId) {
    const root = nodes.find((n) => n.id === rootId);
    body = root && root.kind !== "folder" ? placemark(root, "  ") : walk(rootId, 1);
  } else body = walk(null, 1);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document><name>${esc(docName)}</name>\n${body}</Document>\n</kml>\n`;
}

export async function buildKmz(kml: string): Promise<Blob> {
  const zip = new JSZip();
  zip.file("doc.kml", kml);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.google-earth.kmz" });
}

// ---------- parsing ----------
const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
const kid = (el: Element, name: string) => kids(el, name)[0];
const deep = (el: Element, name: string) => Array.from(el.getElementsByTagNameNS("*", name));
const text = (el: Element | undefined) => el?.textContent?.trim() ?? "";

function parseCoords(s: string): LatLng[] {
  return s
    .trim()
    .split(/\s+/)
    .map((t) => t.split(",").map(Number))
    .filter((p) => p.length >= 2 && !isNaN(p[0]!) && !isNaN(p[1]!))
    .map((p) => ({ lat: p[1]!, lng: p[0]! }));
}

type PartialStyle = Partial<FeatureStyle>;
function parseStyle(el: Element | undefined): PartialStyle {
  const st: PartialStyle = {};
  if (!el) return st;
  const icon = deep(el, "IconStyle")[0];
  if (icon) {
    const c = text(kid(icon, "color"));
    if (c) st.color = kmlToHex(c).color;
    const sc = parseFloat(text(kid(icon, "scale")));
    if (!isNaN(sc)) st.scale = sc;
  }
  const line = deep(el, "LineStyle")[0];
  if (line) {
    const c = text(kid(line, "color"));
    if (c) {
      const { color, opacity } = kmlToHex(c);
      st.color = color;
      st.strokeOpacity = opacity;
    }
    const w = parseFloat(text(kid(line, "width")));
    if (!isNaN(w)) st.strokeWidth = w;
  }
  const poly = deep(el, "PolyStyle")[0];
  if (poly) {
    const c = text(kid(poly, "color"));
    if (c) {
      const { color, opacity } = kmlToHex(c);
      st.fillColor = color;
      st.fillOpacity = opacity;
    }
    if (text(kid(poly, "fill")) === "0") st.fillOpacity = 0;
  }
  return st;
}

export function parseKml(xml: string, importName = "Importado"): GeoNode[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Arquivo KML inválido");
  const styles = new Map<string, PartialStyle>();
  for (const s of deep(doc.documentElement, "Style")) {
    const id = s.getAttribute("id");
    if (id) styles.set(id, parseStyle(s));
  }
  for (const m of deep(doc.documentElement, "StyleMap")) {
    const id = m.getAttribute("id");
    if (!id) continue;
    const pair = kids(m, "Pair").find((p) => text(kid(p, "key")) === "normal") ?? kids(m, "Pair")[0];
    if (!pair) continue;
    const url = text(kid(pair, "styleUrl")).replace(/^.*#/, "");
    const inline = kid(pair, "Style");
    styles.set(id, inline ? parseStyle(inline) : styles.get(url) ?? {});
  }

  const out: GeoNode[] = [];
  const rootId = uid();
  out.push({ id: rootId, kind: "folder", name: importName, description: "", parentId: null, visible: true, open: true });

  const visible = (el: Element) => text(kid(el, "visibility")) !== "0";

  const addPlacemark = (pm: Element, parentId: string) => {
    const name = text(kid(pm, "name")) || "Sem nome";
    const description = text(kid(pm, "description"));
    const url = text(kid(pm, "styleUrl")).replace(/^.*#/, "");
    const st: PartialStyle = { ...(styles.get(url) ?? {}), ...parseStyle(kid(pm, "Style")) };
    const geoms: { kind: FeatureKind; coords: LatLng[] }[] = [];
    for (const p of deep(pm, "Point")) geoms.push({ kind: "marker", coords: parseCoords(text(deep(p, "coordinates")[0])) });
    for (const l of deep(pm, "LineString")) geoms.push({ kind: "path", coords: parseCoords(text(deep(l, "coordinates")[0])) });
    for (const g of deep(pm, "Polygon")) {
      const outer = deep(g, "outerBoundaryIs")[0] ?? g;
      const c = parseCoords(text(deep(outer, "coordinates")[0]));
      const c0 = c[0], cN = c[c.length - 1];
      if (c.length > 1 && c0 && cN && c0.lat === cN.lat && c0.lng === cN.lng) c.pop();
      geoms.push({ kind: "polygon", coords: c });
    }
    geoms
      .filter((g) => g.coords.length)
      .forEach((g, i) => {
        const base = defaultStyle(g.kind);
        const style: FeatureStyle = { ...base, ...st };
        if (g.kind === "marker" && st.color) style.fillColor = st.color;
        out.push({
          id: uid(),
          kind: g.kind,
          name: geoms.length > 1 ? `${name} (${i + 1})` : name,
          description,
          parentId,
          visible: visible(pm),
          coords: g.coords,
          style,
        });
      });
  };

  const walk = (el: Element, parentId: string) => {
    for (const c of Array.from(el.children)) {
      if (c.localName === "Folder" || c.localName === "Document") {
        const id = uid();
        out.push({ id, kind: "folder", name: text(kid(c, "name")) || "Pasta", description: text(kid(c, "description")), parentId, visible: visible(c), open: false });
        walk(c, id);
      } else if (c.localName === "Placemark") addPlacemark(c, parentId);
    }
  };

  const top = doc.documentElement;
  const docs = kids(top, "Document");
  if (docs.length === 1) {
    const n = text(kid(docs[0]!, "name"));
    if (n) (out[0] as { name: string }).name = n;
    walk(docs[0]!, rootId);
  } else walk(top, rootId);
  return out;
}

export async function readGeoFile(file: File): Promise<GeoNode[]> {
  const base = file.name.replace(/\.(kmz|kml)$/i, "");
  if (/\.kmz$/i.test(file.name)) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => /\.kml$/i.test(n));
    const name = names.find((n) => /doc\.kml$/i.test(n)) ?? names[0];
    if (!name) throw new Error("KMZ sem arquivo KML");
    return parseKml(await zip.files[name]!.async("string"), base);
  }
  return parseKml(await file.text(), base);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
