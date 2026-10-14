import { DiscordSDK } from "@discord/embedded-app-sdk";

const state = { user: null, admin: false, dashboard: null, selectedStoreId: null, section: "hours", token: null, discordSdk: null };

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const initials = (name) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

function monday(date = new Date()) {
  const copy = new Date(date);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - ((day + 6) % 7));
  const year = copy.getFullYear();
  const month = String(copy.getMonth() + 1).padStart(2, "0");
  const datePart = String(copy.getDate()).padStart(2, "0");
  return `${year}-${month}-${datePart}`;
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
  const response = await fetch(url, { ...options, headers });
  let data = null;
  try { data = await response.json(); } catch { /* no JSON */ }
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
}

let toastTimer;
function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = "toast"; }, 3000);
}

async function init() {
  $("#week-picker").value = monday();
  try {
    const config = await request("/api/config");
    if (config.demoMode && !new URLSearchParams(location.search).has("frame_id")) {
      const demo = await request("/api/auth/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      state.token = demo.app_token;
    } else {
      if (!config.clientId) throw new Error("The Discord Application ID is not configured.");
      state.discordSdk = new DiscordSDK(config.clientId);
      await state.discordSdk.ready();
      $("#connection-message").textContent = "Authorizing your Discord account…";
      const { code } = await state.discordSdk.commands.authorize({
        client_id: config.clientId,
        response_type: "code",
        state: "",
        prompt: "none",
        scope: ["identify"],
      });
      const exchange = await request("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const authenticated = await state.discordSdk.commands.authenticate({ access_token: exchange.access_token });
      if (!authenticated) throw new Error("Discord could not authenticate this Activity.");
      state.token = exchange.app_token;
    }
    const auth = await request("/api/me");
    state.user = auth.user;
    state.admin = auth.admin;
    $("#login-view").classList.add("hidden");
    $("#app-view").classList.remove("hidden");
    $("#user-name").textContent = auth.user.username;
    $("#user-role").textContent = auth.admin ? "Administrator" : "Shop manager";
    $("#user-avatar").textContent = initials(auth.user.username);
    $("#admin-nav").classList.toggle("hidden", !auth.admin);
    await loadDashboard();
  } catch (error) {
    $("#connection-message").textContent = error.message || "Time Keeper could not connect to Discord.";
    $(".connection-loader").classList.add("hidden");
    $("#retry-connection").classList.remove("hidden");
    toast(error.message, true);
  }
}

async function loadDashboard(preferredStore = state.selectedStoreId) {
  const week = $("#week-picker").value;
  $("#hours-content").innerHTML = "Loading your shop…";
  state.dashboard = await request(`/api/dashboard?week=${encodeURIComponent(week)}`);
  const stores = state.dashboard.stores;
  state.selectedStoreId = stores.some((store) => store.id === preferredStore) ? preferredStore : stores[0]?.id;
  renderStoreTabs();
  renderHours();
  renderAdmin();
}

function currentStore() {
  return state.dashboard?.stores.find((store) => store.id === state.selectedStoreId);
}

function renderStoreTabs() {
  const tabs = $("#store-tabs");
  if (!state.dashboard?.stores.length) {
    tabs.innerHTML = "";
    return;
  }
  tabs.innerHTML = state.dashboard.stores.map((store) => `<button class="store-tab ${store.id === state.selectedStoreId ? "active" : ""}" data-store-id="${store.id}">${escapeHtml(store.name)}</button>`).join("");
  $$(".store-tab", tabs).forEach((button) => button.addEventListener("click", () => {
    state.selectedStoreId = Number(button.dataset.storeId);
    renderStoreTabs();
    renderHours();
  }));
}

function employeeRow(employee, cover = false) {
  return `<div class="employee-row ${cover ? "cover-row" : ""}" data-employee-id="${employee.id}">
    <div class="employee-name">
      <span class="initials">${escapeHtml(initials(employee.name))}</span>
      <div><strong>${escapeHtml(employee.name)}</strong><span>${cover ? `Home shop: ${escapeHtml(employee.home_store_name)}` : "Regular team member"}</span></div>
    </div>
    <div class="hours-input"><input aria-label="Hours for ${escapeHtml(employee.name)}" type="number" min="0" max="168" step="0.25" value="${Number(employee.hours) || 0}" /><span>hrs</span></div>
    <div class="row-status">${cover ? `<button class="remove-cover" data-remove-cover="${employee.id}">Remove cover</button>` : employee.updated_at ? "Saved this week" : "Not entered yet"}</div>
  </div>`;
}

function renderHours() {
  const store = currentStore();
  if (!store) {
    $("#hours-content").innerHTML = `<div class="empty-state"><div><strong>No shop assigned yet.</strong><p>${state.admin ? "Use Shop setup to create or assign a shop." : "Ask an administrator to connect your Discord account to a shop."}</p></div></div>`;
    return;
  }
  const total = [...store.employees, ...store.covers].reduce((sum, person) => sum + Number(person.hours || 0), 0);
  const managerText = store.managers.length ? store.managers.map((manager) => manager.display_name).join(", ") : "No manager assigned";
  $("#hours-content").innerHTML = `
    <div class="shop-hero">
      <div class="shop-icon">⌂</div>
      <div><h3>${escapeHtml(store.name)}</h3><p>Manager${store.managers.length === 1 ? "" : "s"}: ${escapeHtml(managerText)}</p></div>
      <div class="hero-total"><strong>${total.toFixed(total % 1 ? 2 : 0)}</strong><span>team hours</span></div>
    </div>
    <div class="hours-panel">
      <div class="panel-head"><div><h4>Regular team</h4><p>${store.employees.length} of 8 roster spots used</p></div></div>
      <div>${store.employees.length ? store.employees.map((employee) => employeeRow(employee)).join("") : `<div class="empty-row">No regular employees assigned to this shop.</div>`}</div>
      <div class="panel-head"><div><h4>Covering this week</h4><p>Employees borrowed from another shop</p></div><button id="add-cover" class="button button-secondary">+ Add cover</button></div>
      <div>${store.covers.length ? store.covers.map((employee) => employeeRow(employee, true)).join("") : `<div class="empty-row">No cover employees added for this week.</div>`}</div>
      <div class="panel-actions"><button id="save-hours" class="button button-primary save-button">Save all hours</button></div>
    </div>`;
  $("#add-cover").addEventListener("click", openCoverDialog);
  $("#save-hours").addEventListener("click", saveAllHours);
  $$('[data-remove-cover]').forEach((button) => button.addEventListener("click", () => removeCover(Number(button.dataset.removeCover))));
}

async function saveAllHours() {
  const store = currentStore();
  const button = $("#save-hours");
  const rows = $$(".employee-row", $("#hours-content"));
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    for (const row of rows) {
      await request("/api/hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.id, employeeId: Number(row.dataset.employeeId), weekStart: $("#week-picker").value, hours: Number($("input", row).value) }),
      });
    }
    await loadDashboard(store.id);
    toast("Hours saved for the whole team.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Save all hours";
  }
}

function openCoverDialog() {
  const store = currentStore();
  const existing = new Set(store.covers.map((person) => person.id));
  const options = state.dashboard.allEmployees.filter((employee) => employee.home_store_id !== store.id && !existing.has(employee.id));
  $("#cover-shop-name").textContent = store.name;
  $("#cover-employee").innerHTML = options.length
    ? options.map((employee) => `<option value="${employee.id}">${escapeHtml(employee.name)} — ${escapeHtml(employee.home_store_name)}</option>`).join("")
    : `<option value="">No employees available from another shop</option>`;
  $("#cover-form").dataset.storeId = store.id;
  $("#cover-dialog").showModal();
}

async function addCover(event) {
  event.preventDefault();
  const employeeId = Number($("#cover-employee").value);
  if (!employeeId) return toast("Add employees to another shop first.", true);
  try {
    await request("/api/hours", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: Number(event.currentTarget.dataset.storeId), employeeId, weekStart: $("#week-picker").value, hours: Number($("#cover-hours").value) }),
    });
    $("#cover-dialog").close();
    await loadDashboard(state.selectedStoreId);
    toast("Cover employee added.");
  } catch (error) { toast(error.message, true); }
}

async function removeCover(employeeId) {
  const store = currentStore();
  try {
    await request(`/api/hours/${store.id}/cover`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, weekStart: $("#week-picker").value }),
    });
    await loadDashboard(store.id);
    toast("Cover employee removed.");
  } catch (error) { toast(error.message, true); }
}

function renderAdmin() {
  if (!state.admin || !state.dashboard) return;
  const options = state.dashboard.stores.map((store) => `<option value="${store.id}">${escapeHtml(store.name)}</option>`).join("");
  $$(".store-select").forEach((select) => { select.innerHTML = options; });
  $("#roster-overview").innerHTML = `<div class="overview-head"><h4>Shop overview</h4></div><div class="overview-shops">
    ${state.dashboard.stores.map((store) => `<div class="overview-shop"><h5>${escapeHtml(store.name)}</h5><p>${store.employees.length} / 8 regular employees</p>
      ${store.managers.map((manager) => `<div class="mini-person"><span>${escapeHtml(manager.display_name)}</span><span class="manager-chip">Manager</span></div>`).join("") || `<div class="mini-person"><span>No manager assigned</span></div>`}
      ${store.employees.map((employee) => `<div class="mini-person"><span>${escapeHtml(employee.name)}</span><span>${Number(employee.hours) || 0} hrs</span></div>`).join("") || `<div class="mini-person"><span>No employees yet</span></div>`}
    </div>`).join("")}
  </div>`;
}

async function submitAdminForm(event, type) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  let url = "/api/stores";
  let payload = values;
  if (type === "employee") url = "/api/employees";
  if (type === "manager") {
    url = `/api/stores/${values.storeId}/managers`;
    payload = { displayName: values.displayName, discordId: values.discordId };
  }
  try {
    await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    form.reset();
    await loadDashboard();
    toast(type === "shop" ? "Shop added." : type === "employee" ? "Employee added." : "Manager assigned.");
  } catch (error) { toast(error.message, true); }
}

function switchSection(section) {
  state.section = section;
  $("#hours-section").classList.toggle("hidden", section !== "hours");
  $("#admin-section").classList.toggle("hidden", section !== "admin");
  $("#page-title").textContent = section === "hours" ? "Weekly hours" : "Shop setup";
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.section === section));
  $(".sidebar").classList.remove("open");
}

function changeWeek(days) {
  const [year, month, day] = $("#week-picker").value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  $("#week-picker").value = monday(date);
  loadDashboard().catch((error) => toast(error.message, true));
}

$("#prev-week").addEventListener("click", () => changeWeek(-7));
$("#next-week").addEventListener("click", () => changeWeek(7));
$("#week-picker").addEventListener("change", (event) => {
  event.currentTarget.value = monday(new Date(`${event.currentTarget.value}T12:00:00`));
  loadDashboard().catch((error) => toast(error.message, true));
});
$("#cover-form").addEventListener("submit", addCover);
$("#shop-form").addEventListener("submit", (event) => submitAdminForm(event, "shop"));
$("#employee-form").addEventListener("submit", (event) => submitAdminForm(event, "employee"));
$("#manager-form").addEventListener("submit", (event) => submitAdminForm(event, "manager"));
$("#menu-button").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
$("#retry-connection").addEventListener("click", () => location.reload());
$$(".nav-item").forEach((button) => button.addEventListener("click", () => switchSection(button.dataset.section)));

init();
