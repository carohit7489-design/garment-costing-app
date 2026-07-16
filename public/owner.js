const CATEGORIES = ["Fabric", "Trim", "CM", "Overhead", "Other"];

let currentStyleId = null; // null = creating a new style
let components = [];
let existingDesignImagePath = null; // design image already saved on the server, if any
let removeImageRequested = false;

const el = (id) => document.getElementById(id);

function toast(msg, isError) {
  const t = el("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => (t.className = "toast"), 2500);
}

function newComponentRow() {
  return { category: "Fabric", description: "", consumption: 0, uom: "Mtr", rate: 0, wastagePct: 0 };
}

function costOf(row) {
  const cons = Number(row.consumption) || 0;
  const rate = Number(row.rate) || 0;
  const waste = Number(row.wastagePct) || 0;
  return cons * rate * (1 + waste / 100);
}

function renderComponents() {
  const body = el("compRows");
  body.innerHTML = "";
  components.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <select data-idx="${idx}" data-field="category">
          ${CATEGORIES.map((c) => `<option value="${c}" ${c === row.category ? "selected" : ""}>${c}</option>`).join("")}
        </select>
      </td>
      <td><input data-idx="${idx}" data-field="description" value="${escapeAttr(row.description)}" placeholder="e.g. Self Fabric - Rayon" /></td>
      <td><input data-idx="${idx}" data-field="consumption" type="number" step="0.01" min="0" value="${row.consumption}" /></td>
      <td><input data-idx="${idx}" data-field="uom" value="${escapeAttr(row.uom)}" placeholder="Mtr/Pcs" /></td>
      <td><input data-idx="${idx}" data-field="rate" type="number" step="0.01" min="0" value="${row.rate}" /></td>
      <td><input data-idx="${idx}" data-field="wastagePct" type="number" step="0.1" min="0" value="${row.wastagePct}" /></td>
      <td class="cost-cell">${costOf(row).toFixed(2)}</td>
      <td><button class="btn-small" data-idx="${idx}" data-action="remove">✕</button></td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      let val = e.target.value;
      if (["consumption", "rate", "wastagePct"].includes(field)) val = Number(val) || 0;
      components[idx][field] = val;
      updateRowCost(idx);
      updateTotals();
    });
  });

  body.querySelectorAll('button[data-action="remove"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.idx);
      components.splice(idx, 1);
      renderComponents();
      renderSummary();
    });
  });

  updateTotals();
}

function updateRowCost(idx) {
  const row = document.querySelector(`#compRows tr:nth-child(${idx + 1}) td.cost-cell`);
  if (row) row.textContent = costOf(components[idx]).toFixed(2);
}

function updateTotals() {
  const total = components.reduce((sum, r) => sum + costOf(r), 0);
  el("totalPerGarment").textContent = total.toFixed(2);
  renderSummary();
}

function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

function renderSummary() {
  const total = components.reduce((sum, r) => sum + costOf(r), 0);
  const qty = Number(el("orderQty").value) || 0;
  const currency = el("currency").value || "";
  el("sumPerGarment").textContent = `${currency} ${total.toFixed(2)}`;
  el("sumOrderQty").textContent = qty ? qty.toLocaleString() : "-";
  el("sumTotalValue").textContent = `${currency} ${(total * qty).toFixed(2)}`;
}

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
  components = s.components.length ? s.components : [newComponentRow()];
  el("formTitle").textContent = `Editing: ${s.styleNo} - ${s.styleName}`;
  el("statusText").textContent = `Created ${new Date(s.createdAt).toLocaleString()} · Last updated ${new Date(s.updatedAt).toLocaleString()}`;
  renderComponents();
  renderSummary();
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
  components = [newComponentRow()];
  el("formTitle").textContent = "New Style - Design & Component Sheet";
  el("statusText").textContent = "";
  renderComponents();
  renderSummary();
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
  const formData = new FormData();
  formData.append("styleNo", styleNo);
  formData.append("styleName", styleName);
  formData.append("buyer", el("buyer").value.trim());
  formData.append("season", el("season").value.trim());
  formData.append("orderQty", Number(el("orderQty").value) || 0);
  formData.append("currency", el("currency").value.trim() || "INR");
  formData.append("components", JSON.stringify(components.filter((c) => c.description.trim() !== "")));

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
el("addRowBtn").addEventListener("click", () => {
  components.push(newComponentRow());
  renderComponents();
  renderSummary();
});
el("saveBtn").addEventListener("click", saveStyle);
el("orderQty").addEventListener("input", renderSummary);
el("currency").addEventListener("input", renderSummary);

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
