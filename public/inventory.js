let currentStyle = null;
let producedCombos = []; // [{color, size, balance}] - only combos production has actually logged

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

  // Only combinations production actually logged (produced > 0) - selling
  // a size/color that was never produced is exactly the bug this fixes.
  producedCombos = s.inventory.bySizeColor.filter((r) => r.produced > 0);

  el("saleQty").value = "";
  el("saleDate").value = new Date().toISOString().slice(0, 10);
  el("saleBuyer").value = "";
  el("saleReference").value = "";

  renderSaleForm();
  renderInventory(s.inventory);
  renderSalesHistory(s.sales || []);
  loadStyleList(id);
}

function renderSaleForm() {
  if (producedCombos.length === 0) {
    el("saleForm").style.display = "none";
    el("saleFormEmptyState").style.display = "block";
    return;
  }
  el("saleForm").style.display = "block";
  el("saleFormEmptyState").style.display = "none";

  const colors = Array.from(new Set(producedCombos.map((r) => r.color)));
  el("saleColor").innerHTML = colors.map((c) => `<option value="${escapeAttr(c)}">${escapeAttr(c || "-")}</option>`).join("");
  populateSaleSizes();
}

function populateSaleSizes() {
  const color = el("saleColor").value;
  const sizesForColor = producedCombos.filter((r) => r.color === color);
  el("saleSize").innerHTML = sizesForColor.map((r) => `<option value="${escapeAttr(r.size)}">${escapeAttr(r.size)}</option>`).join("");
  updateAvailableHint();
}

function updateAvailableHint() {
  const color = el("saleColor").value;
  const size = el("saleSize").value;
  const combo = producedCombos.find((r) => r.color === color && r.size === size);
  el("saleAvailableHint").textContent = combo ? `(Available: ${combo.balance})` : "";
}

el("saleColor").addEventListener("change", populateSaleSizes);
el("saleSize").addEventListener("change", updateAvailableHint);

function renderInventory(inv) {
  el("sumProduced").textContent = inv.produced.toLocaleString();
  el("sumSold").textContent = inv.sold.toLocaleString();
  el("sumBalance").textContent = inv.balance.toLocaleString();

  if (inv.bySizeColor.length === 0) {
    el("inventoryTable").style.display = "none";
    el("inventoryEmptyState").style.display = "block";
    return;
  }
  el("inventoryTable").style.display = "";
  el("inventoryEmptyState").style.display = "none";

  el("inventoryBody").innerHTML = inv.bySizeColor
    .map((r) => {
      const lowColor = r.balance <= 0 ? "var(--red)" : r.balance < r.produced * 0.2 ? "#b8860b" : "#1a7a3c";
      return `
        <tr>
          <td style="text-align:left;">${escapeAttr(r.color || "-")}</td>
          <td>${escapeAttr(r.size)}</td>
          <td>${r.produced}</td>
          <td>${r.sold}</td>
          <td style="font-weight:bold; color:${lowColor};">${r.balance}</td>
        </tr>
      `;
    })
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
          <strong>${escapeAttr(s.date)}</strong> · ${escapeAttr(s.color)} / Size ${escapeAttr(s.size)} · Sold ${s.qtySold} pcs
          ${s.buyer ? ` · ${escapeAttr(s.buyer)}` : ""}${s.reference ? ` · Ref: ${escapeAttr(s.reference)}` : ""}
        </div>
      `
    )
    .join("");
}

async function recordSale() {
  if (!currentStyle) return;
  const color = el("saleColor").value;
  const size = el("saleSize").value;
  const qtySold = Number(el("saleQty").value);
  const combo = producedCombos.find((r) => r.color === color && r.size === size);
  if (!combo) {
    toast("No produced color/size to sell against", true);
    return;
  }
  if (!qtySold || qtySold <= 0) {
    toast("Enter a valid quantity sold", true);
    return;
  }

  if (qtySold > combo.balance) {
    const proceed = confirm(`Only ${combo.balance} in stock for ${color || "-"} / ${size}. Record this sale of ${qtySold} anyway?`);
    if (!proceed) return;
  }

  const payload = {
    color,
    size,
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
  if (res.status === 401) {
    showLogin("Your session expired. Please log in again.");
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast(err.error || "Could not record sale", true);
    return;
  }
  toast("Sale recorded");
  openStyle(currentStyle.id);
}

el("recordSaleBtn").addEventListener("click", recordSale);

// ---- Owner login gate (shares the owner login/session) ----

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
