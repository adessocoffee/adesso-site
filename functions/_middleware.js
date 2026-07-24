import { getEvents, buildJsonLd, buildListHtml } from "./utils/events.js";
import { getPosts } from "./utils/posts.js";
// Inject live data into the homepage at the edge:
//   - the events JSON-LD + the events list (#events-jsonld / #events-list)
//   - the "On Air" board slots (#los-now / #los-tonight / #los-special)
// Fail-safe: any error returns the original static page untouched (the honest seed),
// and each slot is only filled when there is REAL data for it — no invented copy.
export async function onRequest(context) {
  const { request, next, env } = context;
  const res = await next();
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return res;
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;

  let events = [], posts = [];
  try { events = await getEvents(env); } catch (e) { events = []; }
  try { posts = await getPosts(env); } catch (e) { posts = []; }
  if (!events.length && !posts.length) return res;

  let rw = new HTMLRewriter();

  if (events.length) {
    const jsonld = buildJsonLd(events);
    const list = buildListHtml(events);
    rw = rw
      .on("#events-jsonld", { element(el) { el.setInnerContent(jsonld, { html: true }); } })
      .on("#events-list", { element(el) { el.setInnerContent(list, { html: true }); } });
  }

  const onair = buildOnAir(events, posts);
  if (onair.now) rw = rw.on("#los-now", slot(onair.now));
  if (onair.tonight) rw = rw.on("#los-tonight", slot(onair.tonight));
  if (onair.special) rw = rw.on("#los-special", slot(onair.special));

  const transformed = rw.transform(res);
  const headers = new Headers(transformed.headers);
  headers.set("cache-control", "no-store, must-revalidate");
  return new Response(transformed.body, { status: transformed.status, headers });
}

// A slot handler: replace inner text (escaped) and lift the italic muted
// placeholder color to the live cream so a filled slot reads as real.
function slot(text) {
  return {
    element(el) {
      el.setInnerContent(text, { html: false });
      el.setAttribute("style", "font-size:.9rem;color:#efe7d6;font-style:normal;");
    },
  };
}

const clip = (s, n) => {
  s = (s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).trim() + "…" : s;
};

// Derive the three "Happening Now" lines from the live feeds. Returns nulls where
// there is no real data, so the honest placeholders in the HTML stay put.
function buildOnAir(events, posts) {
  const out = { now: null, tonight: null, special: null };

  // Today's date in the venue's timezone (YYYY-MM-DD).
  let today = "";
  try {
    today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  } catch (e) { today = new Date().toISOString().slice(0, 10); }

  // Newest-first posts.
  const sorted = (posts || []).slice().sort((a, b) =>
    new Date(b.published || 0) - new Date(a.published || 0));
  const withinDays = (iso, days) => {
    const t = new Date(iso).getTime();
    return !isNaN(t) && (Date.now() - t) < days * 86400000 && t <= Date.now() + 3600000;
  };

  // Tonight: a music event dated today.
  const ev = (events || []).find((e) => e.date === today);
  if (ev) out.tonight = clip(`${ev.artist} — ${ev.genre}, 6–9pm`, 80);

  // Special: newest post categorized as a special (kept ~10 days).
  const sp = sorted.find((p) => (p.category || "").toLowerCase() === "special" && withinDays(p.published, 10));
  if (sp) out.special = clip(sp.title || sp.text, 80);

  // Now: the newest post of any kind within ~2 days; otherwise, if there's an act
  // tonight, name it. Never fabricate an open/closed status.
  const fresh = sorted.find((p) => withinDays(p.published, 2));
  if (fresh) out.now = clip(fresh.title || fresh.text, 80);
  else if (ev) out.now = clip(`Live music tonight — ${ev.artist}`, 80);

  return out;
}
