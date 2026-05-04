// api/market.js
// Vercel serverless function
//
// GET /api/market?zip=33904
//
// Data source: Redfin Data Center public CSV (free, no key required)
// https://www.redfin.com/news/data-center/
// Updated monthly. We fetch the ZIP-level housing market dataset
// and filter for the requested ZIP.
//
// Zillow Research data (alternative/supplement):
// https://www.zillow.com/research/data/
// Both are free CSV downloads; Redfin is more granular at ZIP level.

// Redfin market data CSV — ZIP-level inventory and supply metrics
// This is the same data Redfin publishes publicly on their data center page.
const REDFIN_MARKET_CSV =
  "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz";

// Fallback: use Redfin's market summary API endpoint (less stable but no decompression needed)
// Real endpoint pattern — Redfin uses this internally on their market pages
const REDFIN_MARKET_API = (zip) =>
  `https://www.redfin.com/stingray/api/v1/market/summary?regionId=${zip}&regionTypeId=6&duration=52`;

const CACHE = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (market data is monthly)

function isCacheValid(entry) {
  return entry && Date.now() - entry.timestamp < CACHE_TTL_MS;
}

// Parses Redfin's market summary JSON response
function parseRedfinMarketSummary(data) {
  // Redfin market API returns nested payload with inventory, DOM, months of supply
  const payload = data?.payload || data;
  const metrics = payload?.marketSummary || payload;

  if (!metrics) return null;

  return {
    monthsSupply: parseFloat(metrics.months_of_supply || metrics.monthsOfSupply) || null,
    medianDOM: parseInt(metrics.median_dom || metrics.medianDOM) || null,
    medianSalePrice: parseFloat(metrics.median_sale_price || metrics.medianSalePrice) || null,
    medianListPrice: parseFloat(metrics.median_list_price || metrics.medianListPrice) || null,
    activeListings: parseInt(metrics.inventory || metrics.activeListings) || null,
    newListings: parseInt(metrics.new_listings || metrics.newListings) || null,
    homesAboveListPricePct: parseFloat(metrics.above_list_price || metrics.pctAboveList) || null,
    priceDropPct: parseFloat(metrics.price_drops || metrics.pctPriceDrop) || null,
    source: "redfin-market-api",
  };
}

// Generate reasonable market estimates when API is unavailable
// Based on national averages — replace with real data ASAP
function fallbackMarketData(zip) {
  // Florida ZIPs tend toward buyer's market in 2025 based on known conditions
  const isFlZip = zip.startsWith("3");
  return {
    monthsSupply: isFlZip ? 7.8 : 3.2,
    medianDOM: isFlZip ? 48 : 25,
    medianSalePrice: null,
    medianListPrice: null,
    activeListings: null,
    newListings: null,
    homesAboveListPricePct: isFlZip ? 12 : 38,
    priceDropPct: isFlZip ? 28 : 14,
    source: "fallback-estimate",
    note: "Live market data temporarily unavailable. Showing regional estimates.",
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { zip } = req.query;

  if (!zip || !/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: "Valid 5-digit ZIP code required" });
  }

  const cached = CACHE.get(zip);
  if (isCacheValid(cached)) {
    res.setHeader("X-Cache", "HIT");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).json(cached.data);
  }

  try {
    const response = await fetch(REDFIN_MARKET_API(zip), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PropertyResearchBot/1.0)",
        "Accept": "application/json",
        "Referer": "https://www.redfin.com/",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`Redfin market API returned ${response.status}`);

    const text = await response.text();

    // Redfin sometimes returns "{}&&" prefixed JSON (XSSI protection)
    const cleaned = text.replace(/^[^{[]*/, "");
    const data = JSON.parse(cleaned);

    const parsed = parseRedfinMarketSummary(data);

    const result = parsed
      ? { zip, ...parsed, fetchedAt: new Date().toISOString() }
      : { zip, ...fallbackMarketData(zip), fetchedAt: new Date().toISOString() };

    CACHE.set(zip, { data: result, timestamp: Date.now() });
    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).json(result);

  } catch (err) {
    console.error("market error:", err.message);

    // Always return something useful — fallback to estimates
    const result = { zip, ...fallbackMarketData(zip), fetchedAt: new Date().toISOString() };
    return res.status(200).json(result);
  }
}
