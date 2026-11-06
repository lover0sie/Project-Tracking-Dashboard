# Running Cleanup and scheduled Auto Stop

Cleanup remains Level 3 only and uses the existing dashboard session. Its grey tool navigation includes Running Cleanup alongside the existing maintenance tools.

## Running Cleanup

Running Cleanup lists processes still marked running more than 24 hours after their latest start or resume. Resuming a process restarts this age calculation, so a recently resumed process is not treated as overdue solely because its original start was several days ago.

The table shows separate Serial Number, Chiller Serial Number, and PV Serial Number columns. Missing values display a dash.

Each row suggests the cutoff on the active period's original date:

- Started/resumed before 5:30 PM: suggest 5:30 PM that day.
- Started/resumed from 5:30 PM up to 9:30 PM: suggest 9:30 PM that day.
- Started/resumed at or after 9:30 PM: require a manually reviewed hold time.

Times are explicitly Malaysia time, including when the browser runs in another timezone. A Level 3 user can edit the proposed hold time and confirm the change. The hold must be later than the latest start/resume and no later than now. This places the process on hold; it does not mark the process completed.

The hold entry uses byName: SYSTEM and byNumber: SYSTEM, with the same remarks format as scheduled Auto Stop. The update still records the historical hold timestamp, actual time the correction was applied, running_cleanup source, and the Level 3 user's UID in autoStopByUid for auditing. If the run was completed, resumed again, or changed status while it was being reviewed, the transaction rejects the stale correction.

Running Cleanup includes these painting processes when they have been continuously running for more than 24 hours. Level 3 users can review and confirm their hold time just like other overdue processes:

- 15 - Primer Painting
- 18, 19 - Primer Painting (Weld Seam) and Top Coat Painting
- 19 - Top Coat Painting

Painting remains excluded from scheduled Auto Stop; only Running Cleanup allows this explicit, reviewed correction.

## Scheduled same-day Auto Stop

Two scheduled Cloud Functions apply the existing Auto Stop rules without requiring an open dashboard or a button click:

| Function | Daily time, Asia/Kuala_Lumpur |
| --- | --- |
| autoStopDayShift | 5:30 PM |
| autoStopEveningShift | 9:30 PM |

Both use the latest start/resume and preserve the painting exclusions. They only apply cutoffs for the scheduled calendar day. Older forgotten running records are reviewed through Running Cleanup. Schedules run every calendar day, matching the existing manual rules; no weekend/holiday calendar is configured.

Each candidate is re-read inside a Firestore transaction before writing. Overlapping jobs, retries, and Running Cleanup cannot apply a second hold to a run that is already on hold or completed. The stored hold timestamp is the intended shift cutoff, while autoStopAppliedAtEpochMs records when the write actually happened.

The manual Run Auto Stop button and its browser-side execution/preview code have been removed. Daily Auto Stop runs only through Cloud Scheduler. Cutoffs are shared between Running Cleanup and scheduled jobs in functions/auto-stop-policy.mjs. Painting exclusions apply to scheduled Auto Stop, not Running Cleanup.

## Publish and activate

Both scheduled functions were deployed on 17 October 2026. Their Cloud Scheduler jobs were verified ENABLED with the Asia/Kuala_Lumpur timezone: 30 17 * * * and 30 21 * * *. They automatically change eligible running records to on_hold. The updated website must still be published to expose Running Cleanup, including painting review.

1. Confirm the 5:30 PM and 9:30 PM Malaysia cutoffs and existing painting exclusions match your intended shifts.
2. For future backend updates, deploy this project's codebase from the repository root:

   ```powershell
   firebase deploy --only functions:employee-login --project qrcodetesting-4f86e
   ```

3. Enable the Cloud Scheduler API if the Firebase CLI requests it. The project must stay on Blaze; Scheduler, function execution, and Firestore operations can incur usage charges.
4. Publish the updated website, including functions/auto-stop-policy.mjs. This module is pure shared calculation code with no credentials and must be served with a JavaScript MIME type. It is imported by the browser and packaged with the backend.
5. Verify the two jobs in Google Cloud Scheduler show the intended timezone and schedules. Pause the jobs there if automatic holds should be suspended.

These jobs use the deployed function runtime's Firestore permissions. They do not change employee profiles or dashboard role rules. Run queries use the existing collection-group runs access without requiring new Firestore indexes.

## Verify before production activation

- A process started at 9:00 AM is held at 5:30 PM that day.
- A process resumed at 6:00 PM is held at 9:30 PM that day.
- A resumed process is not backdated before its latest resume.
- Painting is excluded from scheduled Auto Stop but can be reviewed and held through Running Cleanup after 24 hours.
- Repeating the same job does not create a duplicate hold.
- A process completed while an action is pending is left unchanged.
- Running Cleanup supports historical corrections beyond the previous day, but requires explicit review and confirmation.
- Level 1 and Level 2 cannot initialize Cleanup or write run corrections.

References: [Firebase scheduled functions](https://firebase.google.com/docs/functions/schedule-functions), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions).

## Auto-stop email reports (activated 6 November 2026)

`autoStopDayShift`, `autoStopEveningShift` and `emailAutoStopReport` were deployed and verified ACTIVE on 6 November 2026. Both daily schedules were verified ENABLED for 5:30 PM and 9:30 PM in Asia/Kuala_Lumpur. A clearly labelled test notification passed through the deployed Firestore trigger and was accepted by the configured Gmail sending service on its first attempt. The recipient confirmed that the test email arrived in the inbox. No process records were changed by the test.

The scheduled checks now prepare an email report after each 5:30 PM and 9:30 PM check, including checks with no eligible processes. Each report lists the candidate project/process, chiller and item/PV serials, intended hold time, and result: Applied, Skipped, Failed or Pending. Skipped means the process changed before its hold could be applied. Failed/Pending results require attention; scheduler retries can produce an updated report. A scan failure is clearly marked CHECK REQUIRED, rather than reporting success with zero candidates.

An Applied result confirms that an automatic hold was saved. It does not confirm the process will remain on hold afterwards, and it does not fix the operator app issue described in the investigation. This email is an audit of the scheduled action, not continuous monitoring of later operator changes.

The backend keeps `_autoStopReports/{scheduledEpochMs}/entries/{runPathHash}` separately from process records. Each automatic hold and its Applied audit entry are saved together. Retrying the same schedule retains its original candidates and successful results. Process records that later become completed cannot erase this audit. Existing same-day shift rules and painting exclusions are unchanged.

Emails are queued in `_autoStopNotifications` and sent by the separate `emailAutoStopReport` function. Sending failures do not prevent automatic holds. Normal retries reuse the saved notification. The worker records `accepted` when the sending service accepts the message; this does not guarantee inbox delivery. Sending is attempted up to five times. SMTP cannot guarantee exactly one email if a connection is lost after the service accepts a message, so a rare duplicate is possible. Repeated identical scheduler results do not create another queued message; changed results after recovery do.

### Activation

1. Confirm the recipient address and a mailbox or sending service that supports authenticated SMTP. Authentication requirements depend on that service; do not place credentials in source code or chat.
2. Store the sender/recipient and SMTP configuration as the Firebase Secret Manager secret `AUTO_STOP_EMAIL_CONFIG`. For example, the secret's JSON structure is:

   ```json
   {
     "host": "smtp.example.com",
     "port": 587,
     "from": "Production Tracking <sender@example.com>",
     "to": "recipient@example.com",
     "auth": {
       "user": "sender@example.com",
       "pass": "service-issued-password"
     }
   }
   ```

   Create it using `firebase functions:secrets:set AUTO_STOP_EMAIL_CONFIG --project qrcodetesting-4f86e`. Enter the JSON at the protected prompt. The worker also supports an SMTP provider's Nodemailer OAuth2 `auth` configuration. Use the authentication method supported by the chosen service. Ports 465, 587 and 2525 are supported, with encrypted connections required.

3. Run `npm test` inside `functions`. The tests use an in-memory database and a mocked sender; they do not change production records or send email.
4. Deploy the scheduled functions and email worker together:

   ```powershell
   firebase deploy --only "functions:employee-login:autoStopDayShift,functions:employee-login:autoStopEveningShift,functions:employee-login:emailAutoStopReport" --project qrcodetesting-4f86e
   ```

5. Verify the next scheduled report against its saved audit entries and confirm receipt in the intended inbox. Notification documents created before the email worker was deployed are not automatically sent by the create trigger.

The audit and notification collections are backend-only under the current Firestore rules. No browser access or rule changes are needed. Keep investigation reports, diagnostic scripts and collected evidence in the local `investigation/` directory; `.gitignore` excludes it from GitHub. The operational setup guide and production code remain tracked.

References: [Firebase secrets](https://firebase.google.com/docs/functions/config-env), [Firestore event triggers](https://firebase.google.com/docs/functions/firestore-events), [Nodemailer SMTP configuration](https://nodemailer.com/smtp).
