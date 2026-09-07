# St Matthew CCD Class Manager (Node.js)

Web app for **Saint Matthew Catholic Church Faith Formation**.

## Features
- Email/password sign-up and login with email verification before local accounts are activated.
- Free social login options: **Google OAuth** and **GitHub OAuth**.
- Role-based access:
  - **Parent**: submit child registration and view own submissions.
  - **Catechist**: view all registrations.
  - **Admin**: manage users and roles, view all registrations.
- Registration form includes all provided fields from the paper form.
- Upload/scan support for:
  - Baptism certificate
  - First Holy Communion certificate
- Fee rules implemented:
  - \$150 (one child) / $200 (family)
  - Sacramental fee $25 for second grade/SS2
  - Sacramental fee $50 for second-year confirmation
  - $50 late fee after Aug 15, 2025
  - Registration blocked after Sept 8, 2025

## Quick start
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment:
   ```bash
   cp .env.example .env
   ```
3. Configure MySQL in `.env`:
   ```env
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your-password
   DB_NAME=ccd_class_manager
   ```
   In production, set `UPLOAD_DIR` to a persistent directory outside the deployed build folder so submitted files survive redeploys:
   ```env
   UPLOAD_DIR=/home/your-account/faithformation-uploads
   ```
   To recover files uploaded before `UPLOAD_DIR` was configured, run this once on the production server:
   ```bash
   node scripts/copy-legacy-uploads.js
   ```
4. Run:
   ```bash
   npm start
   ```
5. Open `http://localhost:3000`

## Class reminders and parent messaging

- **Messages** in the top bar opens the family inbox. A family and class share one
  conversation with message history and unread counts. Families can start a
  conversation or reply; assigned catechists and parish administrators can respond.
  Conversations are visible to the registering account, the current assigned class
  team, and administrators. Other families and unassigned catechists cannot read them.
- Open a class and choose **Conversations** to message its families, or **Reminders**
  to configure reminder emails. Reminders are off for each class until enabled.
  The default is **one day before class at 18:00 America/New_York**; choose one,
  two, or seven days ahead and an hour. Only saved calendar dates marked **Class Day**
  are included. The calendar's unsaved weekly fallback, retreats, rehearsals, and
  Mass dates do not trigger reminders. Save actual class dates first.
- Reminder recipients follow the active class roster and use the registering
  account's sign-in email, once per account/class/date even with siblings.
  Children's registrations must be admitted/enrolled or conditionally accepted.
  Pending registrations can use conversations but do not receive reminders.
  Existing adult/family class roster rules are also supported.
- Parents can independently disable reminder emails and new-message emails under
  **Messages → Email preferences**. In-app messages remain available. Email
  notifications link to the conversation; replying to notification emails does
  **not** import a reply into the app. The existing class broadcast email feature
  continues to operate separately.

The additive MySQL tables are created on normal startup by `db.init()`. Configure
`SMTP_HOST`, `EMAIL_FROM`, the applicable SMTP credentials, and `APP_BASE_URL` for
email delivery. Set `CLASS_REMINDER_TIMEZONE` to an IANA timezone if needed; it
defaults to `America/New_York` and follows daylight-saving time. The Node app must
remain running: its worker checks once per minute. A same-day restart catches up
after the configured send hour; missed reminder days are skipped to avoid stale mail.
Set `COMMUNICATION_WORKER_ENABLED=false` to pause all reminder and message email
delivery while retaining in-app messaging. No external scheduler is required.

Messages and their email jobs are saved in one database transaction. Database
uniqueness prevents repeated form submissions and duplicate reminder queue entries;
atomic leases prevent simultaneous workers from sending the same queued job.
Failures retry with backoff, up to five attempts. Before sending, the worker checks
current membership, recipient preferences and saved class dates again. Removing a
class date prevents its pending reminder from being sent. The Reminders page shows
recent delivery results; “Sent” means SMTP acceptance, not confirmed inbox delivery.
SMTP cannot guarantee exactly-once delivery: a process crash after SMTP acceptance
but before recording success can result in a repeated email on recovery.

Run the isolated checks without a parish database or real email:

```bash
npm run test:communications
npm run test:communications:ui
```

The UI checks launch a local fixture app with sample accounts and an in-memory
store. They cover screens and routes; deployment still needs MySQL migration and
SMTP verification in the target environment. No real emails are sent by these tests.

## Database
- The app now uses **MySQL** via `mysql2`.
- On startup it creates the configured database if it does not already exist.
- It also creates the required tables and applies additive column migrations automatically.
- Seed data is inserted only when the main tables are empty.

## OAuth setup (free)
- **Google**: create OAuth credentials in Google Cloud Console.
- **GitHub**: create OAuth app in GitHub Developer Settings.
- Set callback URLs:
  - `http://localhost:3000/auth/google/callback`
  - `http://localhost:3000/auth/github/callback`

If OAuth variables are blank, email/password authentication still works.

## Email verification
- New local accounts stay inactive until the verification link is opened.
- Set `APP_BASE_URL` to the externally reachable app URL used in verification links.
- Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` to send real verification emails.
- Without SMTP configuration, the app shows a development-only activation link after signup so the flow can still be tested locally.

## Recent registration form updates
- Registration date is auto-set by the server and shown on the form as read-only context.
- Parent name manual input was removed from the registration page.
- Added a **Primary Parent Contact** section with required phone + email.
- Added relationship choices: **Father/Mother**, **Stepfather/Stepmother**, or **Other**.
- When **Other** is selected, a description field appears.
- Added English/Spanish labels for the new contact and relationship fields.
