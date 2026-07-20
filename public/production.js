const SIZES = ["40", "42", "44", "46", "48", "50", "52"];
const PART_KEYS = ["kurta", "pant", "dupatta"];
const PART_LABELS = { kurta: "Kurta", pant: "Pant", dupatta: "Dupatta" };

let currentStyle = null;
let selectedSize = SIZES[0];
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

el("sizeSelect").innerHTML = SIZES.map((s) => `<option value="${s}">${s}</option>`).join("");

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
      li.innerHTML = `
        <div class="sname">${escapeAttr(s.styleNo)} - ${escapeAttr(s.styleName)}</div>
        <div class="smeta">${escapeAttr(s.buyer || "-")} · ${escapeAttr(s.orderType)} · ${s.totalPcs} pcs · ${s.componentCount} rows · ${s.actualsCount} production entries</div>
      `;
      li.addEventListener("click", () => openStyle(s.id));
      list.appendChild(li);
    });
}

function estConsumptionFor(component, size) {
  return component.type === "Fabric"
    ? Number(component.sizeConsumption?.[size]) || 0
    : Number(component.consumption) || 0;
}

function buildActualLines() {
  actualData = {};
  PART_KEYS.forEach((key) => {
    const part = currentStyle.parts[key];
    actualData[key] = !part.enabled
      ? []
      : part.components.map((c) => ({
          index: c.index,
          type: c.type,
          description: c.description,
          uom: c.uom,
          estConsumption: estConsumptionFor(c, selectedSize),
          actualConsumption: "",
          vendor: c.vendor || "",
          billNo: c.billNo || "",
          received: !!c.received,
        }));
  });
}

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
  const totalQty = (s.colors || []).reduce((sum, c) => sum + SIZES.reduce((s2, sz) => s2 + (Number(c.qty[sz]) || 0), 0), 0);
  el("infoTotalQty").textContent = totalQty ? totalQty.toLocaleString() : "-";

  const colorNames = (s.colors || []).map((c) => c.name).filter(Boolean);
  el("colorSelect").innerHTML = colorNames.length
    ? colorNames.map((c) => `<option value="${escapeAttr(c)}">${escapeAttr(c)}</option>`).join("")
    : `<option value="">-</option>`;
  selectedColor = colorNames[0] || "";

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
  el("sizeSelect").value = selectedSize;

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
          <td>${row.estConsumption}</td>
          <td><input class="actual-input" data-part="${partKey}" data-idx="${idx}" type="number" step="0.01" min="0" value="${row.actualConsumption}" placeholder="Enter actual" /></td>
          <td style="color:${color};" data-variance-cell="${partKey}-${idx}">${varianceText}</td>
          <td>${vendorCell}</td>
          <td>${billCell}</td>
          <td style="text-align:center;">${receivedCell}</td>
        </tr>
      `;
    })
    .join("");
  return `
    <table class="comp-table">
      <thead>
        <tr>
          <th style="width:90px;">Type</th>
          <th>Description</th>
          <th style="width:60px;">UOM</th>
          <th style="width:100px;">Est. Consumption</th>
          <th style="width:130px;">Actual Consumption</th>
          <th style="width:80px;">Variance</th>
          <th style="width:110px;">Vendor</th>
          <th style="width:100px;">Bill No.</th>
          <th style="width:70px;">Received</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
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

el("sizeSelect").addEventListener("change", (e) => {
  selectedSize = e.target.value;
  if (currentStyle) {
    buildActualLines();
    renderPartsActual();
  }
});

el("colorSelect").addEventListener("change", (e) => {
  selectedColor = e.target.value;
});

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
        .map((l) => `${escapeAttr(l.part ? PART_LABELS[l.part] + " - " : "")}${escapeAttr(l.description)}: ${l.actualConsumption} ${escapeAttr(l.uom)} (est. ${l.estConsumption})`)
        .join(" · ");
      return `<div class="hist-item"><strong>${e.productionDate || "-"}</strong> · ${escapeAttr(e.color || "-")} / Size ${escapeAttr(e.size || "-")} · Produced ${e.actualProducedQty} pcs · Filled by ${escapeAttr(e.filledBy || "-")}<br/>${linesHtml}</div>`;
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
    size: selectedSize,
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
