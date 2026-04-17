const router = require("express").Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const { pool } = require("../db");

const SEEDS_DIR = path.join(__dirname, "..", "seeds");

function loadSeeds() {
  const manifest = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, "games.json"), "utf-8"));
  return manifest.map((entry) => {
    try {
      const sets = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, entry.file), "utf-8"));
      return { name: entry.name, sets };
    } catch { return null; }
  }).filter(Boolean);
}

async function seedUser(userId) {
  const games = loadSeeds();
  for (const { name, sets } of games) {
    await pool.query(
      `INSERT INTO game_data (user_id, game_name, sets, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, game_name) DO NOTHING`,
      [userId, name, JSON.stringify(sets)]
    );
  }
}

router.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email et mot de passe requis" });
  if (password.length < 8) return res.status(400).json({ error: "Mot de passe trop court (8 caractères min)" });

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email.toLowerCase(), hash]
    );
    const user = result.rows[0];
    await seedUser(user.id);
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Email déjà utilisé" });
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email et mot de passe requis" });

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "Email ou mot de passe incorrect" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Email ou mot de passe incorrect" });

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
