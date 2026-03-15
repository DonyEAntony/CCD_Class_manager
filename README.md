# St Matthew CCD Class Manager (Node.js)

Web app for **Saint Matthew Catholic Church Religious Education (School Year 2025-2026)**.

## Features
- Email/password sign-up and login.
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
  - $150 (one child) / $200 (family)
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
3. Run:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000`

## OAuth setup (free)
- **Google**: create OAuth credentials in Google Cloud Console.
- **GitHub**: create OAuth app in GitHub Developer Settings.
- Set callback URLs:
  - `http://localhost:3000/auth/google/callback`
  - `http://localhost:3000/auth/github/callback`

If OAuth variables are blank, email/password authentication still works.
