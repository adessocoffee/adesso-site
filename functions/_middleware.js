import { getEvents, buildJsonLd, buildListHtml, eventUrl } from "./utils/events.js";
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
  for (const key of ["now", "tonight", "special"]) {
    const v = onair[key];
    if (!v || !v.text) continue;
    rw = rw.on(`#los-${key}`, slot(v.text, v.href));
    if (v.label) rw = rw.on(`#los-${key}-label`, label(v.label));
  }

  const transformed = rw.transform(res);
  const headers = new Headers(transformed.headers);
  headers.set("cache-control", "no-store, must-revalidate");
  return new Response(transformed.body, { status: transformed.status, headers });
}

// A slot handler: replace inner text (escaped) and lift the italic muted
// placeholder color to the live cream so a filled slot reads as real.
function slot(text, href) {
  return {
    element(el) {
      if (href) {
        // The board is the fastest path to the detail, so the event slot is a
        // link. The arrow is the only affordance that survives on a board with
        // no chrome, and it is what tells someone the line is tappable.
        el.setInnerContent(
          `<a href="${href}" style="color:inherit;text-decoration:none;border-bottom:1px solid rgba(239,231,214,.34);padding-bottom:1px;">` +
          `${esc(text)} <span aria-hidden="true" style="opacity:.65">&rsaquo;</span></a>`,
          { html: true });
      } else {
        el.setInnerContent(text, { html: false });
      }
      el.setAttribute("style", "font-size:.9rem;color:#efe7d6;font-style:normal;");
    },
  };
}

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The What's On label changes with the day ("This Morning" / "Tonight"), so the
// caption is data too, not just the line under it.
function label(text) {
  return { element(el) { el.setInnerContent(text, { html: false }); } };
}

const clip = (s, n) => {
  s = (s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).trim() + "…" : s;
};

// The three "Happening Now" lines.
//
//   WHAT'S ON  the calendar, with a label that follows the day — This Morning
//              before noon, This Afternoon until 5, Tonight after. Falls
//              forward to the next date when nothing is on today.
//   NOW        live updates (late openings, closures, 86'd items, news).
//              When there is nothing to report it states today's hours, which
//              is always true and never looks broken.
//   SPECIAL    the standing happy hour, schedule-aware: the detail inside the
//              window, the standing line outside it. A live one-off special
//              post overrides while it runs.
//
// Each returns {label, text} or null, so the honest placeholders in the HTML
// stay put when there is genuinely nothing to say. A post is used by at most
// one slot — three slots must never print the same sentence.

const VENUE_TZ = "America/New_York";

// Mon 7-3, Tue-Thu 7-5, Fri/Sat 7-9, Sun 9-2. Index 0 = Sunday.
const HOURS = [
  { open: 9, close: 14 }, { open: 7, close: 15 }, { open: 7, close: 17 },
  { open: 7, close: 17 }, { open: 7, close: 17 }, { open: 7, close: 21 },
  { open: 7, close: 21 },
];
// Standing happy hour: Friday 4-7pm.
const HAPPY_HOUR = {
  dow: 5, from: 16, to: 19,
  detail: "$7 select cocktails and wine pours",
  standing: "Happy Hour Fridays 4\u20137pm",
};

const hr = (h) => {
  const ampm = h >= 12 ? "pm" : "am";
  const v = h % 12 || 12;
  return `${v}${ampm}`;
};

// Venue-local parts of "now", independent of where the edge runs.
function venueNow() {
  const d = new Date();
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: VENUE_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const p = {};
  for (const { type, value } of f.formatToParts(d)) p[type] = value;
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    dow: dowMap[p.weekday] ?? d.getUTCDay(),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

// The hour an event starts, read from its ISO start in venue time.
function startHour(e) {
  const t = new Date(e.start || `${e.date}T18:00:00`);
  if (isNaN(t)) return 18;
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: VENUE_TZ, hour: "2-digit", hour12: false,
  }).format(t);
  return Number(h);
}

function eventLine(e) {
  const when = [e.doors, e.ends].every(Boolean)
    ? `${String(e.doors).replace(/:00/, "").toLowerCase().replace(/\s+/g, "")} to ${String(e.ends).replace(/:00/, "").toLowerCase().replace(/\s+/g, "")}`
    : "";
  const name = e.name || e.artist || "";
  const bits = [name, e.genre || "", when].filter(Boolean);
  return bits.join(" \u2014 ");
}

// What a post should read as on the board.
//
// `title` is the feed's list heading and is derived from the FIRST SENTENCE of
// the post — so "We have food tonight! Select the event to see the menu" gets a
// title of "We have food tonight!" and the instruction is lost. On a one-line
// board the whole sentence is the message, so prefer the body when it fits.
// Long automation captions do not fit, and for those the short title is exactly
// right, which is why this falls back rather than always using the body.
function boardLine(p) {
  const body = String(p.text || "").trim().replace(/\s+/g, " ");
  if (body && body.length <= 80) return body;
  return clip(p.title || body, 80);
}

function buildOnAir(events, posts) {
  const out = { now: null, tonight: null, special: null };
  const nowV = venueNow();
  const list = (posts || []).slice().sort((a, b) =>
    new Date(b.published || 0) - new Date(a.published || 0));
  const catsOf = (p) => (Array.isArray(p.categories) && p.categories.length
    ? p.categories : [p.category || ""]).map((c) => String(c).toLowerCase());
  const used = new Set();

  // ---- WHAT'S ON -----------------------------------------------------------
  const todays = (events || [])
    .filter((e) => e.date === nowV.date)
    .sort((a, b) => startHour(a) - startHour(b));
  // the one still to come (or running); otherwise the last of the day
  const upcoming = todays.find((e) => startHour(e) * 60 + 90 >= nowV.minutes);
  const ev = upcoming || todays[todays.length - 1];
  if (ev) {
    const h = startHour(ev);
    const lab = h < 12 ? "This Morning" : h < 17 ? "This Afternoon" : "Tonight";
    out.tonight = { label: lab, text: clip(eventLine(ev), 80), href: eventUrl(ev) };
  } else {
    const next = (events || []).find((e) => e.date > nowV.date);
    if (next) out.tonight = { label: "Next Up", text: clip(`${next.day} \u2014 ${eventLine(next)}`, 80), href: eventUrl(next) };
  }

  // ---- SPECIAL -------------------------------------------------------------
  // A genuine one-off special post wins while it is live; the feed has already
  // dropped anything expired, so no date arithmetic is needed here.
  const sp = list.find((p) => catsOf(p).includes("special"));
  if (sp) {
    out.special = { label: "Special", text: boardLine(sp) };
    used.add(sp.id);
  } else {
    const inWindow = nowV.dow === HAPPY_HOUR.dow
      && nowV.minutes >= HAPPY_HOUR.from * 60 && nowV.minutes < HAPPY_HOUR.to * 60;
    out.special = inWindow
      ? { label: "Happy Hour", text: HAPPY_HOUR.detail }
      : { label: "Special", text: HAPPY_HOUR.standing };
  }

  // ---- NOW -----------------------------------------------------------------
  const upd = list.find((p) => catsOf(p).includes("update") && !used.has(p.id));
  if (upd) {
    out.now = { label: "Now", text: boardLine(upd) };
    used.add(upd.id);
  } else {
    const h = HOURS[nowV.dow];
    const openM = h.open * 60, closeM = h.close * 60;
    out.now = nowV.minutes < openM
      ? { label: "Now", text: `Closed \u2014 opening at ${hr(h.open)} today` }
      : nowV.minutes < closeM
        ? { label: "Now", text: `Open until ${hr(h.close)} today` }
        : { label: "Now", text: `Closed \u2014 open ${hr(HOURS[(nowV.dow + 1) % 7].open)} tomorrow` };
  }

  return out;
}
