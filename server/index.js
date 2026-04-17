require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { initSchema } = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/auth", require("./routes/auth"));
app.use("/db", require("./routes/data"));

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;

initSchema()
  .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
  .catch((err) => { console.error("DB init failed:", err); process.exit(1); });
