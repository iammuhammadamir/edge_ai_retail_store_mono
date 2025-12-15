# Inventory Image Upload Feature Analysis

## Goal
Allow users to upload multiple images of products to the Inventory page. The system will use OpenAI's Vision API to identify products and quantities, returning a JSON structure to populate the inventory database.

## Architecture & Safety Analysis

### 1. Security & Dependencies
*   **Dependency**: We need to add `openai` to `server/package.json`.
*   **Environment**: `OPENAI_API_KEY` must be set in `.env`.
*   **Validation**: The backend must validate that uploaded files are images and enforce size limits (e.g., 5MB per image, max 5 images per batch) to prevent DoS or high API costs.

### 2. Backend Implementation (`server/server/routes.ts`)
*   **New Endpoint**: `POST /api/inventory/analyze`
*   **Middleware**: Use `multer` (already configured) to handle multipart form uploads.
*   **Processing**:
    1.  Receive `files` array.
    2.  Convert images to Base64 (since we don't need permanent storage for analysis).
    3.  Call OpenAI API (`gpt-4o`).
    4.  **Prompt Engineering**: Instruct the model to return a **strict JSON array** object adhering to our schema:
        ```json
        [
          { "itemName": "Product Name", "quantity": 5, "category": "Likely Category", "confidence": 0.95 }
        ]
        ```
    5.  **Response**: Return this JSON to the frontend. **Do not write to DB yet.**

### 3. Frontend Implementation (`Dashboard.tsx`)
*   **UI Components**:
    *   **"Upload New Images" Button**: Placed next to "Add New Item".
    *   **Upload Modal**:
        *   File Input (Multiple).
        *   Preview Grid (Thumbnails).
        *   "Upload More" button (append to list).
        *   "Finish" button (submits to API).
    *   **Review Dialog**:
        *   Displays the AI-detected items.
        *   Allows user to **Edit** name/quantity/category (AI is not perfect).
        *   "Confirm & Save" button (calls `POST /api/inventory` for each item).

### 4. Safety & "Human-in-the-loop"
*   **Why not auto-insert?**
    *   AI can hallucinate (e.g., seeing 12 eggs instead of 10).
    *   Product names might be inconsistent (e.g., "Coke" vs "Coca-Cola 2L").
*   **Solution**: The "Review Dialog" is the critical safety mechanism. It ensures the user verifies the AI's work before the database is touched.

## Implementation Steps
1.  **Install**: `npm install openai` in `server/`.
2.  **Backend**: Implement `analyze` route with OpenAI SDK.
3.  **Frontend**: Create the Upload Modal and Review Modal state/UI.
4.  **Integration**: Connect the flow.
