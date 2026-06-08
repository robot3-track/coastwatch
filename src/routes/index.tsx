import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type * as LeafletNS from "leaflet";

// Leaflet is dynamically imported in useEffect to avoid SSR (window is undefined).
type L = typeof LeafletNS;


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CoastWatch — Local Coastal & Environmental Tracker" },
      {
        name: "description",
        content:
          "Crowdsourced coastal pollution tracker. Drop pins, report debris, and track community impact.",
      },
    ],
  }),
  component: CoastWatch,
});

// ---------- Types & constants ----------
type Report = {
  id: string;
  reporter: string;
  debrisType: string;
  size: string;
  description: string;
  lat: number;
  lng: number;
  createdAt: number;
};

const STORAGE_KEY = "coastwatch.reports.v1";
const DEFAULT_CENTER: [number, number] = [34.0083, -118.4988];
const DEFAULT_ZOOM = 11;

const MOCK_REPORTS: Report[] = [
  {
    id: "mock-1",
    reporter: "Maya R.",
    debrisType: "Plastic",
    size: "Large",
    description: "Pile of plastic bottles and food wrappers near the lifeguard tower.",
    lat: 34.0094,
    lng: -118.4973,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
  },
  {
    id: "mock-2",
    reporter: "Diego L.",
    debrisType: "Fishing Gear",
    size: "Medium",
    description: "Tangled fishing line and a broken lure caught in the rocks.",
    lat: 33.9802,
    lng: -118.4691,
    createdAt: Date.now() - 1000 * 60 * 60 * 18,
  },
  {
    id: "mock-3",
    reporter: "Anonymous Beach Hero",
    debrisType: "Glass / Metal",
    size: "Small",
    description: "Several broken bottles on the boardwalk — careful with bare feet!",
    lat: 34.0211,
    lng: -118.5044,
    createdAt: Date.now() - 1000 * 60 * 60 * 5,
  },
];

// ---------- Helpers ----------
function loadReports(): Report[] {
  if (typeof window === "undefined") return MOCK_REPORTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return MOCK_REPORTS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : MOCK_REPORTS;
  } catch {
    return MOCK_REPORTS;
  }
}

function saveReports(reports: Report[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  } catch (err) {
    console.warn("CoastWatch: failed to save", err);
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function popupHtml(r: Report) {
  return `
    <div class="popup-card">
      <h4>${escapeHtml(r.debrisType)}</h4>
      <div class="meta">
        <span class="badge">${escapeHtml(r.size)}</span>
        <span class="badge">${escapeHtml(r.reporter || "Anonymous")}</span>
      </div>
      <div class="desc">${escapeHtml(r.description)}</div>
      <div class="meta" style="margin-top:.4rem">${new Date(r.createdAt).toLocaleString()}</div>
    </div>`;
}

function formatRelative(date: Date) {
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------- Component ----------
function CoastWatch() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletMap = useRef<LeafletNS.Map | null>(null);
  const markerLayer = useRef<LeafletNS.LayerGroup | null>(null);
  const LRef = useRef<L | null>(null);

  const [reports, setReports] = useState<Report[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState<{ msg: string; kind?: "error" | "success" }>({
    msg: "",
  });

  // form state
  const [reporter, setReporter] = useState("");
  const [debrisType, setDebrisType] = useState("Plastic");
  const [size, setSize] = useState("Small");
  const [description, setDescription] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  // Initial load
  useEffect(() => {
    const initial = loadReports();
    setReports(initial);
    if (!window.localStorage.getItem(STORAGE_KEY)) saveReports(initial);
  }, []);

  // Initialize Leaflet (dynamic import to avoid SSR window references)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ default: L }, _css] = await Promise.all([
        import("leaflet"),
        import("leaflet/dist/leaflet.css"),
      ]);
      const [icon2x, icon, shadow] = await Promise.all([
        import("leaflet/dist/images/marker-icon-2x.png"),
        import("leaflet/dist/images/marker-icon.png"),
        import("leaflet/dist/images/marker-shadow.png"),
      ]);
      // Patch default icon paths (Vite doesn't auto-resolve them).
      // @ts-expect-error _getIconUrl is internal
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: icon2x.default,
        iconUrl: icon.default,
        shadowUrl: shadow.default,
      });

      if (cancelled || !mapRef.current || leafletMap.current) return;
      LRef.current = L;
      const map = L.map(mapRef.current).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      markerLayer.current = L.layerGroup().addTo(map);
      map.on("click", (e: LeafletNS.LeafletMouseEvent) => {
        setLat(e.latlng.lat.toFixed(5));
        setLng(e.latlng.lng.toFixed(5));
        setModalOpen(true);
        setStatus({
          msg: "Coordinates set from map click. Fill in the rest!",
          kind: "success",
        });
      });
      leafletMap.current = map;
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-render markers when reports change (after map is ready)
  useEffect(() => {
    const L = LRef.current;
    if (!L || !markerLayer.current) return;
    markerLayer.current.clearLayers();
    reports.forEach((r) => {
      L.marker([r.lat, r.lng])
        .addTo(markerLayer.current!)
        .bindPopup(popupHtml(r));
    });
  }, [reports, mapReady]);


  // ESC closes modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- Derived stats ----------
  const total = reports.length;
  const plastic = reports.filter((r) => r.debrisType === "Plastic").length;
  const uniqueBuckets = new Set(
    reports.map((r) => `${r.lat.toFixed(2)},${r.lng.toFixed(2)}`),
  ).size;
  const latest = reports.length
    ? formatRelative(new Date(Math.max(...reports.map((r) => r.createdAt))))
    : "—";

  // ---------- Handlers ----------
  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setStatus({ msg: "Geolocation isn't supported on this device.", kind: "error" });
      return;
    }
    setStatus({ msg: "Locating you…" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(5));
        setLng(pos.coords.longitude.toFixed(5));
        setStatus({ msg: "Location captured ✅", kind: "success" });
        leafletMap.current?.setView([pos.coords.latitude, pos.coords.longitude], 14);
      },
      (err) => setStatus({ msg: `Could not get location: ${err.message}`, kind: "error" }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  function resetForm() {
    setReporter("");
    setDebrisType("Plastic");
    setSize("Small");
    setDescription("");
    setLat("");
    setLng("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    if (Number.isNaN(latN) || latN < -90 || latN > 90)
      return setStatus({ msg: "Latitude must be between -90 and 90.", kind: "error" });
    if (Number.isNaN(lngN) || lngN < -180 || lngN > 180)
      return setStatus({ msg: "Longitude must be between -180 and 180.", kind: "error" });
    if (!description.trim())
      return setStatus({ msg: "Please add a short description.", kind: "error" });

    const newReport: Report = {
      id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      reporter: reporter.trim() || "Anonymous",
      debrisType,
      size,
      description: description.trim(),
      lat: latN,
      lng: lngN,
      createdAt: Date.now(),
    };
    const next = [...reports, newReport];
    setReports(next);
    saveReports(next);
    leafletMap.current?.setView([latN, lngN], Math.max(leafletMap.current.getZoom(), 13));
    setStatus({ msg: "Report submitted! Thank you 🌊", kind: "success" });
    resetForm();
    setTimeout(() => setModalOpen(false), 700);
  }

  return (
    <div className="cw">
      {/* Navbar */}
      <header className="cw-nav">
        <div className="cw-brand">
          <span className="cw-wave">🌊</span> CoastWatch
        </div>
        <nav className="cw-nav-links">
          <a href="#dashboard">Dashboard</a>
          <a href="#map-section">Map</a>
          <a href="#report" onClick={(e) => { e.preventDefault(); setModalOpen(true); }}>
            Report
          </a>
        </nav>
        <button className="cw-btn cw-btn-primary" onClick={() => setModalOpen(true)}>
          + New Report
        </button>
      </header>

      {/* Hero */}
      <section className="cw-hero">
        <div>
          <h1>
            Protect your shoreline,
            <br />
            <span className="cw-accent">one report at a time.</span>
          </h1>
          <p>
            Spot plastic, debris, or pollution on your local beach? Drop a pin, snap a
            description, and help your community keep our coasts clean.
          </p>
        </div>
        <div className="cw-hero-wave" aria-hidden="true">🌊</div>
      </section>

      {/* Dashboard */}
      <section id="dashboard" className="cw-impact-grid">
        <StatCard color="blue" icon="🚩" value={total} label="Total Reports" />
        <StatCard color="teal" icon="♻️" value={plastic} label="Plastic Reports" />
        <StatCard color="sand" icon="📍" value={uniqueBuckets} label="Locations Tracked" />
        <StatCard color="deep" icon="⏱" value={latest} label="Most Recent Report" />
      </section>

      {/* Map */}
      <section id="map-section" className="cw-map-section">
        <div className="cw-section-header">
          <h2>🗺 Community Pollution Map</h2>
          <p>Every pin is a real report from your community. Click any pin for details, or click the map to drop a new one.</p>
        </div>
        <div ref={mapRef} className="cw-map" role="application" aria-label="Pollution map" />
      </section>

      <footer className="cw-footer">
        🌊 CoastWatch — built for the Congressional App Challenge. Data stored locally in your browser.
      </footer>

      {/* Modal */}
      {modalOpen && (
        <div className="cw-modal" role="dialog" aria-modal="true">
          <div className="cw-modal-backdrop" onClick={() => setModalOpen(false)} />
          <div className="cw-modal-panel">
            <header className="cw-modal-header">
              <h2>📝 Submit a Pollution Report</h2>
              <button className="cw-icon-btn" onClick={() => setModalOpen(false)} aria-label="Close">
                ✕
              </button>
            </header>

            <form className="cw-form" onSubmit={handleSubmit} noValidate>
              <label>
                <span>Reporter name <small>(optional)</small></span>
                <input
                  type="text"
                  value={reporter}
                  onChange={(e) => setReporter(e.target.value)}
                  placeholder="Anonymous Beach Hero"
                />
              </label>

              <label>
                <span>Debris type</span>
                <select value={debrisType} onChange={(e) => setDebrisType(e.target.value)}>
                  <option>Plastic</option>
                  <option>Fishing Gear</option>
                  <option>Oil / Chemical</option>
                  <option>Glass / Metal</option>
                  <option>Other</option>
                </select>
              </label>

              <fieldset className="cw-radio-row">
                <legend>Estimated size</legend>
                {["Small", "Medium", "Large"].map((s) => (
                  <label key={s}>
                    <input
                      type="radio"
                      name="size"
                      value={s}
                      checked={size === s}
                      onChange={(e) => setSize(e.target.value)}
                    />{" "}
                    {s}
                  </label>
                ))}
              </fieldset>

              <label>
                <span>Description</span>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A pile of plastic bottles near the high-tide line…"
                  required
                />
              </label>

              <div className="cw-coords-row">
                <label>
                  <span>Latitude</span>
                  <input
                    type="number"
                    step="any"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Longitude</span>
                  <input
                    type="number"
                    step="any"
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    required
                  />
                </label>
              </div>

              <button type="button" className="cw-btn cw-btn-ghost" onClick={useMyLocation}>
                📍 Use Current Location
              </button>

              <p className={`cw-form-status ${status.kind ?? ""}`} aria-live="polite">
                {status.msg}
              </p>

              <div className="cw-modal-actions">
                <button type="button" className="cw-btn cw-btn-muted" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="cw-btn cw-btn-primary">
                  ✈ Submit Report
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  color,
  icon,
  value,
  label,
}: {
  color: "blue" | "teal" | "sand" | "deep";
  icon: string;
  value: string | number;
  label: string;
}) {
  return (
    <article className="cw-impact-card">
      <div className={`cw-impact-icon ${color}`}>{icon}</div>
      <div>
        <div className="cw-impact-number">{value}</div>
        <div className="cw-impact-label">{label}</div>
      </div>
    </article>
  );
}
