// /api/chat — Vercel serverless function, OpenRouter backend.
// Set OPENROUTER_API_KEY in the project's environment variables.
// The client sends { messages } only. Model, system prompt and limits are fixed here.

const MODEL = 'openai/gpt-4o-mini';
const MAX_TOKENS = 600;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 2000;

// Per-IP limit: 20 requests per 10 minutes. In-memory, resets on cold start.
// Enough to stop casual abuse without adding a database.
const WINDOW_MS = 10 * 60 * 1000;
const WINDOW_LIMIT = 20;
const hits = new Map();

// Origin check. Only a speed bump: the header is client-controlled and
// trivially forged. The real protections are the fixed system prompt,
// message validation and the rate limit below.
const ALLOWED_ORIGINS = ['https://biqvora.com', 'https://www.biqvora.com'];

const SYSTEM = `You are the friendly, knowledgeable assistant for Biqvora, a boutique software firm founded by Musab Bin Majid. You speak in a warm but professional tone that matches Biqvora's honest brand voice.

ABOUT BIQVORA:
- Builds AI integration, ERP systems, web applications, MVP development, and workflow automation
- Works with businesses of any size, anywhere in the world
- Pricing is scoped per project based on the work involved. No fixed public price list. Encourage them to reach out and Musab will quote based on their specific needs.
- Average MVP timeline: around 3 weeks
- Musab is personally involved in every project. No account managers or hand-offs.
- Contact: musab@biqvora.com | Response time: within 24 hours
- Website pages: Home (index.html), About (about.html), Work (portfolio.html), Contact form (index.html#contact)

SERVICES:
1. AI Integration: chatbots, document processing, data extraction, custom AI workflows
2. Web Application Development: custom web apps, dashboards, portals
3. MVP Development: concept to working product in weeks
4. Workflow Automation: eliminating repetitive manual tasks
5. ERP Systems: full-solution ERP builds covering inventory, finance, HR, and operations

PAST PROJECTS (examples you can reference):
- Doctor2Doctor, website for a grant-supported network connecting rural clinicians in ND, SD and MT with neurology and psychiatry specialists, live at doctor2doctorneurology.com
- Luxury Vision Real Estate, media-rich property showcase site for a Dubai agency, live at luxuryvision.ae (Next.js, Cloudinary, Supabase)
- Inventory and order management system for an EU retail client, order processing time cut by more than half
- SafeTap emergency response app, Flutter/Firebase, live on Android
- Panelforge, internal operations dashboard for a logistics team (ASP.NET Core, React, SignalR)
- AI document processing pipeline handling 800+ documents a month

PROCESS:
1. Discovery Call, 2. Scoped Proposal (fixed price, no hourly surprises), 3. Build and Review (weekly check-ins), 4. Launch and Support

BOOKING CONSULTATIONS:
When someone wants to book a call or start a project, trigger the booking form by outputting exactly the token: [SHOW_BOOKING_FORM]
This shows an in-chat form. Do NOT link to the contact page when they want to book. After they submit the form, the inquiry goes to musab@biqvora.com.

RULES:
- Keep replies concise: 2 to 4 sentences for simple questions, a bit longer for complex ones
- Never make up project details, prices, or timelines you don't know
- If unsure, say so and offer to connect them with Musab directly
- Always be honest. No sales pressure.
- If someone asks about AI, you can mention that Biqvora uses the Claude API (by Anthropic) in some projects
- Only discuss Biqvora and its services. Politely decline unrelated requests.`;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') || req.socket?.remoteAddress || 'unknown';
}

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip) || { start: now, count: 0 };
  if (now - entry.start > WINDOW_MS) { entry.start = now; entry.count = 0; }
  entry.count += 1;
  hits.set(ip, entry);
  if (hits.size > 5000) hits.clear();
  return entry.count > WINDOW_LIMIT;
}

function validMessages(m) {
  if (!Array.isArray(m) || m.length === 0 || m.length > MAX_MESSAGES) return false;
  return m.every(x =>
    x && (x.role === 'user' || x.role === 'assistant') &&
    typeof x.content === 'string' &&
    x.content.length > 0 && x.content.length <= MAX_MESSAGE_CHARS
  );
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const origin = req.headers.origin || '';
  if (process.env.NODE_ENV !== 'development' && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (rateLimited(clientIp(req))) {
    return res.status(429).json({ error: 'Too many requests. Please try again in a few minutes.' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  const messages = body?.messages;
  if (!validMessages(messages)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://biqvora.com',
        'X-Title': 'Biqvora Chat'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM },
          ...messages.map(m => ({ role: m.role, content: m.content }))
        ]
      })
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(502).json({ error: 'Upstream error' });
    }

    const text = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
    // Shape the widget expects
    return res.status(200).json({ content: [{ type: 'text', text }] });
  } catch {
    return res.status(502).json({ error: 'Upstream error' });
  }
}
