# Inventory Auto-Counter using OpenAI Vision

This document details the technical implementation of the AI-powered inventory counting feature and explains existing infrastructure limitations.

## How It Works

The **Auto-Counter** feature allows users to upload images of store shelves to automatically identify products and count their quantities.

### 1. Frontend (`InventoryUploadModal.tsx`)
*   **Image Capture:** Users upload one or more images via the file picker.
*   **Preprocessing:** Images are converted to Base64 strings.
*   **API Request:** The frontend sends a `POST` request to `/api/inventory/analyze` containing the array of Base64 images.
*   **Payload Handling:** We increased the JSON body parser limit to `50mb` to accommodate high-resolution image payloads.

### 2. Backend API (`/api/inventory/analyze`)
*   **Endpoint:** The endpoint is implemented as a Vercel Serverless Function (in `api/inventory/index.ts`).
*   **OpenAI Integration:**
    *   We use the `gpt-4o` model with Vision capabilities.
    *   The prompt instructs the model to return a **strict JSON** array of identified items, including `itemName`, `quantity`, `category`, and `confidence` score.
    *   The prompt includes specific rules like "do not double count" and "ignore background elements".
*   **Response:** The backend parses the JSON response from OpenAI and returns it to the frontend for user verification.

## The Timeout Limitation (504 Gateway Timeout)

Users may experience a **504 Gateway Timeout** error when using this feature on the production deployment.

### Why does this happen?
*   **Computation Time:** Analyzing images with GPT-4o (Vision) is computationally intensive. Depending on the number of images and scene complexity, the API call often takes **15 to 45 seconds** to complete.
*   **Vercel Hobby Plan Limit:** The **Hobby (Free) Tier** of Vercel enforces a strict **10-second timeout** regular serverless functions.
*   **The Conflict:** If OpenAI takes 12 seconds to respond, Vercel kills the connection at 10 seconds, resulting in a 504 error for the client.

### Solution Options

1.  **Upgrade to Vercel Pro ($20/mo):**
    *   The Pro plan increases the serverless function timeout limit to **60 seconds**.
    *   This is the simplest and recommended fix for a production-grade application.

2.  **Optimize Inputs (Workaround):**
    *   Reducing the size/resolution of images before sending them can slightly speed up processing, but rarely enough to consistently beat the 10s limit.

3.  **Use Edge Functions (Partial Solution):**
    *   Vercel Edge Functions have higher timeouts but limited compatibility with certain Node.js APIs and libraries.

4.  **Asynchronous Processing (Complex):**
    *   Architectural change: The UI uploads the image, gets a "Job ID", and polls for results. This requires a background worker queue (like Redis/BullMQ) separate from Vercel's standard request/response cycle.
