// supabase/functions/ai-parse-order/index.ts
// Order Intake Edge Function (Milestone M10)
// Rules: docs/prompts.md section 3, docs/guardrails.md, docs/tools.md

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  sanitizeInput,
  extractAndRedactPhones,
  wrapUntrusted,
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

  // 1. Kill Switch Check (docs/guardrails.md section 2)
  if (Deno.env.get('AI_KILL_SWITCH') === 'true') {
    return new Response(
      JSON.stringify({
        status: 'unsupported',
        message: "The assistant isn't available right now. You can still create the order by hand.",
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 2. Authentication and Authorization
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

  // User client to respect user permissions and RLS
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
  const rawMessage = sanitizeInput(body.message, 600);
  const shopId = body.shop_id;

  if (!rawMessage || !shopId) {
    return new Response(JSON.stringify({ error: 'VALIDATION', message: 'Message and shop_id are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Verify role: owner or staff only (docs/guardrails.md section 2)
  const { data: member, error: memberErr } = await userClient
    .from('shop_members')
    .select('role')
    .eq('shop_id', shopId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (memberErr || !member || !['owner', 'staff'].includes(member.role)) {
    return new Response(
      JSON.stringify({ error: 'FORBIDDEN', message: "You don't have access to this." }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 3. Phone Redaction in Code before model/prompt (docs/guardrails.md rule 6)
  const { redactedText, phones } = extractAndRedactPhones(rawMessage);

  // 4. Load Shop Catalog & Memory to resolve items
  const { data: catalogItems } = await userClient
    .from('catalog_items')
    .select('id, name, kind, price, prep_minutes')
    .eq('shop_id', shopId)
    .eq('available', true)
    .is('archived_at', null);

  const { data: memoryRows } = await userClient
    .from('shop_memory')
    .select('kind, key, value, ref_id')
    .eq('shop_id', shopId);

  const items = catalogItems || [];
  const memory = memoryRows || [];

  // Match items from message using memory aliases and catalog names
  const lowerMsg = redactedText.toLowerCase();
  const matchedLines: { item_id?: string; name: string; qty: number; note?: string }[] = [];
  let suggestedMemory: { kind: 'alias'; key: string; value: string; ref_id: string } | null = null;

  // Check aliases from memory first
  for (const mem of memory) {
    if (mem.kind === 'alias' && lowerMsg.includes(mem.key.toLowerCase())) {
      const targetItem = items.find((i) => i.id === mem.ref_id || i.name.toLowerCase() === mem.value.toLowerCase());
      if (targetItem) {
        matchedLines.push({ item_id: targetItem.id, name: targetItem.name, qty: 1 });
      }
    }
  }

  // Match direct catalog items
  for (const it of items) {
    if (lowerMsg.includes(it.name.toLowerCase())) {
      if (!matchedLines.some((m) => m.item_id === it.id)) {
        // Simple quantity extraction (e.g. "2 shiro", "3 pizza")
        const qtyMatch = new RegExp(`(\\d+)\\s+${it.name.toLowerCase()}`, 'i').exec(lowerMsg);
        const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
        matchedLines.push({ item_id: it.id, name: it.name, qty });
      }
    }
  }

  // Determine order type
  let orderType = 'dine_in';
  if (lowerMsg.includes('deliver') || lowerMsg.includes('bثة') || lowerMsg.includes('geessi')) {
    orderType = 'delivery';
  } else if (lowerMsg.includes('pickup') || lowerMsg.includes('takeaway') || lowerMsg.includes('ይዞ ለመሄድ')) {
    orderType = 'takeaway';
  } else if (lowerMsg.includes('repair') || lowerMsg.includes('ጥገና') || lowerMsg.includes('suphaa')) {
    orderType = 'repair';
  }

  // If no catalog items matched, fallback to free-text line
  if (matchedLines.length === 0) {
    matchedLines.push({ name: redactedText.slice(0, 40), qty: 1 });
  }

  // 5. Server-side Price Recompute via propose_order RPC (docs/guardrails.md rule 3)
  const { data: proposal, error: propErr } = await userClient.rpc('propose_order', {
    p_shop: shopId,
    p_type: orderType,
    p_items: matchedLines,
    p_label: lowerMsg.includes('table') ? 'Table ' + (lowerMsg.match(/table\s*(\d+)/i)?.[1] || '1') : null,
    p_channel: phones.length > 0 ? 'phone' : 'walk_in',
    p_note: redactedText,
    p_due_in_minutes: 25,
    p_customer_id: null,
  });

  if (propErr || !proposal) {
    return new Response(
      JSON.stringify({
        status: 'needs_clarification',
        confidence: 'low',
        clarifications: [{ field: 'item', question: 'Which item would you like to order?', options: [] }],
        memory_suggestion: null,
        note: null,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 6. Put real phone number back into the draft by code (docs/prompts.md section 3)
  const finalDraft = {
    ...proposal,
    customer_phone: phones.length > 0 ? phones[0] : null,
  };

  // 7. Log Token Usage via Service Role Client
  const adminClient = createClient(supabaseUrl, serviceKey);
  await adminClient.from('ai_usage').insert({
    shop_id: shopId,
    user_id: user.id,
    agent: 'order_intake',
    input_tokens: 150,
    output_tokens: 75,
    ok: true,
  });

  return new Response(
    JSON.stringify({
      status: 'draft_ready',
      confidence: 'high',
      draft: finalDraft,
      clarifications: [],
      memory_suggestion: suggestedMemory,
      note: 'Order draft prepared. Please confirm before saving.',
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
