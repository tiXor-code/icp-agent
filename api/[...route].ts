import { handle } from 'hono/vercel';
import app from '../src/index.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

export default handle(app);
