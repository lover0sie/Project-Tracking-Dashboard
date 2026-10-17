const { createHash } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { defineString } = require("firebase-functions/params");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

initializeApp();
const db = getFirestore();
const auth = getAuth();
const webApiKey = defineString("DASHBOARD_WEB_API_KEY", {
  description: "Web API key from the same Firebase project as the dashboard",
  default: "AIzaSyBePrEYgwU4tD9h82n9PbjfxtTyQMXm6Kk"
});
const WINDOW_MS = 15 * 60 * 1000;

function invalidCredentials() {
  return new HttpsError("unauthenticated", "Incorrect employee number or password, or account unavailable.");
}

async function limitAttempts(employeeId, ip) {
  const now = Date.now();
  const buckets = [
    { scope: `ip:${ip}`, limit: 50 },
    { scope: `employee:${employeeId}:ip:${ip}`, limit: 10 }
  ].map(bucket => ({
    ...bucket,
    ref: db.collection("_employeeLoginLimits").doc(createHash("sha256").update(bucket.scope).digest("hex"))
  }));
  await db.runTransaction(async transaction => {
    const snapshots = await Promise.all(buckets.map(bucket => transaction.get(bucket.ref)));
    const updates = snapshots.map(snapshot => {
      const stored = snapshot.data();
      const current = stored?.expiresAt?.toMillis() > now;
      return {
        count: current ? Number(stored.count || 0) + 1 : 1,
        expiresAt: current ? stored.expiresAt : Timestamp.fromMillis(now + WINDOW_MS)
      };
    });
    if (updates.some((update, index) => update.count > buckets[index].limit)) {
      throw new HttpsError("resource-exhausted", "Too many sign-in attempts. Please try again in 15 minutes.");
    }
    buckets.forEach((bucket, index) => transaction.set(bucket.ref, updates[index]));
  });
}

exports.employeePasswordLogin = onCall({
  region: "asia-southeast1",
  timeoutSeconds: 30,
  maxInstances: 5
}, async request => {
  const employeeId = typeof request.data?.employeeId === "string"
    ? request.data.employeeId.trim().toUpperCase()
    : "";
  const password = request.data?.password;
  if (!/^[A-Z0-9_-]{1,40}$/.test(employeeId)
    || typeof password !== "string" || !password.length || password.length > 4096) {
    throw invalidCredentials();
  }
  try {
    await limitAttempts(employeeId, request.rawRequest.ip || "unknown");
    const employeeSnap = await db.collection("employees").doc(employeeId).get();
    if (!employeeSnap.exists) throw invalidCredentials();
    const employee = employeeSnap.data();
    if (employee.employeeId !== employeeId || typeof employee.email !== "string" || !employee.email.trim()) {
      throw invalidCredentials();
    }
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(webApiKey.value())}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: employee.email.trim(), password, returnSecureToken: true }),
        signal: AbortSignal.timeout(10000)
      }
    );
    const result = await response.json();
    if (!response.ok) {
      const reason = result.error?.message || "";
      if (reason.startsWith("TOO_MANY_ATTEMPTS_TRY_LATER")) {
        throw new HttpsError("resource-exhausted", "Too many sign-in attempts. Please try again later.");
      }
      if (["INVALID_LOGIN_CREDENTIALS", "EMAIL_NOT_FOUND", "INVALID_PASSWORD", "USER_DISABLED", "INVALID_EMAIL"].includes(reason)) {
        throw invalidCredentials();
      }
      throw new HttpsError("unavailable", "Employee sign-in is unavailable. Contact your administrator.");
    }
    if (typeof result.localId !== "string" || !result.localId) throw invalidCredentials();
    const uid = result.localId;
    const mappingSnap = await db.collection("users").doc(uid).get();
    const mapping = mappingSnap.data();
    if (!mappingSnap.exists || mapping.employeeId !== employeeId) {
      throw new HttpsError("failed-precondition", "Your email account is not linked to this employee number. Contact your administrator.");
    }
    if (mapping.active !== true || employee.active !== true) {
      throw new HttpsError("permission-denied", "Your employee account is inactive. Contact your administrator.");
    }
    if (!["level1", "level2", "level3"].includes(employee.role)) {
      throw new HttpsError("failed-precondition", "Your employee role is not configured. Contact your administrator.");
    }
    const account = await auth.getUser(uid);
    if (account.disabled) throw invalidCredentials();
    return { token: await auth.createCustomToken(uid) };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("unavailable", "Employee sign-in is unavailable. Please try again later or contact your administrator.");
  }
});
