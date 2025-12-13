import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // JWT is stateless - client must discard the token
  // We just acknowledge the logout request
  return res.json({ message: 'Logged out successfully' });
}
