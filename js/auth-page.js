import { app, auth } from "./firebase.js";
import { sendPasswordResetEmail, signInWithCustomToken, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { loadCurrentUserProfile, safeReturnUrl } from "./access-control.js?v=profile-check-3";

const form = document.getElementById("loginForm");
const status = document.getElementById("loginStatus");
const employeeInput = document.getElementById("loginEmployeeId");
const resetForm = document.getElementById("passwordResetForm");
const resetEmail = document.getElementById("resetEmail");
const showResetButton = document.getElementById("showPasswordResetBtn");
const employeePasswordLogin = httpsCallable(getFunctions(app, "asia-southeast1"), "employeePasswordLogin");
const accessDetails = document.getElementById("accountAccessDetails");
const accessInfo = document.getElementById("accountAccessInfo");
const target = safeReturnUrl(new URLSearchParams(window.location.search).get("return"));
const title = document.getElementById("loginTitle");
const description = document.getElementById("loginDescription");
const signInTitle = title.textContent;
const signInDescription = description.textContent;

function setBusy(busy, targetForm = form) {
  targetForm.querySelectorAll("button, input").forEach(control => { control.disabled = busy; });
}

function showPasswordReset(show) {
  title.textContent = show ? "Change Your Password" : signInTitle;
  description.textContent = show
    ? "Enter your registered email address to receive a password-reset link."
    : signInDescription;
  form.hidden = show;
  resetForm.hidden = !show;
  showResetButton.setAttribute("aria-expanded", String(show));
  document.getElementById("loginPassword").value = "";
  if (accessDetails) accessDetails.hidden = true;
  (show ? resetEmail : employeeInput).focus();
}

showResetButton.addEventListener("click", () => showPasswordReset(true));
document.getElementById("hidePasswordResetBtn").addEventListener("click", () => showPasswordReset(false));

document.querySelectorAll("[data-password-toggle]").forEach(button => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-pressed", String(show));
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
});

form?.addEventListener("submit", async event => {
  event.preventDefault();
  setBusy(true);
  status.textContent = "Signing in...";
  status.className = "authStatus";
  if (accessDetails) accessDetails.hidden = true;
  if (accessInfo) accessInfo.textContent = "";
  let signedInUid = "";
  try {
    const employeeId = employeeInput.value.trim().toUpperCase();
    const password = document.getElementById("loginPassword").value;
    if (!/^[A-Z0-9_-]{1,40}$/.test(employeeId)) throw new Error("Please enter a valid employee number.");
    const result = await employeePasswordLogin({ employeeId, password });
    if (typeof result.data?.token !== "string") throw new Error("Employee sign-in is unavailable. Contact your administrator.");
    const credential = await signInWithCustomToken(auth, result.data.token);
    signedInUid = credential.user.uid;
    const profile = await loadCurrentUserProfile({ reportErrors: true });
    if (!profile) {
      throw new Error("Your employee account is inactive or has not been configured. Contact your administrator.");
    }
    if (profile.employeeId !== employeeId) throw new Error("Your account is not linked to this employee number. Contact your administrator.");
    window.location.replace(target.href);
  } catch (error) {
    if (signedInUid && accessDetails && accessInfo) {
      accessInfo.textContent = [
        "Password accepted. Employee access check failed.",
        `Firebase project: ${auth.app.options.projectId}`,
        `Signed-in UID: ${signedInUid}`,
        `Required user document: users/${signedInUid}`,
        `Reason: ${error.message || error.code || "Unknown access error"}`,
        error.accessDetails
      ].filter(Boolean).join("\n");
      accessDetails.hidden = false;
    }
    await signOut(auth).catch(() => {});
    const messages = {
      "functions/unauthenticated": "Incorrect employee number or password, or account unavailable.",
      "functions/resource-exhausted": "Too many sign-in attempts. Please try again in 15 minutes.",
      "functions/permission-denied": "Your employee account is inactive. Contact your administrator.",
      "functions/failed-precondition": error.message,
      "functions/not-found": "Employee sign-in has not been deployed. Contact your administrator.",
      "functions/unavailable": "Unable to connect to employee sign-in. Check your connection or contact your administrator.",
      "functions/internal": "Employee sign-in is unavailable. Contact your administrator.",
      "functions/deadline-exceeded": "Employee sign-in timed out. Please try again.",
      "auth/operation-not-allowed": "Email/password sign-in is not enabled. Contact your administrator.",
      "auth/user-disabled": "Your account is disabled. Contact your administrator.",
      "auth/too-many-requests": "Too many attempts. Please try again later.",
      "auth/network-request-failed": "Unable to connect. Check your connection and try again.",
      "unavailable": "Unable to verify employee access online. Check your connection and try again.",
      "permission-denied": "Account access is not configured. Contact your administrator."
    };
    status.textContent = messages[error.code] || (error.code ? "Unable to sign in. Contact your administrator." : error.message);
    status.className = "authStatus error";
  } finally {
    document.getElementById("loginPassword").value = "";
    setBusy(false);
  }
});

resetForm.addEventListener("submit", async event => {
  event.preventDefault();
  resetEmail.value = resetEmail.value.trim();
  if (!resetEmail.reportValidity()) return;
  const status = document.getElementById("resetStatus");
  setBusy(true, resetForm);
  status.textContent = "Requesting password reset...";
  status.className = "authStatus";
  try {
    await sendPasswordResetEmail(auth, resetEmail.value);
    status.textContent = "If an account exists for this email, a password-reset link has been sent. Check your inbox and spam folder.";
    status.className = "authStatus success";
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      status.textContent = "If an account exists for this email, a password-reset link has been sent. Check your inbox and spam folder.";
      status.className = "authStatus success";
    } else {
      const messages = {
        "auth/invalid-email": "Please enter a valid email address.",
        "auth/too-many-requests": "Too many requests. Please try again later.",
        "auth/network-request-failed": "Unable to connect. Check your connection and try again."
      };
      status.textContent = messages[error.code] || "Unable to request a password reset. Please try again later or contact your administrator.";
      status.className = "authStatus error";
    }
  } finally {
    document.getElementById("loginPassword").value = "";
    setBusy(false, resetForm);
  }
});
