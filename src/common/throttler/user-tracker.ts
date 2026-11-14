export function getUserTracker(req: Record<string, any>): string {
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }
  const authHeader = req.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(
          Buffer.from(parts[1], 'base64url').toString('utf8'),
        );
        if (typeof payload?.sub === 'string' && payload.sub) {
          return `user:${payload.sub}`;
        }
      } catch {
        // ignore decode failure
      }
    }
  }
  return req.ip || 'anonymous';
}

