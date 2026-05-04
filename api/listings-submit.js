// api/listings-submit.js
// Vercel serverless function — GET /api/listings-submit?zip=33904
// Checks Supabase cache first, submits Zillow job only on cache miss

import { isZipCacheValid, getCachedListings } from './lib/supabase.js';

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "zillow-property-data1.p.rapidapi.com";
const API_URL = `https://${RAPIDAPI_HOST}`;

const HEADERS = {
  "Content-Type": "application/json",
  "x-rapidapi-key": RAPIDAPI_KEY,
  "x-rapidapi-host": RAPIDAPI_HOST,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { zip, force } = req.query;
  if (!zip || !/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: "Valid 5-digit ZIP code required" });
  }
  if (!RAPIDAPI_KEY) {
    return res.status(500).json({ error: "RAPIDAPI_KEY not configured" });
  }

  try {
    // Check Supabase cache first (skip if force=true)
    if (force !== 'true') {
      const cacheValid = await isZipCacheValid(zip, 60); // 60 minute TTL
      if (cacheValid) {
        const cached = await getCachedListings(zip);
        if (cached.length > 0) {
          console.log(`Cache hit for ZIP ${zip} — ${cached.length} listings`);
          return res.status(200).json({
            source: 'cache',
            zip,
            cached: true,
            count: cached.length,
            properties: cached.map(normalizeFromDB),
          });
        }
      }
    }

    // Cache miss — submit Zillow job
    const response = await fetch(`${API_URL}/v1/properties`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        zipcodes: [parseInt(zip)],
        type: "sale",
        max_items: 25,
      }),
    });

    if (!response.ok) throw new Error(`Submit failed: ${response.status}`);
    const data = await response.json();
    if (!data.job_id) throw new Error(`No job_id returned: ${JSON.stringify(data)}`);

    return res.status(200).json({
      job_id: data.job_id,
      zip,
      status: "submitted",
      cached: false,
      source: 'zillow'
    });

  } catch (err) {
    console.error("submit error:", err.message);
    return res.status(502).json({ error: err.message, zip });
  }
}

// Convert DB row back to app property shape
function normalizeFromDB(row) {
  return {
    id: row.id,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    lat: row.lat,
    lng: row.lng,
    price: row.price,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    sqft: row.sqft,
    dom: row.dom,
    priceHistory: row.price_history || [{ date: "Current", price: row.price }],
    avgCompPrice: row.avg_comp_price,
    mlsStatus: row.mls_status,
    listingRemarks: row.listing_remarks,
    vacant: row.vacant,
    probate: row.probate,
    failedListing: row.failed_listing,
    floodZone: row.flood_zone,
    floodZoneSource: row.flood_zone_source,
    zpid: row.zpid,
    zillowUrl: row.zillow_url,
    source: row.source,
  };
}
