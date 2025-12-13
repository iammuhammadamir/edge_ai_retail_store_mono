# Phase 1: Supabase Database Setup (Face Recognition Only)

This phase focuses **only** on setting up the database tables needed for the face recognition module.

---

## What We Need

For face recognition to work, we only need **2 tables**:

| Table         | Purpose                                             |
| ------------- | --------------------------------------------------- |
| `locations` | Store locations (required for customer foreign key) |
| `customers` | Store face embeddings, visit counts, customer data  |

Everything else (users, auth, cameras, inventory, etc.) can wait.

---

## Step-by-Step Guide

### Step 1: Create Supabase Account & Project

1. Go to https://supabase.com
2. Click "Start your project" → Sign up with GitHub
3. Click "New Project"
4. Fill in:
   - **Organization**: Create or select one
   - **Project name**: `clientbridge` (or your choice)
   - **Database password**: Click "Generate" and **SAVE THIS PASSWORD**
   - **Region**: Choose closest to you (e.g., `East US` or `Singapore`)
5. Click "Create new project"
6. Wait ~2 minutes for provisioning

**Checkpoint**: You should see the Supabase dashboard

---

### Step 2: Get Connection String

1. In Supabase dashboard, click **Settings** (gear icon) → **Database**
2. Scroll to **Connection string** section
3. Select **URI** tab
4. Copy the connection string - it looks like:
   ```
   postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
5. Replace `[YOUR-PASSWORD]` with the password you saved in Step 1

**Save this connection string** - we'll need it later.

---

### Step 3: Create Database Tables

1. In Supabase dashboard, click **SQL Editor** (left sidebar)
2. Click **New query**
3. Paste this SQL:

```sql
-- =============================================
-- FACE RECOGNITION MODULE - DATABASE SCHEMA
-- =============================================

-- 1. Locations table (required for customer foreign key)
CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 2. Customers table (stores face embeddings and visit data)
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  face_id TEXT NOT NULL,
  name TEXT,
  photo_url TEXT,
  points INTEGER DEFAULT 1 NOT NULL,
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  flag TEXT CHECK (flag IN ('red', 'yellow', 'green', NULL)),
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  embedding TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Index for faster lookups by location
CREATE INDEX IF NOT EXISTS idx_customers_location ON customers(location_id);

-- Index for face_id lookups (used during identification)
CREATE INDEX IF NOT EXISTS idx_customers_face_id ON customers(face_id);

-- =============================================
-- SEED DATA
-- =============================================

-- Create default location
INSERT INTO locations (name) VALUES ('Main Store')
ON CONFLICT DO NOTHING;

-- Verify tables created
SELECT 'locations' as table_name, COUNT(*) as row_count FROM locations
UNION ALL
SELECT 'customers' as table_name, COUNT(*) as row_count FROM customers;
```

4. Click **Run** (or Cmd+Enter)

**Checkpoint**: You should see:

```
table_name  | row_count
------------|----------
locations   | 1
customers   | 0
```

---

### Step 4: Verify Setup

Run this query to confirm everything is correct:

```sql
-- Check locations table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'locations'
ORDER BY ordinal_position;

-- Check customers table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'customers'
ORDER BY ordinal_position;

-- Check the default location exists
SELECT * FROM locations;
```

**Expected output for locations**:

| column_name | data_type                | is_nullable |
| ----------- | ------------------------ | ----------- |
| id          | integer                  | NO          |
| name        | text                     | NO          |
| created_at  | timestamp with time zone | NO          |

**Expected output for customers**:

| column_name | data_type                | is_nullable |
| ----------- | ------------------------ | ----------- |
| id          | integer                  | NO          |
| face_id     | text                     | NO          |
| name        | text                     | YES         |
| photo_url   | text                     | YES         |
| points      | integer                  | NO          |
| last_seen   | timestamp with time zone | NO          |
| flag        | text                     | YES         |
| location_id | integer                  | NO          |
| embedding   | text                     | YES         |
| created_at  | timestamp with time zone | NO          |

---

### Step 5: Test Insert & Query

Let's test that we can insert and query a customer:

```sql
-- Insert a test customer (simulating what edge device does)
INSERT INTO customers (face_id, name, points, location_id, embedding)
VALUES (
  'test_visitor_123',
  'Test Customer',
  1,
  1,
  '[0.1, 0.2, 0.3, 0.4, 0.5]'  -- Simplified embedding for test
)
RETURNING *;

-- Query customers for location 1
SELECT id, face_id, name, points, last_seen, embedding IS NOT NULL as has_embedding
FROM customers
WHERE location_id = 1;

-- Clean up test data
DELETE FROM customers WHERE face_id = 'test_visitor_123';
```

**Checkpoint**: Insert should return the created customer, query should show it, delete should remove it.

---

### Step 6: Save Credentials

Create a local file to store your credentials (DO NOT commit this):

```bash
# In your project root, create .env.supabase (add to .gitignore)
```

Contents:

```
SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_ANON_KEY=eyJ...  # From Settings → API → anon public
SUPABASE_SERVICE_KEY=eyJ...  # From Settings → API → service_role (secret!)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

To find these:

1. **SUPABASE_URL**: Settings → API → Project URL
2. **SUPABASE_ANON_KEY**: Settings → API → anon public
3. **SUPABASE_SERVICE_KEY**: Settings → API → service_role (click "Reveal")
4. **DATABASE_URL**: Settings → Database → Connection string → URI

---

## Verification Checklist

- [ ] Supabase account created
- [ ] Project created and provisioned
- [ ] Connection string saved
- [ ] `locations` table created
- [ ] `customers` table created
- [ ] Default "Main Store" location exists
- [ ] Test insert/query/delete works
- [ ] Credentials saved locally

---

## What's Next

Once this is done, we can:

1. Update the server code to use Supabase instead of local PostgreSQL
2. Test that the edge device can still identify customers
3. Verify the dashboard still shows customer data

---

## Quick Reference

### Table: `locations`

| Column         | Type      | Description   |
| -------------- | --------- | ------------- |
| `id`         | SERIAL    | Primary key   |
| `name`       | TEXT      | Location name |
| `created_at` | TIMESTAMP | When created  |

### Table: `customers`

| Column          | Type      | Description               |
| --------------- | --------- | ------------------------- |
| `id`          | SERIAL    | Primary key               |
| `face_id`     | TEXT      | Unique face identifier    |
| `name`        | TEXT      | Customer name (optional)  |
| `photo_url`   | TEXT      | Face photo URL (optional) |
| `points`      | INTEGER   | Visit count               |
| `last_seen`   | TIMESTAMP | Last detection time       |
| `flag`        | TEXT      | red/yellow/green/null     |
| `location_id` | INTEGER   | FK to locations           |
| `embedding`   | TEXT      | JSON array of 512 floats  |
| `created_at`  | TIMESTAMP | When first seen           |
