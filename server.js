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
const APPROVER_SESSION_COOKIE = "approver_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const SIZES = ["40", "42", "44", "46", "48", "50", "52"];
const PART_KEYS = ["kurta", "pant", "dupatta"];
// Fixed line items every part offers, matching the client's own process
// list - the owner fills in rate/consumption for whichever apply and
// leaves the rest at 0, rather than building the row list by hand.
const FIXED_PROCESS_NAMES = [
  "Cutting",
  "Stitching",
  "Finishing",
  "Pin Tucks",
  "Lace",
  "Computer Embroidery Border",
  "Computer Embroidery Yoke",
  "Adda Work",
  "Tussel",
  "MOH + Material",
];

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
  const fileConfig = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8").trim() || "{}") : {};
  return {
    ownerPassword: process.env.OWNER_PASSWORD || fileConfig.ownerPassword,
    approverPassword: process.env.APPROVER_PASSWORD || fileConfig.approverPassword,
  };
}

// ---- Sessions (in-memory) - owner and approver are separate roles/logins ----

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

// Sets up login/logout/session routes plus an auth-requiring middleware for
// one role. Owner and Approver each get their own password, cookie, and
// in-memory session store, so one login has no bearing on the other.
function setupAuthRole({ roleName, cookieName, routePrefix, passwordField }) {
  const sessions = new Map(); // token -> expiry timestamp

  function isAuthenticated(req) {
    const token = parseCookies(req)[cookieName];
    if (!token) return false;
    const expiry = sessions.get(token);
    if (!expiry || expiry < Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  }

  function requireAuth(req, res, next) {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ error: `${roleName} login required` });
    }
    next();
  }

  app.post(`/api/${routePrefix}/login`, (req, res) => {
    const { password } = req.body || {};
    const config = readConfig();
    if (!password || password !== config[passwordField]) {
      return res.status(401).json({ error: "Incorrect password" });
    }
    const token = crypto.randomUUID();
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    const secure = req.secure ? " Secure;" : "";
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=${token}; HttpOnly;${secure} Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Strict`
    );
    res.json({ ok: true });
  });

  app.post(`/api/${routePrefix}/logout`, (req, res) => {
    const token = parseCookies(req)[cookieName];
    if (token) sessions.delete(token);
    const secure = req.secure ? " Secure;" : "";
    res.setHeader("Set-Cookie", `${cookieName}=;${secure} HttpOnly; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get(`/api/${routePrefix}/session`, (req, res) => {
    res.json({ authenticated: isAuthenticated(req) });
  });

  return { isAuthenticated, requireAuth };
}

const ownerAuth = setupAuthRole({ roleName: "Owner", cookieName: SESSION_COOKIE, routePrefix: "owner", passwordField: "ownerPassword" });
const approverAuth = setupAuthRole({
  roleName: "Approver",
  cookieName: APPROVER_SESSION_COOKIE,
  routePrefix: "approver",
  passwordField: "approverPassword",
});

const requireOwnerAuth = ownerAuth.requireAuth;
const requireApproverAuth = approverAuth.requireAuth;

function requireOwnerOrApproverAuth(req, res, next) {
  if (ownerAuth.isAuthenticated(req) || approverAuth.isAuthenticated(req)) return next();
  return res.status(401).json({ error: "Owner or Approver login required" });
}

app.get("/", (req, res) => res.redirect("/production.html"));

app.use(express.static(path.join(__dirname, "public")));

// ---- Data model ----
// Each style has three optional "parts" (kurta / pant / dupatta). Each part
// has its own list of rows, of two types:
//   - "Fabric" rows carry a consumption figure per size (grading).
//   - "Process" rows (Cutting, Stitching, Embroidery, job-work, etc.) carry
//     one flat consumption ("Average") used for every size, plus vendor/
//     bill/received tracking, matching how the client's own sheet works.
// Order quantity is a color x size grid rather than a single number.

function defaultSizeQty() {
  return Object.fromEntries(SIZES.map((s) => [s, 0]));
}

function defaultColor() {
  return { name: "", qty: defaultSizeQty() };
}

// Design approval has a send/review workflow: "Not Sent" -> owner still
// working on it. "Sent for Approval" -> in the approver's queue.
// "Approved"/"Rejected" -> the approver's decision.
const DESIGN_APPROVAL_STATUSES = ["Not Sent", "Sent for Approval", "Approved", "Rejected"];
// Variance approval stays a simple inline sign-off on the owner page.
const VARIANCE_APPROVAL_STATUSES = ["Pending", "Approved", "Rejected"];

function defaultApproval(status) {
  return { status, approverName: "", date: "", remarks: "" };
}

function parseApproval(raw, existing, validStatuses) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== "object") return existing;
  return {
    status: validStatuses.includes(parsed.status) ? parsed.status : existing.status,
    approverName: parsed.approverName ?? existing.approverName,
    date: parsed.date ?? existing.date,
    remarks: parsed.remarks ?? existing.remarks,
  };
}

function defaultFabricRow() {
  return { type: "Fabric", description: "Fabric", uom: "Mtr", rate: 0, sizeConsumption: defaultSizeQty() };
}

function defaultProcessRow(name) {
  return { type: "Process", description: name, uom: "Pcs", rate: 0, consumption: 1, vendor: "", billNo: "", received: false };
}

function defaultFixedComponents() {
  return [defaultFabricRow(), ...FIXED_PROCESS_NAMES.map(defaultProcessRow), defaultProcessRow("Other")];
}

// Reconciles a part's stored components against the fixed line-item list -
// values entered against a matching name carry over; anything that doesn't
// match a fixed name folds into the "Other" slot so nothing is silently lost.
function reconcileFixedComponents(existing) {
  let fabricRow = null;
  const byName = new Map();
  const leftovers = [];
  for (const c of existing) {
    if (c.type === "Fabric") {
      if (!fabricRow) fabricRow = c;
      continue;
    }
    const match = FIXED_PROCESS_NAMES.find((n) => n.toLowerCase() === String(c.description || "").trim().toLowerCase());
    if (match && !byName.has(match)) byName.set(match, c);
    else leftovers.push(c);
  }

  const fabric = fabricRow ? { ...defaultFabricRow(), ...fabricRow, type: "Fabric" } : defaultFabricRow();
  const processRows = FIXED_PROCESS_NAMES.map((name) => {
    const row = byName.get(name);
    return row ? { ...defaultProcessRow(name), ...row, description: name } : defaultProcessRow(name);
  });
  const otherSource = leftovers[0];
  const otherRow = otherSource
    ? { ...defaultProcessRow(otherSource.description || "Other"), ...otherSource }
    : defaultProcessRow("Other");

  return [fabric, ...processRows, otherRow];
}

function defaultPart() {
  return { enabled: false, sellingRate: 0, components: defaultFixedComponents() };
}

function defaultParts() {
  return Object.fromEntries(PART_KEYS.map((k) => [k, defaultPart()]));
}

function styleTotalPcs(style) {
  return (style.colors || []).reduce((sum, c) => sum + SIZES.reduce((s2, sz) => s2 + (Number(c.qty[sz]) || 0), 0), 0);
}

// Upgrades a component to the current Fabric/Process shape without
// discarding any value already entered.
function migrateComponent(c) {
  if (c.type === "Fabric" || c.type === "Process") return c;

  // Pre-parts-rewrite shape used category: "Fabric"/"Trim"/"CM"/"Overhead"/"Other".
  if (c.category === "Fabric") {
    let sizeConsumption;
    if (c.sizeConsumption) {
      // Old size set was 38/40/42/44/Plus; carry a representative flat value
      // across the new 7-size set rather than guess a distribution.
      const values = Object.values(c.sizeConsumption).map(Number).filter((v) => !isNaN(v) && v > 0);
      const v = values[0] || 0;
      sizeConsumption = Object.fromEntries(SIZES.map((s) => [s, v]));
    } else {
      const v = Number(c.consumption) || 0;
      sizeConsumption = Object.fromEntries(SIZES.map((s) => [s, v]));
    }
    return { type: "Fabric", description: c.description || "", uom: c.uom || "Mtr", rate: Number(c.rate) || 0, sizeConsumption };
  }
  return {
    type: "Process",
    description: c.description || "",
    uom: c.uom || "Pcs",
    rate: Number(c.rate) || 0,
    consumption: Number(c.consumption) || 1,
    vendor: c.vendor || "",
    billNo: c.billNo || "",
    received: !!c.received,
  };
}

// Upgrades a style record read from disk to the current shape.
function migrateStyle(style) {
  const isCurrent = Array.isArray(style.colors) && style.parts && style.parts.kurta && "sellingRate" in style.parts.kurta;

  let parts;
  if (style.parts) {
    parts = {};
    for (const key of PART_KEYS) {
      const part = style.parts[key] || defaultPart();
      parts[key] = {
        enabled: !!part.enabled,
        sellingRate: Number(part.sellingRate) || 0,
        components: reconcileFixedComponents((part.components || []).map(migrateComponent)),
      };
    }
  } else {
    parts = defaultParts();
  }

  let colors = style.colors;
  if (!Array.isArray(colors)) {
    // Pre-color-grid styles stored a single flat orderQty number; preserve
    // the total under one placeholder color so nothing is lost, and flag it
    // for the owner to redistribute across actual colors/sizes.
    const legacyQty = Number(style.orderQty) || 0;
    const color = defaultColor();
    if (legacyQty > 0) {
      color.name = "Unspecified (migrated)";
      color.qty[SIZES[0]] = legacyQty;
    }
    colors = legacyQty > 0 ? [color] : [];
  }

  const { orderQty, ...rest } = style;
  return {
    ...rest,
    orderType: style.orderType || "Bulk",
    pocket: style.pocket || "",
    patti: style.patti || "",
    colors,
    parts,
    designApproval: parseApproval(style.designApproval, defaultApproval("Not Sent"), DESIGN_APPROVAL_STATUSES),
    varianceApproval: parseApproval(style.varianceApproval, defaultApproval("Pending"), VARIANCE_APPROVAL_STATUSES),
    sales: Array.isArray(style.sales) ? style.sales : [],
  };
}

// Inventory = produced (from production's actuals) minus sold (from sales),
// broken down by color + size to match how both are already logged.
function computeInventory(style) {
  const key = (color, size) => `${color || ""}|||${size || ""}`;
  const produced = new Map();
  const sold = new Map();

  (style.actuals || []).forEach((entry) => {
    const k = key(entry.color, entry.size);
    produced.set(k, (produced.get(k) || 0) + (Number(entry.actualProducedQty) || 0));
  });
  (style.sales || []).forEach((entry) => {
    const k = key(entry.color, entry.size);
    sold.set(k, (sold.get(k) || 0) + (Number(entry.qtySold) || 0));
  });

  const keys = new Set([...produced.keys(), ...sold.keys()]);
  const bySizeColor = Array.from(keys).map((k) => {
    const [color, size] = k.split("|||");
    const p = produced.get(k) || 0;
    const s = sold.get(k) || 0;
    return { color, size, produced: p, sold: s, balance: p - s };
  });
  bySizeColor.sort((a, b) => a.color.localeCompare(b.color) || SIZES.indexOf(a.size) - SIZES.indexOf(b.size));

  const totals = bySizeColor.reduce(
    (acc, r) => ({ produced: acc.produced + r.produced, sold: acc.sold + r.sold, balance: acc.balance + r.balance }),
    { produced: 0, sold: 0, balance: 0 }
  );

  return { bySizeColor, ...totals };
}

function readStyles() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
  if (!raw) return [];
  return JSON.parse(raw).map(migrateStyle);
}

function writeStyles(styles) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(styles, null, 2), "utf8");
}

function partComponentCount(style) {
  return PART_KEYS.reduce((sum, key) => {
    const part = style.parts[key];
    return sum + (part.enabled ? part.components.length : 0);
  }, 0);
}

// ---- Styles (design + component/costing sheet, created by owner) ----
// Read access is shared: production needs the component list (description,
// UOM, estimated consumption per size) to know what to log actuals against.
// Only creating/editing a style (design + pricing) is owner-gated.

app.get("/api/styles", (req, res) => {
  const styles = readStyles();
  const summary = styles.map((s) => ({
    id: s.id,
    styleNo: s.styleNo,
    styleName: s.styleName,
    buyer: s.buyer,
    season: s.season,
    orderType: s.orderType,
    totalPcs: styleTotalPcs(s),
    currency: s.currency,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    componentCount: partComponentCount(s),
    actualsCount: (s.actuals || []).length,
    designApprovalStatus: s.designApproval.status,
    inventoryBalance: computeInventory(s).balance,
  }));
  res.json(summary);
});

// Full style detail includes pricing (rate/vendor/bill) - owner (editing) or
// approver (reviewing) only, not the open production-view below.
app.get("/api/styles/:id", requireOwnerOrApproverAuth, (req, res) => {
  const styles = readStyles();
  const style = styles.find((s) => s.id === req.params.id);
  if (!style) return res.status(404).json({ error: "Style not found" });
  res.json({ ...style, inventory: computeInventory(style) });
});

// Production-facing view of a style: component list without rate/vendor/bill
// pricing info, so the production page never receives cost data even via a
// direct API call.
app.get("/api/styles/:id/production-view", (req, res) => {
  const styles = readStyles();
  const style = styles.find((s) => s.id === req.params.id);
  if (!style) return res.status(404).json({ error: "Style not found" });

  const parts = {};
  for (const key of PART_KEYS) {
    const part = style.parts[key];
    // Only show line items the owner actually priced (rate > 0) - every
    // part carries all 12 fixed rows internally, but production shouldn't
    // have to fill in "Adda Work" for a style that never used it.
    const components = [];
    part.components.forEach((c, index) => {
      const isActive =
        c.type === "Fabric"
          ? Number(c.rate) > 0 || Object.values(c.sizeConsumption || {}).some((v) => Number(v) > 0)
          : Number(c.rate) > 0;
      if (!isActive) return;
      components.push({
        index,
        type: c.type,
        description: c.description,
        uom: c.uom,
        consumption: c.consumption,
        sizeConsumption: c.sizeConsumption,
        // Vendor/Bill No./Received are job-work tracking, not pricing -
        // safe to expose and let production update, unlike rate.
        vendor: c.type === "Process" ? c.vendor : undefined,
        billNo: c.type === "Process" ? c.billNo : undefined,
        received: c.type === "Process" ? c.received : undefined,
      });
    });
    parts[key] = { enabled: part.enabled, components };
  }

  res.json({
    id: style.id,
    styleNo: style.styleNo,
    styleName: style.styleName,
    buyer: style.buyer,
    season: style.season,
    orderType: style.orderType,
    colors: style.colors,
    parts,
    designImagePath: style.designImagePath || null,
    actuals: style.actuals || [],
    // Status only - approver name/remarks are context for the owner, not
    // something production needs, but the status gates whether they can log.
    designApprovalStatus: style.designApproval.status,
  });
});

// Lets production update job-work tracking (vendor/bill/received) on a
// Process row without touching rate or any other pricing field. No owner
// auth - this is operational status, not costing data.
app.put("/api/styles/:id/parts/:partKey/components/:index/status", (req, res) => {
  const { partKey, index } = req.params;
  if (!PART_KEYS.includes(partKey)) return res.status(400).json({ error: "Invalid part" });

  const styles = readStyles();
  const idx = styles.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Style not found" });

  const component = styles[idx].parts[partKey].components[Number(index)];
  if (!component || component.type !== "Process") {
    return res.status(404).json({ error: "Component not found" });
  }

  const body = req.body;
  if (body.vendor !== undefined) component.vendor = body.vendor;
  if (body.billNo !== undefined) component.billNo = body.billNo;
  if (body.received !== undefined) component.received = !!body.received;

  styles[idx].updatedAt = new Date().toISOString();
  writeStyles(styles);
  res.json({ ok: true });
});

function parseParts(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== "object") return defaultParts();

  const parts = {};
  for (const key of PART_KEYS) {
    const part = parsed[key] || defaultPart();
    const components = Array.isArray(part.components) ? part.components : [];
    parts[key] = {
      enabled: !!part.enabled,
      sellingRate: Number(part.sellingRate) || 0,
      components: reconcileFixedComponents(components.map(migrateComponent)),
    };
  }
  return parts;
}

function parseColors(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((c) => c && String(c.name || "").trim() !== "")
    .map((c) => ({
      name: c.name,
      qty: Object.fromEntries(SIZES.map((s) => [s, Number(c.qty?.[s]) || 0])),
    }));
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
    orderType: body.orderType === "Sample" ? "Sample" : "Bulk",
    pocket: body.pocket || "",
    patti: body.patti || "",
    currency: body.currency || "INR",
    colors: parseColors(body.colors),
    parts: parseParts(body.parts),
    designImagePath: req.file ? `/uploads/${req.file.filename}` : null,
    actuals: [],
    sales: [],
    designApproval: parseApproval(body.designApproval, defaultApproval("Not Sent"), DESIGN_APPROVAL_STATUSES),
    varianceApproval: parseApproval(body.varianceApproval, defaultApproval("Pending"), VARIANCE_APPROVAL_STATUSES),
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
    orderType: body.orderType !== undefined ? (body.orderType === "Sample" ? "Sample" : "Bulk") : existing.orderType,
    pocket: body.pocket ?? existing.pocket,
    patti: body.patti ?? existing.patti,
    currency: body.currency ?? existing.currency,
    colors: body.colors !== undefined ? parseColors(body.colors) : existing.colors,
    parts: body.parts !== undefined ? parseParts(body.parts) : existing.parts,
    designApproval: body.designApproval !== undefined ? parseApproval(body.designApproval, existing.designApproval, DESIGN_APPROVAL_STATUSES) : existing.designApproval,
    varianceApproval: body.varianceApproval !== undefined ? parseApproval(body.varianceApproval, existing.varianceApproval, VARIANCE_APPROVAL_STATUSES) : existing.varianceApproval,
    designImagePath,
    updatedAt: new Date().toISOString(),
  };
  writeStyles(styles);
  res.json(styles[idx]);
});

// Owner submits the current design + costing for approval - saves whatever
// the client already sent as the style's data, then puts it in the
// approver's queue. Any previous decision/remarks are cleared for the new round.
app.post("/api/styles/:id/design-approval/send", requireOwnerAuth, (req, res) => {
  const styles = readStyles();
  const idx = styles.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Style not found" });

  styles[idx].designApproval = { status: "Sent for Approval", approverName: "", date: "", remarks: "" };
  styles[idx].updatedAt = new Date().toISOString();
  writeStyles(styles);
  res.json(styles[idx]);
});

// Approver's decision - can only touch designApproval, never pricing or
// anything else in the style.
app.put("/api/styles/:id/design-approval", requireApproverAuth, (req, res) => {
  const styles = readStyles();
  const idx = styles.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Style not found" });

  const { status, approverName, remarks } = req.body || {};
  if (status !== "Approved" && status !== "Rejected") {
    return res.status(400).json({ error: "status must be Approved or Rejected" });
  }

  styles[idx].designApproval = {
    status,
    approverName: approverName || "",
    date: new Date().toISOString().slice(0, 10),
    remarks: remarks || "",
  };
  styles[idx].updatedAt = new Date().toISOString();
  writeStyles(styles);
  res.json(styles[idx]);
});

// ---- Actual consumption entries (filled by production team, against a style) ----
// Left open (no owner auth) so the production floor can log entries freely.

app.post("/api/styles/:id/actuals", (req, res) => {
  const styles = readStyles();
  const idx = styles.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Style not found" });

  if (styles[idx].designApproval.status !== "Approved") {
    return res.status(403).json({ error: "Design has not been approved yet - production cannot log actuals until the owner approves the design." });
  }

  const body = req.body;
  const entry = {
    id: crypto.randomUUID(),
    color: body.color || "",
    size: SIZES.includes(body.size) ? body.size : SIZES[0],
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

// ---- Sales (inventory dashboard) ----
// Owner-only: recording a sale reduces the available balance for that
// color+size, alongside whatever production has logged as produced.

app.post("/api/styles/:id/sales", requireOwnerAuth, (req, res) => {
  const styles = readStyles();
  const idx = styles.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Style not found" });

  const body = req.body;
  if (body.color === undefined || !SIZES.includes(body.size) || !(Number(body.qtySold) > 0)) {
    return res.status(400).json({ error: "color, size, and a positive qtySold are required" });
  }

  const entry = {
    id: crypto.randomUUID(),
    color: body.color,
    size: body.size,
    qtySold: Number(body.qtySold),
    date: body.date || new Date().toISOString().slice(0, 10),
    buyer: body.buyer || "",
    reference: body.reference || "",
    createdAt: new Date().toISOString(),
  };
  styles[idx].sales = styles[idx].sales || [];
  styles[idx].sales.push(entry);
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
