/* App versioning checking */

const APP_VERSION = "2026-06-12-02"; /* Update here */
let versionTimer = null;
const VERSION_REFRESHED_KEY = "projectDashboardRefreshedVersion";

async function checkVersion() {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, {
      cache: "no-store"
    });

    if (!res.ok) return;

    const data = await res.json();
    const latest = String(data.version || "").trim();

    if (!latest) return;

    if (
      latest !== APP_VERSION &&
      localStorage.getItem(VERSION_REFRESHED_KEY) !== latest
    ) {
      showUpdatePopup(latest);
    }
  } catch (e) {
    console.warn("Version check failed", e);
  }
}

function showUpdatePopup(latestVersion) {
  if (document.getElementById("version-popup")) return;

  const div = document.createElement("div");
  div.id = "version-popup";
  div.innerHTML = `
    <div class="version-card">
      <div class="version-title">New Version Available</div>
      <div class="version-text">
        A new version <span class="version-badge">${latestVersion}</span> is available.
      </div>
      <button id="btn-update-now">Refresh</button>
    </div>
  `;

  document.body.appendChild(div);

  document.getElementById("btn-update-now").onclick = async () => {
    localStorage.setItem(VERSION_REFRESHED_KEY, latestVersion);

    const btn = document.getElementById("btn-update-now");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Refreshing...";
    }

    document.getElementById("version-popup")?.remove();

    if ("caches" in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      } catch (err) {
        console.warn("Cache clear failed", err);
      }
    }

    if ("serviceWorker" in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(registration => registration.unregister()));
      } catch (err) {
        console.warn("Service worker unregister failed", err);
      }
    }

    const url = new URL(window.location.href);
    url.searchParams.set("appVersion", latestVersion);
    url.searchParams.set("refreshAt", Date.now());
    window.location.replace(url.toString());
  };
}

export function startVersionCheck() {
  checkVersion();
  versionTimer = setInterval(checkVersion, 60000); // every 1 min
}

export function stopVersionCheck() {
  if (versionTimer) {
    clearInterval(versionTimer);
    versionTimer = null;
  }
}
