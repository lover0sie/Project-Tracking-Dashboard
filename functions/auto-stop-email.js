const { getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");
const { parseMailConfig, deliverNotification } = require("./auto-stop-mailer.js");

// Firebase stores the sender, recipient and email connection credentials in a
// protected secret. Only the email worker receives access to this secret.
const emailConfig = defineSecret("AUTO_STOP_EMAIL_CONFIG");

// A new queued notification starts the email worker. One worker sends messages
// at a time, and failed executions can be retried automatically.
exports.emailAutoStopReport = onDocumentCreated({
  document: "_autoStopNotifications/{notificationId}",
  region: "asia-southeast1",
  secrets: [emailConfig],
  retry: true,
  timeoutSeconds: 60,
  maxInstances: 1,
  concurrency: 1
}, async event => {
  if (!event.data) {
    return;
  }

  // The connection settings are loaded when the worker processes a notification.
  const config = parseMailConfig(emailConfig.value());
  const transport = nodemailer.createTransport(config.transport);

  try {
    const status = await deliverNotification({
      db: getFirestore(),
      ref: event.data.ref,
      config,
      sendMail: message => transport.sendMail(message)
    });

    // Delivery outcomes are recorded without logging the email credentials.
    if (status === "failed") {
      logger.error("Auto-stop email failed after five attempts", {
        notificationId: event.params.notificationId
      });
    } else if (status) {
      logger.info("Auto-stop email accepted by sending service", {
        notificationId: event.params.notificationId
      });
    }
  } finally {
    // The connection is closed after either a successful or a failed attempt.
    transport.close();
  }
});
