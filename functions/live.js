import { getLive, buildLivePage } from "./utils/posts.js";
// The human-readable /live feed page: upcoming events + streaming posts, one feed.
// Fail-safe: getLive swallows source errors, so this always returns a valid page.
export async function onRequestGet({ env }) {
  const { events, posts } = await getLive(env);
  return new Response(buildLivePage(events, posts), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, must-revalidate" },
  });
}
