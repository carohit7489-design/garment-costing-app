const CATEGORIES = ["A", "B"];
const CATEGORY_LABELS = { A: "Category A", B: "Category B" };
const PART_KEYS = ["kurta", "pant", "dupatta"];
const PART_LABELS = { kurta: "Kurta", pant: "Pant", dupatta: "Dupatta" };

let currentStyle = null;
let selectedCategory = CATEGORIES[0];
let selectedColor = "";
let actualData = {}; // { kurta: [{type,description,uom,estConsumption,actualConsumption}], pant:[...], dupatta:[...] }

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

el("categorySelect").innerHTML = CATEGORIES.map((c) => `<option value="${c}">${CATEGORY_LABELS[c]}</option>`).join("");

async function loadStyleList(selectId) {
  const res = await fetch("/api/styles");
  const styles = await res.json();
  const list = el("styleList");
  list.innerHTML = "";
  if (styles.length === 0) {
    list.innerHTML = '<li class="empty-state" style="cursor:default;">No styles yet. Ask the owner to create a component sheet first.</li>';
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

function estConsumptionFor(component) {
  return Number(component.consumption) || 0;
}

// Costing is done per single piece; production works in whole batches, so
// the per-piece figures are scaled up by however many pieces were made.
// Falls back to 1 (i.e. shows the per-piece figure as-is) until a qty is entered.
function currentQtyMultiplier() {
  const v = Number(el("actualQty").value);
  return v > 0 ? v : 1;
}

function buildActualLines() {
  actualData = {};
  const multiplier = currentQtyMultiplier();
  PART_KEYS.forEach((key) => {
    const part = currentStyle.parts[key];
    actualData[key] = !part.enabled
      ? []
      : part.components.map((c) => {
          const estPerPiece = estConsumptionFor(c);
          return {
            index: c.index,
            type: c.type,
            description: c.description,
            uom: c.uom,
            estPerPiece,
            estConsumption: estPerPiece * multiplier,
            actualConsumption: "",
            vendor: c.vendor || "",
            billNo: c.billNo || "",
            received: !!c.received,
          };
        });
  });
}

// Re-scales expected totals when the produced-qty field changes, without
// touching any actual-consumption values already typed in.
function refreshExpectedConsumption() {
  if (!currentStyle) return;
  const multiplier = currentQtyMultiplier();
  PART_KEYS.forEach((key) => {
    actualData[key].forEach((row) => {
      row.estConsumption = row.estPerPiece * multiplier;
    });
  });
  renderPartsActual();
}

// ---- Fabric cut planning (Category A: 40-46, Category B: 48-52) ----
// A pure what-if calculator - not saved anywhere. Total Fabric / Average
// Consumption per Piece gives the total pieces obtainable; that total is
// then split across the two size categories by the share %.

function populateRatioPartSelect() {
  const options = PART_KEYS.filter((key) => {
    const part = currentStyle.parts[key];
    return part.enabled && part.components.some((c) => c.type === "Fabric");
  });
  el("ratioPartSelect").innerHTML = options.map((k) => `<option value="${k}">${PART_LABELS[k]}</option>`).join("");
  updateRatioAvgDefault();
}

function ratioFabricRow() {
  const partKey = el("ratioPartSelect").value;
  if (!partKey || !currentStyle) return null;
  const part = currentStyle.parts[partKey];
  return part ? part.components.find((c) => c.type === "Fabric") || null : null;
}

// Suggests a starting average from the costing sheet whenever the selected
// part/fabric changes - the field stays editable afterward, since real
// cutting-room average consumption may differ from the costing sheet.
function updateRatioAvgDefault() {
  const fabricRow = ratioFabricRow();
  el("ratioAvgConsumption").value = fabricRow ? (Number(fabricRow.consumption) || 0).toFixed(2) : "";
  renderRatioPlanning();
}

function renderRatioPlanning() {
  const fabricRow = ratioFabricRow();
  if (!fabricRow) {
    el("ratioTable").style.display = "none";
    el("ratioEmptyState").style.display = "block";
    return;
  }
  el("ratioTable").style.display = "";
  el("ratioEmptyState").style.display = "none";

  const uom = fabricRow.uom || "";
  const totalFabric = Number(el("ratioTotalFabric").value) || 0;
  const avgConsumption = Number(el("ratioAvgConsumption").value) || 0;
  let pctA = Number(el("ratioPctA").value);
  if (isNaN(pctA)) pctA = 0;
  pctA = Math.min(100, Math.max(0, pctA));
  const pctB = 100 - pctA;

  const totalPieces = avgConsumption > 0 ? Math.floor(totalFabric / avgConsumption) : 0;
  const piecesA = Math.floor(totalPieces * (pctA / 100));
  const piecesB = totalPieces - piecesA; // always sums back to totalPieces exactly

  const fabricUsedA = piecesA * avgConsumption;
  const fabricUsedB = piecesB * avgConsumption;
  const totalFabricUsed = fabricUsedA + fabricUsedB;

  el("ratioTotalPieces").textContent = totalPieces.toLocaleString();
  el("ratioFabricUsed").textContent = `${totalFabricUsed.toFixed(2)} ${uom}`;
  el("ratioFabricRemaining").textContent = `${(totalFabric - totalFabricUsed).toFixed(2)} ${uom}`;

  el("ratioBody").innerHTML = `
    <tr>
      <td style="text-align:left;">Category A</td>
      <td>${pctA.toFixed(0)}%</td>
      <td style="font-weight:bold;">${piecesA}</td>
      <td>${fabricUsedA.toFixed(2)} ${uom}</td>
    </tr>
    <tr>
      <td style="text-align:left;">Category B</td>
      <td>${pctB.toFixed(0)}%</td>
      <td style="font-weight:bold;">${piecesB}</td>
      <td>${fabricUsedB.toFixed(2)} ${uom}</td>
    </tr>
  `;
  el("ratioFoot").innerHTML = `
    <td style="text-align:left;">Total</td>
    <td>100%</td>
    <td>${totalPieces}</td>
    <td>${totalFabricUsed.toFixed(2)} ${uom}</td>
  `;
}

el("ratioPartSelect").addEventListener("change", updateRatioAvgDefault);
el("ratioTotalFabric").addEventListener("input", renderRatioPlanning);
el("ratioAvgConsumption").addEventListener("input", renderRatioPlanning);
el("ratioPctA").addEventListener("input", renderRatioPlanning);

async function openStyle(id) {
  const res = await fetch(`/api/styles/${id}/production-view`);
  if (!res.ok) return toast("Could not load style", true);
  const s = await res.json();
  currentStyle = s;

  el("emptyState").style.display = "none";
  el("detailContent").style.display = "block";
  el("formTitle").textContent = `${s.styleNo} - ${s.styleName}`;
  el("infoBuyer").textContent = s.buyer || "-";
  el("infoSeason").textContent = s.season || "-";
  el("infoOrderType").textContent = s.orderType || "-";
  const totalQty = (s.colors || []).reduce((sum, c) => sum + (Number(c.qty.A) || 0) + (Number(c.qty.B) || 0), 0);
  el("infoTotalQty").textContent = totalQty ? totalQty.toLocaleString() : "-";

  const colorNames = (s.colors || []).map((c) => c.name).filter(Boolean);
  el("colorSelect").innerHTML = colorNames.length
    ? colorNames.map((c) => `<option value="${escapeAttr(c)}">${escapeAttr(c)}</option>`).join("")
    : `<option value="">-</option>`;
  selectedColor = colorNames[0] || "";

  el("ratioTotalFabric").value = "";
  populateRatioPartSelect();

  const img = el("designPreview");
  const empty = el("designPreviewEmpty");
  if (s.designImagePath) {
    img.src = s.designImagePath;
    img.style.display = "block";
    empty.style.display = "none";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
    empty.style.display = "block";
  }

  el("actualQty").value = "";
  el("prodDate").value = new Date().toISOString().slice(0, 10);
  el("filledBy").value = "";
  el("categorySelect").value = selectedCategory;

  const approved = s.designApprovalStatus === "Approved";
  el("notApprovedBanner").style.display = approved ? "none" : "block";
  el("entryForm").style.display = approved ? "" : "none";

  buildActualLines();
  renderPartsActual();
  renderHistory();
  loadStyleList(id);
}

function renderPartsActual() {
  const container = el("partsActualContainer");
  const enabledParts = PART_KEYS.filter((key) => currentStyle.parts[key].enabled);
  if (enabledParts.length === 0) {
    container.innerHTML = '<div class="empty-state">This style has no parts with components yet.</div>';
    return;
  }
  container.innerHTML = enabledParts
    .map(
      (key) => `
        <div class="part-block">
          <div class="part-header"><label>${PART_LABELS[key]}</label></div>
          ${renderPartActualTable(key)}
        </div>
      `
    )
    .join("");
}

function renderPartActualTable(partKey) {
  const rows = actualData[partKey]
    .map((row, idx) => {
      const variance = row.actualConsumption === "" ? null : Number(row.actualConsumption) - row.estConsumption;
      const varianceText = variance === null ? "-" : (variance > 0 ? "+" : "") + variance.toFixed(2);
      const color = variance > 0 ? "#c0392b" : variance < 0 ? "#1a7a3c" : "#64748b";
      const isProcess = row.type === "Process";
      const vendorCell = isProcess
        ? `<input data-part="${partKey}" data-idx="${idx}" data-status-field="vendor" value="${escapeAttr(row.vendor)}" placeholder="Vendor" style="max-width:110px;" />`
        : `<span style="color:var(--muted); font-size:12px;">-</span>`;
      const billCell = isProcess
        ? `<input data-part="${partKey}" data-idx="${idx}" data-status-field="billNo" value="${escapeAttr(row.billNo)}" placeholder="Bill No." style="max-width:100px;" />`
        : `<span style="color:var(--muted); font-size:12px;">-</span>`;
      const receivedCell = isProcess
        ? `<input data-part="${partKey}" data-idx="${idx}" data-status-field="received" type="checkbox" ${row.received ? "checked" : ""} />`
        : `<span style="color:var(--muted); font-size:12px;">-</span>`;
      return `
        <tr>
          <td>${escapeAttr(row.type)}</td>
          <td>${escapeAttr(row.description)}</td>
          <td>${escapeAttr(row.uom)}</td>
          <td>${row.estConsumption.toFixed(2)}</td>
          <td><input class="actual-input" data-part="${partKey}" data-idx="${idx}" type="number" step="0.01" min="0" value="${row.actualConsumption}" placeholder="Total used" /></td>
          <td style="color:${color};" data-variance-cell="${partKey}-${idx}">${varianceText}</td>
          <td>${vendorCell}</td>
          <td>${billCell}</td>
          <td style="text-align:center;">${receivedCell}</td>
        </tr>
      `;
    })
    .join("");
  return `
    <div class="table-scroll">
      <table class="comp-table">
        <thead>
          <tr>
            <th style="width:90px;">Type</th>
            <th style="min-width:140px;">Description</th>
            <th style="width:60px;">UOM</th>
            <th style="width:110px;">Expected Total (for entered pcs)</th>
            <th style="width:130px;">Actual Total Used</th>
            <th style="width:80px;">Variance</th>
            <th style="width:120px;">Vendor</th>
            <th style="width:100px;">Bill No.</th>
            <th style="width:70px;">Received</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

el("partsActualContainer").addEventListener("input", (e) => {
  const t = e.target;
  if (!t.dataset.part) return;
  if (t.dataset.statusField) return; // handled separately below
  const partKey = t.dataset.part;
  const idx = Number(t.dataset.idx);
  const row = actualData[partKey][idx];
  row.actualConsumption = t.value;

  const variance = row.actualConsumption === "" ? null : Number(row.actualConsumption) - row.estConsumption;
  const varianceText = variance === null ? "-" : (variance > 0 ? "+" : "") + variance.toFixed(2);
  const cell = document.querySelector(`[data-variance-cell="${partKey}-${idx}"]`);
  if (cell) {
    cell.textContent = varianceText;
    cell.style.color = variance > 0 ? "#c0392b" : variance < 0 ? "#1a7a3c" : "#64748b";
  }
});

// Vendor/Bill No./Received save immediately (job-work status, independent
// of the "Save Actual Consumption" batch action below).
async function saveComponentStatus(partKey, idx) {
  const row = actualData[partKey][idx];
  await fetch(`/api/styles/${currentStyle.id}/parts/${partKey}/components/${row.index}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vendor: row.vendor, billNo: row.billNo, received: row.received }),
  });
}

el("partsActualContainer").addEventListener("input", (e) => {
  const t = e.target;
  if (!t.dataset.statusField || t.dataset.statusField === "received") return;
  const partKey = t.dataset.part;
  const idx = Number(t.dataset.idx);
  actualData[partKey][idx][t.dataset.statusField] = t.value;
});

el("partsActualContainer").addEventListener("change", (e) => {
  const t = e.target;
  if (!t.dataset.statusField) return;
  const partKey = t.dataset.part;
  const idx = Number(t.dataset.idx);
  if (t.dataset.statusField === "received") {
    actualData[partKey][idx].received = t.checked;
  }
  saveComponentStatus(partKey, idx).then(() => toast("Saved"));
});

el("partsActualContainer").addEventListener(
  "blur",
  (e) => {
    const t = e.target;
    if (t.dataset.statusField && t.dataset.statusField !== "received") {
      saveComponentStatus(t.dataset.part, Number(t.dataset.idx)).then(() => toast("Saved"));
    }
  },
  true
);

el("categorySelect").addEventListener("change", (e) => {
  selectedCategory = e.target.value;
});

el("colorSelect").addEventListener("change", (e) => {
  selectedColor = e.target.value;
});

el("actualQty").addEventListener("input", refreshExpectedConsumption);

function renderHistory() {
  const container = el("historyList");
  const entries = currentStyle.actuals || [];
  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state">No production entries recorded yet for this style.</div>';
    return;
  }
  container.innerHTML = entries
    .slice()
    .reverse()
    .map((e) => {
      const linesHtml = e.lines
        .map((l) => `${escapeAttr(l.part ? PART_LABELS[l.part] + " - " : "")}${escapeAttr(l.description)}: ${l.actualConsumption} ${escapeAttr(l.uom)} used (expected ${l.estConsumption} for ${e.actualProducedQty} pcs)`)
        .join(" · ");
      return `<div class="hist-item"><strong>${e.productionDate || "-"}</strong> · ${escapeAttr(e.color || "-")} / ${escapeAttr(CATEGORY_LABELS[e.category] || "-")} · Produced ${e.actualProducedQty} pcs · Filled by ${escapeAttr(e.filledBy || "-")}<br/>${linesHtml}</div>`;
    })
    .join("");
}

async function saveActuals() {
  if (!currentStyle) return;
  const allLines = [];
  PART_KEYS.forEach((key) => {
    actualData[key].forEach((l) => {
      allLines.push({
        part: key,
        type: l.type,
        description: l.description,
        uom: l.uom,
        estConsumption: l.estConsumption,
        actualConsumption: Number(l.actualConsumption) || 0,
      });
    });
  });

  const incomplete = PART_KEYS.some((key) => actualData[key].some((l) => l.actualConsumption === ""));
  if (incomplete && !confirm("Some components have no actual consumption entered. Save anyway?")) {
    return;
  }

  const payload = {
    color: selectedColor,
    category: selectedCategory,
    filledBy: el("filledBy").value.trim(),
    productionDate: el("prodDate").value,
    actualProducedQty: Number(el("actualQty").value) || 0,
    lines: allLines,
  };

  const res = await fetch(`/api/styles/${currentStyle.id}/actuals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast(err.error || "Save failed", true);
    return;
  }
  toast("Actual consumption saved");
  openStyle(currentStyle.id);
}

el("saveActualsBtn").addEventListener("click", saveActuals);

loadStyleList(null);
