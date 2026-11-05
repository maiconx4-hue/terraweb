import { describe, expect, it } from "vitest";
import { displayRate, ftthDescription, ftthTitle, polygonCellLength, rateStatus, rawRate } from "@/lib/geo/ftth";

describe("FTTH rules", () => {
  it("19 residences, 1 CTO, 180 m", () => {
    expect(rawRate(19, 1)).toBeCloseTo(42.105, 2);
    expect(displayRate(19, 1)).toBe(42);
    expect(ftthDescription(19, 1, 180)).toBe("TAXA DE PENETRAÇÃO: 42% 1CTO\nTM DA CÉLULA: 180M / 2 = 90M - UM");
  });
  it("19 residences, 2 CTOs → 84%", () => expect(displayRate(19, 2)).toBe(84));
  it("caps at 100%", () => expect(displayRate(6, 1)).toBe(100));
  it("rounds half up consistently", () => {
    expect(displayRate(16, 1)).toBe(50); // exact
    expect(displayRate(80, 5)).toBe(50);
    expect(displayRate(32, 1)).toBe(25); // 25.0
    expect(displayRate(64, 1)).toBe(13); // 12.5 → 13
  });
  it("title keeps real residences", () => expect(ftthTitle(19)).toBe("Nº RESIDÊNCIAS: 19"));
  it("recommended range is only a status", () => {
    expect(rateStatus(39)).toBe("low");
    expect(rateStatus(40)).toBe("ok");
    expect(rateStatus(60)).toBe("ok");
    expect(rateStatus(61)).toBe("high");
  });
  it("odd length halves", () => expect(ftthDescription(10, 1, 175)).toContain("175M / 2 = 87,5M - UM"));
  it("rectangle length ≈ long side", () => {
    // ~200m x ~100m near equator
    const dLat = 100 / 111195, dLng = 200 / 111195;
    const rect = [{ lat: 0, lng: 0 }, { lat: 0, lng: dLng }, { lat: dLat, lng: dLng }, { lat: dLat, lng: 0 }];
    expect(Math.round(polygonCellLength(rect))).toBe(200);
  });
});
