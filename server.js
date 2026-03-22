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
        'HTTP-Referer': 'https://animix-production-3488.up.railway.app',
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

// ─── Motor de Voz: Groq Whisper (transcripción) ──────────────────────────────
async function transcribeAudio(audioBuffer, mimeType) {
  // Groq Whisper via multipart/form-data
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const filename = mimeType.includes('webm') ? 'audio.webm' : mimeType.includes('mp4') ? 'audio.mp4' : 'audio.wav';

  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  );
  const modelPart = Buffer.from(
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `whisper-large-v3-turbo` +
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="language"\r\n\r\nes` +
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="response_format"\r\n\r\njson` +
    `\r\n--${boundary}--\r\n`
  );

  const body = Buffer.concat([header, audioBuffer, modelPart]);
  const GROQ_KEY = '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';

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.groq.com',
      path: '/openai/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 30000,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (data.text) resolve(data.text.trim());
          else reject(new Error(data.error?.message || 'Sin transcripción'));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout whisper')); });
    req.write(body);
    req.end();
  });
}

// ─── Motor de Voz: ElevenLabs TTS ────────────────────────────────────────────
const ELEVENLABS_KEY = process.env.ELEVENLABS_KEY || '';

// Voces custom por género (se crean al iniciar si no existen en env)
const VOICE_MAP = {
  femenino: process.env.ANIMIX_VOICE_ID || 'XrExE9yKIg1WjnnlVkGX',
  masculino: process.env.ANIMAX_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
};

// ─── Voice Design: crear voces custom al iniciar ────────────────────────────
async function createCustomVoice(name, description, previewText) {
  if (!ELEVENLABS_KEY) return null;
  console.log(`[VOICE] Creando voz custom: ${name}...`);
  const body = JSON.stringify({
    voice_description: description,
    text: previewText,
    model_id: 'eleven_multilingual_ttv_v2',
    auto_generate_text: false,
    loudness: 0,
    guidance_scale: 6,
    seed: 42,
  });
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.elevenlabs.io',
      path: '/v1/text-to-voice/create-previews',
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 45000,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', async () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const preview = data.previews && data.previews[0];
          if (!preview || !preview.generated_voice_id) { resolve(null); return; }
          const voiceId = await saveCustomVoice(preview.generated_voice_id, name);
          console.log(`[VOICE] ✓ ${name} creada con ID: ${voiceId}`);
          resolve(voiceId);
        } catch(e) { console.log(`[VOICE] Error: ${e.message}`); resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

async function saveCustomVoice(generatedVoiceId, name) {
  const body = JSON.stringify({ voice_name: name, voice_description: name + ' — ANIMIX custom voice' });
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-voice/create-voice-from-preview`,
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 20000,
    };
    const reqBody = JSON.stringify({ generated_voice_id: generatedVoiceId, voice_name: name });
    const opts2 = { ...opts };
    opts2.headers['Content-Length'] = Buffer.byteLength(reqBody);
    const req = https.request(opts2, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const d = JSON.parse(Buffer.concat(chunks).toString());
          resolve(d.voice_id || generatedVoiceId);
        } catch(e) { resolve(generatedVoiceId); }
      });
    });
    req.on('error', () => resolve(generatedVoiceId));
    req.on('timeout', () => { req.destroy(); resolve(generatedVoiceId); });
    req.write(reqBody); req.end();
  });
}

// Inicializar voces custom al arrancar (si hay key y no hay IDs guardados)
async function initCustomVoices() {
  if (!ELEVENLABS_KEY) { console.log('[VOICE] Sin ELEVENLABS_KEY, usando voces por defecto'); return; }
  if (process.env.ANIMIX_VOICE_ID && process.env.ANIMAX_VOICE_ID) {
    console.log('[VOICE] Voces custom ya configuradas en env vars'); return;
  }
  // ANIMIX: mujer joven latinoamericana, cálida y expresiva
  const animixDesc = 'A young Latin American woman in her mid-20s with a warm, clear, expressive voice. Neutral Spanish accent, natural intonation, friendly and intelligent tone. Studio quality audio.';
  const animixPreview = 'Hola, soy ANIMIX. Estoy aquí para ayudarte con lo que necesites. Me emociona poder charlar con vos hoy.';
  // ANIMAX: hombre joven latinoamericano, profundo y carismático
  const animaxDesc = 'A young Latin American man in his early 20s with a deep, charismatic voice. Neutral Spanish accent, confident and warm delivery, natural pacing. Studio quality audio.';
  const animaxPreview = 'Hola, soy ANIMAX. Contame qué necesitás y lo resolvemos juntos. Estoy listo para lo que sea.';

  const [animixId, animaxId] = await Promise.all([
    createCustomVoice('ANIMIX_voice', animixDesc, animixPreview),
    createCustomVoice('ANIMAX_voice', animaxDesc, animaxPreview),
  ]);
  if (animixId) VOICE_MAP.femenino = animixId;
  if (animaxId) VOICE_MAP.masculino = animaxId;
  console.log(`[VOICE] Voces activas → ANIMIX: ${VOICE_MAP.femenino} | ANIMAX: ${VOICE_MAP.masculino}`);
}

// ─── Procesador de texto humano ──────────────────────────────────────────────
function humanizeText(text, emotion) {
  let t = text.replace(/\*\*/g,'').replace(/\*/g,'').replace(/<[^>]+>/g,'').replace(/#{1,6}\s/g,'').trim();

  // 1. Muletillas naturales según emoción (solo en oraciones largas)
  const muletillas = {
    neutro:    ['O sea, ', 'Mirá, ', 'La verdad, ', 'Fijate que ', ''],
    feliz:     ['¡Uy, ', 'La verdad que ', 'Te juro que ', '¡Mirá, '],
    triste:    ['La verdad... ', 'O sea... ', 'No sé... ', 'Ehh... '],
    enojado:   ['Mirá, ', 'Escuchame, ', 'La verdad, ', 'O sea, '],
    emocionado:['¡Uy! ', '¡Mirá esto! ', '¡No puedo creer! ', '¡Espera! '],
    aburrido:  ['Bue... ', 'Ehhh... ', 'Y... ', 'Dale... '],
    misterioso:['Hmm... ', 'Interesante... ', 'Fijate que... ', 'Curioso... '],
    alarmado:  ['¡Ojo! ', '¡Esperá! ', '¡Atención! ', 'Cuidado, '],
    sarcastico:['Ah, claro... ', 'Sí, seguro... ', 'Obvio, '],
  };
  const list = muletillas[emotion] || muletillas.neutro;
  // Agregar muletilla al inicio solo si la frase es medianamente larga
  if (t.length > 60 && Math.random() < 0.55) {
    const m = list[Math.floor(Math.random() * list.length)];
    if (m) t = m + t.charAt(0).toLowerCase() + t.slice(1);
  }

  // 2. Pausas naturales con <break> (SSML-like para eleven_v3)
  // Pausas después de comas
  t = t.replace(/,\s+/g, ', <break time="0.2s"/> ');
  // Pausa larga después de punto seguido en oraciones
  t = t.replace(/\.\s+([A-ZÁÉÍÓÚÑ¿¡])/g, '. <break time="0.4s"/> $1');
  // Puntos suspensivos = pausa dramática
  t = t.replace(/\.\.\./g, '... <break time="0.5s"/> ');

  // 3. Respiración al inicio de textos largos
  if (t.length > 120) {
    t = '<break time="0.15s"/> ' + t;
  }

  // 4. Variación de velocidad en partes emocionales
  const prosodyByEmotion = {
    feliz:      { rate: '108%', pitch: '+8%' },
    emocionado: { rate: '115%', pitch: '+12%' },
    triste:     { rate: '85%',  pitch: '-6%' },
    enojado:    { rate: '105%', pitch: '+5%' },
    aburrido:   { rate: '90%',  pitch: '-10%' },
    misterioso: { rate: '92%',  pitch: '-3%' },
    alarmado:   { rate: '112%', pitch: '+7%' },
    sarcastico: { rate: '95%',  pitch: '-2%' },
    neutro:     { rate: '100%', pitch: '0%' },
  };
  const p = prosodyByEmotion[emotion] || prosodyByEmotion.neutro;
  // Envolver en prosody SSML
  t = `<prosody rate="${p.rate}" pitch="${p.pitch}">${t}</prosody>`;
  // Wrap en <speak> para SSML completo
  t = `<speak>${t}</speak>`;

  return t;
}

// ─── Detección de emoción mejorada ──────────────────────────────────────────
function detectEmotion(text) {
  const t = text.toLowerCase();
  const scores = { feliz:0, emocionado:0, triste:0, enojado:0, aburrido:0, misterioso:0, alarmado:0, sarcastico:0 };

  // FELIZ
  if (/(!{2,}|\bjaja|\bjeje|\bgenial\b|\bexcelente\b|\bperfecto\b|\bincreíble\b|\bme alegr|\bfantástic|\bmaravill|\bencant|\bbuenísim|\bchévere\b|\bqué bien\b|\bqué bueno\b)/.test(t)) scores.feliz += 2;
  if (/😄|😊|🥰|😁|❤|✨/.test(text)) scores.feliz += 1;

  // EMOCIONADO
  if (/(\bimpresionant|\bincreíbl|\balucinan|\bespectacular|\bepic|\bflipan|\bno lo puedo creer|\bexplota|\bwow\b)/.test(t)) scores.emocionado += 2;
  if (/🤩|🔥|💥|⚡/.test(text)) scores.emocionado += 1;

  // TRISTE
  if (/(\blo siento\b|\bperdón\b|\blamentabl|\btriste\b|\bdesafortun|\bpena\b|\bduele\b|\bimposible\b|\bme duele\b|\bcomprendo tu dolor\b|\bno pude\b|\bfalló\b)/.test(t)) scores.triste += 2;
  if (/😢|😔|💔|😞/.test(text)) scores.triste += 1;

  // ENOJADO
  if (/(\bincorrecto\b|\binaceptable\b|\bfrustran|\bbasta\b|\bharto\b|\bno funciona\b|\bmal hecho\b|\bme molesta\b|\bdeja de\b)/.test(t)) scores.enojado += 2;
  if (/😠|😡|🤬/.test(text)) scores.enojado += 1;

  // ABURRIDO
  if (/(\bda igual\b|\bcomo sea\b|\blo que quieras\b|\blo que vos digas\b|\bbueno\.\.\.\b|\bmmm\b|\bno sé\b)/.test(t)) scores.aburrido += 2;
  if (/😑|🥱|😐/.test(text)) scores.aburrido += 1;

  // MISTERIOSO
  if (/(\binteresante\b|\bcurioso\b|\bextraño\b|\braro\b|\bmisterio\b|\breflexion|\banaliz|\bpregunta profunda\b|\bno está claro\b)/.test(t)) scores.misterioso += 2;
  if (/🤔|🧐|🔍/.test(text)) scores.misterioso += 1;

  // ALARMADO
  if (/(\bcuidado\b|\batención\b|\bpeligro\b|\balerta\b|\burgente\b|\bpeligroso\b|\bimportante advertencia\b)/.test(t)) scores.alarmado += 2;
  if (/⚠|🚨|❗/.test(text)) scores.alarmado += 1;

  // SARCÁSTICO
  if (/(claro que sí|por supuesto|qué sorpresa|vaya vaya|oh vaya|como no)/.test(t) && t.includes('...')) scores.sarcastico += 3;

  // Ganador
  const winner = Object.entries(scores).sort((a,b) => b[1]-a[1])[0];
  return winner[1] > 0 ? winner[0] : 'neutro';
}

async function synthesizeSpeech(text, voiceId, gender) {
  if (!ELEVENLABS_KEY) throw new Error('ELEVENLABS_KEY no configurada');

  const emotion = detectEmotion(text);
  const humanText = humanizeText(text, emotion);
  const selectedVoice = voiceId || VOICE_MAP[gender] || VOICE_MAP.femenino;

  console.log(`[TTS] Emoción: ${emotion} | Voz: ${selectedVoice} | Género: ${gender}`);

  // Configuración de voz por emoción y género
  const isMasc = gender === 'masculino';
  const voiceConfigs = {
    feliz:      { stability: isMasc?0.32:0.28, similarity_boost: isMasc?0.78:0.82, style: isMasc?0.68:0.72 },
    emocionado: { stability: isMasc?0.22:0.18, similarity_boost: isMasc?0.82:0.88, style: isMasc?0.82:0.88 },
    triste:     { stability: isMasc?0.82:0.78, similarity_boost: isMasc?0.58:0.62, style: isMasc?0.18:0.22 },
    enojado:    { stability: isMasc?0.28:0.22, similarity_boost: isMasc?0.92:0.90, style: isMasc?0.88:0.90 },
    aburrido:   { stability: isMasc?0.94:0.92, similarity_boost: isMasc?0.38:0.42, style: isMasc?0.02:0.03 },
    misterioso: { stability: isMasc?0.68:0.65, similarity_boost: isMasc?0.70:0.72, style: isMasc?0.42:0.48 },
    alarmado:   { stability: isMasc?0.25:0.22, similarity_boost: isMasc?0.90:0.88, style: isMasc?0.78:0.80 },
    sarcastico: { stability: isMasc?0.48:0.45, similarity_boost: isMasc?0.72:0.74, style: isMasc?0.62:0.65 },
    neutro:     { stability: isMasc?0.65:0.60, similarity_boost: isMasc?0.70:0.75, style: isMasc?0.18:0.22 },
  };
  const vc = voiceConfigs[emotion] || voiceConfigs.neutro;

  const body = JSON.stringify({
    text: humanText,
    model_id: 'eleven_v3',           // ← más expresivo y emocional disponible
    voice_settings: {
      stability: vc.stability,
      similarity_boost: vc.similarity_boost,
      style: vc.style,
      use_speaker_boost: true,
    }
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${selectedVoice}`,
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 35000,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ buffer: Buffer.concat(chunks), contentType: 'audio/mpeg', emotion });
        } else {
          // Fallback a turbo si v3 falla
          const err = Buffer.concat(chunks).toString();
          console.log(`[TTS] eleven_v3 falló (${res.statusCode}), intentando turbo...`);
          synthesizeSpeechFallback(humanText, selectedVoice, vc, emotion).then(resolve).catch(reject);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout elevenlabs')); });
    req.write(body); req.end();
  });
}

// Fallback con eleven_turbo_v2_5 si v3 no está disponible en el plan
async function synthesizeSpeechFallback(text, voiceId, vc, emotion) {
  // En fallback, quitar SSML y usar texto limpio con audio tag
  const emotionTags = {
    feliz:'[cheerfully] ', emocionado:'[excitedly] ', triste:'[sadly] ',
    enojado:'[angrily] ', aburrido:'[monotonously] ', misterioso:'[mysteriously] ',
    alarmado:'[urgently] ', sarcastico:'[sarcastically] ', neutro:''
  };
  const cleanText = (emotionTags[emotion]||'') + text.replace(/<[^>]+>/g,'').replace(/\[.*?\]/g,'').trim();
  const body = JSON.stringify({
    text: cleanText,
    model_id: 'eleven_turbo_v2_5',
    voice_settings: { stability: vc.stability, similarity_boost: vc.similarity_boost, style: vc.style, use_speaker_boost: true }
  });
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 200) resolve({ buffer: Buffer.concat(chunks), contentType: 'audio/mpeg', emotion });
        else reject(new Error(`TTS fallback ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout fallback')); });
    req.write(body); req.end();
  });
}


// ─── Servidor HTTP ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // /whisper → transcripción con Groq Whisper
  if (urlObj.pathname === '/whisper' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const mimeType = req.headers['content-type'] || 'audio/webm';
        const audioBuffer = Buffer.concat(chunks);
        console.log(`[WHISPER] Recibido ${audioBuffer.length} bytes (${mimeType})`);
        const text = await transcribeAudio(audioBuffer, mimeType);
        console.log(`[WHISPER] Transcripción: "${text}"`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ text }));
      } catch(e) {
        console.log(`[WHISPER] Error: ${e.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // /tts → síntesis de voz con ElevenLabs
  if (urlObj.pathname === '/tts' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { text, voiceId, gender } = JSON.parse(body);
        if (!text) { res.writeHead(400); res.end('{"error":"sin texto"}'); return; }
        const result = await synthesizeSpeech(text, voiceId, gender || 'femenino');
        res.writeHead(200, {
          'Content-Type': result.contentType,
          'Content-Length': result.buffer.length,
          'Access-Control-Allow-Origin': '*',
          'X-Emotion': result.emotion || 'neutro',
        });
        res.end(result.buffer);
      } catch(e) {
        console.log(`[TTS] Error: ${e.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

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

  // /gemini → proxy Groq
  if (urlObj.pathname === '/gemini' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const systemText = parsed.system || '';
        const messages = parsed.messages || [];
        console.log('[GEMINI] Mensajes recibidos:', JSON.stringify(messages).substring(0, 300));

        const openaiMessages = [];
        if (systemText) openaiMessages.push({ role: 'system', content: systemText });
        messages.forEach(m => {
          try {
            const role = m.role === 'model' ? 'assistant' : 'user';
            // Handle content with images (array format)
            if (Array.isArray(m.content)) {
              const parts = [];
              m.content.forEach(p => {
                if (p.type === 'text' && p.text) parts.push({ type: 'text', text: String(p.text) });
                else if (p.type === 'image_url') parts.push(p); // already correct format
                else if (p.type === 'image' && p.source) parts.push({ type: 'image_url', image_url: { url: `data:${p.source.media_type};base64,${p.source.data}` } });
              });
              if (parts.length) openaiMessages.push({ role, content: parts });
            } else {
              let text = '';
              if (m.parts && Array.isArray(m.parts)) text = m.parts.map(p => String(p.text || '')).join('');
              else if (typeof m.content === 'string') text = m.content;
              else if (m.content) text = String(m.content);
              if (!text || !text.trim()) return;
              openaiMessages.push({ role, content: text });
            }
          } catch(e) { console.log('Error parsing message:', e.message); }
        });

        const groqBody = JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: openaiMessages,
          max_tokens: 4096,
          temperature: 0.9,
        });

        const GROQ_KEY = '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';

        const opts = {
          hostname: 'api.groq.com',
          path: '/openai/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_KEY}`,
            'Content-Length': Buffer.byteLength(groqBody),
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
        pr.write(groqBody);
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
  // Inicializar voces custom de ElevenLabs en background
  initCustomVoices().catch(e => console.log('[VOICE] Error init:', e.message));
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
