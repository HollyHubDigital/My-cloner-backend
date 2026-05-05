import express from 'express';
import cors from 'cors';
import axios from 'axios';
import https from 'https';
import { load } from 'cheerio';
import { scrapeWithPuppeteer, closeBrowser, detectSPA } from '../src/puppeteer-scraper.js';

const app = express();

// Configure axios
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const axiosConfig = {
  httpsAgent,
  timeout: 20000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
};

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Helper to convert image URLs to base64
async function downloadAndEncodeAsBase64(url, baseUrl, retries = 2) {
  if (!url) return url;
  try {
    let fullUrl = url;
    if (!url.startsWith('http') && !url.startsWith('data:')) {
      try {
        fullUrl = new URL(url, baseUrl).href;
      } catch (e) {
        return url;
      }
    }
    if (fullUrl.startsWith('data:') || fullUrl.length > 2083) return fullUrl;

    let response;
    try {
      response = await axios.get(fullUrl, {
        ...axiosConfig,
        timeout: 5000,
        responseType: 'arraybuffer'
      });
    } catch (fetchError) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 500));
        return downloadAndEncodeAsBase64(url, baseUrl, retries - 1);
      }
      throw fetchError;
    }

    if (!response.data) return url;
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    const mimeType = response.headers['content-type']?.split(';')[0].trim() || 'application/octet-stream';
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    return url;
  }
}

// Clone endpoint
app.post('/clone', async (req, res) => {
  try {
    const { url, mode = 'default', inlineStyles = true, extractJS = true } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    let html;
    const isSPA = await detectSPA(url);
    if (isSPA) {
      const result = await scrapeWithPuppeteer(url, true);
      html = result;
    } else {
      const response = await axios.get(url, axiosConfig);
      html = response.data;
    }

    const $ = load(html);
    
    if (inlineStyles) {
      $('link[rel="stylesheet"]').each((i, el) => {
        const href = $(el).attr('href');
        // Convert CSS links to inline styles (simplified)
      });
    }

    const result = { html: $.html(), mode, isSPA };
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;
