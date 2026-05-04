// api/lib/supabase.js
// Shared Supabase client used by all API functions
// Uses service role key for server-side writes (bypasses RLS)

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl) throw new Error('SUPABASE_URL is required');
if (!supabaseServiceKey) throw new Error('SUPABASE_SERVICE_KEY is required');

// Admin client — server side only, never expose to frontend
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

// Public client — safe for reading public data
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false }
});

// ─── Listing helpers ──────────────────────────────────────────────────────────

// Check if a ZIP was fetched recently (within TTL minutes)
export async function isZipCacheValid(zip, ttlMinutes = 60) {
  const { data } = await supabaseAdmin
    .from('zip_cache')
    .select('last_fetched')
    .eq('zip', zip)
    .single();

  if (!data?.last_fetched) return false;

  const age = (Date.now() - new Date(data.last_fetched).getTime()) / 1000 / 60;
  return age < ttlMinutes;
}

// Get cached listings for a ZIP
export async function getCachedListings(zip) {
  const { data, error } = await supabaseAdmin
    .from('listings')
    .select('*')
    .eq('zip', zip)
    .order('distress_score', { ascending: false });

  if (error) throw error;
  return data || [];
}

// Store listings for a ZIP
export async function storeListings(zip, listings) {
  if (!listings.length) return;

  // Upsert listings
  const { error } = await supabaseAdmin
    .from('listings')
    .upsert(listings.map(l => ({
      id: l.id,
      address: l.address,
      city: l.city,
      state: l.state,
      zip: l.zip,
      lat: l.lat,
      lng: l.lng,
      price: l.price,
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms,
      sqft: l.sqft,
      dom: l.dom,
      price_history: l.priceHistory,
      avg_comp_price: l.avgCompPrice,
      mls_status: l.mlsStatus,
      listing_remarks: l.listingRemarks,
      vacant: l.vacant,
      probate: l.probate,
      failed_listing: l.failedListing,
      flood_zone: l.floodZone,
      flood_zone_source: l.floodZoneSource,
      zpid: l.zpid,
      zillow_url: l.zillowUrl,
      source: l.source,
      fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })), { onConflict: 'id' });

  if (error) throw error;

  // Update ZIP cache
  await supabaseAdmin
    .from('zip_cache')
    .upsert({
      zip,
      last_fetched: new Date().toISOString(),
      listing_count: listings.length,
      source: listings[0]?.source || 'unknown'
    }, { onConflict: 'zip' });
}

// ─── Flood zone helpers ───────────────────────────────────────────────────────

// Get cached flood zone for a coordinate
export async function getCachedFloodZone(lat, lng) {
  const latR = parseFloat(lat).toFixed(4);
  const lngR = parseFloat(lng).toFixed(4);

  const { data } = await supabaseAdmin
    .from('flood_zones')
    .select('*')
    .eq('lat', latR)
    .eq('lng', lngR)
    .single();

  return data || null;
}

// Store flood zone for a coordinate
export async function storeFloodZone(lat, lng, zoneData) {
  const latR = parseFloat(lat).toFixed(4);
  const lngR = parseFloat(lng).toFixed(4);

  await supabaseAdmin
    .from('flood_zones')
    .upsert({
      lat: latR,
      lng: lngR,
      zone: zoneData.zone,
      sfha: zoneData.sfha,
      requires_mandatory_insurance: zoneData.requiresMandatoryInsurance,
      estimated_annual_premium: zoneData.estimatedAnnualPremium,
      source: zoneData.source,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'lat,lng' });
}

// ─── Market stats helpers ─────────────────────────────────────────────────────

export async function getCachedMarketStats(zip) {
  const { data } = await supabaseAdmin
    .from('market_stats')
    .select('*')
    .eq('zip', zip)
    .single();

  return data || null;
}

export async function storeMarketStats(zip, stats) {
  await supabaseAdmin
    .from('market_stats')
    .upsert({
      zip,
      months_supply: stats.monthsSupply,
      median_dom: stats.medianDOM,
      median_sale_price: stats.medianSalePrice,
      median_list_price: stats.medianListPrice,
      active_listings: stats.activeListings,
      price_drop_pct: stats.priceDropPct,
      homes_above_list_pct: stats.homesAboveListPricePct,
      source: stats.source,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'zip' });
}

// ─── Price event helpers ──────────────────────────────────────────────────────

export async function storePriceEvent(listingId, eventType, oldPrice, newPrice, source) {
  const changeAmount = newPrice - oldPrice;
  const changePct = oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice) * 100 : 0;

  await supabaseAdmin
    .from('price_events')
    .insert({
      listing_id: listingId,
      event_type: eventType,
      old_price: oldPrice,
      new_price: newPrice,
      change_amount: changeAmount,
      change_pct: changePct,
      source,
      detected_at: new Date().toISOString(),
    });
}
