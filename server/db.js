import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "chat.db");

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )
`);

function insertMessage({ username, type, content, timestamp }) {
  const stmt = db.prepare(
    "INSERT INTO messages (username, type, content, timestamp) VALUES (?, ?, ?, ?)"
  );
  const result = stmt.run(username, type, content, timestamp);
  return result.lastInsertRowid;
}

function getMessages(limit = 100) {
  const stmt = db.prepare(
    "SELECT * FROM messages ORDER BY id ASC LIMIT ?"
  );
  return stmt.all(limit);
}

export { insertMessage, getMessages };