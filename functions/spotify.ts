export default async function handler(req: any, res: any) {
  try {
    const allowedOrigin = process.env.SPOTIFY_ALLOWED_ORIGINS;
    const origin = req.headers.origin;

    if (origin !== allowedOrigin) {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: "Missing Spotify credentials" });
    }

    const { path } = req.query;
    if (!path || typeof path !== "string") {
      return res.status(400).json({ error: "Missing path parameter" });
    }

    // 获取token
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
      },
      body: "grant_type=client_credentials"
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(500).json(tokenData);
    }

    // 请求spotify接口
    const apiRes = await fetch(`https://api.spotify.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const apiData = await apiRes.json();
    return res.status(apiRes.status).json(apiData);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error", detail: String(err) });
  }
}
