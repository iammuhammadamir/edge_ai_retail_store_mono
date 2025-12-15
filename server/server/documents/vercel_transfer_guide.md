# Vercel Project Handover Guide

This document outlines the steps to transfer ownership of the **ClientBridge** (Smoothflow AI) deployment to a client's Vercel account.

## Option 1: Transferring the Project (Recommended)
**Best for:** Keeping the existing deployment history, domains, and environment variables.

1.  **Log in** to your [Vercel Dashboard](https://vercel.com/dashboard).
2.  Navigate to the **ClientBridge** project.
3.  Go to **Settings** > **General**.
4.  Scroll down to the **Transfer Project** section.
5.  Enter the client's **Vercel Usage Scope/Team Slug** or their email address.
    *   *Note:* It is often easier if the client creates a Team on Vercel first.
6.  Click **Transfer**.
7.  The client will receive an email/notification to accept the transfer.

## Option 2: Client Deploys from Scratch
**Best for:** A clean start or if the client wants full control over the repository connection from their own GitHub account.

### Prerequisites for the Client
*   A Vercel Account.
*   Access to the GitHub Repository (you may need to transfer the repo or invite them).
*   The following **Environment Variables** (copy these from your current `.env` or Vercel Settings):
    *   `DATABASE_URL` (Supabase connection string, refer to Supabase Guide)
    *   `OPENAI_API_KEY`
    *   `VITE_RECAPTCHA_SITE_KEY`
    *   `SESSION_SECRET`

### Steps
1.  **Client** logs into Vercel and clicks **"Add New..."** > **"Project"**.
2.  Import the GitHub repository.
3.  In the "Configure Project" step:
    *   **Framework Preset:** Vite (usually auto-detected).
    *   **Root Directory:** `server` (Important! The project is in a subdirectory).
    *   **Environment Variables:** Add the variables listed above.
4.  Click **Deploy**.

## Post-Handover Check
*   Verify the domain name (DNS) settings if a custom domain was used.
*   Ensure the client has updated the billing details if they are on a Pro plan (required for higher timeouts).
