// core/audio.mjs — merged from audio/ks-synth.js + audio/multimodal-handler.js
// 2026-06-21 (R1 cancelled, target 80 modules)

// === KsSynth (Karplus-Strong synth) ===
const DEFAULT_SR = 48000;

export class KsSynth {
  constructor(options = {}) {
    this.sr = options.sampleRate || DEFAULT_SR;
  }

  _ksSynth(freq, durS, vol, dec) {
    const sr = this.sr;
    const del = Math.round(sr / freq); if (!isFinite(del) || del < 4) return null;
    const out = new Float64Array(Math.round(durS * sr));
    const buf = new Float64Array(del);
    for (let i = 0; i < del; i++) {
      buf[i] = (Math.random() * 2 - 1) * 0.3 +
        (i < del * 0.4 ? Math.sin(Math.PI * i / del) * 0.7 : 0);
    }
    let wi = 0, lp = 0;
    for (let i = 0; i < out.length; i++) {
      const s = buf[wi];
      lp = lp * 0.93 + ((buf[wi] + buf[(wi - 1 + del) % del]) * 0.5) * 0.07;
      buf[wi] = lp * dec;
      wi = (wi + 1) % del;
      const t = i / sr, e = t < 0.001 ? t / 0.001 : Math.exp(-2 * (t - 0.001));
      if (e > 0) out[i] = s * e * vol;
      if (t >= 0.001 && e < 0.0001) break;
    }
    return out;
  }

  guitar(note) {
    if (note.m == null) return null;
    const freq = 440 * 2 ** ((note.m - 69) / 12);
    const del = Math.round(this.sr / freq);
    const dec = 0.998 ** (1 / del);
    return this._ksSynth(freq, note.d || 0.3, 0.15 + (note.c || 0.5) * 0.25, dec);
  }

  bass(note) {
    if (note.m == null) return null;
    const freq = 440 * 2 ** ((note.m - 69) / 12);
    const del = Math.round(this.sr / freq);
    const dec = 0.9995 ** (1 / del);
    return this._ksSynth(freq, note.d || 0.3, 0.2 + (note.c || 0.5) * 0.3, dec);
  }

  drum(note) {
    const o = new Float64Array(Math.round(0.15 * this.sr));
    for (let i = 0; i < o.length; i++) {
      const t = i / this.sr; let s = 0;
      if (note.inst === 'kick')
        s = Math.sin(2 * Math.PI * 60 * t) * Math.exp(-20 * t) +
          (Math.random() * 2 - 1) * 0.3 * Math.exp(-40 * t);
      else if (note.inst === 'snare')
        s = Math.sin(2 * Math.PI * 200 * t) * Math.exp(-15 * t) * 0.5 +
          (Math.random() * 2 - 1) * Math.exp(-12 * t) * 0.6;
      else
        s = (Math.random() * 2 - 1) * Math.exp(-30 * t) * 0.4;
      o[i] = s * 0.5;
    }
    return o;
  }

  render(notes, totalSamples) {
    const sorted = [...notes].sort((a, b) => a.s - b.s);
    const out = new Float64Array(totalSamples);
    let count = 0;
    for (const n of sorted) {
      const ss = Math.round(n.s * this.sr);
      const i = n.inst || 'guitar';
      const fn = i === 'guitar' ? this.guitar.bind(this) :
                 i === 'bass' ? this.bass.bind(this) :
                 i === 'drum' ? () => this.drum(n) : this.guitar.bind(this);
      const tone = fn(n); if (!tone) continue;
      for (let i = 0; i < tone.length && ss + i < out.length; i++)
        out[ss + i] += tone[i] * (n.c || 1);
      count++;
    }
    return out;
  }

  mix(synth, original, mixRatio = 0.3) {
    const len = Math.min(synth.length, original.length);
    const out = new Float64Array(len);
    for (let i = 0; i < len; i++) out[i] = synth[i] + original[i] * mixRatio;
    return out;
  }
}

export default KsSynth;

// === MultimodalHandler ===

export class MultimodalHandler {
  constructor(options = {}) {
    this._imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.tiff'];
    this._imageHosts = ['unsplash.com', 'imgur.com', 'cloudinary.com', 'res.cloudinary.com', 'picsum.photos', 'placekitten.com', 'api.dicebear.com', 'randomuser.me', 'pexels.com', 'pixabay.com'];
    this._audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.wma'];
    this._videoExtensions = ['.mp4', '.webm', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.m4v'];
    this._maxImageSize = options.maxImageSize || 10 * 1024 * 1024;
    this._enableDownload = options.enableDownload !== false;
    this._cache = new Map();
    this._cacheSize = options.cacheSize || 50;
  }

  detectContentTypes(content) {
    const results = {
      hasImages: false, hasAudio: false, hasVideo: false, hasDocuments: false,
      imageCount: 0, audioCount: 0, videoCount: 0, documentCount: 0,
      images: [], audio: [], videos: [], documents: [],
    };

    if (typeof content !== 'string') return results;

    const imagePatterns = [
      /!\[.*?\]\((https?:\/\/[^\s]+)\)/g,
      /<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi,
      /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp))/gi,
    ];
    for (const pattern of imagePatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const url = match[1] || match[0];
        if (!results.images.includes(url)) {
          results.images.push(url);
          results.imageCount++;
        }
      }
    }
    results.hasImages = results.imageCount > 0;

    const audioPatterns = [
      /<audio[^>]+src=["'](https?:\/\/[^"']+)["']/gi,
      /(https?:\/\/[^\s]+\.(?:mp3|wav|ogg|m4a|flac))/gi,
    ];
    for (const pattern of audioPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const url = match[1] || match[0];
        if (!results.audio.includes(url)) {
          results.audio.push(url);
          results.audioCount++;
        }
      }
    }
    results.hasAudio = results.audioCount > 0;

    const videoPatterns = [
      /<video[^>]+src=["'](https?:\/\/[^"']+)["']/gi,
      /(https?:\/\/[^\s]+\.(?:mp4|webm|avi|mov|mkv))/gi,
    ];
    for (const pattern of videoPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const url = match[1] || match[0];
        if (!results.videos.includes(url)) {
          results.videos.push(url);
          results.videoCount++;
        }
      }
    }
    results.hasVideo = results.videoCount > 0;

    return results;
  }

  isImageUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      if (this._imageExtensions.some(ext => pathname.endsWith(ext))) return true;
      if (this._imageHosts.some(host => urlObj.hostname.includes(host))) return true;
    } catch (e) {}
    return false;
  }

  isAudioUrl(url) {
    try {
      const urlObj = new URL(url);
      return this._audioExtensions.some(ext => urlObj.pathname.toLowerCase().endsWith(ext));
    } catch (e) { return false; }
  }

  isVideoUrl(url) {
    try {
      const urlObj = new URL(url);
      return this._videoExtensions.some(ext => urlObj.pathname.toLowerCase().endsWith(ext));
    } catch (e) { return false; }
  }

  extractImageUrls(content) {
    const urls = [];
    const patterns = [
      /!\[.*?\]\((https?:\/\/[^\s]+)\)/g,
      /<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi,
      /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg))/gi,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const url = match[1] || match[0];
        if (!urls.includes(url)) urls.push(url);
      }
    }
    return urls;
  }

  async fetchImageMetadata(url) {
    if (this._cache.has(`meta:${url}`)) return this._cache.get(`meta:${url}`);
    try {
      const response = await fetch(url, { method: 'HEAD' });
      const contentType = response.headers.get('content-type') || 'unknown';
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      const lastModified = response.headers.get('last-modified');
      const result = {
        url, contentType, size: contentLength,
        sizeFormatted: this._formatSize(contentLength),
        lastModified: lastModified ? new Date(lastModified) : null,
        extension: this._getExtension(url),
        estimatedSize: this._estimateMediaSize(this._getExtension(url)),
      };
      this._cacheResult(`meta:${url}`, result);
      return result;
    } catch (error) {
      return { url, error: error.message, available: false };
    }
  }

  async extractTextFromImage(imageUrl, options = {}) {
    if (this._cache.has(`ocr:${imageUrl}`)) return this._cache.get(`ocr:${imageUrl}`);
    const apiEndpoint = options.apiEndpoint || 'https://api.example.com/ocr';
    const apiKey = options.apiKey;
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` }),
        },
        body: JSON.stringify({
          image_url: imageUrl,
          language: options.language || 'auto',
          detect_orientation: options.detectOrientation !== false,
          paragraph: options.paragraph !== false,
        }),
      });
      const result = await response.json();
      const ocrResult = {
        success: true,
        text: result.text || result.transcription || '',
        confidence: result.confidence || 0.9,
        language: result.language || 'unknown',
        boundingBoxes: result.bounding_boxes || [],
        paragraphs: result.paragraphs || [],
        words: result.words || [],
      };
      this._cacheResult(`ocr:${imageUrl}`, ocrResult);
      return ocrResult;
    } catch (error) {
      return { success: false, text: '', error: error.message, fallbackUsed: false };
    }
  }

  async extractKeyframesFromVideo(videoUrl, options = {}) {
    const maxFrames = options.maxFrames || 10;
    const interval = options.interval || 5;
    const cacheKey = `video:${videoUrl}:keyframes`;
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);
    const apiEndpoint = options.apiEndpoint || 'https://api.example.com/video/keyframes';
    const apiKey = options.apiKey;
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey && { 'Authorization': `Bearer ${apiKey}` }) },
        body: JSON.stringify({
          video_url: videoUrl, max_frames: maxFrames, interval_seconds: interval,
          extract_scene_changes: options.extractSceneChanges !== false,
          min_confidence: options.minConfidence || 0.5,
        }),
      });
      const result = await response.json();
      const keyframesResult = {
        success: true, frames: result.frames || [], frameCount: result.frames?.length || 0,
        duration: result.duration || 0, fps: result.fps || 30,
      };
      this._cacheResult(cacheKey, keyframesResult);
      return keyframesResult;
    } catch (error) {
      return { success: false, frames: [], error: error.message };
    }
  }

  async transcribeAudio(audioUrl, options = {}) {
    const cacheKey = `audio:${audioUrl}:transcript`;
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);
    const apiEndpoint = options.apiEndpoint || 'https://api.example.com/audio/transcribe';
    const apiKey = options.apiKey;
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey && { 'Authorization': `Bearer ${apiKey}` }) },
        body: JSON.stringify({
          audio_url: audioUrl, language: options.language || 'auto',
          model: options.model || 'whisper-1',
          enable_diarization: options.enableDiarization || false,
        }),
      });
      const result = await response.json();
      const transcription = {
        success: true, text: result.text || result.transcription || '',
        language: result.language || 'unknown', duration: result.duration || 0,
        segments: result.segments || [], words: result.words || [],
      };
      this._cacheResult(cacheKey, transcription);
      return transcription;
    } catch (error) {
      return { success: false, text: '', error: error.message };
    }
  }

  async analyzeImage(imageUrl, options = {}) {
    const cacheKey = `image:${imageUrl}:analysis`;
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);
    const apiEndpoint = options.apiEndpoint || 'https://api.example.com/vision/analyze';
    const apiKey = options.apiKey;
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey && { 'Authorization': `Bearer ${apiKey}` }) },
        body: JSON.stringify({
          image_url: imageUrl,
          features: options.features || ['description', 'tags', 'faces', 'objects', 'text'],
          language: options.language || 'en',
        }),
      });
      const result = await response.json();
      const analysis = {
        success: true,
        description: result.description || '', tags: result.tags || [],
        faces: result.faces || [], objects: result.objects || [],
        text: result.text || '', colors: result.colors || [],
        adult: result.adult || { isAdult: false, isRacy: false },
      };
      this._cacheResult(cacheKey, analysis);
      return analysis;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async processMediaWithLLM(mediaContent, prompt, options = {}) {
    const { provider, model, apiKey } = options;
    if (!provider || !apiKey) return { success: false, error: 'Provider and API key required' };
    try {
      const messages = [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...mediaContent.map(item => item.type === 'image' ? { type: 'image_url', image_url: { url: item.url } } : item),
        ],
      }];
      const response = await fetch(provider.baseUrl || 'https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: model || 'gpt-4-vision-preview', messages, max_tokens: options.maxTokens || 1000 }),
      });
      const result = await response.json();
      return { success: true, content: result.choices?.[0]?.message?.content || '', usage: result.usage || {} };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  _cacheResult(key, value) {
    if (this._cache.size >= this._cacheSize) {
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    this._cache.set(key, value);
  }

  _formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  _getExtension(url) {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      const m = pathname.match(/\.([a-z0-9]+)$/);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  _estimateMediaSize(extension) {
    const estimates = {
      '.jpg': '2-5 MB', '.png': '2-10 MB', '.gif': '1-5 MB',
      '.mp4': '50-500 MB', '.mp3': '3-10 MB', '.wav': '10-50 MB',
    };
    return estimates[`.${extension}`] || 'unknown';
  }
}
