import { initDashboardAccess } from "./access-control.js";

try {
  const profile = await initDashboardAccess();
  if (profile) {
    for (const placeholder of document.querySelectorAll('script[type="dashboard-module"]')) {
      const script = document.createElement("script");
      script.type = "module";
      if (!placeholder.hasAttribute("src")) {
        script.textContent = placeholder.textContent;
        placeholder.replaceWith(script);
        continue;
      }
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
        script.src = placeholder.getAttribute("src");
        placeholder.replaceWith(script);
      });
    }
    document.documentElement.setAttribute("data-access-ready", "true");
  }
} catch (error) {
  console.error("Dashboard access failed", error);
  document.body.replaceChildren();
  const message = document.createElement("p");
  message.textContent = "Unable to open the dashboard. Check your connection or contact your administrator, then reload this page.";
  const login = document.createElement("a");
  login.href = new URL("../login.html", import.meta.url).href;
  login.textContent = "Return to login";
  document.body.append(message, login);
  document.documentElement.setAttribute("data-access-ready", "true");
}
