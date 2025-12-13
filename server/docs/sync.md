# Edge Device ↔ Website Sync Design

This document analyzes approaches for keeping the edge device and website databases synchronized.

---

## Current Problem

```
┌─────────────────┐                    ┌─────────────────┐
│  Edge Device    │                    │    Website      │
│  (SQLite)       │                    │  (PostgreSQL)   │
├─────────────────┤                    ├─────────────────┤
│ visitors        │  ──── ONE WAY ───► │ customers       │
│ - id            │      (API calls)   │ - id            │
│ - embedding     │                    │ - face_id       │
│ - visit_count   │                    │ - points        │
└─────────────────┘                    └─────────────────┘

Problems:
1. Delete on website → Edge still recognizes person
2. Edit name on website → Edge doesn't know
3. Flag customer on website → Edge doesn't know
4. Edge offline → Data diverges
```

---

## Design Options

### Option 1: Website as Single Source of Truth (Recommended)

**Concept**: Store embeddings on the website. Edge device queries website for matching.

```
┌─────────────────┐                    ┌─────────────────┐
│  Edge Device    │ ◄───── SYNC ─────► │    Website      │
│  (Cache only)   │                    │  (PostgreSQL)   │
├─────────────────┤                    ├─────────────────┤
│ Local cache of  │                    │ customers       │
│ embeddings for  │                    │ - embedding     │ ← NEW
│ offline use     │                    │ - face_id       │
└─────────────────┘                    │ - points        │
                                       └─────────────────┘
```

**Flow**:
1. Edge device starts → Downloads all embeddings from website
2. Face detected → Match locally (fast)
3. New visitor → Upload to website, get ID back
4. Returning visitor → Report visit to website
5. Periodic sync → Pull latest embeddings (catches deletes/updates)

**Pros**:
- Single source of truth
- Deletes propagate automatically
- Multiple edge devices can share same data
- Easy backup (just backup website DB)

**Cons**:
- Requires storing embeddings on website (512 floats × 4 bytes = 2KB per customer)
- Initial sync required on startup
- Need to handle offline gracefully

**Implementation Effort**: Medium (2-3 days)

---

### Option 2: Event-Based Sync (Push from Website)

**Concept**: Website pushes changes to edge device via webhooks or polling.

```
Website Action          →    Edge Device Action
─────────────────────────────────────────────────
Delete customer         →    Remove from local DB
Update customer name    →    Update local cache
Flag customer           →    Update local cache
```

**Flow**:
1. Edge device polls `/api/edge/sync?since=<timestamp>` every N seconds
2. Website returns list of changes since last sync
3. Edge device applies changes locally

**API Response Example**:
```json
{
  "changes": [
    {"action": "delete", "face_id": "visitor_5"},
    {"action": "update", "face_id": "visitor_3", "flag": "red"},
    {"action": "create", "face_id": "visitor_10", "embedding": [...]}
  ],
  "sync_timestamp": "2025-12-07T02:30:00Z"
}
```

**Pros**:
- Edge device stays autonomous
- Works with intermittent connectivity
- Minimal changes to current architecture

**Cons**:
- Polling adds latency (delete takes N seconds to propagate)
- More complex conflict resolution
- Embeddings still duplicated

**Implementation Effort**: Medium (2-3 days)

---

### Option 3: Hybrid - Local Primary with Sync Markers

**Concept**: Edge device is primary for recognition, website tracks "deleted" markers.

```
┌─────────────────┐                    ┌─────────────────┐
│  Edge Device    │                    │    Website      │
├─────────────────┤                    ├─────────────────┤
│ visitors        │                    │ customers       │
│ - id            │                    │ - face_id       │
│ - embedding     │                    │ - is_deleted    │ ← NEW
│ - is_synced     │ ← NEW              │ - deleted_at    │ ← NEW
└─────────────────┘                    └─────────────────┘
```

**Flow**:
1. Delete on website → Mark `is_deleted = true` (soft delete)
2. Edge device polls for deleted face_ids
3. Edge device removes from local DB
4. Edge device confirms deletion to website

**Pros**:
- Minimal changes to current flow
- Edge device stays fast (local matching)
- Handles offline well

**Cons**:
- Soft deletes accumulate (need cleanup job)
- Only handles deletes, not updates

**Implementation Effort**: Low (1 day)

---

## Recommendation

### For MVP (Now): Option 3 - Soft Delete Sync

Simplest to implement, solves the main pain point (deleted customers still recognized).

### For Production (Later): Option 1 - Website as Source of Truth

More robust, supports multiple edge devices, easier to manage.

---

## Recommended Implementation: Soft Delete Sync

### Step 1: Add Sync Endpoint to Website

```typescript
// server/edgeRoutes.ts

// GET /api/edge/sync - Get deleted customers since timestamp
router.get("/sync", authenticateEdge, async (req, res) => {
  const since = req.query.since as string; // ISO timestamp
  
  const deleted = await db
    .select({ faceId: customers.faceId })
    .from(customers)
    .where(
      and(
        eq(customers.isDeleted, true),
        gte(customers.deletedAt, new Date(since))
      )
    );
  
  res.json({
    success: true,
    deleted: deleted.map(d => d.faceId),
    syncTimestamp: new Date().toISOString()
  });
});
```

### Step 2: Modify Customer Delete (Soft Delete)

```typescript
// Instead of:
await db.delete(customers).where(eq(customers.id, id));

// Do:
await db.update(customers)
  .set({ isDeleted: true, deletedAt: new Date() })
  .where(eq(customers.id, id));
```

### Step 3: Add Sync to Edge Device

```python
# api_client.py

def get_deleted_customers(self, since: str) -> List[str]:
    """Get list of face_ids deleted since timestamp"""
    response = requests.get(
        f"{self.base_url}/api/edge/sync",
        params={"since": since},
        headers=self._get_headers()
    )
    if response.ok:
        return response.json().get("deleted", [])
    return []
```

```python
# visitor_counter.py - Add periodic sync

import threading
import time

def sync_deletions(api, known_embeddings, last_sync):
    """Background thread to sync deletions"""
    while True:
        time.sleep(30)  # Check every 30 seconds
        
        deleted = api.get_deleted_customers(last_sync)
        for face_id in deleted:
            # Remove from local cache
            visitor_id = int(face_id.replace("visitor_", ""))
            known_embeddings = [
                (vid, emb) for vid, emb in known_embeddings 
                if vid != visitor_id
            ]
            # Remove from local DB
            db.delete_visitor(visitor_id)
        
        last_sync = datetime.now().isoformat()
```

### Step 4: Database Schema Changes

```sql
-- Website: Add soft delete columns
ALTER TABLE customers ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN deleted_at TIMESTAMP;

-- Edge: Add delete function
-- (Already have the table, just need delete function)
```

---

## Data Flow After Implementation

```
┌──────────────────────────────────────────────────────────────┐
│                        NORMAL FLOW                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Camera → Edge Device → Match locally → Report to Website    │
│                                                              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                        DELETE FLOW                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Manager clicks delete on website                         │
│  2. Website marks customer as deleted (soft delete)          │
│  3. Edge device polls /api/edge/sync every 30s               │
│  4. Edge device receives deleted face_ids                    │
│  5. Edge device removes from local DB and memory             │
│  6. Customer no longer recognized ✓                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Future Enhancements

### Multi-Device Support
If you have multiple edge devices (multiple stores), each needs to sync:

```
                    ┌─────────────────┐
                    │    Website      │
                    │  (PostgreSQL)   │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │ Edge Dev 1  │   │ Edge Dev 2  │   │ Edge Dev 3  │
    │ (Store A)   │   │ (Store B)   │   │ (Store C)   │
    └─────────────┘   └─────────────┘   └─────────────┘
```

Each device syncs independently based on its `location_id`.

### Real-Time Sync (WebSocket)
For instant sync, use WebSocket instead of polling:

```
Website delete → WebSocket push → Edge device removes immediately
```

### Conflict Resolution
If same person is detected by two devices simultaneously:
- Use `face_id` as unique key
- First device to enroll wins
- Second device gets "already exists" and records visit instead

---

## Implementation Priority

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| 1 | Soft delete sync (deletes propagate) | 1 day | High |
| 2 | Flag sync (red flags propagate) | 0.5 day | Medium |
| 3 | Name sync (names propagate) | 0.5 day | Low |
| 4 | Full embedding sync (Option 1) | 2-3 days | High |

---

## Next Steps

1. **Decide**: Which option to implement first?
2. **Schema**: Add `is_deleted` and `deleted_at` columns
3. **API**: Add `/api/edge/sync` endpoint
4. **Edge**: Add sync polling to visitor_counter.py
5. **Test**: Delete customer on website, verify edge stops recognizing

Ready to implement when you are!
