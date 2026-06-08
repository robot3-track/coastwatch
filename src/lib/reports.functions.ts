/**
 * Server functions for the CoastWatch reports pipeline.
 *
 * submitReport() runs three verification gates before a report is saved as
 * "approved" and shown on the public map:
 *   1. Schema validation (Zod)
 *   2. Coastal proximity check (rejects pins far from the CA coast bounding box)
 *   3. AI plausibility check via Lovable AI Gateway (Gemini)
 *
 * Reports that fail any gate are saved with status="rejected" together with the
 * verdict reason, so the reporter gets honest feedback and we keep an audit trail.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ReportInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  debris_type: z.string().trim().min(2).max(80),
  severity: z.number().int().min(1).max(5),
  description: z.string().trim().min(8).max(800),
  reporter: z.string().trim().max(80).optional().nullable(),
});

// Approximate California coast bounding box. Anything well outside is rejected.
function nearCalifornia(lat: number, lng: number): boolean {
  return lat >= 32.4 && lat <= 42.1 && lng >= -125.0 && lng <= -117.0;
}

type AiVerdict = { plausible: boolean; spam: boolean; reason: string };

async function aiVerify(
  apiKey: string,
  input: z.infer<typeof ReportInput>
): Promise<AiVerdict> {
  const sys =
    "You are a moderation assistant for a coastal pollution citizen-science app. " +
    "Given a debris report, decide if it is a plausible, good-faith report. " +
    "Reject hate speech, slurs, obvious spam, joke text, or descriptions that " +
    "contradict the stated debris type. Reply ONLY with compact JSON " +
    '{"plausible":bool,"spam":bool,"reason":"short string"}.';
  const user = JSON.stringify({
    lat: input.lat,
    lng: input.lng,
    debris_type: input.debris_type,
    severity: input.severity,
    description: input.description,
  });

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    // If the AI gateway fails (rate limit, credits), fail OPEN — approve, but
    // mark the verdict so a moderator can see it later.
    return { plausible: true, spam: false, reason: `ai_unavailable_${res.status}` };
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as Partial<AiVerdict>;
    return {
      plausible: parsed.plausible ?? true,
      spam: parsed.spam ?? false,
      reason: typeof parsed.reason === "string" ? parsed.reason : "ok",
    };
  } catch {
    return { plausible: true, spam: false, reason: "ai_parse_fallback" };
  }
}

export const submitReport = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => ReportInput.parse(data))
  .handler(async ({ data }) => {
    const verdict: Record<string, unknown> = {};
    let status: "approved" | "rejected" = "approved";
    let userMessage = "Report verified and added to the map.";

    // Gate 1: coastal proximity
    if (!nearCalifornia(data.lat, data.lng)) {
      status = "rejected";
      verdict.geo = "outside_ca_coast_bbox";
      userMessage =
        "Location appears to be outside the California coastal region we currently track.";
    }

    // Gate 2: AI plausibility (only if geo passed)
    if (status === "approved") {
      const apiKey = process.env.LOVABLE_API_KEY;
      if (!apiKey) {
        verdict.ai = "no_api_key";
      } else {
        const ai = await aiVerify(apiKey, data);
        verdict.ai = ai;
        if (ai.spam || !ai.plausible) {
          status = "rejected";
          userMessage = `Report flagged by automated review: ${ai.reason}`;
        }
      }
    }

    // Persist using admin client (bypasses RLS; we control status server-side).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("reports")
      .insert({
        lat: data.lat,
        lng: data.lng,
        debris_type: data.debris_type,
        severity: data.severity,
        description: data.description,
        reporter: data.reporter ?? null,
        status,
        ai_verdict: verdict,
      })
      .select("id, status")
      .single();

    if (error) {
      throw new Error(`Failed to save report: ${error.message}`);
    }

    return {
      id: row.id,
      status: row.status as "approved" | "rejected",
      message: userMessage,
    };
  });
