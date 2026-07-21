const SIZES = ["40", "42", "44", "46", "48", "50", "52"];
const PART_KEYS = ["kurta", "pant", "dupatta"];
const PART_LABELS = { kurta: "Kurta", pant: "Pant", dupatta: "Dupatta" };
const PROCESS_TYPES = [
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
  "Other",
];

let currentStyleId = null; // null = creating a new style
let colors = [];
let parts = defaultParts();
let existingDesignImagePath = null; // design image already saved on the server, if any
let removeImageRequested = false;

const el = (id) => document.getElementById(id);

function toast(msg, isError) {
  const t = el("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => (t.className = "toast"), 2500);
}

function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

function defaultSizeQty() {
  return Object.fromEntries(SIZES.map((s) => [s, 0]));
}

function defaultColor() {
  return { name: "", qty: defaultSizeQty() };
}

function defaultPart() {
  return { enabled: false, sellingRate: 0, components: [] };
}

function defaultParts() {
  return Object.fromEntries(PART_KEYS.map((k) => [k, defaultPart()]));
}

function newComponentRow(type = "Fabric") {
  if (type === "Fabric") {
    return { type, description: "", uom: "Mtr", rate: 0, sizeConsumption: defaultSizeQty() };
  }
  return { type, description: "", uom: "Pcs", rate: 0, consumption: 1, vendor: "", billNo: "", received: false };
}

function costOfRow(row) {
  const rate = Number(row.rate) || 0;
  if (row.type === "Fabric") return null; // varies by size, handled separately
  return (Number(row.consumption) || 0) * rate;
}

function costOfRowAtSize(row, size) {
  const rate = Number(row.rate) || 0;
  const cons = row.type === "Fabric" ? Number(row.sizeConsumption?.[size]) || 0 : Number(row.consumption) || 0;
  return cons * rate;
}

function partCostAtSize(partKey, size) {
  const part = parts[partKey];
  if (!part.enabled) return 0;
  return part.components.reduce((sum, r) => sum + costOfRowAtSize(r, size), 0);
}

function grandCostAtSize(size) {
  return PART_KEYS.reduce((sum, k) => sum + partCostAtSize(k, size), 0);
}

function totalSellingRate() {
  return PART_KEYS.reduce((sum, k) => sum + (parts[k].enabled ? Number(parts[k].sellingRate) || 0 : 0), 0);
}

// ---- Order Quantity by Color & Size ----

function renderColorSizeTable() {
  el("colorSizeHead").innerHTML =
    `<th style="text-align:left;">Color</th>` + SIZES.map((s) => `<th>${s}</th>`).join("") + `<th>Total</th><th></th>`;

  el("colorSizeBody").innerHTML = colors
    .map((c, idx) => {
      const sizeCells = SIZES.map(
        (s) => `<td><input data-idx="${idx}" data-size="${s}" type="number" min="0" step="1" value="${c.qty[s]}" style="max-width:70px;" /></td>`
      ).join("");
      const rowTotal = SIZES.reduce((sum, s) => sum + (Number(c.qty[s]) || 0), 0);
      return `
        <tr>
          <td><input data-idx="${idx}" data-field="name" value="${escapeAttr(c.name)}" placeholder="e.g. Blue" style="max-width:120px;" /></td>
          ${sizeCells}
          <td class="cost-cell" data-row-total="${idx}">${rowTotal}</td>
          <td><button class="btn-small" type="button" data-action="remove-color" data-idx="${idx}">✕</button></td>
        </tr>
      `;
    })
    .join("");

  const sizeTotals = SIZES.map((s) => colors.reduce((sum, c) => sum + (Number(c.qty[s]) || 0), 0));
  const grandTotal = sizeTotals.reduce((a, b) => a + b, 0);
  el("colorSizeFoot").innerHTML =
    `<td style="text-align:left; font-weight:bold;">Total</td>` +
    sizeTotals.map((t) => `<td class="cost-cell">${t}</td>`).join("") +
    `<td class="cost-cell" id="colorSizeGrandTotal">${grandTotal}</td><td></td>`;

  renderCostSummary();
}

el("colorSizeBody").addEventListener("input", (e) => {
  const t = e.target;
  const idx = Number(t.dataset.idx);
  if (t.dataset.field === "name") {
    colors[idx].name = t.value;
    return;
  }
  if (t.dataset.size) {
    colors[idx].qty[t.dataset.size] = Number(t.value) || 0;
    const rowTotal = SIZES.reduce((sum, s) => sum + (Number(colors[idx].qty[s]) || 0), 0);
    const cell = document.querySelector(`[data-row-total="${idx}"]`);
    if (cell) cell.textContent = rowTotal;
    const sizeTotals = SIZES.map((s) => colors.reduce((sum, c) => sum + (Number(c.qty[s]) || 0), 0));
    document.querySelectorAll("#colorSizeFoot td.cost-cell").forEach((cell, i) => {
      if (i < sizeTotals.length) cell.textContent = sizeTotals[i];
    });
    const grandTotal = sizeTotals.reduce((a, b) => a + b, 0);
    el("colorSizeGrandTotal").textContent = grandTotal;
    renderCostSummary();
  }
});

el("colorSizeBody").addEventListener("click", (e) => {
  const btn = e.target.closest('button[data-action="remove-color"]');
  if (!btn) return;
  colors.splice(Number(btn.dataset.idx), 1);
  renderColorSizeTable();
});

el("addColorBtn").addEventListener("click", () => {
  colors.push(defaultColor());
  renderColorSizeTable();
});

function totalPcs() {
  return colors.reduce((sum, c) => sum + SIZES.reduce((s2, sz) => s2 + (Number(c.qty[sz]) || 0), 0), 0);
}

// ---- Rendering: parts & components ----

function renderParts() {
  const container = el("partsContainer");
  container.innerHTML = PART_KEYS.map((key) => {
    const part = parts[key];
    return `
      <div class="part-block">
        <div class="part-header">
          <label><input type="checkbox" data-action="toggle-part" data-part="${key}" ${part.enabled ? "checked" : ""}/> Include ${PART_LABELS[key]}</label>
          ${part.enabled ? `<span style="font-size:12px; color:var(--muted);">Selling Rate/Garment
            <input data-action="selling-rate" data-part="${key}" type="number" step="0.01" min="0" value="${part.sellingRate}" style="width:90px; margin-left:6px;" />
          </span>` : ""}
        </div>
        ${part.enabled ? renderPartTable(key) : ""}
      </div>
    `;
  }).join("");
  renderCostSummary();
}

function renderPartTable(partKey) {
  const rows = parts[partKey].components.map((row, idx) => renderComponentRow(partKey, row, idx)).join("");
  return `
    <div class="table-scroll">
      <table class="comp-table">
        <thead>
          <tr>
            <th style="width:90px;">Type</th>
            <th style="min-width:160px;">Description</th>
            <th style="width:70px;">UOM</th>
            <th style="width:80px;">Rate</th>
            <th style="width:280px;">Consumption (Average)</th>
            <th style="width:120px;">Vendor</th>
            <th style="width:100px;">Bill No.</th>
            <th style="width:70px;">Received</th>
            <th style="width:36px;"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <button class="btn-secondary" type="button" data-action="add-row" data-part="${partKey}">+ Add Row</button>
  `;
}

function renderComponentRow(partKey, row, idx) {
  const isFabric = row.type === "Fabric";
  const consumptionCell = isFabric
    ? `<div class="size-inputs">${SIZES.map(
        (sz) => `
          <div class="size-input-group">
            <span>${sz}</span>
            <input data-part="${partKey}" data-idx="${idx}" data-field="sizeConsumption" data-size="${sz}" type="number" step="0.01" min="0" value="${row.sizeConsumption[sz]}" />
          </div>`
      ).join("")}</div>`
    : `<input data-part="${partKey}" data-idx="${idx}" data-field="consumption" type="number" step="0.01" min="0" value="${row.consumption}" style="max-width:90px;" />`;

  const vendorCell = isFabric
    ? `<span style="color:var(--muted); font-size:12px;">-</span>`
    : `<input data-part="${partKey}" data-idx="${idx}" data-field="vendor" value="${escapeAttr(row.vendor)}" placeholder="Vendor" style="max-width:110px;" />`;
  const billCell = isFabric
    ? `<span style="color:var(--muted); font-size:12px;">-</span>`
    : `<input data-part="${partKey}" data-idx="${idx}" data-field="billNo" value="${escapeAttr(row.billNo)}" placeholder="Bill No." style="max-width:100px;" />`;
  const receivedCell = isFabric
    ? `<span style="color:var(--muted); font-size:12px;">-</span>`
    : `<input data-part="${partKey}" data-idx="${idx}" data-field="received" type="checkbox" ${row.received ? "checked" : ""} />`;

  const knownProcess = PROCESS_TYPES.includes(row.description) ? row.description : "Other";
  const descriptionCell = isFabric
    ? `<input data-part="${partKey}" data-idx="${idx}" data-field="description" value="${escapeAttr(row.description)}" placeholder="e.g. Self Fabric - Rayon" />`
    : `
      <select data-part="${partKey}" data-idx="${idx}" data-field="processName">
        ${PROCESS_TYPES.map((p) => `<option value="${p}" ${p === knownProcess ? "selected" : ""}>${p}</option>`).join("")}
      </select>
      ${knownProcess === "Other" ? `<input data-part="${partKey}" data-idx="${idx}" data-field="description" value="${escapeAttr(row.description)}" placeholder="Specify process" style="margin-top:4px;" />` : ""}
    `;

  return `
    <tr>
      <td>
        <select data-part="${partKey}" data-idx="${idx}" data-field="type">
          <option value="Fabric" ${isFabric ? "selected" : ""}>Fabric</option>
          <option value="Process" ${!isFabric ? "selected" : ""}>Process</option>
        </select>
      </td>
      <td>${descriptionCell}</td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="uom" value="${escapeAttr(row.uom)}" placeholder="Mtr/Pcs" /></td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="rate" type="number" step="0.01" min="0" value="${row.rate}" /></td>
      <td>${consumptionCell}</td>
      <td>${vendorCell}</td>
      <td>${billCell}</td>
      <td style="text-align:center;">${receivedCell}</td>
      <td><button class="btn-small" type="button" data-action="remove" data-part="${partKey}" data-idx="${idx}">✕</button></td>
    </tr>
  `;
}

function renderCostSummary() {
  const head = el("costSummaryHead");
  head.innerHTML = `<th style="text-align:left;">Part</th>` + SIZES.map((s) => `<th>${s}</th>`).join("");

  const currency = el("currency").value || "";
  let rows = "";
  PART_KEYS.forEach((key) => {
    if (!parts[key].enabled) return;
    rows +=
      `<tr><td style="text-align:left;">${PART_LABELS[key]}</td>` +
      SIZES.map((s) => `<td class="cost-cell">${partCostAtSize(key, s).toFixed(2)}</td>`).join("") +
      `</tr>`;
  });
  rows +=
    `<tr style="font-weight:bold; border-top:2px solid var(--navy);"><td style="text-align:left;">Total Cost / Garment</td>` +
    SIZES.map((s) => `<td class="cost-cell">${currency} ${grandCostAtSize(s).toFixed(2)}</td>`).join("") +
    `</tr>`;
  const selling = totalSellingRate();
  rows +=
    `<tr><td style="text-align:left;">Selling Rate / Garment</td>` +
    SIZES.map(() => `<td class="cost-cell">${currency} ${selling.toFixed(2)}</td>`).join("") +
    `</tr>`;
  rows +=
    `<tr><td style="text-align:left;">Margin / Garment</td>` +
    SIZES.map((s) => `<td class="cost-cell">${currency} ${(selling - grandCostAtSize(s)).toFixed(2)}</td>`).join("") +
    `</tr>`;
  el("costSummaryBody").innerHTML = rows;

  const qty = totalPcs();
  el("sumOrderQty").textContent = qty ? qty.toLocaleString() : "-";

  // Size-weighted totals across the whole order (cost/value vary by size, qty varies by color+size)
  const sizeTotals = Object.fromEntries(SIZES.map((s) => [s, colors.reduce((sum, c) => sum + (Number(c.qty[s]) || 0), 0)]));
  const totalCostValue = SIZES.reduce((sum, s) => sum + grandCostAtSize(s) * sizeTotals[s], 0);
  const totalSellingValue = selling * qty;
  el("sumCostValue").textContent = qty ? `${currency} ${totalCostValue.toFixed(2)}` : "-";
  el("sumSellingValue").textContent = qty ? `${currency} ${totalSellingValue.toFixed(2)}` : "-";
  el("sumMargin").textContent = qty ? `${currency} ${(totalSellingValue - totalCostValue).toFixed(2)}` : "-";
}

// Event delegation: one set of listeners handles every part's table, since
// tables are re-created whenever a part is toggled or a row added/removed.

el("partsContainer").addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.action === "selling-rate") {
    parts[t.dataset.part].sellingRate = Number(t.value) || 0;
    renderCostSummary();
    return;
  }
  const field = t.dataset.field;
  if (!field || field === "type" || field === "processName") return;
  const row = parts[t.dataset.part].components[Number(t.dataset.idx)];
  if (field === "sizeConsumption") {
    row.sizeConsumption[t.dataset.size] = Number(t.value) || 0;
  } else if (field === "consumption" || field === "rate") {
    row[field] = Number(t.value) || 0;
  } else if (field === "received") {
    row.received = t.checked;
  } else {
    row[field] = t.value;
  }
  renderCostSummary();
});

el("partsContainer").addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.action === "toggle-part") {
    const key = t.dataset.part;
    parts[key].enabled = t.checked;
    if (parts[key].enabled && parts[key].components.length === 0) {
      parts[key].components.push(newComponentRow());
    }
    renderParts();
    return;
  }
  if (t.dataset.field === "type") {
    const row = parts[t.dataset.part].components[Number(t.dataset.idx)];
    const newType = t.value;
    if (newType === row.type) return;
    const replacement = newComponentRow(newType);
    replacement.description = row.description;
    replacement.uom = row.uom;
    replacement.rate = row.rate;
    parts[t.dataset.part].components[Number(t.dataset.idx)] = replacement;
    renderParts();
    return;
  }
  if (t.dataset.field === "processName") {
    const row = parts[t.dataset.part].components[Number(t.dataset.idx)];
    row.description = t.value === "Other" ? "" : t.value;
    renderParts();
  }
});

el("partsContainer").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const partKey = btn.dataset.part;
  if (btn.dataset.action === "add-row") {
    parts[partKey].components.push(newComponentRow());
    renderParts();
  } else if (btn.dataset.action === "remove") {
    parts[partKey].components.splice(Number(btn.dataset.idx), 1);
    renderParts();
  }
});

el("currency").addEventListener("input", renderCostSummary);

// ---- Style list & load/save ----

async function loadStyleList(selectId) {
  const res = await fetch("/api/styles");
  const styles = await res.json();
  const list = el("styleList");
  list.innerHTML = "";
  if (styles.length === 0) {
    list.innerHTML = '<li class="empty-state" style="cursor:default;">No styles yet. Click "New Style" to create one.</li>';
    return;
  }
  styles
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .forEach((s) => {
      const li = document.createElement("li");
      li.className = s.id === selectId ? "active" : "";
      li.innerHTML = `
        <div class="sname">${escapeAttr(s.styleNo)} - ${escapeAttr(s.styleName)}</div>
        <div class="smeta">${escapeAttr(s.buyer || "-")} · ${escapeAttr(s.orderType)} · ${s.totalPcs} pcs · ${s.componentCount} rows · ${s.actualsCount} production entries</div>
      `;
      li.addEventListener("click", () => openStyle(s.id));
      list.appendChild(li);
    });
}

async function openStyle(id) {
  const res = await fetch(`/api/styles/${id}`);
  if (!res.ok) return toast("Could not load style", true);
  const s = await res.json();
  currentStyleId = s.id;
  el("styleNo").value = s.styleNo;
  el("styleName").value = s.styleName;
  el("buyer").value = s.buyer;
  el("season").value = s.season;
  el("currency").value = s.currency;
  el("orderType").value = s.orderType || "Bulk";
  el("pocket").value = s.pocket || "";
  el("patti").value = s.patti || "";
  colors = s.colors && s.colors.length ? s.colors : [];
  parts = s.parts;
  el("formTitle").textContent = `Editing: ${s.styleNo} - ${s.styleName}`;
  el("statusText").textContent = `Created ${new Date(s.createdAt).toLocaleString()} · Last updated ${new Date(s.updatedAt).toLocaleString()}`;
  renderColorSizeTable();
  renderParts();
  resetDesignImageInput(s.designImagePath || null);
  loadStyleList(id);
}

function resetForm() {
  currentStyleId = null;
  el("styleNo").value = "";
  el("styleName").value = "";
  el("buyer").value = "";
  el("season").value = "";
  el("currency").value = "INR";
  el("orderType").value = "Bulk";
  el("pocket").value = "";
  el("patti").value = "";
  colors = [];
  parts = defaultParts();
  el("formTitle").textContent = "New Style - Design & Component Sheet";
  el("statusText").textContent = "";
  renderColorSizeTable();
  renderParts();
  resetDesignImageInput(null);
  loadStyleList(null);
}

function resetDesignImageInput(path) {
  existingDesignImagePath = path;
  removeImageRequested = false;
  el("designImageInput").value = "";
  updateDesignPreview(path);
}

function updateDesignPreview(src) {
  const img = el("designPreview");
  const empty = el("designPreviewEmpty");
  const removeBtn = el("removeImageBtn");
  if (src) {
    img.src = src;
    img.style.display = "block";
    empty.style.display = "none";
    removeBtn.style.display = "inline-block";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
    empty.style.display = "block";
    removeBtn.style.display = "none";
  }
}

async function saveStyle() {
  const styleNo = el("styleNo").value.trim();
  const styleName = el("styleName").value.trim();
  if (!styleNo || !styleName) {
    toast("Style No. and Style Name are required", true);
    return;
  }

  const partsToSave = {};
  for (const key of PART_KEYS) {
    partsToSave[key] = {
      enabled: parts[key].enabled,
      sellingRate: parts[key].sellingRate,
      components: parts[key].components.filter((c) => c.description.trim() !== ""),
    };
  }
  const colorsToSave = colors.filter((c) => c.name.trim() !== "");

  const formData = new FormData();
  formData.append("styleNo", styleNo);
  formData.append("styleName", styleName);
  formData.append("buyer", el("buyer").value.trim());
  formData.append("season", el("season").value.trim());
  formData.append("currency", el("currency").value.trim() || "INR");
  formData.append("orderType", el("orderType").value);
  formData.append("pocket", el("pocket").value.trim());
  formData.append("patti", el("patti").value.trim());
  formData.append("colors", JSON.stringify(colorsToSave));
  formData.append("parts", JSON.stringify(partsToSave));

  const fileInput = el("designImageInput");
  if (fileInput.files[0]) {
    formData.append("designImage", fileInput.files[0]);
  } else if (removeImageRequested) {
    formData.append("removeDesignImage", "true");
  }

  const url = currentStyleId ? `/api/styles/${currentStyleId}` : "/api/styles";
  const method = currentStyleId ? "PUT" : "POST";
  const res = await fetch(url, { method, body: formData });
  if (res.status === 401) {
    showLogin("Your session expired. Please log in again.");
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast(err.error || "Save failed", true);
    return;
  }
  const saved = await res.json();
  currentStyleId = saved.id;
  toast("Component sheet saved");
  openStyle(saved.id);
}

el("newStyleBtn").addEventListener("click", resetForm);
el("saveBtn").addEventListener("click", saveStyle);

el("designImageInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  removeImageRequested = false;
  updateDesignPreview(URL.createObjectURL(file));
});

el("removeImageBtn").addEventListener("click", () => {
  el("designImageInput").value = "";
  removeImageRequested = true;
  updateDesignPreview(null);
});

// ---- Owner login gate ----

function showApp() {
  el("loginOverlay").style.display = "none";
  el("appMain").style.display = "";
  el("logoutLink").style.display = "inline-block";
}

function showLogin(message) {
  el("loginOverlay").style.display = "flex";
  el("appMain").style.display = "none";
  el("logoutLink").style.display = "none";
  el("loginError").textContent = message || "";
}

async function checkAuthAndInit() {
  const res = await fetch("/api/owner/session");
  const data = await res.json();
  if (data.authenticated) {
    showApp();
    resetForm();
    loadStyleList(null);
  } else {
    showLogin();
  }
}

el("loginBtn").addEventListener("click", async () => {
  const password = el("loginPassword").value;
  const res = await fetch("/api/owner/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.ok) {
    el("loginPassword").value = "";
    showApp();
    resetForm();
    loadStyleList(null);
  } else {
    el("loginError").textContent = "Incorrect password";
  }
});

el("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") el("loginBtn").click();
});

el("logoutLink").addEventListener("click", async (e) => {
  e.preventDefault();
  await fetch("/api/owner/logout", { method: "POST" });
  showLogin();
});

checkAuthAndInit();
