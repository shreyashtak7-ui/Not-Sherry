import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("forum.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'User',
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    description TEXT,
    order_index INTEGER
  );

  CREATE TABLE IF NOT EXISTS threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER,
    author_id INTEGER,
    title TEXT,
    content TEXT,
    is_pinned INTEGER DEFAULT 0,
    is_locked INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(category_id) REFERENCES categories(id),
    FOREIGN KEY(author_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER,
    author_id INTEGER,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(thread_id) REFERENCES threads(id),
    FOREIGN KEY(author_id) REFERENCES users(id)
  );
`);

// Seed initial data if empty
const categoryCount = db.prepare("SELECT COUNT(*) as count FROM categories").get() as { count: number };
if (categoryCount.count === 0) {
  const insertCat = db.prepare("INSERT INTO categories (name, description, order_index) VALUES (?, ?, ?)");
  insertCat.run("Announcements", "Official server updates and news.", 1);
  insertCat.run("General Discussion", "Talk about anything related to the server.", 2);
  insertCat.run("Bug Reports", "Report issues found in-game.", 3);
  insertCat.run("Staff Applications", "Apply to join the team.", 4);
  insertCat.run("Development", "Technical updates and dev logs.", 5);
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // --- API Routes ---

  // Auth (Simplified for demo, in real app use bcrypt/sessions)
  app.post("/api/auth/register", (req, res) => {
    const { username, password } = req.body;
    try {
      const role = username.toLowerCase() === 'admin' ? 'Main Dev' : 'User';
      const info = db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run(username, password, role);
      res.json({ id: info.lastInsertRowid, username, role });
    } catch (e) {
      res.status(400).json({ error: "Username already exists" });
    }
  });

  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND password = ?").get(username, password);
    if (user) {
      res.json(user);
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  // Forums
  app.get("/api/categories", (req, res) => {
    const categories = db.prepare("SELECT * FROM categories ORDER BY order_index").all();
    res.json(categories);
  });

  app.get("/api/categories/:id/threads", (req, res) => {
    const threads = db.prepare(`
      SELECT t.*, u.username as author_name, u.role as author_role,
      (SELECT COUNT(*) FROM posts WHERE thread_id = t.id) as reply_count
      FROM threads t
      JOIN users u ON t.author_id = u.id
      WHERE t.category_id = ?
      ORDER BY t.is_pinned DESC, t.created_at DESC
    `).all(req.params.id);
    res.json(threads);
  });

  app.post("/api/threads", (req, res) => {
    const { category_id, author_id, title, content } = req.body;
    const info = db.prepare("INSERT INTO threads (category_id, author_id, title, content) VALUES (?, ?, ?, ?)").run(category_id, author_id, title, content);
    res.json({ id: info.lastInsertRowid });
  });

  app.get("/api/threads/:id", (req, res) => {
    const thread = db.prepare(`
      SELECT t.*, u.username as author_name, u.role as author_role
      FROM threads t
      JOIN users u ON t.author_id = u.id
      WHERE t.id = ?
    `).get(req.params.id);
    const posts = db.prepare(`
      SELECT p.*, u.username as author_name, u.role as author_role, u.avatar as author_avatar
      FROM posts p
      JOIN users u ON p.author_id = u.id
      WHERE p.thread_id = ?
      ORDER BY p.created_at ASC
    `).all(req.params.id);
    res.json({ ...thread, posts });
  });

  app.post("/api/posts", (req, res) => {
    const { thread_id, author_id, content } = req.body;
    const info = db.prepare("INSERT INTO posts (thread_id, author_id, content) VALUES (?, ?, ?)").run(thread_id, author_id, content);
    res.json({ id: info.lastInsertRowid });
  });

  // Stats
  app.get("/api/stats", (req, res) => {
    const stats = {
      users: db.prepare("SELECT COUNT(*) as count FROM users").get(),
      threads: db.prepare("SELECT COUNT(*) as count FROM threads").get(),
      posts: db.prepare("SELECT COUNT(*) as count FROM posts").get()
    };
    res.json(stats);
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
