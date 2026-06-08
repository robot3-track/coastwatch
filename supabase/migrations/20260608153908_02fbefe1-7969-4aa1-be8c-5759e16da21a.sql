
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  debris_type TEXT NOT NULL,
  severity INT NOT NULL DEFAULT 3 CHECK (severity BETWEEN 1 AND 5),
  description TEXT NOT NULL,
  reporter TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  ai_verdict JSONB
);

GRANT SELECT ON public.reports TO anon, authenticated;
GRANT INSERT ON public.reports TO anon, authenticated;
GRANT ALL ON public.reports TO service_role;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approved reports public read"
  ON public.reports FOR SELECT
  USING (status = 'approved');

-- Seed real-style coastal debris reports (Southern California coast)
INSERT INTO public.reports (lat, lng, debris_type, severity, description, reporter, status, ai_verdict) VALUES
(33.9850, -118.4695, 'Plastic bottles', 4, 'Cluster of single-use plastic bottles washed ashore near Venice Pier.', 'Seed: Heal the Bay cleanup log', 'approved', '{"seeded":true}'),
(34.0089, -118.4973, 'Cigarette butts', 3, 'High density of cigarette filters in dry sand at Santa Monica State Beach.', 'Seed: Ocean Conservancy TIDES', 'approved', '{"seeded":true}'),
(33.8703, -118.4014, 'Fishing line', 4, 'Tangled monofilament fishing line on rocks near Redondo Beach Pier.', 'Seed: NOAA MDMAP', 'approved', '{"seeded":true}'),
(34.0405, -118.5611, 'Food wrappers', 2, 'Snack wrappers and plastic bags along Will Rogers State Beach.', 'Seed: Heal the Bay cleanup log', 'approved', '{"seeded":true}'),
(33.7701, -118.1937, 'Polystyrene foam', 5, 'Large foam fragments breaking down at the LA River mouth, Long Beach.', 'Seed: NOAA MDMAP', 'approved', '{"seeded":true}'),
(34.0211, -118.5108, 'Plastic bags', 3, 'Plastic shopping bags caught in kelp wrack line.', 'Seed: TIDES', 'approved', '{"seeded":true}'),
(33.9591, -118.4548, 'Microplastics', 4, 'Visible microplastic fragments in tide pools, El Segundo.', 'Seed: 5 Gyres survey', 'approved', '{"seeded":true}'),
(34.1339, -119.2336, 'Fishing gear', 3, 'Derelict crab trap and rope, Ventura Harbor jetty.', 'Seed: NOAA MDMAP', 'approved', '{"seeded":true}'),
(33.6189, -117.9298, 'Plastic straws', 2, 'Straws and stirrers near Newport Beach pier.', 'Seed: Surfrider', 'approved', '{"seeded":true}'),
(33.4570, -117.7060, 'Balloon debris', 3, 'Mylar balloons and ribbon, San Onofre State Beach.', 'Seed: Surfrider', 'approved', '{"seeded":true}'),
(33.0928, -117.3110, 'Plastic bottles', 4, 'Bottle caps and PET fragments at Cardiff State Beach.', 'Seed: Surfrider', 'approved', '{"seeded":true}'),
(32.8328, -117.2713, 'Cigarette butts', 4, 'Dense cigarette filters near Pacific Beach boardwalk.', 'Seed: Heal the Bay', 'approved', '{"seeded":true}'),
(32.7574, -117.2526, 'Food wrappers', 3, 'Wrappers and lids, Ocean Beach pier.', 'Seed: TIDES', 'approved', '{"seeded":true}'),
(34.4208, -119.6982, 'Plastic bags', 3, 'Plastic bags along Goleta Beach after storm runoff.', 'Seed: Channelkeeper', 'approved', '{"seeded":true}'),
(33.5427, -117.7854, 'Polystyrene foam', 4, 'Foam pieces near Doheny State Beach river outlet.', 'Seed: NOAA MDMAP', 'approved', '{"seeded":true}'),
(34.0211, -118.4814, 'Plastic bottles', 3, 'Bottle litter at Ocean Park Beach.', 'Seed: Heal the Bay', 'approved', '{"seeded":true}'),
(33.7858, -118.4419, 'Fishing line', 2, 'Snagged fishing line near Manhattan Beach pier pilings.', 'Seed: NOAA MDMAP', 'approved', '{"seeded":true}'),
(33.3914, -117.5828, 'Microplastics', 4, 'Microplastic concentration after rain, Oceanside.', 'Seed: 5 Gyres', 'approved', '{"seeded":true}'),
(34.0118, -119.0379, 'Derelict gear', 3, 'Abandoned fishing net fragments, Point Mugu.', 'Seed: NOAA MDMAP', 'approved', '{"seeded":true}'),
(33.9425, -118.4081, 'Plastic bags', 2, 'Plastic bags blown into dunes, Dockweiler Beach.', 'Seed: TIDES', 'approved', '{"seeded":true}');

CREATE INDEX reports_status_idx ON public.reports(status);
CREATE INDEX reports_created_idx ON public.reports(created_at DESC);
