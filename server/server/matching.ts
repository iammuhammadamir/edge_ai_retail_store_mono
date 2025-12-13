/**
 * Face embedding matching utilities.
 * Server-side cosine similarity matching for face recognition.
 */

export interface CustomerWithEmbedding {
  id: number;
  faceId: string;
  embedding: string | null;
}

export interface MatchResult {
  id: number;
  faceId: string;
  similarity: number;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns value between -1 and 1, where 1 means identical.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;
  
  return dotProduct / magnitude;
}

/**
 * Find the best matching customer for a given embedding.
 * 
 * @param embedding - The 512-dimensional face embedding to match
 * @param customers - List of customers with their embeddings
 * @param threshold - Minimum similarity score to consider a match (default: 0.45)
 * @returns The best matching customer or null if no match above threshold
 */
export function findBestMatch(
  embedding: number[],
  customers: CustomerWithEmbedding[],
  threshold: number = 0.45
): MatchResult | null {
  
  let bestMatch: MatchResult | null = null;
  let bestSimilarity = threshold;
  
  let allSimilarities: { id: number; similarity: number }[] = [];
  
  for (const customer of customers) {
    // Skip customers without embeddings
    if (!customer.embedding) continue;
    
    try {
      const customerEmbedding: number[] = JSON.parse(customer.embedding);
      const similarity = cosineSimilarity(embedding, customerEmbedding);
      
      allSimilarities.push({ id: customer.id, similarity });
      
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = {
          id: customer.id,
          faceId: customer.faceId,
          similarity
        };
      }
    } catch (e) {
      // Skip invalid embeddings
      console.warn(`Invalid embedding for customer ${customer.id}`);
    }
  }
  
  // Debug: log top similarities
  if (allSimilarities.length > 0) {
    allSimilarities.sort((a, b) => b.similarity - a.similarity);
    const top3 = allSimilarities.slice(0, 3).map(s => `#${s.id}:${s.similarity.toFixed(3)}`).join(', ');
    console.log(`[MATCH] Top similarities: ${top3} (threshold: ${threshold})`);
  }
  
  return bestMatch;
}

/**
 * Default similarity threshold.
 * - Lower = more matches (risk: merge different people)
 * - Higher = fewer matches (risk: same person counted twice)
 */
export const SIMILARITY_THRESHOLD = 0.45;
