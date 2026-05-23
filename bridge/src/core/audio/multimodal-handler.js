/**
 * 多模态处理器
 * 处理图像、音频、视频等多媒体内容
 */
import logger from '../monitoring/logger.js';

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
      hasImages: false,
      hasAudio: false,
      hasVideo: false,
      hasDocuments: false,
      imageCount: 0,
      audioCount: 0,
      videoCount: 0,
      documentCount: 0,
      images: [],
      audio: [],
      videos: [],
      documents: []
    };

    if (typeof content !== 'string') return results;

    // Detect images
    const imagePatterns = [
      /!\[.*?\]\((https?:\/\/[^\s]+)\)/g,
      /<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi,
      /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp))/gi
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

    // Detect audio
    const audioPatterns = [
      /<audio[^>]+src=["'](https?:\/\/[^"']+)["']/gi,
      /(https?:\/\/[^\s]+\.(?:mp3|wav|ogg|m4a|flac))/gi
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

    // Detect video
    const videoPatterns = [
      /<video[^>]+src=["'](https?:\/\/[^"']+)["']/gi,
      /(https?:\/\/[^\s]+\.(?:mp4|webm|avi|mov|mkv))/gi
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

      if (this._imageExtensions.some(ext => pathname.endsWith(ext))) {
        return true;
      }

      if (this._imageHosts.some(host => urlObj.hostname.includes(host))) {
        return true;
      }
    } catch (e) { logger.warn('[Multimodal] isImageUrl parse failed: %s', e.message); }

    return false;
  }

  isAudioUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      return this._audioExtensions.some(ext => pathname.endsWith(ext));
    } catch (e) { logger.warn('[Multimodal] isAudioUrl parse failed: %s', e.message); }
    return false;
  }

  isVideoUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      return this._videoExtensions.some(ext => pathname.endsWith(ext));
    } catch (e) { logger.warn('[Multimodal] isVideoUrl parse failed: %s', e.message); }
    return false;
  }

  extractImageUrls(content) {
    const urls = [];
    const patterns = [
      /!\[.*?\]\((https?:\/\/[^\s]+)\)/g,
      /<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi,
      /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg))/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const url = match[1] || match[0];
        if (!urls.includes(url)) {
          urls.push(url);
        }
      }
    }

    return urls;
  }

  async fetchImageMetadata(url) {
    if (this._cache.has(`meta:${url}`)) {
      return this._cache.get(`meta:${url}`);
    }

    try {
      const response = await fetch(url, { method: 'HEAD' });

      const contentType = response.headers.get('content-type') || 'unknown';
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      const lastModified = response.headers.get('last-modified');

      const result = {
        url,
        contentType,
        size: contentLength,
        sizeFormatted: this._formatSize(contentLength),
        lastModified: lastModified ? new Date(lastModified) : null,
        extension: this._getExtension(url),
        estimatedSize: this._estimateMediaSize(this._getExtension(url))
      };

      this._cacheResult(`meta:${url}`, result);
      return result;
    } catch (error) {
      return {
        url,
        error: error.message,
        available: false
      };
    }
  }

  async extractTextFromImage(imageUrl, options = {}) {
    if (this._cache.has(`ocr:${imageUrl}`)) {
      return this._cache.get(`ocr:${imageUrl}`);
    }

    const apiEndpoint = options.apiEndpoint || 'https://api.example.com/ocr';
    const apiKey = options.apiKey;

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
        },
        body: JSON.stringify({
          image_url: imageUrl,
          language: options.language || 'auto',
          detect_orientation: options.detectOrientation !== false,
          paragraph: options.paragraph !== false
        })
      });

      const result = await response.json();

      const ocrResult = {
        success: true,
        text: result.text || result.transcription || '',
        confidence: result.confidence || 0.9,
        language: result.language || 'unknown',
        boundingBoxes: result.bounding_boxes || [],
        paragraphs: result.paragraphs || [],
        words: result.words || []
      };

      this._cacheResult(`ocr:${imageUrl}`, ocrResult);
      return ocrResult;
    } catch (error) {
      return {
        success: false,
        text: '',
        error: error.message,
        fallbackUsed: false
      };
    }
  }

  async extractKeyframesFromVideo(videoUrl, options = {}) {
    const maxFrames = options.maxFrames || 10;
    const interval = options.interval || 5;

    const cacheKey = `video:${videoUrl}:keyframes`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const apiEndpoint = options.apiEndpoint || 'https://api.example.com/video/keyframes';
    const apiKey = options.apiKey;

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
        },
        body: JSON.stringify({
          video_url: videoUrl,
          max_frames: maxFrames,
          interval_seconds: interval,
          extract_scene_changes: options.extractSceneChanges !== false,
          min_confidence: options.minConfidence || 0.5
        })
      });

      const result = await response.json();

      const keyframesResult = {
        success: true,
        frames: result.frames || [],
        frameCount: result.frames?.length || 0,
        duration: result.duration || 0,
        fps: result.fps || 30
      };

      this._cacheResult(cacheKey, keyframesResult);
      return keyframesResult;
    } catch (error) {
      return {
        success: false,
        frames: [],
        error: error.message
      };
    }
  }

  async transcribeAudio(audioUrl, options = {}) {
    const cacheKey = `audio:${audioUrl}:transcript`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const apiEndpoint = options.apiEndpoint || 'https://api.example.com/audio/transcribe';
    const apiKey = options.apiKey;

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
        },
        body: JSON.stringify({
          audio_url: audioUrl,
          language: options.language || 'auto',
          model: options.model || 'whisper-1',
          enable_diarization: options.enableDiarization || false
        })
      });

      const result = await response.json();

      const transcription = {
        success: true,
        text: result.text || result.transcription || '',
        language: result.language || 'unknown',
        duration: result.duration || 0,
        segments: result.segments || [],
        words: result.words || []
      };

      this._cacheResult(cacheKey, transcription);
      return transcription;
    } catch (error) {
      return {
        success: false,
        text: '',
        error: error.message
      };
    }
  }

  async analyzeImage(imageUrl, options = {}) {
    const cacheKey = `image:${imageUrl}:analysis`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const apiEndpoint = options.apiEndpoint || 'https://api.example.com/vision/analyze';
    const apiKey = options.apiKey;

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
        },
        body: JSON.stringify({
          image_url: imageUrl,
          features: options.features || ['description', 'tags', 'faces', 'objects', 'text'],
          language: options.language || 'en'
        })
      });

      const result = await response.json();

      const analysis = {
        success: true,
        description: result.description || '',
        tags: result.tags || [],
        faces: result.faces || [],
        objects: result.objects || [],
        text: result.text || '',
        colors: result.colors || [],
        adult: result.adult || { isAdult: false, isRacy: false }
      };

      this._cacheResult(cacheKey, analysis);
      return analysis;
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async processMediaWithLLM(mediaContent, prompt, options = {}) {
    const { provider, model, apiKey } = options;

    if (!provider || !apiKey) {
      return {
        success: false,
        error: 'Provider and API key required'
      };
    }

    try {
      // Build the request based on provider type
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...mediaContent.map(item => {
              if (item.type === 'image') {
                return {
                  type: 'image_url',
                  image_url: { url: item.url }
                };
              }
              return item;
            })
          ]
        }
      ];

      const response = await fetch(provider.baseUrl || 'https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model || 'gpt-4-vision-preview',
          messages,
          max_tokens: options.maxTokens || 1000
        })
      });

      const result = await response.json();

      return {
        success: true,
        content: result.choices?.[0]?.message?.content || '',
        usage: result.usage || {}
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
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
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      const match = pathname.match(/\.([a-z0-9]+)$/);
      return match ? match[1] : '';
    } catch (e) {
      return '';
    }
  }

  _estimateMediaSize(extension) {
    const estimates = {
      '.jpg': '2-5 MB',
      '.png': '2-10 MB',
      '.gif': '1-5 MB',
      '.mp4': '50-500 MB',
      '.mp3': '3-10 MB',
      '.wav': '10-50 MB'
    };
    return estimates[`.${extension}`] || 'unknown';
  }
}

export default MultimodalHandler;
