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
const heAttr = (s) => he(s).replace(/"/g, "&quot;");
const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sec";
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

// --- human-readable /menu page (redesign: 70s vintage bone + brand red) ------
const PAGE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:#e7dece;color:#1a1611;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-weight:300;-webkit-font-smoothing:antialiased}
a{color:#b23a2e;text-decoration:none}a:hover{color:#8f2c22}
img{max-width:100%;display:block}
/* brandmark: the wordmark is rotated AFTER layout, so the reset above would cap
   its pre-rotation width at the 88px rail and squash it. Opt it out. */
.brandmark{max-width:none !important;width:auto !important;flex:0 0 auto}
::selection{background:#b23a2e;color:#f2ecdf}
.mn-main{margin-left:88px}
.mn-topbar{display:none}
.mn-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 4rem}
.chip{font-size:.6rem;letter-spacing:.18em;text-transform:uppercase;font-weight:500;font-family:inherit;border:1px solid rgba(26,22,17,.28);border-radius:999px;padding:.5rem 1rem;color:#1a1611;background:transparent;white-space:nowrap;cursor:pointer;transition:background .2s,color .2s,border-color .2s}
.chip.on{background:#1a1611;color:#f2ecdf;border-color:#1a1611}
@media(max-width:820px){
  .mn-rail{display:none !important}
  .mn-main{margin-left:0 !important;padding-top:60px}
  .mn-topbar{display:flex !important}
  .mn-pad{padding:2.5rem 1.4rem 4rem !important}
  .mn-grid{grid-template-columns:1fr !important}
  .mn-h1{font-size:clamp(3rem,16vw,4.5rem) !important}
  .mn-chips{overflow-x:auto}
}
`;

function itemRow(it) {
  const pr = money(it.price);
  const price = pr ? `<span style="color:#b23a2e;font-weight:500;font-size:.92rem;white-space:nowrap;">${he(pr)}</span>` : "";
  const desc = it.desc ? `<p style="font-size:.78rem;color:rgba(26,22,17,.55);line-height:1.55;margin-top:.28rem;">${he(it.desc)}</p>` : "";
  return `<div style="padding:.85rem 0;border-bottom:1px solid rgba(26,22,17,.1);">` +
    `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:1rem;">` +
    `<span style="font-weight:500;font-size:1rem;letter-spacing:-.005em;">${he(it.name)}</span>${price}</div>${desc}</div>`;
}

function sectionBlock(s) {
  const id = slug(s.name);
  const group = s.group ? `<p style="font-size:.62rem;letter-spacing:.3em;text-transform:uppercase;color:#b23a2e;font-weight:600;margin-bottom:1.1rem;">${he(s.group)}</p>` : "";
  const items = (s.items || []).map(itemRow).join("\n");
  return `<section id="${id}" class="mn-sec" data-cat="${id}" style="padding:2.4rem 0 1rem;border-top:1px solid rgba(26,22,17,.16);">` +
    `<h2 style="font-weight:400;font-size:clamp(2rem,4vw,3rem);line-height:1;letter-spacing:-.02em;margin-bottom:2rem;">${he(s.name)}</h2>` +
    `${group}<div class="mn-grid">${items}</div></section>`;
}

function chipsBar(sections) {
  const all = `<button class="chip on" data-cat="all">All</button>`;
  const rest = sections.map((s) => `<button class="chip" data-cat="${slug(s.name)}">${he(s.name)}</button>`).join("");
  return `<div class="mn-chips" style="position:sticky;top:0;z-index:50;display:flex;gap:.5rem;padding:1.1rem 0;margin-bottom:1.5rem;background:#e7dece;border-bottom:1px solid rgba(26,22,17,.14);">${all}${rest}</div>`;
}

const CHIP_JS = `<script>(function(){
  var chips=[].slice.call(document.querySelectorAll('.chip'));
  function apply(f){
    [].forEach.call(document.querySelectorAll('.mn-sec'),function(s){
      s.style.display=(f==='all'||s.getAttribute('data-cat')===f)?'':'none';
    });
    chips.forEach(function(c){c.classList.toggle('on',c.getAttribute('data-cat')===f);});
  }
  chips.forEach(function(c){c.addEventListener('click',function(){apply(c.getAttribute('data-cat'));});});
})();</script>`;

export function buildMenuPage(sections) {
  const jsonld = buildMenuJsonLd(sections);
  const hasMenu = sections.length > 0;
  const body = hasMenu
    ? chipsBar(sections) + sections.map(sectionBlock).join("\n")
    : `<p style="text-align:center;color:rgba(26,22,17,.5);padding:4rem 1rem;font-style:italic;font-size:1.2rem;">Menu coming soon.</p>`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Menu — ${he(VENUE.name)}</title>
<meta name="description" content="The full menu at ${he(VENUE.name)}: espresso and specialty drinks, cocktails, wine, food and desserts. Mason, OH.">
<link rel="canonical" href="${SITE}/menu">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<script type="application/ld+json">${jsonld}</script>
<style>${PAGE_CSS}</style>
</head><body>
<div style="position:relative;min-height:100vh;">

<aside class="mn-rail" style="position:fixed;top:0;left:0;bottom:0;width:88px;z-index:150;background:#e7dece;border-right:1px solid rgba(26,22,17,.16);display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:1.8rem 0;">
  <a href="/" aria-label="Adesso home" style="flex:0 0 auto;display:flex;align-items:center;justify-content:center;height:230px;overflow:hidden;">
    <img class="brandmark" src="/assets/wordmark-script.gif" alt="Adesso" style="height:42px;transform:rotate(-90deg);">
  </a>
  <span style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:1rem;letter-spacing:.28em;text-transform:uppercase;font-weight:600;color:#1a1611;">Menu</span>
  <a href="/live" style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:.56rem;letter-spacing:.3em;text-transform:uppercase;color:rgba(26,22,17,.55);">Live &nearr;</a>
</aside>

<div class="mn-topbar" style="position:fixed;top:0;left:0;right:0;z-index:150;background:rgba(231,222,206,.96);backdrop-filter:blur(12px);border-bottom:1px solid rgba(26,22,17,.14);align-items:center;justify-content:space-between;padding:.9rem 1.4rem;height:60px;">
  <a href="/"><img class="brandmark" src="/assets/wordmark-script.gif" alt="Adesso" style="height:30px;"></a>
  <a href="http://adessocoffee.square.site" target="_blank" rel="noopener" style="font-size:.6rem;letter-spacing:.2em;text-transform:uppercase;background:#b23a2e;color:#f2ecdf;border-radius:999px;padding:.5rem .9rem;">Order</a>
</div>

<main class="mn-main">
  <div class="mn-pad" style="max-width:1060px;margin:0 auto;padding:5rem 3rem 6rem;">

    <a href="/" style="display:inline-flex;align-items:center;gap:.55rem;font-size:.64rem;letter-spacing:.22em;text-transform:uppercase;font-weight:600;border:1px solid rgba(26,22,17,.3);border-radius:999px;padding:.72rem 1.4rem;color:#1a1611;margin-bottom:2.4rem;"><span style="font-size:1rem;line-height:1;">&larr;</span> Back to Adesso</a>

    <header style="margin-bottom:2rem;">
      <p style="font-size:.62rem;letter-spacing:.34em;text-transform:uppercase;color:#b23a2e;font-weight:600;margin-bottom:1.1rem;">Adesso Spirits + Espresso</p>
      <h1 class="mn-h1" style="font-weight:400;font-size:clamp(3.4rem,9vw,7rem);line-height:.92;letter-spacing:-.03em;">The <span style="font-style:italic;color:#b23a2e;">Menu</span></h1>
    </header>

    ${body}

    <div style="margin-top:2.5rem;padding-top:2.2rem;border-top:1px solid rgba(26,22,17,.16);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1.2rem;">
      <p style="font-size:.78rem;color:rgba(26,22,17,.5);font-style:italic;">Prices &amp; offerings may change. See what&rsquo;s on right now on the <a href="/live">live feed</a>.</p>
      <a href="http://adessocoffee.square.site" target="_blank" rel="noopener" style="font-size:.64rem;letter-spacing:.24em;text-transform:uppercase;font-weight:600;background:#b23a2e;color:#f2ecdf;padding:1rem 2rem;">Order Online</a>
    </div>

  </div>
</main>
</div>
${hasMenu ? CHIP_JS : ""}
</body></html>`;
}
