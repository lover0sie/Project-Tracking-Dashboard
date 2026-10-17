# Employee-number login and email password resets

The browser uses Firebase Authentication for passwords and Firestore for employee permissions. Passwords must never be stored in employee documents.

## Enable authentication

In Firebase Console for `qrcodetesting-4f86e`, enable Authentication > Sign-in method > Email/Password. Add the dashboard's hosting domain to Authentication > Settings > Authorized domains. Serve the dashboard through HTTP/HTTPS, not by opening local HTML files directly.

## Set up employee 30369

1. Keep the employee record you supplied in `employees/30369`. The document ID must be the employee number, and `employeeId` must be the string `"30369"`. Keep `active: true`, `role: "level3"`, name, department, real email, and your existing timestamps.
2. In Authentication > Users, use the employee's real email address, for example `adyla.dyla.atm@gmail.com`, with the Email/Password provider. Keep your existing Gmail Authentication account if already created. Otherwise, select Add user and set up the email and a strong password.
3. Copy that Authentication user's UID. In Firestore, create `users/PASTE_AUTH_UID_HERE` with:
   ```json
   {
     "employeeId": "30369",
     "active": true
   }
   ```
4. Publish the rules from `firestore.rules` in Firestore Database > Rules after reviewing the shared-app note below.
5. Deploy the employee-login Cloud Function using the instructions below before publishing the updated login page.
6. Open `login.html` and enter employee number `30369` and its Firebase Authentication password. This is the dashboard account password, which may differ from the Gmail mailbox password.

Repeat these steps for other employees, using their number and role. A Firestore employee document alone does not create a password account. If the record is currently in another collection, copy it to the path above.

The employee-login function privately looks up `employees/{employeeId}.email`, verifies the password with Firebase Authentication, checks the UID mapping and active employee role, then issues a custom token for the same existing Authentication user. Email addresses are never returned to unauthenticated callers. Passwords are forwarded only to Firebase Authentication over HTTPS and are not stored or logged by the function.

Keep the employee document's email synchronized with the Authentication account email. Login requires the password-based Email/Password provider. Password resets continue to use that real email address. Do not create employee-number aliases or new Authentication accounts when switching this login flow; retain the current Gmail account and its UID mapping.

## Deploy employee-number login

Employee-number login requires a trusted backend because employee email addresses cannot be read publicly before sign-in. This repository includes the callable function `employeePasswordLogin` in `functions/index.js` and function-only configuration in `firebase.json`. The browser calls it in `asia-southeast1`.

Firebase Cloud Functions deployment requires the Blaze billing plan. No backend has been deployed by these file changes. Deploy the backend before publishing the new employee-number login page.

From the repository root, with Node.js 22 and Firebase CLI installed:

```powershell
npm ci --prefix functions
firebase login
firebase deploy --only functions:employee-login:employeePasswordLogin --project qrcodetesting-4f86e
```

The function uses the dashboard project's existing public Web API key by default. If prompted for `DASHBOARD_WEB_API_KEY`, enter only that API key, not a terminal command. If deploying to a different project, configure `DASHBOARD_WEB_API_KEY` and update the frontend Firebase configuration together. Firebase reserves environment-variable names beginning with `FIREBASE_`; do not use the former `FIREBASE_WEB_API_KEY` name. API-key restrictions must allow server-side Firebase Authentication password requests; a key restricted exclusively to browser HTTP referrers cannot be used for this backend. Use a separate same-project key scoped to the Identity Toolkit API if necessary.

Enable the IAM Service Account Credentials API in the Google Cloud project if custom-token signing requires it. Grant the deployed function's runtime service account the Service Account Token Creator role on the signing service account, following Firebase's custom-token instructions. Use managed service-account credentials; never download an administrator key into the website.

The function limits requests to 50 per IP and 10 per employee/IP pair over a 15-minute window, including successful logins. Counters live in the server-only `_employeeLoginLimits` collection. Existing default-deny Firestore rules block client access to this collection. Enable a Firestore TTL policy on its `expiresAt` timestamp field to remove expired counters. These are backend counters, so Admin SDK access bypasses client rules. The function does not expose employee lookup or create user profiles.

Deployment checks:
- Confirm `employees/30369.email` matches the existing Gmail Authentication account.
- Sign in with `30369` and the current dashboard password; confirm the resulting UID is the existing Gmail UID.
- Select Forgot password?, enter the Gmail address, reset the password, and sign in with `30369` and the new password.
- Check that wrong passwords and unknown employee numbers receive the same generic response, inactive employees cannot sign in, and excessive attempts are throttled.
- Verify a Level 1/2/3 account still receives its existing dashboard permissions.

References: [Callable functions](https://firebase.google.com/docs/functions/callable), [Password verification](https://firebase.google.com/docs/reference/rest/auth), [Custom-token signing](https://firebase.google.com/docs/auth/admin/create-custom-tokens), [Cloud Functions setup and billing](https://firebase.google.com/docs/functions/get-started).

Account provisioning is administrator-managed. Public signup is disabled so that knowing someone's employee number cannot claim their account or role. Never put Admin SDK credentials in the dashboard.

## Reset a password

If the Firebase records look correct but access still fails, deploy the latest login files and reload. Profile checks now require a fresh server response. After a successful password check followed by a failed employee check, expand Account access details on the login page to compare the actual Firebase project and signed-in UID against the console. This section never includes passwords or tokens. If the page still shows only the original combined inactive/unconfigured message, verify that the deployed login page and JavaScript match the current files.

If sign-in accepts the password but reports an inactive or unconfigured employee, the password reset has worked and the Firestore account link needs checking. Copy the UID from the Gmail row in Authentication > Users (not from an old alias account). The document ID under users must be that exact UID, not the email, employee number, or the literal text UID. That document needs employeeId as the string "30369" and active as boolean true. The employees/30369 document also needs employeeId as the string "30369", active as boolean true, and role as the exact string "level3". The updated login reports which profile check failed. Do not weaken the rules or create a replacement Authentication account to bypass this check.

On `login.html`, select Forgot password?, enter the registered email address, and select Send reset link. An employee number or password is not required to request a reset. Firebase emails a link to that Authentication account's email address; check the Gmail inbox and spam folder. Follow the link to set a new dashboard password, then select Back to sign in and enter the employee number and new password.

The page shows the same confirmation for an existing and an unknown address. Keep Firebase email enumeration protection enabled. Password-reset emails require a real, accessible Authentication account email, not an internal alias. If you replace an alias account with a new Gmail account, update `users/{UID}` to use the new UID.

## Permissions

| Feature | Level 1 | Level 2 | Level 3 |
| --- | --- | --- | --- |
| Project Gantt, Station Gantt | Yes | Yes | Yes |
| Process Description, Acknowledgement | Yes | Yes | Yes |
| Line Balance, Chiller Cycle Time | No | Yes | Yes |
| Excel export | No | Yes | Yes |
| Cleanup | No | No | Yes |
| Data extraction/import, ProductionProgress | No | No | Yes |

Tree View is removed from every sidebar. It remains accessible at `tree.html` for Level 3.

Cleanup uses the existing dashboard session with no additional username or password. Its link and direct page access are restricted to Level 3, initialization verifies the current employee role, and each write checks Level 3 access. Use the navigation bar's Sign Out button to end the dashboard session.

For overdue running processes, historical shift holds, and automatic daily Auto Stop jobs, see [Running Cleanup and Auto Stop setup](auto-stop-setup.md).

The authoritative role is `employees/{employeeId}.role`, using exactly `level1`, `level2`, or `level3`. Both the employee and UID mapping must have boolean `active: true`. Browser code cannot write either collection. Change employee permissions through Firebase Console or a trusted administrator service. Open dashboards observe role/active changes and recheck access. Authentication state is restored using Firebase's browser persistence; profiles are fetched afresh, with no session-storage authorization fallback.

## Deploy the rules carefully if Firebase is shared

The included rules require authenticated, active employees for dashboard reads and restrict run writes to Level 3. They cover `processRuns/{projectId}` and collection-group queries for `runs`.

If a separate production/scanner app currently writes without authentication, these rules will block it. Review and integrate its authenticated identity and write permissions before publishing. Do not retain broad public read/write rules: Firestore combines matching allows, so a public allow defeats these restrictions. Rules have not been deployed by this code change.

All levels read the same underlying run documents for their permitted charts. Hiding Line Balance/Chiller Cycle Time and disabling built-in export are dashboard permissions. A user who may read those run documents can still copy data or calculate reports outside this dashboard. Enforcing stronger separation requires server-generated reports/exports and separate data access. Firestore cannot distinguish an Excel export from an ordinary authorized document read.

## Verification

Verify with one account per role:
- Signed-out users opening any dashboard URL are sent to login before dashboard modules execute.
- Incorrect passwords, missing profiles, invalid roles, and inactive employees are rejected.
- Employee-number/password login uses the existing Gmail Authentication account and retains its UID and role.
- Forgot password opens a separate email form and works without an employee number or password; unknown addresses receive the same on-screen confirmation.
- Level 1 sees only the four permitted views and no Excel controls; direct Level 2/3 URLs redirect to Project Gantt.
- Level 2 sees the additional two views and can export, but cannot open Cleanup or perform writes.
- Level 3 can open all views, Cleanup and administrative utilities.
- All sidebars hide Tree View; Sign Out removes access, including in another open tab.
- Disable an employee or change their role while their dashboard is open and confirm access refreshes.
- Test Firestore rules with authenticated and unauthenticated requests in Rules Playground or the Firebase emulator before deployment.

References: [Firebase password authentication](https://firebase.google.com/docs/auth/web/password-auth), [Firestore access conditions](https://firebase.google.com/docs/firestore/security/rules-conditions).
