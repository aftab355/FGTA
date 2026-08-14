// ---- AI match commentary / roast ----
// The client used to call `window.claude.complete(...)` directly. That
// function only exists inside Claude.ai's own Artifact preview sandbox —
// it was never going to be present in a real browser hitting the deployed
// site, so every tap of "AI commentary" / "AI roast" failed instantly for
// every actual user. This function is the real replacement: it holds the
// Anthropic API key server-side (same reasoning as youtube.mts — a key
// shipped in static index.html is a key anyone can lift and spend) and
// proxies a single short completion request per tap.
//
// Not configured is a normal, expected state for a fresh deploy — same
// fail-open posture as youtube.mts: say what's missing rather than looking
// broken.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_PROMPT_LEN = 1000;

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "bad_method" }, { status: 405 });
  }

  const key = process.env.ANTHROPIC_API_KEY || "";
  if (!key) {
    return Response.json(
      { error: "not_configured", detail: "ANTHROPIC_API_KEY is not set on this deploy" },
      { status: 200 },
    );
  }

  let prompt = "";
  try {
    const body = await req.json();
    prompt = String(body?.prompt || "").slice(0, MAX_PROMPT_LEN);
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!prompt.trim()) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return Response.json(
        { error: "upstream", detail: `anthropic ${res.status}: ${text.slice(0, 200)}` },
        { status: 200 },
      );
    }
    const data = await res.json();
    const text = (data?.content || [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    if (!text) {
      return Response.json({ error: "empty" }, { status: 200 });
    }
    return Response.json({ text }, { status: 200 });
  } catch (e: any) {
    return Response.json({ error: "upstream", detail: String(e?.message || e) }, { status: 200 });
  }
};

export const config = { path: "/api/ai" };
