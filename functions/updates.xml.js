import { getLive, buildUpdatesRss } from "./utils/posts.js";
// Machine-readable RSS of the live operational feed: events + posts, one stream,
// with feed branding (icon + accent) for feed apps.
export async function onRequestGet({ env }) {
  const { events, posts } = await getLive(env);
  return new Response(buildUpdatesRss(events, posts), {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
