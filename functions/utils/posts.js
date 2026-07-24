// Canonical LOS (Live Operational State) engine — runs at the Cloudflare edge.
// The unified live feed = the venue's UPCOMING EVENTS (from the canonical events
// source, present now) PLUS NEW POSTS as they stream in (specials, menu items,
// live updates). Both come from ChowdownOS, so the business's own SITE is the
// real-time source of truth: a human /live page, a machine RSS feed, and JSON-LD.
// Reads the live sources each request (edge-cached ~2 min); no deploy when things
// change. Point a different site at a different account with POSTS_SOURCE.
import { getEvents, buildListHtml } from "./events.js";

const SOURCE_DEFAULT =
  "https://chowdownos.onrender.com/p/adesso-spirits-espresso/feed.json";

export const SITE = "https://adessospiritsandespresso.com";
export const VENUE = {
  name: "Adesso Spirits + Espresso", url: SITE + "/",
  streetAddress: "125 E Main St", addressLocality: "Mason",
  addressRegion: "OH", postalCode: "45040", addressCountry: "US",
};
const FEED_ICON = SITE + "/assets/feed-icon.png";
const EVENT_IMAGE = SITE + "/assets/hero-poster.webp";
const ACCENT = "ad3829";
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
    "@type": "Event",
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
    "@type": "SpecialAnnouncement",
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
// @graph: the page identity (tied to the homepage's shared @ids) followed by the
// live operational state — every post as a SpecialAnnouncement, every upcoming
// show as an Event.
export const buildLiveJsonLd = (events, posts) =>
  JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": SITE + "/live#webpage",
        url: SITE + "/live",
        name: `Live at ${VENUE.name}`,
        description: `Live from ${VENUE.name}: upcoming events, specials, new menu items, and what's on right now.`,
        isPartOf: { "@id": SITE + "/#website" },
        about: { "@id": SITE + "/#business" },
        inLanguage: "en-US",
        breadcrumb: { "@id": SITE + "/live#breadcrumb" },
      },
      {
        "@type": "BreadcrumbList",
        "@id": SITE + "/live#breadcrumb",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
          { "@type": "ListItem", position: 2, name: "Live", item: SITE + "/live" },
        ],
      },
      ...posts.map(postLd),
      ...events.map(eventLd),
    ],
  }, null, 2);

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

// --- human-readable /live page (redesign: 70s vintage bone + brand red) ------
const PAGE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:#e7dece;color:#1a1611;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-weight:300;-webkit-font-smoothing:antialiased}
a{color:#ad3829;text-decoration:none}a:hover{color:#8f2c22}
/* inline links inside body copy must be distinguishable by more than colour (WCAG 1.4.1) */
p a{text-decoration:underline;text-underline-offset:.18em}
img{max-width:100%;display:block}
/* brandmark: the wordmark is rotated AFTER layout, so the reset above would cap
   its pre-rotation width at the 88px rail and squash it. Opt it out. */
.brandmark{max-width:none !important;width:auto !important;flex:0 0 auto}
::selection{background:#ad3829;color:#f2ecdf}
@keyframes adRec{0%,100%{opacity:1}50%{opacity:.2}}
@media(prefers-reduced-motion:reduce){[style*="adRec"]{animation:none !important}}
#events-list{columns:2;column-gap:3.5rem}
#events-list .event-item{display:grid;grid-template-columns:66px 1fr;gap:1.5rem;padding:1.4rem 0;border-bottom:1px solid rgba(26,22,17,.14);align-items:center;break-inside:avoid}
#events-list .event-marker{text-align:center}
#events-list .event-marker .em{display:block;font-size:.58rem;letter-spacing:.26em;text-transform:uppercase;color:#ad3829;margin-bottom:.15rem;font-weight:500}
#events-list .event-marker .glyph{font-size:2rem;font-weight:300;line-height:1;color:#1a1611}
#events-list .event-name{font-size:1.12rem;font-weight:500;letter-spacing:-.01em;margin-bottom:.2rem}
#events-list .event-desc{font-size:.76rem;letter-spacing:.03em;color:rgba(26,22,17,.66);text-transform:uppercase}
.lv-main{margin-left:88px}
.lv-topbar{display:none}
.tab{font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;font-weight:500;font-family:inherit;border:1px solid rgba(26,22,17,.28);border-radius:999px;padding:.55rem 1.2rem;background:transparent;color:#1a1611;cursor:pointer;transition:background .2s,color .2s,border-color .2s}
.tab.on{background:#1a1611;color:#f2ecdf;border-color:#1a1611}
.lv-update{border:1px solid rgba(26,22,17,.16);background:#f3ecdd;overflow:hidden;margin-bottom:1.6rem}
.lv-update .u-img img{width:100%;aspect-ratio:1/1;object-fit:cover;background:#ded4c2}
.lv-update .u-body{padding:1.6rem 1.8rem}
.lv-update time{display:flex;align-items:center;gap:.5rem;font-size:.58rem;letter-spacing:.26em;text-transform:uppercase;color:#ad3829;font-weight:600;margin-bottom:.8rem}
.lv-update h3{font-weight:500;font-size:1.3rem;letter-spacing:-.01em;line-height:1.2;margin-bottom:.6rem}
.lv-update p{color:rgba(26,22,17,.72);font-size:.95rem;line-height:1.7}
.lv-update p+p{margin-top:.6rem}
.lv-empty{border:1px solid rgba(26,22,17,.16);background:#f3ecdd;padding:2.6rem 2rem;text-align:center;font-style:italic;font-size:1.1rem;color:rgba(26,22,17,.66)}
@media(max-width:820px){
  .lv-rail{display:none !important}
  .lv-main{margin-left:0 !important;padding-top:60px}
  .lv-topbar{display:flex !important}
  .lv-pad{padding:2.5rem 1.4rem 4rem !important}
  #events-list{columns:1 !important}
  .lv-h1{font-size:clamp(2.6rem,13vw,3.6rem) !important}
}
`;

function catWord(c) {
  c = (c || "update").toLowerCase();
  if (c === "special") return "Special";
  if (c === "feature") return "Feature";
  return "Update";
}

function updatesSection(posts) {
  if (!posts.length) {
    return `<div id="updates-list">
<!--UPDATES_LIST_START-->
      <div class="lv-empty" data-empty>No updates yet. New updates stream in here.</div>
<!--UPDATES_LIST_END-->
    </div>`;
  }
  const cards = posts.map((p) => {
    const cat = (p.category || "update").toLowerCase();
    const img = p.image ? `<div class="u-img"><img src="${heAttr(p.image)}" alt="" loading="lazy"></div>` : "";
    const body = "<p>" + he(p.text || "").replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>") + "</p>";
    const when = relTime(p.published);
    const meta = [when, catWord(cat)].filter(Boolean).join(" &middot; ");
    return `<article class="lv-update" data-cat="${cat}">${img}<div class="u-body">` +
      `<time><span style="width:7px;height:7px;border-radius:50%;background:#ad3829;display:inline-block;"></span>${he(meta)}</time>` +
      `<h3>${he(p.title || "Update")}</h3>${body}</div></article>`;
  }).join("\n");
  return `<div id="updates-list">
<!--UPDATES_LIST_START-->
${cards}
<!--UPDATES_LIST_END-->
    <div class="lv-empty" id="latest-empty" style="display:none">No updates yet. New updates stream in here.</div>
  </div>`;
}

const TABS = [["all","All"],["events","Events"],["updates","Updates"],["specials","Specials"],["features","Features"]];
function tabsBar() {
  return `<div style="display:flex;flex-wrap:wrap;gap:.6rem;margin-bottom:3rem;padding-bottom:1.6rem;border-bottom:1px solid rgba(26,22,17,.14);">` +
    TABS.map(([k, l], i) => `<button class="tab${i === 0 ? " on" : ""}" data-tab="${k}">${l}</button>`).join("") +
    `</div>`;
}

const FILTER_JS = `<script>(function(){
  var tabs=[].slice.call(document.querySelectorAll('.tab'));
  var coming=document.getElementById('sec-coming');
  var latest=document.getElementById('sec-latest');
  var empty=document.getElementById('latest-empty');
  var CATMAP={updates:'update',specials:'special',features:'feature'};
  function apply(f){
    var showComing=(f==='all'||f==='events');
    var showLatest=(f==='all'||f==='updates'||f==='specials'||f==='features');
    if(coming)coming.style.display=showComing?'':'none';
    if(latest)latest.style.display=showLatest?'':'none';
    var want=CATMAP[f]||null,vis=0;
    [].forEach.call(document.querySelectorAll('.lv-update'),function(el){
      var show=(!want||el.getAttribute('data-cat')===want);el.style.display=show?'':'none';if(show)vis++;
    });
    if(empty){var word=(f==='specials')?'specials':(f==='features')?'features':'updates';
      empty.textContent='No '+word+' yet. New '+word+' stream in here.';
      empty.style.display=(showLatest&&document.querySelectorAll('.lv-update').length&&!vis)?'':'none';}
    tabs.forEach(function(t){t.classList.toggle('on',t.getAttribute('data-tab')===f);});
  }
  tabs.forEach(function(t){t.addEventListener('click',function(){apply(t.getAttribute('data-tab'));});});
})();</script>`;

export function buildLivePage(events, posts) {
  const jsonld = buildLiveJsonLd(events, posts);
  const eventsHtml = events.length ? buildListHtml(events) :
    `<div class="lv-empty">No events on the calendar right now.</div>`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live Music &amp; What's On Now — ${he(VENUE.name)}, Mason OH</title>
<meta name="description" content="Live from ${he(VENUE.name)}: upcoming live music, specials, new menu items, and what's on right now. 125 E Main St, Mason, OH.">
<link rel="canonical" href="${SITE}/live">
<meta property="og:title" content="Live at ${he(VENUE.name)}">
<meta property="og:description" content="Upcoming live music, specials, and what's on right now in downtown Mason, Ohio.">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/live">
<meta property="og:image" content="${SITE}/assets/hero-poster.webp">
<meta property="og:site_name" content="${he(VENUE.name)}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Live at ${he(VENUE.name)}">
<meta name="twitter:description" content="Upcoming live music, specials, and what's on right now in downtown Mason, Ohio.">
<meta name="twitter:image" content="${SITE}/assets/hero-poster.webp">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="alternate" type="application/rss+xml" title="Adesso Live" href="${SITE}/updates.xml">
<script type="application/ld+json">${jsonld}</script>
<style>${PAGE_CSS}</style>
</head><body>
<div style="position:relative;min-height:100vh;">

<aside class="lv-rail" style="position:fixed;top:0;left:0;bottom:0;width:88px;z-index:150;background:#0e0a06;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:1.8rem 0;overflow:hidden;">
  <div style="position:absolute;top:50%;left:50%;width:100vh;height:88px;transform:translate(-50%,-50%) rotate(90deg);background-image:url('/assets/floral-border.avif');background-size:auto;background-repeat:repeat;background-position:center;opacity:.5;"></div>
  <a href="/" aria-label="Adesso home" style="position:relative;z-index:1;flex:0 0 auto;display:flex;align-items:center;justify-content:center;height:230px;overflow:hidden;">
    <img class="brandmark" src="/assets/wordmark-script.gif" alt="Adesso" style="height:42px;transform:rotate(-90deg);filter:invert(1);">
  </a>
  <div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:.9rem;">
    <span style="width:13px;height:13px;border-radius:50%;background:#e0723f;animation:adRec 1.4s ease infinite;display:block;"></span>
    <span style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:1.1rem;letter-spacing:.24em;text-transform:uppercase;font-weight:700;color:#f2ecdf;">Live</span>
  </div>
  <a href="/" style="position:relative;z-index:1;writing-mode:vertical-rl;transform:rotate(180deg);font-size:.56rem;letter-spacing:.3em;text-transform:uppercase;color:rgba(242,236,223,.6);">&larr; Back to site</a>
</aside>

<div class="lv-topbar" style="position:fixed;top:0;left:0;right:0;z-index:150;background:#0e0a06;align-items:center;justify-content:space-between;padding:.9rem 1.4rem;height:60px;">
  <a href="/"><img class="brandmark" src="/assets/wordmark-script.gif" alt="Adesso" style="height:30px;filter:invert(1);"></a>
  <div style="display:flex;align-items:center;gap:.5rem;">
    <span style="width:8px;height:8px;border-radius:50%;background:#e0723f;animation:adRec 1.4s ease infinite;display:inline-block;"></span>
    <span style="font-size:.62rem;letter-spacing:.24em;text-transform:uppercase;font-weight:600;color:#f2ecdf;">Live</span>
  </div>
</div>

<main class="lv-main">
  <div class="lv-pad" style="max-width:1000px;margin:0 auto;padding:5rem 3rem 6rem;">

    <a href="/" style="display:inline-flex;align-items:center;gap:.55rem;font-size:.64rem;letter-spacing:.22em;text-transform:uppercase;font-weight:600;border:1px solid rgba(26,22,17,.3);border-radius:999px;padding:.72rem 1.4rem;color:#1a1611;margin-bottom:2.4rem;"><span style="font-size:1rem;line-height:1;">&larr;</span> Back to Adesso</a>

    <header style="margin-bottom:2.6rem;">
      <!-- #e0723f is the on-dark accent (rail/topbar). On the bone page background it
           only reaches 2.36:1, so light-surface text uses the brand red. -->
      <p style="font-size:.62rem;letter-spacing:.34em;text-transform:uppercase;color:#ad3829;font-weight:600;margin-bottom:1.2rem;display:flex;align-items:center;gap:.6rem;"><span style="width:9px;height:9px;border-radius:50%;background:#ad3829;animation:adRec 1.4s ease infinite;display:inline-block;"></span> Live at Adesso</p>
      <h1 class="lv-h1" style="font-weight:400;font-size:clamp(3rem,7vw,5.5rem);line-height:.98;letter-spacing:-.03em;margin-bottom:1.2rem;">What&rsquo;s on <span style="font-style:italic;color:#ad3829;">right now</span></h1>
      <p style="font-size:1rem;line-height:1.7;color:rgba(26,22,17,.7);max-width:560px;">Events, updates, specials and features from 125 E Main &mdash; posted the moment they happen. This is Adesso&rsquo;s live operational state, straight from the source.</p>
    </header>

    ${tabsBar()}

    <section id="sec-coming" style="margin-bottom:4rem;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin-bottom:.4rem;flex-wrap:wrap;">
        <h2 style="font-size:.72rem;letter-spacing:.32em;text-transform:uppercase;color:#ad3829;font-weight:600;">Coming Up</h2>
        <div style="display:flex;gap:1.2rem;font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;">
          <a href="/events.ics">Add to calendar</a><a href="/feed.xml">RSS</a>
        </div>
      </div>
      <p style="font-size:.8rem;color:rgba(26,22,17,.66);margin-bottom:1.6rem;">Live music every Friday &amp; Saturday, 6&ndash;9pm. Free to attend.</p>
      <div class="lv-events" id="events-list">${eventsHtml}</div>
    </section>

    <section id="sec-latest" style="margin-bottom:3rem;">
      <h2 style="font-size:.72rem;letter-spacing:.32em;text-transform:uppercase;color:#ad3829;font-weight:600;margin-bottom:1.6rem;">Latest</h2>
      ${updatesSection(posts)}
    </section>

    <footer style="padding-top:2.4rem;border-top:1px solid rgba(26,22,17,.14);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
      <p style="font-size:.72rem;color:rgba(26,22,17,.66);">Straight from the source &middot; <a href="/updates.xml">Subscribe (RSS)</a></p>
      <div style="display:flex;gap:1.4rem;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;">
        <a href="/" style="color:rgba(26,22,17,.66);">Back to Adesso</a>
        <a href="https://www.instagram.com/adessocoffee/" target="_blank" rel="noopener" style="color:rgba(26,22,17,.66);">Instagram</a>
        <a href="http://adessocoffee.square.site" target="_blank" rel="noopener" style="color:rgba(26,22,17,.66);">Order</a>
      </div>
    </footer>

  </div>
</main>
</div>
${FILTER_JS}
</body></html>`;
}
