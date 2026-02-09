import { Database } from "bun:sqlite";

const db = new Database("leaderboard.db");
db.run("PRAGMA journal_mode = WAL");
db.run(`
  CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
db.run("CREATE INDEX IF NOT EXISTS idx_score ON leaderboard(score DESC)");

const MAX_SLOTS = 10;

const getTop = db.prepare(
  "SELECT id, name, score, created_at FROM leaderboard ORDER BY score DESC, created_at ASC LIMIT ?"
);
const countRows = db.prepare("SELECT COUNT(*) as cnt FROM leaderboard");
const getMinTop = db.prepare(
  "SELECT MIN(score) as min_score FROM (SELECT score FROM leaderboard ORDER BY score DESC LIMIT ?)"
);
const insertScore = db.prepare(
  "INSERT INTO leaderboard (name, score) VALUES (?, ?) RETURNING id, name, score, created_at"
);
const deleteLowest = db.prepare(
  "DELETE FROM leaderboard WHERE id = (SELECT id FROM leaderboard ORDER BY score ASC, created_at DESC LIMIT 1)"
);

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // API: GET leaderboard
    if (req.method === "GET" && url.pathname === "/api/leaderboard") {
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20") || 20, 1), 100);
      const rows = getTop.all(limit);
      return Response.json(rows);
    }

    // API: POST leaderboard
    if (req.method === "POST" && url.pathname === "/api/leaderboard") {
      try {
        const body = await req.json();
        const name = (typeof body.name === "string" ? body.name : "").trim().slice(0, 20);
        const score = typeof body.score === "number" ? Math.floor(body.score) : NaN;

        if (!name) return Response.json({ error: "Name is required" }, { status: 400 });
        if (!Number.isFinite(score) || score < 0) return Response.json({ error: "Score must be a non-negative integer" }, { status: 400 });

        const { cnt } = countRows.get() as { cnt: number };
        if (cnt >= MAX_SLOTS) {
          const { min_score } = getMinTop.get(MAX_SLOTS) as { min_score: number };
          if (score <= min_score) {
            return Response.json({ error: "Score too low to make the leaderboard" }, { status: 409 });
          }
          deleteLowest.run();
        }

        const entry = insertScore.get(name, score);
        return Response.json(entry, { status: 201 });
      } catch {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }
    }

    // Static: serve index.html
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file("index.html"));
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log("Cross Five server running on http://localhost:3000");
