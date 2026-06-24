export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic origin check — update to your actual domain
  const origin = req.headers.origin || '';
  const allowed = ['https://biqvora.com', 'https://www.biqvora.com'];
  if (process.env.NODE_ENV !== 'development' && !allowed.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { messages, system } = req.body;

    // Convert to OpenAI-compatible format for OpenRouter
    const openaiMessages = system
      ? [{ role: 'system', content: system }, ...messages]
      : messages;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://biqvora.com',
        'X-Title': 'Biqvora Chat',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini', // cheap & fast — ~$0.0002 per message
        messages: openaiMessages,
        max_tokens: 1000,
      }),
    });

    const data = await response.json();

    // Normalize to the shape the widget expects
    const text = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
    res.status(response.status).json({ content: [{ type: 'text', text }] });

  } catch (err) {
    res.status(500).json({ error: 'Proxy error', detail: err.message });
  }
}
