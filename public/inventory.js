let currentStyle = null;
let allStyles = [];
let selectedStyleId = null;

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
  allStyles = await res.json();
  selectedStyleId = selectId;
  renderStyleList();
  renderSummaryDashboard();
}

function renderSummaryDashboard() {
  if (allStyles.length === 0) {
    el("summaryTable").style.display = "none";
    el("summaryEmptyState").style.display = "block";
    el("dashTotalStyles").textContent = "0";
    el("dashTotalProduced").textContent = "-";
    el("dashTotalSold").textContent = "-";
    el("dashTotalBalance").textContent = "-";
    return;
  }
  el("summaryTable").style.display = "";
  el("summaryEmptyState").style.display = "none";

  const styles = allStyles.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  el("summaryBody").innerHTML = styles
    .map((s) => {
      const lowColor = s.inventoryBalance <= 0 ? "var(--red)" : "#1a7a3c";
      return `
        <tr data-style-id="${s.id}" style="cursor:pointer;">
          <td style="text-align:left;">${escapeAttr(s.styleNo)} - ${escapeAttr(s.styleName)}</td>
          <td style="text-align:left;">${escapeAttr(s.buyer || "-")}</td>
          <td>${s.inventoryProduced.toLocaleString()}</td>
          <td>${s.inventorySold.toLocaleString()}</td>
          <td style="font-weight:bold; color:${lowColor};">${s.inventoryBalance.toLocaleString()}</td>
        </tr>
      `;
    })
    .join("");

  const totals = styles.reduce(
    (acc, s) => ({
      produced: acc.produced + s.inventoryProduced,
      sold: acc.sold + s.inventorySold,
      balance: acc.balance + s.inventoryBalance,
    }),
    { produced: 0, sold: 0, balance: 0 }
  );
  el("dashTotalStyles").textContent = styles.length.toLocaleString();
  el("dashTotalProduced").textContent = totals.produced.toLocaleString();
  el("dashTotalSold").textContent = totals.sold.toLocaleString();
  el("dashTotalBalance").textContent = totals.balance.toLocaleString();
}

function renderStyleList() {
  const list = el("styleList");
  list.innerHTML = "";

  if (allStyles.length === 0) {
    list.innerHTML = '<li class="empty-state" style="cursor:default;">No styles yet.</li>';
    return;
  }

  const search = el("styleSearch").value.trim().toLowerCase();
  let styles = allStyles.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  if (search) {
    styles = styles.filter((s) =>
      [s.styleNo, s.styleName, s.buyer].some((v) => String(v || "").toLowerCase().includes(search))
    );
  }

  if (styles.length === 0) {
    list.innerHTML = '<li class="empty-state" style="cursor:default;">No styles match.</li>';
    return;
  }

  styles.forEach((s) => {
    const li = document.createElement("li");
    li.className = s.id === selectedStyleId ? "active" : "";
    li.innerHTML = `
      <div class="sname">${escapeAttr(s.styleNo)} - ${escapeAttr(s.styleName)}</div>
      <div class="smeta">${escapeAttr(s.buyer || "-")} · ${s.totalPcs} pcs ordered</div>
      <div class="smeta" style="color:var(--navy); font-weight:bold;">Balance in store: ${s.inventoryBalance}</div>
    `;
    li.addEventListener("click", () => openStyle(s.id));
    list.appendChild(li);
  });
}

el("styleSearch").addEventListener("input", renderStyleList);

async function openStyle(id) {
  const res = await fetch(`/api/styles/${id}`);
  if (!res.ok) return toast("Could not load style", true);
  const s = await res.json();
  currentStyle = s;

  el("emptyState").style.display = "none";
  el("detailContent").style.display = "block";
  el("formTitle").textContent = `${s.styleNo} - ${s.styleName}`;

  el("transferQty").value = "";
  el("transferDate").value = new Date().toISOString().slice(0, 10);
  el("transferRemarks").value = "";

  el("rejectQty").value = "";
  el("rejectDate").value = new Date().toISOString().slice(0, 10);
  el("rejectRemarks").value = "";

  el("saleQty").value = "";
  el("saleDate").value = new Date().toISOString().slice(0, 10);
  el("saleBuyer").value = "";
  el("saleReference").value = "";

  renderSaleForm(s.inventory);
  renderInventory(s.inventory);
  renderTransferHistory(s.transfers || []);
  renderRejectHistory(s.rejections || []);
  renderSalesHistory(s.sales || []);
  loadStyleList(id);
}

function renderSaleForm(inv) {
  if (inv.transferred <= 0) {
    el("saleForm").style.display = "none";
    el("saleFormEmptyState").style.display = "block";
    return;
  }
  el("saleForm").style.display = "block";
  el("saleFormEmptyState").style.display = "none";
  el("saleAvailableHint").textContent = `(Available: ${inv.balance})`;
}

function renderInventory(inv) {
  el("sumProduced").textContent = inv.produced.toLocaleString();
  el("sumTransferred").textContent = inv.transferred.toLocaleString();
  el("sumRejected").textContent = inv.rejected.toLocaleString();
  el("sumSold").textContent = inv.sold.toLocaleString();
  el("sumBalance").textContent = inv.balance.toLocaleString();
}

function renderTransferHistory(transfers) {
  const container = el("transferHistoryList");
  if (transfers.length === 0) {
    container.innerHTML = '<div class="empty-state">No transfers recorded yet for this style.</div>';
    return;
  }
  container.innerHTML = transfers
    .slice()
    .reverse()
    .map(
      (t) => `
        <div class="hist-item">
          <strong>${escapeAttr(t.date)}</strong> · Transferred ${t.qty} pcs
          ${t.remarks ? ` · ${escapeAttr(t.remarks)}` : ""}
        </div>
      `
    )
    .join("");
}

function renderRejectHistory(rejections) {
  const container = el("rejectHistoryList");
  if (rejections.length === 0) {
    container.innerHTML = '<div class="empty-state">No rejections recorded yet for this style.</div>';
    return;
  }
  container.innerHTML = rejections
    .slice()
    .reverse()
    .map(
      (r) => `
        <div class="hist-item">
          <strong>${escapeAttr(r.date)}</strong> · Rejected ${r.qty} pcs
          ${r.remarks ? ` · ${escapeAttr(r.remarks)}` : ""}
        </div>
      `
    )
    .join("");
}

function renderSalesHistory(sales) {
  const container = el("salesHistoryList");
  if (sales.length === 0) {
    container.innerHTML = '<div class="empty-state">No sales recorded yet for this style.</div>';
    return;
  }
  container.innerHTML = sales
    .slice()
    .reverse()
    .map(
      (s) => `
        <div class="hist-item">
          <strong>${escapeAttr(s.date)}</strong> · Sold ${s.qtySold} pcs
          ${s.buyer ? ` · ${escapeAttr(s.buyer)}` : ""}${s.reference ? ` · Ref: ${escapeAttr(s.reference)}` : ""}
        </div>
      `
    )
    .join("");
}

async function recordTransfer() {
  if (!currentStyle) return;
  const qty = Number(el("transferQty").value);
  if (!qty || qty <= 0) {
    toast("Enter a valid quantity", true);
    return;
  }
  const payload = {
    qty,
    date: el("transferDate").value,
    remarks: el("transferRemarks").value.trim(),
  };
  const res = await fetch(`/api/styles/${currentStyle.id}/transfers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast(err.error || "Could not record transfer", true);
    return;
  }
  toast("Transfer recorded");
  openStyle(currentStyle.id);
}

async function recordReject() {
  if (!currentStyle) return;
  const qty = Number(el("rejectQty").value);
  if (!qty || qty <= 0) {
    toast("Enter a valid quantity", true);
    return;
  }
  const payload = {
    qty,
    date: el("rejectDate").value,
    remarks: el("rejectRemarks").value.trim(),
  };
  const res = await fetch(`/api/styles/${currentStyle.id}/rejections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast(err.error || "Could not record rejection", true);
    return;
  }
  toast("Rejection recorded");
  openStyle(currentStyle.id);
}

async function recordSale() {
  if (!currentStyle) return;
  const qtySold = Number(el("saleQty").value);
  if (!qtySold || qtySold <= 0) {
    toast("Enter a valid quantity sold", true);
    return;
  }

  const balance = currentStyle.inventory.balance;
  if (qtySold > balance) {
    const proceed = confirm(`Only ${balance} in stock. Record this sale of ${qtySold} anyway?`);
    if (!proceed) return;
  }

  const payload = {
    qtySold,
    date: el("saleDate").value,
    buyer: el("saleBuyer").value.trim(),
    reference: el("saleReference").value.trim(),
  };

  const res = await fetch(`/api/styles/${currentStyle.id}/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast(err.error || "Could not record sale", true);
    return;
  }
  toast("Sale recorded");
  openStyle(currentStyle.id);
}

el("recordTransferBtn").addEventListener("click", recordTransfer);
el("recordRejectBtn").addEventListener("click", recordReject);
el("recordSaleBtn").addEventListener("click", recordSale);

el("summaryBody").addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-style-id]");
  if (row) openStyle(row.dataset.styleId);
});

loadStyleList(null);
