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

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Identifiant et mot de passe requis" });

  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "Identifiant ou mot de passe incorrect" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Identifiant ou mot de passe incorrect" });

    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
