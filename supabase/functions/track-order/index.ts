// supabase/functions/track-order/index.ts
// Public order tracking Edge Function
// Rules from docs/security.md section 9:
// - Service role only for token lookup
// - Minimal fields only (zero phone, address, names, items, money)
// - Generic answer and similar timing for unknown / expired tokens
// - Per-IP (30/min) and per-token (10/min) rate limits
// - Expiry rules: 30 days cancelled, 60 days completed

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// In-memory sliding window rate limiter
const ipBuckets = new Map<string, number[]>();
const tokenBuckets = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_IP = 30;
const MAX_PER_TOKEN = 10;

function checkRateLimit(ip: string, token?: string | null): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const cleanIp = ip.trim() || 'unknown';

  // Check IP limit
  const ipTimestamps = (ipBuckets.get(cleanIp) || []).filter((t) => now - t < WINDOW_MS);
  ipBuckets.set(cleanIp, ipTimestamps);
  if (ipTimestamps.length >= MAX_PER_IP) {
    const oldest = ipTimestamps[0] || now;
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)) };
  }

  // Check Token limit
  if (token) {
    const cleanToken = token.trim();
    const tokenTimestamps = (tokenBuckets.get(cleanToken) || []).filter((t) => now - t < WINDOW_MS);
    tokenBuckets.set(cleanToken, tokenTimestamps);
    if (tokenTimestamps.length >= MAX_PER_TOKEN) {
      const oldest = tokenTimestamps[0] || now;
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)) };
    }
  }

  // Record request
  ipTimestamps.push(now);
  if (token) {
    const tokenList = tokenBuckets.get(token.trim()) || [];
    tokenList.push(now);
  }

  return { allowed: true };
}

function isValidToken(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  return /^[A-Za-z0-9_-]{16,64}$/.test(token.trim());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // 1. Extract IP
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      '127.0.0.1';

    // 2. Extract Token
    let token: string | null = null;
    const url = new URL(req.url);
    if (url.searchParams.has('token')) {
      token = url.searchParams.get('token');
    } else if (req.method === 'POST') {
      try {
        const body = await req.json();
        token = body?.token ?? null;
      } catch {
        token = null;
      }
    }

    // 3. Enforce Rate Limiting
    const rateCheck = checkRateLimit(clientIp, token);
    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({
          error: 'RATE_LIMITED',
          message: 'Too many requests. Please wait a moment.',
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': String(rateCheck.retryAfter || 60),
          },
        }
      );
    }

    // 4. Validate Token format
    if (!token || !isValidToken(token)) {
      // Timing equalisation: simulate DB query time before answering
      await delay(Math.max(0, 45 - (Date.now() - startTime)));
      return new Response(
        JSON.stringify({ found: false, message: "We couldn't find this order." }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Look up token using Service Role
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: contact } = await supabase
      .from('order_contacts')
      .select('order_id, shop_id')
      .eq('tracking_token', token.trim())
      .maybeSingle();

    if (!contact) {
      await delay(Math.max(0, 45 - (Date.now() - startTime)));
      return new Response(
        JSON.stringify({ found: false, message: "We couldn't find this order." }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Look up order and shop
    const [orderRes, shopRes] = await Promise.all([
      supabase
        .from('orders')
        .select('id, status, type, order_code, order_no, due_at, completed_at, cancelled_at, updated_at')
        .eq('id', contact.order_id)
        .maybeSingle(),
      supabase
        .from('shops')
        .select('name, business_type')
        .eq('id', contact.shop_id)
        .maybeSingle(),
    ]);

    const order = orderRes.data;
    const shop = shopRes.data;

    if (!order || !shop) {
      await delay(Math.max(0, 45 - (Date.now() - startTime)));
      return new Response(
        JSON.stringify({ found: false, message: "We couldn't find this order." }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Check Token Expiry
    const nowMs = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    let isExpired = false;
    if (order.status === 'cancelled') {
      const cancelTime = new Date(order.cancelled_at || order.updated_at).getTime();
      if (nowMs - cancelTime > 30 * DAY_MS) isExpired = true;
    } else if (order.status === 'completed') {
      const completeTime = new Date(order.completed_at || order.updated_at).getTime();
      if (nowMs - completeTime > 60 * DAY_MS) isExpired = true;
    }

    if (isExpired) {
      await delay(Math.max(0, 45 - (Date.now() - startTime)));
      return new Response(
        JSON.stringify({ found: false, message: "We couldn't find this order." }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 8. Minimal response payload (STRICTLY NO phone, address, names, items, or money)
    const sanitizedResponse = {
      found: true,
      shop_name: shop.name,
      business_type: shop.business_type,
      order_code: order.order_code || `Order #${order.order_no}`,
      order_type: order.type,
      status: order.status,
      due_at: order.due_at || null,
      updated_at: order.updated_at,
    };

    return new Response(JSON.stringify(sanitizedResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (_err) {
    return new Response(
      JSON.stringify({ found: false, message: "We couldn't find this order." }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
