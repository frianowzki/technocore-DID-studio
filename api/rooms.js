import { getRoomDirectory } from '../scripts/feed-proxy.mjs';
import { createRoomsHandler } from '../scripts/vercel-handlers.mjs';

export default createRoomsHandler({ getRooms: getRoomDirectory });
