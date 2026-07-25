// Canonical events engine — runs at the Cloudflare edge.
// Source of truth: ChowdownOS's canonical events endpoint, which is the venue's
// live calendar WITH the OS's manual swaps/overrides applied. So a change made in
// the OS (an LLM artist swap, etc.) lands here on the website as structured
// JSON-LD, not just on Facebook. No deploy needed when events change — this reads
// the live source each request (edge-cached ~2 min).
// To point a different site at a different account, set the EVENTS_SOURCE Pages var.

const SOURCE_DEFAULT =
  "https://chowdownos.onrender.com/p/adesso-spirits-espresso/events.json";

export const SITE = "https://adessospiritsandespresso.com";
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
// A music night is a MusicEvent with a performer; a wine club or a book signing
// is a plain Event and must NOT claim a MusicGroup performed at it.
function eventLd(e) {
  const isMusic = (e.kind || "music") === "music";
  const o = {
    "@context": "https://schema.org", "@type": isMusic ? "MusicEvent" : "Event",
    name: isMusic ? `${e.artist} at ${VENUE.name}` : `${e.name || e.artist} at ${VENUE.name}`,
    startDate: e.start, endDate: e.end,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: VENUE.name, address: {
      "@type": "PostalAddress", streetAddress: VENUE.streetAddress,
      addressLocality: VENUE.addressLocality, addressRegion: VENUE.addressRegion,
      postalCode: VENUE.postalCode, addressCountry: VENUE.addressCountry } },
    organizer: { "@type": "Organization", name: VENUE.name, url: VENUE.url },
    description: e.description,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD",
      availability: "https://schema.org/InStock", url: SITE + "/#events" },
    image: [FALLBACK_IMAGE], url: SITE + "/#events",
  };
  if (isMusic) o.performer = { "@type": "MusicGroup", name: e.artist };
  return o;
}

// "Carola - Latin Music" for a act, plain "Wine Club" when there's no genre.
export const eventTitle = (e) =>
  [e.name || e.artist, e.genre].filter(Boolean).join(" - ");

// "6 to 9pm", "9 to 10:30am", "11am to 1pm" — built from the event's real times,
// with the meridiem printed once when both ends share it.
export function timeRange(e) {
  // strip a bare ":00" so "6:00 PM" and "6 PM" both render as "6" — the feed has
  // emitted both forms, and this must not depend on which side deploys first
  const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, "").replace(/:00(?=[ap]m$)/, "");
  const a = norm(e.doors), b = norm(e.ends);
  if (!a || !b) return (e.kind || "music") === "music" ? "6 to 9pm" : "";
  const ap = a.slice(-2), bp = b.slice(-2);
  const av = a.slice(0, -2), bv = b.slice(0, -2);
  return ap === bp ? `${av} to ${bv}${bp}` : `${av}${ap} to ${bv}${bp}`;
}
export const buildJsonLd = (events) => JSON.stringify(events.map(eventLd), null, 2);

export function buildListHtml(events) {
  if (!events.length) return "";
  return events.map((e) => {
    const [, m, d] = e.date.split("-").map(Number);
    return (
      '<div class="event-item">' +
      `<div class="event-marker"><span class="em">${MON[m]}</span><span class="glyph">${d}</span></div>` +
      `<div><p class="event-name">${he(e.name || e.artist)}</p>` +
      `<p class="event-desc">${[e.day, he(e.genre || ""), timeRange(e)].filter(Boolean).join(" &middot; ")}</p></div>` +
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
    L.push("BEGIN:VEVENT", `UID:${e.id}@adessospiritsandespresso.com`, `DTSTAMP:${now}`,
      `DTSTART;TZID=America/New_York:${ds}T180000`, `DTEND;TZID=America/New_York:${ds}T210000`,
      `SUMMARY:${icsEsc(eventTitle(e))}`, `LOCATION:${icsEsc(loc)}`,
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
      `      <title>${he(eventTitle(e))}</title>\n` +
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
