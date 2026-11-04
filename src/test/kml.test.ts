import { describe, expect, it } from "vitest";
import { buildKml, hexToKml, kmlToHex, parseKml } from "@/lib/geo/kml";
import { defaultStyle, type GeoNode } from "@/lib/geo/types";

describe("KML colors", () => {
  it("converts #rrggbb to aabbggrr", () => {
    expect(hexToKml("#ff8000", 1)).toBe("ff0080ff");
    expect(hexToKml("#ff8000", 0.5)).toBe("800080ff");
  });
  it("converts aabbggrr back", () => {
    expect(kmlToHex("ff0080ff")).toEqual({ color: "#ff8000", opacity: 1 });
  });
});

describe("KML roundtrip", () => {
  it("keeps nested folders, geometry and style", () => {
    const nodes: GeoNode[] = [
      { id: "f1", kind: "folder", name: "Pasta A", description: "", parentId: null, visible: true, open: true },
      { id: "f2", kind: "folder", name: "Sub B", description: "", parentId: "f1", visible: true, open: true },
      {
        id: "p1", kind: "polygon", name: "Área", description: "x", parentId: "f2", visible: true,
        coords: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 }],
        style: { ...defaultStyle("polygon"), fillColor: "#00ff00", fillOpacity: 0.5 },
      },
    ];
    const back = parseKml(buildKml(nodes, "Doc"));
    const folderA = back.find((n) => n.name === "Pasta A")!;
    const sub = back.find((n) => n.name === "Sub B")!;
    const poly = back.find((n) => n.name === "Área")!;
    expect(sub.parentId).toBe(folderA.id);
    expect(poly.parentId).toBe(sub.id);
    expect(poly.kind).toBe("polygon");
    if (poly.kind === "polygon") {
      expect(poly.coords).toHaveLength(3);
      expect(poly.style.fillColor).toBe("#00ff00");
      expect(poly.style.fillOpacity).toBe(0.5);
    }
  });
});
