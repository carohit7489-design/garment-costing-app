const CATEGORIES = ["A", "B"];
const CATEGORY_LABELS = { A: "Category A", B: "Category B" };
const PART_KEYS = ["kurta", "pant", "dupatta"];
const PART_LABELS = { kurta: "Kurta", pant: "Pant", dupatta: "Dupatta" };
// Fixed line items every part offers (matching the client's own process
// list). Row order is always Fabric, then each name below, then Other -
// the owner fills in rate/consumption for whichever apply and leaves the
// rest at 0, rather than adding rows by hand.
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

let currentStyleId = null; // null = creating a new style
let colors = [];
let parts = defaultParts();
let existingDesignImagePath = null; // design image already saved on the server, if any
let removeImageRequested = false;
let styleActuals = []; // production entries for the currently loaded style, for variance analysis
let designApproval = defaultApproval("Not Sent"); // read-only display; only changes via Send for Approval / the approver's decision
// Buyer/Season/Currency/Order Type have no input on the Style Info section
// anymore, but existing styles still carry them (shown elsewhere in the app)
// - carried through untouched on save instead of being editable here.
let currentBuyer = "";
let currentSeason = "";
let currentCurrency = "INR";
let currentOrderType = "Bulk";

function defaultApproval(status) {
  return { status, approverName: "", date: "", remarks: "" };
}

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

function defaultCatQty() {
  return { A: 0, B: 0 };
}

function defaultColor() {
  return { name: "", qty: defaultCatQty() };
}

function defaultFabricRow() {
  return {
    type: "Fabric",
    description: "Fabric",
    uom: "Mtr",
    estimatedRate: 0,
    actualRate: 0,
    consumption: 0,
    fabricNo: "",
    fabricUsed: 0,
    fabricRemaining: 0,
    fabricImagePath: null,
  };
}

function defaultCustomRow(type) {
  return type === "Fabric"
    ? { type: "Fabric", description: "", uom: "Mtr", estimatedRate: 0, actualRate: 0, consumption: 0, fabricNo: "", fabricUsed: 0, fabricRemaining: 0, custom: true }
    : { type: "Process", description: "", uom: "Pcs", estimatedRate: 0, actualRate: 0, consumption: 0, vendor: "", billNo: "", received: false, billedQty: 0, custom: true };
}

function defaultProcessRow(name) {
  return { type: "Process", description: name, uom: "Pcs", estimatedRate: 0, actualRate: 0, consumption: 1, vendor: "", billNo: "", received: false, billedQty: 0 };
}

function defaultFixedComponents() {
  return [defaultFabricRow(), ...FIXED_PROCESS_NAMES.map(defaultProcessRow), defaultProcessRow("Other")];
}

function defaultPart() {
  return { enabled: false, sellingRate: 0, components: defaultFixedComponents() };
}

function defaultParts() {
  return Object.fromEntries(PART_KEYS.map((k) => [k, defaultPart()]));
}

function costOfRow(row, rateField) {
  return (Number(row.consumption) || 0) * (Number(row[rateField]) || 0);
}

function partCost(partKey, rateField) {
  const part = parts[partKey];
  if (!part.enabled) return 0;
  return part.components.reduce((sum, r) => sum + costOfRow(r, rateField), 0);
}

function grandCost(rateField) {
  return PART_KEYS.reduce((sum, k) => sum + partCost(k, rateField), 0);
}

function totalSellingRate() {
  return PART_KEYS.reduce((sum, k) => sum + (parts[k].enabled ? Number(parts[k].sellingRate) || 0 : 0), 0);
}

// ---- Order Quantity by Color & Category ----

function renderColorSizeTable() {
  el("colorSizeHead").innerHTML =
    `<th style="text-align:left;">Color</th>` + CATEGORIES.map((c) => `<th>${CATEGORY_LABELS[c]}</th>`).join("") + `<th>Total</th><th></th>`;

  el("colorSizeBody").innerHTML = colors
    .map((c, idx) => {
      const catCells = CATEGORIES.map(
        (cat) => `<td><input data-idx="${idx}" data-cat="${cat}" type="number" min="0" step="1" value="${c.qty[cat]}" style="max-width:70px;" /></td>`
      ).join("");
      const rowTotal = CATEGORIES.reduce((sum, cat) => sum + (Number(c.qty[cat]) || 0), 0);
      return `
        <tr>
          <td><input data-idx="${idx}" data-field="name" value="${escapeAttr(c.name)}" placeholder="e.g. Blue" style="max-width:120px;" /></td>
          ${catCells}
          <td class="cost-cell" data-row-total="${idx}">${rowTotal}</td>
          <td><button class="btn-small" type="button" data-action="remove-color" data-idx="${idx}">✕</button></td>
        </tr>
      `;
    })
    .join("");

  const catTotals = CATEGORIES.map((cat) => colors.reduce((sum, c) => sum + (Number(c.qty[cat]) || 0), 0));
  const grandTotal = catTotals.reduce((a, b) => a + b, 0);
  el("colorSizeFoot").innerHTML =
    `<td style="text-align:left; font-weight:bold;">Total</td>` +
    catTotals.map((t) => `<td class="cost-cell">${t}</td>`).join("") +
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
  if (t.dataset.cat) {
    colors[idx].qty[t.dataset.cat] = Number(t.value) || 0;
    const rowTotal = CATEGORIES.reduce((sum, cat) => sum + (Number(colors[idx].qty[cat]) || 0), 0);
    const cell = document.querySelector(`[data-row-total="${idx}"]`);
    if (cell) cell.textContent = rowTotal;
    const catTotals = CATEGORIES.map((cat) => colors.reduce((sum, c) => sum + (Number(c.qty[cat]) || 0), 0));
    document.querySelectorAll("#colorSizeFoot td.cost-cell").forEach((cell, i) => {
      if (i < catTotals.length) cell.textContent = catTotals[i];
    });
    const grandTotal = catTotals.reduce((a, b) => a + b, 0);
    el("colorSizeGrandTotal").textContent = grandTotal;
    // Total order qty changing shifts every Fabric row's derived Avg
    // Consumption, so the whole parts table needs a full re-render.
    recalcFabricConsumption();
    renderParts();
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
  return colors.reduce((sum, c) => sum + (Number(c.qty.A) || 0) + (Number(c.qty.B) || 0), 0);
}

// Avg Consumption on every Fabric row is derived, not typed in: Fabric Used
// / total pieces ordered (all colors, both categories). Recalculated
// whenever Fabric Used changes or the order-quantity grid changes. Only
// overwrites Avg Consumption once Fabric Used is actually entered (> 0) -
// otherwise leaves whatever figure is already there untouched, so older
// styles with a manually-entered estimate (from before Fabric Used existed)
// aren't silently zeroed out just for having no usage logged yet.
function recalcFabricConsumption() {
  const qty = totalPcs();
  PART_KEYS.forEach((key) => {
    parts[key].components.forEach((row) => {
      if (row.type === "Fabric" && Number(row.fabricUsed) > 0) {
        row.consumption = qty > 0 ? Number(row.fabricUsed) / qty : row.consumption;
      }
    });
  });
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
  const components = parts[partKey].components;
  const fabricEntries = components.map((row, idx) => ({ row, idx })).filter(({ row }) => row.type === "Fabric");
  const processEntries = components.map((row, idx) => ({ row, idx })).filter(({ row }) => row.type === "Process");

  return `
    <h4 style="margin:10px 0 4px;">Fabric</h4>
    ${renderSegmentTable(partKey, fabricEntries, true)}
    <button class="btn-small" type="button" data-action="add-line-item" data-part="${partKey}" data-type="Fabric" style="margin-top:6px;">+ Add Line Item</button>

    <h4 style="margin:18px 0 4px;">Process / Job Work</h4>
    ${renderSegmentTable(partKey, processEntries, false)}
    <button class="btn-small" type="button" data-action="add-line-item" data-part="${partKey}" data-type="Process" style="margin-top:6px;">+ Add Line Item</button>
  `;
}

function renderSegmentTable(partKey, entries, isFabric) {
  const rows = entries
    .map(({ row, idx }, i) => renderComponentRow(partKey, row, idx, isFabric, i === 0, i === entries.length - 1))
    .join("");
  const extraHeaders = isFabric
    ? `<th style="width:90px;">Fabric No.</th><th style="width:90px;">Fabric Used</th><th style="width:100px;">Remaining Fabric</th><th style="width:140px;">Image</th>`
    : `<th style="width:120px;">Vendor</th><th style="width:100px;">Bill No.</th><th style="width:100px;">Actual Billed Qty</th><th style="width:70px;">Received</th>`;
  const reorderHeader = isFabric ? "" : `<th style="width:60px;">Order</th>`;

  return `
    <div class="table-scroll">
      <table class="comp-table">
        <thead>
          <tr>
            <th style="min-width:180px;">Line Item</th>
            <th style="width:70px;">UOM</th>
            <th style="width:90px;">Est. Rate</th>
            <th style="width:90px;">Actual Rate</th>
            <th style="width:110px;">Avg Consumption</th>
            ${extraHeaders}
            ${reorderHeader}
            <th style="width:36px;"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderComponentRow(partKey, row, idx, isFabric, isFirstProcess, isLastProcess) {
  const isCustom = !!row.custom;
  // The primary (non-custom) Fabric row is always at a stable position, so
  // it's the only one addressable by the per-part fabric-image endpoint.
  const isPrimaryFabric = isFabric && !isCustom;

  const reorderCell = isFabric
    ? ""
    : `
      <td style="white-space:nowrap;">
        <button class="btn-small" type="button" data-action="move-process-up" data-part="${partKey}" data-idx="${idx}" ${isFirstProcess ? "disabled" : ""}>&uarr;</button>
        <button class="btn-small" type="button" data-action="move-process-down" data-part="${partKey}" data-idx="${idx}" ${isLastProcess ? "disabled" : ""}>&darr;</button>
      </td>
    `;

  const jobWorkCells = isFabric
    ? ""
    : `
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="vendor" value="${escapeAttr(row.vendor)}" placeholder="Vendor" style="max-width:110px;" /></td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="billNo" value="${escapeAttr(row.billNo)}" placeholder="Bill No." style="max-width:100px;" /></td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="billedQty" type="number" step="0.01" min="0" value="${row.billedQty || 0}" style="max-width:90px;" /></td>
      <td style="text-align:center;"><input data-part="${partKey}" data-idx="${idx}" data-field="received" type="checkbox" ${row.received ? "checked" : ""} /></td>
    `;

  const imageCell = !isPrimaryFabric
    ? `<span style="color:var(--muted); font-size:12px;">-</span>`
    : `
      <div style="display:flex; align-items:center; gap:6px;">
        ${row.fabricImagePath ? `<img src="${escapeAttr(row.fabricImagePath)}" style="width:32px; height:32px; object-fit:cover; border-radius:4px;" />` : `<span style="color:var(--muted); font-size:11px;">No image</span>`}
        <input type="file" accept="image/*" data-action="fabric-image-input" data-part="${partKey}" style="max-width:100px; font-size:11px;" />
        ${row.fabricImagePath ? `<button class="btn-small" type="button" data-action="remove-fabric-image" data-part="${partKey}">✕</button>` : ""}
      </div>
    `;
  const fabricCells = !isFabric
    ? ""
    : `
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="fabricNo" value="${escapeAttr(row.fabricNo || "")}" placeholder="e.g. F-101" style="max-width:90px;" /></td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="fabricUsed" type="number" step="0.01" min="0" value="${row.fabricUsed || 0}" style="max-width:80px;" /></td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="fabricRemaining" type="number" step="0.01" min="0" value="${row.fabricRemaining || 0}" style="max-width:80px;" /></td>
      <td>${imageCell}</td>
    `;

  // Every line item's name is editable now - process rows are no longer
  // locked to the fixed starting names, since they can be renamed, removed,
  // and reordered freely.
  const descriptionCell = `<input data-part="${partKey}" data-idx="${idx}" data-field="description" value="${escapeAttr(row.description)}" placeholder="${isFabric ? "e.g. Self Fabric - Rayon" : "Line item name"}" />`;

  // Fabric keeps the old custom-only removal (the primary row is load-bearing
  // for the fabric-image upload); every Process row is removable now.
  const removeCell = isFabric && !isCustom
    ? ""
    : `<button class="btn-small" type="button" data-action="remove-line-item" data-part="${partKey}" data-idx="${idx}">✕</button>`;

  // Fabric's Avg Consumption is derived (Fabric Used / total pieces ordered)
  // - read-only, never typed in directly. Process rows stay manually editable.
  const consumptionCell = isFabric
    ? `<span data-consumption-cell="${partKey}-${idx}" title="Fabric Used ÷ Total Order Qty (all colors)">${(Number(row.consumption) || 0).toFixed(4)}</span>`
    : `<input data-part="${partKey}" data-idx="${idx}" data-field="consumption" type="number" step="0.01" min="0" value="${row.consumption}" style="max-width:90px;" />`;

  return `
    <tr>
      <td>${descriptionCell}</td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="uom" value="${escapeAttr(row.uom)}" placeholder="Mtr/Pcs" /></td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="estimatedRate" type="number" step="0.01" min="0" value="${row.estimatedRate}" /></td>
      <td><input data-part="${partKey}" data-idx="${idx}" data-field="actualRate" type="number" step="0.01" min="0" value="${row.actualRate}" /></td>
      <td>${consumptionCell}</td>
      ${fabricCells}
      ${jobWorkCells}
      ${reorderCell}
      <td>${removeCell}</td>
    </tr>
  `;
}

async function uploadFabricImage(partKey, file) {
  if (!currentStyleId) {
    toast("Save the component sheet first, then add a fabric image", true);
    return;
  }
  const formData = new FormData();
  formData.append("fabricImage", file);
  const res = await fetch(`/api/styles/${currentStyleId}/parts/${partKey}/fabric-image`, { method: "POST", body: formData });
  if (!res.ok) {
    toast("Could not upload fabric image", true);
    return;
  }
  const data = await res.json();
  const fabricRow = parts[partKey].components.find((c) => c.type === "Fabric" && !c.custom);
  if (fabricRow) fabricRow.fabricImagePath = data.fabricImagePath;
  renderParts();
  toast("Fabric image uploaded");
}

async function removeFabricImage(partKey) {
  if (!currentStyleId) return;
  const formData = new FormData();
  formData.append("removeFabricImage", "true");
  const res = await fetch(`/api/styles/${currentStyleId}/parts/${partKey}/fabric-image`, { method: "POST", body: formData });
  if (!res.ok) return;
  const fabricRow = parts[partKey].components.find((c) => c.type === "Fabric" && !c.custom);
  if (fabricRow) fabricRow.fabricImagePath = null;
  renderParts();
}

function renderCostSummary() {
  const head = el("costSummaryHead");
  head.innerHTML = `<th style="text-align:left;">Part</th><th>Est. Cost / Garment</th><th>Actual Cost / Garment</th>`;

  const currency = currentCurrency || "";
  let rows = "";
  PART_KEYS.forEach((key) => {
    if (!parts[key].enabled) return;
    rows += `<tr><td style="text-align:left;">${PART_LABELS[key]}</td><td class="cost-cell">${partCost(key, "estimatedRate").toFixed(2)}</td><td class="cost-cell">${partCost(key, "actualRate").toFixed(2)}</td></tr>`;
  });
  const estCost = grandCost("estimatedRate");
  const actualCost = grandCost("actualRate");
  const selling = totalSellingRate();
  rows += `<tr style="font-weight:bold; border-top:2px solid var(--navy);"><td style="text-align:left;">Total Cost / Garment</td><td class="cost-cell">${currency} ${estCost.toFixed(2)}</td><td class="cost-cell">${currency} ${actualCost.toFixed(2)}</td></tr>`;
  rows += `<tr><td style="text-align:left;">Selling Rate / Garment</td><td class="cost-cell">${currency} ${selling.toFixed(2)}</td><td class="cost-cell">${currency} ${selling.toFixed(2)}</td></tr>`;
  rows += `<tr><td style="text-align:left;">Margin / Garment</td><td class="cost-cell">${currency} ${(selling - estCost).toFixed(2)}</td><td class="cost-cell">${currency} ${(selling - actualCost).toFixed(2)}</td></tr>`;
  el("costSummaryBody").innerHTML = rows;

  const qty = totalPcs();
  el("sumOrderQty").textContent = qty ? qty.toLocaleString() : "-";

  const totalEstCostValue = estCost * qty;
  const totalActualCostValue = actualCost * qty;
  const totalSellingValue = selling * qty;
  el("sumCostValue").textContent = qty ? `${currency} ${totalEstCostValue.toFixed(2)}` : "-";
  el("sumActualCostValue").textContent = qty ? `${currency} ${totalActualCostValue.toFixed(2)}` : "-";
  el("sumSellingValue").textContent = qty ? `${currency} ${totalSellingValue.toFixed(2)}` : "-";
  el("sumMargin").textContent = qty ? `${currency} ${(totalSellingValue - totalEstCostValue).toFixed(2)}` : "-";
  el("sumActualMargin").textContent = qty ? `${currency} ${(totalSellingValue - totalActualCostValue).toFixed(2)}` : "-";
}

// ---- Variance analysis (aggregated across all production entries) ----

const DESIGN_STATUS_COLORS = {
  "Not Sent": "var(--muted)",
  "Sent for Approval": "#b8860b",
  Approved: "#1a7a3c",
  Rejected: "var(--red)",
};

function renderDesignApproval() {
  const statusEl = el("designApprovalStatusText");
  statusEl.textContent = designApproval.status;
  statusEl.style.color = DESIGN_STATUS_COLORS[designApproval.status] || "";

  const decided = designApproval.status === "Approved" || designApproval.status === "Rejected";
  el("designApprovalDecisionWrap").style.display = decided ? "" : "none";
  if (decided) {
    el("designApprovalDecisionText").textContent = `${designApproval.approverName || "-"} on ${designApproval.date || "-"}`;
  }
  el("designApprovalRemarksWrap").style.display = designApproval.remarks ? "" : "none";
  el("designApprovalRemarksText").textContent = designApproval.remarks;

  const btn = el("sendForApprovalBtn");
  btn.textContent = designApproval.status === "Rejected" ? "Re-send for Approval" : "Send for Approval";
  btn.disabled = !currentStyleId && designApproval.status === "Sent for Approval";
}

async function sendForApproval() {
  if (!currentStyleId) {
    toast("Save the component sheet first (Style No. and Style Name are required)", true);
    return;
  }
  await saveStyle();
  if (!currentStyleId) return; // save failed
  const res = await fetch(`/api/styles/${currentStyleId}/design-approval/send`, { method: "POST" });
  if (!res.ok) {
    toast("Could not send for approval", true);
    return;
  }
  toast("Sent for approval");
  openStyle(currentStyleId);
}

el("sendForApprovalBtn").addEventListener("click", sendForApproval);

function renderVarianceTable() {
  const totals = new Map(); // key: `${part}|${description}` -> { part, description, uom, expected, actual }
  styleActuals.forEach((entry) => {
    (entry.lines || []).forEach((line) => {
      const key = `${line.part}|${line.description}`;
      if (!totals.has(key)) {
        totals.set(key, { part: line.part, description: line.description, uom: line.uom, expected: 0, actual: 0 });
      }
      const t = totals.get(key);
      t.expected += Number(line.estConsumption) || 0;
      t.actual += Number(line.actualConsumption) || 0;
    });
  });

  const rows = Array.from(totals.values());
  if (rows.length === 0) {
    el("varianceTable").style.display = "none";
    el("varianceEmptyState").style.display = "block";
    return;
  }
  el("varianceTable").style.display = "";
  el("varianceEmptyState").style.display = "none";

  el("varianceBody").innerHTML = rows
    .map((r) => {
      const variance = r.actual - r.expected;
      const color = variance > 0 ? "#c0392b" : variance < 0 ? "#1a7a3c" : "#64748b";
      return `
        <tr>
          <td>${escapeAttr(PART_LABELS[r.part] || r.part)}</td>
          <td>${escapeAttr(r.description)}</td>
          <td>${escapeAttr(r.uom)}</td>
          <td>${r.expected.toFixed(2)}</td>
          <td>${r.actual.toFixed(2)}</td>
          <td style="color:${color};">${(variance > 0 ? "+" : "") + variance.toFixed(2)}</td>
        </tr>
      `;
    })
    .join("");
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
  if (!field) return;
  const partKey = t.dataset.part;
  const idx = Number(t.dataset.idx);
  const row = parts[partKey].components[idx];
  if (field === "consumption" || field === "estimatedRate" || field === "actualRate" || field === "billedQty" || field === "fabricUsed" || field === "fabricRemaining") {
    row[field] = Number(t.value) || 0;
  } else if (field === "received") {
    row.received = t.checked;
  } else {
    row[field] = t.value;
  }
  if (field === "fabricUsed" && row.fabricUsed > 0) {
    const qty = totalPcs();
    if (qty > 0) row.consumption = row.fabricUsed / qty;
    const cell = document.querySelector(`[data-consumption-cell="${partKey}-${idx}"]`);
    if (cell) cell.textContent = (Number(row.consumption) || 0).toFixed(4);
  }
  renderCostSummary();
});

el("partsContainer").addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.action === "toggle-part") {
    parts[t.dataset.part].enabled = t.checked;
    renderParts();
    return;
  }
  if (t.dataset.action === "fabric-image-input") {
    const file = t.files[0];
    if (file) uploadFabricImage(t.dataset.part, file);
  }
});

el("partsContainer").addEventListener("click", (e) => {
  const addBtn = e.target.closest('button[data-action="add-line-item"]');
  if (addBtn) {
    parts[addBtn.dataset.part].components.push(defaultCustomRow(addBtn.dataset.type));
    renderParts();
    return;
  }
  const removeBtn = e.target.closest('button[data-action="remove-line-item"]');
  if (removeBtn) {
    parts[removeBtn.dataset.part].components.splice(Number(removeBtn.dataset.idx), 1);
    renderParts();
    return;
  }
  const removeImgBtn = e.target.closest('button[data-action="remove-fabric-image"]');
  if (removeImgBtn) {
    removeFabricImage(removeImgBtn.dataset.part);
    return;
  }
  const moveUpBtn = e.target.closest('button[data-action="move-process-up"]');
  if (moveUpBtn) {
    moveProcessRow(moveUpBtn.dataset.part, Number(moveUpBtn.dataset.idx), "up");
    return;
  }
  const moveDownBtn = e.target.closest('button[data-action="move-process-down"]');
  if (moveDownBtn) {
    moveProcessRow(moveDownBtn.dataset.part, Number(moveDownBtn.dataset.idx), "down");
  }
});

// Reorders a Process row relative to other Process rows only - Fabric rows
// aren't part of this ordering and keep their own position.
function moveProcessRow(partKey, idx, direction) {
  const components = parts[partKey].components;
  const processIndices = components.map((r, i) => (r.type === "Process" ? i : -1)).filter((i) => i !== -1);
  const pos = processIndices.indexOf(idx);
  const swapPos = direction === "up" ? pos - 1 : pos + 1;
  if (pos === -1 || swapPos < 0 || swapPos >= processIndices.length) return;
  const otherIdx = processIndices[swapPos];
  [components[idx], components[otherIdx]] = [components[otherIdx], components[idx]];
  renderParts();
}

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
      const approvalColor = s.designApprovalStatus === "Approved" ? "#1a7a3c" : s.designApprovalStatus === "Rejected" ? "var(--red)" : "var(--muted)";
      li.innerHTML = `
        <div class="sname">${escapeAttr(s.styleNo)} - ${escapeAttr(s.styleName)}</div>
        <div class="smeta">${escapeAttr(s.buyer || "-")} · ${escapeAttr(s.orderType)} · ${s.totalPcs} pcs · ${s.componentCount} rows · ${s.actualsCount} production entries</div>
        <div class="smeta" style="color:${approvalColor}; font-weight:bold;">Design: ${escapeAttr(s.designApprovalStatus)}</div>
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
  el("pocket").value = s.pocket || "";
  el("patti").value = s.patti || "";
  el("printPatti").value = s.printPatti || "";
  currentBuyer = s.buyer || "";
  currentSeason = s.season || "";
  currentCurrency = s.currency || "INR";
  currentOrderType = s.orderType || "Bulk";
  colors = s.colors && s.colors.length ? s.colors : [];
  parts = s.parts;
  recalcFabricConsumption();
  styleActuals = s.actuals || [];
  el("statusText").textContent = `Created ${new Date(s.createdAt).toLocaleString()} · Last updated ${new Date(s.updatedAt).toLocaleString()}`;

  designApproval = s.designApproval || defaultApproval("Not Sent");
  renderDesignApproval();

  const varianceApproval = s.varianceApproval || defaultApproval("Pending");
  el("varianceApprovalStatus").value = varianceApproval.status;
  el("varianceApprovalApprover").value = varianceApproval.approverName;
  el("varianceApprovalDate").value = varianceApproval.date;
  el("varianceApprovalRemarks").value = varianceApproval.remarks;

  renderColorSizeTable();
  renderParts();
  renderVarianceTable();
  resetDesignImageInput(s.designImagePath || null);
  loadStyleList(id);
}

function resetForm() {
  currentStyleId = null;
  el("styleNo").value = "";
  el("styleName").value = "";
  el("pocket").value = "";
  el("patti").value = "";
  el("printPatti").value = "";
  currentBuyer = "";
  currentSeason = "";
  currentCurrency = "INR";
  currentOrderType = "Bulk";
  // New styles default to a quantity of 1, since the real order total now
  // comes from what production enters - this just keeps costing/margin
  // figures meaningful (per-piece) before an actual order qty is known.
  colors = [{ name: "Default", qty: { A: 1, B: 0 } }];
  parts = defaultParts();
  recalcFabricConsumption();
  styleActuals = [];
  el("statusText").textContent = "";

  designApproval = defaultApproval("Not Sent");
  renderDesignApproval();

  const freshVariance = defaultApproval("Pending");
  el("varianceApprovalStatus").value = freshVariance.status;
  el("varianceApprovalApprover").value = freshVariance.approverName;
  el("varianceApprovalDate").value = freshVariance.date;
  el("varianceApprovalRemarks").value = freshVariance.remarks;

  renderColorSizeTable();
  renderParts();
  renderVarianceTable();
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
      components: parts[key].components,
    };
  }
  const colorsToSave = colors.filter((c) => c.name.trim() !== "");

  const formData = new FormData();
  formData.append("styleNo", styleNo);
  formData.append("styleName", styleName);
  formData.append("pocket", el("pocket").value.trim());
  formData.append("patti", el("patti").value.trim());
  formData.append("printPatti", el("printPatti").value.trim());
  formData.append("buyer", currentBuyer);
  formData.append("season", currentSeason);
  formData.append("currency", currentCurrency || "INR");
  formData.append("orderType", currentOrderType);
  formData.append("colors", JSON.stringify(colorsToSave));
  formData.append("parts", JSON.stringify(partsToSave));
  // designApproval is intentionally not sent here - it only changes via
  // "Send for Approval" or the approver's own decision, never a plain save.
  formData.append("varianceApproval", JSON.stringify({
    status: el("varianceApprovalStatus").value,
    approverName: el("varianceApprovalApprover").value.trim(),
    date: el("varianceApprovalDate").value,
    remarks: el("varianceApprovalRemarks").value.trim(),
  }));

  const fileInput = el("designImageInput");
  if (fileInput.files[0]) {
    formData.append("designImage", fileInput.files[0]);
  } else if (removeImageRequested) {
    formData.append("removeDesignImage", "true");
  }

  const url = currentStyleId ? `/api/styles/${currentStyleId}` : "/api/styles";
  const method = currentStyleId ? "PUT" : "POST";
  const res = await fetch(url, { method, body: formData });
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

resetForm();
loadStyleList(null);
