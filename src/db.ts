/**
 * Database Module - SQLite Event Storage
 * 
 * Provides persistence for extracted events using Bun's built-in SQLite.
 * Features dynamic schema evolution to handle varying event structures.
 * 
 * @module db
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

// Ensure data directory exists
try {
  mkdirSync("data", { recursive: true });
} catch (e) {
  // Ignore error if directory already exists
}

// Initialize database with auto-creation
const db = new Database("data/events.sqlite", { create: true });

// Create base events table with mandatory columns
db.run(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/**
 * Dynamically evolves the database schema to match incoming event properties.
 * 
 * SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we check existing
 * columns first and only add missing ones. All dynamic columns are TEXT type.
 * 
 * @param event - The event object whose keys should exist as columns
 */
function evolveSchema(event: any): void {
  const columns = db.query("PRAGMA table_info(events)").all() as any[];
  const existingKeys = new Set(columns.map(c => c.name));

  for (const key of Object.keys(event)) {
    if (!existingKeys.has(key)) {
      console.log(`[DB] Evolving schema: adding column [${key}]`);
      try {
        db.run(`ALTER TABLE events ADD COLUMN ${key} TEXT`);
      } catch (e) {
        console.error(`[DB] Failed to add column ${key}:`, e);
      }
    }
  }
}

/**
 * Saves an event to the database.
 * 
 * Automatically generates a UUID for the event and evolves the schema
 * if the event contains new fields not yet in the database.
 * 
 * @param event - The event object to save (any structure)
 * @returns The generated UUID of the saved event
 * @throws Error if the insert operation fails
 * 
 * @example
 * const id = saveEvent({ title: "Meeting", venue_name: "Conference Room A" });
 */
export function saveEvent(event: any): string {
  // Evolve schema to accommodate new fields
  evolveSchema(event);

  const id = crypto.randomUUID();
  const keys = ["id", ...Object.keys(event)];
  const placeholders = keys.map(() => "?").join(", ");
  const sql = `INSERT INTO events (${keys.join(", ")}) VALUES (${placeholders})`;

  try {
    const query = db.prepare(sql);
    const values = [
      id,
      ...Object.values(event).map(v =>
        typeof v === 'object' ? JSON.stringify(v) : String(v)
      )
    ];
    query.run(...values);
    return id;
  } catch (e) {
    console.error("[DB] Insert failed:", e);
    throw e;
  }
}

/**
 * Retrieves all events from the database, ordered by creation date (newest first).
 * 
 * @returns Array of event objects
 * 
 * @example
 * const events = getAllEvents();
 * console.log(events[0].title); // Most recent event
 */
export function getAllEvents(): any[] {
  return db.query("SELECT * FROM events ORDER BY created_at DESC").all();
}

/**
 * Retrieves a single event by its ID.
 * 
 * @param id - The UUID of the event to retrieve
 * @returns The event object, or undefined if not found
 */
export function getEventById(id: string): any | undefined {
  return db.query("SELECT * FROM events WHERE id = ?").get(id);
}

/**
 * Deletes an event by its ID.
 * 
 * @param id - The UUID of the event to delete
 * @returns True if an event was deleted, false otherwise
 */
export function deleteEvent(id: string): boolean {
  const result = db.run("DELETE FROM events WHERE id = ?", [id]);
  return result.changes > 0;
}
