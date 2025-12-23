import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// Database query functions
async function searchCustomers(query: string) {
  const { data } = await supabase
    .from('customers')
    .select('*')
    .or(`customer_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(5);
  return data;
}

async function getCustomerByEmail(email: string) {
  const { data } = await supabase
    .from('customers')
    .select('*')
    .ilike('email', `%${email}%`)
    .limit(1)
    .single();
  return data;
}

async function getOrderById(orderId: string) {
  const { data } = await supabase
    .from('orders')
    .select('*')
    .or(`order_number.eq.${orderId},apparel_magic_id.eq.${orderId}`)
    .limit(1)
    .single();
  return data;
}

async function getOrdersByCustomerId(customerId: string) {
  const { data } = await supabase
    .from('orders')
    .select('*')
    .eq('apparel_magic_customer_id', customerId)
    .order('order_date', { ascending: false })
    .limit(10);
  return data;
}

async function getPickTicketsByOrderId(orderId: string) {
  const { data } = await supabase
    .from('pick_tickets')
    .select('*')
    .eq('apparel_magic_order_id', orderId);
  return data;
}

async function getShipmentsByPickTicketId(pickTicketId: string) {
  const shipStationId = `AM-PT-${pickTicketId}`;
  const { data } = await supabase
    .from('shipments')
    .select('*')
    .eq('pick_ticket_id', shipStationId);
  return data;
}

async function getInvoicesByCustomerId(customerId: string) {
  const { data } = await supabase
    .from('invoices')
    .select('*')
    .eq('apparel_magic_customer_id', customerId)
    .order('invoice_date', { ascending: false })
    .limit(10);
  return data;
}

// Tool definitions
const tools = [
  {
    name: "search_customers",
    description: "Search for customers by name, email, or phone number",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (name, email, or phone)" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_customer_by_email",
    description: "Get a customer's details by their email address",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Customer email address" }
      },
      required: ["email"]
    }
  },
  {
    name: "get_order",
    description: "Get details of a specific order by order number",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Order number" }
      },
      required: ["order_id"]
    }
  },
  {
    name: "get_customer_orders",
    description: "Get recent orders for a customer by their ApparelMagic customer ID",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "ApparelMagic customer ID" }
      },
      required: ["customer_id"]
    }
  },
  {
    name: "get_order_tracking",
    description: "Get pick tickets AND shipments for an order to check shipping status. Returns tracking numbers if shipped.",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Order number" }
      },
      required: ["order_id"]
    }
  },
  {
    name: "get_customer_invoices",
    description: "Get invoices for a customer by their ApparelMagic customer ID",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "ApparelMagic customer ID" }
      },
      required: ["customer_id"]
    }
  }
];

// Execute tool calls
async function executeTool(name: string, input: any) {
  switch (name) {
    case "search_customers":
      return await searchCustomers(input.query);
    case "get_customer_by_email":
      return await getCustomerByEmail(input.email);
    case "get_order":
      return await getOrderById(input.order_id);
    case "get_customer_orders":
      return await getOrdersByCustomerId(input.customer_id);
    case "get_order_tracking":
      const pickTickets = await getPickTicketsByOrderId(input.order_id);
      const allShipments: any[] = [];
      if (pickTickets) {
        for (const pt of pickTickets) {
          const shipments = await getShipmentsByPickTicketId(pt.pick_ticket_id);
          if (shipments) {
            allShipments.push(...shipments.map(s => ({ ...s, for_pick_ticket: pt.pick_ticket_id })));
          }
        }
      }
      return { pick_tickets: pickTickets, shipments: allShipments };
    case "get_customer_invoices":
      return await getInvoicesByCustomerId(input.customer_id);
    default:
      return { error: "Unknown tool" };
  }
}

const SYSTEM_PROMPT = `You are an AI assistant helping staff at Advance Apparels respond to customer emails. Your job is to draft professional, helpful email replies.

You have access to the company's database to look up order status, tracking information, invoices, and customer details.

CRITICAL - HOW TO CHECK IF AN ORDER HAS SHIPPED:
1. Use get_order_tracking with the order number
2. Check if there are entries in the "shipments" array WITH a tracking_number
3. If a pick_ticket has a tracking_number in shipments = SHIPPED
4. If no shipments or no tracking_number = NOT SHIPPED YET

When providing tracking information, include the tracking URL:
- UPS (starts with "1Z"): https://www.ups.com/track?tracknum={tracking_number}
- FedEx (12-22 digits): https://www.fedex.com/fedextrack/?trknbr={tracking_number}
- USPS (starts with "94"): https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking_number}

RESPONSE GUIDELINES:
- Be professional, friendly, and concise
- Address the customer by name if known
- Directly answer their question
- Include specific details (order numbers, tracking numbers, dates)
- If you can't find information, apologize and offer to help further
- Sign off appropriately (e.g., "Best regards," or "Thank you,")
- Do NOT include a signature name - the staff member will add their own

OUTPUT FORMAT:
Return ONLY the email body text. Do not include subject lines or headers.`;

export async function POST(request: Request) {
  try {
    const { threadSubject, messages, senderEmail, senderName } = await request.json();

    // Build conversation context from email thread
    const emailContext = messages.map((msg: any) => {
      const direction = msg.is_outbound ? 'Advance Apparels sent' : 'Customer wrote';
      return `${direction}:\n${msg.body_text || msg.body_html?.replace(/<[^>]*>/g, '') || ''}`;
    }).join('\n\n---\n\n');

    const userMessage = `Here is an email thread that needs a response:

SUBJECT: ${threadSubject}
FROM: ${senderName || senderEmail}
EMAIL: ${senderEmail}

CONVERSATION:
${emailContext}

Please draft a professional reply to this customer. Look up any relevant order, shipping, or account information in our database to provide accurate details.`;

    // Initial API call
    const apiMessages = [{ role: "user", content: userMessage }];

    let response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: tools,
        messages: apiMessages
      })
    });

    let data = await response.json();

    // Handle tool use in a loop
    while (data.stop_reason === 'tool_use') {
      const toolUseBlocks = data.content.filter((block: any) => block.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`[AI Assist] Executing tool: ${toolUse.name}`, toolUse.input);
        const result = await executeTool(toolUse.name, toolUse.input);
        console.log(`[AI Assist] Tool result:`, result);
        
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result, null, 2)
        });
      }

      apiMessages.push({ role: "assistant", content: data.content });
      apiMessages.push({ role: "user", content: toolResults } as any);

      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          tools: tools,
          messages: apiMessages
        })
      });

      data = await response.json();
    }

    // Extract text response
    const textContent = data.content?.find((block: any) => block.type === 'text');
    const draftReply = textContent?.text || 'I apologize, but I was unable to generate a response.';

    return NextResponse.json({ draft: draftReply });

  } catch (error) {
    console.error('AI Assist error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
