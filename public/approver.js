const SIZES = ["40", "42", "44", "46", "48", "50", "52"];
const PART_KEYS = ["kurta", "pant", "dupatta"];
const PART_LABELS = { kurta: "Kurta", pant: "Pant", dupatta: "Dupatta" };

let currentStyle = null;

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

function costOfRow(row) {
  return (Number(row.consumption) || 0) * (Number(row.rate) || 0);
}

function partCost(style, partKey) {
  const part = style.parts[partKey];
  if (!part.enabled) return 0;
  return part.components.reduce((sum, r) => sum + costOfRow(r), 0);
}

function grandCost(style) {
  return PART_KEYS.reduce((sum, k) => sum + partCost(style, k), 0);
}

function totalSellingRate(style) {
  return PART_KEYS.reduce((sum, k) => sum + (style.parts[k].enabled ? Number(style.parts[k].sellingRate) || 0 : 0), 0);
}

function totalPcs(style) {
  return (style.colors || []).reduce((sum, c) => sum + SIZES.reduce((s2, sz) => s2 + (Number(c.qty[sz]) || 0), 0), 0);
}

// ---- Style list ----

async function loadStyleList(selectId) {
  const res = await fetch("/api/styles");
  const styles = await res.json();
  const list = el("styleList");
  list.innerHTML = "";
  if (styles.length === 0) {
    list.innerHTML = '<li class="empty-state" style="cursor:default;">No styles yet.</li>';
    return;
  }
  const statusOrder = { "Sent for Approval": 0, "Not Sent": 1, Approved: 2, Rejected: 3 };
  styles
    .sort((a, b) => (statusOrder[a.designApprovalStatus] ?? 9) - (statusOrder[b.designApprovalStatus] ?? 9) || new Date(b.updatedAt) - new Date(a.updatedAt))
    .forEach((s) => {
      const li = document.createElement("li");
      li.className = s.id === selectId ? "active" : "";
      const color = s.designApprovalStatus === "Approved" ? "#1a7a3c" : s.designApprovalStatus === "Rejected" ? "var(--red)" : s.designApprovalStatus === "Sent for Approval" ? "#b8860b" : "var(--muted)";
      li.innerHTML = `
        <div class="sname">${escapeAttr(s.styleNo)} - ${escapeAttr(s.styleName)}</div>
        <div class="smeta">${escapeAttr(s.buyer || "-")} · ${escapeAttr(s.orderType)} · ${s.totalPcs} pcs</div>
        <div class="smeta" style="color:${color}; font-weight:bold;">${escapeAttr(s.designApprovalStatus)}</div>
      `;
      li.addEventListener("click", () => openStyle(s.id));
      list.appendChild(li);
    });
}

// ---- Review detail ----

async function openStyle(id) {
  const res = await fetch(`/api/styles/${id}`);
  if (res.status === 401) {
    showLogin("Your session expired. Please log in again.");
    return;
  }
  if (!res.ok) return toast("Could not load style", true);
  const s = await res.json();
  currentStyle = s;

  el("emptyState").style.display = "none";
  el("detailContent").style.display = "block";
  el("formTitle").textContent = `${s.styleNo} - ${s.styleName}`;
  el("infoStyleNo").textContent = s.styleNo;
  el("infoBuyer").textContent = s.buyer || "-";
  el("infoSeason").textContent = s.season || "-";
  el("infoOrderType").textContent = s.orderType || "-";
  el("infoPocket").textContent = s.pocket || "-";
  el("infoPatti").textContent = s.patti || "-";

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

  renderColorSizeTable(s);
  renderParts(s);
  renderCostSummary(s);
  renderDecision(s);
  loadStyleList(id);
}

function renderColorSizeTable(s) {
  el("colorSizeHead").innerHTML = `<th style="text-align:left;">Color</th>` + SIZES.map((sz) => `<th>${sz}</th>`).join("") + `<th>Total</th>`;
  const colors = s.colors || [];
  el("colorSizeBody").innerHTML = colors
    .map((c) => {
      const rowTotal = SIZES.reduce((sum, sz) => sum + (Number(c.qty[sz]) || 0), 0);
      return (
        `<tr><td style="text-align:left;">${escapeAttr(c.name)}</td>` +
        SIZES.map((sz) => `<td>${c.qty[sz] || 0}</td>`).join("") +
        `<td class="cost-cell">${rowTotal}</td></tr>`
      );
    })
    .join("");
  const sizeTotals = SIZES.map((sz) => colors.reduce((sum, c) => sum + (Number(c.qty[sz]) || 0), 0));
  const grandTotal = sizeTotals.reduce((a, b) => a + b, 0);
  el("colorSizeFoot").innerHTML =
    `<td style="text-align:left; font-weight:bold;">Total</td>` +
    sizeTotals.map((t) => `<td class="cost-cell">${t}</td>`).join("") +
    `<td class="cost-cell">${grandTotal}</td>`;
}

function renderParts(s) {
  const container = el("partsContainer");
  container.innerHTML = PART_KEYS.filter((key) => s.parts[key].enabled)
    .map((key) => {
      const part = s.parts[key];
      const rows = part.components
        .map(
          (row) => `
            <tr>
              <td>${escapeAttr(row.type)}</td>
              <td>${escapeAttr(row.description)}</td>
              <td>${escapeAttr(row.uom)}</td>
              <td>${row.rate}</td>
              <td>${row.consumption}</td>
              <td>${escapeAttr(row.vendor || "-")}</td>
              <td>${escapeAttr(row.billNo || "-")}</td>
              <td>${row.received ? "Yes" : "-"}</td>
            </tr>
          `
        )
        .join("");
      return `
        <div class="part-block">
          <div class="part-header"><label>${PART_LABELS[key]} - Selling Rate/Garment: ${s.currency} ${Number(part.sellingRate || 0).toFixed(2)}</label></div>
          <div class="table-scroll">
            <table class="comp-table">
              <thead>
                <tr>
                  <th>Type</th><th>Description</th><th>UOM</th><th>Rate</th><th>Consumption</th><th>Vendor</th><th>Bill No.</th><th>Received</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderCostSummary(s) {
  el("costSummaryHead").innerHTML = `<th style="text-align:left;">Part</th><th>Cost / Garment</th>`;
  const currency = s.currency || "";
  let rows = "";
  PART_KEYS.forEach((key) => {
    if (!s.parts[key].enabled) return;
    rows += `<tr><td style="text-align:left;">${PART_LABELS[key]}</td><td class="cost-cell">${partCost(s, key).toFixed(2)}</td></tr>`;
  });
  const cost = grandCost(s);
  const selling = totalSellingRate(s);
  rows += `<tr style="font-weight:bold; border-top:2px solid var(--navy);"><td style="text-align:left;">Total Cost / Garment</td><td class="cost-cell">${currency} ${cost.toFixed(2)}</td></tr>`;
  rows += `<tr><td style="text-align:left;">Selling Rate / Garment</td><td class="cost-cell">${currency} ${selling.toFixed(2)}</td></tr>`;
  rows += `<tr><td style="text-align:left;">Margin / Garment</td><td class="cost-cell">${currency} ${(selling - cost).toFixed(2)}</td></tr>`;
  el("costSummaryBody").innerHTML = rows;

  const qty = totalPcs(s);
  el("sumOrderQty").textContent = qty ? qty.toLocaleString() : "-";
  const totalCostValue = cost * qty;
  const totalSellingValue = selling * qty;
  el("sumCostValue").textContent = qty ? `${currency} ${totalCostValue.toFixed(2)}` : "-";
  el("sumSellingValue").textContent = qty ? `${currency} ${totalSellingValue.toFixed(2)}` : "-";
  el("sumMargin").textContent = qty ? `${currency} ${(totalSellingValue - totalCostValue).toFixed(2)}` : "-";
}

function renderDecision(s) {
  const status = s.designApproval.status;
  el("decisionPending").style.display = status === "Sent for Approval" ? "block" : "none";
  el("decisionDone").style.display = status === "Approved" || status === "Rejected" ? "block" : "none";
  el("notSentState").style.display = status === "Not Sent" ? "block" : "none";

  if (status === "Sent for Approval") {
    el("approverName").value = "";
    el("approverRemarks").value = "";
  } else if (status === "Approved" || status === "Rejected") {
    el("decisionStatus").textContent = status;
    el("decisionStatus").style.color = status === "Approved" ? "#1a7a3c" : "var(--red)";
    el("decisionApprover").textContent = s.designApproval.approverName || "-";
    el("decisionDate").textContent = s.designApproval.date || "-";
    el("decisionRemarksWrap").style.display = s.designApproval.remarks ? "" : "none";
    el("decisionRemarksText").textContent = s.designApproval.remarks || "";
  }
}

async function decide(status) {
  if (!currentStyle) return;
  const res = await fetch(`/api/styles/${currentStyle.id}/design-approval`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status,
      approverName: el("approverName").value.trim(),
      remarks: el("approverRemarks").value.trim(),
    }),
  });
  if (res.status === 401) {
    showLogin("Your session expired. Please log in again.");
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast(err.error || "Could not save decision", true);
    return;
  }
  toast(`Style ${status.toLowerCase()}`);
  openStyle(currentStyle.id);
}

el("approveBtn").addEventListener("click", () => decide("Approved"));
el("rejectBtn").addEventListener("click", () => decide("Rejected"));

// ---- Approver login gate ----

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
  const res = await fetch("/api/approver/session");
  const data = await res.json();
  if (data.authenticated) {
    showApp();
    loadStyleList(null);
  } else {
    showLogin();
  }
}

el("loginBtn").addEventListener("click", async () => {
  const password = el("loginPassword").value;
  const res = await fetch("/api/approver/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.ok) {
    el("loginPassword").value = "";
    showApp();
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
  await fetch("/api/approver/logout", { method: "POST" });
  showLogin();
});

checkAuthAndInit();
