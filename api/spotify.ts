/** Vercel-compatible Node serverless endpoint; secrets stay in server env. */
import { createSpotifyHandler } from '../server/spotify';
export default createSpotifyHandler();
