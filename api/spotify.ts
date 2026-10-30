export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const url = new URL(req.url);
    const path = url.searchParams.get('path');
    if (!path) {
      return Response.json({ error: 'Missing path param' }, { status: 400 });
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return Response.json({ error: 'Missing Spotify credentials env' }, { status: 500 });
    }

    // 替换 btoa，Edge 稳定方案
    const auth = `${clientId}:${clientSecret}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(auth);
    const base64 = btoa(String.fromCharCode(...data));

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${base64}`,
      },
      body: 'grant_type=client_credentials',
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      return Response.json({ error: 'Spotify token fetch failed', detail: tokenJson }, { status: 500 });
    }
    const accessToken = tokenJson.access_token;

    const spotifyRes = await fetch(`https://api.spotify.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const spotifyData = await spotifyRes.json();

    return Response.json(spotifyData, {
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return Response.json({ error: 'Runtime exception', msg: String(err) }, { status: 500 });
  }
}
