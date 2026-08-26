import { proxyPublish } from '../scripts/publish-proxy.mjs';
import { createPublishHandler } from '../scripts/vercel-handlers.mjs';

export default createPublishHandler({ publish: proxyPublish });
