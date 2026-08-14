// ---- YouTube Live discovery ----
// The site no longer carries the video itself: somebody points OBS at YouTube
// and the page embeds whatever YouTube says is live. That leaves exactly one
// thing the browser can't answer on its own — "is anything live right now, and
// what's its video id?" — which is what this is for.
//
// It exists as a function rather than a fetch straight from the page for two
// reasons. The API key stays server-side (a key in a static index.html is a
// key anyone can spend), and every viewer polling shares one cached answer
// instead of each burning quota.
//
// ---- quota ----
// The default YouTube Data API allowance is 10,000 units/day. The obvious call
// for this — search.list with eventType=live — costs 100 units EACH, which is
// 100 polls a day for the whole league. So this doesn't use it. Instead:
//
//   channels.list      1 unit   → the channel's "uploads" playlist id (cached
//                                 for the life of the instance; it never changes)
//   playlistItems.list 1 unit   → the most recent uploads, live ones included
//   videos.list        1 unit   → liveStreamingDetails for those ids
//
// so a refresh is 2 units, and both a module-level cache and a CDN cache sit in
// front of it. A day of continuous polling by any number of viewers lands
// around 4k units — comfortably inside the free allowance with room for the
// archive listing on top.
//
// One consequence worth knowing: unlisted streams are not in the uploads
// playlist for a plain API-key request, so they are never auto-discovered.
// That's what the "paste the link" path and the host's own live announcement
// in the app are for — see docs/youtube-live.md.

const API = "https://www.googleapis.com/youtube/v3";

const LIVE_TTL_MS = 45_000;      // matches the client's poll interval
const ARCHIVE_TTL_MS = 600_000;  // finished broadcasts don't move

type CacheEntry = { at: number; body: unknown };
const cache = new Map<string, CacheEntry>();
let uploadsPlaylistId: string | null = null;
let channelTitle = "";

function cached(key: string, ttl: number): unknown | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.body;
  return null;
}

function json(body: unknown, maxAge: number) {
  return Response.json(body, {
    headers: {
      // The browser cache stops one viewer's own re-polls; the CDN cache stops
      // every OTHER viewer's from ever reaching this function at all.
      "Cache-Control": `public, max-age=${maxAge}`,
      "Netlify-CDN-Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=60`,
    },
  });
}

async function api(path: string, params: Record<string, string>, key: string) {
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetch(`${API}/${path}?${qs}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let reason = "";
    try { reason = JSON.parse(text)?.error?.errors?.[0]?.reason || ""; } catch { /* not JSON */ }
    throw Object.assign(new Error(`youtube ${path} ${res.status}${reason ? ` (${reason})` : ""}`), {
      status: res.status,
      reason,
    });
  }
  return res.json();
}

async function getUploadsPlaylist(channelId: string, key: string) {
  if (uploadsPlaylistId) return uploadsPlaylistId;
  const data = await api("channels", { part: "contentDetails,snippet", id: channelId }, key);
  const ch = data?.items?.[0];
  if (!ch) throw Object.assign(new Error("channel not found"), { reason: "channelNotFound" });
  channelTitle = ch?.snippet?.title || "";
  uploadsPlaylistId = ch?.contentDetails?.relatedPlaylists?.uploads || null;
  if (!uploadsPlaylistId) throw Object.assign(new Error("no uploads playlist"), { reason: "noUploads" });
  return uploadsPlaylistId;
}

function shape(v: any) {
  const live = v?.liveStreamingDetails || {};
  const t = v?.snippet || {};
  return {
    id: v?.id || "",
    title: t.title || "Live match",
    channelTitle: t.channelTitle || channelTitle || "",
    thumb:
      t.thumbnails?.medium?.url ||
      t.thumbnails?.high?.url ||
      t.thumbnails?.default?.url ||
      "",
    state: t.liveBroadcastContent || "none", // live | upcoming | none
    viewers: live.concurrentViewers != null ? Number(live.concurrentViewers) : null,
    startedAt: live.actualStartTime || null,
    scheduledAt: live.scheduledStartTime || null,
    endedAt: live.actualEndTime || null,
    publishedAt: t.publishedAt || null,
  };
}

/** The most recent uploads, hydrated with live details. One call each. */
async function recentVideos(channelId: string, key: string, count: number) {
  const playlist = await getUploadsPlaylist(channelId, key);
  const items = await api(
    "playlistItems",
    { part: "contentDetails", playlistId: playlist, maxResults: String(count) },
    key,
  );
  const ids = (items?.items || [])
    .map((i: any) => i?.contentDetails?.videoId)
    .filter(Boolean)
    .slice(0, 50);
  if (!ids.length) return [];
  const videos = await api(
    "videos",
    { part: "snippet,liveStreamingDetails", id: ids.join(",") },
    key,
  );
  return (videos?.items || []).map(shape);
}

/** A specific video, whether or not it belongs to the configured channel. */
async function oneVideo(id: string, key: string) {
  const videos = await api("videos", { part: "snippet,liveStreamingDetails", id }, key);
  const item = videos?.items?.[0];
  return item ? shape(item) : null;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "live";
  const key = process.env.YOUTUBE_API_KEY || "";
  const channelId = process.env.YOUTUBE_CHANNEL_ID || "";

  // Not configured is a normal, expected state for a fresh deploy — the app
  // falls back to "paste a link" and says what's missing, rather than looking
  // broken. Same fail-open posture as the highlight judge used to have.
  if (!key) {
    return json({ error: "not_configured", detail: "YOUTUBE_API_KEY is not set on this deploy" }, 60);
  }

  try {
    if (action === "video") {
      const id = (url.searchParams.get("id") || "").trim();
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return json({ error: "bad_id" }, 60);
      const hit = cached("video:" + id, LIVE_TTL_MS);
      if (hit) return json(hit, 30);
      const video = await oneVideo(id, key);
      const body = { video, channelId, channelTitle, updatedAt: Date.now() };
      cache.set("video:" + id, { at: Date.now(), body });
      return json(body, 30);
    }

    if (!channelId) {
      return json(
        { error: "not_configured", detail: "YOUTUBE_CHANNEL_ID is not set on this deploy" },
        60,
      );
    }

    if (action === "archive") {
      const hit = cached("archive", ARCHIVE_TTL_MS);
      if (hit) return json(hit, 300);
      const all = await recentVideos(channelId, key, 25);
      const archive = all
        .filter((v) => v.endedAt)
        .sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)))
        .slice(0, 12);
      const body = { archive, channelId, channelTitle, updatedAt: Date.now() };
      cache.set("archive", { at: Date.now(), body });
      return json(body, 300);
    }

    // action === "live"
    const hit = cached("live", LIVE_TTL_MS);
    if (hit) return json(hit, 30);
    const all = await recentVideos(channelId, key, 15);
    const body = {
      live: all.filter((v) => v.state === "live"),
      upcoming: all
        .filter((v) => v.state === "upcoming")
        .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
        .slice(0, 4),
      channelId,
      channelTitle,
      updatedAt: Date.now(),
    };
    cache.set("live", { at: Date.now(), body });
    return json(body, 30);
  } catch (e: any) {
    // quotaExceeded is the one worth naming: it is temporary, it resets at
    // midnight Pacific, and the app says so instead of "couldn't reach YouTube".
    const reason = e?.reason || "";
    const quota = reason === "quotaExceeded" || reason === "rateLimitExceeded";
    return json(
      { error: quota ? "quota" : "upstream", reason, detail: String(e?.message || e) },
      quota ? 300 : 15,
    );
  }
};

export const config = { path: "/api/youtube" };
