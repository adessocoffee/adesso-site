#!/usr/bin/env python3
"""Canonical events generator for the Adesso site.

events.json is the SINGLE SOURCE OF TRUTH. This regenerates the derived,
machine-readable artifacts so the site is the authoritative, platform-agnostic
source that Google, AI crawlers, calendars, and any fan-out layer can consume:

  - JSON-LD schema.org/Event array  -> injected into index.html <head>
  - the human-visible "Live Music" list -> injected into index.html #events
  - events.ics   -> calendar subscription (Apple / Google Calendar)
  - feed.xml     -> RSS 2.0 events feed

Usage:  python3 build_events.py     (run after editing events.json)
"""
import json, re, datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE_URL = "https://adesso-site.pages.dev"
FALLBACK_IMAGE = f"{SITE_URL}/assets/hero-poster.webp"
MON = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

data = json.loads((ROOT / "events.json").read_text())
V, events = data["venue"], data["events"]
now = dt.datetime.now(dt.timezone.utc)
stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
data["updated"] = stamp
(ROOT / "events.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def hesc(s): return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
def xesc(s): return hesc(s)
def iesc(s): return (s or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")


def address():
    return {"@type": "PostalAddress", "streetAddress": V["streetAddress"],
            "addressLocality": V["addressLocality"], "addressRegion": V["addressRegion"],
            "postalCode": V["postalCode"], "addressCountry": V["addressCountry"]}


def event_ld(e):
    return {
        "@context": "https://schema.org", "@type": "Event",
        "name": f'{e["artist"]} at {V["name"]}',
        "startDate": e["start"], "endDate": e["end"],
        "eventStatus": "https://schema.org/EventScheduled",
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "location": {"@type": "Place", "name": V["name"], "address": address()},
        "performer": {"@type": "MusicGroup", "name": e["artist"]},
        "organizer": {"@type": "Organization", "name": V["name"], "url": V["url"]},
        "description": e["description"],
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD",
                   "availability": "https://schema.org/InStock", "url": f"{SITE_URL}/#events"},
        "image": [e["image"]] if e.get("image") else [FALLBACK_IMAGE],
        "url": f"{SITE_URL}/#events",
    }


# ---- JSON-LD (an array of Event objects in one script) ----
ld = json.dumps([event_ld(e) for e in events], ensure_ascii=False, indent=2)
ld_block = f'<script type="application/ld+json">\n{ld}\n</script>'

# ---- human-visible list ----
items = []
for e in events:
    d = dt.date.fromisoformat(e["date"])
    items.append(
        '          <div class="event-item">\n'
        f'            <div class="event-marker"><span class="em">{MON[d.month]}</span>'
        f'<span class="glyph">{d.day}</span></div>\n'
        f'            <div><p class="event-name">{hesc(e["artist"])}</p>'
        f'<p class="event-desc">{e["day"]} &middot; {hesc(e["genre"])} &middot; 6 to 9pm</p></div>\n'
        '          </div>')
list_html = "\n".join(items)

# ---- inject into index.html between markers ----
idx = (ROOT / "index.html").read_text()


def region(html, start, end, content):
    return re.sub(re.escape(start) + r".*?" + re.escape(end),
                  start + "\n" + content + "\n" + end, html, flags=re.S)


idx = region(idx, "<!--EVENTS_JSONLD_START-->", "<!--EVENTS_JSONLD_END-->", ld_block)
idx = region(idx, "<!--EVENTS_LIST_START-->", "<!--EVENTS_LIST_END-->", list_html)
(ROOT / "index.html").write_text(idx)

# ---- events.ics ----
dstamp = now.strftime("%Y%m%dT%H%M%SZ")
lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Adesso Spirits + Espresso//Live Music//EN",
         "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Adesso Live Music",
         "X-WR-TIMEZONE:America/New_York"]
for e in events:
    d = dt.date.fromisoformat(e["date"]); ds = d.strftime("%Y%m%d")
    loc = f'{V["name"]}, {V["streetAddress"]}, {V["addressLocality"]}, {V["addressRegion"]} {V["postalCode"]}'
    lines += ["BEGIN:VEVENT", f"UID:{e['id']}@adesso-site.pages.dev", f"DTSTAMP:{dstamp}",
              f"DTSTART;TZID=America/New_York:{ds}T180000", f"DTEND;TZID=America/New_York:{ds}T210000",
              f"SUMMARY:{iesc(e['artist'] + ' - ' + e['genre'])}", f"LOCATION:{iesc(loc)}",
              f"DESCRIPTION:{iesc(e['description'])}", f"URL:{SITE_URL}/#events", "END:VEVENT"]
lines.append("END:VCALENDAR")
(ROOT / "events.ics").write_text("\r\n".join(lines) + "\r\n")

# ---- feed.xml (RSS 2.0) ----
rfc = now.strftime("%a, %d %b %Y %H:%M:%S +0000")
its = []
for e in events:
    d = dt.date.fromisoformat(e["date"])
    pub = dt.datetime(d.year, d.month, d.day, 22, 0, tzinfo=dt.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    its.append(
        "    <item>\n"
        f"      <title>{xesc(e['artist'] + ' - ' + e['genre'])}</title>\n"
        f"      <link>{SITE_URL}/#events</link>\n"
        f'      <guid isPermaLink="false">{e["id"]}</guid>\n'
        f"      <pubDate>{pub}</pubDate>\n"
        f"      <description>{xesc(e['day'] + ' ' + d.strftime('%b %d').replace(' 0', ' ') + ' - ' + e['description'])}</description>\n"
        "    </item>")
rss = ('<?xml version="1.0" encoding="UTF-8"?>\n'
       '<rss version="2.0"><channel>\n'
       f"  <title>{xesc(V['name'])} - Live Music</title>\n"
       f"  <link>{SITE_URL}/#events</link>\n"
       f"  <description>Upcoming live music at {xesc(V['name'])}, Mason OH. Every Friday and Saturday, 6 to 9pm.</description>\n"
       f"  <language>en-us</language>\n  <lastBuildDate>{rfc}</lastBuildDate>\n"
       + "\n".join(its) + "\n</channel></rss>\n")
(ROOT / "feed.xml").write_text(rss)

print(f"generated: {len(events)} events -> index.html (JSON-LD + list), events.ics, feed.xml")
