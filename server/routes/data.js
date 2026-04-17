const router = require("express").Router();
const requireAuth = require("../middleware/auth");
const { pool } = require("../db");

router.use(requireAuth);

// GET /db/ping — timestamp de la dernière modification
router.get("/ping", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT MAX(updated_at) as last FROM game_data WHERE user_id = $1",
      [req.user.id]
    );
    res.json({ last: result.rows[0].last || null });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /db/all — toutes les parties du user
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT game_name, sets FROM game_data WHERE user_id = $1 ORDER BY game_name",
      [req.user.id]
    );
    const db = {};
    for (const row of result.rows) db[row.game_name] = row.sets;
    res.json(db);
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /db/game/:name — créer ou mettre à jour un jeu
router.post("/game/:name", async (req, res) => {
  const { name } = req.params;
  const { sets } = req.body;
  if (!Array.isArray(sets)) return res.status(400).json({ error: "sets doit être un tableau" });

  try {
    await pool.query(
      `INSERT INTO game_data (user_id, game_name, sets, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, game_name)
       DO UPDATE SET sets = $3, updated_at = NOW()`,
      [req.user.id, name, JSON.stringify(sets)]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /db/game/:name — supprimer un jeu
router.delete("/game/:name", async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM game_data WHERE user_id = $1 AND game_name = $2",
      [req.user.id, req.params.name]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /db/game/rename — renommer un jeu
router.put("/game/rename", async (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName) return res.status(400).json({ error: "oldName et newName requis" });

  try {
    await pool.query(
      "UPDATE game_data SET game_name = $1, updated_at = NOW() WHERE user_id = $2 AND game_name = $3",
      [newName, req.user.id, oldName]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Un jeu avec ce nom existe déjà" });
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
