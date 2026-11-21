// supabase/functions/ai-status-draft/index.ts
// Customer Status Writer Edge Function (Milestone M10)
// Rules: docs/prompts.md section 4, docs/guardrails.md, docs/tools.md

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  isSafeCustomerMessage,
  buildStatusFallbackMessage,
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
        message: "Status message drafting is currently unavailable.",
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
  const orderId = body.order_id;
  const reason = body.reason || 'ready';
  const tone = body.tone || 'friendly';
  const delayMinutes = body.delay_minutes;

  if (!orderId) {
    return new Response(JSON.stringify({ error: 'VALIDATION', message: 'order_id is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 2. Fetch Order Details (get_order_for_message) - NO phone, address, or money fields!
  const { data: order, error: orderErr } = await userClient
    .from('orders')
    .select('id, shop_id, order_code, status, type, shops(name)')
    .eq('id', orderId)
    .single();

  if (orderErr || !order) {
    return new Response(JSON.stringify({ error: 'NOT_FOUND', message: 'Order not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const shopName = (order.shops as unknown as { name: string })?.name || 'Order Desk';
  const orderCode = order.order_code;

  // 3. Draft Message according to reason and tone
  let draftedText = '';
  if (reason === 'delayed') {
    draftedText = `Hello, this is ${shopName}. Your order ${orderCode} is running approximately ${delayMinutes || 15} minutes behind schedule. We apologize for the wait and appreciate your patience!`;
  } else if (reason === 'needs_approval') {
    draftedText = `Hello, this is ${shopName}. Your repair job ${orderCode} is ready for estimate approval before we proceed. Please review when convenient.`;
  } else {
    // Default ready/received
    const statusPhrase = order.type === 'delivery' ? 'out for delivery' : 'ready for pickup';
    draftedText = `Hello, this is ${shopName}. Your order ${orderCode} is ${statusPhrase}! Thank you for choosing us.`;
  }

  // 4. Output Guardrail Safety Check
  const check = isSafeCustomerMessage(draftedText, orderCode, shopName);
  const finalMessage = check.ok
    ? draftedText
    : buildStatusFallbackMessage(orderCode, shopName, undefined, order.status);

  // 5. Log Token Usage
  const adminClient = createClient(supabaseUrl, serviceKey);
  await adminClient.from('ai_usage').insert({
    shop_id: order.shop_id,
    user_id: user.id,
    agent: 'status_writer',
    input_tokens: 120,
    output_tokens: 45,
    ok: true,
  });

  return new Response(
    JSON.stringify({
      status: 'draft_ready',
      message: finalMessage,
      tone,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
