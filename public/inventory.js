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

async function loadStyleList(selectId) {
  const res = await fetch("/api/styles");
  const styles = await res.json();
  const list = el("styleList");
  list.innerHTML = "";
  if (styles.length === 0) {
    list.innerHTML = '<li class="empty-state" style="cursor:default;">No styles yet.</li>';
    return;
  }
  styles
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .forEach((s) => {
      const li = document.createElement("li");
      li.className = s.id === selectId ? "active" : "";
      li.innerHTML = `
        <div class="sname">${escapeAttr(s.styleNo)} - ${escapeAttr(s.styleName)}</div>
        <div class="smeta">${escapeAttr(s.buyer || "-")} · ${s.totalPcs} pcs ordered</div>
        <div class="smeta" style="color:var(--navy); font-weight:bold;">Balance in hand: ${s.inventoryBalance}</div>
      `;
      li.addEventListener("click", () => openStyle(s.id));
      list.appendChild(li);
    });
}

async function openStyle(id) {
  const res = await fetch(`/api/styles/${id}`);
  if (!res.ok) return toast("Could not load style", true);
  const s = await res.json();
  currentStyle = s;

  el("emptyState").style.display = "none";
  el("detailContent").style.display = "block";
  el("formTitle").textContent = `${s.styleNo} - ${s.styleName}`;

  el("saleQty").value = "";
  el("saleDate").value = new Date().toISOString().slice(0, 10);
  el("saleBuyer").value = "";
  el("saleReference").value = "";

  renderSaleForm(s.inventory);
  renderInventory(s.inventory);
  renderSalesHistory(s.sales || []);
  loadStyleList(id);
}

function renderSaleForm(inv) {
  if (inv.produced <= 0) {
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
  el("sumSold").textContent = inv.sold.toLocaleString();
  el("sumBalance").textContent = inv.balance.toLocaleString();
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

el("recordSaleBtn").addEventListener("click", recordSale);

loadStyleList(null);
