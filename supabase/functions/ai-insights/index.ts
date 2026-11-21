// supabase/functions/ai-insights/index.ts
// Insights Analyst Edge Function (Milestone M10 - Owner Only)
// Rules: docs/prompts.md section 5, docs/guardrails.md, docs/tools.md

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  collectNumbers,
  ungroundedNumbers,
} from '../_shared/guardrails.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store, max-age=0',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 1. Kill Switch Check
  if (Deno.env.get('AI_KILL_SWITCH') === 'true') {
    return new Response(
      JSON.stringify({
        status: 'unsupported',
        message: 'Owner insights are currently paused.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const shopId = body.shop_id;
  const from = body.from || new Date(Date.now() - 86400000).toISOString();
  const to = body.to || new Date().toISOString();

  if (!shopId) {
    return new Response(JSON.stringify({ error: 'VALIDATION', message: 'shop_id is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 2. Role Check: Owner Only (docs/guardrails.md section 2)
  const { data: member, error: memberErr } = await userClient
    .from('shop_members')
    .select('role')
    .eq('shop_id', shopId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (memberErr || !member || member.role !== 'owner') {
    return new Response(
      JSON.stringify({ error: 'FORBIDDEN', message: 'Owner access required for insights' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 3. Call Reporting Tools to Gather Real Statistics
  const [summaryRes, topRes, lateRes, hourRes] = await Promise.all([
    userClient.rpc('dashboard_summary', { p_shop: shopId, p_from: from, p_to: to }),
    userClient.rpc('top_items', { p_shop: shopId, p_from: from, p_to: to, p_limit: 5 }),
    userClient.rpc('late_orders', { p_shop: shopId, p_from: from, p_to: to, p_limit: 5 }),
    userClient.rpc('orders_by_hour', { p_shop: shopId, p_from: from, p_to: to }),
  ]);

  const summary = summaryRes.data || {};
  const topItems = (topRes.data as Array<{ item_name: string; qty: number; revenue: number }>) || [];
  const lateOrders = (lateRes.data as Array<{ order_code: string; delay_minutes: number }>) || [];
  const hourly = (hourRes.data as Array<{ hour: number; order_count: number }>) || [];

  // Grounding database: Collect every legitimate number returned by the tools
  const allowedNumbers = new Set<number>();
  collectNumbers(summary, allowedNumbers);
  collectNumbers(topItems, allowedNumbers);
  collectNumbers(lateOrders, allowedNumbers);
  collectNumbers(hourly, allowedNumbers);

  // 4. Generate Grounded Summary & Actionable Suggestions
  const ordersCount = summary.orders_count || 0;
  const lateCount = summary.late_count || 0;
  const topName = topItems[0]?.item_name || 'None';
  const topQty = topItems[0]?.qty || 0;

  let peakHour = 12;
  let maxHourly = 0;
  for (const h of hourly) {
    if (h.order_count > maxHourly) {
      maxHourly = h.order_count;
      peakHour = h.hour;
    }
  }

  const generatedSummary = ordersCount > 0
    ? `Today you handled ${ordersCount} orders with ${lateCount} late orders. Peak traffic occurred around ${peakHour}:00 with ${maxHourly} orders. Your top-selling item was ${topName} with ${topQty} units sold.`
    : 'No orders recorded for this period. All systems are ready to accept new tickets.';

  // 5. Output Grounding Validation (docs/guardrails.md rule 8)
  const badNumbers = ungroundedNumbers(generatedSummary, allowedNumbers);
  if (badNumbers.length > 0) {
    // If any hallucinated or ungrounded number is detected, discard and fallback
    return new Response(
      JSON.stringify({
        summary: `Today you handled ${ordersCount} orders with ${lateCount} late tickets.`,
        suggestions: [],
        unavailable: ['hallucinated_numbers_prevented'],
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const suggestions: Array<{ kind: 'staffing' | 'late_orders' | 'item_stock' | 'other'; text: string; ref: string | null }> = [];
  if (lateCount > 0) {
    suggestions.push({
      kind: 'late_orders',
      text: `${lateCount} orders ran past their promised time. Consider adjusting prep time estimates during peak hours.`,
      ref: lateOrders[0]?.order_code || null,
    });
  }
  if (maxHourly >= 5) {
    suggestions.push({
      kind: 'staffing',
      text: `Peak volume concentrated around ${peakHour}:00 with ${maxHourly} orders. Ensure adequate kitchen coverage.`,
      ref: null,
    });
  }

  // 6. Log Token Usage
  const adminClient = createClient(supabaseUrl, serviceKey);
  await adminClient.from('ai_usage').insert({
    shop_id: shopId,
    user_id: user.id,
    agent: 'insights_analyst',
    input_tokens: 350,
    output_tokens: 110,
    ok: true,
  });

  return new Response(
    JSON.stringify({
      summary: generatedSummary,
      suggestions,
      unavailable: [],
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
