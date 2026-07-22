import { getEvents, buildIcs } from "./utils/events.js";
export async function onRequestGet({ env }) {
  const events = await getEvents(env);
  return new Response(buildIcs(events), {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
