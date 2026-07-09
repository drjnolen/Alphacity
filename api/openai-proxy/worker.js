/**
 * Cloudflare Worker — OpenAI Proxy for Alpha City Portfolio Analyzer
 *
 * This worker keeps the OpenAI API key server-side so it is never exposed
 * in the browser.  The client sends the same JSON body it would send to
 * OpenAI, and this worker forwards it with the Authorization header.
 *
 * ── Setup ──────────────────────────────────────────────────────────────
 * 1. Install Wrangler:  npm i -g wrangler
 * 2. Authenticate:      wrangler login
 * 3. Store the key:     wrangler secret put OPENAI_API_KEY
 *    (paste your sk-… key when prompted — it is stored encrypted)
 * 4. Deploy:            wrangler deploy
 *
 * After deploying, add the Worker URL as a GitHub Actions secret named
 * OPENAI_PROXY_URL (e.g. https://alphacity-openai-proxy.<you>.workers.dev)
 * so the deploy workflow can inject it into the analyze page.
 *
 * ── Environment variables / secrets ────────────────────────────────────
 *   OPENAI_API_KEY   (secret)   — your OpenAI API key
 *   ALLOWED_ORIGINS  (variable) — comma-separated allowed origins,
 *                                 defaults to https://alphacity.tech
 */

const DEFAULT_ALLOWED_ORIGINS = 'https://alphacity.tech';

export default {
  async fetch(request, env) {
    // ── CORS preflight ──────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return handleCors(request, env, new Response(null, { status: 204 }));
    }

    // ── GET requests (for Nitter proxy and Daily Side Quests) ────────
    if (request.method === 'GET') {
      const urlObj = new URL(request.url);
      if (urlObj.pathname === '/nitter' || urlObj.pathname.startsWith('/nitter')) {
        const handle = urlObj.searchParams.get('handle');
        if (!handle) {
          return handleCors(
            request,
            env,
            new Response(JSON.stringify({ error: 'Missing handle parameter' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }

        const instances = [
          'https://xcancel.com',
          'https://nitter.net',
          'https://nitter.privacyredirect.com',
          'https://nitter.poast.org'
        ];

        for (const instance of instances) {
          try {
            const feedUrl = `${instance}/${handle}/rss`;
            const resp = await fetch(feedUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
              signal: AbortSignal.timeout(2500)
            });
            if (resp.ok) {
              const xml = await resp.text();
              if (xml && xml.includes('<rss')) {
                return handleCors(
                  request,
                  env,
                  new Response(xml, {
                    status: 200,
                    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
                  })
                );
              }
            }
          } catch (_) {}
        }

        return handleCors(
          request,
          env,
          new Response(JSON.stringify({ error: 'Failed to fetch feed from all instances' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }

      if (urlObj.pathname === '/sidequest' || urlObj.pathname.startsWith('/sidequest')) {
        const dateStr = urlObj.searchParams.get('date') || new Date().toISOString().split('T')[0];
        
        const cache = caches.default;
        const cacheKey = new Request(urlObj.toString(), request);
        let cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
          return handleCors(request, env, cachedResponse);
        }

        try {
          const apiKey = env.OPENAI_API_KEY;
          if (!apiKey) {
            throw new Error('OpenAI API key missing in environment');
          }

          const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content: 'You are a wellness coach. Generate a healthy, creative daily "side quest" for a web3 user to help them touch grass and stay healthy. It must be simple, creative, actionable, and take less than 15 minutes. Examples: walk outdoors, 50 pushups, stretch, call a loved one. Return ONLY a valid JSON object matching this schema: {"quest": "string", "category": "Mindfulness/Nature/Physical/Connection", "benefit": "string"}. Do not include markdown code block formatting.'
                },
                {
                  role: 'user',
                  content: `Generate the unique daily quest for date: ${dateStr}. Maintain a positive, refreshing tone.`
                }
              ],
              temperature: 0.7,
              max_tokens: 150
            })
          });

          if (!openaiResponse.ok) {
            const errBody = await openaiResponse.text();
            throw new Error(`OpenAI API returned status ${openaiResponse.status}: ${errBody}`);
          }

          const data = await openaiResponse.json();
          let questText = data.choices?.[0]?.message?.content?.trim() || '';

          if (questText.startsWith('```')) {
            questText = questText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
          }

          const parsed = JSON.parse(questText);

          const newResponse = new Response(JSON.stringify(parsed), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=86400',
            }
          });

          await cache.put(cacheKey, newResponse.clone());
          return handleCors(request, env, newResponse);

        } catch (err) {
          console.error('Failed to generate daily side quest:', err);
          const fallbacks = [
            { quest: "Spend 5 minutes walking silently outdoors.", category: "Nature", benefit: "Boosts mental clarity and lowers cortisol levels." },
            { quest: "Do 50 pushups (or a comfortable variation).", category: "Physical", benefit: "Improves upper body strength and pumps endorphins." },
            { quest: "Call or text a loved one to check in.", category: "Connection", benefit: "Strengthens relationships and builds emotional support." },
            { quest: "Drink a tall glass of water and stretch for 3 minutes.", category: "Physical", benefit: "Rehydrates the body and releases muscle tension." },
            { quest: "Write down 3 things you are genuinely grateful for today.", category: "Mindfulness", benefit: "Shifts mindset to abundance and positivity." },
            { quest: "Sit quietly for 5 minutes focusing entirely on your breathing.", category: "Mindfulness", benefit: "Calms the nervous system and improves focus." },
            { quest: "Tidy up your physical desk space completely.", category: "Mindfulness", benefit: "Clutter-free environment leads to a clutter-free mind." }
          ];
          const todayIndex = new Date().getDay();
          const fallback = fallbacks[todayIndex];

          return handleCors(
            request,
            env,
            new Response(JSON.stringify(fallback), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
      }
    }

    // ── Only POST allowed for OpenAI requests ───────────────────────
    if (request.method !== 'POST') {
      return handleCors(
        request,
        env,
        new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    // ── Origin check ────────────────────────────────────────────────
    const origin = request.headers.get('Origin') || '';
    if (!isAllowedOrigin(origin, env)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Validate that the API key secret is configured ──────────────
    if (!env.OPENAI_API_KEY) {
      return handleCors(
        request,
        env,
        new Response(
          JSON.stringify({ error: 'OpenAI API key not configured on proxy' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }

    // ── Forward to OpenAI ───────────────────────────────────────────
    try {
      const body = await request.text();

      const openaiResp = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          },
          body,
        },
      );

      // Stream the OpenAI response back to the client
      return handleCors(
        request,
        env,
        new Response(openaiResp.body, {
          status: openaiResp.status,
          headers: {
            'Content-Type':
              openaiResp.headers.get('Content-Type') || 'application/json',
          },
        }),
      );
    } catch (err) {
      return handleCors(
        request,
        env,
        new Response(
          JSON.stringify({ error: 'Proxy error', detail: err.message }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────

function allowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGINS) || DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  return allowedOrigins(env).includes(origin);
}

function handleCors(request, env, response) {
  const origin = request.headers.get('Origin') || '';
  const matched = allowedOrigins(env).find((a) => origin === a);

  const headers = new Headers(response.headers);
  const urlObj = new URL(request.url);
  if (request.method === 'GET' && (
    urlObj.pathname === '/nitter' || urlObj.pathname.startsWith('/nitter') ||
    urlObj.pathname === '/sidequest' || urlObj.pathname.startsWith('/sidequest')
  )) {
    headers.set('Access-Control-Allow-Origin', '*');
  } else if (matched) {
    headers.set('Access-Control-Allow-Origin', matched);
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
