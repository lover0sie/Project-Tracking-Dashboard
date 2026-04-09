/* App versioning checking */

const APP_VERSION = "2026-04-09-01"; /* Update here */
let versionTimer = null;

async function checkVersion() {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, {
      cache: "no-store"
    });

    if (!res.ok) return;

    const data = await res.json();
    const latest = String(data.version || "").trim();

    if (!latest) return;

    if (latest !== APP_VERSION) {
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
        A new version (${latestVersion}) is available.
      </div>
      <button id="btn-update-now">Refresh</button>
    </div>
  `;

  document.body.appendChild(div);

  document.getElementById("btn-update-now").onclick = () => {
    window.location.reload();
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