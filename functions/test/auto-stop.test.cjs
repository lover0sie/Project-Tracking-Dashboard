const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAutoStop } = require("../auto-stop-runner.js");
const { buildEmail } = require("../auto-stop-report.js");
const { parseMailConfig, deliverNotification } = require("../auto-stop-mailer.js");

// The test database stages transaction writes so each test can check whether
// a process hold and its audit entry are saved together.
// Operator changes and permission failures are simulated without live records.
function memoryDb(initial = {}) {
  const data = new Map(Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]));
  function ref(path) {
    return {
      path, id: path.split("/").at(-1),
      collection: name => collection(`${path}/${name}`),
      get: async () => snapshot(path),
      set: async (value, options) => write(path, value, options?.merge),
      update: async value => write(path, value, true)
    };
  }
  function snapshot(path) {
    return { exists: data.has(path), ref: ref(path), data: () => structuredClone(data.get(path)) };
  }
  function write(path, value, merge) {
    const result = merge ? { ...data.get(path) } : {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = item?.arrayUnion ? [...(result[key] || []), structuredClone(item.arrayUnion)] : structuredClone(item);
    }
    data.set(path, result);
  }
  function collection(path) {
    return {
      doc: id => ref(`${path}/${id}`),
      get: async () => ({ docs: [...data.keys()].filter(key => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1).sort().map(snapshot) })
    };
  }
  const db = {
    data, doc: ref, collection,
    collectionGroup: name => ({ get: async () => {
      if (db.scanFailure) throw Object.assign(new Error("read failed"), { code: "unavailable" });
      const docs = [...data.keys()].filter(key => key.split("/").at(-2) === name).map(snapshot);
      db.afterScan?.();
      return { size: docs.length, docs };
    } }),
    runTransaction: async callback => {
      const writes = [];
      const result = await callback({
        get: async document => snapshot(document.path),
        set: (document, value, options) => writes.push([document.path, value, !!options?.merge]),
        update: (document, value) => writes.push([document.path, value, true])
      });
      if (db.failHolds && writes.some(([path, value]) => path.includes("/runs/") && value.autoStopped)) {
        throw Object.assign(new Error("denied"), { code: "permission-denied" });
      }
      for (const args of writes) write(...args);
      return result;
    }
  };
  return db;
}

const scheduledMs = Date.parse("2026-11-05T17:30:00+08:00");
const runPath = "processRuns/K26L343/runs/one";
const running = {
  status: "running", processName: "A2 - Insulation compressor", serialNumber: "K26L343_COMPRESSOR",
  chillerSerialNumber: "K26L343", projectName: "Test project", startEpochMs: Date.parse("2026-11-05T11:21:15+08:00")
};
const logger = { info() {}, error() {} };
function execute(db) {
  return runAutoStop({ db, scheduledMs, logger, clock: () => scheduledMs + 12000, fieldValue: { arrayUnion: item => ({ arrayUnion: item }) } });
}
function outbox(db) {
  return [...db.data.entries()].filter(([key]) => key.startsWith("_autoStopNotifications/")).map(([path, value]) => ({ path, ...value }));
}

test("hold and audit persist together; replay retains candidate and creates no duplicate hold/email", async () => {
  const db = memoryDb({ [runPath]: running });
  const result = await execute(db);
  assert.equal(result.email.summary.applied, 1);
  assert.equal(db.data.get(runPath).status, "on_hold");
  assert.equal(db.data.get(runPath).holds[0].holdAtEpochMs, scheduledMs);
  assert.equal(result.entries[0].serial, "K26L343");
  // A later operator completion simulates the investigated issue. The audit
  // should retain evidence that auto-stop was successfully applied.
  db.data.get(runPath).status = "completed";
  const replay = await execute(db);
  assert.equal(replay.email.summary.applied, 1);
  assert.equal(db.data.get(runPath).status, "completed");
  assert.equal(db.data.get(runPath).holds.length, 1);
  assert.equal(outbox(db).length, 1);
});

test("completion before transaction is skipped instead of overwritten", async () => {
  const db = memoryDb({ [runPath]: running });
  const original = db.runTransaction;
  let calls = 0;
  db.runTransaction = async callback => {
    if (++calls === 2) db.data.get(runPath).status = "completed";
    return original(callback);
  };
  const result = await execute(db);
  assert.equal(result.email.summary.skipped, 1);
  assert.equal(db.data.get(runPath).status, "completed");
  assert.equal(db.data.get(runPath).holds, undefined);
});

test("failed hold gets an attention report and retry recovers without losing candidate", async () => {
  const db = memoryDb({ [runPath]: running });
  db.failHolds = true;
  await assert.rejects(execute(db), /needs retry/);
  assert.equal(db.data.get(runPath).status, "running");
  assert.match(outbox(db)[0].subject, /ATTENTION REQUIRED/);
  assert.match(outbox(db)[0].text, /permission-denied/);
  db.failHolds = false;
  const result = await execute(db);
  assert.equal(result.email.summary.applied, 1);
  assert.equal(outbox(db).length, 2);
  assert.equal(db.data.get(runPath).holds.length, 1);
});

test("painting, previous-day runs and later shifts stay excluded; empty report confirms check", async () => {
  const db = memoryDb({
    "processRuns/paint/runs/one": { ...running, processName: "15 - Primer painting" },
    "processRuns/old/runs/one": { ...running, startEpochMs: scheduledMs - 86400000 },
    "processRuns/late/runs/one": { ...running, startEpochMs: scheduledMs + 60000 }
  });
  const result = await execute(db);
  assert.equal(result.email.summary.candidates, 0);
  assert.match(result.email.text, /No eligible processes/);
  assert.equal(outbox(db).length, 1);
});

test("scan failure emails a check-required result rather than claiming zero candidates is success", async () => {
  const db = memoryDb();
  db.scanFailure = true;
  await assert.rejects(execute(db), /needs retry/);
  assert.match(outbox(db)[0].subject, /CHECK REQUIRED/);
  assert.match(outbox(db)[0].text, /cannot confirm/);
});

test("evening cutoff uses Malaysia time and report separates applied from completed", () => {
  const email = buildEmail({ id: "test", scheduledMs: Date.parse("2026-11-05T21:30:00+08:00"), finishedMs: scheduledMs, checked: 1 }, []);
  assert.match(email.subject, /9:30:00 pm/);
  assert.match(email.text, /does not mean the process was completed/);
});

test("mail configuration requires one recipient and encrypted SMTP", () => {
  const config = parseMailConfig(JSON.stringify({ host: "smtp.example.com", from: "sender@example.com", to: "owner@example.com", auth: { user: "sender", pass: "test" } }));
  assert.equal(config.transport.requireTLS, true);
  assert.equal(config.transport.port, 587);
  assert.throws(() => parseMailConfig(JSON.stringify({ host: "smtp.example.com", from: "a", to: "a@example.com,b@example.com", auth: { user: "sender" } })), /one recipient/);
});

test("email retries do not re-send an accepted notification", async () => {
  const db = memoryDb({ "_autoStopNotifications/one": { subject: "Report", text: "Test", status: "pending", createdMs: scheduledMs } });
  let sends = 0;
  const args = {
    db, ref: db.doc("_autoStopNotifications/one"), config: { from: "sender@example.com", to: "owner@example.com" }, clock: () => scheduledMs,
    sendMail: async () => { sends++; return { accepted: ["owner@example.com"], rejected: [], messageId: "test" }; }
  };
  assert.equal(await deliverNotification(args), "accepted");
  await deliverNotification(args);
  assert.equal(sends, 1);
});

test("email failure retries separately and stops after five attempts", async () => {
  const db = memoryDb({ "_autoStopNotifications/one": { subject: "Report", text: "Test", status: "pending", createdMs: scheduledMs } });
  const args = {
    db, ref: db.doc("_autoStopNotifications/one"), config: { from: "sender@example.com", to: "owner@example.com" }, clock: () => scheduledMs,
    sendMail: async () => { throw Object.assign(new Error("no connection"), { code: "ECONNECTION" }); }
  };
  for (let i = 0; i < 4; i++) await assert.rejects(deliverNotification(args), /retry required/);
  assert.equal(await deliverNotification(args), "failed");
  assert.equal(db.data.get(args.ref.path).attempts, 5);
  assert.equal(db.data.get(args.ref.path).errorCode, "ECONNECTION");
});

test("an active email lease cannot cause a parallel send", async () => {
  const db = memoryDb({ "_autoStopNotifications/one": { status: "sending", leaseUntilMs: scheduledMs + 90000 } });
  await assert.rejects(deliverNotification({ db, ref: db.doc("_autoStopNotifications/one"), clock: () => scheduledMs, sendMail: () => assert.fail("must not send") }), /already in progress/);
});
