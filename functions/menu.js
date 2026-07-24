import { getMenu, buildMenuPage } from "./utils/menu.js";
// The human-readable + machine-readable /menu page (schema.org Menu JSON-LD).
// Fail-safe: on any source error it still returns a valid page.
export async function onRequestGet({ env }) {
  let sections = [];
  try { sections = await getMenu(env); } catch (e) { sections = []; }
  return new Response(buildMenuPage(sections), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, must-revalidate" },
  });
}
