import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EarthApp from "@/components/earth/EarthApp";

vi.mock("@/components/earth/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/earth/Properties", () => ({ Properties: () => null }));
vi.mock("@/components/earth/FtthDialog", () => ({ FtthDialog: () => null }));

type Listener = (...args: unknown[]) => void;
let map: FakeMap;
class Events {
  listeners = new Map<string, Set<Listener>>();
  addListener(name: string, fn: Listener) {
    const listeners = this.listeners.get(name) ?? new Set<Listener>();
    listeners.add(fn);
    this.listeners.set(name, listeners);
    return { remove: () => listeners.delete(fn) };
  }
  emit(name: string, ...args: unknown[]) { this.listeners.get(name)?.forEach((fn) => fn(...args)); }
}
class FakeMap extends Events {
  pane = document.createElement("div");
  constructor(element: HTMLElement) { super(); map = this; element.appendChild(this.pane); }
  setOptions() {}
  setMapTypeId() {}
  getStreetView() { return new Events(); }
}
class Shape extends Events {
  coords: { lat: number; lng: number }[];
  map: unknown;
  constructor(opts: { path?: Shape["coords"]; paths?: Shape["coords"]; map?: unknown }) {
    super(); this.coords = opts.path ?? opts.paths ?? []; this.map = opts.map;
  }
  getPath() {
    return { getArray: () => this.coords.map((p) => ({ lat: () => p.lat, lng: () => p.lng })), addListener: () => ({ remove() {} }) };
  }
  setPath(coords: Shape["coords"]) { this.coords = coords; }
  setOptions() {}
  setMap(value: unknown) { this.map = value; }
  getMap() { return this.map; }
}
class Overlay {
  onAdd?(): void;
  draw?(): void;
  onRemove?(): void;
  setMap(value: unknown) { if (value) { this.onAdd?.(); this.draw?.(); } else this.onRemove?.(); }
  getPanes() { return { overlayMouseTarget: map.pane, overlayLayer: map.pane }; }
  getProjection() { return { fromLatLngToDivPixel: () => ({ x: 100, y: 100 }) }; }
}
function clickPoint(lat: number, lng: number) {
  act(() => map.emit("click", { latLng: { lat: () => lat, lng: () => lng } }));
}
function savedPolygons() {
  return JSON.parse(localStorage.getItem("earth-web-nodes-v1") ?? "[]").filter((n: { kind: string }) => n.kind === "polygon");
}

beforeEach(() => {
  localStorage.clear();
  window.google = { maps: { Map: FakeMap, Polygon: Shape, Polyline: Shape, OverlayView: Overlay,
    LatLng: class { constructor(public lat: number, public lng: number) {} },
    InfoWindow: class { close() {} }, event: { clearInstanceListeners() {} } } };
});
afterEach(() => { cleanup(); delete window.google; });

describe("Polygon drawing", () => {
  it("creates exactly one polygon when completed in StrictMode", async () => {
    render(<StrictMode><EarthApp /></StrictMode>);
    await waitFor(() => expect(map).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Polígono", exact: true }));
    clickPoint(-23, -46); clickPoint(-23.001, -46); clickPoint(-23.001, -46.001);
    fireEvent.click(screen.getByRole("button", { name: "Concluir", exact: true }));
    await waitFor(() => expect(savedPolygons()).toHaveLength(1));
    expect(savedPolygons()[0].coords).toHaveLength(3);
  });
});