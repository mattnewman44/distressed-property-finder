// api/listings-poll.js
// Vercel serverless function — GET /api/listings-poll?job_id=xxx&zip=33904
// Polls Zillow API for results and stores in Supabase on completion

import { storeListings, storePriceEvent, getCachedListings } from './lib/supabase.js';

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "zillow-property-data1.p.rapidapi.com";
const API_URL = `https://${RAPIDAPI_HOST}`;

const HEADERS = {
  "Content-Type": "application/json",
  "x-rapidapi-key": RAPIDAPI_KEY,
  "x-rapidapi-host": RAPIDAPI_HOST,
};

function normalizeProperty(raw) {
  const price = raw.price || 0;
  const originalPrice = raw.price_history?.[0]?.price || price;

  const priceHistory = (raw.price_history || [])
    .map(h => ({ date: h.date, price: h.price }))
    .filter(h => h.price);
  if (priceHistory.length === 0) priceHistory.push({ date: "Current", price });

  const zpid = String(raw.zpid || raw.id || "");
  const lat = parseFloat(raw.latitude || 0);
  const lng = parseFloat(raw.longitude || 0);

  return {
    id: zpid || `${raw.street_address}-${raw.zipcode}`.replace(/\s+/g, "-"),
    address: raw.street_address || "",
    city: raw.city || "",
    state: raw.state || "",
    zip: String(raw.zipcode || ""),
    lat,
    lng,
    price,
    bedrooms: raw.bedrooms || 0,
    bathrooms: raw.bathrooms || 0,
    sqft: raw.living_area || 0,
    dom: raw.days_on_zillow || 0,
    priceHistory,
    avgCompPrice: raw.zestimate || Math.round(price * 0.95),
    vacant: false,
    probate: false,
    failedListing: originalPrice > price && (raw.days_on_zillow || 0) > 60,
    mlsStatus: raw.home_status || "Active",
    listingRemarks: raw.description || "",
    floodZone: null,
    floodZoneSource: null,
    source: "zillow",
    zpid,
    zillowUrl: zpid ? `https://www.zillow.com/homes/${zpid}_zpid/` : null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { job_id, zip } = req.query;
  if (!job_id) return res.status(400).json({ error: "job_id required" });
  if (!RAPIDAPI_KEY) return res.status(500).json({ error: "RAPIDAPI_KEY not configured" });

  try {
    const response = await fetch(`${API_URL}/v1/results/${job_id}`, { headers: HEADERS });
    if (!response.ok) throw new Error(`Poll failed: ${response.status}`);

    const data = await response.json();
    const status = data.status;

    if (status === "complete") {
      const properties = (data.results || [])
        .map(item => normalizeProperty(item.property || item))
        .filter(p => p.lat && p.lng && p.price > 0);

      // Get existing listings from Supabase for delta detection
      const existing = await getCachedListings(zip).catch(() => []);
      const existingMap = new Map(existing.map(e => [e.id, e]));

      // Detect price changes
      for (const prop of properties) {
        const prev = existingMap.get(prop.id);
        if (prev && prev.price && prop.price !== prev.price) {
          await storePriceEvent(
            prop.id,
            prop.price < prev.price ? 'price_cut' : 'price_increase',
            prev.price,
            prop.price,
            'zillow'
          ).catch(e => console.error('Price event error:', e));
        }
      }

      // Store in Supabase
      await storeListings(zip, properties);
      console.log(`Stored ${properties.length} listings for ZIP ${zip}`);

      return res.status(200).json({
        status: "complete",
        zip,
        count: properties.length,
        fetchedAt: new Date().toISOString(),
        properties,
      });
    }

    if (status === "failed") {
      return res.status(200).json({ status: "failed", zip, properties: [] });
    }

    return res.status(200).json({
      status: "processing",
      zip,
      count: 0,
      properties: [],
    });

  } catch (err) {
    console.error("poll error:", err.message);
    return res.status(502).json({
      error: err.message,
      status: "error",
      zip,
      properties: []
    });
  }
}
