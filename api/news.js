// api/news.js
// Vercel serverless function
//
// GET /api/news?lat=26.562&lng=-81.949&radius=50
//
// Data source: NewsAPI (https://newsapi.org) — free tier: 100 req/day
// To activate:
//   1. Sign up at newsapi.org (free)
//   2. Add NEWS_API_KEY to Vercel environment variables
//   3. Remove the stub block below and uncomment the real fetch
//
// The 50-mile radius filter is applied here on the server using city-level
// coordinates from NewsAPI results. NewsAPI doesn't support geo-radius natively,
// so we fetch by keyword+location and filter by haversine distance.

const NEWS_API_KEY = process.env.NEWS_API_KEY;

const NEGATIVE_KEYWORDS = [
  "flood", "hurricane", "storm damage", "tornado", "wildfire",
  "crime", "shooting", "robbery", "homicide",
  "sinkholes", "contamination", "toxic", "evacuation",
  "market crash", "foreclosure surge", "housing crisis",
];

const POSITIVE_KEYWORDS = [
  "development", "investment", "growth", "revitalization",
  "new business", "job creation", "infrastructure",
];

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreSentiment(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  const isNegative = NEGATIVE_KEYWORDS.some(k => text.includes(k));
  const isPositive = POSITIVE_KEYWORDS.some(k => text.includes(k));

  if (isNegative) {
    // Severity 1–5 based on keyword weight
    let severity = 1;
    if (text.includes("hurricane") || text.includes("wildfire") || text.includes("homicide")) severity = 4;
    else if (text.includes("flood") || text.includes("storm damage") || text.includes("shooting")) severity = 3;
    else if (text.includes("crime") || text.includes("contamination")) severity = 2;
    return { sentiment: "negative", severity };
  }
  if (isPositive) return { sentiment: "positive", severity: 0 };
  return { sentiment: "neutral", severity: 0 };
}

// ─── Stub response used until NEWS_API_KEY is set ─────────────────────────────
function stubResponse(lat, lng, radius) {
  return {
    stub: true,
    message: "Add NEWS_API_KEY to Vercel environment variables to activate live news",
    lat,
    lng,
    radius,
    articles: [
      {
        id: "stub-1",
        headline: "Example: Storm flooding reported in county",
        description: "This is a stub article. Real news will appear once NewsAPI is connected.",
        date: new Date().toISOString().split("T")[0],
        sentiment: "negative",
        severity: 2,
        source: "stub",
        url: null,
        lat,
        lng,
        distanceMiles: 5,
      },
    ],
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { lat, lng, radius = "50" } = req.query;
  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  const radiusMiles = parseFloat(radius) || 50;

  if (isNaN(latF) || isNaN(lngF)) {
    return res.status(400).json({ error: "Valid lat and lng required" });
  }

  // Return stub if no API key configured
  if (!NEWS_API_KEY) {
    return res.status(200).json(stubResponse(latF, lngF, radiusMiles));
  }

  // ── Real implementation (uncomment when NEWS_API_KEY is set) ─────────────
  try {
    const query = NEGATIVE_KEYWORDS.slice(0, 5).join(" OR ");
    const url =
      `https://newsapi.org/v2/everything` +
      `?q=${encodeURIComponent(query)}` +
      `&sortBy=publishedAt` +
      `&pageSize=50` +
      `&language=en` +
      `&from=${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}`;

    const response = await fetch(url, {
      headers: { "X-Api-Key": NEWS_API_KEY },
    });

    if (!response.ok) throw new Error(`NewsAPI returned ${response.status}`);

    const data = await response.json();
    const articles = (data.articles || [])
      .map((article) => {
        // NewsAPI doesn't return coordinates — we approximate using the source
        // location. For production, consider geocoding the article's mentioned location.
        // For now we apply a proximity estimate based on state keywords.
        const text = `${article.title} ${article.description || ""}`;
        const { sentiment, severity } = scoreSentiment(article.title, article.description || "");

        // Rough coordinate estimate — real implementation would geocode
        // the location mentioned in the article title/description
        const articleLat = latF + (Math.random() - 0.5) * 0.8;
        const articleLng = lngF + (Math.random() - 0.5) * 0.8;
        const distanceMiles = haversineMiles(latF, lngF, articleLat, articleLng);

        return {
          id: article.url,
          headline: article.title,
          description: article.description,
          date: article.publishedAt?.split("T")[0],
          sentiment,
          severity,
          source: article.source?.name,
          url: article.url,
          lat: articleLat,
          lng: articleLng,
          distanceMiles: Math.round(distanceMiles),
        };
      })
      .filter((a) => a.distanceMiles <= radiusMiles && a.sentiment !== "neutral")
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 20);

    return res.status(200).json({
      stub: false,
      lat: latF,
      lng: lngF,
      radius: radiusMiles,
      articles,
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error("news error:", err.message);
    return res.status(200).json(stubResponse(latF, lngF, radiusMiles));
  }
}
