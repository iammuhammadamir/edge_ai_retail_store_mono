# Server-Side Matching Migration Plan

This document outlines the migration from the current dual-database architecture to a server-side matching architecture where the website is the single source of truth.

---

## Current Architecture (Before)

```
┌─────────────────────────────────────────────────────────────────┐
│                         EDGE DEVICE                             │
├─────────────────────────────────────────────────────────────────┤
│  1. Detect face                                                 │
│  2. Extract embedding (512-dim vector)                          │
│  3. Match against LOCAL SQLite DB  ◄── Problem: duplicated DB  │
│  4. Decide: new or returning                                    │
│  5. Call API: /api/edge/enroll OR /api/edge/visit               │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                         WEBSITE                                 │
├─────────────────────────────────────────────────────────────────┤
│  - Receives pre-decided result (new/returning)                  │
│  - Stores customer info (but NOT embeddings)                    │
│  - No matching logic                                            │
└─────────────────────────────────────────────────────────────────┘

Problems:
├── Two databases that can get out of sync
├── Deleting customer on website doesn't affect edge recognition
├── Edge device has complex matching logic
└── Can't share customers across multiple edge devices
```

---

## Target Architecture (After)

```
┌─────────────────────────────────────────────────────────────────┐
│                         EDGE DEVICE                             │
├─────────────────────────────────────────────────────────────────┤
│  1. Detect face                                                 │
│  2. Extract embedding (512-dim vector)                          │
│  3. Send embedding to server  ──────────────────────────────►   │
│  4. Receive result (new/returning + customer ID)                │
│                                                                 │
│  NO local database, NO matching logic                           │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                         WEBSITE                                 │
├─────────────────────────────────────────────────────────────────┤
│  1. Receive embedding from edge device                          │
│  2. Load all embeddings for this location from DB               │
│  3. Compute cosine similarity (matching)                        │
│  4. Decide: new customer or returning visitor                   │
│  5. Store/update customer record                                │
│  6. Return result to edge device                                │
└─────────────────────────────────────────────────────────────────┘

Benefits:
├── Single source of truth (website DB only)
├── Delete on website = immediate effect
├── Edge device is simple (detect + extract + send)
├── Multiple edge devices can share same customer DB
└── All business logic centralized on server
```

---

## What to Remove (Cleanup)

### Edge Device Files

| File | Action | Reason |
|------|--------|--------|
| `database.py` | **DELETE** | No longer needed - no local DB |
| `visitors.db` | **DELETE** | SQLite database file |
| `visitor_images/` | **DELETE** | Local image storage (images go to server) |

### Edge Device Code Changes

| File | Change |
|------|--------|
| `visitor_counter.py` | Remove all `db.*` calls, remove `known_embeddings` cache |
| `visitor_counter.py` | Remove matching logic (`find_best_match`) |
| `visitor_counter.py` | Simplify to: detect → extract → send to API |
| `config.py` | Remove `DB_PATH`, `OUTPUT_DIR` |
| `api_client.py` | Replace `enroll_visitor()` and `record_visit()` with single `identify()` |

### Website API Changes

| Endpoint | Action |
|----------|--------|
| `POST /api/edge/enroll` | **REMOVE** - replaced by `/identify` |
| `POST /api/edge/visit` | **REMOVE** - replaced by `/identify` |
| `POST /api/edge/identify` | **ADD** - new unified endpoint |
| `GET /api/edge/health` | **KEEP** - still useful |

---

## What to Add

### 1. Database Schema Change

Add `embedding` column to store face embeddings on the server:

```sql
-- Migration: Add embedding column to customers table
ALTER TABLE customers ADD COLUMN embedding BYTEA;

-- The embedding is a 512-dimensional float32 array
-- Size: 512 × 4 bytes = 2,048 bytes (2KB) per customer
```

**Schema file change** (`shared/schema.ts`):

```typescript
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  faceId: text("face_id").notNull(),
  name: text("name"),
  photoUrl: text("photo_url"),
  points: integer("points").notNull().default(0),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  flag: text("flag"),
  locationId: integer("location_id").notNull().references(() => locations.id),
  embedding: text("embedding"),  // NEW: Base64-encoded float32 array
});
```

### 2. New API Endpoint

**File**: `server/edgeRoutes.ts`

```typescript
/**
 * POST /api/edge/identify
 * 
 * Unified endpoint for face identification.
 * Server performs matching and decides if new or returning.
 * 
 * Request:
 * {
 *   "embedding": [0.1, 0.2, ...],  // 512 floats
 *   "imageBase64": "...",          // Face image (optional)
 *   "locationId": 1
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "status": "new" | "returning",
 *   "customerId": 123,
 *   "visitCount": 5,
 *   "similarity": 0.87  // Only for returning customers
 * }
 */
app.post("/api/edge/identify", requireApiKey, async (req, res) => {
  const { embedding, imageBase64, locationId } = req.body;
  
  // 1. Get all customers with embeddings for this location
  const customers = await storage.getCustomersWithEmbeddings(locationId);
  
  // 2. Find best match using cosine similarity
  const match = findBestMatch(embedding, customers, SIMILARITY_THRESHOLD);
  
  if (match) {
    // 3a. Returning customer - increment visit count
    const updated = await storage.incrementCustomerPoints(match.faceId);
    return res.json({
      success: true,
      status: "returning",
      customerId: updated.id,
      visitCount: updated.points,
      similarity: match.similarity
    });
  } else {
    // 3b. New customer - create record
    const faceId = `visitor_${Date.now()}`;
    const photoUrl = imageBase64 ? saveBase64Image(imageBase64, faceId) : null;
    
    const customer = await storage.createCustomer({
      faceId,
      embedding: JSON.stringify(embedding),  // Store as JSON string
      photoUrl,
      points: 1,
      locationId
    });
    
    return res.json({
      success: true,
      status: "new",
      customerId: customer.id,
      visitCount: 1
    });
  }
});
```

### 3. Server-Side Matching Function

**File**: `server/matching.ts` (new file)

```typescript
/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find best matching customer for given embedding
 */
export function findBestMatch(
  embedding: number[],
  customers: Array<{ id: number; faceId: string; embedding: string }>,
  threshold: number = 0.45
): { id: number; faceId: string; similarity: number } | null {
  
  let bestMatch = null;
  let bestSimilarity = threshold;
  
  for (const customer of customers) {
    if (!customer.embedding) continue;
    
    const customerEmbedding = JSON.parse(customer.embedding);
    const similarity = cosineSimilarity(embedding, customerEmbedding);
    
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = {
        id: customer.id,
        faceId: customer.faceId,
        similarity
      };
    }
  }
  
  return bestMatch;
}
```

### 4. Simplified Edge Device API Client

**File**: `Edge_AI_For_Retail_Stores/api_client.py`

```python
class ClientBridgeAPI:
    """Simplified API client - only sends embeddings to server"""
    
    def identify(
        self,
        embedding: np.ndarray,
        frame: Optional[np.ndarray] = None
    ) -> APIResponse:
        """
        Send embedding to server for identification.
        Server decides if new or returning customer.
        
        Args:
            embedding: 512-dim face embedding
            frame: Optional face image
        
        Returns:
            APIResponse with status ("new" or "returning"), customerId, visitCount
        """
        payload = {
            "embedding": embedding.tolist(),  # Convert numpy to list
            "locationId": self.location_id
        }
        
        if frame is not None:
            payload["imageBase64"] = self._frame_to_base64(frame)
        
        response = requests.post(
            f"{self.base_url}/api/edge/identify",
            json=payload,
            headers=self._get_headers(),
            timeout=self.timeout
        )
        
        data = response.json()
        return APIResponse(
            success=data.get("success", False),
            status=data.get("status"),  # "new" or "returning"
            customer_id=data.get("customerId"),
            visit_count=data.get("visitCount"),
            similarity=data.get("similarity"),
            message=data.get("message", "")
        )
```

### 5. Simplified Edge Device Main Loop

**File**: `Edge_AI_For_Retail_Stores/visitor_counter.py`

```python
def run_visitor_counter():
    """Simplified main loop - no local DB, no matching"""
    
    # Initialize API client
    api = ClientBridgeAPI(
        base_url=cfg.API_BASE_URL,
        api_key=cfg.API_KEY,
        location_id=cfg.API_LOCATION_ID
    )
    
    # Initialize face analyzer
    face_analyzer = get_face_analyzer()
    
    # Connect to camera
    cap = cv2.VideoCapture(cfg.RTSP_URL)
    
    while True:
        ret, frame = cap.read()
        if not ret:
            continue
        
        # Detect face
        faces = face_analyzer.get(frame)
        if not faces:
            continue
        
        # Get best quality frame (existing logic)
        best_frame, best_face = capture_best_frame(cap, faces[0])
        
        # Extract embedding
        embedding = best_face.embedding
        
        # Send to server - server decides new vs returning
        result = api.identify(embedding, best_frame)
        
        if result.success:
            if result.status == "new":
                logger.info(f"NEW customer #{result.customer_id}")
            else:
                logger.info(f"RETURNING customer #{result.customer_id} "
                           f"(visit #{result.visit_count}, similarity: {result.similarity:.2f})")
        else:
            logger.error(f"API error: {result.message}")
        
        # Cooldown
        time.sleep(cfg.COOLDOWN_SECONDS)
```

---

## Migration Steps

### Phase 1: Prepare Server (No Breaking Changes)

1. **Add embedding column to database**
   ```bash
   psql -d clientbridge -c "ALTER TABLE customers ADD COLUMN embedding TEXT;"
   ```

2. **Create `server/matching.ts`** with cosine similarity function

3. **Add `/api/edge/identify` endpoint** (new endpoint, doesn't affect existing)

4. **Test new endpoint** with curl or Postman

### Phase 2: Update Edge Device

5. **Update `api_client.py`** - add `identify()` method

6. **Update `visitor_counter.py`**:
   - Remove `import database as db`
   - Remove `known_embeddings` loading
   - Remove `find_best_match()` calls
   - Replace `api.enroll_visitor()` / `api.record_visit()` with `api.identify()`

7. **Test edge device** with new API

### Phase 3: Cleanup

8. **Delete unused files**:
   ```bash
   cd Edge_AI_For_Retail_Stores
   rm database.py
   rm visitors.db
   rm -rf visitor_images/
   ```

9. **Remove old API endpoints** from `server/edgeRoutes.ts`:
   - Delete `/api/edge/enroll`
   - Delete `/api/edge/visit`

10. **Update config.py** - remove `DB_PATH`, `OUTPUT_DIR`

---

## File Changes Summary

### Files to DELETE

| Path | Type |
|------|------|
| `Edge_AI_For_Retail_Stores/database.py` | Python module |
| `Edge_AI_For_Retail_Stores/visitors.db` | SQLite database |
| `Edge_AI_For_Retail_Stores/visitor_images/` | Directory |

### Files to CREATE

| Path | Purpose |
|------|---------|
| `ClientBridge/server/matching.ts` | Cosine similarity matching |

### Files to MODIFY

| Path | Changes |
|------|---------|
| `ClientBridge/shared/schema.ts` | Add `embedding` column |
| `ClientBridge/server/edgeRoutes.ts` | Add `/identify`, remove `/enroll` and `/visit` |
| `ClientBridge/server/dbStorage.ts` | Add `getCustomersWithEmbeddings()` |
| `Edge_AI_For_Retail_Stores/api_client.py` | Replace with single `identify()` method |
| `Edge_AI_For_Retail_Stores/visitor_counter.py` | Remove DB logic, simplify to detect→extract→send |
| `Edge_AI_For_Retail_Stores/config.py` | Remove `DB_PATH`, `OUTPUT_DIR` |

---

## Rollback Plan

If issues arise, rollback is straightforward:

1. **Keep old endpoints** until new system is verified
2. **Edge device can switch back** by changing API calls
3. **Database column** (`embedding`) can be ignored if not used

---

## Performance Considerations

### Server Load

| Customers | Matching Time | Memory |
|-----------|---------------|--------|
| 100 | ~1ms | 200KB |
| 1,000 | ~5ms | 2MB |
| 10,000 | ~50ms | 20MB |

For typical retail (< 1000 customers per location), this is negligible.

### Network

| Data | Size |
|------|------|
| Embedding | 2KB (512 floats) |
| Image | 20-50KB (compressed JPEG) |
| Total request | ~50KB |

At 1 request per 10 seconds, this is ~5KB/s - trivial for any network.

### Offline Handling

If server is unreachable:
- Edge device should retry with exponential backoff
- Optionally: queue requests locally and send when connection restored
- For MVP: just log error and skip (customer will be counted on next visit)

---

## Testing Checklist

- [ ] New `/api/edge/identify` endpoint works
- [ ] New customer creates record with embedding
- [ ] Returning customer increments visit count
- [ ] Similarity threshold works correctly
- [ ] Image upload and storage works
- [ ] Edge device sends embeddings correctly
- [ ] Dashboard shows customers correctly
- [ ] Delete customer → not recognized anymore (main benefit!)

---

## Ready to Implement?

Run these commands to start:

```bash
# 1. Add embedding column
psql -d clientbridge -c "ALTER TABLE customers ADD COLUMN embedding TEXT;"

# 2. Verify column added
psql -d clientbridge -c "\d customers"
```

Then proceed with code changes as outlined above.
