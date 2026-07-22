import { getEvents, buildJson } from "./utils/events.js";
export async function onRequestGet({ env }) {
  try {
    const events = await getEvents(env);
    return new Response(JSON.stringify(buildJson(events), null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=300",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "events unavailable" }), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }
}
