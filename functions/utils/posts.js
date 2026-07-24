// Canonical LOS (Live Operational State) engine — runs at the Cloudflare edge.
// The unified live feed = the venue's UPCOMING EVENTS (from the canonical events
// source, present now) PLUS NEW POSTS as they stream in (specials, menu items,
// live updates). Both come from ChowdownOS, so the business's own SITE is the
// real-time source of truth: a human /live page, a machine RSS feed, and JSON-LD.
// Reads the live sources each request (edge-cached ~2 min); no deploy when things
// change. Point a different site at a different account with POSTS_SOURCE.
import { getEvents } from "./events.js";

const SOURCE_DEFAULT =
  "https://chowdownos.onrender.com/p/adesso-spirits-espresso/feed.json";

export const SITE = "https://adesso-site.pages.dev";
export const VENUE = {
  name: "Adesso Spirits + Espresso", url: SITE + "/",
  streetAddress: "125 E Main St", addressLocality: "Mason",
  addressRegion: "OH", postalCode: "45040", addressCountry: "US",
};
const FEED_ICON = SITE + "/assets/feed-icon.png";
const EVENT_IMAGE = SITE + "/assets/hero-poster.webp";
const ACCENT = "c9a84c";
const MON = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const he = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const heAttr = (s) => he(s).replace(/"/g, "&quot;");

export async function getPosts(env) {
  const url = (env && env.POSTS_SOURCE) || SOURCE_DEFAULT;
  const r = await fetch(url, { cf: { cacheTtl: 120, cacheEverything: true } });
  if (!r.ok) throw new Error("posts source " + r.status);
  const doc = await r.json();
  return Array.isArray(doc.updates) ? doc.updates : [];
}

// Fetch both sources; either can fail without taking the page down.
export async function getLive(env) {
  let events = [], posts = [];
  try { events = await getEvents(env); } catch (e) { events = []; }
  try { posts = await getPosts(env); } catch (e) { posts = []; }
  return { events, posts };
}

function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 0) return "";
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " hr ago";
  const days = Math.round(s / 86400);
  if (days < 7) return days + (days === 1 ? " day ago" : " days ago");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// --- machine-readable outputs ------------------------------------------------
function eventLd(e) {
  return {
    "@context": "https://schema.org", "@type": "Event",
    name: `${e.artist} at ${VENUE.name}`, startDate: e.start, endDate: e.end,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: VENUE.name, address: {
      "@type": "PostalAddress", streetAddress: VENUE.streetAddress,
      addressLocality: VENUE.addressLocality, addressRegion: VENUE.addressRegion,
      postalCode: VENUE.postalCode, addressCountry: VENUE.addressCountry } },
    performer: { "@type": "MusicGroup", name: e.artist },
    organizer: { "@type": "Organization", name: VENUE.name, url: VENUE.url },
    description: e.description, image: [EVENT_IMAGE], url: SITE + "/#events",
  };
}
function postLd(p) {
  const o = {
    "@context": "https://schema.org", "@type": "SpecialAnnouncement",
    name: p.title || "Update", text: p.text || p.title || "",
    datePosted: p.published || new Date().toISOString(),
    announcementLocation: { "@type": "LocalBusiness", name: VENUE.name, address: {
      "@type": "PostalAddress", streetAddress: VENUE.streetAddress,
      addressLocality: VENUE.addressLocality, addressRegion: VENUE.addressRegion,
      postalCode: VENUE.postalCode, addressCountry: VENUE.addressCountry } },
    url: SITE + "/live",
  };
  if (p.image) o.image = [p.image];
  return o;
}
export const buildLiveJsonLd = (events, posts) =>
  JSON.stringify([...posts.map(postLd), ...events.map(eventLd)], null, 2);

// One merged, date-sorted item stream for the RSS feed.
function mergedItems(events, posts) {
  const evi = events.map((e) => ({
    kind: "event", id: "ev-" + e.id,
    title: `${e.artist} — ${e.genre}`,
    text: e.description, image: EVENT_IMAGE,
    date: e.start || (e.date + "T18:00:00-04:00"), link: SITE + "/#events",
  }));
  const poi = posts.map((p) => ({
    kind: "post", id: "po-" + p.id,
    title: p.title || "Update", text: p.text || "", image: p.image || "",
    date: p.published || new Date().toISOString(), link: SITE + "/live",
  }));
  return [...poi, ...evi].sort((a, b) => new Date(b.date) - new Date(a.date));
}

export function buildUpdatesRss(events, posts) {
  const items = mergedItems(events, posts).map((it) => {
    const pub = new Date(it.date);
    const pubStr = isNaN(pub) ? new Date().toUTCString() : pub.toUTCString();
    const media = it.image ? `\n      <media:content url="${heAttr(it.image)}" medium="image"/>\n      <enclosure url="${heAttr(it.image)}" type="image/jpeg"/>` : "";
    const imgHtml = it.image ? `<img src="${heAttr(it.image)}" alt=""/><br/>` : "";
    const content = `<![CDATA[${imgHtml}<p>${he(it.text || it.title)}</p>]]>`;
    return "    <item>\n" +
      `      <title>${he(it.title)}</title>\n` +
      `      <link>${it.link}</link>\n` +
      `      <guid isPermaLink="false">adesso-${it.id}</guid>\n` +
      `      <pubDate>${pubStr}</pubDate>\n` +
      `      <category>${it.kind === "event" ? "Event" : "Update"}</category>\n` +
      `      <description>${he(it.text || it.title)}</description>\n` +
      `      <content:encoded>${content}</content:encoded>` + media + "\n" +
      "    </item>";
  }).join("\n");
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:webfeeds="http://webfeeds.org/rss/1.0">\n<channel>\n' +
    `  <title>${he(VENUE.name)} — Live</title>\n  <link>${SITE}/live</link>\n` +
    `  <atom:link href="${SITE}/updates.xml" rel="self" type="application/rss+xml"/>\n` +
    `  <description>Live from ${he(VENUE.name)}, Mason OH. Upcoming events, specials, new menu items, and what's on right now.</description>\n` +
    `  <language>en-us</language>\n` +
    `  <image><url>${FEED_ICON}</url><title>${he(VENUE.name)}</title><link>${SITE}/live</link></image>\n` +
    `  <webfeeds:icon>${FEED_ICON}</webfeeds:icon>\n  <webfeeds:logo>${FEED_ICON}</webfeeds:logo>\n  <webfeeds:accentColor>${ACCENT}</webfeeds:accentColor>\n` +
    `  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n` +
    items + "\n</channel></rss>\n";
}

// --- human-readable /live page ----------------------------------------------
const PAGE_CSS = `
:root{--cream:#f5f0e8;--warm-black:#0d0905;--gold:#c9a84c;--gold-light:#e8c97a;--muted:#9a8a75;--border:rgba(201,168,76,0.18);--line:rgba(245,240,232,0.07)}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--warm-black);color:var(--cream);font-family:"Jost",system-ui,sans-serif;font-weight:300;line-height:1.6;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}a{color:inherit}
.lv-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.4rem 1.6rem;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(13,9,5,0.93);backdrop-filter:blur(12px);z-index:5}
.lv-head .back{font-size:.6rem;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);text-decoration:none;white-space:nowrap}
.lv-head .back:hover{color:var(--gold)}
.lv-title{text-align:center}
.lv-title .eyebrow{display:block;font-size:.55rem;letter-spacing:.42em;text-transform:uppercase;color:var(--gold);margin-bottom:.35rem}
.lv-title h1{font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:300;font-size:clamp(1.35rem,4.5vw,2rem);color:var(--cream);line-height:1}
.lv-head .rss{font-size:.55rem;letter-spacing:.2em;text-transform:uppercase;border:1px solid var(--border);color:var(--gold);padding:.5rem .75rem;text-decoration:none}
.lv-head .rss:hover{border-color:var(--gold)}
.live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--gold);margin-right:.5rem;vertical-align:middle;animation:blink 2.2s ease-in-out infinite}
@keyframes blink{0%,100%{opacity:.35}50%{opacity:1}}
@media(prefers-reduced-motion:reduce){.live-dot{animation:none}}
.wrap{max-width:640px;margin:0 auto;padding:2.25rem 1.2rem 4.5rem}
.pills{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 2rem;justify-content:center}
.pill{font-size:.58rem;letter-spacing:.18em;text-transform:uppercase;font-family:inherit;color:var(--muted);background:none;border:1px solid var(--border);border-radius:999px;padding:.5rem 1rem;cursor:pointer;transition:color .15s,border-color .15s,background .15s}
.pill:hover{color:var(--gold);border-color:var(--gold-dim,rgba(201,168,76,0.4))}
.pill.on{color:var(--warm-black);background:var(--gold);border-color:var(--gold)}
.sec-label{font-size:.56rem;letter-spacing:.4em;text-transform:uppercase;color:var(--gold);display:flex;align-items:center;gap:.9rem;margin:.5rem 0 1.4rem}
.sec-label::after{content:"";flex:1;height:1px;background:var(--border)}
.sec-label.mt{margin-top:3rem}
.ev{display:grid;grid-template-columns:52px 1fr;gap:1.1rem;padding:1.1rem 0;border-bottom:1px solid var(--line)}
.ev .mk{text-align:center}
.ev .mk .m{display:block;font-size:.55rem;letter-spacing:.18em;color:var(--gold)}
.ev .mk .d{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-size:1.7rem;line-height:1;color:var(--cream)}
.ev .en{font-size:1.05rem;color:var(--cream)}
.ev .ed{font-size:.82rem;color:var(--muted);margin-top:.15rem}
.update{border:1px solid var(--border);overflow:hidden;margin-bottom:1.75rem;background:rgba(201,168,76,0.03)}
.u-img img{width:100%;aspect-ratio:1/1;object-fit:cover;background:#171008}
.u-body{padding:1.5rem 1.6rem}
.u-body time{display:block;font-size:.56rem;letter-spacing:.26em;text-transform:uppercase;color:var(--gold);margin-bottom:.7rem}
.u-body h2{font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:300;font-size:1.5rem;line-height:1.25;color:var(--cream);margin-bottom:.7rem}
.u-body p{color:#d9cdba;font-size:.97rem;line-height:1.68}
.u-body p+p{margin-top:.75rem}
.empty{text-align:center;color:var(--muted);padding:2.5rem 1rem;font-style:italic;font-family:"Cormorant Garamond",Georgia,serif;font-size:1.15rem}
.lv-foot{text-align:center;font-size:.72rem;color:var(--muted);padding:2rem 1.2rem 3rem;border-top:1px solid var(--line);line-height:1.9}
.lv-foot a{color:var(--gold);text-decoration:none}
@media(max-width:520px){.lv-head{padding:1.05rem .95rem}.u-body{padding:1.25rem}}
`;

function eventsSection(events) {
  if (!events.length) return "";
  const rows = events.slice(0, 12).map((e) => {
    const [, m, d] = e.date.split("-").map(Number);
    return `<div class="ev" data-cat="event"><div class="mk"><span class="m">${MON[m]}</span><span class="d">${d}</span></div>` +
      `<div><div class="en">${he(e.artist)}</div><div class="ed">${he(e.day)} &middot; ${he(e.genre)} &middot; 6 to 9pm</div></div></div>`;
  }).join("\n");
  return `<div class="secblk" data-sec><div class="sec-label">Coming up</div>${rows}</div>`;
}
function postsSection(posts) {
  const inner = !posts.length
    ? `<p class="empty">No new posts yet. New updates stream in here.</p>`
    : posts.map((p) => {
        const cat = (p.category || "update").toLowerCase();
        const img = p.image ? `<div class="u-img"><img src="${heAttr(p.image)}" alt="" loading="lazy"></div>` : "";
        const body = "<p>" + he(p.text || "").replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>") + "</p>";
        return `<article class="update" data-cat="${cat}">${img}<div class="u-body"><time>${he(relTime(p.published))}</time>` +
          `<h2>${he(p.title || "Update")}</h2>${body}</div></article>`;
      }).join("\n");
  return `<div class="secblk" data-sec><div class="sec-label mt">Latest</div>${inner}</div>`;
}
const PILLS = [
  ["all", "All"], ["event", "Events"], ["update", "Updates"], ["special", "Specials"], ["feature", "Features"],
];
function pillsBar() {
  return `<div class="pills">` + PILLS.map(([f, label], i) =>
    `<button class="pill${i === 0 ? " on" : ""}" data-f="${f}">${label}</button>`).join("") + `</div>`;
}
const FILTER_JS = `<script>(function(){
  var pills=[].slice.call(document.querySelectorAll('.pill'));
  var empty=document.getElementById('lv-empty');
  function apply(f){
    var any=0;
    [].forEach.call(document.querySelectorAll('[data-cat]'),function(el){
      var show=(f==='all'||el.getAttribute('data-cat')===f);el.style.display=show?'':'none';if(show)any++;
    });
    [].forEach.call(document.querySelectorAll('[data-sec]'),function(sec){
      var vis=0;[].forEach.call(sec.querySelectorAll('[data-cat]'),function(i){if(i.style.display!=='none')vis++;});
      sec.style.display=vis?'':'none';
    });
    if(empty)empty.style.display=any?'none':'block';
  }
  pills.forEach(function(p){p.addEventListener('click',function(){
    pills.forEach(function(x){x.classList.remove('on');});p.classList.add('on');apply(p.getAttribute('data-f'));
  });});
})();</script>`;

export function buildLivePage(events, posts) {
  const jsonld = buildLiveJsonLd(events, posts);
  const hasAny = events.length || posts.length;
  const body = hasAny
    ? pillsBar() + eventsSection(events) + postsSection(posts) +
        `<p class="empty" id="lv-empty" style="display:none">Nothing here right now.</p>`
    : `<p class="empty" style="padding:5rem 1rem">Nothing on right now. Check back soon.</p>`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live at ${he(VENUE.name)}</title>
<meta name="description" content="Live from ${he(VENUE.name)}: upcoming events, specials, new menu items, and what's on right now.">
<link rel="canonical" href="${SITE}/live">
<link rel="icon" href="/assets/feed-icon.png">
<link rel="alternate" type="application/rss+xml" title="Adesso Live" href="${SITE}/updates.xml">
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<script type="application/ld+json">${jsonld}</script>
<style>${PAGE_CSS}</style>
</head><body>
<header class="lv-head">
  <a class="back" href="/">&larr; Adesso</a>
  <div class="lv-title"><span class="eyebrow"><span class="live-dot"></span>Live at Adesso</span><h1>What&rsquo;s on right now</h1></div>
  <a class="rss" href="/updates.xml" title="Subscribe (RSS)">RSS</a>
</header>
<main class="wrap">${body}</main>
<footer class="lv-foot">Live operational state, straight from the source.<br><a href="/updates.xml">Subscribe (RSS)</a> &middot; <a href="/">Back to adessospiritsandespresso.com</a></footer>
${hasAny ? FILTER_JS : ""}
</body></html>`;
}
