const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const app = express();
app.set("trust proxy", 1); // behind a host's TLS-terminating proxy (e.g. Render), so req.secure works

const PORT = process.env.PORT || 4100;
// DATA_DIR should point at a persistent disk/volume in production (set via env var);
// defaults to a local folder for development.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "styles.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const SESSION_COOKIE = "owner_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image files are allowed"));
    cb(null, true);
  },
});

app.use(express.json());

// ---- Config (owner password) ----
// OWNER_PASSWORD env var takes priority (set this in production); config.json
// is a convenience fallback for local development only.

function readConfig() {
  if (process.env.OWNER_PASSWORD) return { ownerPassword: process.env.OWNER_PASSWORD };
  if (!fs.existsSync(CONFIG_FILE)) return {};
  const raw = fs.readFileSync(CONFIG_FILE, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

// ---- Owner sessions (in-memory) ----

const sessions = new Map(); // token -> expiry timestamp

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

function isAuthenticated(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireOwnerAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: "Owner login required" });
  }
  next();
}

app.post("/api/owner/login", (req, res) => {
  const { password } = req.body || {};
  const config = readConfig();
  if (!password || password !== config.ownerPassword) {
    return res.status(401).json({ error: "Incorrect password" });
  }
  const token = crypto.randomUUID();
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  const secure = req.secure ? " Secure;" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly;${secure} Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Strict`
  );
  res.json({ ok: true });
});

app.post("/api/owner/logout", (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  const secure = req.secure ? " Secure;" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=;${secure} HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get("/api/owner/session", (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

app.get("/", (req, res) => res.redirect("/production.html"));

app.use(express.static(path.join(__dirname, "public")));

function readStyles() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
  if (!raw) return [];
  return JSON.parse(raw);
}

function writeStyles(styles) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(styles, null, 2), "utf8");
}

// ---- Styles (design + component/costing sheet, created by owner) ----
// Read access is shared: production needs the component list (description,
// UOM, estimated consumption) to know what to log actuals against.
// Only creating/editing a style (design + pricing) is owner-gated.

app.get("/api/styles", (req, res) => {
  const styles = readStyles();
  const summary = styles.map((s) => ({
    id: s.id,
    styleNo: s.styleNo,
    styleName: s.styleName,
    buyer: s.buyer,
    season: s.season,
    orderQty: s.orderQty,
    currency: s.currency,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    componentCount: s.components.length,
    actualsCount: (s.actuals || []).length,
  }));
  res.json(summary);
});

app.get("/api/styles/:id", (req, res) => {
  const styles = readStyles();
  const style = styles.find((s) => s.id === req.params.id);
  if (!style) return res.status(404).json({ error: "Style not found" });
  res.json(style);
});

// Production-facing view of a style: component list without rate/pricing,
// so the production page never receives cost data even via direct API call.
app.get("/api/styles/:id/production-view", (req, res) => {
  const styles = readStyles();
  const style = styles.find((s) => s.id === req.params.id);
  if (!style) return res.status(404).json({ error: "Style not found" });
  res.json({
    id: style.id,
    styleNo: style.styleNo,
    styleName: style.styleName,
    buyer: style.buyer,
    season: style.season,
    orderQty: style.orderQty,
    components: style.components.map((c) => ({
      category: c.category,
      description: c.description,
      uom: c.uom,
      consumption: c.consumption,
    })),
    designImagePath: style.designImagePath || null,
    actuals: style.actuals || [],
  });
});

function parseComponents(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function deleteUploadedFile(designImagePath) {
  if (!designImagePath) return;
  const filePath = path.join(DATA_DIR, designImagePath); // designImagePath is like "/uploads/<file>"
  fs.unlink(filePath, () => {});
}

app.post("/api/styles", requireOwnerAuth, upload.single("designImage"), (req, res) => {
  const body = req.body;
  if (!body.styleNo || !body.styleName) {
    return res.status(400).json({ error: "styleNo and styleName are required" });
  }
  const styles = readStyles();
  const now = new Date().toISOString();
  const style = {
    id: crypto.randomUUID(),
    styleNo: body.styleNo,
    styleName: body.styleName,
    buyer: body.buyer || "",
    season: body.season || "",
    orderQty: Number(body.orderQty) || 0,
    currency: body.currency || "INR",
    components: parseComponents(body.components),
    designImagePath: req.file ? `/uploads/${req.file.filename}` : null,
    actuals: [],
    createdAt: now,
    updatedAt: now,
  };
  styles.push(style);
  writeStyles(styles);
  res.status(201).json(style);
});

app.put("/api/styles/:id", requireOwnerAuth, upload.single("designImage"), (req, res) => {
  const styles = readStyles();
  const idx = styles.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Style not found" });

  const body = req.body;
  const existing = styles[idx];

  let designImagePath = existing.designImagePath || null;
  if (req.file) {
    deleteUploadedFile(existing.designImagePath);
    designImagePath = `/uploads/${req.file.filename}`;
  } else if (body.removeDesignImage === "true") {
    deleteUploadedFile(existing.designImagePath);
    designImagePath = null;
  }

  styles[idx] = {
    ...existing,
    styleNo: body.styleNo ?? existing.styleNo,
    styleName: body.styleName ?? existing.styleName,
    buyer: body.buyer ?? existing.buyer,
    season: body.season ?? existing.season,
    orderQty: body.orderQty !== undefined ? Number(body.orderQty) : existing.orderQty,
    currency: body.currency ?? existing.currency,
    components: body.components !== undefined ? parseComponents(body.components) : existing.components,
    designImagePath,
    updatedAt: new Date().toISOString(),
  };
  writeStyles(styles);
  res.json(styles[idx]);
});

// ---- Actual consumption entries (filled by production team, against a style) ----
// Left open (no owner auth) so the production floor can log entries freely.

app.post("/api/styles/:id/actuals", (req, res) => {
  const styles = readStyles();
  const idx = styles.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Style not found" });

  const body = req.body;
  const entry = {
    id: crypto.randomUUID(),
    filledBy: body.filledBy || "",
    productionDate: body.productionDate || "",
    actualProducedQty: Number(body.actualProducedQty) || 0,
    lines: Array.isArray(body.lines) ? body.lines : [],
    createdAt: new Date().toISOString(),
  };
  styles[idx].actuals = styles[idx].actuals || [];
  styles[idx].actuals.push(entry);
  styles[idx].updatedAt = new Date().toISOString();
  writeStyles(styles);
  res.status(201).json(entry);
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    return res.status(400).json({ error: err.message || "Upload failed" });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Garment costing app running at http://localhost:${PORT}`);
  console.log(`Owner page:      http://localhost:${PORT}/owner.html`);
  console.log(`Production page: http://localhost:${PORT}/production.html`);
});
