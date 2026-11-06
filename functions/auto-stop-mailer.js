// The email worker checks the saved connection settings before opening a connection.
function parseMailConfig(value) {
  let config;

  try {
    config = JSON.parse(value);
  } catch {
    throw new Error("Email configuration must be valid JSON.");
  }

  if (!config || !config.host || !config.from || !config.to || !config.auth?.user) {
    throw new Error("Email configuration requires host, from, to and auth.user.");
  }

  // The report is addressed to one configured recipient.
  if (typeof config.to !== "string" || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(config.to)) {
    throw new Error("Configure one recipient email address.");
  }

  const port = Number(config.port || 587);

  if (![465, 587, 2525].includes(port)) {
    throw new Error("Use SMTP port 465, 587 or 2525.");
  }

  // Port 465 starts with encryption. The other supported ports require a
  // secure connection upgrade before the message can be sent.
  return {
    from: config.from,
    to: config.to,
    transport: {
      host: config.host,
      port,
      secure: port === 465,
      requireTLS: true,
      auth: config.auth,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      disableFileAccess: true,
      disableUrlAccess: true
    }
  };
}

// The email worker operates separately from the scheduled hold processing.
// A mail delivery problem does not prevent the scheduled process holds.
async function deliverNotification({ db, ref, sendMail, config, clock = Date.now }) {
  const now = clock();

  // A temporary reservation prevents two workers from sending the same message
  // at the same time. Accepted messages and exhausted attempts are left alone.
  const notification = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data();

    if (data.status === "accepted" || data.status === "failed") {
      return null;
    }

    if (data.leaseUntilMs > now) {
      throw new Error("Email delivery is already in progress; retry later.");
    }

    transaction.update(ref, {
      status: "sending",
      leaseUntilMs: now + 90000,
      attempts: Number(data.attempts || 0) + 1
    });

    return { ...data, attempts: Number(data.attempts || 0) + 1 };
  });

  if (!notification) {
    return;
  }

  // The saved notification supplies the email content on every delivery attempt.
  try {
    const result = await sendMail({
      from: config.from,
      to: config.to,
      subject: notification.subject,
      text: notification.text,
      date: new Date(notification.createdMs),
      messageId: `<auto-stop-${ref.id}@qrcodetesting-4f86e.firebaseapp.com>`
    });

    if (!result.accepted?.length || result.rejected?.length) {
      throw Object.assign(new Error("Recipient not accepted."), { code: "RECIPIENT_REJECTED" });
    }

    // Acceptance confirms that the sending service accepted the message.
    // It does not confirm that the message reached the recipient's inbox.
    await ref.update({
      status: "accepted",
      acceptedMs: clock(),
      leaseUntilMs: 0,
      messageId: String(result.messageId || ""),
      errorCode: ""
    });

    return "accepted";
  } catch (error) {
    // Delivery is retried until five attempts have failed.
    const exhausted = notification.attempts >= 5;

    await ref.update({
      status: exhausted ? "failed" : "pending",
      leaseUntilMs: 0,
      errorCode: String(error.code || "send_failed"),
      lastFailureMs: clock()
    });

    if (!exhausted) {
      throw new Error(`Auto-stop email delivery failed (${String(error.code || "send_failed")}); retry required.`);
    }

    return "failed";
  }
}

module.exports = { parseMailConfig, deliverNotification };
