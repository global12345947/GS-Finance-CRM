const { Router } = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../db.cjs");
const router = Router();

const FILES_DIR = path.join(__dirname, "..", "..", "crm-data", "files");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.body.entityType || "other";
    const dir = path.join(FILES_DIR, type);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const id = uuidv4();
    const entityType = req.body.entityType || "other";
    const entityId = req.body.entityId ? parseInt(req.body.entityId) : null;
    const storedPath = path.relative(FILES_DIR, req.file.path).replace(/\\/g, "/");
    const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");

    await pool.query(
      `INSERT INTO files (id, entity_type, entity_id, original_name, stored_path, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, entityType, entityId, originalName, storedPath, req.file.mimetype]
    );

    res.json({
      id,
      url: `/api/files/${id}`,
      originalName,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM files WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "File not found" });
    const file = rows[0];
    const filePath = path.join(FILES_DIR, file.stored_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing on disk" });
    const safeName = file.original_name.replace(/[^\x20-\x7E]/g, "_");
    res.setHeader("Content-Disposition",
      `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
    res.setHeader("Content-Type", file.mime_type || "application/octet-stream");
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
