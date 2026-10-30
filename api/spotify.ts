/**
 * Vercel Node endpoint shared with local dev and browser integration tests.
 * The frontend contract is action=status|search|album, returning { data }.
 * Credentials and access tokens remain server-side. No arbitrary path proxy.
 */
import { createSpotifyHandler } from '../server/spotify';
export default createSpotifyHandler();
