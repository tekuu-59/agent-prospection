/**
 * Serveur minimal pour l'agent de prospection (repo standalone).
 * Routes : /prospection, /api/prospection/*, /api/health
 */
const path = require("path");
const express = require("express");
const cors = require("cors");
const { createProspectionRouter } = require("./prospection-agent");

const ROOT_DIR = path.resolve(__dirname, "..");
const PROSPECTION_HTML_PATH = path.join(ROOT_DIR, "prospection.html");
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "agent-prospection" });
});

app.use("/api/prospection", createProspectionRouter());

app.get("/prospection", (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.sendFile(PROSPECTION_HTML_PATH);
});

app.get("/", (_req, res) => {
  res.redirect(302, "/prospection");
});

app.use(express.static(ROOT_DIR, { index: false }));

app.listen(PORT, () => {
  console.log(`Agent de prospection : http://localhost:${PORT}/prospection`);
});
