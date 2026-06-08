/**
 * AirNow server function — fetches live PM2.5 + Ozone observations from the
 * EPA AirNow API. Requires AIRNOW_API_KEY (free from docs.airnowapi.org).
 * Runs server-side to keep the key out of the browser and bypass CORS.
 */
import { createServerFn } from "@tanstack/react-start";

export type AirNowObs = {
  lat: number;
  lng: number;
  parameter: string;
  aqi: number;
  category: string;
  site: string;
  agency: string;
  utc: string;
};

const CATEGORY: Record<number, string> = {
  1: "Good",
  2: "Moderate",
  3: "Unhealthy for Sensitive Groups",
  4: "Unhealthy",
  5: "Very Unhealthy",
  6: "Hazardous",
};

export const fetchAirNow = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env.AIRNOW_API_KEY;
  if (!key) return { error: "AIRNOW_API_KEY not configured", observations: [] as AirNowObs[] };

  // Southern California bounding box (LA / Ventura / OC / SD).
  // AirNow expects minLon,minLat,maxLon,maxLat
  const bbox = "-120.0,32.5,-117.0,34.8";
  const url =
    `https://www.airnowapi.org/aq/data/?startDate=&endDate=` +
    `&parameters=PM25,OZONE&BBOX=${bbox}` +
    `&dataType=A&format=application/json&verbose=1&monitorType=2&API_KEY=${key}`;

  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return { error: `AirNow ${res.status}`, observations: [] as AirNowObs[] };
    const raw = (await res.json()) as Array<{
      Latitude: number; Longitude: number; Parameter: string; AQI: number;
      Category: number; SiteName: string; AgencyName: string; UTC: string;
    }>;
    // Deduplicate: keep the most recent observation per site+parameter.
    const byKey = new Map<string, AirNowObs>();
    for (const r of raw) {
      if (typeof r.AQI !== "number" || r.AQI < 0) continue;
      const k = `${r.SiteName}|${r.Parameter}`;
      const prev = byKey.get(k);
      if (!prev || new Date(r.UTC) > new Date(prev.utc)) {
        byKey.set(k, {
          lat: r.Latitude, lng: r.Longitude, parameter: r.Parameter,
          aqi: r.AQI, category: CATEGORY[r.Category] ?? "Unknown",
          site: r.SiteName, agency: r.AgencyName, utc: r.UTC,
        });
      }
    }
    return { error: null, observations: Array.from(byKey.values()) };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Network error",
      observations: [] as AirNowObs[],
    };
  }
});
