# Supabase Project Handover Guide

This document outlines options for transferring the database and backend services hosted on Supabase to a client.

## Option 1: Transferring the Organization (Easiest)
**Best for:** If the project is in its own Organization and you want to hand over everything including billing.

1.  Log in to the [Supabase Dashboard](https://supabase.com/dashboard).
2.  Go to the **Settings** of your Organization.
3.  Invite the client's email address as an **Owner**.
4.  Once they accept, you can leave the organization or step down to a lower role.
5.  The client will now be responsible for billing.

## Option 2: Transferring just the Project
**Best for:** If you have multiple projects in one Org and only want to move this specific one.

1.  Navigate to the **ClientBridge** project in Supabase.
2.  Go to **Settings** > **General**.
3.  Scroll to **Transfer Project**.
4.  Enter the name of the **Client's Organization** (they must create one first and invite you, or provide their details).
5.  Initiate the transfer.

## Option 3: Logic Dump & Restore (Manual Migration)
**Best for:** If direct transfer isn't possible, or the client wants to host it themselves/start fresh.

### 1. Export Data (pg_dump)
You can dump the entire database schema and data using the CLI or Dashboard.
*   **Dashboard:** Go to **Database** > **Backups** > **Export Database**.
*   **CLI:**
    ```bash
    supabase db dump --db-url "YOUR_CONNECTION_STRING" -f schema.sql
    ```

### 2. Client Sets Up New Project
1.  Client creates a new Supabase project.
2.  They go to the **SQL Editor**.
3.  They paste and run the contents of your `schema.sql` (or restore from backup).

### 3. Update Environment Variables
If the project is moved or a new one is created, you **MUST** update the application's environment variables in Vercel:

*   `DATABASE_URL`: Get the new Transaction Pooler URL from Supabase (**Settings** > **Database** > **Connection Pooling**).
    *   *Format:* `postgres://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true`
*   `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`: Update these if your app uses them individually.

## Important Note on Storage & Auth
*   **Storage:** If you have files in Supabase Storage (like inventory images), you may need to manually download and re-upload them if you do a manual migration (Option 3). Options 1 & 2 preserve storage.
*   **Auth:** User accounts (hashes) are preserved in Options 1 & 2. For Option 3, migrating users with passwords requires special care (exporting `auth.users` schema).
