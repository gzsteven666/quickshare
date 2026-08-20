import { Hono } from 'hono';
import type { Env } from './env';
import { authRoutes } from './routes/auth';
import { deploymentRoutes } from './routes/deployments';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({
  ok: true,
  service: 'quickshare-cloudflare'
}));

app.route('/api/auth', authRoutes);
app.route('/api/deployments', deploymentRoutes);

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
