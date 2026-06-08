# CoastWatch v2 — Verified Reports + Multi-Source Overlays + Pro Redesign

## 1. Enable Lovable Cloud
Provisions Postgres + auth + AI Gateway. Required for the verification pipeline and persistent reports.

## 2. Database
Single table `public.reports`:
- `id uuid pk`, `created_at timestamptz`, `lat float8`, `lng float8`
- `debris_type text`, `severity int` (1-5), `description text`
- `status text` ('pending' | 'approved' | 'rejected'), `ai_verdict jsonb`, `reporter_session text`
- RLS: anyone can `SELECT` where `status='approved'`; anyone can `INSERT` (status forced to pending server-side); only service role can `UPDATE`.

## 3. Verification pipeline (server function `submitReport`)
Realistic — no "search the internet for rebukes" theater. Three gates:
1. **Coastal proximity check**: reject if point is >5 km from any coastline (uses a cached bounding-box of CA coastline; cheap math, no external call).
2. **AI plausibility check** via Lovable AI Gateway (`google/gemini-2.5-flash`): sends description + coords, asks model to return JSON `{plausible: bool, reason: string, spam: bool}`. Reject if spam or implausible.
3. If both pass → `status='approved'`. Otherwise `status='rejected'` with reason returned to user.

## 4. Real seed pollution data
One-time seed migration inserts ~40 real cleanup records from NOAA Marine Debris MDMAP / Ocean Conservancy TIDES public data for Southern California so the map isn't empty on first load.

## 5. Map overlays — what's actually feasible

| Source | Feasibility | Approach |
|---|---|---|
| Heal the Bay Beach Report Card | YES | Server fn proxies `https://beachreportcard.org/api/v2/beaches` → A–F colored circles on coast |
| AirNow (PM2.5 + Ozone) | YES — needs key | Free API key from airnow.gov; server fn fetches bounding-box observations, renders colored dots |
| IQAir | NO free tier with map data | Skip — replaced by AirNow which is the same underlying network |
| CA Safe to Swim | YES | ArcGIS REST FeatureServer, no key — server fn fetches GeoJSON |
| CalEnviroScreen 4.0 | YES | OEHHA ArcGIS FeatureServer, no key — fetched as choropleth polygons |
| CalEPA Regulated Sites | YES | ArcGIS FeatureServer, no key — clustered marker layer |

All external fetches go through server functions (avoids CORS + caches in-memory for 10 min).

User toggles each layer via a legend/control panel.

## 6. Professional redesign
Move away from the "fun project" gradient look:
- Palette: deep navy `#0a1929`, slate `#1e293b`, accent teal `#0891b2`, alert amber `#d97706`, success green `#059669`. White cards on light gray `#f8fafc` background in main content.
- Typography: `Inter` for UI, `IBM Plex Serif` for headings — civic/government feel.
- Layout: left sidebar (logo, nav, layer toggles), main map fills viewport, right panel for report form + details. Top bar with breadcrumbs + status badges. Stats shown as compact metric cards, not big colored boxes.
- Components: shadcn `Card`, `Tabs`, `Badge`, `Sheet` for mobile.
- Add a legend, scale bar, attribution footer ("Data: NOAA, OEHHA, Heal the Bay, AirNow, CalEPA").

## 7. Secret needed
- `AIRNOW_API_KEY` — free from https://docs.airnowapi.org/ (I'll ask after Cloud is enabled).

## 8. File changes
- `supabase/migrations/<ts>_reports.sql` — table + RLS + seed
- `src/lib/reports.functions.ts` — `submitReport`, `listApprovedReports`
- `src/lib/overlays.functions.ts` — `fetchBeachGrades`, `fetchAirNow`, `fetchSafeToSwim`, `fetchCalEnviroScreen`, `fetchCalEPASites`
- `src/lib/coastline.ts` — CA coastline bbox helper
- `src/routes/index.tsx` — full rewrite for new layout + layer toggles
- `src/components/MapLegend.tsx`, `LayerPanel.tsx`, `ReportForm.tsx`, `StatsBar.tsx`
- `src/styles.css` — new palette + typography
- `index.html` — Inter + IBM Plex Serif fonts

## Out of scope (called out honestly)
- "Check if anything online rebukes the report" — not implementable in a meaningful way; replaced with the 3-gate verification above.
- Realtime streaming pollution data — none of the listed sources push; we poll/cache every 10 min.
- IQAir — no free map-data API; AirNow covers the same monitors.
