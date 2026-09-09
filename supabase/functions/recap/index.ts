/* The weekly recap, written server-side on a schedule.
 *
 * WHY THIS EXISTS WHEN /api/ai ALREADY DOES AI. The Netlify function is a
 * proxy: the browser asks it for commentary and it forwards the request with
 * the key attached. It cannot do this job, because this job has to happen
 * when nobody has the app open — Monday morning, from a cron, reading the
 * database directly. That is the one thing an Edge Function is for here, and
 * it is why this is not a duplicate of ai.mts.
 *
 * The app already has a weekly recap (postWeeklyRecap in index.html). It is a
 * template — a string of stats joined with bullets — and it needs an admin to
 * press a button with the site open. This writes the same facts as prose and
 * needs nobody.
 *
 * WHAT THE MODEL IS AND IS NOT TRUSTED WITH. It never sees a match row. It is
 * given the fact sheet facts.js computes — counts, names, a percentage — and
 * asked to write three sentences about it. A model handed a table of results
 * will eventually write a scoreline that did not happen, and a league bot that
 * invents results is worse than no league bot.
 *
 * Deploy and schedule: docs/edge-functions.md
 */
/* Pinned, and pinned to a version that was checked rather than remembered:
   the error classes below are NAMED exports, not properties of the default
   export, and there is no APIStatusError in the TypeScript SDK at all (that
   one is Python's). Both of those were wrong in the first draft of this file
   and only a type-check against the real package caught them. */
import Anthropic, {
  APIError, APIConnectionError, RateLimitError,
} from "npm:@anthropic-ai/sdk@0.124.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { recapFacts, weekKey } from "./facts.js";

/* Supabase injects these two into every function; the rest are yours to set
   with `supabase secrets set`. RECAP_SECRET is not optional — see below. */
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const RECAP_SECRET  = Deno.env.get("RECAP_SECRET") ?? "";

const AUTHOR = "League Bot";
const TAG    = "#weekinreview";
const MODEL  = "claude-opus-5";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2),
    { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  /* An Edge Function is a public URL. Without this anybody who finds it can
     make the league bot post, and — because the model call is behind it —
     spend the Anthropic key. A shared secret is the least this needs; a
     missing RECAP_SECRET is treated as misconfiguration rather than as
     "no auth required", because failing open here is the expensive mistake. */
  if (!RECAP_SECRET) {
    return json({ error: "not_configured", detail: "RECAP_SECRET is not set on this project" }, 500);
  }
  const offered = req.headers.get("x-recap-secret") ?? "";
  if (offered !== RECAP_SECRET) return json({ error: "unauthorized" }, 401);

  if (!ANTHROPIC_KEY) {
    return json({ error: "not_configured", detail: "ANTHROPIC_API_KEY is not set on this project" }, 500);
  }

  /* `dry` returns the facts and the drafted text without posting — the way to
     see what Monday would say, on a Thursday, without putting it in the feed. */
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const now = Date.now();
  const week = weekKey(now);

  /* Idempotency, before any work: a cron that fires twice, or a manual run
     after an automatic one, must not put two recaps in the feed. The marker
     is in the post body rather than in a table of its own, so there is no
     second thing to migrate and no way for the two to disagree. */
  const marker = `${TAG}-${week}`;
  const { data: already, error: dupErr } = await db
    .from("posts").select("id").eq("author", AUTHOR).ilike("body", `%${marker}%`).limit(1);
  if (dupErr) return json({ error: "db", detail: dupErr.message }, 500);
  if (already?.length && !dry) return json({ skipped: "already posted", week });

  /* Only what the fact builder needs, and only recent history: the streak
     count wants more than a week, the whole table wants far less than all of
     it. Ninety days is generous for both. */
  const since = new Date(now - 90 * 86400000).toISOString();
  const { data: matches, error } = await db
    .from("matches")
    .select("p1,p2,outcome,status,sets,created_at,counts_stats")
    .eq("status", "approved")
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (error) return json({ error: "db", detail: error.message }, 500);

  const facts = recapFacts(matches ?? [], now);
  /* A quiet week gets silence. A bot that posts "not much happened this week"
     every week is how people learn to scroll past it. */
  if (!facts) return json({ skipped: "no games this week", week });

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  let text: string;
  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      /* A feed post, deliberately short — this is one of the cases where a
         small cap is the point rather than a saving. */
      max_tokens: 1000,
      /* Writing three sentences from a supplied fact sheet is not a reasoning
         task; low effort is the honest setting and the cheap one. */
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      system:
        "You write the weekly round-up for a friends' tennis ladder in Toronto. " +
        "Three sentences at most, warm and a little wry, the way somebody who plays " +
        "in it would write it. No headings, no bullet points, no emoji, no hashtags. " +
        "Use ONLY the facts in the JSON you are given — every name, number and " +
        "scoreline must appear there. If a field is null it did not happen, so do " +
        "not mention it. Never invent a result.",
      messages: [{ role: "user", content: JSON.stringify(facts) }],
    });

    if (response.stop_reason === "refusal") {
      return json({ error: "refused", detail: response.stop_details ?? null }, 502);
    }
    text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text.trim())
      .join(" ")
      .trim();
  } catch (e) {
    /* Typed classes, most specific first — a 429 is worth another cron tick,
       a 400 never will be, and the difference matters to whoever reads the log. */
    if (e instanceof RateLimitError)     return json({ error: "rate_limited" }, 429);
    if (e instanceof APIConnectionError) return json({ error: "upstream_unreachable" }, 502);
    if (e instanceof APIError)
      return json({ error: "upstream", status: e.status, detail: String(e.message).slice(0, 200) }, 502);
    return json({ error: "unknown", detail: String(e).slice(0, 200) }, 500);
  }

  if (!text) return json({ error: "empty_response" }, 502);

  const body = `${text} ${marker}`;
  if (dry) return json({ dry: true, week, facts, body });

  const { error: insErr } = await db.from("posts").insert({ author: AUTHOR, body });
  if (insErr) return json({ error: "db", detail: insErr.message }, 500);

  return json({ posted: true, week, facts, body });
});
