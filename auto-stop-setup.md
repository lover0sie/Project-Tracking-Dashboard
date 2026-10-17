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
