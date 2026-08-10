// ---- AI highlight judge (Tier 3) ----
// Called only as a follow-up to a cheap client-side trigger (a score-derived
// drama moment or a crowd-audio spike — see ptComputeDrama/ptStartAudioWatch
// in index.html), never on a fixed interval. The client sends a few small,
// downscaled JPEG stills grabbed off the live broadcast canvas around that
// moment; this asks a fast vision model whether it's actually worth an
// instant replay, and returns a short broadcast-style caption if so.
//
// Runs on Netlify's AI Gateway — Anthropic credentials are auto-injected
// into every compute context on this site's first production deploy, no
// manual API key setup needed. Free/Personal/Pro plans all include it,
// billed out of the same Netlify credits pool as normal hosting ($1 of
// model usage = 180 credits); the free plan has no auto-recharge, so this
// can never run up a bill on its own — worst case it just stops answering
// until the next billing cycle, and the client already fails open (replays
// anyway using the heuristic's own label) whenever this doesn't return a
// clean verdict in time.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5";
const MAX_FRAMES = 4;

function stripDataUrlPrefix(s: string): string {
  const i = s.indexOf(",");
  return i >= 0 && s.slice(0, i).startsWith("data:") ? s.slice(i + 1) : s;
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (!process.env.ANTHROPIC_API_KEY) {
    // AI Gateway hasn't activated yet (needs a production deploy) — tell the
    // client plainly rather than a generic failure, so ptMaybeAutoReplay's
    // fail-open path is an informed choice, not a swallowed error.
    return Response.json({ isHighlight: false, error: "ai_gateway_unavailable" });
  }

  let body: any;
  try { body = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }

  const rawFrames: unknown = body?.frames;
  const frames = (Array.isArray(rawFrames) ? rawFrames : [])
    .filter((f) => typeof f === "string" && f.length > 0 && f.length < 500_000)
    .slice(0, MAX_FRAMES)
    .map(stripDataUrlPrefix);
  const contextTag = typeof body?.context === "string" ? body.context.slice(0, 60) : "";

  if (!frames.length) return Response.json({ isHighlight: false });

  try {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    });

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{
        role: "user",
        content: [
          ...frames.map((data) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: "image/jpeg" as const, data },
          })),
          {
            type: "text" as const,
            text:
              `These are a few frames, moments apart, from a live amateur tennis stream. ` +
              `Score context: ${contextTag || "a point was just played"}.\n` +
              `Judge only whether this specific moment is worth an instant replay for people watching — ` +
              `a great shot, a genuinely close or contested call, real drama. Ordinary points are not highlights. ` +
              `Reply with ONLY compact JSON, no markdown, no explanation: ` +
              `{"isHighlight":boolean,"label":"a short 2-4 word broadcast caption","confidence":0.0-1.0}`,
          },
        ],
      }],
    });

    const textBlock = res.content.find((c: any) => c.type === "text") as { text?: string } | undefined;
    const match = (textBlock?.text || "").match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};

    return Response.json({
      isHighlight: !!parsed.isHighlight,
      label: typeof parsed.label === "string" ? parsed.label.slice(0, 40) : "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    });
  } catch (e) {
    return Response.json({ isHighlight: false, error: String(e) });
  }
};

export const config = { path: "/api/highlight" };
