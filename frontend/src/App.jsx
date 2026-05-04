import { useState, useEffect, useCallback, useMemo } from "react";

// ─── API Layer ─────────────────────────────────────────────────────────────────
const API_BASE = import.meta.env?.VITE_API_BASE || "";

async function apiFetch(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

async function submitListingsJob(zip) {
  return apiFetch(`/api/listings-submit?zip=${zip}`);
}

async function pollListingsJob(jobId, zip) {
  return apiFetch(`/api/listings-poll?job_id=${jobId}&zip=${zip}`);
}

// FEMA called directly from browser — CORS is allowed for browser requests
// but blocked for server-to-server calls (Vercel IP blocked by FEMA)
async function fetchFloodZone(lat, lng) {
  const url = `https://services7.arcgis.com/uPEHWbHQ6349r7Xq/arcgis/rest/services/FEMA_Flood_Map_Services/FeatureServer/0/query` +
    `?where=1%3D1` +
    `&geometry=${encodeURIComponent(`${lng},${lat}`)}` +
    `&geometryType=esriGeometryPoint` +
    `&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects` +
    `&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF` +
    `&returnGeometry=false` +
    `&resultRecordCount=1` +
    `&f=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`FEMA error ${res.status}`);
  const data = await res.json();
  const attrs = data.features?.[0]?.attributes;
  if (!attrs?.FLD_ZONE) return { zone: "Unknown", sfha: null };

  const raw = attrs.FLD_ZONE.trim().toUpperCase();
  const sub = (attrs.ZONE_SUBTY || "").toUpperCase();
  let zone = raw;
  if (raw === "V" || raw === "VE") zone = "VE";
  else if (raw === "X") zone = sub.includes("0.2") || sub.includes("500") ? "X_SHADED" : "X";

  const isSFHA = attrs.SFHA_TF === "T" || ["AE","A","AO","AH","VE"].includes(zone);
  return {
    zone: zone === "X_SHADED" ? "X" : zone,
    zoneDetail: zone,
    sfha: isSFHA,
    requiresMandatoryInsurance: isSFHA,
    source: "FEMA-ESRI-browser",
  };
}

async function fetchMarket(zip) {
  return apiFetch(`/api/market?zip=${zip}`);
}

async function fetchNews(lat, lng, radius = 50) {
  return apiFetch(`/api/news?lat=${lat}&lng=${lng}&radius=${radius}`);
}

const DATA_SOURCES = {
  zillow:     { status: "live",  label: "Zillow (RapidAPI)",       active: true },
  fema:       { status: "live",  label: "FEMA flood zones (free)", active: true },
  propstream: { status: "stub",  label: "PropStream ($99/mo)",     active: false },
  attom:      { status: "stub",  label: "ATTOM API (trial)",       active: false },
  newsapi:    { status: "stub",  label: "News API (free tier)",    active: false },
};

// ─── Real Cape Coral Mock Data (from live Zillow API pull) ────────────────────
const CAPE_CORAL_MOCK = [
  { id:"45429985", address:"4240 SE 3rd Ave", city:"Cape Coral", state:"FL", zip:"33904", lat:26.572037, lng:-81.96781, price:300000, bedrooms:3, bathrooms:2, sqft:1307, dom:14, priceHistory:[{date:"Current",price:300000}], avgCompPrice:285000, vacant:false, probate:false, failedListing:false, mlsStatus:"FOR_SALE", listingRemarks:"Move-in ready and completely remodeled pool home. Updated kitchen, newer roof 2022.", floodZone:null, source:"zillow", zpid:"45429985", zillowUrl:"https://www.zillow.com/homes/45429985_zpid/" },
  { id:"45436680", address:"446 El Dorado Pkwy E", city:"Cape Coral", state:"FL", zip:"33904", lat:26.552774, lng:-81.96335, price:199900, bedrooms:2, bathrooms:1, sqft:1063, dom:98, priceHistory:[{date:"Current",price:199900}], avgCompPrice:189905, vacant:false, probate:false, failedListing:false, mlsStatus:"FOR_SALE", listingRemarks:"Short Sale: This property is a potential short sale. Affordable Yacht Club bungalow. Sold as-is.", floodZone:null, source:"zillow", zpid:"45436680", zillowUrl:"https://www.zillow.com/homes/45436680_zpid/" },
  { id:"45373112", address:"3419 SE 5th Ave", city:"Cape Coral", state:"FL", zip:"33904", lat:26.588, lng:-81.96436, price:240000, bedrooms:3, bathrooms:2, sqft:1752, dom:6, priceHistory:[{date:"Current",price:240000}], avgCompPrice:228000, vacant:false, probate:false, failedListing:false, mlsStatus:"FOR_SALE", listingRemarks:"This is a HUD bank foreclosure. Sold as-is. Cash only.", floodZone:null, source:"zillow", zpid:"45373112", zillowUrl:"https://www.zillow.com/homes/45373112_zpid/" },
  { id:"45531529", address:"2941 SE 10th Pl", city:"Cape Coral", state:"FL", zip:"33904", lat:26.59699, lng:-81.95268, price:339000, bedrooms:3, bathrooms:2, sqft:1775, dom:223, priceHistory:[{date:"Current",price:339000}], avgCompPrice:326200, vacant:false, probate:false, failedListing:true, mlsStatus:"FOR_SALE", listingRemarks:"Welcome to your Dream Home. X500 flood zone, no high-risk flood insurance required. Solar panels.", floodZone:null, source:"zillow", zpid:"45531529", zillowUrl:"https://www.zillow.com/homes/45531529_zpid/" },
  { id:"45536796", address:"1718 SE 29th Ln", city:"Cape Coral", state:"FL", zip:"33904", lat:26.596682, lng:-81.93837, price:249200, bedrooms:2, bathrooms:2, sqft:1178, dom:127, priceHistory:[{date:"Current",price:249200}], avgCompPrice:240500, vacant:false, probate:false, failedListing:true, mlsStatus:"FOR_SALE", listingRemarks:"POOL HOME, PRICED TO SELL!! Home does need some TLC, making it a perfect handyman special. Cash or conventional.", floodZone:null, source:"zillow", zpid:"45536796", zillowUrl:"https://www.zillow.com/homes/45536796_zpid/" },
  { id:"45436978", address:"5279 Stratford CT", city:"Cape Coral", state:"FL", zip:"33904", lat:26.553175, lng:-81.96727, price:380000, bedrooms:2, bathrooms:2, sqft:1532, dom:83, priceHistory:[{date:"Current",price:380000}], avgCompPrice:361000, vacant:false, probate:false, failedListing:false, mlsStatus:"FOR_SALE", listingRemarks:"Work was previously completed without permits. Buyer's responsibility to determine corrective actions. Cash only.", floodZone:null, source:"zillow", zpid:"45436978", zillowUrl:"https://www.zillow.com/homes/45436978_zpid/" },
  { id:"45468556", address:"1202 Flamingo Dr", city:"Cape Coral", state:"FL", zip:"33904", lat:26.541504, lng:-81.949295, price:1420000, bedrooms:4, bathrooms:3, sqft:3106, dom:226, priceHistory:[{date:"2026-04-17",price:1420000},{date:"2026-02-10",price:1499900},{date:"2026-01-14",price:1545000},{date:"2025-07-08",price:1550000},{date:"2025-04-02",price:1699000}], avgCompPrice:1349000, vacant:false, probate:false, failedListing:true, mlsStatus:"FOR_SALE", listingRemarks:"Waterfront home with direct boat access to pristine beaches. Proven vacation rental history.", floodZone:null, source:"zillow", zpid:"45468556", zillowUrl:"https://www.zillow.com/homes/45468556_zpid/" },
  { id:"45530958", address:"1207 SE 27th Ter", city:"Cape Coral", state:"FL", zip:"33904", lat:26.601671, lng:-81.94898, price:287000, bedrooms:3, bathrooms:2, sqft:1761, dom:336, priceHistory:[{date:"Current",price:287000}], avgCompPrice:272650, vacant:false, probate:false, failedListing:true, mlsStatus:"FOR_SALE", listingRemarks:"Time on market due only to prior 2 bedroom status. Completely rebuilt in 2018. Flood Zone X.", floodZone:null, source:"zillow", zpid:"45530958", zillowUrl:"https://www.zillow.com/homes/45530958_zpid/" },
  { id:"45396646", address:"3917 SE 19th Ave", city:"Cape Coral", state:"FL", zip:"33904", lat:26.579044, lng:-81.93488, price:1290000, bedrooms:4, bathrooms:3, sqft:2670, dom:351, priceHistory:[{date:"Current",price:1290000}], avgCompPrice:1225500, vacant:false, probate:false, failedListing:true, mlsStatus:"FOR_SALE", listingRemarks:"$60K CREDIT FOR NEW ROOF ON ACCEPTABLE OFFER. Waterfront masterpiece. No flooding with past hurricanes.", floodZone:null, source:"zillow", zpid:"45396646", zillowUrl:"https://www.zillow.com/homes/45396646_zpid/" },
  { id:"45536373", address:"3102 SE 22nd Ave", city:"Cape Coral", state:"FL", zip:"33904", lat:26.595184, lng:-81.92918, price:1450000, bedrooms:3, bathrooms:4, sqft:3421, dom:415, priceHistory:[{date:"Current",price:1450000}], avgCompPrice:1251700, vacant:false, probate:false, failedListing:true, mlsStatus:"FOR_SALE", listingRemarks:"Dream waterfront oasis on intersecting canals. ALL ASSESSMENTS IN AND PAID. Very low transferable flood insurance.", floodZone:null, source:"zillow", zpid:"45536373", zillowUrl:"https://www.zillow.com/homes/45536373_zpid/" },
  { id:"45540550", address:"2285 SE 28th St", city:"Cape Coral", state:"FL", zip:"33904", lat:26.601992, lng:-81.92249, price:419000, bedrooms:3, bathrooms:2, sqft:1800, dom:333, priceHistory:[{date:"Current",price:419000}], avgCompPrice:403900, vacant:false, probate:false, failedListing:true, mlsStatus:"FOR_SALE", listingRemarks:"Luxury meets Paradise. Some photos virtually staged. Motivated seller.", floodZone:null, source:"zillow", zpid:"45540550", zillowUrl:"https://www.zillow.com/homes/45540550_zpid/" },
  { id:"45407551", address:"4547 SE 11th Ave", city:"Cape Coral", state:"FL", zip:"33904", lat:26.566986, lng:-81.95177, price:299900, bedrooms:3, bathrooms:2, sqft:1456, dom:21, priceHistory:[{date:"Current",price:299900}], avgCompPrice:284905, vacant:false, probate:false, failedListing:false, mlsStatus:"FOR_SALE", listingRemarks:"This is a potential short sale. Corner-lot pool home with owned solar, impact windows.", floodZone:null, source:"zillow", zpid:"45407551", zillowUrl:"https://www.zillow.com/homes/45407551_zpid/" },
  { id:"45430056", address:"4014 SE 4th AVE", city:"Cape Coral", state:"FL", zip:"33904", lat:26.577024, lng:-81.96689, price:300000, bedrooms:3, bathrooms:2, sqft:1677, dom:6, priceHistory:[{date:"Current",price:300000}], avgCompPrice:285000, vacant:false, probate:false, failedListing:false, mlsStatus:"FOR_SALE", listingRemarks:"Fully renovated courtyard-style property. Metal roof 2023. Impact-resistant updates.", floodZone:null, source:"zillow", zpid:"45430056", zillowUrl:"https://www.zillow.com/homes/45430056_zpid/" },
  { id:"68094922", address:"1215 SE 27th ST", city:"Cape Coral", state:"FL", zip:"33904", lat:26.602503, lng:-81.94803, price:399000, bedrooms:4, bathrooms:2, sqft:1715, dom:1, priceHistory:[{date:"Current",price:399000}], avgCompPrice:379050, vacant:false, probate:true, failedListing:false, mlsStatus:"FOR_SALE", listingRemarks:"Sale is subject to probate. Pool home with metal roof 2023, solar panels. Fully furnished.", floodZone:null, source:"zillow", zpid:"68094922", zillowUrl:"https://www.zillow.com/homes/68094922_zpid/" },
  { id:"45535696", address:"2526 SE 16th Pl APT 105", city:"Cape Coral", state:"FL", zip:"33904", lat:26.605028, lng:-81.93988, price:99900, bedrooms:2, bathrooms:2, sqft:1066, dom:17, priceHistory:[{date:"Current",price:99900}], avgCompPrice:94905, vacant:false, probate:false, failedListing:false, mlsStatus:"FOR_SALE", listingRemarks:"Priced to sell. This is a cash only purchase. Sold turn-key. ACT QUICKLY!", floodZone:null, source:"zillow", zpid:"45535696", zillowUrl:"https://www.zillow.com/homes/45535696_zpid/" },
  { id:"45395741", address:"3502 SE 16th Pl", city:"Cape Coral", state:"FL", zip:"33904", lat:26.58733, lng:-81.94094, price:498000, bedrooms:3, bathrooms:2, sqft:1845, dom:16, priceHistory:[{date:"Current",price:498000}], avgCompPrice:473100, vacant:false, probate:false, failedListing:false, mlsStatus:"FOR_SALE", listingRemarks:"This property is a fixer upper with tremendous value. Metal roof, metal hurricane shutters. Airbnb candidate.", floodZone:null, source:"zillow", zpid:"45395741", zillowUrl:"https://www.zillow.com/homes/45395741_zpid/" },
  { id:"45400697", address:"1404 SE 36th Ter", city:"Cape Coral", state:"FL", zip:"33904", lat:26.584538, lng:-81.94532, price:215000, bedrooms:2, bathrooms:2, sqft:1307, dom:89, priceHistory:[{date:"Current",price:215000}], avgCompPrice:216300, vacant:false, probate:false, failedListing:false, mlsStatus:"FOR_SALE", listingRemarks:"No Flood Zone and Assessments Paid. Tenant requires 24 hours notice to show. Conventional financing.", floodZone:null, source:"zillow", zpid:"45400697", zillowUrl:"https://www.zillow.com/homes/45400697_zpid/" },
  { id:"45406909", address:"1310 SE 43rd Ter", city:"Cape Coral", state:"FL", zip:"33904", lat:26.571285, lng:-81.9475, price:284900, bedrooms:3, bathrooms:2, sqft:1757, dom:88, priceHistory:[{date:"Current",price:284900}], avgCompPrice:276100, vacant:false, probate:false, failedListing:false, mlsStatus:"FOR_SALE", listingRemarks:"Sold furnished and conveyed as-is. 203k renovation loan candidate. Pool with solar heating.", floodZone:null, source:"zillow", zpid:"45406909", zillowUrl:"https://www.zillow.com/homes/45406909_zpid/" },
  { id:"45372817", address:"703 SE 33rd St", city:"Cape Coral", state:"FL", zip:"33904", lat:26.5912, lng:-81.958984, price:280000, bedrooms:3, bathrooms:2, sqft:1438, dom:55, priceHistory:[{date:"Current",price:280000}], avgCompPrice:266000, vacant:false, probate:false, failedListing:false, mlsStatus:"FOR_SALE", listingRemarks:"No flooding from any storms. Incredible opportunity to own an affordable pool home.", floodZone:null, source:"zillow", zpid:"45372817", zillowUrl:"https://www.zillow.com/homes/45372817_zpid/" },
  { id:"45436608", address:"5246 Tower Dr", city:"Cape Coral", state:"FL", zip:"33904", lat:26.553604, lng:-81.96428, price:459900, bedrooms:2, bathrooms:2, sqft:1428, dom:715, priceHistory:[{date:"Current",price:459900}], avgCompPrice:567200, vacant:true, probate:false, failedListing:true, mlsStatus:"FOR_SALE", listingRemarks:"Amazing New Price! Hidden gem in Yacht Club. Direct Gulf access no bridges. Completely remodeled.", floodZone:null, source:"zillow", zpid:"45436608", zillowUrl:"https://www.zillow.com/homes/45436608_zpid/" },
];

const MOCK_MARKET = {
  monthsSupply: 8.2,
  medianDOM: 45,
  medianSalePrice: 450000,
  activeListings: 847,
  priceDropPct: 28,
  source: "mock",
};

const MOCK_NEWS = [
  { id:"n1", headline:"Lee County reports above-average storm surge risk this season", date:"2026-04-15", sentiment:"negative", severity:3, lat:26.6, lng:-81.95, source:"Fort Myers News-Press" },
  { id:"n2", headline:"Cape Coral property crime up 12% in Yacht Club district", date:"2026-04-10", sentiment:"negative", severity:2, lat:26.56, lng:-81.94, source:"WINK News" },
  { id:"n3", headline:"Cape Coral Yacht Club redevelopment breaks ground", date:"2026-04-20", sentiment:"positive", severity:0, lat:26.555, lng:-81.96, source:"Cape Coral Daily Breeze" },
];

// ─── Scoring Engine ────────────────────────────────────────────────────────────
function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreProperty(listing, market, news, weights) {
  const signals = {};
  const avgDOM = market?.medianDOM || 45;
  const domRatio = listing.dom / avgDOM;
  signals.dom = Math.min(25, Math.round(domRatio > 1 ? (domRatio - 1) * 20 : 0));

  const cuts = listing.priceHistory.length - 1;
  const totalCutPct = listing.priceHistory.length > 1
    ? (listing.priceHistory[0].price - listing.price) / listing.priceHistory[0].price : 0;
  signals.priceReductions = Math.min(20, Math.round(cuts * 5 + totalCutPct * 40));

  const overComp = (listing.price - listing.avgCompPrice) / listing.avgCompPrice;
  signals.priceVsComps = overComp > 0 ? Math.min(20, Math.round(overComp * 60)) : 0;

  const supplyScore = market ? Math.min(15, Math.round((market.monthsSupply / 6) * 10)) : 5;
  signals.inventory = supplyScore;

  let motivationScore = 0;
  if (listing.vacant) motivationScore += 5;
  if (listing.probate) motivationScore += 5;
  if (listing.failedListing) motivationScore += 5;
  signals.sellerMotivation = Math.min(15, motivationScore);

  const nearbyNeg = (news || []).filter(n =>
    n.sentiment === "negative" &&
    haversineDistanceMiles(listing.lat, listing.lng, n.lat, n.lng) <= 50
  );
  signals.localNews = Math.min(5, nearbyNeg.reduce((acc, n) => acc + n.severity, 0));

  const w = weights;
  const rawTotal =
    signals.dom * w.dom +
    signals.priceReductions * w.priceReductions +
    signals.priceVsComps * w.priceVsComps +
    signals.inventory * w.inventory +
    signals.sellerMotivation * w.sellerMotivation +
    signals.localNews * w.localNews;

  const maxPossible = 25*w.dom + 20*w.priceReductions + 20*w.priceVsComps + 15*w.inventory + 15*w.sellerMotivation + 5*w.localNews;
  const score = Math.round((rawTotal / maxPossible) * 100);

  const financingFlags = parseFinancingFlags(listing.listingRemarks);

  // Temp scored object needed for opportunity classifier
  const tempScored = { ...listing, priceHistory: listing.priceHistory || [], financingFlags };
  const opportunityType = classifyOpportunityType(tempScored, financingFlags);

  return {
    ...listing,
    score,
    signals,
    grade: score >= 70 ? "high" : score >= 40 ? "medium" : "low",
    financingFlags,
    opportunityType,
    pricecuts: listing.priceHistory.length - 1,
    totalCutPct: listing.priceHistory.length > 1
      ? Math.round(((listing.priceHistory[0].price - listing.price) / listing.priceHistory[0].price) * 100) : 0,
  };
}

const DEFAULT_WEIGHTS = { dom:1, priceReductions:1, priceVsComps:1, inventory:1, sellerMotivation:1, localNews:1 };

// ─── Financing Keyword Parser ─────────────────────────────────────────────────
const FINANCING_KEYWORDS = {
  cashOnly:        { patterns:[/cash only/i,/cash-only/i,/no financing/i,/proof of funds/i], label:"Cash only", color:"#7c3aed", bg:"#f5f3ff" },
  asIs:            { patterns:[/as.is/i,/sold as.is/i,/no repairs/i,/seller will not/i,/handyman/i], label:"As-is", color:"#b45309", bg:"#fffbeb" },
  noFhaVa:         { patterns:[/no fha/i,/no va/i,/conventional only/i], label:"No FHA/VA", color:"#0369a1", bg:"#f0f9ff" },
  floodDamage:     { patterns:[/flood damage/i,/water damage/i,/storm damage/i,/hurricane damage/i], label:"Flood/storm damage", color:"#b91c1c", bg:"#fef2f2" },
  mold:            { patterns:[/mold/i,/remediation/i], label:"Mold", color:"#9a3412", bg:"#fff7ed" },
  reo:             { patterns:[/bank.owned/i,/reo/i,/hud/i,/foreclosure/i], label:"Bank-owned/REO", color:"#374151", bg:"#f9fafb" },
  shortSale:       { patterns:[/short sale/i,/potential short sale/i], label:"Short sale", color:"#dc2626", bg:"#fef2f2" },
  probate:         { patterns:[/probate/i,/estate sale/i,/subject to probate/i], label:"Probate/estate", color:"#6b21a8", bg:"#fdf4ff" },
  fixer:           { patterns:[/fixer/i,/tLC/i,/needs work/i,/renovation/i,/203k/i], label:"Fixer-upper", color:"#065f46", bg:"#ecfdf5" },
};

function parseFinancingFlags(remarks) {
  if (!remarks) return [];
  return Object.entries(FINANCING_KEYWORDS)
    .filter(([, { patterns }]) => patterns.some(p => p.test(remarks)))
    .map(([key, { label, color, bg }]) => ({ key, label, color, bg }));
}

// ─── Opportunity Type Classifier ─────────────────────────────────────────────
// Classifies a property into one of 4 deal types based on listing remarks + flags.
// This is SEPARATE from the distress score — it tells buyers what KIND of deal it is.
const OPPORTUNITY_TYPES = {
  institutional: {
    label: "Institutional sale",
    sublabel: "Bank/REO/HUD",
    icon: "🏦",
    color: "#374151",
    bg: "#f9fafb",
    border: "#d1d5db",
    description: "Owned by a bank, HUD, or government. No motivated human seller — the institution sets the price and timeline. Typically sold as-is, cash preferred, limited negotiation.",
    negotiability: "Low",
    timeline: "Medium (30–60 days)",
    tip: "Get pre-approved and have proof of funds ready. Inspect thoroughly — no disclosures required.",
  },
  shortSale: {
    label: "Short sale",
    sublabel: "Bank approval required",
    icon: "⏳",
    color: "#0369a1",
    bg: "#f0f9ff",
    border: "#bae6fd",
    description: "Homeowner owes more than the property is worth. Human seller is motivated but the bank must approve the sale — adds 30–90 days and deal can fall through.",
    negotiability: "Medium",
    timeline: "Slow (60–120 days)",
    tip: "Budget extra time. Have your financing locked. Bank may counter or reject offer. Hire an agent experienced with short sales.",
  },
  probateEstate: {
    label: "Probate / estate sale",
    sublabel: "Court or executor involved",
    icon: "⚖️",
    color: "#6b21a8",
    bg: "#fdf4ff",
    border: "#e9d5ff",
    description: "Property is being sold as part of a deceased owner's estate. Executor or court must approve. Often priced to sell quickly but process can take time.",
    negotiability: "Medium-High",
    timeline: "Medium (45–90 days)",
    tip: "Executors often want clean, quick offers. Cash or strong financing preferred. Property may need work — sold as-is is common.",
  },
  motivatedSeller: {
    label: "Motivated seller",
    sublabel: "Human seller, high urgency",
    icon: "🔥",
    color: "#b91c1c",
    bg: "#fef2f2",
    border: "#fca5a5",
    description: "A real person who needs to sell — due to financial stress, relocation, divorce, or long time on market. Highest negotiating leverage of any deal type.",
    negotiability: "High",
    timeline: "Fast (15–30 days)",
    tip: "Lead with a clean offer — fewer contingencies, flexible close date. Ask for seller concessions. Best opportunity for below-market deals.",
  },
  standard: {
    label: "Standard listing",
    sublabel: "No distress signals",
    icon: "🏠",
    color: "#15803d",
    bg: "#f0fdf4",
    border: "#86efac",
    description: "No obvious distress signals detected. Seller may still be motivated — check DOM and price history.",
    negotiability: "Market rate",
    timeline: "Standard",
    tip: "Use DOM and price cuts as negotiating leverage. Compare to recent comps before offering.",
  },
};

function classifyOpportunityType(prop, flags) {
  const remarks = (prop.listingRemarks || "").toLowerCase();
  const flagKeys = flags.map(f => f.key);

  // Institutional — bank/HUD/REO takes priority
  if (flagKeys.includes("reo") || /hud home/i.test(remarks) || /bank.owned/i.test(remarks)) {
    return OPPORTUNITY_TYPES.institutional;
  }
  // Short sale
  if (flagKeys.includes("shortSale")) {
    return OPPORTUNITY_TYPES.shortSale;
  }
  // Probate / estate
  if (flagKeys.includes("probate") || prop.probate) {
    return OPPORTUNITY_TYPES.probateEstate;
  }
  // Motivated seller — long DOM, price cuts, vacant, re-listed, fixer
  const isMotivated = prop.dom > 60 || prop.priceHistory?.length > 2 || prop.vacant || prop.failedListing ||
    flagKeys.includes("fixer") || flagKeys.includes("asIs") ||
    /motivated seller/i.test(remarks) || /price reduced/i.test(remarks) || /must sell/i.test(remarks);
  if (isMotivated) {
    return OPPORTUNITY_TYPES.motivatedSeller;
  }
  return OPPORTUNITY_TYPES.standard;
}

function OpportunityTypeBadge({ type, expanded = false }) {
  if (!expanded) {
    return (
      <span style={{ fontSize:11, fontWeight:500, padding:"2px 8px", borderRadius:4, color:type.color, background:type.bg, border:`1px solid ${type.border}`, display:"inline-flex", alignItems:"center", gap:4 }}>
        <span>{type.icon}</span>
        <span>{type.label}</span>
      </span>
    );
  }
  return (
    <div style={{ borderRadius:8, border:`1px solid ${type.border}`, background:type.bg, padding:"12px 14px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
        <span style={{ fontSize:20 }}>{type.icon}</span>
        <div>
          <div style={{ fontWeight:600, fontSize:13, color:type.color }}>{type.label}</div>
          <div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>{type.sublabel}</div>
        </div>
        <div style={{ marginLeft:"auto", display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 12px", textAlign:"right" }}>
          <div style={{ fontSize:10, color:"var(--color-text-secondary)" }}>Negotiability</div>
          <div style={{ fontSize:11, fontWeight:500, color:type.color }}>{type.negotiability}</div>
          <div style={{ fontSize:10, color:"var(--color-text-secondary)" }}>Timeline</div>
          <div style={{ fontSize:11, fontWeight:500, color:type.color }}>{type.timeline}</div>
        </div>
      </div>
      <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:8, lineHeight:1.5 }}>{type.description}</div>
      <div style={{ fontSize:12, background:"white", borderRadius:6, padding:"8px 10px", border:"0.5px solid var(--color-border-tertiary)" }}>
        <span style={{ fontWeight:600, color:type.color }}>💡 Buyer tip: </span>
        {type.tip}
      </div>
    </div>
  );
}

// ─── Flood Zone Helpers ───────────────────────────────────────────────────────
const FLOOD_ZONE_INFO = {
  VE:  {
    icon:"⛔", risk:"Extreme flood risk", color:"#7f1d1d", bg:"#fef2f2",
    plain:"Coastal high-velocity wave zone — highest risk category.",
    insurance:"Flood insurance mandatory for all loans. Estimated $3,000–$8,000+/yr.",
    buyer:"Expect very high insurance costs. Some lenders won't finance. Elevation certificate required.",
    sfha: true,
  },
  AE:  {
    icon:"🔴", risk:"High flood risk", color:"#b91c1c", bg:"#fef2f2",
    plain:"1% annual chance of flooding (100-year floodplain).",
    insurance:"Flood insurance required for FHA, VA, and conventional loans. Estimated $800–$3,500/yr.",
    buyer:"Mandatory flood insurance adds significant cost. Verify elevation certificate and current policy.",
    sfha: true,
  },
  A:   {
    icon:"🔴", risk:"High flood risk", color:"#b91c1c", bg:"#fef2f2",
    plain:"1% annual chance of flooding — no base flood elevation data available.",
    insurance:"Flood insurance required for govt-backed loans. Cost varies widely without elevation data.",
    buyer:"Higher uncertainty than AE zones — no elevation data means harder to price insurance.",
    sfha: true,
  },
  AO:  {
    icon:"🟡", risk:"Moderate flood risk", color:"#b45309", bg:"#fffbeb",
    plain:"Sheet-flow flooding area — water flows over land rather than rising in place.",
    insurance:"Flood insurance recommended. Estimated $400–$1,500/yr.",
    buyer:"Less severe than AE but still a meaningful flood risk. Check local drainage.",
    sfha: true,
  },
  AH:  {
    icon:"🟡", risk:"Moderate flood risk", color:"#b45309", bg:"#fffbeb",
    plain:"Ponding flood hazard — shallow standing water risk.",
    insurance:"Flood insurance recommended. Estimated $400–$1,200/yr.",
    buyer:"Typically less costly to insure than AE. Verify with local agent.",
    sfha: true,
  },
  X:   {
    icon:"🟢", risk:"Minimal flood risk", color:"#15803d", bg:"#f0fdf4",
    plain:"Outside the 500-year floodplain — lowest FEMA risk category.",
    insurance:"No mandatory flood insurance. Optional coverage ~$400–$900/yr.",
    buyer:"No flood insurance required for any loan type. Significant savings vs high-risk zones.",
    sfha: false,
  },
  D:   {
    icon:"⚪", risk:"Flood risk undetermined", color:"#6b7280", bg:"#f9fafb",
    plain:"No FEMA flood study has been conducted for this area.",
    insurance:"Insurance availability and cost unknown — contact local agent.",
    buyer:"Treat as unknown risk. Consider getting a flood determination before making an offer.",
    sfha: null,
  },
};

function FloodZoneBadge({ zone, expanded = false }) {
  if (!zone) return null;
  const info = FLOOD_ZONE_INFO[zone] || { icon:"⚪", risk:zone, color:"#6b7280", bg:"#f9fafb", plain:"", insurance:"", buyer:"", sfha:null };
  if (!expanded) {
    return (
      <span style={{ fontSize:11, fontWeight:500, padding:"2px 7px", borderRadius:4, color:info.color, background:info.bg, border:`1px solid ${info.color}22` }}>
        {info.icon} FEMA {zone} · {info.risk}
      </span>
    );
  }
  return (
    <div style={{ borderRadius:8, border:`1px solid ${info.color}33`, background:info.bg, padding:"12px 14px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
        <span style={{ fontSize:18 }}>{info.icon}</span>
        <div>
          <div style={{ fontWeight:600, fontSize:13, color:info.color }}>FEMA Zone {zone} — {info.risk}</div>
          <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginTop:1 }}>{info.plain}</div>
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:6 }}>
        <div style={{ background:"white", borderRadius:6, padding:"8px 10px", border:"0.5px solid var(--color-border-tertiary)" }}>
          <div style={{ fontSize:10, fontWeight:600, color:"var(--color-text-secondary)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:3 }}>Insurance</div>
          <div style={{ fontSize:12, color:"var(--color-text-primary)" }}>{info.insurance}</div>
        </div>
        <div style={{ background:"white", borderRadius:6, padding:"8px 10px", border:"0.5px solid var(--color-border-tertiary)" }}>
          <div style={{ fontSize:10, fontWeight:600, color:"var(--color-text-secondary)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:3 }}>Buyer note</div>
          <div style={{ fontSize:12, color:"var(--color-text-primary)" }}>{info.buyer}</div>
        </div>
      </div>
      {info.sfha === true && (
        <div style={{ marginTop:8, fontSize:11, color:info.color, fontWeight:500 }}>
          ⚠ Special Flood Hazard Area — flood insurance required for FHA, VA, and conventional loans
        </div>
      )}
    </div>
  );
}

function FinancingFlag({ flag }) {
  return (
    <span style={{ fontSize:11, fontWeight:500, padding:"2px 7px", borderRadius:4, color:flag.color, background:flag.bg, border:`1px solid ${flag.color}22` }}>
      {flag.label}
    </span>
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", maximumFractionDigits:0 }).format(n);

function zillowUrl(prop) {
  if (prop.zpid) return `https://www.zillow.com/homes/${prop.zpid}_zpid/`;
  const query = encodeURIComponent(`${prop.address}, ${prop.city}, ${prop.state} ${prop.zip}`);
  return `https://www.zillow.com/homes/${query}_rb/`;
}

function ZillowLink({ prop, style={} }) {
  return (
    <a href={zillowUrl(prop)} target="_blank" rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      style={{ fontSize:12, color:"#006aff", textDecoration:"none", fontWeight:500, display:"inline-flex", alignItems:"center", gap:3, ...style }}>
      View on Zillow
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M1 9L9 1M9 1H3.5M9 1V6.5" stroke="#006aff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </a>
  );
}

// ─── Grade colors ─────────────────────────────────────────────────────────────
const GRADE_COLORS = {
  high:   { bg:"#fef2f2", border:"#fca5a5", text:"#991b1b", label:"High distress",   dot:"#dc2626" },
  medium: { bg:"#fffbeb", border:"#fcd34d", text:"#92400e", label:"Medium distress", dot:"#d97706" },
  low:    { bg:"#f0fdf4", border:"#86efac", text:"#14532d", label:"Low distress",    dot:"#16a34a" },
};

function ScoreBadge({ grade, score }) {
  const c = GRADE_COLORS[grade];
  return (
    <span style={{ background:c.bg, border:`1px solid ${c.border}`, color:c.text, fontSize:12, fontWeight:500, padding:"2px 8px", borderRadius:6, display:"inline-flex", alignItems:"center", gap:4 }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:c.dot, display:"inline-block" }} />
      {score}/100 · {c.label}
    </span>
  );
}

function SignalBar({ label, value, max, color }) {
  return (
    <div style={{ marginBottom:6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"var(--color-text-secondary)", marginBottom:2 }}>
        <span>{label}</span><span>{value}/{max}</span>
      </div>
      <div style={{ height:4, borderRadius:2, background:"var(--color-background-secondary)" }}>
        <div style={{ height:"100%", borderRadius:2, width:`${Math.round((value/max)*100)}%`, background:color, transition:"width 0.4s" }} />
      </div>
    </div>
  );
}

// ─── Property Card ────────────────────────────────────────────────────────────
function PropertyCard({ prop, onClick, selected }) {
  const c = GRADE_COLORS[prop.grade];
  return (
    <div onClick={() => onClick(prop)} style={{ background:"var(--color-background-primary)", border:selected ? `2px solid ${c.border}` : "0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"14px 16px", cursor:"pointer", marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ fontWeight:500, fontSize:14 }}>{prop.address}</div>
          <div style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{prop.city}, {prop.state} {prop.zip}</div>
        </div>
        <ScoreBadge grade={prop.grade} score={prop.score} />
      </div>
      <div style={{ display:"flex", gap:16, marginTop:10, fontSize:13 }}>
        <span style={{ fontWeight:500 }}>{fmt(prop.price)}</span>
        <span style={{ color:"var(--color-text-secondary)" }}>{prop.bedrooms}bd · {prop.bathrooms}ba · {prop.sqft?.toLocaleString()} sqft</span>
      </div>
      <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontSize:11, background:"var(--color-background-secondary)", padding:"2px 6px", borderRadius:4 }}>{prop.dom} days on market</span>
        {prop.pricecuts > 0 && <span style={{ fontSize:11, background:"#fef2f2", color:"#991b1b", padding:"2px 6px", borderRadius:4 }}>{prop.pricecuts} cut{prop.pricecuts>1?"s":""} (-{prop.totalCutPct}%)</span>}
        {prop.vacant && <span style={{ fontSize:11, background:"#fffbeb", color:"#92400e", padding:"2px 6px", borderRadius:4 }}>Vacant</span>}
        {prop.probate && <span style={{ fontSize:11, background:"#fdf4ff", color:"#6b21a8", padding:"2px 6px", borderRadius:4 }}>Probate</span>}
        {prop.failedListing && <span style={{ fontSize:11, background:"#f0f9ff", color:"#0c4a6e", padding:"2px 6px", borderRadius:4 }}>Re-listed</span>}
        <ZillowLink prop={prop} style={{ marginLeft:"auto" }} />
      </div>
      <div style={{ display:"flex", gap:6, marginTop:6, flexWrap:"wrap", alignItems:"center" }}>
        {prop.opportunityType && <OpportunityTypeBadge type={prop.opportunityType} />}
        {prop.floodZone && <FloodZoneBadge zone={prop.floodZone} />}
        {prop.financingFlags?.map(f => <FinancingFlag key={f.key} flag={f} />)}
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────
function DetailPanel({ prop, onClose }) {
  if (!prop) return null;
  const c = GRADE_COLORS[prop.grade];
  return (
    <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"20px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ fontWeight:500, fontSize:16 }}>{prop.address}</div>
          <div style={{ color:"var(--color-text-secondary)", fontSize:13 }}>{prop.city}, {prop.state} {prop.zip}</div>
        </div>
        <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:18, color:"var(--color-text-secondary)" }}>✕</button>
      </div>
      <div style={{ margin:"14px 0", display:"flex", alignItems:"center", gap:12 }}>
        <ScoreBadge grade={prop.grade} score={prop.score} />
        <ZillowLink prop={prop} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:16 }}>
        {[
          { label:"Price", val:fmt(prop.price) },
          { label:"Avg comp", val:fmt(prop.avgCompPrice) },
          { label:"vs comps", val:`${prop.price > prop.avgCompPrice ? "+" : ""}${Math.round(((prop.price-prop.avgCompPrice)/prop.avgCompPrice)*100)}%` },
        ].map(({ label, val }) => (
          <div key={label} style={{ background:"var(--color-background-secondary)", borderRadius:8, padding:"10px 12px" }}>
            <div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>{label}</div>
            <div style={{ fontWeight:500, fontSize:15 }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontWeight:500, fontSize:13, marginBottom:8 }}>Signal breakdown</div>
        <SignalBar label="Days on market" value={prop.signals.dom} max={25} color={c.dot} />
        <SignalBar label="Price reductions" value={prop.signals.priceReductions} max={20} color={c.dot} />
        <SignalBar label="Price vs comps" value={prop.signals.priceVsComps} max={20} color={c.dot} />
        <SignalBar label="Market inventory" value={prop.signals.inventory} max={15} color={c.dot} />
        <SignalBar label="Seller motivation" value={prop.signals.sellerMotivation} max={15} color={c.dot} />
        <SignalBar label="Local news impact" value={prop.signals.localNews} max={5} color={c.dot} />
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontWeight:500, fontSize:13, marginBottom:6 }}>Price history</div>
        {prop.priceHistory.map((h, i) => (
          <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"4px 0", borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
            <span style={{ color:"var(--color-text-secondary)" }}>{h.date}</span>
            <span style={{ fontWeight:i===prop.priceHistory.length-1?500:400 }}>{fmt(h.price)}</span>
          </div>
        ))}
      </div>
      {/* Opportunity Type */}
      {prop.opportunityType && (
        <div style={{ marginTop:14 }}>
          <div style={{ fontWeight:500, fontSize:13, marginBottom:8 }}>Deal type</div>
          <OpportunityTypeBadge type={prop.opportunityType} expanded={true} />
        </div>
      )}

      {/* Flood Zone expanded */}
      {prop.floodZone && (
        <div style={{ marginTop:14 }}>
          <div style={{ fontWeight:500, fontSize:13, marginBottom:8 }}>Flood zone</div>
          <FloodZoneBadge zone={prop.floodZone} expanded={true} />
        </div>
      )}

      {/* Financing flags */}
      {prop.financingFlags?.length > 0 && (
        <div style={{ marginTop:14 }}>
          <div style={{ fontWeight:500, fontSize:13, marginBottom:8 }}>Financing & condition flags</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {prop.financingFlags.map(f => <FinancingFlag key={f.key} flag={f} />)}
          </div>
        </div>
      )}

      {/* Listing remarks */}
      {prop.listingRemarks && (
        <div style={{ marginTop:14 }}>
          <div style={{ fontWeight:500, fontSize:13, marginBottom:8 }}>Listing remarks</div>
          <div style={{ fontSize:12, color:"var(--color-text-secondary)", background:"var(--color-background-secondary)", borderRadius:8, padding:"10px 12px", lineHeight:1.6 }}>
            {prop.listingRemarks}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Map View ─────────────────────────────────────────────────────────────────
function MapView({ properties, selected, onSelect }) {
  useEffect(() => {
    if (window._leafletMap) { window._leafletMap.remove(); window._leafletMap = null; }
    const L = window.L;
    if (!L || !properties.length) return;

    const avgLat = properties.reduce((s, p) => s + p.lat, 0) / properties.length;
    const avgLng = properties.reduce((s, p) => s + p.lng, 0) / properties.length;

    const map = L.map("prop-map", { center:[avgLat, avgLng], zoom:13 });
    window._leafletMap = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:"© OpenStreetMap contributors"
    }).addTo(map);

    properties.forEach(prop => {
      const c = GRADE_COLORS[prop.grade];
      const icon = L.divIcon({
        className:"",
        html:`<div style="width:28px;height:28px;border-radius:50%;background:${c.dot};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:white;cursor:pointer;">${prop.score}</div>`,
        iconSize:[28,28], iconAnchor:[14,14],
      });
      L.marker([prop.lat, prop.lng], { icon })
        .addTo(map)
        .bindPopup(`<div style="font-family:sans-serif;min-width:180px;"><div style="font-weight:600;font-size:13px;">${prop.address}</div><div style="color:#666;font-size:12px;margin:2px 0;">${fmt(prop.price)} · ${prop.bedrooms}bd/${prop.bathrooms}ba</div><div style="margin-top:6px;padding:4px 8px;border-radius:6px;background:${c.bg};border:1px solid ${c.border};color:${c.text};font-size:12px;font-weight:500;">Score: ${prop.score}/100 · ${c.label}</div><div style="margin-top:6px;font-size:11px;color:#666;">${prop.dom} days · ${prop.pricecuts} cuts</div></div>`)
        .on("click", () => onSelect(prop));
    });

    return () => { if (window._leafletMap) { window._leafletMap.remove(); window._leafletMap = null; } };
  }, [properties, selected]);

  return (
    <div style={{ position:"relative", borderRadius:12, overflow:"hidden", border:"0.5px solid var(--color-border-tertiary)" }}>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" />
      <div id="prop-map" style={{ height:420, width:"100%" }} />
      <div style={{ position:"absolute", bottom:12, left:12, background:"white", borderRadius:8, padding:"8px 12px", boxShadow:"0 2px 8px rgba(0,0,0,0.15)", fontSize:11, display:"flex", gap:12, zIndex:1000 }}>
        {Object.entries(GRADE_COLORS).map(([g,c]) => (
          <span key={g} style={{ display:"flex", alignItems:"center", gap:4 }}>
            <span style={{ width:10, height:10, borderRadius:"50%", background:c.dot }} />
            <span style={{ color:"#333" }}>{c.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [zip, setZip] = useState("33904");
  const [inputZip, setInputZip] = useState("33904");
  const [tab, setTab] = useState("map");
  const [selected, setSelected] = useState(null);
  const [filterGrade, setFilterGrade] = useState("all");
  const [sortBy, setSortBy] = useState("score");
  const [sortDir, setSortDir] = useState("desc");
  const [showWeights, setShowWeights] = useState(false);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [showSources, setShowSources] = useState(false);

  const [listings, setListings] = useState(CAPE_CORAL_MOCK);
  const [floodZones, setFloodZones] = useState({}); // { id -> zone } separate from listings
  const [marketData, setMarketData] = useState(MOCK_MARKET);
  const [news, setNews] = useState(MOCK_NEWS);
  const [loading, setLoading] = useState(false);
  const [loadingFlood, setLoadingFlood] = useState(false);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(new Date().toISOString());
  const [usingMock, setUsingMock] = useState(true);

  // Run FEMA flood zone lookup on mock data at page load
  // Uses separate floodZones state so listings/map don't re-render on every update
  useEffect(() => {
    let cancelled = false;
    async function enrichMockFloodZones() {
      setLoadingFlood(true);
      const zones = {};
      for (let i = 0; i < CAPE_CORAL_MOCK.length; i++) {
        if (cancelled) break;
        const prop = CAPE_CORAL_MOCK[i];
        try {
          const fz = await fetchFloodZone(prop.lat, prop.lng);
          zones[prop.id] = fz.zone;
          if (!cancelled) setFloodZones({ ...zones });
        } catch(e) {}
        if (i < CAPE_CORAL_MOCK.length - 1) await new Promise(r => setTimeout(r, 300));
      }
      if (!cancelled) setLoadingFlood(false);
    }
    enrichMockFloodZones();
    return () => { cancelled = true; };
  }, []); // runs once on mount

  // Try live API, fall back to mock
  async function loadZip(zipCode) {
    setLoading(true);
    setError(null);
    setUsingMock(false);

    try {
      const [{ job_id }, marketResult] = await Promise.all([
        submitListingsJob(zipCode),
        fetchMarket(zipCode).catch(() => MOCK_MARKET),
      ]);
      setMarketData(marketResult);

      let pollCount = 0;
      const maxPolls = 30;
      while (pollCount < maxPolls) {
        await new Promise(r => setTimeout(r, 4000));
        const result = await pollListingsJob(job_id, zipCode);
        if (result.status === "complete") {
          setListings(result.properties || []);
          setFetchedAt(result.fetchedAt);
          setLoading(false);

          // Flood zones in background — stored separately to avoid map flicker
          setLoadingFlood(true);
          const props = result.properties || [];
          const zones = {};
          for (let i = 0; i < props.length; i++) {
            try {
              const fz = await fetchFloodZone(props[i].lat, props[i].lng);
              zones[props[i].id] = fz.zone;
              setFloodZones({ ...zones });
            } catch(e) {}
            if (i < props.length - 1) await new Promise(r => setTimeout(r, 200));
          }
          setLoadingFlood(false);
          return;
        }
        if (result.status === "failed") throw new Error("Job failed");
        pollCount++;
      }
      throw new Error("Timed out");
    } catch(err) {
      // Fall back to mock for 33904
      if (zipCode === "33904") {
        setListings(CAPE_CORAL_MOCK);
        setMarketData(MOCK_MARKET);
        setNews(MOCK_NEWS);
        setUsingMock(true);
        setError(null);
      } else {
        setError(`Could not load listings for ${zipCode}: ${err.message}. RapidAPI rate limit may be active — resets daily.`);
      }
      setLoading(false);
    }
  }

  function handleSearch(e) {
    e.preventDefault();
    const z = inputZip.trim();
    if (!/^\d{5}$/.test(z)) return;
    setZip(z);
    if (z === "33904") {
      setListings(CAPE_CORAL_MOCK);
      setMarketData(MOCK_MARKET);
      setNews(MOCK_NEWS);
      setUsingMock(true);
      setFetchedAt(new Date().toISOString());
    } else {
      loadZip(z);
    }
  }

  // Merge flood zones into listings without triggering map re-render
  const listingsWithZones = useMemo(() =>
    listings.map(l => ({ ...l, floodZone: floodZones[l.id] || l.floodZone || null })),
    [listings, floodZones]
  );

  const scored = useMemo(() =>
    listingsWithZones.map(l => scoreProperty(l, marketData, news, weights)),
    [listingsWithZones, marketData, news, weights]
  );

  const filtered = useMemo(() => {
    let list = filterGrade === "all" ? scored : scored.filter(p => p.grade === filterGrade);
    return [...list].sort((a, b) => {
      const v = sortDir === "desc" ? -1 : 1;
      if (sortBy === "score") return v * (a.score - b.score);
      if (sortBy === "price") return v * (a.price - b.price);
      if (sortBy === "dom") return v * (a.dom - b.dom);
      return 0;
    });
  }, [scored, filterGrade, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  return (
    <div style={{ fontFamily:"var(--font-sans)", maxWidth:980, margin:"0 auto", padding:"0 0 40px" }}>
      <div style={{ marginBottom:20 }}>
        <h2 style={{ fontSize:18, fontWeight:500, margin:"0 0 4px" }}>Distressed property finder</h2>
        <p style={{ fontSize:13, color:"var(--color-text-secondary)", margin:"0 0 14px" }}>
          Enter any US ZIP code to find distressed listings scored across 6 signals
        </p>
        <form onSubmit={handleSearch} style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <input value={inputZip} onChange={e => setInputZip(e.target.value)}
            placeholder="Enter ZIP code (e.g. 33904)" maxLength={5}
            style={{ width:200, fontSize:14, fontWeight:500 }} />
          <button type="submit" disabled={loading || !/^\d{5}$/.test(inputZip.trim())} style={{ fontSize:14 }}>
            {loading ? "Loading…" : "Search"}
          </button>
          {!loading && scored.length > 0 && (
            <span style={{ fontSize:12, color:"var(--color-text-secondary)" }}>
              {filtered.length} listings · {scored.filter(p => p.grade === "high").length} high distress
              {loadingFlood && " · fetching flood zones…"}
              {usingMock && <span style={{ marginLeft:6, color:"#d97706", fontWeight:500 }}>· demo data (ZIP 33904)</span>}
            </span>
          )}
        </form>
        {error && (
          <div style={{ marginTop:10, padding:"10px 14px", background:"#fef2f2", borderRadius:8, fontSize:13, color:"#991b1b" }}>
            {error}
          </div>
        )}
        {usingMock && (
          <div style={{ marginTop:8, padding:"8px 14px", background:"#fffbeb", borderRadius:8, fontSize:12, color:"#92400e", border:"1px solid #fcd34d" }}>
            Showing real Cape Coral listings from Zillow (cached demo data). Live search will activate when RapidAPI rate limit resets.
          </div>
        )}
      </div>

      {loading && (
        <div style={{ textAlign:"center", padding:"60px 0", color:"var(--color-text-secondary)", fontSize:14 }}>
          <div style={{ marginBottom:8 }}>Fetching listings for {zip}…</div>
          <div style={{ fontSize:12 }}>Pulling from Zillow · FEMA flood zones · Market data</div>
        </div>
      )}

      {!loading && scored.length > 0 && (<>
        {/* Market strip */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8, marginBottom:16 }}>
          {[
            { label:"Months of supply", val:marketData?.monthsSupply?.toFixed(1) ?? "—", note:marketData?.monthsSupply > 6 ? "Buyer's market" : "Seller's market" },
            { label:"Median days on market", val:marketData?.medianDOM ?? "—", note:"Area average" },
            { label:"Price drop listings", val:marketData?.priceDropPct ? `${Math.round(marketData.priceDropPct)}%` : "—", note:"Have had cuts" },
            { label:"Listings tracked", val:filtered.length, note:"This search" },
          ].map(({ label, val, note }) => (
            <div key={label} style={{ background:"var(--color-background-secondary)", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>{label}</div>
              <div style={{ fontWeight:500, fontSize:18, margin:"2px 0" }}>{val}</div>
              <div style={{ fontSize:10, color:"var(--color-text-secondary)" }}>{note}</div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
          <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} style={{ fontSize:13 }}>
            <option value="all">All distress levels</option>
            <option value="high">High distress</option>
            <option value="medium">Medium distress</option>
            <option value="low">Low distress</option>
          </select>
          <button onClick={() => setShowWeights(w => !w)} style={{ fontSize:13 }}>
            {showWeights ? "Hide" : "Adjust"} signal weights
          </button>
          <button onClick={() => setShowSources(s => !s)} style={{ fontSize:13 }}>Data sources</button>
          <div style={{ marginLeft:"auto", display:"flex", gap:4 }}>
            {["map","list","dashboard"].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ fontSize:13, background:tab===t?"var(--color-background-secondary)":"transparent", fontWeight:tab===t?500:400 }}>
                {t.charAt(0).toUpperCase()+t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {showWeights && (
          <div style={{ background:"var(--color-background-secondary)", borderRadius:10, padding:"14px 16px", marginBottom:14 }}>
            <div style={{ fontSize:13, fontWeight:500, marginBottom:10 }}>Signal weights</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px 24px" }}>
              {Object.entries(weights).map(([key, val]) => (
                <div key={key} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:12, color:"var(--color-text-secondary)", minWidth:130 }}>
                    {{ dom:"Days on market", priceReductions:"Price reductions", priceVsComps:"Price vs comps", inventory:"Market inventory", sellerMotivation:"Seller motivation", localNews:"Local news" }[key]}
                  </span>
                  <input type="range" min="0" max="3" step="0.5" value={val}
                    onChange={e => setWeights(w => ({ ...w, [key]:parseFloat(e.target.value) }))}
                    style={{ flex:1 }} />
                  <span style={{ fontSize:12, minWidth:20 }}>{val}x</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {showSources && (
          <div style={{ background:"var(--color-background-secondary)", borderRadius:10, padding:"14px 16px", marginBottom:14 }}>
            <div style={{ fontSize:13, fontWeight:500, marginBottom:8 }}>Data sources</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
              {Object.entries(DATA_SOURCES).map(([key, src]) => (
                <div key={key} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12 }}>
                  <span style={{ width:8, height:8, borderRadius:"50%", flexShrink:0, background:src.status==="live"?"#16a34a":"#d97706" }} />
                  <span>{src.label}</span>
                  <span style={{ fontSize:10, color:"var(--color-text-secondary)" }}>{src.status==="live"?"(live)":"(ready)"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Map tab */}
        {tab === "map" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 340px", gap:12 }}>
            {/* Left: map + property cards */}
            <div>
              <MapView properties={filtered} selected={selected} onSelect={setSelected} />
              <div style={{ marginTop:10 }}>
                {filtered.map(p => (
                  <PropertyCard key={p.id} prop={p} onClick={setSelected} selected={selected?.id===p.id} />
                ))}
              </div>
            </div>

            {/* Right: detail panel when selected, otherwise signal weights + filters */}
            <div>
              {selected ? (
                <DetailPanel prop={selected} onClose={() => setSelected(null)} />
              ) : (
                <div style={{ position:"sticky", top:16 }}>
                  {/* Signal weights */}
                  <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"16px" }}>
                    <div style={{ fontSize:13, fontWeight:500, marginBottom:12 }}>Signal weights</div>
                    {Object.entries(weights).map(([key, val]) => (
                      <div key={key} style={{ marginBottom:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--color-text-secondary)", marginBottom:4 }}>
                          <span>{{ dom:"Days on market", priceReductions:"Price reductions", priceVsComps:"Price vs comps", inventory:"Market inventory", sellerMotivation:"Seller motivation", localNews:"Local news" }[key]}</span>
                          <span style={{ fontWeight:500 }}>{val}x</span>
                        </div>
                        <input type="range" min="0" max="3" step="0.5" value={val}
                          onChange={e => setWeights(w => ({ ...w, [key]:parseFloat(e.target.value) }))}
                          style={{ width:"100%" }} />
                      </div>
                    ))}
                  </div>

                  {/* Filters */}
                  <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"16px", marginTop:10 }}>
                    <div style={{ fontSize:13, fontWeight:500, marginBottom:10 }}>Filters</div>
                    <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:6 }}>Distress level</div>
                    <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)}
                      style={{ fontSize:13, width:"100%", marginBottom:12 }}>
                      <option value="all">All levels</option>
                      <option value="high">High distress</option>
                      <option value="medium">Medium distress</option>
                      <option value="low">Low distress</option>
                    </select>
                    <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:4 }}>Sort by</div>
                    <div style={{ display:"flex", gap:6 }}>
                      {["score","price","dom"].map(col => (
                        <button key={col} onClick={() => toggleSort(col)}
                          style={{ fontSize:12, flex:1, background:sortBy===col?"var(--color-background-secondary)":"transparent", fontWeight:sortBy===col?500:400 }}>
                          {col === "dom" ? "DOM" : col.charAt(0).toUpperCase()+col.slice(1)}
                          {sortBy===col ? (sortDir==="desc"?" ↓":" ↑") : ""}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Summary stats */}
                  <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"16px", marginTop:10 }}>
                    <div style={{ fontSize:13, fontWeight:500, marginBottom:10 }}>Summary</div>
                    {["high","medium","low"].map(g => {
                      const count = scored.filter(p => p.grade===g).length;
                      const pct = scored.length ? Math.round((count/scored.length)*100) : 0;
                      const c = GRADE_COLORS[g];
                      return (
                        <div key={g} style={{ marginBottom:8 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:2 }}>
                            <span style={{ color:c.text }}>{c.label}</span>
                            <span style={{ color:"var(--color-text-secondary)" }}>{count} ({pct}%)</span>
                          </div>
                          <div style={{ height:4, borderRadius:2, background:"var(--color-background-secondary)" }}>
                            <div style={{ height:"100%", borderRadius:2, width:`${pct}%`, background:c.dot }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* List tab */}
        {tab === "list" && (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, tableLayout:"fixed" }}>
              <thead>
                <tr style={{ borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
                  {[
                    { col:"score", label:"Score", w:"70px" },
                    { col:"address", label:"Address", w:"180px" },
                    { col:"price", label:"Price", w:"100px" },
                    { col:null, label:"Bed/Bath", w:"70px" },
                    { col:"dom", label:"DOM", w:"55px" },
                    { col:null, label:"Cuts", w:"60px" },
                    { col:null, label:"Flood", w:"80px" },
                    { col:null, label:"Flags", w:"220px" },
                  ].map(({ col, label, w }) => (
                    <th key={label} onClick={() => col && toggleSort(col)}
                      style={{ textAlign:"left", padding:"8px 10px", fontWeight:500, color:"var(--color-text-secondary)", cursor:col?"pointer":"default", width:w }}>
                      {label}{col && sortBy===col ? (sortDir==="desc"?" ↓":" ↑") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const c = GRADE_COLORS[p.grade];
                  return (
                    <tr key={p.id} onClick={() => { setSelected(p); setTab("map"); }}
                      style={{ borderBottom:"0.5px solid var(--color-border-tertiary)", cursor:"pointer" }}>
                      <td style={{ padding:"10px 10px" }}><span style={{ fontWeight:500, color:c.dot }}>{p.score}</span></td>
                      <td style={{ padding:"10px 10px" }}>
                        <div style={{ fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.address}</div>
                        <div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>{p.zip}</div>
                      </td>
                      <td style={{ padding:"10px 10px" }}>{fmt(p.price)}</td>
                      <td style={{ padding:"10px 10px" }}>{p.bedrooms}/{p.bathrooms}</td>
                      <td style={{ padding:"10px 10px" }}>{p.dom}</td>
                      <td style={{ padding:"10px 10px" }}>{p.pricecuts > 0 ? `-${p.totalCutPct}%` : "—"}</td>
                      <td style={{ padding:"10px 10px" }}>
                        {p.floodZone ? <FloodZoneBadge zone={p.floodZone} /> : <span style={{ color:"var(--color-text-secondary)", fontSize:11 }}>—</span>}
                      </td>
                      <td style={{ padding:"10px 10px" }}>
                        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                          {p.financingFlags?.map(f => <span key={f.key} style={{ fontSize:10, background:f.bg, color:f.color, padding:"1px 5px", borderRadius:3 }}>{f.label}</span>)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Dashboard tab */}
        {tab === "dashboard" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:16 }}>
              <div style={{ fontWeight:500, fontSize:13, marginBottom:12 }}>Distress distribution</div>
              {["high","medium","low"].map(g => {
                const count = scored.filter(p => p.grade===g).length;
                const pct = scored.length ? Math.round((count/scored.length)*100) : 0;
                const c = GRADE_COLORS[g];
                return (
                  <div key={g} style={{ marginBottom:10 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3 }}>
                      <span style={{ color:c.text }}>{c.label}</span><span>{count} ({pct}%)</span>
                    </div>
                    <div style={{ height:8, borderRadius:4, background:"var(--color-background-secondary)" }}>
                      <div style={{ height:"100%", borderRadius:4, width:`${pct}%`, background:c.dot }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:16 }}>
              <div style={{ fontWeight:500, fontSize:13, marginBottom:12 }}>Top 5 opportunities</div>
              {[...scored].sort((a,b) => b.score-a.score).slice(0,5).map((p,i) => {
                const c = GRADE_COLORS[p.grade];
                return (
                  <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0", borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
                    <span style={{ fontSize:12, color:"var(--color-text-secondary)", minWidth:16 }}>{i+1}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.address}</div>
                      <div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>{fmt(p.price)}</div>
                    </div>
                    <span style={{ fontSize:13, fontWeight:500, color:c.dot }}>{p.score}</span>
                  </div>
                );
              })}
            </div>

            <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:16, gridColumn:"span 2" }}>
              <div style={{ fontWeight:500, fontSize:13, marginBottom:12 }}>Financing & flood risk summary</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
                {[
                  { label:"Cash only", count:scored.filter(p => p.financingFlags?.some(f => f.key==="cashOnly")).length },
                  { label:"As-is", count:scored.filter(p => p.financingFlags?.some(f => f.key==="asIs")).length },
                  { label:"Short sale / REO", count:scored.filter(p => p.financingFlags?.some(f => ["shortSale","reo"].includes(f.key))).length },
                  { label:"Fixer-upper", count:scored.filter(p => p.financingFlags?.some(f => f.key==="fixer")).length },
                ].map(({ label, count }) => (
                  <div key={label} style={{ background:"var(--color-background-secondary)", borderRadius:8, padding:"10px 12px" }}>
                    <div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>{label}</div>
                    <div style={{ fontWeight:500, fontSize:22 }}>{count}</div>
                    <div style={{ fontSize:10, color:"var(--color-text-secondary)" }}>of {scored.length} listings</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:16, gridColumn:"span 2" }}>
              <div style={{ fontWeight:500, fontSize:13, marginBottom:12 }}>Nearby news events (50-mile radius)</div>
              {news.map(n => (
                <div key={n.id} style={{ display:"flex", gap:10, padding:"8px 0", borderBottom:"0.5px solid var(--color-border-tertiary)", fontSize:12 }}>
                  <span style={{ width:8, height:8, borderRadius:"50%", marginTop:4, flexShrink:0, background:n.sentiment==="negative"?"#dc2626":"#16a34a" }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:500 }}>{n.headline}</div>
                    <div style={{ color:"var(--color-text-secondary)", fontSize:11 }}>{n.source} · {n.date}</div>
                  </div>
                  {n.sentiment==="negative" && (
                    <span style={{ marginLeft:"auto", fontSize:11, background:"#fef2f2", color:"#991b1b", padding:"2px 6px", borderRadius:4, height:"fit-content", flexShrink:0 }}>
                      Severity {n.severity}/5
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </>)}
    </div>
  );
}
