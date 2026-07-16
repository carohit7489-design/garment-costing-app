let currentStyle = null;
let actualLines = []; // [{ componentIdx, description, uom, estConsumption, actualConsumption }]

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
        <div class="smeta">${escapeAttr(s.buyer || "-")} · MOQ ${s.orderQty} · ${s.componentCount} components · ${s.actualsCount} production entries</div>
      `;
      li.addEventListener("click", () => openStyle(s.id));
      list.appendChild(li);
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
  el("infoMoq").textContent = s.orderQty ? s.orderQty.toLocaleString() : "-";

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

  actualLines = s.components.map((c, idx) => ({
    componentIdx: idx,
    category: c.category,
    description: c.description,
    uom: c.uom,
    estConsumption: Number(c.consumption) || 0,
    actualConsumption: "",
  }));

  renderActualTable();
  renderHistory();
  loadStyleList(id);
}

function renderActualTable() {
  const body = el("actualRows");
  body.innerHTML = "";
  actualLines.forEach((row, idx) => {
    const variance = row.actualConsumption === "" ? null : Number(row.actualConsumption) - row.estConsumption;
    const varianceText = variance === null ? "-" : (variance > 0 ? "+" : "") + variance.toFixed(2);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeAttr(row.category)}</td>
      <td>${escapeAttr(row.description)}</td>
      <td>${escapeAttr(row.uom)}</td>
      <td>${row.estConsumption}</td>
      <td><input class="actual-input" data-idx="${idx}" type="number" step="0.01" min="0" value="${row.actualConsumption}" placeholder="Enter actual" /></td>
      <td style="color:${variance > 0 ? '#c0392b' : variance < 0 ? '#1a7a3c' : '#64748b'};">${varianceText}</td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      actualLines[idx].actualConsumption = e.target.value;
      updateVarianceCell(idx);
    });
  });
}

function updateVarianceCell(idx) {
  const row = actualLines[idx];
  const variance = row.actualConsumption === "" ? null : Number(row.actualConsumption) - row.estConsumption;
  const varianceText = variance === null ? "-" : (variance > 0 ? "+" : "") + variance.toFixed(2);
  const cell = document.querySelector(`#actualRows tr:nth-child(${idx + 1}) td:last-child`);
  if (cell) {
    cell.textContent = varianceText;
    cell.style.color = variance > 0 ? "#c0392b" : variance < 0 ? "#1a7a3c" : "#64748b";
  }
}

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
        .map((l) => `${escapeAttr(l.description)}: ${l.actualConsumption} ${escapeAttr(l.uom)} (est. ${l.estConsumption})`)
        .join(" · ");
      return `<div class="hist-item"><strong>${e.productionDate || "-"}</strong> · Produced ${e.actualProducedQty} pcs · Filled by ${escapeAttr(e.filledBy || "-")}<br/>${linesHtml}</div>`;
    })
    .join("");
}

async function saveActuals() {
  if (!currentStyle) return;
  const incomplete = actualLines.some((l) => l.actualConsumption === "");
  if (incomplete && !confirm("Some components have no actual consumption entered. Save anyway?")) {
    return;
  }
  const payload = {
    filledBy: el("filledBy").value.trim(),
    productionDate: el("prodDate").value,
    actualProducedQty: Number(el("actualQty").value) || 0,
    lines: actualLines.map((l) => ({
      description: l.description,
      category: l.category,
      uom: l.uom,
      estConsumption: l.estConsumption,
      actualConsumption: Number(l.actualConsumption) || 0,
    })),
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
