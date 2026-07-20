const SIZES = ["38", "40", "42", "44", "Plus"];
const PART_KEYS = ["kurta", "pant", "dupatta"];
const PART_LABELS = { kurta: "Kurta", pant: "Pant", dupatta: "Dupatta" };
const CATEGORIES = ["Fabric", "Trim", "CM", "Overhead", "Other"];

let currentStyleId = null; // null = creating a new style
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

function defaultSizeConsumption() {
  return Object.fromEntries(SIZES.map((s) => [s, 0]));
}

function defaultPart() {
  return { enabled: false, components: [] };
}

function defaultParts() {
  return Object.fromEntries(PART_KEYS.map((k) => [k, defaultPart()]));
}

function newComponentRow(category = "Fabric") {
  if (category === "Fabric") {
    return { category, description: "", uom: "Mtr", rate: 0, wastagePct: 0, sizeConsumption: defaultSizeConsumption() };
  }
  return { category, description: "", uom: "Pcs", rate: 0, wastagePct: 0, consumption: 0 };
}

function costOfRow(row, size) {
  const rate = Number(row.rate) || 0;
  const waste = Number(row.wastagePct) || 0;
  const cons = row.category === "Fabric" ? Number(row.sizeConsumption?.[size]) || 0 : Number(row.consumption) || 0;
  return cons * rate * (1 + waste / 100);
}

function partSubtotal(partKey, size) {
  const part = parts[partKey];
  if (!part.enabled) return 0;
  return part.components.reduce((sum, r) => sum + costOfRow(r, size), 0);
}

function grandTotal(size) {
  return PART_KEYS.reduce((sum, k) => sum + partSubtotal(k, size), 0);
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
    <table class="comp-table">
      <thead>
        <tr>
          <th style="width:100px;">Category</th>
          <th>Component / Material Description</th>
          <th style="width:70px;">UOM</th>
          <th style="width:90px;">Rate/Unit</th>
          <th style="width:80px;">Wastage %</th>
          <th style="width:300px;">Consumption per Garment (by size)</th>
          <th style="width:36px;"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <button class="btn-secondary" type="button" data-action="add-row" data-part="${partKey}">+ Add Component</button>
  `;
}

function renderComponentRow(partKey, row, idx) {
  const consumptionCell =
    row.category === "Fabric"
      ? `<div class="size-inputs">${SIZES.map(
          (sz) => `
            <div class="size-input-group">
              <span>${sz}</span>
              <input data-part="${partKey}" data-idx="${idx}" data-field="sizeConsumption" data-size="${sz}" type="number" step="0.01" min="0" value="${row.sizeConsumption[sz]}" />
            </div>`
        ).join("")}</div>`
      : `<input data-part="${partKey}" data-idx="${idx}" data-field="consumption" type="number" step="0.01" min="0" value="${row.consumption}" style="max-width:110px;" />`;

  return `
    <tr>
      <td>
        <select data-part="${partKey}" data-idx="${idx}" data-field="category">
          ${CATEGORIES.map((c) => `<option value="${c}" ${c === row.category ? "selected" : ""}>${c}</option>`).join("")}
        </select>
      </td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="description" value="${escapeAttr(row.description)}" placeholder="e.g. Self Fabric - Rayon" /></td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="uom" value="${escapeAttr(row.uom)}" placeholder="Mtr/Pcs" /></td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="rate" type="number" step="0.01" min="0" value="${row.rate}" /></td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="wastagePct" type="number" step="0.1" min="0" value="${row.wastagePct}" /></td>
      <td>${consumptionCell}</td>
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
      SIZES.map((s) => `<td class="cost-cell">${partSubtotal(key, s).toFixed(2)}</td>`).join("") +
      `</tr>`;
  });
  rows +=
    `<tr style="font-weight:bold; border-top:2px solid var(--navy);"><td style="text-align:left;">Total Cost / Garment</td>` +
    SIZES.map((s) => `<td class="cost-cell">${currency} ${grandTotal(s).toFixed(2)}</td>`).join("") +
    `</tr>`;
  el("costSummaryBody").innerHTML = rows;

  const qty = Number(el("orderQty").value) || 0;
  el("sumOrderQty").textContent = qty ? qty.toLocaleString() : "-";
}

// Event delegation: one set of listeners handles every part's table, since
// tables are re-created whenever a part is toggled or a row added/removed.

el("partsContainer").addEventListener("input", (e) => {
  const t = e.target;
  const field = t.dataset.field;
  if (!field || field === "category") return;
  const row = parts[t.dataset.part].components[Number(t.dataset.idx)];
  if (field === "sizeConsumption") {
    row.sizeConsumption[t.dataset.size] = Number(t.value) || 0;
  } else if (["rate", "wastagePct", "consumption"].includes(field)) {
    row[field] = Number(t.value) || 0;
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
  if (t.dataset.field === "category") {
    const row = parts[t.dataset.part].components[Number(t.dataset.idx)];
    const newCategory = t.value;
    if (newCategory === "Fabric" && row.category !== "Fabric") {
      const flat = Number(row.consumption) || 0;
      delete row.consumption;
      row.sizeConsumption = Object.fromEntries(SIZES.map((s) => [s, flat]));
    } else if (newCategory !== "Fabric" && row.category === "Fabric") {
      const flat = Number(row.sizeConsumption?.["38"]) || 0;
      delete row.sizeConsumption;
      row.consumption = flat;
    }
    row.category = newCategory;
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

el("orderQty").addEventListener("input", renderCostSummary);
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
        <div class="smeta">${escapeAttr(s.buyer || "-")} · MOQ ${s.orderQty} · ${s.componentCount} components · ${s.actualsCount} production entries</div>
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
  el("orderQty").value = s.orderQty;
  el("currency").value = s.currency;
  parts = s.parts;
  el("formTitle").textContent = `Editing: ${s.styleNo} - ${s.styleName}`;
  el("statusText").textContent = `Created ${new Date(s.createdAt).toLocaleString()} · Last updated ${new Date(s.updatedAt).toLocaleString()}`;
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
  el("orderQty").value = "";
  el("currency").value = "INR";
  parts = defaultParts();
  el("formTitle").textContent = "New Style - Design & Component Sheet";
  el("statusText").textContent = "";
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
      components: parts[key].components.filter((c) => c.description.trim() !== ""),
    };
  }

  const formData = new FormData();
  formData.append("styleNo", styleNo);
  formData.append("styleName", styleName);
  formData.append("buyer", el("buyer").value.trim());
  formData.append("season", el("season").value.trim());
  formData.append("orderQty", Number(el("orderQty").value) || 0);
  formData.append("currency", el("currency").value.trim() || "INR");
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
