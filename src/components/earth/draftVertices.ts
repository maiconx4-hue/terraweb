import type { LatLng } from "@/lib/geo/types";

/** Mounted only after the Google Maps browser API is ready. */
export function showDraftVertices(google: any, map: any, coords: LatLng[]) {
  class Vertices extends google.maps.OverlayView {
    elements: HTMLDivElement[] = [];
    onAdd() {
      const pane = this.getPanes()?.overlayLayer;
      if (!pane) return;
      this.elements = coords.map((_, i) => {
        const element = document.createElement("div");
        element.className = "earth-draft-vertex";
        element.setAttribute("aria-hidden", "true");
        if (i === coords.length - 1) element.classList.add("earth-draft-vertex-new");
        pane.appendChild(element);
        return element;
      });
    }
    draw() {
      const projection = this.getProjection();
      if (!projection) return;
      coords.forEach((point, i) => {
        const pixel = projection.fromLatLngToDivPixel(new google.maps.LatLng(point.lat, point.lng));
        const element = this.elements[i];
        if (!pixel || !element) return;
        element.style.left = `${pixel.x}px`;
        element.style.top = `${pixel.y}px`;
      });
    }
    onRemove() { this.elements.forEach((element) => element.remove()); this.elements = []; }
  }
  const overlay = new Vertices();
  overlay.setMap(map);
  return () => overlay.setMap(null);
}