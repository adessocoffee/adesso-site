// Canonical menu engine — runs at the Cloudflare edge. Source of truth: the
// venue's structured menu in ChowdownOS (assistant-editable). Publishes a human
// /menu page AND schema.org Menu/MenuItem JSON-LD so Google + AI read the real
// menu. Reads the live source each request (edge-cached ~5 min); no redeploy when
// the menu changes. Point a different site at a different account with MENU_SOURCE.

const SOURCE_DEFAULT =
  "https://chowdownos.onrender.com/p/adesso-spirits-espresso/menu.json";

export const SITE = "https://adesso-site.pages.dev";
export const VENUE = { name: "Adesso Spirits + Espresso", url: SITE + "/" };

const he = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (p) => {
  const s = (p || "").trim();
  if (!s) return "";
  return s.split("/").map((x) => "$" + x.trim()).join(" / ");
};

export async function getMenu(env) {
  const url = (env && env.MENU_SOURCE) || SOURCE_DEFAULT;
  const r = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw new Error("menu source " + r.status);
  const doc = await r.json();
  const m = doc && doc.menu;
  return (m && Array.isArray(m.sections)) ? m.sections : [];
}

export function buildMenuJsonLd(sections) {
  const menuSections = sections.map((s) => ({
    "@type": "MenuSection", name: s.name,
    hasMenuItem: (s.items || []).map((it) => {
      const o = { "@type": "MenuItem", name: it.name };
      if (it.desc) o.description = it.desc;
      const price = (it.price || "").trim();
      if (price) {
        const first = price.split("/")[0].trim();
        o.offers = { "@type": "Offer", price: first, priceCurrency: "USD" };
      }
      return o;
    }),
  }));
  return JSON.stringify({
    "@context": "https://schema.org", "@type": "Menu",
    name: `${VENUE.name} Menu`, url: SITE + "/menu",
    hasMenuSection: menuSections,
  }, null, 2);
}

const PAGE_CSS = `
:root{--cream:#f5f0e8;--warm-black:#0d0905;--gold:#c9a84c;--gold-light:#e8c97a;--muted:#9a8a75;--border:rgba(201,168,76,0.18);--line:rgba(245,240,232,0.07)}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--warm-black);color:var(--cream);font-family:"Jost",system-ui,sans-serif;font-weight:300;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit}
.mn-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.4rem 1.6rem;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(13,9,5,0.93);backdrop-filter:blur(12px);z-index:5}
.mn-head .back{font-size:.6rem;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);text-decoration:none;white-space:nowrap}
.mn-head .back:hover{color:var(--gold)}
.mn-head .live{font-size:.6rem;letter-spacing:.2em;text-transform:uppercase;border:1px solid var(--border);color:var(--gold);padding:.5rem .8rem;text-decoration:none}
.mn-head .live:hover{border-color:var(--gold)}
.mn-title{text-align:center}
.mn-title .eyebrow{display:block;font-size:.55rem;letter-spacing:.42em;text-transform:uppercase;color:var(--gold);margin-bottom:.35rem}
.mn-title h1{font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:300;font-size:clamp(1.6rem,5vw,2.2rem);color:var(--cream);line-height:1}
.wrap{max-width:720px;margin:0 auto;padding:2.5rem 1.3rem 5rem}
.grp{font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-weight:300;font-size:clamp(1.8rem,6vw,2.6rem);color:var(--gold);text-align:center;margin:3rem 0 .4rem}
.grp:first-of-type{margin-top:.5rem}
.grp-rule{width:44px;height:1px;background:var(--gold);opacity:.5;margin:0 auto 2rem}
.sec{margin-bottom:2.2rem}
.sec-name{font-size:.62rem;letter-spacing:.32em;text-transform:uppercase;color:var(--gold);text-align:center;margin-bottom:1.2rem}
.item{padding:.85rem 0;border-bottom:1px solid var(--line)}
.item-hd{display:flex;align-items:baseline;gap:.75rem}
.item-nm{font-size:1.08rem;color:var(--cream)}
.item-dot{flex:1;border-bottom:1px dotted rgba(201,168,76,0.3);transform:translateY(-.28rem)}
.item-pr{font-size:1rem;color:var(--gold-light);white-space:nowrap;font-variant-numeric:tabular-nums}
.item-ds{font-size:.86rem;color:var(--muted);line-height:1.55;margin-top:.28rem;max-width:44rem}
.mn-foot{text-align:center;font-size:.72rem;color:var(--muted);padding:2rem 1.3rem 3rem;border-top:1px solid var(--line);line-height:1.9}
.mn-foot a{color:var(--gold);text-decoration:none}
@media(max-width:520px){.mn-head{padding:1.05rem .95rem}}
`;

export function buildMenuPage(sections) {
  const jsonld = buildMenuJsonLd(sections);
  let body = "", lastGroup = null;
  if (!sections.length) {
    body = `<p style="text-align:center;color:var(--muted);padding:4rem 1rem;font-style:italic;font-family:'Cormorant Garamond',Georgia,serif;font-size:1.2rem">Menu coming soon.</p>`;
  } else {
    for (const s of sections) {
      if (s.group && s.group !== lastGroup) {
        body += `<div class="grp">${he(s.group)}</div><div class="grp-rule"></div>`;
        lastGroup = s.group;
      }
      const items = (s.items || []).map((it) => {
        const pr = money(it.price);
        const price = pr ? `<span class="item-dot"></span><span class="item-pr">${he(pr)}</span>` : "";
        const desc = it.desc ? `<div class="item-ds">${he(it.desc)}</div>` : "";
        return `<div class="item"><div class="item-hd"><span class="item-nm">${he(it.name)}</span>${price}</div>${desc}</div>`;
      }).join("\n");
      body += `<div class="sec"><div class="sec-name">${he(s.name)}</div>${items}</div>`;
    }
  }
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Menu — ${he(VENUE.name)}</title>
<meta name="description" content="The full menu at ${he(VENUE.name)}: espresso and specialty drinks, cocktails, wine, food and desserts. Mason, OH.">
<link rel="canonical" href="${SITE}/menu">
<link rel="icon" href="/assets/feed-icon.png">
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<script type="application/ld+json">${jsonld}</script>
<style>${PAGE_CSS}</style>
</head><body>
<header class="mn-head">
  <a class="back" href="/">&larr; Adesso</a>
  <div class="mn-title"><span class="eyebrow">Adesso Spirits + Espresso</span><h1>Menu</h1></div>
  <a class="live" href="/live">Live</a>
</header>
<main class="wrap">${body}</main>
<footer class="mn-foot">Prices and offerings may change.<br><a href="/live">See what&rsquo;s on right now</a> &middot; <a href="/">adessospiritsandespresso.com</a></footer>
</body></html>`;
}
