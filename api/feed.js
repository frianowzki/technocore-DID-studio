import { getLiveFeed } from '../scripts/feed-proxy.mjs';
import { createFeedHandler } from '../scripts/vercel-handlers.mjs';

export default createFeedHandler({ getFeed: getLiveFeed });
