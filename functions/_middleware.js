import { getEvents, buildJsonLd, buildListHtml } from "./utils/events.js";
// Inject live JSON-LD + the events list into the homepage HTML at the edge.
// Fail-safe: any error returns the original static page untouched (the seed).
export async function onRequest(context) {
  const { request, next, env } = context;
  const res = await next();
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return res;
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  let events;
  try { events = await getEvents(env); } catch (e) { return res; }
  if (!events || !events.length) return res;
  const jsonld = buildJsonLd(events);
  const list = buildListHtml(events);
  return new HTMLRewriter()
    .on("#events-jsonld", { element(el) { el.setInnerContent(jsonld, { html: true }); } })
    .on("#events-list", { element(el) { el.setInnerContent(list, { html: true }); } })
    .transform(res);
}
