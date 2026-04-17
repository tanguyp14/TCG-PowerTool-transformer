const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
const useSSL = connectionString && !connectionString.includes("localhost");

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS game_data (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      game_name VARCHAR(255) NOT NULL,
      sets JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, game_name)
    );
  `);

  // Migration : renommer email → username si l'ancienne colonne existe encore
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='users' AND column_name='email'
      ) THEN
        ALTER TABLE users RENAME COLUMN email TO username;
      END IF;
    END $$;
  `);
}

async function initWithRetry(retries = 10, delayMs = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await initSchema();
      console.log("Database ready");
      return;
    } catch (err) {
      console.log(`DB not ready (attempt ${i}/${retries}): ${err.message}`);
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

module.exports = { pool, initSchema: initWithRetry };
