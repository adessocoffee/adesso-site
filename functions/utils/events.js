// Canonical events engine — runs at the Cloudflare edge.
// Source of truth: ChowdownOS's canonical events endpoint, which is the venue's
// live calendar WITH the OS's manual swaps/overrides applied. So a change made in
// the OS (an LLM artist swap, etc.) lands here on the website as structured
// JSON-LD, not just on Facebook. No deploy needed when events change — this reads
// the live source each request (edge-cached ~2 min).
// To point a different site at a different account, set the EVENTS_SOURCE Pages var.

const SOURCE_DEFAULT =
  "https://chowdownos.onrender.com/p/adesso-spirits-espresso/events.json";

export const SITE = "https://adesso-site.pages.dev";
export const VENUE = {
  name: "Adesso Spirits + Espresso", url: SITE + "/",
  streetAddress: "125 E Main St", addressLocality: "Mason",
  addressRegion: "OH", postalCode: "45040", addressCountry: "US",
  timezone: "America/New_York",
};
const FALLBACK_IMAGE = SITE + "/assets/hero-poster.webp";
const MON = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const he = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Pull the canonical upcoming events from ChowdownOS.
export async function getEvents(env) {
  const url = (env && env.EVENTS_SOURCE) || SOURCE_DEFAULT;
  const r = await fetch(url, { cf: { cacheTtl: 120, cacheEverything: true } });
  if (!r.ok) throw new Error("events source " + r.status);
  const doc = await r.json();
  return Array.isArray(doc.events) ? doc.events : [];
}

// --- derived outputs ---------------------------------------------------------
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
    description: e.description,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD",
      availability: "https://schema.org/InStock", url: SITE + "/#events" },
    image: [FALLBACK_IMAGE], url: SITE + "/#events",
  };
}
export const buildJsonLd = (events) => JSON.stringify(events.map(eventLd), null, 2);

export function buildListHtml(events) {
  if (!events.length) return "";
  return events.map((e) => {
    const [, m, d] = e.date.split("-").map(Number);
    return (
      '<div class="event-item">' +
      `<div class="event-marker"><span class="em">${MON[m]}</span><span class="glyph">${d}</span></div>` +
      `<div><p class="event-name">${he(e.artist)}</p>` +
      `<p class="event-desc">${e.day} &middot; ${he(e.genre)} &middot; 6 to 9pm</p></div>` +
      "</div>"
    );
  }).join("\n");
}

export function buildJson(events) {
  return { venue: VENUE, updated: new Date().toISOString(), events };
}

const icsEsc = (s) => (s || "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
export function buildIcs(events) {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Adesso Spirits + Espresso//Live Music//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Adesso Live Music", "X-WR-TIMEZONE:America/New_York"];
  for (const e of events) {
    const ds = e.date.replace(/-/g, "");
    const loc = `${VENUE.name}, ${VENUE.streetAddress}, ${VENUE.addressLocality}, ${VENUE.addressRegion} ${VENUE.postalCode}`;
    L.push("BEGIN:VEVENT", `UID:${e.id}@adesso-site.pages.dev`, `DTSTAMP:${now}`,
      `DTSTART;TZID=America/New_York:${ds}T180000`, `DTEND;TZID=America/New_York:${ds}T210000`,
      `SUMMARY:${icsEsc(e.artist + " - " + e.genre)}`, `LOCATION:${icsEsc(loc)}`,
      `DESCRIPTION:${icsEsc(e.description)}`, `URL:${SITE}/#events`, "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.join("\r\n") + "\r\n";
}

export function buildRss(events) {
  const items = events.map((e) => {
    const [y, m, d] = e.date.split("-").map(Number);
    const pub = new Date(Date.UTC(y, m - 1, d, 22, 0)).toUTCString();
    return "    <item>\n" +
      `      <title>${he(e.artist + " - " + e.genre)}</title>\n` +
      `      <link>${SITE}/#events</link>\n` +
      `      <guid isPermaLink="false">${e.id}</guid>\n` +
      `      <pubDate>${pub}</pubDate>\n` +
      `      <description>${he(e.day + " " + MON[m] + " " + d + " - " + e.description)}</description>\n` +
      "    </item>";
  }).join("\n");
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n' +
    `  <title>${he(VENUE.name)} - Live Music</title>\n  <link>${SITE}/#events</link>\n` +
    `  <description>Upcoming live music at ${he(VENUE.name)}, Mason OH. Every Friday and Saturday, 6 to 9pm.</description>\n` +
    `  <language>en-us</language>\n  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n` +
    items + "\n</channel></rss>\n";
}
