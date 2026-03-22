const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Motor 2: Hugging Face Inference API ────────────────────────────────────
const HF_TOKEN = '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';
const OR_TOKEN = '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';

// Mejorar prompt con IA antes de generar imagen
async function enhancePrompt(prompt) {
  return new Promise((resolve) => {
    const messages = [
      { role: 'system', content: 'You are an expert at writing image generation prompts. Convert the user description into a detailed English prompt for Stable Diffusion. Be specific about style, lighting, colors, and quality. Only respond with the prompt, nothing else. Max 100 words.' },
      { role: 'user', content: prompt }
    ];
    const body = JSON.stringify({
      model: 'openrouter/auto',
      messages,
      max_tokens: 150,
    });
    const opts = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OR_TOKEN}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'ANIMIX',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const enhanced = data?.choices?.[0]?.message?.content;
          if (enhanced) {
            console.log(`[PROMPT] Original: "${prompt.substring(0,50)}"`);
            console.log(`[PROMPT] Mejorado: "${enhanced.substring(0,80)}"`);
            resolve(enhanced);
          } else {
            resolve(translatePrompt(prompt));
          }
        } catch(e) { resolve(translatePrompt(prompt)); }
      });
    });
    req.on('error', () => resolve(translatePrompt(prompt)));
    req.on('timeout', () => { req.destroy(); resolve(translatePrompt(prompt)); });
    req.write(body); req.end();
  });
}
const HF_MODELS = [
  'stabilityai/stable-diffusion-xl-base-1.0',
  'stabilityai/stable-diffusion-2-1',
  'runwayml/stable-diffusion-v1-5',
];

// Traductor básico español → inglés para prompts
const ES_EN = {
  // Animales
  'gata':'female cat','gato':'cat','perro':'dog','perra':'female dog',
  'caballo':'horse','yegua':'mare','vaca':'cow','toro':'bull',
  'leon':'lion','leona':'lioness','tigre':'tiger','oso':'bear',
  'lobo':'wolf','zorro':'fox','conejo':'rabbit','pajaro':'bird',
  'aguila':'eagle','dragon':'dragon','unicornio':'unicorn',
  'dinosaurio':'dinosaur','serpiente':'snake','delfin':'dolphin',
  'ballena':'whale','tiburon':'shark','mariposa':'butterfly',
  'elefante':'elephant','jirafa':'giraffe','mono':'monkey',
  // Personas y lugares
  'chica':'girl','chico':'boy','mujer':'woman','hombre':'man',
  'anciano':'old man','anciana':'old woman','guerrero':'warrior',
  'ciudad':'city','bosque':'forest','montaña':'mountain','playa':'beach',
  'castillo':'castle','aldea':'village','espacio':'outer space',
  'universo':'universe','oceano':'ocean','desierto':'desert',
  'selva':'jungle','cueva':'cave','templo':'temple',
  // Objetos y conceptos
  'sol':'sun','luna':'moon','estrella':'star','nube':'cloud',
  'fuego':'fire','agua':'water','hielo':'ice','rayo':'lightning',
  'espada':'sword','escudo':'shield','corona':'crown','libro':'book',
  'robot':'robot','nave':'spaceship','cohete':'rocket',
  // Colores
  'rojo':'red','azul':'blue','verde':'green','amarillo':'yellow',
  'negro':'black','blanco':'white','morado':'purple','naranja':'orange',
  'dorado':'golden','plateado':'silver',
};

function translatePrompt(prompt) {
  var result = prompt.toLowerCase();
  Object.keys(ES_EN).forEach(function(es) {
    var re = new RegExp('\\b' + es + '\\b', 'gi');
    result = result.replace(re, ES_EN[es]);
  });
  return result;
}

async function generateHuggingFace(prompt) {
  prompt = translatePrompt(prompt);
  for (let i = 0; i < HF_MODELS.length; i++) {
    const model = HF_MODELS[i];
    console.log(`[HF] Modelo ${i+1}/${HF_MODELS.length}: ${model}`);
    try {
      const body = JSON.stringify({ inputs: prompt + ', masterpiece, best quality, ultra detailed, sharp focus, 8k', parameters: { num_inference_steps: 30, guidance_scale: 7.5 } });
      const result = await new Promise((resolve, reject) => {
        const opts = {
          hostname: 'api-inference.huggingface.co',
          path: `/models/${model}`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${HF_TOKEN}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 60000,
        };
        const req = https.request(opts, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const ct = res.headers['content-type'] || '';
            if (res.statusCode === 200 && ct.startsWith('image/')) {
              resolve({ buffer: Buffer.concat(chunks), contentType: ct });
            } else if (res.statusCode === 503) {
              reject(new Error('Modelo cargando, reintentá en 20s'));
            } else {
              const txt = Buffer.concat(chunks).toString().substring(0, 150);
              reject(new Error(`HF status ${res.statusCode}: ${txt}`));
            }
          });
          res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(body);
        req.end();
      });
      return result;
    } catch(e) {
      console.log(`[HF] ✗ ${model}: ${e.message.substring(0, 100)}`);
      if (e.message.includes('cargando') && i < HF_MODELS.length - 1) {
        await wait(20000);
      }
    }
  }
  throw new Error('HuggingFace no pudo generar la imagen');
}

// ─── Motor 1: Pollinations.ai (modelos gratuitos) ───────────────────────────
const POLL_MODELS = ['flux-schnell', 'sdxl-turbo', 'playground-v2'];

function fetchPollinations(prompt, model, w, h, seed) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(prompt + ', high quality');
    const p = `/prompt/${encoded}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=${model}&nofeed=true`;

    function doRequest(hostname, reqPath) {
      const opts = {
        hostname,
        path: reqPath,
        method: 'GET',
        timeout: 60000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
      };
      const req = https.request(opts, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
          try {
            const loc = new URL(res.headers.location);
            doRequest(loc.hostname, loc.pathname + loc.search);
          } catch(e) { reject(e); }
          return;
        }
        const ct = res.headers['content-type'] || '';
        if (res.statusCode === 200 && ct.startsWith('image/')) {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: ct }));
          res.on('error', reject);
        } else {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString().substring(0, 150);
            reject(new Error(`Status ${res.statusCode}: ${body}`));
          });
        }
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    }
    doRequest('image.pollinations.ai', p);
  });
}

// ─── Motor 2: Stable Horde (red distribuida, 100% gratuita) ─────────────────
function generateStableHorde(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      prompt: prompt + ' ### blurry, bad quality',
      params: { width: 512, height: 512, steps: 20, n: 1, sampler_name: 'k_euler' },
      models: ['stable_diffusion'],
      r2: false,
      shared: false,
    });

    const postOpts = {
      hostname: 'stablehorde.net',
      path: '/api/v2/generate/async',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': '0000000000',   // clave anónima de Stable Horde
        'Content-Length': Buffer.byteLength(body),
        'Client-Agent': 'ANIMIX:4.0:unknown',
      },
      timeout: 15000,
    };

    const req = https.request(postOpts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', async () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (!data.id) { reject(new Error('Stable Horde no devolvió ID')); return; }
          console.log(`[HORDE] Job ID: ${data.id} — esperando resultado...`);
          // Polling hasta que esté listo (máx 90s)
          for (let t = 0; t < 6; t++) {
            await wait(5000);
            const result = await checkHorde(data.id);
            if (result.done) {
              resolve({ buffer: result.buffer, contentType: result.contentType });
              return;
            }
            const w = result.wait_time ? ` (~${result.wait_time}s restantes)` : '';
            console.log(`[HORDE] Esperando...${w}`);
          }
          reject(new Error('Stable Horde tardó demasiado'));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout enviando job')); });
    req.write(body);
    req.end();
  });
}

function checkHorde(id) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'stablehorde.net',
      path: `/api/v2/generate/check/${id}`,
      method: 'GET',
      headers: { 'apikey': '0000000000', 'Client-Agent': 'ANIMIX:4.0:unknown' },
      timeout: 10000,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const d = JSON.parse(Buffer.concat(chunks).toString());
          if (d.done) {
            getHordeStatus(id).then(resolve).catch(reject);
          } else {
            resolve({ done: false, wait_time: d.wait_time });
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout check')); });
    req.end();
  });
}

function getHordeStatus(id) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'stablehorde.net',
      path: `/api/v2/generate/status/${id}`,
      method: 'GET',
      headers: { 'apikey': '0000000000', 'Client-Agent': 'ANIMIX:4.0:unknown' },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const d = JSON.parse(Buffer.concat(chunks).toString());
          const gen = d.generations && d.generations[0];
          if (gen && gen.img) {
            // gen.img es siempre base64 puro (sin prefijo data:)
            // gen.img puede tener prefijo data: o ser base64 puro
            let imgData = gen.img;
            let imgType = 'image/png';
            if (imgData.startsWith('data:')) {
              const parts = imgData.split(',');
              imgType = parts[0].split(':')[1].split(';')[0];
              imgData = parts[1];
            }
            const buf = Buffer.from(imgData, 'base64');
            resolve({ done: true, buffer: buf, contentType: imgType });
          } else {
            reject(new Error('Sin imagen en respuesta de Horde'));
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout status')); });
    req.end();
  });
}

// ─── Motor 3: Replicate ─────────────────────────────────────────────────────
const REPLICATE_TOKEN = 'r8_1hl1pXpIdCvXTirXB3Vi7OiQ0kgzVVO3LlP4D';

async function generateReplicate(prompt) {
  // Crear predicción
  const body = JSON.stringify({
    version: 'ac732df83cea7fff18b8472768c88ad041fa750ff7682a21affe81863cbe77e4',
    input: { prompt: prompt + ', high quality, detailed', width: 512, height: 512 }
  });

  const prediction = await new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.replicate.com',
      path: '/v1/predictions',
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout creando predicción')); });
    req.write(body); req.end();
  });

  if (!prediction.id) {
    console.log('[REPL] Respuesta completa:', JSON.stringify(prediction).substring(0, 300));
    throw new Error('Sin ID de predicción: ' + (prediction.detail || prediction.error || JSON.stringify(prediction).substring(0, 100)));
  }
  console.log(`[REPL] Predicción creada: ${prediction.id}`);

  // Polling hasta que esté lista
  for (let i = 0; i < 24; i++) {
    await wait(5000);
    const status = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.replicate.com',
        path: `/v1/predictions/${prediction.id}`,
        method: 'GET',
        headers: { 'Authorization': `Token ${REPLICATE_TOKEN}` },
        timeout: 10000,
      };
      const req = https.request(opts, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout check')); });
      req.end();
    });

    console.log(`[REPL] Estado: ${status.status}`);
    if (status.status === 'succeeded' && status.output && status.output[0]) {
      // Descargar la imagen
      const imgUrl = status.output[0];
      const imgBuf = await new Promise((resolve, reject) => {
        const parsed = new URL(imgUrl);
        const opts = {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          timeout: 30000,
        };
        const req = https.request(opts, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout descargando')); });
        req.end();
      });
      return { buffer: imgBuf, contentType: 'image/png' };
    }
    if (status.status === 'failed') throw new Error('Predicción falló: ' + (status.error || 'desconocido'));
  }
  throw new Error('Replicate tardó demasiado');
}

// ─── Orchestrador principal ──────────────────────────────────────────────────
async function generateImage(prompt) {
  // Mejorar el prompt con IA antes de generar
  console.log('[PROMPT] Mejorando descripción con IA...');
  prompt = await enhancePrompt(prompt);
  const seed = Math.floor(Math.random() * 99999);

  // Motor 1: Pollinations con 3 modelos
  for (let i = 0; i < POLL_MODELS.length; i++) {
    const model = POLL_MODELS[i];
    const sz = [512, 512];
    console.log(`[POLL] Intento ${i + 1}/${POLL_MODELS.length} — modelo: ${model}`);
    try {
      const result = await fetchPollinations(prompt, model, sz[0], sz[1], seed + i * 13);
      console.log(`[POLL] ✓ Éxito con ${model} — ${result.buffer.length} bytes`);
      return { ok: true, buffer: result.buffer, contentType: result.contentType };
    } catch (e) {
      console.log(`[POLL] ✗ ${model}: ${e.message.substring(0, 100)}`);
      if (e.message.includes('429') && i < POLL_MODELS.length - 1) {
        console.log('[POLL] Rate limit — esperando 8s...');
        await wait(8000);
      }
    }
  }

  // Motor 2: HuggingFace
  console.log('\n[HF] Pollinations falló — usando HuggingFace...');
  try {
    const result = await generateHuggingFace(prompt);
    console.log(`[HF] ✓ Éxito — ${result.buffer.length} bytes`);
    return { ok: true, buffer: result.buffer, contentType: result.contentType };
  } catch (e) {
    console.log(`[HF] ✗ Falló: ${e.message}`);
  }

  // Motor 3: Stable Horde (fallback gratuito)
  console.log('\n[HORDE] HuggingFace falló — usando Stable Horde...');
  try {
    const result = await generateStableHorde(prompt);
    console.log(`[HORDE] ✓ Éxito — ${result.buffer.length} bytes`);
    return { ok: true, buffer: result.buffer, contentType: result.contentType };
  } catch (e) {
    console.log(`[HORDE] ✗ Falló: ${e.message}`);
  }

  // Motor 3: Replicate
  console.log('\n[REPL] Usando Replicate como último recurso...');
  try {
    const result = await generateReplicate(prompt);
    console.log(`[REPL] ✓ Éxito — ${result.buffer.length} bytes`);
    return { ok: true, buffer: result.buffer, contentType: result.contentType };
  } catch (e) {
    console.log(`[REPL] ✗ Falló: ${e.message}`);
  }

  return { ok: false, error: 'No se pudo generar la imagen. Intentá de nuevo en un momento.' };
}

// ─── Servidor HTTP ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // /genimg?p=prompt
  if (urlObj.pathname === '/genimg') {
    const prompt = urlObj.searchParams.get('p') || 'beautiful landscape';
    console.log(`\n[GEN] "${prompt.substring(0, 70)}"`);
    const result = await generateImage(prompt);
    if (result.ok) {
      res.writeHead(200, {
        'Content-Type': result.contentType,
        'Content-Length': result.buffer.length,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(result.buffer);
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: result.error }));
    }
    return;
  }

  // /api → proxy Anthropic
  if (urlObj.pathname === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const opts = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': req.headers['x-api-key'] || '',
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      };
      const pr = https.request(opts, (pRes) => {
        const chunks = [];
        pRes.on('data', c => chunks.push(c));
        pRes.on('end', () => {
          res.writeHead(pRes.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(Buffer.concat(chunks));
        });
      });
      pr.on('error', (e) => { res.writeHead(500); res.end(JSON.stringify({ error: { message: e.message } })); });
      pr.write(body); pr.end();
    });
    return;
  }

  // /gemini → proxy OpenRouter (reemplaza Gemini)
  if (urlObj.pathname === '/gemini' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const apiKey = req.headers['x-api-key'] || '';
        const systemText = parsed.system || '';
        const messages = parsed.messages || [];

        // Convertir formato Gemini a OpenAI (que usa OpenRouter)
        const openaiMessages = [];
        if (systemText) openaiMessages.push({ role: 'system', content: systemText });
        messages.forEach(m => {
          try {
            let text = '';
            if (m.parts) text = m.parts.map(p => p.text || '').join('');
            else if (typeof m.content === 'string') text = m.content;
            else if (Array.isArray(m.content)) text = m.content.map(p => p.text || '').join('');
            if (!text.trim()) return; // saltar mensajes vacíos
            const role = m.role === 'model' ? 'assistant' : 'user';
            openaiMessages.push({ role, content: text });
          } catch(e) {}
        });
        // Asegurar que el último mensaje sea del user
        if (!openaiMessages.length || openaiMessages[openaiMessages.length-1].role !== 'user') return;

        const orBody = JSON.stringify({
          model: 'openrouter/auto',
          messages: openaiMessages,
          max_tokens: 4096,
        });

        const opts = {
          hostname: 'openrouter.ai',
          path: '/api/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'ANIMIX',
            'Content-Length': Buffer.byteLength(orBody),
          },
          timeout: 30000,
        };

        const pr = https.request(opts, (pRes) => {
          const chunks = [];
          pRes.on('data', c => chunks.push(c));
          pRes.on('end', () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              const reply = data?.choices?.[0]?.message?.content;
              if (reply) {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ reply }));
              } else {
                const errMsg = data?.error?.message || JSON.stringify(data);
                res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: errMsg }));
              }
            } catch(e) {
              res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        });
        pr.on('error', (e) => {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: e.message }));
        });
        pr.write(orBody);
        pr.end();
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'JSON inválido: ' + e.message }));
      }
    });
    return;
  }

  // /manifest.json
  if (urlObj.pathname === '/manifest.json') {
    const fs2 = require('fs');
    const p = require('path');
    try {
      const m = fs2.readFileSync(p.join(__dirname, 'manifest.json'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Access-Control-Allow-Origin': '*' });
      res.end(m);
    } catch(e) { res.writeHead(404); res.end('not found'); }
    return;
  }

  // /sw.js
  if (urlObj.pathname === '/sw.js') {
    const fs2 = require('fs');
    const p = require('path');
    try {
      const sw = fs2.readFileSync(p.join(__dirname, 'sw.js'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' });
      res.end(sw);
    } catch(e) { res.writeHead(404); res.end('not found'); }
    return;
  }

  // / → servir el HTML
  if (urlObj.pathname === '/' || urlObj.pathname === '/index.html') {
    const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.html'));
    if (!files.length) { res.writeHead(404); res.end('No se encontró .html'); return; }
    const html = fs.readFileSync(path.join(__dirname, files[0]), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  ✦ ANIMIX Server v4.5 funcionando!          ║');
  console.log(`║  Abrí: http://localhost:${PORT}               ║`);
  console.log('║  Chat: OpenRouter Llama 3.1 (gratis)            ║');
  console.log('║  Imágenes: Pollinations+Horde+Replicate     ║');
  console.log('║  Para cerrar: Ctrl + C                      ║');
  console.log('╚══════════════════════════════════════════════╝\n');
  try { require('child_process').exec('start http://localhost:' + PORT); } catch (e) {}
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n⚠ Puerto ${PORT} en uso. Cerrá el anterior con Ctrl+C y volvé a correr "node server.js".`);
  } else {
    console.error('Error:', e.message);
  }
  process.exit(1);
});
