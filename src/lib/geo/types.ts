export type FeatureKind = "marker" | "polygon" | "path";
export type IconShape = "triangle" | "pin" | "circle" | "square" | "star";
export const TRIANGLE_ICON_URL = "http://maps.google.com/mapfiles/kml/shapes/triangle.png";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface FeatureStyle {
  color: string; // stroke / icon color (#rrggbb)
  strokeOpacity: number; // 0..1
  strokeWidth: number;
  fillColor: string;
  fillOpacity: number; // 0..1
  scale: number;
  icon: IconShape;
}

export interface FolderNode {
  id: string;
  kind: "folder";
  name: string;
  description: string;
  parentId: string | null;
  visible: boolean;
  open: boolean;
}

export interface FeatureNode {
  id: string;
  kind: FeatureKind;
  name: string;
  description: string;
  parentId: string | null;
  visible: boolean;
  coords: LatLng[];
  style: FeatureStyle;
}

export type GeoNode = FolderNode | FeatureNode;

export const isFeature = (n: GeoNode): n is FeatureNode => n.kind !== "folder";

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function defaultStyle(kind: FeatureKind): FeatureStyle {
  if (kind === "marker")
    return { color: "#ffffff", strokeOpacity: 1, strokeWidth: 1, fillColor: "#ffffff", fillOpacity: 1, scale: 0.8, icon: "triangle" };
  if (kind === "polygon")
    return { color: "#0000ff", strokeOpacity: 1, strokeWidth: 2, fillColor: "#0000ff", fillOpacity: 0.3, scale: 1, icon: "pin" };
  return { color: "#f97316", strokeOpacity: 1, strokeWidth: 3, fillColor: "#f97316", fillOpacity: 0, scale: 1, icon: "pin" };
}

/** IDs of a node and all its descendants. */
export function descendantIds(nodes: GeoNode[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parentId && out.has(n.parentId) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

export interface Filter {
  text: string;
  kinds: Record<FeatureKind, boolean>;
}

export function passesFilter(f: FeatureNode, filter: Filter) {
  if (!filter.kinds[f.kind]) return false;
  const t = filter.text.trim().toLowerCase();
  if (!t) return true;
  return f.name.toLowerCase().includes(t) || f.description.toLowerCase().includes(t);
}

/** Feature is shown on the map when it and every ancestor folder are visible and it passes the filter. */
export function isShown(nodes: GeoNode[], f: FeatureNode, filter: Filter) {
  if (!f.visible || !passesFilter(f, filter)) return false;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let p = f.parentId ? byId.get(f.parentId) : undefined;
  while (p) {
    if (!p.visible) return false;
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return true;
}
