import type { VercelRequest, VercelResponse } from '@vercel/node';

const EDGE_API_KEY = process.env.EDGE_API_KEY;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Verify API key
  const apiKey = req.headers['x-api-key'];
  if (!EDGE_API_KEY || apiKey !== EDGE_API_KEY) {
    return res.status(401).json({ message: 'Invalid API key' });
  }

  return res.json({
    success: true,
    message: 'Edge API is healthy',
    timestamp: new Date().toISOString(),
  });
}
