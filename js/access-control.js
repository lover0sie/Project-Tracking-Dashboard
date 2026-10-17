import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { doc, getDocFromServer, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

export const DASHBOARD_ROOT = new URL("../", import.meta.url);
const ROLE_LEVELS = { level1: 1, level2: 2, level3: 3 };
const PAGE_ROLES = {
  "index.html": "level1",
  "station.html": "level1",
  "processes.html": "level1",
  "acknowledgement.html": "level1",
  "line-balance.html": "level2",
  "chiller-cycle-time.html": "level2",
  "tree.html": "level3",
  "on-hold-cleanup.html": "level3",
  "extract.html": "level3",
  "ProductionProgress/index.html": "level3"
};
let cachedProfile = null;

export function normalizeRole(role) {
  const value = String(role || "").trim().toLowerCase().replace(/\s+/g, "");
  return Object.hasOwn(ROLE_LEVELS, value) ? value : "";
}

export function roleMeetsRequirement(role, requiredRole) {
  const required = ROLE_LEVELS[normalizeRole(requiredRole)];
  return Boolean(required && (ROLE_LEVELS[normalizeRole(role)] || 0) >= required);
}

export function getCachedUserProfile() {
  return cachedProfile;
}

export async function getSignedInUser() {
  await auth.authStateReady();
  return auth.currentUser;
}

export async function loadCurrentUserProfile({ reportErrors = false } = {}) {
  cachedProfile = null;
  const rejectProfile = (message, details = "") => {
    if (reportErrors) {
      const error = new Error(message);
      error.accessDetails = details;
      throw error;
    }
    return null;
  };
  const activeDetails = (path, data) => [
    `Checked document: ${path}`,
    `Stored active value: ${JSON.stringify(data.active) ?? "missing"}`,
    `Stored active type: ${typeof data.active}`,
    `Field names: ${JSON.stringify(Object.keys(data))}`
  ].join("\n");
  const user = await getSignedInUser();
  if (!user) return null;
  const userSnap = await getDocFromServer(doc(db, "users", user.uid));
  if (!userSnap.exists()) {
    return rejectProfile("Your email account has no linked user profile. Ask your administrator to match the users document ID to this Gmail account's Authentication UID.");
  }
  const mapping = userSnap.data();
  if (mapping.active !== true) {
    return rejectProfile("Your linked user profile is inactive or missing active: true. Contact your administrator.",
      activeDetails(`users/${user.uid}`, mapping));
  }
  const employeeId = mapping.employeeId;
  if (typeof employeeId !== "string" || !/^[A-Za-z0-9_-]+$/.test(employeeId)) {
    return rejectProfile("Your user profile needs a valid employeeId stored as text, for example 30369. Contact your administrator.");
  }
  const employeeSnap = await getDocFromServer(doc(db, "employees", employeeId));
  if (!employeeSnap.exists()) {
    return rejectProfile("The employee record linked to your account is missing. Ask your administrator to check the employees document ID.");
  }
  const employee = employeeSnap.data();
  const role = normalizeRole(employee.role);
  if (employee.active !== true) {
    return rejectProfile("Your employee record is inactive or missing active: true. Contact your administrator.",
      activeDetails(`employees/${employeeId}`, employee));
  }
  if (!role || employee.role !== role) {
    return rejectProfile("Your employee record needs a role of level1, level2, or level3. Contact your administrator.");
  }
  if (employee.employeeId !== employeeId) {
    return rejectProfile("Your employee record's employeeId must match its document ID and be stored as text. Contact your administrator.");
  }
  cachedProfile = { ...employee, uid: user.uid, employeeId, role };
  return cachedProfile;
}

export function redirectToLogin() {
  const target = new URL("login.html", DASHBOARD_ROOT);
  target.searchParams.set("return", window.location.pathname + window.location.search);
  window.location.replace(target.href);
}

export function safeReturnUrl(value) {
  const fallback = new URL("index.html", DASHBOARD_ROOT);
  try {
    const target = new URL(value || "index.html", DASHBOARD_ROOT);
    const page = target.pathname.slice(DASHBOARD_ROOT.pathname.length);
    if (target.origin === DASHBOARD_ROOT.origin && target.pathname.startsWith(DASHBOARD_ROOT.pathname)
      && Object.hasOwn(PAGE_ROLES, page)) return target;
  } catch {}
  return fallback;
}

export function assertExportAccess() {
  if (!auth.currentUser || cachedProfile?.uid !== auth.currentUser.uid
    || cachedProfile.active !== true || !roleMeetsRequirement(cachedProfile.role, "level2")) {
    throw new Error("Level 2 or Level 3 access is required to export data.");
  }
}

export async function assertLevel3Access() {
  const profile = await loadCurrentUserProfile();
  if (!profile || profile.role !== "level3") throw new Error("Level 3 access is required for this action.");
  return profile;
}

function applyRoleUi(profile) {
  document.querySelectorAll(".sideNavLink[href]").forEach(link => {
    const page = new URL(link.href).pathname.split("/").pop();
    link.hidden = page === "tree.html" || !roleMeetsRequirement(profile.role, PAGE_ROLES[page]);
  });
  document.querySelectorAll("#btn-export, #btnExportStationExcel, #exportStandardRawBtn, #exportCombinedRawBtn").forEach(button => {
    button.hidden = !roleMeetsRequirement(profile.role, "level2");
  });
}

function renderUserBar(profile) {
  const brand = document.querySelector(".sideNavBrand");
  if (brand) {
    const home = document.createElement("a");
    home.className = "sideNavBrandLink";
    home.href = new URL("index.html", DASHBOARD_ROOT).href;
    home.setAttribute("aria-label", "Project Tracking Dashboard home");
    home.innerHTML = `
      <span class="sideNavLogo" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">
          <path d="M4 4v16h16" />
          <path d="M8 7h6M11 12h8M8 17h9" />
        </svg>
      </span>
      <span>
        <span class="sideNavTitle">Project Tracking</span>
        <span class="sideNavSub">Dashboard</span>
      </span>
    `;
    brand.replaceChildren(home);
  }
  const bar = document.createElement("div");
  bar.className = "authUserBar";
  const details = document.createElement("div");
  details.className = "authUserDetails";
  const name = document.createElement("span");
  name.className = "authUserName";
  name.textContent = profile.name || "Signed in";
  name.title = name.textContent;
  const role = document.createElement("span");
  role.className = "authUserRole";
  role.dataset.level = profile.role;
  role.textContent = `Level ${ROLE_LEVELS[profile.role]}`;
  details.append(name, role);
  const logout = document.createElement("button");
  logout.type = "button";
  logout.textContent = "Sign Out";
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await signOut(auth);
      redirectToLogin();
    } catch {
      logout.disabled = false;
      logout.textContent = "Retry Sign Out";
    }
  });
  bar.append(details, logout);
  (document.querySelector(".sideNav") || document.body).appendChild(bar);
}

export async function initDashboardAccess() {
  const profile = await loadCurrentUserProfile();
  if (!profile) {
    await signOut(auth);
    redirectToLogin();
    return null;
  }
  const page = window.location.pathname.slice(DASHBOARD_ROOT.pathname.length) || "index.html";
  if (!roleMeetsRequirement(profile.role, PAGE_ROLES[page] || "level3")) {
    window.location.replace(new URL("index.html", DASHBOARD_ROOT).href);
    return null;
  }
  applyRoleUi(profile);
  renderUserBar(profile);
  const revoke = () => {
    cachedProfile = null;
    document.documentElement.removeAttribute("data-access-ready");
    window.location.reload();
  };
  onAuthStateChanged(auth, user => {
    if (user?.uid !== profile.uid) revoke();
  });
  onSnapshot(doc(db, "employees", profile.employeeId), snap => {
    const data = snap.data();
    if (!data || data.active !== true || normalizeRole(data.role) !== profile.role
      || data.employeeId !== profile.employeeId) revoke();
  }, revoke);
  onSnapshot(doc(db, "users", profile.uid), snap => {
    const data = snap.data();
    if (!data || data.active !== true || data.employeeId !== profile.employeeId) revoke();
  }, revoke);
  return profile;
}
