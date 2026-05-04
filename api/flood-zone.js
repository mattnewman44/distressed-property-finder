// api/flood-zone.js
// Vercel serverless function — GET /api/flood-zone?lat=26.562&lng=-81.949
//
// Uses FEMA's ArcGIS Hub feature service — more reliable than the NFHL MapServer
// Free, no API key required.

const CACHE = new Map();

function cacheKey(lat, lng) {
  return `${parseFloat(lat).toFixed(4)},${parseFloat(lng).toFixed(4)}`;
}

// Primary: FEMA ArcGIS Hub - National Flood Hazard Layer feature service
function buildFEMAUrl(lat, lng) {
  return `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Size/FeatureServer/0/query` +
    `?where=1%3D1` +
    `&geometry=${encodeURIComponent(`${lng},${lat}`)}` +
    `&geometryType=esriGeometryPoint` +
    `&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects` +
    `&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF` +
    `&returnGeometry=false` +
    `&resultRecordCount=1` +
    `&f=json`;
}

// Fallback: FEMA NFHL direct MapServer
function buildFEMAFallbackUrl(lat, lng) {
  return `https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query` +
    `?where=1%3D1` +
    `&geometry=${encodeURIComponent(`${lng},${lat}`)}` +
    `&geometryType=esriGeometryPoint` +
    `&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects` +
    `&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF` +
    `&returnGeometry=false` +
    `&resultRecordCount=1` +
    `&f=json`;
}

function normalizeZone(rawZone, subtype) {
  if (!rawZone) return null;
  const z = rawZone.trim().toUpperCase();
  const sub = (subtype || "").trim().toUpperCase();
  if (z === "VE" || z === "V") return "VE";
  if (z === "AE") return "AE";
  if (z === "AO") return "AO";
  if (z === "AH") return "AH";
  if (z === "A") return "A";
  if (z === "X") {
    if (sub.includes("0.2") || sub.includes("500")) return "X_SHADED";
    return "X";
  }
  if (z === "D") return "D";
  return z;
}

function buildResult(latF, lngF, zone, rawZone, sfha, source) {
  let estimatedAnnualPremium = null;
  if (zone === "VE") estimatedAnnualPremium = "$3,000–$8,000+";
  else if (["AE", "A", "AO", "AH"].includes(zone)) estimatedAnnualPremium = "$800–$3,500";
  else if (zone === "X_SHADED") estimatedAnnualPremium = "$500–$1,200 (recommended)";
  else if (zone === "X") estimatedAnnualPremium = "$400–$900 (optional)";

  const displayZone = zone === "X_SHADED" ? "X" : zone;
  const isSFHA = sfha === "T" || ["AE", "A", "AO", "AH", "VE"].includes(zone);

  return {
    lat: latF, lng: lngF,
    zone: displayZone,
    zoneDetail: zone,
    sfha: isSFHA,
    requiresMandatoryInsurance: isSFHA,
    estimatedAnnualPremium,
    rawZone,
    source,
    note: displayZone
      ? `FEMA Zone ${displayZone} — ${isSFHA
          ? "Special Flood Hazard Area. Flood insurance required for FHA/VA/conventional loans."
          : "Outside SFHA. Flood insurance not mandatory."}`
      : "Flood zone data unavailable.",
  };
}

async function tryFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const features = data.features || [];
    if (features.length === 0) return null;
    const attrs = features[0].attributes || {};
    return attrs;
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { lat, lng } = req.query;
  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);

  if (isNaN(latF) || isNaN(lngF)) {
    return res.status(400).json({ error: "Valid lat and lng required" });
  }

  const key = cacheKey(latF, lngF);
  if (CACHE.has(key)) {
    res.setHeader("X-Cache", "HIT");
    return res.status(200).json(CACHE.get(key));
  }

  // Try primary ESRI hosted service
  let attrs = await tryFetch(buildFEMAUrl(latF, lngF));
  let source = "FEMA-ESRI-Hub";

  // Fallback to FEMA direct
  if (!attrs?.FLD_ZONE) {
    attrs = await tryFetch(buildFEMAFallbackUrl(latF, lngF));
    source = "FEMA-NFHL";
  }

  if (attrs?.FLD_ZONE) {
    const zone = normalizeZone(attrs.FLD_ZONE, attrs.ZONE_SUBTY);
    const result = buildResult(latF, lngF, zone, attrs.FLD_ZONE, attrs.SFHA_TF, source);
    CACHE.set(key, result);
    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).json(result);
  }

  // Both failed
  const fallback = {
    lat: latF, lng: lngF,
    zone: "Unknown", sfha: null,
    requiresMandatoryInsurance: null,
    estimatedAnnualPremium: null,
    source: "FEMA-unavailable",
    note: "Flood zone lookup unavailable. Check msc.fema.gov for official data.",
  };
  return res.status(200).json(fallback);
}
