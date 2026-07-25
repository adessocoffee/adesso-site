// One page per event: /live/2026-07-25-carola
//
// This is the page the On Air board and the /live cards link into, and the page
// the Event JSON-LD now claims as its canonical url. Before this, all 22 events
// pointed at /#events, so a reader had nowhere to land and structured data had
// 22 Events sharing one URL.
//
// Everything on it comes from the same ChowdownOS events feed the rest of the
// site reads, so a menu written in the OS in the morning is on this page the
// same morning. No deploy, no build step.
import { getEvents, SITE, VENUE, timeRange, eventTitle, eventUrl } from "../utils/events.js";
import { PAGE_CSS } from "../utils/posts.js";

const he = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MONTH = ["", "January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"];

// One dish per LINE — never split on commas. A dish is routinely written
// "brie, fig jam and rosemary panini", and comma-splitting turns that into two
// fake menu items. There is no reliable way to tell a separator comma from a
// descriptive one, so the author's line breaks are the separator instead:
// write one per line and it lists, write a sentence and it stays a sentence.
function foodItems(food) {
  const f = (food || "").trim();
  if (!f) return [];
  const parts = f.split(/\s*(?:\r?\n|;|•|\u2022|\|)\s*/)
                 .map((x) => x.replace(/^[-–—*]\s*/, "").trim())
                 .filter(Boolean);
  return parts.length ? parts : [f];
}

// `about` is authored in the OS and can be anything from one sentence to a full
// tasting-menu document: headings, four pour sections, separators, a signature.
// A single <p> flattens all of that, so it renders as light markdown.
//
// Deliberately small and escape-first: the text is escaped BEFORE any markup is
// produced, so nothing an author pastes can inject HTML into the page.
function renderAbout(src) {
  const raw = String(src || "")
    // Word/Docs exports drag their own artifacts along — a repeated source
    // filename, smart separators, non-breaking spaces. Strip them rather than
    // make whoever pastes the document clean up by hand.
    .replace(/[^\s]*\.docx\b/gi, "")
    .replace(/\u00a0/g, " ")
    .replace(/^[\u2e3b\u2014\u2013\-*_]{3,}$/gm, "---")
    .trim();
  if (!raw) return "";

  // Escape first, THEN add markup — so a pasted document can never inject HTML.
  // Only http(s), mailto and tel targets are allowed through.
  const safeHref = (u) => (/^(https?:\/\/|mailto:|tel:)/i.test(u) ? u : "");
  const inline = (t) => he(t)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    // [label](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|tel:[^\s)]+)\)/g,
      (m, label, url) => { const h = safeHref(url); return h ? `<a href="${h}">${label}</a>` : label; })
    // a bare URL someone pasted, but not one already inside an href
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
      (m, pre, url) => `${pre}<a href="${url}">${url.replace(/^https?:\/\/(www\.)?/, "")}</a>`)
    // RSVP numbers are the whole point of an event page on a phone, so make
    // them dialable. 513.441.3817 / 513-441-3817 / (513) 441-3817 all match.
    .replace(/(^|[\s>(])(\(?\d{3}\)?[.\-\s]\d{3}[.\-\s]\d{4})(?=$|[\s<).,])/g,
      (m, pre, num) => `${pre}<a href="tel:+1${num.replace(/\D/g, "")}">${num}</a>`);

  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`<ul class="ev-ul">${list.join("")}</ul>`); list = null; } };

  for (const block of raw.split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^---$/.test(line)) { closeList(); out.push('<hr class="ev-hr">'); continue; }
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); const n = Math.min(h[1].length + 1, 4); out.push(`<h${n} class="ev-h${h[1].length}">${inline(h[2])}</h${n}>`); continue; }
      if (/^>\s?/.test(line)) { closeList(); out.push(`<blockquote class="ev-quote">${inline(line.replace(/^>\s?/, ""))}</blockquote>`); continue; }
      const li = line.match(/^[-*\u2022]\s+(.*)$/);
      if (li) { (list = list || []).push(`<li>${inline(li[1])}</li>`); continue; }
      closeList();
      out.push(`<p class="ev-p">${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

function longDate(e) {
  const [y, m, d] = (e.date || "").split("-").map(Number);
  return m ? `${e.day}, ${MONTH[m]} ${d}, ${y}` : e.day || "";
}

function buildEventPage(e, others) {
  const isMusic = (e.kind || "music") === "music";
  const title = e.name || e.artist;
  const when = [longDate(e), timeRange(e)].filter(Boolean).join(" · ");
  const items = foodItems(e.food);
  const aboutHtml = renderAbout(e.about);
  const desc = (e.about || "").trim() ||
    (isMusic ? `${e.genre || "Live music"} at ${VENUE.name}. ${when}. Free to attend.`
             : `${title} at ${VENUE.name}. ${when}.`);

  const ld = {
    "@context": "https://schema.org", "@type": isMusic ? "MusicEvent" : "Event",
    name: `${title} at ${VENUE.name}`,
    startDate: e.start, endDate: e.end,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: VENUE.name, address: {
      "@type": "PostalAddress", streetAddress: VENUE.streetAddress,
      addressLocality: VENUE.addressLocality, addressRegion: VENUE.addressRegion,
      postalCode: VENUE.postalCode, addressCountry: VENUE.addressCountry } },
    organizer: { "@type": "Organization", name: VENUE.name, url: VENUE.url },
    description: e.description || desc,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD",
      availability: "https://schema.org/InStock", url: eventUrl(e) },
    image: [SITE + "/assets/hero-poster.webp"], url: eventUrl(e),
  };
  if (isMusic) ld.performer = { "@type": "MusicGroup", name: e.artist };

  const metaDesc = (items.length
    ? `${e.genre || title} at ${VENUE.name}, ${when}. On the menu: ${items.join(", ")}.`
    : desc).slice(0, 300);

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${he(eventTitle(e))} &mdash; ${he(VENUE.name)}, Mason OH</title>
<meta name="description" content="${he(metaDesc)}">
<link rel="canonical" href="${eventUrl(e)}">
<meta property="og:title" content="${he(title)} at ${he(VENUE.name)}">
<meta property="og:description" content="${he(metaDesc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${eventUrl(e)}">
<meta property="og:image" content="${SITE}/assets/hero-poster.webp">
<meta property="og:site_name" content="${he(VENUE.name)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${he(title)} at ${he(VENUE.name)}">
<meta name="twitter:description" content="${he(metaDesc)}">
<meta name="twitter:image" content="${SITE}/assets/hero-poster.webp">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<script type="application/ld+json">${JSON.stringify(ld, null, 2)}</script>
<style>${PAGE_CSS}
/* This page lives on the same bone ground as /live. #e0723f is the on-dark
   accent used by the rail; on bone it only reaches 2.36:1, so text on this
   surface uses the brand red, matching the rule already set in posts.js. */
.ev-wrap{max-width:820px;margin:0 auto;padding:5rem 3rem 6rem;}
.ev-back{display:inline-flex;align-items:center;gap:.55rem;font-size:.64rem;letter-spacing:.22em;text-transform:uppercase;font-weight:600;border:1px solid rgba(26,22,17,.3);border-radius:999px;padding:.72rem 1.4rem;color:#1a1611;margin-bottom:2.6rem;}
.ev-back:hover{border-color:#ad3829;color:#ad3829;}
.ev-kicker{font-size:.62rem;letter-spacing:.34em;text-transform:uppercase;color:#ad3829;font-weight:600;margin-bottom:1.1rem;}
.ev-h1{font-weight:400;font-size:clamp(2.6rem,6.5vw,4.6rem);line-height:1;letter-spacing:-.03em;margin-bottom:.8rem;color:#1a1611;}
.ev-when{font-size:1rem;letter-spacing:.02em;color:rgba(26,22,17,.7);margin-bottom:.4rem;}
.ev-block{border-top:1px solid rgba(26,22,17,.16);padding-top:1.7rem;margin-top:2.8rem;}
.ev-lab{font-size:.6rem;letter-spacing:.3em;text-transform:uppercase;color:#ad3829;font-weight:600;margin-bottom:1.1rem;}
.ev-about{font-size:1.06rem;line-height:1.7;color:rgba(26,22,17,.82);max-width:620px;}
.ev-food{list-style:none;padding:0;margin:0;max-width:620px;}
.ev-food li{font-size:1.1rem;line-height:1.5;padding:.8rem 0 .8rem 1.5rem;border-bottom:1px solid rgba(26,22,17,.1);position:relative;color:#1a1611;}
.ev-food li:before{content:"";position:absolute;left:0;top:1.35rem;width:7px;height:7px;background:#ad3829;border-radius:50%;}
.ev-food li:last-child{border-bottom:0;}
.ev-more a{display:flex;justify-content:space-between;gap:1rem;padding:.9rem 0;border-bottom:1px solid rgba(26,22,17,.1);color:#1a1611;font-size:.98rem;}
.ev-more a:hover{color:#ad3829;}
.ev-more a span{color:rgba(26,22,17,.5);white-space:nowrap;font-size:.62rem;letter-spacing:.24em;text-transform:uppercase;}
/* long-form: a full tasting menu has to read like a menu, not a blog post.
   Pour headings get the rule; "Paired With" / "Why It Works" sit tighter to the
   text they belong to; the measure stays ~62ch so it is actually readable. */
.ev-longform{max-width:660px;}
.ev-longform .ev-p{font-size:1.02rem;line-height:1.72;color:rgba(26,22,17,.82);margin:0 0 1.15rem;}
.ev-longform .ev-p:last-child{margin-bottom:0;}
.ev-h1{margin-top:2.4rem;}
.ev-longform h2.ev-h1{font-size:1.7rem;font-weight:400;letter-spacing:-.015em;line-height:1.2;color:#1a1611;margin:2.6rem 0 .5rem;}
.ev-longform h3.ev-h2{font-size:1.24rem;font-weight:400;font-style:italic;letter-spacing:-.01em;color:rgba(26,22,17,.9);margin:.2rem 0 1.3rem;}
.ev-longform h4.ev-h3{font-size:.64rem;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:#ad3829;margin:2.6rem 0 .7rem;padding-top:1.5rem;border-top:1px solid rgba(26,22,17,.14);}
.ev-longform h4.ev-h4{font-size:.62rem;font-weight:600;letter-spacing:.26em;text-transform:uppercase;color:rgba(26,22,17,.55);margin:1.6rem 0 .5rem;}
.ev-longform .ev-quote{margin:1.6rem 0 1.9rem;padding:0 0 0 1.3rem;border-left:2px solid #ad3829;font-size:1.12rem;line-height:1.6;font-style:italic;color:rgba(26,22,17,.86);}
.ev-longform .ev-hr{border:0;border-top:1px solid rgba(26,22,17,.14);margin:2.4rem 0;}
.ev-longform .ev-ul{list-style:none;padding:0;margin:0 0 1.3rem;}
.ev-longform .ev-ul li{position:relative;padding:.3rem 0 .3rem 1.1rem;font-size:1.02rem;line-height:1.6;color:rgba(26,22,17,.82);}
.ev-longform .ev-ul li:before{content:"";position:absolute;left:0;top:.95rem;width:5px;height:5px;background:#ad3829;border-radius:50%;}
.ev-longform strong{font-weight:600;color:#1a1611;}\n.ev-longform a{color:#ad3829;border-bottom:1px solid rgba(173,56,41,.4);}\n.ev-longform a:hover{color:#8f2c22;border-bottom-color:#8f2c22;}
.ev-longform em{font-style:italic;}
@media(max-width:700px){.ev-wrap{padding:3.4rem 1.4rem 4rem;}
  .ev-longform h2.ev-h1{font-size:1.42rem;}
  .ev-longform .ev-quote{font-size:1.02rem;}}
</style></head><body>
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
  <a href="/live" style="position:relative;z-index:1;writing-mode:vertical-rl;transform:rotate(180deg);font-size:.56rem;letter-spacing:.3em;text-transform:uppercase;color:rgba(242,236,223,.6);">&larr; All events</a>
</aside>

<div class="lv-topbar" style="position:fixed;top:0;left:0;right:0;z-index:150;background:#0e0a06;align-items:center;justify-content:space-between;padding:.9rem 1.4rem;height:60px;">
  <a href="/"><img class="brandmark" src="/assets/wordmark-script.gif" alt="Adesso" style="height:30px;filter:invert(1);"></a>
  <a href="/live" style="font-size:.62rem;letter-spacing:.24em;text-transform:uppercase;font-weight:600;color:#f2ecdf;">What&rsquo;s on</a>
</div>

<main class="lv-main">
  <div class="ev-wrap">
    <a class="ev-back" href="/live"><span style="font-size:1rem;line-height:1;">&larr;</span> All events</a>
    <p class="ev-kicker">${he(isMusic ? (e.genre || "Live music") : "At Adesso")}</p>
    <h1 class="ev-h1">${he(title)}</h1>
    <p class="ev-when">${he(when)}${isMusic ? " &middot; Free to attend" : ""}</p>

    ${aboutHtml ? `<div class="ev-block ev-longform"><p class="ev-lab">About this event</p>
      ${aboutHtml}</div>` : ""}

    ${items.length ? `<div class="ev-block"><p class="ev-lab">On the menu</p>
      <ul class="ev-food">${items.map((i) => `<li>${he(i)}</li>`).join("")}</ul></div>` : ""}

    <div class="ev-block">
      <p class="ev-lab">Where</p>
      <p class="ev-about">${he(VENUE.name)}<br>125 E Main St, Mason, OH 45040<br>
        <a href="https://maps.google.com/?q=125+E+Main+St+Mason+OH+45040">Get directions</a></p>
    </div>

    ${others.length ? `<div class="ev-block ev-more"><p class="ev-lab">Also coming up</p>
      ${others.map((o) => `<a href="${eventUrl(o)}">${he(o.name || o.artist)}<span>${he(o.day)} ${he((o.date || "").slice(5).replace("-", "/"))}</span></a>`).join("")}
    </div>` : ""}
  </div>
</main>
</div></body></html>`;
}

export async function onRequestGet({ params, env }) {
  let events = [];
  try { events = await getEvents(env); } catch { events = []; }
  const id = decodeURIComponent(params.id || "");
  const e = events.find((x) => x.id === id);
  // An event that has already happened rolls off the feed, so its page stops
  // existing. Send those to /live rather than 404 — the link may be sitting in
  // a post someone reads a week late.
  if (!e) return Response.redirect(SITE + "/live", 302);
  const others = events.filter((x) => x.id !== id).slice(0, 4);
  return new Response(buildEventPage(e, others), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=120, must-revalidate",
    },
  });
}
