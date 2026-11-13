import agent from "./server/prospection-agent.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return Response.json({ ok: true });
      if (url.pathname === "/api/prospection/sectors") return Response.json({ sectors: agent.listSectors() });
      if (url.pathname === "/api/prospection/page") {
        return Response.json(await agent.fetchBodaccPage(Object.fromEntries(url.searchParams)));
      }
      if (url.pathname === "/api/prospection/enrich" && request.method === "POST") {
        return Response.json(await agent.enrichCompany(await request.json()));
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Recherche impossible" }, { status: 400 });
    }
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "Route inconnue" }, { status: 404 });
    return env.ASSETS.fetch(request);
  }
};
