# Database Architecture

This document explains the database structure for the ClientBridge system.

---

## Overview

The system uses a **single PostgreSQL database** as the source of truth:

| Database | Type | Location | Purpose |
|----------|------|----------|---------|
| Website DB | PostgreSQL | `clientbridge` | Stores customers, embeddings, users, locations, etc. |

**Server-Side Matching**: The edge device sends face embeddings to the server, which performs matching and stores all data. No local database on the edge device.

**Key Benefits**:
- Deleting a customer on the website immediately stops recognition
- Multiple edge devices can share the same customer database
- All business logic centralized on server

---

## Website Database (PostgreSQL)

### Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  locations  │◄──────│   users     │       │  cameras    │
│             │       │             │       │             │
│ id (PK)     │       │ id (PK)     │       │ id (PK)     │
│ name        │       │ username    │       │ name        │
│ address     │       │ password    │       │ stream_url  │
│ timezone    │       │ role        │       │ location_id │──►
└─────────────┘       │ location_id │──►    │ is_active   │
       │              └─────────────┘       │ status      │
       │                                    └─────────────┘
       │                                           │
       ▼                                           ▼
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  customers  │       │ video_clips │       │   reviews   │
│             │       │             │       │             │
│ id (PK)     │       │ id (PK)     │       │ id (PK)     │
│ face_id     │       │ filename    │       │ clip_id     │──►
│ name        │       │ url         │       │ camera_id   │──►
│ photo_url   │       │ status      │       │ decision    │
│ points      │       │ location_id │──►    │ notes       │
│ is_regular  │       │ camera_id   │──►    └─────────────┘
│ flag        │       └─────────────┘
│ location_id │──►
└─────────────┘

┌─────────────────┐   ┌─────────────────┐
│ inventory_items │   │  notifications  │
│                 │   │                 │
│ id (PK)         │   │ id (PK)         │
│ item_name       │   │ type            │
│ batch_number    │   │ title           │
│ quantity        │   │ message         │
│ expiration_date │   │ related_id      │
│ location_id     │──►│ is_read         │
└─────────────────┘   └─────────────────┘
```

### Tables

#### `locations`
Multi-store support. Each store is a location.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Unique identifier |
| `name` | TEXT | Store name (e.g., "Main St") |
| `created_at` | TIMESTAMP | When created |

#### `users`
Authentication and role management.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Unique identifier |
| `username` | TEXT UNIQUE | Login username |
| `password` | TEXT | Hashed password |
| `role` | TEXT | `owner`, `manager`, or `reviewer` |
| `location_id` | INTEGER FK | Assigned location (null for owners) |
| `created_at` | TIMESTAMP | When created |

**Roles:**
- **owner**: Access to all locations
- **manager**: Access to assigned location only
- **reviewer**: Limited access, can review clips

#### `customers`
Visitor tracking with facial recognition. **This is the main table for the visitor counter.**

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Unique identifier |
| `face_id` | TEXT | Auto-generated ID (e.g., "visitor_1765140674462") |
| `name` | TEXT | Optional name (can be set by manager) |
| `photo_url` | TEXT | Path to face image (e.g., "/customers/visitor_xxx.jpg") |
| `points` | INTEGER | **Visit count** (displayed as "Visits" in UI) |
| `last_seen` | TIMESTAMP | Most recent detection |
| `flag` | TEXT | Manager flag: `red`, `yellow`, `green`, or null |
| `location_id` | INTEGER FK | Which store |
| `embedding` | TEXT | **512-dim face embedding as JSON** (for server-side matching) |

**Note**: `is_regular` is computed on-the-fly as `points >= 5` (not stored).

**Operations**:
- **Delete**: Removes customer and their embedding. They will no longer be recognized.
- **Flag**: Manager can flag customers (red/yellow/green) for staff awareness.
- **Edit name**: Manager can assign a name to identified customers.

#### `cameras`
Live camera feeds.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Unique identifier |
| `name` | TEXT | Camera name |
| `stream_url` | TEXT | RTSP/HLS stream URL |
| `location_id` | INTEGER FK | Which store |
| `is_active` | BOOLEAN | Is camera enabled |
| `status` | TEXT | `pending`, `suspect`, `confirmed_theft`, `clear` |

#### `video_clips`
Uploaded security footage.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Unique identifier |
| `filename` | TEXT | Original filename |
| `url` | TEXT | Path to video file |
| `status` | TEXT | Review status |
| `face_detections` | TEXT | JSON of detected face IDs |
| `location_id` | INTEGER FK | Which store |
| `camera_id` | INTEGER FK | Source camera |

#### `reviews`
Manager/reviewer decisions on clips and cameras.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Unique identifier |
| `clip_id` | INTEGER FK | Related video clip |
| `camera_id` | INTEGER FK | Related camera |
| `reviewer_role` | TEXT | `manager` or `reviewer` |
| `reviewer_username` | TEXT | Who reviewed |
| `decision` | TEXT | `suspect`, `confirmed_theft`, `clear` |
| `notes` | TEXT | Optional notes |

#### `inventory_items`
Store inventory tracking.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Unique identifier |
| `item_name` | TEXT | Product name |
| `batch_number` | TEXT | Batch/lot number |
| `quantity` | INTEGER | Current stock |
| `expiration_date` | TIMESTAMP | Expiry date |
| `category` | TEXT | Optional category |
| `location_id` | INTEGER FK | Which store |

#### `notifications`
System notifications.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Unique identifier |
| `type` | TEXT | `customer_flagged`, `theft_confirmed`, `inventory_expired` |
| `title` | TEXT | Notification title |
| `message` | TEXT | Notification body |
| `related_id` | INTEGER | ID of related entity |
| `is_read` | BOOLEAN | Has been read |

---

## Data Flow (Server-Side Matching)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Camera Feed   │────►│  Edge Device    │────►│    Website      │
│                 │     │  (Jetson/Mac)   │     │   (Express)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │                        │
                               │                        ▼
                               │                 ┌─────────────┐
                               │                 │ PostgreSQL  │
                               │                 │ (customers) │
                               │                 └─────────────┘
                               │                        │
                               │                        ▼
                               │                 ┌─────────────┐
                               └────────────────►│  Matching   │
                                 (embedding)     │  Engine     │
                                                 └─────────────┘
```

1. **Camera** captures video frames
2. **Edge device** detects faces, extracts 512-dim embeddings
3. **Edge device** sends embedding to server via `POST /api/edge/identify`
4. **Server** matches embedding against all stored embeddings (cosine similarity)
5. **Server** decides: new customer or returning visitor
6. **Server** stores/updates customer data in PostgreSQL
7. **Dashboard** displays customer data from PostgreSQL

---

## Operations

| Action | Effect |
|--------|--------|
| New visitor detected | Customer created with embedding, visit count = 1 |
| Returning visitor | Visit count incremented, last_seen updated |
| Delete customer on website | Customer and embedding removed, no longer recognized |
| Flag customer | Flag stored, visible to staff on dashboard |

---

## Useful Commands

### PostgreSQL

```bash
# Connect to database
psql -d clientbridge

# View all customers with visit counts
SELECT id, face_id, name, points as visits, last_seen FROM customers ORDER BY points DESC;

# View customers with embeddings
SELECT id, face_id, points, LENGTH(embedding) as emb_size FROM customers WHERE embedding IS NOT NULL;

# Delete a specific customer (by ID)
DELETE FROM customers WHERE id = 123;

# Clear all customers (CAUTION!)
DELETE FROM customers;

# View schema
\d customers
```
