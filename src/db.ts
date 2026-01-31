import { Database } from "bun:sqlite";

// Ensure the data directory exists
const db = new Database("data/events.sqlite", { create: true });

// Initialize tables with base mandatory columns
db.run(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/**
 * Ensures the database schema matches the incoming event object keys.
 * Dynamically adds columns to the SQLite table if they don't exist.
 */
function evolveSchema(event: any) {
  const columns = db.query("PRAGMA table_info(events)").all() as any[];
  const existingKeys = new Set(columns.map(c => c.name));

  for (const key of Object.keys(event)) {
    if (!existingKeys.has(key)) {
      console.log(`[DB] Evolving Schema: Adding column [${key}]`);
      try {
        db.run(`ALTER TABLE events ADD COLUMN ${key} TEXT`);
      } catch (e) {
        console.error(`[DB] Failed to add column ${key}:`, e);
      }
    }
  }
}

export function saveEvent(event: any) {
  // 1. Evolve schema to match data
  evolveSchema(event);

  const id = crypto.randomUUID();
  const keys = ["id", ...Object.keys(event)];
  const placeholders = keys.map(() => "?").join(", ");
  const sql = `INSERT INTO events (${keys.join(", ")}) VALUES (${placeholders})`;

  try {
    const query = db.prepare(sql);
    const values = [id, ...Object.values(event).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v))];
    query.run(...values);
    return id;
  } catch (e) {
    console.error("[DB] Insert Failed:", e);
    throw e;
  }
}

export function getAllEvents() {
  return db.query("SELECT * FROM events ORDER BY created_at DESC").all();
}
