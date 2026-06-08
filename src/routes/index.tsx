/**
 * CoastWatch — Local Coastal & Environmental Tracker
 *
 * A civic-tech map for Southern California shoreline health:
 *   - Crowdsourced pollution reports (verified server-side, persisted in Lovable Cloud)
 *   - Live overlays from public environmental data sources (toggleable layers)
 *
 * Leaflet is loaded from CDN at runtime to avoid SSR `window is not defined` errors.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { submitReport } from "@/lib/reports.functions";
import { fetchAirNow } from "@/lib/airnow.functions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type L = any;
declare global { interface Window { L?: L } }

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CoastWatch — Coastal & Environmental Tracker" },
      { name: "description", content: "Civic-tech dashboard for tracking pollution reports, beach water quality, air quality, and environmental burden along the California coast." },
    ],
    links: [
      { rel: "stylesheet", href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" },
    ],
  }),
  component: CoastWatch,
});

// ---------- Types ----------
type Report = {
  id: string;
  lat: number;
  lng: number;
  debris_type: string;
  severity: number;
  description: string;
  reporter: string | null;
  created_at: string;
};

type LayerKey =
  | "reports"
  | "beachGrades"
  | "airQuality"
  | "calEnviroScreen"
  | "calEPASites"
  | "safeToSwim";

type LayerMeta = {
  key: LayerKey;
  name: string;
  source: string;
  color: string;
  defaultOn: boolean;
};

const LAYERS: LayerMeta[] = [
  { key: "reports",         name: "Community pollution reports", source: "CoastWatch (verified user reports)",                        color: "#dc2626", defaultOn: true  },
  { key: "beachGrades",     name: "Beach water-quality grades",   source: "Heal the Bay Beach Report Card",                            color: "#059669", defaultOn: true  },
  { key: "airQuality",      name: "PM2.5 air quality",            source: "OpenAQ (real-time, no key)",                                color: "#a855f7", defaultOn: false },
  { key: "safeToSwim",      name: "Safe to Swim monitoring sites",source: "CA Water Quality Monitoring Council",                       color: "#0891b2", defaultOn: false },
  { key: "calEnviroScreen", name: "CalEnviroScreen burden score", source: "OEHHA CalEnviroScreen 4.0",                                 color: "#d97706", defaultOn: false },
  { key: "calEPASites",     name: "CalEPA regulated sites",       source: "CalEPA Regulated Site Portal",                              color: "#475569", defaultOn: false },
];

const DEFAULT_CENTER: [number, number] = [33.9103, -118.5193]; // Santa Monica Bay
const DEFAULT_ZOOM = 11;

// ---------- Component ----------
function CoastWatch() {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const map = useRef<L | null>(null);
  const dropPin = useRef<L | null>(null); // red draggable marker for the user's selected point
  const layerGroups = useRef<Record<LayerKey, L | null>>({
    reports: null, beachGrades: null, airQuality: null,
    calEnviroScreen: null, calEPASites: null, safeToSwim: null,
  });
  const ready = useRef(false);

  const [reports, setReports] = useState<Report[]>([]);
  const [enabled, setEnabled] = useState<Record<LayerKey, boolean>>(
    () => Object.fromEntries(LAYERS.map(l => [l.key, l.defaultOn])) as Record<LayerKey, boolean>
  );
  const [tab, setTab] = useState<"report" | "recent">("report");

  // Form state
  const [form, setForm] = useState({
    lat: "" as string, lng: "" as string,
    debris_type: "Plastic bottles",
    severity: 3,
    description: "",
    reporter: "",
  });
  const [status, setStatus] = useState<{ kind: "info" | "success" | "error"; msg: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = useServerFn(submitReport);

  // ---- Load Leaflet from CDN ----
  useEffect(() => {
    if (typeof window === "undefined") return;
    const init = () => {
      if (!mapEl.current || map.current || !window.L) return;
      const L = window.L;
      map.current = L.map(mapEl.current, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19,
      }).addTo(map.current);

      // Click to drop a red pin and pre-fill form coordinates
      map.current.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        placeDropPin(e.latlng.lat, e.latlng.lng);
        setTab("report");
      });

      // Initialize empty layer groups
      (Object.keys(layerGroups.current) as LayerKey[]).forEach(k => {
        layerGroups.current[k] = L.layerGroup();
        if (enabled[k]) layerGroups.current[k]!.addTo(map.current);
      });
      ready.current = true;
    };

    if (window.L) { init(); return; }
    const s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.async = true;
    s.onload = init;
    document.body.appendChild(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Load reports from Lovable Cloud ----
  const loadReports = useCallback(async () => {
    const { data, error } = await supabase
      .from("reports")
      .select("id,lat,lng,debris_type,severity,description,reporter,created_at")
      .eq("status", "approved")
      .order("created_at", { ascending: false });
    if (!error && data) setReports(data as Report[]);
  }, []);
  useEffect(() => { loadReports(); }, [loadReports]);

  // ---- Render report layer ----
  useEffect(() => {
    if (!ready.current || !window.L) return;
    const L = window.L;
    const group = layerGroups.current.reports;
    if (!group) return;
    group.clearLayers();
    reports.forEach(r => {
      const color = r.severity >= 4 ? "#dc2626" : r.severity === 3 ? "#d97706" : "#059669";
      L.circleMarker([r.lat, r.lng], {
        radius: 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.9,
      })
        .bindPopup(
          `<div class="popup-card">
            <h4>${escapeHtml(r.debris_type)} <span class="cw-sev cw-sev-${r.severity}">sev ${r.severity}</span></h4>
            <div class="meta">${new Date(r.created_at).toLocaleDateString()} &middot; ${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}</div>
            <div class="desc">${escapeHtml(r.description)}</div>
            ${r.reporter ? `<div class="meta" style="margin-top:.4rem">${escapeHtml(r.reporter)}</div>` : ""}
          </div>`
        )
        .addTo(group);
    });
  }, [reports]);

  // ---- Toggle layers on/off ----
  useEffect(() => {
    if (!ready.current || !map.current) return;
    (Object.keys(enabled) as LayerKey[]).forEach(k => {
      const g = layerGroups.current[k];
      if (!g) return;
      const isOn = map.current.hasLayer(g);
      if (enabled[k] && !isOn) g.addTo(map.current);
      if (!enabled[k] && isOn) map.current.removeLayer(g);
    });
  }, [enabled]);

  // ---- Lazy-load each overlay when first enabled ----
  const airNowFn = useServerFn(fetchAirNow);
  const loaded = useRef<Set<LayerKey>>(new Set(["reports"]));
  useEffect(() => {
    if (!ready.current) return;
    (Object.keys(enabled) as LayerKey[]).forEach(async (k) => {
      if (!enabled[k] || loaded.current.has(k)) return;
      loaded.current.add(k);
      try {
        await fetchOverlay(k, layerGroups.current[k]!, { airNow: airNowFn });
      } catch (e) {
        console.warn(`Layer ${k} failed to load`, e);
        loaded.current.delete(k);
      }
    });
  }, [enabled, airNowFn]);

  // ---- Submit handler ----
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const lat = parseFloat(form.lat);
    const lng = parseFloat(form.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setStatus({ kind: "error", msg: "Pick a point on the map or use the locate button." });
      return;
    }
    if (form.description.trim().length < 8) {
      setStatus({ kind: "error", msg: "Description must be at least 8 characters." });
      return;
    }
    setSubmitting(true);
    setStatus({ kind: "info", msg: "Verifying report (location + AI plausibility check)…" });
    try {
      const res = await submit({
        data: {
          lat, lng,
          debris_type: form.debris_type,
          severity: form.severity,
          description: form.description.trim(),
          reporter: form.reporter.trim() || null,
        },
      });
      if (res.status === "approved") {
        setStatus({ kind: "success", msg: res.message });
        setForm(f => ({ ...f, description: "" }));
        loadReports();
      } else {
        setStatus({ kind: "error", msg: res.message });
      }
    } catch (err) {
      setStatus({ kind: "error", msg: err instanceof Error ? err.message : "Submission failed." });
    } finally {
      setSubmitting(false);
    }
  }

  // Drop / move the red pin on the map, and sync form lat/lng.
  const placeDropPin = useCallback((lat: number, lng: number) => {
    setForm(f => ({ ...f, lat: lat.toFixed(5), lng: lng.toFixed(5) }));
    if (!map.current || !window.L) return;
    const L = window.L;
    const icon = L.divIcon({
      className: "cw-drop-pin",
      html: `<svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg"><path d="M16 1c8.3 0 15 6.6 15 14.7 0 11-15 25.3-15 25.3S1 26.7 1 15.7C1 7.6 7.7 1 16 1z" fill="#dc2626" stroke="#fff" stroke-width="2"/><circle cx="16" cy="15" r="5" fill="#fff"/></svg>`,
      iconSize: [32, 42],
      iconAnchor: [16, 41],
      popupAnchor: [0, -36],
    });
    if (dropPin.current) {
      dropPin.current.setLatLng([lat, lng]);
    } else {
      dropPin.current = L.marker([lat, lng], { icon, draggable: true, zIndexOffset: 1000 })
        .addTo(map.current)
        .bindPopup("Your selected report location.<br/>Drag to fine-tune.");
      dropPin.current.on("dragend", () => {
        const ll = dropPin.current.getLatLng();
        setForm(f => ({ ...f, lat: ll.lat.toFixed(5), lng: ll.lng.toFixed(5) }));
      });
    }
    dropPin.current.openPopup();
  }, []);

  function locate() {
    if (!navigator.geolocation) {
      setStatus({ kind: "error", msg: "Geolocation not available." }); return;
    }
    setStatus({ kind: "info", msg: "Requesting location…" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        placeDropPin(pos.coords.latitude, pos.coords.longitude);
        if (map.current) map.current.setView([pos.coords.latitude, pos.coords.longitude], 14);
        setStatus({ kind: "success", msg: "Location captured." });
      },
      () => setStatus({ kind: "error", msg: "Could not determine location." })
    );
  }

  // ---- Stats ----
  const stats = useMemo(() => {
    const total = reports.length;
    const plastic = reports.filter(r => /plastic|bottle|bag|straw|microplastic|foam|polystyrene/i.test(r.debris_type)).length;
    const highSev = reports.filter(r => r.severity >= 4).length;
    const locations = new Set(reports.map(r => `${r.lat.toFixed(2)},${r.lng.toFixed(2)}`)).size;
    return { total, plastic, highSev, locations };
  }, [reports]);

  // ---- Render ----
  return (
    <div className="cw">
      <div className="cw-shell">
        <header className="cw-topbar">
          <div className="cw-brand">
            <span className="cw-brand-mark" aria-hidden="true">
              <svg width="36" height="36" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="cwGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#0ea5b7"/>
                    <stop offset="100%" stopColor="#0a1929"/>
                  </linearGradient>
                </defs>
                <circle cx="20" cy="20" r="19" fill="url(#cwGrad)"/>
                <path d="M4 25c3-2 5-2 8 0s5 2 8 0 5-2 8 0 5 2 8 0v6H4z" fill="#38bdf8" opacity=".9"/>
                <path d="M4 21c3-2 5-2 8 0s5 2 8 0 5-2 8 0 5 2 8 0" fill="none" stroke="#e0f2fe" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M20 7c-3.6 0-6.5 2.8-6.5 6.4 0 4.8 6.5 10.6 6.5 10.6s6.5-5.8 6.5-10.6C26.5 9.8 23.6 7 20 7z" fill="#dc2626" stroke="#fff" strokeWidth="1.4"/>
                <circle cx="20" cy="13.4" r="2.2" fill="#fff"/>
              </svg>
            </span>
            <div>
              <span className="cw-brand-name">CoastWatch</span>
              <span className="cw-brand-sub">California Coastal Monitor</span>
            </div>
          </div>
          <div className="cw-top-meta">
            <span><span className="dot" />Live data</span>
            <span>{reports.length} verified reports</span>
          </div>
        </header>

        <aside className="cw-sidebar">
          <div className="cw-side-section">
            <div className="cw-side-title">Map layers</div>
            {LAYERS.map(l => (
              <label key={l.key} className="cw-layer">
                <input
                  type="checkbox"
                  checked={enabled[l.key]}
                  onChange={(e) => setEnabled(s => ({ ...s, [l.key]: e.target.checked }))}
                />
                <span>
                  <span className="cw-layer-name">
                    <span className="cw-swatch" style={{ background: l.color }} />
                    {l.name}
                  </span>
                  <span className="cw-layer-source">{l.source}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="cw-side-section">
            <div className="cw-side-title">Community impact</div>
            <div className="cw-stat-row">
              <div className="cw-stat"><div className="cw-stat-num">{stats.total}</div><div className="cw-stat-label">Reports</div></div>
              <div className="cw-stat"><div className="cw-stat-num">{stats.plastic}</div><div className="cw-stat-label">Plastic</div></div>
              <div className="cw-stat"><div className="cw-stat-num">{stats.highSev}</div><div className="cw-stat-label">High sev.</div></div>
              <div className="cw-stat"><div className="cw-stat-num">{stats.locations}</div><div className="cw-stat-label">Locations</div></div>
            </div>
          </div>

          <div className="cw-side-section">
            <div className="cw-side-title">About</div>
            <p style={{ fontSize: ".78rem", lineHeight: 1.5, color: "var(--slate-700)" }}>
              CoastWatch aggregates community pollution reports with public environmental data
              from federal, state, and NGO sources. Reports are verified by a geographic check
              and an automated plausibility review before publication.
            </p>
          </div>
        </aside>

        <main className="cw-main">
          <div ref={mapEl} className="cw-map" />
          <div className="cw-legend">
            <h5>Pollution severity</h5>
            <div className="cw-legend-row"><span className="cw-swatch" style={{ background: "#059669" }} /> Low (1–2)</div>
            <div className="cw-legend-row"><span className="cw-swatch" style={{ background: "#d97706" }} /> Moderate (3)</div>
            <div className="cw-legend-row"><span className="cw-swatch" style={{ background: "#dc2626" }} /> High (4–5)</div>
          </div>
        </main>

        <aside className="cw-rail">
          <div className="cw-rail-tabs">
            <button className={`cw-rail-tab ${tab === "report" ? "active" : ""}`} onClick={() => setTab("report")}>Submit Report</button>
            <button className={`cw-rail-tab ${tab === "recent" ? "active" : ""}`} onClick={() => setTab("recent")}>Recent ({reports.length})</button>
          </div>
          <div className="cw-rail-body">
            {tab === "report" ? (
              <form className="cw-form" onSubmit={onSubmit}>
                <p className="cw-help">Click the map to drop a pin, or use your device location. All submissions are verified server-side before they appear publicly.</p>
                <div className="cw-field-row">
                  <div className="cw-field">
                    <label>Latitude</label>
                    <input type="text" inputMode="decimal" value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))} placeholder="33.9103" required />
                  </div>
                  <div className="cw-field">
                    <label>Longitude</label>
                    <input type="text" inputMode="decimal" value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))} placeholder="-118.5193" required />
                  </div>
                </div>
                <button type="button" className="cw-btn cw-btn-ghost cw-btn-block" onClick={locate}>📍 Use my location</button>

                <div className="cw-field">
                  <label>Debris type</label>
                  <select value={form.debris_type} onChange={e => setForm(f => ({ ...f, debris_type: e.target.value }))}>
                    {["Plastic bottles","Plastic bags","Plastic straws","Cigarette butts","Food wrappers","Polystyrene foam","Fishing line","Fishing gear","Microplastics","Balloon debris","Glass","Metal","Other"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>

                <div className="cw-field">
                  <label>Severity ({form.severity}/5)</label>
                  <input type="range" min={1} max={5} value={form.severity} onChange={e => setForm(f => ({ ...f, severity: parseInt(e.target.value, 10) }))} />
                </div>

                <div className="cw-field">
                  <label>Description</label>
                  <textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What did you observe? Approximate quantity, condition, nearby landmarks…" required />
                </div>

                <div className="cw-field">
                  <label>Reporter name <span style={{ fontWeight: 400, textTransform: "none", color: "var(--slate-500)" }}>(optional)</span></label>
                  <input type="text" value={form.reporter} onChange={e => setForm(f => ({ ...f, reporter: e.target.value }))} placeholder="Your name or handle" />
                </div>

                <button type="submit" className="cw-btn cw-btn-primary cw-btn-block" disabled={submitting}>
                  {submitting ? "Verifying…" : "Submit for verification"}
                </button>

                {status && <div className={`cw-status ${status.kind}`}>{status.msg}</div>}
              </form>
            ) : (
              <div>
                {reports.length === 0 && <p className="cw-help">No reports yet. Be the first.</p>}
                {reports.slice(0, 25).map(r => (
                  <div key={r.id} className="cw-report-item">
                    <strong>{r.debris_type}</strong>
                    <span className={`cw-sev cw-sev-${r.severity}`}>sev {r.severity}</span>
                    <div className="meta">{new Date(r.created_at).toLocaleString()} · {r.lat.toFixed(3)}, {r.lng.toFixed(3)}</div>
                    <div style={{ marginTop: 4, color: "var(--slate-700)" }}>{r.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <footer className="cw-footer">
          <span>CoastWatch · Built for the Congressional App Challenge</span>
          <div className="cw-attribution">
            Data:&nbsp;
            <a href="https://beachreportcard.org" target="_blank" rel="noreferrer">Heal the Bay</a>
            <a href="https://openaq.org" target="_blank" rel="noreferrer">OpenAQ</a>
            <a href="https://oehha.ca.gov/calenviroscreen" target="_blank" rel="noreferrer">CalEnviroScreen</a>
            <a href="https://siteportal.calepa.ca.gov" target="_blank" rel="noreferrer">CalEPA</a>
            <a href="https://mywaterquality.ca.gov" target="_blank" rel="noreferrer">CA Water Quality</a>
            <a href="https://marinedebris.noaa.gov" target="_blank" rel="noreferrer">NOAA MDMAP</a>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---------- Overlay fetchers ----------
type OverlayCtx = { airNow: () => Promise<{ error: string | null; observations: Array<{ lat: number; lng: number; parameter: string; aqi: number; category: string; site: string; agency: string; utc: string }> }> };

async function fetchOverlay(key: LayerKey, group: L, ctx: OverlayCtx) {
  if (!window.L) return;
  const L = window.L;
  switch (key) {
    case "beachGrades":      return loadBeachGrades(L, group);
    case "airQuality":       return loadAirQuality(L, group, ctx);
    case "safeToSwim":       return loadSafeToSwim(L, group);
    case "calEnviroScreen":  return loadCalEnviroScreen(L, group);
    case "calEPASites":      return loadCalEPASites(L, group);
  }
}

// Heal the Bay grades — they don't publish a public CORS-enabled API, so we
// ship a curated snapshot of representative Southern California beach grades.
// Update by re-checking https://beachreportcard.org seasonally.
function loadBeachGrades(L: L, group: L) {
  const beaches: { name: string; lat: number; lng: number; grade: "A" | "B" | "C" | "D" | "F" }[] = [
    { name: "Santa Monica Pier",       lat: 34.0083, lng: -118.4988, grade: "F" },
    { name: "Will Rogers State Beach", lat: 34.0405, lng: -118.5611, grade: "A" },
    { name: "Venice Beach Pier",       lat: 33.9850, lng: -118.4695, grade: "B" },
    { name: "Dockweiler State Beach",  lat: 33.9425, lng: -118.4381, grade: "A" },
    { name: "Manhattan Beach Pier",    lat: 33.8847, lng: -118.4109, grade: "A" },
    { name: "Hermosa Beach Pier",      lat: 33.8623, lng: -118.4006, grade: "A" },
    { name: "Redondo Beach Pier",      lat: 33.8392, lng: -118.3942, grade: "B" },
    { name: "Cabrillo Beach (inner)",  lat: 33.7080, lng: -118.2810, grade: "D" },
    { name: "Long Beach (Belmont)",    lat: 33.7589, lng: -118.1450, grade: "C" },
    { name: "Newport Beach Pier",      lat: 33.6075, lng: -117.9290, grade: "A" },
    { name: "Huntington State Beach",  lat: 33.6325, lng: -117.9620, grade: "A" },
    { name: "Doheny State Beach",      lat: 33.4625, lng: -117.6855, grade: "C" },
    { name: "La Jolla Cove",           lat: 32.8504, lng: -117.2710, grade: "B" },
    { name: "Pacific Beach",           lat: 32.7960, lng: -117.2553, grade: "A" },
    { name: "Mission Beach",           lat: 32.7707, lng: -117.2520, grade: "A" },
    { name: "Ocean Beach Pier (SD)",   lat: 32.7497, lng: -117.2557, grade: "B" },
    { name: "Cardiff State Beach",     lat: 33.0140, lng: -117.2820, grade: "A" },
    { name: "Goleta Beach",            lat: 34.4170, lng: -119.8290, grade: "B" },
    { name: "Surfers Point Ventura",   lat: 34.2730, lng: -119.3000, grade: "B" },
  ];
  const gradeColor: Record<string, string> = { A: "#059669", B: "#65a30d", C: "#eab308", D: "#ea580c", F: "#dc2626" };
  beaches.forEach(b => {
    L.circleMarker([b.lat, b.lng], {
      radius: 11, color: "#fff", weight: 2, fillColor: gradeColor[b.grade], fillOpacity: 0.85,
    })
      .bindPopup(`<div class="popup-card"><h4>${escapeHtml(b.name)}</h4><div class="meta">Heal the Bay grade</div><div class="desc" style="font-size:1.4rem;font-weight:700;color:${gradeColor[b.grade]}">${b.grade}</div></div>`)
      .addTo(group);
  });
}

// OpenAQ — real-time PM2.5 measurements, free, no key required (CORS-enabled).
async function loadAirQuality(L: L, group: L) {
  const url = "https://api.openaq.org/v2/latest?parameter=pm25&limit=200&coordinates=33.8,-118.3&radius=100000";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json() as { results?: { coordinates?: { latitude: number; longitude: number }; location: string; measurements: { parameter: string; value: number; unit: string; lastUpdated: string }[] }[] };
    (data.results ?? []).forEach(r => {
      const c = r.coordinates;
      const pm = r.measurements.find(m => m.parameter === "pm25");
      if (!c || !pm) return;
      const v = pm.value;
      const color = v > 55 ? "#7f1d1d" : v > 35 ? "#dc2626" : v > 12 ? "#d97706" : "#059669";
      L.circleMarker([c.latitude, c.longitude], {
        radius: 8, color: "#fff", weight: 1.5, fillColor: color, fillOpacity: 0.8,
      })
        .bindPopup(`<div class="popup-card"><h4>${escapeHtml(r.location)}</h4><div class="meta">PM2.5 · ${new Date(pm.lastUpdated).toLocaleString()}</div><div class="desc" style="font-size:1.2rem;font-weight:700;color:${color}">${v.toFixed(1)} ${pm.unit}</div></div>`)
        .addTo(group);
    });
  } catch (e) {
    console.warn("OpenAQ fetch failed", e);
  }
}

// CA Safe-to-Swim — ArcGIS REST FeatureServer (no key, supports CORS+GeoJSON).
async function loadSafeToSwim(L: L, group: L) {
  // CEDEN Beach Watch monitoring sites (public ArcGIS layer)
  const url = "https://services.arcgis.com/4TXrdeWh0RyCqPgB/arcgis/rest/services/Beach_Water_Quality_Monitoring_Sites/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=400";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const gj = await res.json() as { features?: { geometry: { coordinates: [number, number] }; properties: Record<string, unknown> }[] };
    (gj.features ?? []).forEach(f => {
      const [lng, lat] = f.geometry.coordinates;
      const name = String(f.properties.StationName ?? f.properties.SiteName ?? "Monitoring site");
      L.circleMarker([lat, lng], {
        radius: 5, color: "#fff", weight: 1, fillColor: "#0891b2", fillOpacity: 0.85,
      })
        .bindPopup(`<div class="popup-card"><h4>${escapeHtml(name)}</h4><div class="meta">CA Safe to Swim monitoring site</div></div>`)
        .addTo(group);
    });
  } catch (e) {
    console.warn("Safe-to-Swim layer unavailable", e);
  }
}

// CalEnviroScreen 4.0 — OEHHA ArcGIS service, choropleth by tract score.
async function loadCalEnviroScreen(L: L, group: L) {
  // Pull only Southern California tracts to stay performant.
  const url = "https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/CalEnviroScreen_40/FeatureServer/0/query?where=ApproxLoc+LIKE+%27%25Los+Angeles%25%27+OR+ApproxLoc+LIKE+%27%25Orange%25%27+OR+ApproxLoc+LIKE+%27%25San+Diego%25%27+OR+ApproxLoc+LIKE+%27%25Ventura%25%27&outFields=Tract,CIscore,CIscoreP,ApproxLoc&f=geojson&resultRecordCount=2000";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const gj = await res.json() as { features?: { geometry: { type: string; coordinates: number[][][] | number[][][][] }; properties: Record<string, unknown> }[] };
    const score = (p: number) => p >= 90 ? "#7f1d1d" : p >= 75 ? "#dc2626" : p >= 50 ? "#d97706" : p >= 25 ? "#facc15" : "#bbf7d0";
    (gj.features ?? []).forEach(f => {
      const pct = Number(f.properties.CIscoreP ?? 0);
      const ciScoreVal = Number(f.properties.CIscore ?? 0);
      try {
        L.geoJSON(f, {
          style: { fillColor: score(pct), color: "#475569", weight: 0.4, fillOpacity: 0.45 },
        })
          .bindPopup(`<div class="popup-card"><h4>${escapeHtml(String(f.properties.ApproxLoc ?? "Census tract"))}</h4><div class="meta">CalEnviroScreen 4.0 percentile</div><div class="desc">Score: <strong>${ciScoreVal.toFixed(1)}</strong> · ${pct.toFixed(0)}th percentile</div></div>`)
          .addTo(group);
      } catch { /* skip malformed geometry */ }
    });
  } catch (e) {
    console.warn("CalEnviroScreen layer unavailable", e);
  }
}

// CalEPA Regulated Sites — facilities, cleanup sites, hazardous waste handlers.
async function loadCalEPASites(L: L, group: L) {
  // Restricted to SoCal bounding box to limit volume.
  const url = "https://services.arcgis.com/4TXrdeWh0RyCqPgB/arcgis/rest/services/Regulated_Site_Portal/FeatureServer/0/query?where=1%3D1&geometry=-119.5,32.4,-117.0,34.7&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=SiteName,SiteAddress,SiteCity,ProgramName&f=geojson&resultRecordCount=600";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const gj = await res.json() as { features?: { geometry: { coordinates: [number, number] }; properties: Record<string, unknown> }[] };
    (gj.features ?? []).forEach(f => {
      const [lng, lat] = f.geometry.coordinates;
      const name = String(f.properties.SiteName ?? "Regulated site");
      const program = String(f.properties.ProgramName ?? "");
      const addr = `${f.properties.SiteAddress ?? ""}, ${f.properties.SiteCity ?? ""}`;
      L.circleMarker([lat, lng], {
        radius: 4, color: "#1e293b", weight: 0.8, fillColor: "#475569", fillOpacity: 0.75,
      })
        .bindPopup(`<div class="popup-card"><h4>${escapeHtml(name)}</h4><div class="meta">${escapeHtml(program)}</div><div class="desc">${escapeHtml(addr)}</div></div>`)
        .addTo(group);
    });
  } catch (e) {
    console.warn("CalEPA layer unavailable", e);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]!));
}
