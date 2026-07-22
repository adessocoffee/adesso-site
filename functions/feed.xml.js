import { getEvents, buildRss } from "./utils/events.js";
export async function onRequestGet({ env }) {
  const events = await getEvents(env);
  return new Response(buildRss(events), {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
