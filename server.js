import express from 'express';
import cors from 'cors';
import axios from 'axios';
import https from 'https';
import { load } from 'cheerio';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { URL } from 'url';
import { scrapeWithPuppeteer, closeBrowser, detectSPA } from './src/puppeteer-scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configure axios to handle HTTPS with self-signed certificates (for development)
const httpsAgent = new https.Agent({
  rejectUnauthorized: false // Allow self-signed certificates
});

const axiosConfig = {
  httpsAgent: httpsAgent,
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(join(__dirname, 'public')));

// Helper to convert image URLs to base64 data URLs
async function downloadAndEncodeAsBase64(url, baseUrl, retries = 2) {
  if (!url) return url;
  
  try {
    // Resolve relative URLs
    let fullUrl = url;
    if (!url.startsWith('http') && !url.startsWith('data:')) {
      try {
        fullUrl = new URL(url, baseUrl).href;
      } catch (e) {
        console.log(`    ⚠️  Invalid URL format: ${url}`);
        return url;
      }
    }
    
    // Skip data URLs
    if (fullUrl.startsWith('data:')) {
      return fullUrl;
    }
    
    // Skip very large URLs (likely problematic)
    if (fullUrl.length > 2083) {
      return fullUrl;
    }
    
    // Fetch the asset with retry logic
    let response;
    try {
      response = await axios.get(fullUrl, {
        ...axiosConfig,
        timeout: 5000,
        responseType: 'arraybuffer',
        maxRedirects: 3
      });
    } catch (fetchError) {
      if (retries > 0) {
        console.log(`    ↻ Retry ${3 - retries + 1} for ${url.substring(0, 40)}`);
        await new Promise(r => setTimeout(r, 500)); // Wait before retry
        return downloadAndEncodeAsBase64(url, baseUrl, retries - 1);
      }
      throw fetchError;
    }
    
    if (!response.data || response.data.length === 0) {
      console.log(`    ⚠️  Empty response for ${url.substring(0, 50)}`);
      return url;
    }
    
    const buffer = Buffer.from(response.data, 'binary');
    const base64 = buffer.toString('base64');
    
    // Determine MIME type - check content-type header first
    let mimeType = 'application/octet-stream';
    
    if (response.headers['content-type']) {
      mimeType = response.headers['content-type'].split(';')[0].trim();
    } else if (fullUrl.includes('.png')) mimeType = 'image/png';
    else if (fullUrl.includes('.jpg') || fullUrl.includes('.jpeg')) mimeType = 'image/jpeg';
    else if (fullUrl.includes('.gif')) mimeType = 'image/gif';
    else if (fullUrl.includes('.webp')) mimeType = 'image/webp';
    else if (fullUrl.includes('.svg')) mimeType = 'image/svg+xml';
    else if (fullUrl.includes('.woff2')) mimeType = 'font/woff2';
    else if (fullUrl.includes('.woff')) mimeType = 'font/woff';
    else if (fullUrl.includes('.ttf')) mimeType = 'font/ttf';
    else if (fullUrl.includes('.eot')) mimeType = 'application/vnd.ms-fontobject';
    else if (fullUrl.includes('.otf')) mimeType = 'font/otf';
    
    // Skip overly large base64 strings (>5MB)
    if (base64.length > 5 * 1024 * 1024) {
      console.log(`    ⚠️  Asset too large (${Math.round(base64.length / 1024 / 1024)}MB): ${url.substring(0, 40)}`);
      return url;
    }
    
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.log(`    ⚠️  Failed to inline asset ${url.substring(0, 50)}: ${error.message}`);
    return url; // Return original URL as fallback
  }
}

// Clean up problematic HTML patterns that cause [object Object] errors
function sanitizeHtmlForCloning(html) {
  if (!html) return html;
  
  let cleaned = html;
  
  // Remove any src/href attributes that contain [object Object] or similar patterns
  cleaned = cleaned.replace(/(\bsrc=")(\[object\s+\w+\]?)(")/gi, '$1about:blank$3');
  cleaned = cleaned.replace(/(\bhref=")(\[object\s+\w+\]?)(")/gi, '#$3');
  cleaned = cleaned.replace(/(\bdata-src=")(\[object\s+\w+\]?)(")/gi, '$1about:blank$3');
  cleaned = cleaned.replace(/(\bdata-href=")(\[object\s+\w+\]?)(")/gi, '$1#$3');
  
  // Remove event handlers that might reference bad URLs
  cleaned = cleaned.replace(/on(?:click|load|error|abort|change)="[^"]*\[object\s+\w+\][^"]*"/gi, '');
  
  // Fix script tags with src that point to invalid locations
  cleaned = cleaned.replace(/<script[^>]*src="(\[object\s+\w+\]?|undefined|null|NaN)"[^>]*><\/script>/gi, '');
  cleaned = cleaned.replace(/<script[^>]*src='(\[object\s+\w+\]?|undefined|null|NaN)'[^>]*><\/script>/gi, '');
  
  // Remove link tags with href pointing to invalid locations
  cleaned = cleaned.replace(/<link[^>]*href="(\[object\s+\w+\]?|undefined|null|NaN)"[^>]*>/gi, '');
  cleaned = cleaned.replace(/<link[^>]*href='(\[object\s+\w+\]?|undefined|null|NaN)'[^>]*>/gi, '');
  
  // Remove img tags with bad src
  cleaned = cleaned.replace(/<img[^>]*src="(\[object\s+\w+\]?|undefined|null|NaN)"[^>]*>/gi, '<!-- broken img -->');
  cleaned = cleaned.replace(/<img[^>]*src='(\[object\s+\w+\]?|undefined|null|NaN)'[^>]*>/gi, '<!-- broken img -->');
  
  // Fix style attributes with invalid URLs
  cleaned = cleaned.replace(/style="([^"]*)url\(\s*(\[object\s+\w+\]?|undefined|null|NaN)\s*\)([^"]*)"/gi, 'style="$1url(about:blank)$3"');
  
  // Remove data-* attributes that look suspicious
  cleaned = cleaned.replace(/\s+data-(?:src|href|url|api|endpoint)="(\[object\s+\w+\]?|undefined|null|NaN)"/gi, '');
  
  // Remove any inline JavaScript that tries to access uninitialized variables as URLs
  cleaned = cleaned.replace(/(['"])(\[object\s+\w+\]?)(['"])/g, '$1#$3');
  
  // NEW: Remove any attributes with undefined or null values
  cleaned = cleaned.replace(/\s+\w+="undefined"/gi, '');
  cleaned = cleaned.replace(/\s+\w+=undefined/gi, '');
  cleaned = cleaned.replace(/\s+\w+="null"/gi, '');
  cleaned = cleaned.replace(/\s+\w+=null/gi, '');
  
  // NEW: Clean up web component attributes that might be causing issues
  cleaned = cleaned.replace(/\s+(?:slot|part)="(\[object\s+\w+\]?)"/gi, '');
  
  // NEW: Remove script tags that are empty or only contain error handlers
  cleaned = cleaned.replace(/<script[^>]*>\s*(\/\*|console\.error|console\.log|throw|if\s*\(|return\s+null)[\s\S]*?<\/script>/gi, '');
  
  return cleaned;
}

// Remove CSP meta tags and neutralize service-worker registrations in HTML
function stripCSPAndServiceWorker(html) {
  if (!html) return html;
  let out = html;

  // Remove Content-Security-Policy meta tags
  out = out.replace(/<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
  out = out.replace(/<meta[^>]*http-equiv=["']?X-Content-Security-Policy["']?[^>]*>/gi, '');
  out = out.replace(/<meta[^>]*name=["']?content-security-policy["']?[^>]*>/gi, '');

  // Remove CSP meta tags with single quotes or mixed attributes
  out = out.replace(/<meta[^>]*(?:http-equiv|name)=["']?content-security-policy["']?[^>]*>/gi, '');

  // Neutralize service worker registration by replacing register(...) with a noop
  out = out.replace(/navigator\.serviceWorker\.register\s*\([^;]*\);?/gi, '/* service worker registration removed */');
  out = out.replace(/navigator\.serviceWorker\s*\.\s*register\s*\([^;]*\);?/gi, '/* service worker registration removed */');

  // Neutralize self.addEventListener('install'/'activate'...) common patterns
  out = out.replace(/self\.addEventListener\s*\(\s*['"](?:install|activate|fetch)['"][\s\S]*?\}\s*\)\s*;?/gi, '/* service worker event listener removed */');

  return out;
}

// Sanitize extracted JS: remove service-worker registration and unsafe CSP script injections
function sanitizeExtractedJS(js) {
  if (!js) return js;
  let out = js;

  // Remove service worker registration calls
  out = out.replace(/navigator\.serviceWorker\.register\s*\([^\)]*\)\s*;?/gi, '/* service worker registration removed */');
  out = out.replace(/navigator\.serviceWorker\s*\.\s*register\s*\([^\)]*\)\s*;?/gi, '/* service worker registration removed */');

  // Remove direct calls to self.addEventListener in extracted scripts
  out = out.replace(/self\.addEventListener\s*\(\s*['"](?:install|activate|fetch)['"][\s\S]*?\}\s*\)\s*;?/gi, '/* service worker handler removed */');

  // Remove importScripts(...) which service workers may use
  out = out.replace(/importScripts\s*\([^\)]*\)\s*;?/gi, '/* importScripts removed */');

  return out;
}

// Inline all images and fonts in HTML as base64
async function inlineAssetsInHtml(html, baseUrl, capturedAssets = {}) {
  try {
    console.log(`  📦 Inlining images and fonts as base64...`);
    
    // Process img src attributes
    const imgRegex = /(<img[^>]*src=")([^"]+)(")/gi;
    let inlinedHtml = html;
    let imgMatches = [...html.matchAll(imgRegex)];
    
    // Collect unique image URLs
    const imgUrls = imgMatches.map(m => m[2]).filter(u => u && !u.startsWith('data:'));
    for (const originalUrl of [...new Set(imgUrls)]) {
      try {
        // Prefer captured assets from Puppeteer
        const resolvedUrl = (originalUrl.startsWith('http') || originalUrl.startsWith('//')) ? originalUrl : new URL(originalUrl, baseUrl).href;
        const captured = capturedAssets[resolvedUrl] || capturedAssets[originalUrl];
        let dataUrl = captured;
        if (!dataUrl) {
          dataUrl = await downloadAndEncodeAsBase64(originalUrl, baseUrl);
        }
        if (dataUrl) {
          inlinedHtml = inlinedHtml.replace(new RegExp(`<img([^>]*?)src=[\"']${escapeRegExp(originalUrl)}[\"']([^>]*?)>`, 'gi'), (full, p1, p2) => {
            return `<img${p1}src="${dataUrl}"${p2}>`;
          });
        }
      } catch (e) {
        // ignore individual failures
      }
    }
    
    // Process CSS @font-face URLs
    const fontRegex = /url\(\s*['"]?([^'")]+\.(?:woff2?|ttf|otf))['"]?\s*\)/gi;
    let fontMatches = [...inlinedHtml.matchAll(fontRegex)];
    
    for (const match of fontMatches) {
      const originalUrl = match[1];
      try {
        const resolvedUrl = originalUrl.startsWith('http') ? originalUrl : new URL(originalUrl, baseUrl).href;
        const captured = capturedAssets[resolvedUrl] || capturedAssets[originalUrl];
        const dataUrl = captured || await downloadAndEncodeAsBase64(originalUrl, baseUrl);
        if (dataUrl) {
          inlinedHtml = inlinedHtml.replace(match[0], `url('${dataUrl}')`);
        }
      } catch (e) {
        // ignore
      }
    }
    
    // Process background-image URLs in style attributes
    const bgRegex = /background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
    let bgMatches = [...inlinedHtml.matchAll(bgRegex)];
    
    for (const match of bgMatches) {
      const originalUrl = match[1];
      try {
        if (originalUrl.startsWith('data:')) continue;
        const resolvedUrl = originalUrl.startsWith('http') ? originalUrl : new URL(originalUrl, baseUrl).href;
        const captured = capturedAssets[resolvedUrl] || capturedAssets[originalUrl];
        const dataUrl = captured || await downloadAndEncodeAsBase64(originalUrl, baseUrl);
        if (dataUrl) inlinedHtml = inlinedHtml.replace(match[0], `background-image: url('${dataUrl}')`);
      } catch (e) {
        // ignore
      }
    }
    
    console.log(`  ✅ Asset inlining complete`);
    return inlinedHtml;
  } catch (error) {
    console.log(`  ⚠️ Asset inlining error: ${error.message}`);
    return html; // Return original if inlining fails
  }
}

// Utility: escape RegExp special chars for building dynamic regex
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Fetch external CSS file (simple GET wrapper)
async function fetchExternalCSS(cssUrl, baseUrl) {
  try {
    let fullUrl = cssUrl;
    if (!cssUrl.startsWith('http')) {
      fullUrl = new URL(cssUrl, baseUrl).href;
    }

    const response = await axios.get(fullUrl, {
      ...axiosConfig,
      timeout: 10000
    });

    if (response.data && response.data.trim().length > 0) {
      console.log(`    ✅ Fetched ${response.data.length} bytes from CSS`);
      return response.data;
    }
    return '';
  } catch (error) {
    console.log(`    ⚠️ Failed to fetch CSS: ${error.message}`);
    return '';
  }
}

// Fetch external JavaScript file
async function fetchExternalJS(jsUrl, baseUrl) {
  try {
    let fullUrl = jsUrl;
    if (!jsUrl.startsWith('http')) {
      fullUrl = new URL(jsUrl, baseUrl).href;
    }
    
    const response = await axios.get(fullUrl, {
      ...axiosConfig,
      timeout: 10000
    });
    
    if (response.data && response.data.trim().length > 0) {
      console.log(`    ✅ Fetched ${response.data.length} bytes from JS`);
      return response.data;
    }
    return '';
  } catch (error) {
    console.log(`    ⚠️ Failed to fetch JS: ${error.message}`);
    return '';
  }
}

// Normalize url() paths and recursively resolve @import rules
async function normalizeCss(cssText, baseUrl, visited = new Set()) {
  if (!cssText) return cssText;

  // resolve any @import rules by fetching the referenced stylesheet
  const importRegex = /@import\s+(?:url\()?['"]?(.*?)['"]?\)?\s*;/gi;
  let match;
  while ((match = importRegex.exec(cssText)) !== null) {
    let importUrl = match[1];
    if (!importUrl) continue;

    try {
      importUrl = new URL(importUrl, baseUrl).href;
    } catch {
      // if URL constructor fails, skip
      continue;
    }

    if (visited.has(importUrl)) continue; // avoid circular imports
    visited.add(importUrl);

    console.log(`  📥 Fetching @import CSS: ${importUrl}`);
    const importedCss = await fetchExternalCSS(importUrl, baseUrl);
    if (importedCss) {
      const normalizedImported = await normalizeCss(importedCss, importUrl, visited);
      // replace the import rule with the actual contents
      cssText = cssText.replace(match[0], normalizedImported);
    }
  }

  // rewrite url(...) references to absolute URLs
  cssText = cssText.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (full, quote, url) => {
    if (/^(data:|https?:|\/\/)/i.test(url)) {
      return full; // leave data or absolute paths alone
    }
    try {
      const abs = new URL(url, baseUrl).href;
      return `url("${abs}")`;
    } catch {
      return full;
    }
  });

  return cssText;
}

// Extract all CSS from inline styles and external stylesheets
async function extractAllCSS($, baseUrl) {
  const pieces = [];

  console.log(`📋 Scanning for all CSS sources...`);
  
  // Extract ALL inline <style> tags (crucial for animations, keyframes)
  const styleCount = $('style').length;
  console.log(`   Found ${styleCount} inline style tags`);
  
  $('style').each((i, el) => {
    const css = $(el).html();
    if (css && css.trim().length > 0) {
      // Check if contains animations
      const hasAnimations = /(@keyframes|animation|@media|transition)/i.test(css);
      if (hasAnimations) {
        console.log(`   ✨ Style tag ${i + 1} contains animations/keyframes`);
      }
      pieces.push({ css, base: baseUrl, source: `inline-style-${i}` });
    }
  });

  // Gather external stylesheet URLs - FETCH ALL application stylesheets
  // Only skip trackers and analytics, include all UI/component styling
  const cssLinks = [];
  const skipPatterns = [
    /google-analytics|gtag|facebook\.com.*sdk|segment\.com|amplitude|doubleclick|hotjar/i, // tracking only
    /twitter\.com|linkedin\.com\/collect/i // social tracking
  ];
  
  $('link[rel="stylesheet"]').each((i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const shouldSkip = skipPatterns.some(pattern => pattern.test(href));
    if (!shouldSkip) {
      cssLinks.push(href);
    }
  });

  console.log(`   Found ${cssLinks.length} external stylesheet links (all application stylesheets)`);


  for (const href of cssLinks) {
    const resolvedHref = new URL(href, baseUrl).href;
    console.log(`  📥 Fetching CSS: ${resolvedHref}`);
    const css = await fetchExternalCSS(resolvedHref, baseUrl);
    if (css) {
      pieces.push({ css, base: resolvedHref, source: href });
    }
  }

  // normalize every piece (resolve imports + url() paths)
  const cssArray = [];
  let totalCSSSize = 0;
  let hasAnimations = false;
  
  for (const piece of pieces) {
    let normalized = await normalizeCss(piece.css, piece.base);
    
    // Check for animations in this piece
    if (/@keyframes|animation[-:]|@media|transition/i.test(normalized)) {
      hasAnimations = true;
    }
    
    totalCSSSize += normalized.length;
    if (piece.source !== 'inline') {
      normalized = `/* From: ${piece.source} */\n${normalized}`;
    }
    cssArray.push(normalized);
  }

  if (cssArray.length === 0) {
    cssArray.push('/* No CSS found */\nbody { font-family: system-ui, -apple-system, sans-serif; }');
  }

  // Log CSS extraction summary
  console.log(`   ✅ Extracted ${pieces.length} CSS sources`);
  console.log(`   📊 Total CSS size: ${totalCSSSize} bytes`);
  if (hasAnimations) {
    console.log(`   ✨ Animations/keyframes detected in CSS`);
  }

  const finalCSS = cssArray.join('\n\n/* ===== SEPARATOR ===== */\n\n');
  console.log(`   📦 Final CSS bundle: ${finalCSS.length} bytes`);
  
  return finalCSS;
}

// Extract all JavaScript from inline scripts and external files
async function extractAllJS($, baseUrl) {
  const jsArray = [];
  const skipPatterns = [
    /google-analytics/i,
    /gtag\.(js|config)/i,
    /facebook\.com\/en_US\/sdk/i,
    /cdn\.segment\.com/i,
    /cdn\.amplitude\.com/i,
    /static\.doubleclick\.net/i,
    /analytics\.google\.com/i,
    /cdn\.jsdelivr\.net.*tailwind/i
  ];
  
  // Collect inline scripts (skip analytics, ads, etc.)
  $('script:not([src])').each((i, el) => {
    const js = $(el).html();
    if (js && 
        !js.includes('<!') && 
        !js.includes('-->')) {
      const shouldSkip = skipPatterns.some(pattern => pattern.test(js));
      if (!shouldSkip && js.trim().length > 0) {
        jsArray.push(js);
      }
    }
  });
  
  // Fetch external scripts (skip analytics and ad services)
  const scriptSrcs = [];
  $('script[src]').each((i, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const shouldSkip = skipPatterns.some(pattern => pattern.test(src));
    if (!shouldSkip) {
      scriptSrcs.push(src);
    }
  });
  
  for (const src of scriptSrcs) {
    console.log(`  📥 Fetching JS: ${src}`);
    const js = await fetchExternalJS(src, baseUrl);
    if (js && js.trim().length > 0) {
      jsArray.push(`/* From: ${src} */\n${js}`);
    }
  }
  
  if (jsArray.length === 0) {
    jsArray.push('// No additional JavaScript found\nconsole.log("Website cloned successfully");');
  }
  
  return jsArray.join('\n\n/* ===== SEPARATOR ===== */\n\n');
}

// Fetch all external stylesheets referenced in HTML
async function fetchAllExternalStylesheets(html, baseUrl) {
  const stylesheets = [];
  const linkRegex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi;
  let match;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    
    // Skip Google Fonts and other non-essential stylesheets
    if (href.includes('fonts.googleapis.com') || 
        href.includes('cdn.jsdelivr.net') ||
        href.includes('cdnjs.cloudflare.com') ||
        href.includes('maxcdn.bootstrapcdn.com')) {
      // Keep these - they're often used for icons/fonts
    }
    
    try {
      console.log(`  📥 Fetching external stylesheet: ${href}`);
      const stylesheetUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
      
      const response = await axios.get(stylesheetUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }).catch(err => {
        console.log(`    ⚠️ Failed to fetch stylesheet: ${err.message}`);
        return null;
      });
      
      if (response && response.data) {
        stylesheets.push({
          url: href,
          content: response.data,
          size: response.data.length
        });
        console.log(`    ✅ Fetched ${response.data.length} bytes from ${href}`);
      }
    } catch (err) {
      console.log(`    ⚠️ Error fetching stylesheet ${href}: ${err.message}`);
    }
  }
  
  return stylesheets;
}

// Extract JavaScript from HTML (inline and external references)
// This function FETCHES external scripts and includes their full content
async function extractScriptsFromHTML(html, baseUrl) {
  const jsArray = [];
  
  // Extract inline scripts (content between <script> and </script>)
  const inlineScriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = inlineScriptRegex.exec(html)) !== null) {
    const scriptContent = match[1].trim();
    // Skip empty, cloner helper, and analytics scripts only
    // DO NOT filter out functional scripts
    if (scriptContent && 
        !scriptContent.includes('window.__CLONED_SITE__') &&
        !scriptContent.includes('window.__SANITIZE_URL__') &&
        !scriptContent.includes('__CF$cv$params') &&
        scriptContent.length > 0) {
      jsArray.push(scriptContent);
    }
  }
  
  // Extract external script sources and FETCH their content
  const srcScriptRegex = /<script[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((match = srcScriptRegex.exec(html)) !== null) {
    const src = match[1];
    
    // Only skip analytics, ads, and trackers - INCLUDE all functional scripts
    if (!src.includes('google-analytics') &&
        !src.includes('gtag') &&
        !src.includes('facebook.com/collect') &&
        !src.includes('segment.com') &&
        !src.includes('amplitude') &&
        !src.includes('doubleclick') &&
        !src.includes('hotjar') &&
        !src.includes('/collect?') &&
        !src.includes('tracking') &&
        !src.includes('cdn-cgi') &&
        !src.includes('challenge')) {
      
      // Fetch the external script content
      try {
        console.log(`  📥 Fetching external script: ${src}`);
        const scriptUrl = src.startsWith('http') ? src : new URL(src, baseUrl).href;
        
        const response = await axios.get(scriptUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        }).catch(err => {
          console.log(`    ⚠️ Failed to fetch: ${err.message}`);
          return null;
        });
        
        if (response && response.data) {
          const scriptContent = response.data;
          if (scriptContent && scriptContent.trim().length > 0) {
            jsArray.push(scriptContent);
            console.log(`    ✅ Fetched ${scriptContent.length} bytes from ${src}`);
          }
        }
      } catch (err) {
        console.log(`    ⚠️ Error fetching script ${src}: ${err.message}`);
      }
    }
  }
  
  if (jsArray.length === 0) {
    return '// No JavaScript found\nconsole.log("Website cloned successfully");';
  }
  
  return jsArray.join('\n\n');
}

// Remove all script tags from HTML (but keep content inline options available)
function removeScriptTagsFromHTML(html) {
  // Remove script tags but capture them first
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').trim();
}

// Remove all style tags from HTML (content already extracted)
function removeStyleTagsFromHTML(html) {
  // Remove style tags - content has already been extracted
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').trim();
}

// Extract all images, videos, and media assets with absolute URLs
async function extractAllAssets($, baseUrl) {
  const assets = {
    images: [],
    videos: [],
    media: [],
    fonts: []
  };

  // Extract images from <img> tags
  $('img').each((i, el) => {
    const src = $(el).attr('src');
    const srcset = $(el).attr('srcset');
    
    if (src) {
      try {
        const absUrl = new URL(src, baseUrl).href;
        assets.images.push(absUrl);
      } catch (e) {
        console.log(`    ⚠️ Invalid image URL: ${src}`);
      }
    }
    
    if (srcset) {
      srcset.split(',').forEach(item => {
        const [url] = item.trim().split(/\s+/);
        try {
          const absUrl = new URL(url, baseUrl).href;
          assets.images.push(absUrl);
        } catch (e) {
          console.log(`    ⚠️ Invalid srcset URL: ${url}`);
        }
      });
    }
  });

  // Extract images from <picture> sources
  $('picture source').each((i, el) => {
    const srcset = $(el).attr('srcset');
    if (srcset) {
      srcset.split(',').forEach(item => {
        const [url] = item.trim().split(/\s+/);
        try {
          const absUrl = new URL(url, baseUrl).href;
          assets.images.push(absUrl);
        } catch (e) {
          console.log(`    ⚠️ Invalid picture srcset URL: ${url}`);
        }
      });
    }
  });

  // Extract videos and their sources
  $('video').each((i, el) => {
    const src = $(el).attr('src');
    if (src) {
      try {
        const absUrl = new URL(src, baseUrl).href;
        assets.videos.push(absUrl);
      } catch (e) {
        console.log(`    ⚠️ Invalid video URL: ${src}`);
      }
    }

    // Check source tags inside video
    $(el).find('source').each((j, sourceEl) => {
      const srcAttr = $(sourceEl).attr('src');
      if (srcAttr) {
        try {
          const absUrl = new URL(srcAttr, baseUrl).href;
          assets.videos.push(absUrl);
        } catch (e) {
          console.log(`    ⚠️ Invalid video source URL: ${srcAttr}`);
        }
      }
    });
  });

  // Extract audio sources
  $('audio').each((i, el) => {
    const src = $(el).attr('src');
    if (src) {
      try {
        const absUrl = new URL(src, baseUrl).href;
        assets.media.push(absUrl);
      } catch (e) {
        console.log(`    ⚠️ Invalid audio URL: ${src}`);
      }
    }

    $(el).find('source').each((j, sourceEl) => {
      const srcAttr = $(sourceEl).attr('src');
      if (srcAttr) {
        try {
          const absUrl = new URL(srcAttr, baseUrl).href;
          assets.media.push(absUrl);
        } catch (e) {
          console.log(`    ⚠️ Invalid audio source URL: ${srcAttr}`);
        }
      }
    });
  });

  // Extract font URLs from CSS (look in style tags)
  $('style').each((i, el) => {
    const css = $(el).html();
    if (css) {
      const fontUrls = css.match(/url\(['"]?([^'")]+\.(woff2?|ttf|otf|eot))/gi);
      if (fontUrls) {
        fontUrls.forEach(match => {
          const url = match.replace(/url\(['"]?/i, '').replace(/['")]/g, '');
          try {
            const absUrl = new URL(url, baseUrl).href;
            assets.fonts.push(absUrl);
          } catch (e) {
            console.log(`    ⚠️ Invalid font URL: ${url}`);
          }
        });
      }
    }
  });

  // Remove duplicates
  assets.images = [...new Set(assets.images)];
  assets.videos = [...new Set(assets.videos)];
  assets.media = [...new Set(assets.media)];
  assets.fonts = [...new Set(assets.fonts)];

  console.log(`  🖼️ Found ${assets.images.length} images, ${assets.videos.length} videos, ${assets.media.length} media, ${assets.fonts.length} fonts`);

  return assets;
}

// Convert relative URLs in script/link tags to absolute URLs
function convertRelativeUrlsInAttributes(html, baseUrl) {
  let modified = html;
  
  // Fix script src attributes
  modified = modified.replace(/(<script[^>]+src=["'])(?!https?:\/\/|\/\/)([^"']+)(["'])/g, (match, prefix, url, suffix) => {
    try {
      const absUrl = new URL(url, baseUrl).href;
      return prefix + absUrl + suffix;
    } catch (e) {
      return match;
    }
  });
  
  // Fix link href attributes (for stylesheets, fonts, etc)
  modified = modified.replace(/(<link[^>]+href=["'])(?!https?:\/\/|\/\/)([^"']+)(["'])/g, (match, prefix, url, suffix) => {
    try {
      const absUrl = new URL(url, baseUrl).href;
      return prefix + absUrl + suffix;
    } catch (e) {
      return match;
    }
  });
  
  return modified;
}

// Rewrite image and video URLs in HTML to use absolute paths
function rewriteMediaUrls(html, baseUrl) {
  let modified = html;

  // Rewrite img src attributes (including SVG images)
  modified = modified.replace(/src=['"]([^'"]+)['"](?=[^>]*(\/?>|alt=))/gi, (match, url) => {
    if (/^(data:|https?:|\/\/)/i.test(url)) return match;
    try {
      const absUrl = new URL(url, baseUrl).href;
      return `src="${absUrl}"`;
    } catch (e) {
      return match;
    }
  });

  // Rewrite video src attributes
  modified = modified.replace(/<video[^>]*src=['"]([^'"]+)['"]/gi, (match, url) => {
    if (/^(data:|https?:|\/\/)/i.test(url)) return match;
    try {
      const absUrl = new URL(url, baseUrl).href;
      return match.replace(url, absUrl);
    } catch (e) {
      return match;
    }
  });

  // Rewrite source src attributes in video/audio tags
  modified = modified.replace(/<source[^>]*src=['"]([^'"]+)['"]/gi, (match, url) => {
    if (/^(data:|https?:|\/\/)/i.test(url)) return match;
    try {
      const absUrl = new URL(url, baseUrl).href;
      return match.replace(url, absUrl);
    } catch (e) {
      return match;
    }
  });

  // Rewrite srcset attributes
  modified = modified.replace(/srcset=['"]([^'"]+)['"]/gi, (match, srcset) => {
    const rewritten = srcset.split(',').map(item => {
      const parts = item.trim().split(/\s+/);
      const url = parts[0];
      if (/^(data:|https?:|\/\/)/i.test(url)) return item;
      try {
        const absUrl = new URL(url, baseUrl).href;
        return absUrl + (parts[1] ? ' ' + parts[1] : '');
      } catch (e) {
        return item;
      }
    }).join(', ');
    return `srcset="${rewritten}"`;
  });
  
  // Rewrite background-image URLs in inline styles
  modified = modified.replace(/background-image\s*:\s*url\(['"]?([^'")\s]+)['"]?\)/gi, (match, url) => {
    if (/^(data:|https?:|\/\/)/i.test(url)) return match;
    try {
      const absUrl = new URL(url, baseUrl).href;
      return `background-image: url('${absUrl}')`;
    } catch (e) {
      return match;
    }
  });

  // Rewrite CSS background properties
  modified = modified.replace(/background\s*:\s*([^;]*?)url\(['"]?([^'")\s]+)['"]?\)/gi, (match, prefix, url) => {
    if (/^(data:|https?:|\/\/)/i.test(url)) return match;
    try {
      const absUrl = new URL(url, baseUrl).href;
      return `background: ${prefix}url('${absUrl}')`;
    } catch (e) {
      return match;
    }
  });
  
  // Rewrite href attributes for stylesheets and other resources
  modified = modified.replace(/href=['"]([^'"]+)['"](?=[^>]*(stylesheet|icon|apple))/gi, (match, url) => {
    if (/^(data:|https?:|\/\/|about:)/i.test(url)) return match;
    if (/^(#|javascript:)/i.test(url)) return match;
    try {
      const absUrl = new URL(url, baseUrl).href;
      return `href="${absUrl}"`;
    } catch (e) {
      return match;
    }
  });

  return modified;
}

// Check if HTML looks like it needs JavaScript rendering (SPA)
function looksLikeEmptySPA(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return false;
  
  const bodyContent = bodyMatch[1];
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const headContent = headMatch ? headMatch[1] : '';
  const fullContent = html;
  
  // Check for ES6 import statements (indicates modules/bundles)
  const hasImportStatements = /\bimport\s+\{[^}]*\}\s+from\s+['"]/.test(fullContent) ||
                              /\bimport\s+\*\s+as\s+\w+\s+from\s+['"]/.test(fullContent);
  
  // Check for minified React/Vue patterns
  const hasMinifiedFramework = /\.(createElement|mount|component|reactive|ref|computed)\s*\(|React\.Fragment|Vue\.|Angular\.Module/i.test(fullContent);
  
  // Check for webpack/bundle chunk patterns
  const hasWebpackChunks = /chunk-[A-Z0-9]+-[A-Za-z0-9]+\.js|\.chunk\.js|\.\w+\.bundle\.js/i.test(headContent) ||
                           /\(window\["__webpack|\/\* webpackChunk|\bwebpack\b/i.test(bodyContent);
  
  // Check for framework indicators
  const hasReactRoot = /data-react-root|data-reactroot|__next|#root|#app/i.test(bodyContent);
  const hasFrameworkScripts = /(\._next\/|\.chunk\.js|app\..+\.js|main\..+\.js)/i.test(headContent) || 
                              /react|vue|angular|svelte|next\.js|nuxt|gatsby/i.test(headContent);
  
  // Check for minimal body content (just containers/roots)
  const strippedBody = bodyContent.replace(/<[^>]*>/g, '').trim();
  const hasRealContent = strippedBody.length > 50;
  
  // Check for many script tags (SPA bundles)
  const scriptCount = (headContent.match(/<script/g) || []).length + 
                     (bodyContent.match(/<script/g) || []).length;
  
  const modulePreloadCount = (headContent.match(/<link[^>]*rel="modulepreload"/g) || []).length;
  
  // Strong indicators that this is an SPA that needs rendering:
  // 1. Has ES6 import statements (modules can't run in plain HTML)
  // 2. Has minified framework code
  // 3. Has webpack chunks
  // 4. React/Vue/Angular root elements
  // 5. Many scripts with minimal content
  
  const isSPA = hasImportStatements || 
                hasMinifiedFramework ||
                hasWebpackChunks ||
                (hasReactRoot && !hasRealContent) ||
                (hasFrameworkScripts && scriptCount > 3 && !hasRealContent) ||
                (modulePreloadCount > 2);
  
  const isMinimalWithManyScripts = !hasRealContent && scriptCount > 3;
  
  if (isSPA || isMinimalWithManyScripts) {
    console.log(`  📋 SPA Detection: import=${hasImportStatements}, minified=${hasMinifiedFramework}, webpack=${hasWebpackChunks}, react_root=${hasReactRoot}, scripts=${scriptCount}`);
  }
  
  return isSPA || isMinimalWithManyScripts;
}

// Helper to escape closing tags in embedded content
function escapeEmbeddedContent(content) {
  if (!content) return content;
  // Escape closing tags that would break HTML embedding
  return content
    .replace(/<\/style/gi, '<\\/style')
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '\\x3c!--')
    .replace(/-->/g, '--\\x3e');
}

// Helper to escape HTML special characters
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Extract clean HTML (preserve rendered content, inline all styles, minimize external dependencies)
function extractCleanHTML($, title, baseUrl, css, js, isFromPuppeteer = false) {
  
  if (isFromPuppeteer) {
    // For Puppeteer-rendered pages: PRESERVE HTML STRUCTURE AND SCRIPTS FOR FULL FUNCTIONALITY
    
    // Remove ONLY external stylesheet links (we'll embed them as CSS)
    $('link[rel="stylesheet"]').remove();
    $('link[rel="modulepreload"]').remove();
    $('link[rel*="prefetch"]').remove();
    
    // Remove ONLY tracking/analytics scripts that won't affect functionality
    $('script').each((i, el) => {
      const src = $(el).attr('src') || '';
      const content = $(el).html() || '';
      
      const isTrackingOnly = /google-analytics|gtag\(|facebook\.com.*sdk|segment\.com|amplitude\.com|doubleclick\.net|cloudflare.*insights|static\.cloudflareinsights/.test(src) ||
                             /google-analytics|gtag\(|facebook\.com.*sdk|segment\.com|amplitude\.com/.test(content);
      
      if (isTrackingOnly) {
        $(el).remove();
      }
      // KEEP all other scripts including Next.js chunks, framework code, etc.
    });
    
    let html = $.html();
    
    // Convert all relative script URLs to absolute URLs so they load from original domain
    console.log(`🔗 Converting relative script URLs to absolute...`);
    html = convertRelativeUrlsInAttributes(html, baseUrl);
    
    // Inline only external stylesheets to make it self-contained
    if (css && css.trim().length > 0) {
      const escapedCSS = escapeEmbeddedContent(css);
      html = html.replace(
        '</head>',
        `<style id="inlined-website-styles" type="text/css">
${escapedCSS}
</style>
</head>`
      );
    }
    
    // Inline the JavaScript so it executes (not just external URLs)
    // This is crucial for hamburger menu, countdown, animations to work
    if (js && js.trim().length > 0) {
      console.log(`📝 Embedding ${js.length} bytes of JavaScript...`);
      const escapedJS = escapeEmbeddedContent(js);
      html = html.replace(
        '</body>',
        `<script id="inlined-website-scripts" type="text/javascript">
${escapedJS}
</script>
</body>`
      );
    }
    
    // Rewrite media URLs to absolute paths so images load
    html = rewriteMediaUrls(html, baseUrl);
    
    return html;
  }
  
  // Original logic for non-Puppeteer pages - IMPROVED: preserve structure, only remove tracking
  
  // Remove external stylesheet links (we'll embed them as CSS)
  $('link[rel="stylesheet"]').remove();
  $('link[rel="modulepreload"]').remove();
  $('link[rel*="prefetch"]').remove();
  
  // Remove ONLY tracking/analytics scripts and styles, NOT ALL scripts
  $('script').each((i, el) => {
    const src = $(el).attr('src') || '';
    const content = $(el).html() || '';
    
    const isTrackingOnly = /google-analytics|gtag\(|facebook\.com.*sdk|segment\.com|amplitude\.com|doubleclick\.net|cloudflare.*insights|static\.cloudflareinsights/.test(src) ||
                           /google-analytics|gtag\(|facebook\.com.*sdk|segment\.com|amplitude\.com/.test(content);
    
    if (isTrackingOnly) {
      $(el).remove();
    }
    // KEEP all other scripts for functionality (even if duplicate effort with extracted JS)
  });
  
  // Remove tracking-related styles and tags
  $('style').each((i, el) => {
    const content = $(el).html() || '';
    const isTrackingStyle = /google|facebook|analytics|ads|tracking/i.test(content);
    if (isTrackingStyle) {
      $(el).remove();
    }
    // KEEP other styles as fallback
  });
  
  $('noscript').remove();
  $('meta[http-equiv]').remove();
  $('[data-google-analytics]').remove();
  $('[data-fbq]').remove();
  $('[data-ad-client]').remove();
  $('[data-ad-slot]').remove();
  $('iframe').each((i, el) => {
    const src = $(el).attr('src') || '';
    const isTracking = /google|facebook|analytics|ads|tracking|doubleclick/i.test(src);
    if (isTracking) {
      $(el).remove();
    }
    // KEEP content iframes (like embeds, videos)
  });
  
  // Get the full HTML (not just body) to preserve all structure
  let html = $.html();
  
  // Convert relative URLs in scripts and links to absolute
  html = convertRelativeUrlsInAttributes(html, baseUrl);
  html = rewriteMediaUrls(html, baseUrl);
  
  // Update the title
  html = html.replace(/<title>([^<]*)<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  
  // Properly escape CSS and JS for embedding
  const escapedCSS = escapeEmbeddedContent(css);
  const escapedJS = escapeEmbeddedContent(js);
  
  // Build script tag only if there's JS to embed
  const scriptTag = js && js.trim().length > 0 ? `
    <script id="cloned-site-scripts" type="text/javascript">
${escapedJS}
    </script>` : '';
  
  // Inline CSS and JS into the extracted HTML
  html = html.replace(
    '</head>',
    `    <style id="cloned-site-styles" type="text/css">
${escapedCSS}
    </style>
</head>`
  );
  
  html = html.replace(
    '</body>',
    `${scriptTag}
</body>`
  );
  
  return html;
}

// Main function to extract HTML, CSS, and JavaScript separately
async function extractWebsiteFiles(url, pureHtml = false) {
  try {
    // Validate and normalize URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    const baseUrl = new URL(url).href;
    let html, title;
    
    // Auto-detect if we need Puppeteer for SPAs
    let usePuppeteer = false;
    
    // Try standard fetch first
    console.log(`🔄 Fetching: ${url}`);
    try {
      const response = await axios.get(url, {
        ...axiosConfig,
        timeout: 20000,
        maxRedirects: 5
      });

      html = response.data;
      
      // Check if it looks like an empty SPA
      if (looksLikeEmptySPA(html)) {
        console.log(`⚠️ Detected SPA (React/Vue/Angular), attempting browser rendering...`);
        usePuppeteer = true;
      }
    } catch (fetchError) {
      console.log(`⚠️ Standard fetch failed, will try Puppeteer...`);
      usePuppeteer = true;
    }

    let capturedAssets = {};
    if (usePuppeteer) {
      console.log(`🤖 Using Puppeteer for JavaScript rendering...`);
      const result = await scrapeWithPuppeteer(url);
      if (result && typeof result === 'object') {
        html = result.html || '';
        title = result.title;
        capturedAssets = result.assets || {};
      } else {
        html = result;
      }
    } else {
      const $ = load(html);
      title = $('title').text() || 'Cloned Website';
    }

    // Parse with Cheerio
    const $ = load(html);

    // For Puppeteer renders: HTML is already complete with all styles and scripts
    // Just clean it up and return as-is, NO need to re-extract and re-embed CSS/JS
    if (usePuppeteer) {
      console.log(`📄 Cleaning Puppeteer-rendered HTML...`);
      
      // Work with HTML as string only - don't use Cheerio which might lose content
      let cleanHTML = html;
      
      // Remove tracking external resource links
      cleanHTML = cleanHTML.replace(/<link[^>]*rel="stylesheet"[^>]*>/gi, '');
      cleanHTML = cleanHTML.replace(/<link[^>]*rel="modulepreload"[^>]*>/gi, '');
      cleanHTML = cleanHTML.replace(/<link[^>]*rel="[^"]*prefetch[^"]*"[^>]*>/gi, '');
      
      // Remove tracking scripts only (google analytics, facebook SDK, etc)
      cleanHTML = cleanHTML.replace(/<script[^>]*(?:src="[^"]*(?:google-analytics|gtag|facebook\.com.*sdk|segment|amplitude|doubleclick|cloudflare)[^"]*|\/\/[^"]*tracking)[^>]*>[\s\S]*?<\/script>/gi, '');
      
      console.log(`📋 HTML size before cleaning: ${cleanHTML.length} bytes`);
      
      // Fix relative URLs to absolute
      cleanHTML = convertRelativeUrlsInAttributes(cleanHTML, baseUrl);
      cleanHTML = rewriteMediaUrls(cleanHTML, baseUrl);
      
      // Sanitize HTML to remove problematic [object Object] patterns
      console.log(`🧹 Sanitizing HTML for problematic patterns...`);
      cleanHTML = sanitizeHtmlForCloning(cleanHTML);

      // Strip Content-Security-Policy meta tags and neutralize service-worker registrations
      cleanHTML = stripCSPAndServiceWorker(cleanHTML);
      
      // Remove React error boundary messages and 404 text
      console.log(`🧹 Removing error messages...`);
      cleanHTML = cleanHTML.replace(/Unexpected Application Error/gi, '');
      cleanHTML = cleanHTML.replace(/404 Not Found/gi, '');
      cleanHTML = cleanHTML.replace(/You can provide a way better UX/gi, '');
      cleanHTML = cleanHTML.replace(/Hey developer/gi, '');
      cleanHTML = cleanHTML.replace(/ErrorBoundary/gi, '');
      cleanHTML = cleanHTML.replace(/when your app throws errors/gi, '');
      cleanHTML = cleanHTML.replace(/errorElement prop on your route/gi, '');
      
      // Remove error container divs
      cleanHTML = cleanHTML.replace(/<div[^>]*class="[^"]*Error[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
      cleanHTML = cleanHTML.replace(/<div[^>]*class="[^"]*error[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
      cleanHTML = cleanHTML.replace(/<section[^>]*class="[^"]*error[^"]*"[^>]*>[\s\S]*?<\/section>/gi, '');
      
      console.log(`📋 HTML size after cleaning: ${cleanHTML.length} bytes`);
      
      // INLINE all images and fonts as base64 for iframe compatibility
      console.log(`📦 Starting asset inlining...`);
      if (cleanHTML.length < 10000000) { // Only inline if not too large
        cleanHTML = await inlineAssetsInHtml(cleanHTML, baseUrl, capturedAssets);
      } else {
        console.log(`⚠️ HTML too large for asset inlining, skipping...`);
      }
      
      console.log(`📋 HTML size after inlining: ${cleanHTML.length} bytes`);
      
      // Inject EARLY fixes BEFORE React and other scripts load
      const earlyFixScript = `<script>
// CRITICAL: Run before any framework initialization
window.__CLONED_SITE__ = true;
window.__ORIGINAL_LOCATION__ = location.href;

// Sanitize URLs to prevent "[object Object]" errors
window.__SANITIZE_URL__ = function(url) {
  if (!url) return '';
  
  // Check for common invalid patterns
  const urlStr = String(url).trim();
  if (urlStr.includes('[object') || 
      urlStr === 'undefined' || 
      urlStr === 'null' || 
      urlStr === 'NaN' ||
      urlStr === '' ||
      urlStr === '[object Object]') {
    return '';
  }
  
  // Reject non-string types
  if (typeof url !== 'string') {
    console.warn('⚠️ Invalid URL type:', typeof url);
    return '';
  }
  
  return urlStr;
};

// Intercept fetch to prevent "[object Object]" errors
const origFetch = window.fetch;
window.fetch = function(resource, init) {
  try {
    // Check for obvious invalid patterns first
    const resourceStr = String(resource || '').trim();
    if (resourceStr.includes('[object') || resourceStr === 'undefined' || resourceStr === 'null') {
      console.warn('🚫 Blocked invalid fetch URL:', resourceStr);
      return Promise.reject(new TypeError('Invalid URL'));
    }
    
    // Validate resource is a valid string or Request object
    if (typeof resource === 'object' && !(resource instanceof Request)) {
      if (resource && !resource.url && !resource.uri) {
        console.warn('🚫 Invalid fetch resource (object without url):', resource);
        return Promise.reject(new TypeError('Invalid URL'));
      }
      resource = resource.url || resource.uri || String(resource);
    }
    
    // Ensure resource is a proper URL string
    const sanitizedResource = window.__SANITIZE_URL__(resource);
    if (!sanitizedResource) {
      console.warn('🚫 Empty/invalid URL in fetch');
      return Promise.reject(new TypeError('Invalid URL'));
    }
    
    return origFetch.call(this, sanitizedResource, init);
  } catch (error) {
    console.error('Fetch error:', error);
    return Promise.reject(error);
  }
};

// Intercept XMLHttpRequest
const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, ...args) {
  try {
    const sanitizedUrl = window.__SANITIZE_URL__(url);
    if (!sanitizedUrl) {
      console.warn('Empty XHR URL');
      return;
    }
    return origOpen.call(this, method, sanitizedUrl, ...args);
  } catch (error) {
    console.error('XHR open error:', error);
  }
};

// Also intercept send to prevent invalid data
const origSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(data) {
  try {
    // Validate data is a valid type (string, blob, formdata, etc)
    if (data && typeof data === 'object' && 
        !(data instanceof Blob) && 
        !(data instanceof FormData) &&
        !(data instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(data)) {
      // If it's a plain object, convert to JSON
      if (data.constructor === Object) {
        data = JSON.stringify(data);
        this.setRequestHeader('Content-Type', 'application/json');
      }
    }
    return origSend.call(this, data);
  } catch (error) {
    console.error('XHR send error:', error);
  }
};

// Suppress error events for invalid resource loads
document.addEventListener('error', (e) => {
  const msg = String(e.message || '');
  if (msg.includes('[object Object]') || msg.includes('[object object]')) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  }
}, true);

// Intercept and suppress load events for invalid resources
window.addEventListener('error', function(e) {
  if (e.target && e.target.src && String(e.target.src).includes('[object')) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
}, true);

// If in iframe srcdoc, fake the location
if (location.href.includes('srcdoc') || location.protocol === 'about:') {
  // Create a fake location object
  const fakeLocation = {
    href: '/',
    protocol: 'http:',
    hostname: 'localhost',
    host: 'localhost:3000',
    pathname: '/',
    search: '',
    hash: '',
    origin: 'http://localhost:3000'
  };
  
  // Replace window.location (read-only, so we use Object.defineProperty)
  try {
    Object.defineProperty(window, 'location', {
      value: fakeLocation,
      writable: true,
      configurable: true
    });
  } catch (e) {
    // Fallback for strict mode
    window.location = fakeLocation;
  }
}

// Patch History API before React Router uses it
const origPushState = History.prototype.pushState;
const origReplaceState = History.prototype.replaceState;

History.prototype.pushState = function(state, title, url) {
  if (window.__CLONED_SITE__) return; // Prevent navigation
  return origPushState.call(this, state, title, url);
};

History.prototype.replaceState = function(state, title, url) {
  if (window.__CLONED_SITE__) return; // Prevent navigation
  return origReplaceState.call(this, state, title, url);
};

// Prevent navigation
window.addEventListener('popstate', (e) => {
  if (window.__CLONED_SITE__) {
    e.preventDefault();
    e.stopPropagation();
  }
});

// Mock Web3/Blockchain APIs to prevent errors
window.ethereum = window.ethereum || {
  isMetaMask: true,
  chainId: '0x1',
  networkVersion: '1',
  selectedAddress: null,
  isConnected: () => false,
  request: async (args) => {
    console.log('🔗 Web3 request intercepted:', args?.method);
    if (args?.method === 'eth_requestAccounts') {
      return [];
    }
    if (args?.method === 'eth_accounts') {
      return [];
    }
    if (args?.method === 'net_version') {
      return '1';
    }
    if (args?.method === 'eth_chainId') {
      return '0x1';
    }
    return null;
  },
  on: () => {},
  off: () => {},
  once: () => {},
  removeListener: () => {},
  removeAllListeners: () => {}
};

// Mock Web3.js if needed
window.web3 = window.web3 || {
  eth: { 
    accounts: [],
    getAccounts: async () => [],
    getCoinbase: async () => null
  },
  currentProvider: window.ethereum
};

// Mock other common Web3 wallets
window.okxwallet = window.okxwallet || window.ethereum;
window.unisat = window.unisat || {
  requestAccount: async () => { throw new Error('Wallet not available in clone'); },
  getAccounts: async () => [],
  signMessage: async () => null
};

// Better localStorage/sessionStorage support for cloned pages
if (typeof Storage !== 'undefined' && !window.__StorageMocked__) {
  window.__StorageMocked__ = true;
  const storageData = new Map();
  
  const createStorage = () => ({
    getItem: (key) => storageData.get(key) || null,
    setItem: (key, value) => storageData.set(key, String(value)),
    removeItem: (key) => storageData.delete(key),
    clear: () => storageData.clear(),
    key: (index) => Array.from(storageData.keys())[index] || null,
    get length() { return storageData.size; }
  });
  
  try {
    Object.defineProperty(window, 'localStorage', {
      value: createStorage(),
      writable: true
    });
    Object.defineProperty(window, 'sessionStorage', {
      value: createStorage(),
      writable: true
    });
  } catch (e) {
    console.log('Note: Could not override storage');
  }
}

// Suppress navigation errors
window.addEventListener('hashchange', (e) => {
  if (window.__CLONED_SITE__) {
    e.preventDefault();
  }
});

// Suppress 404 errors from bad routes
window.addEventListener('error', (e) => {
  if (String(e.message || '').includes('[object Object]') || 
      String(e.message || '').includes('Cannot GET')) {
    e.preventDefault();
  }
}, true);
</script>`;

      // Inject the early script at the very beginning of <head> (UNLESS pureHtml mode)
      if (!pureHtml && cleanHTML.includes('<head')) {
        const headIndex = cleanHTML.indexOf('<head');
        const headEndIndex = cleanHTML.indexOf('>', headIndex) + 1;
        cleanHTML = cleanHTML.slice(0, headEndIndex) + earlyFixScript + cleanHTML.slice(headEndIndex);
      }
      
      // Inject late fixes before closing body
      const lateFixScript = `<script>
(function() {
  console.log('🔧 Applying late fixes for cloned site...');
  
  // Suppress console errors related to navigation
  const origError = console.error;
  const origWarn = console.warn;
  console.error = function() {
    const msg = String(arguments[0] || '');
    if (msg.includes('[object Object]') || msg.includes('Cannot GET') || msg.includes('route')) {
      return; // Suppress noisy errors
    }
    return origError.apply(console, arguments);
  };
  console.warn = function() {
    const msg = String(arguments[0] || '');
    if (msg.includes('[object Object]')) {
      return; // Suppress
    }
    return origWarn.apply(console, arguments);
  };
  
  // Intercept and suppress global error handler that might show errors
  window.onerror = function(msg, url, line, col, error) {
    if (msg && String(msg).includes('[object Object]')) {
      return true; // Prevent default error handling
    }
    return false;
  };
  
  // Intercept unhandled promise rejections
  window.onunhandledrejection = function(event) {
    const reason = String(event.reason || '');
    if (reason.includes('[object Object]') || reason.includes('Cannot GET')) {
      event.preventDefault(); // Suppress the error
    }
  };
  
  // Hide error boundaries showing 404 or navigation errors
  function hideErrors() {
    document.querySelectorAll('[class*="error"], [class*="Error"], [class*="404"], [class*="ErrorBoundary"]').forEach(el => {
      const text = el.textContent || '';
      if (text.includes('No route matches URL') || 
          text.includes('Unexpected Application Error') ||
          text.includes('Cannot GET') ||
          text.includes('[object Object]')) {
        el.style.display = 'none';
        el.remove();
      }
    });
    
    // Also hide any error text/divs
    document.querySelectorAll('*').forEach(el => {
      const text = el.textContent || '';
      if (text.includes('No route matches URL') || 
          text.includes('[object Object]') ||
          text.includes('Cannot GET')) {
        if (el.children.length === 0) { // Only hide leaf nodes
          el.style.display = 'none';
        }
      }
    });
  }
  
  // Initial cleanup
  hideErrors();
  
  // Re-hide periodically as React might re-render
  setInterval(hideErrors, 1000);
  
  // Observe DOM changes and hide errors immediately
  const observer = new MutationObserver(hideErrors);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true
  });
  
  console.log('✅ Late fixes applied');
})();
</script>`;
      
      // Inject the late script before closing </body> (UNLESS pureHtml mode)
      if (!pureHtml) {
        if (cleanHTML.includes('</body>')) {
          cleanHTML = cleanHTML.replace('</body>', lateFixScript + '</body>');
        } else {
          cleanHTML = cleanHTML + lateFixScript;
        }
      }
      
      // Extract JavaScript from HTML BEFORE removing script tags
      console.log(`⚙️ Extracting JavaScript from Puppeteer-rendered HTML...`);
      let extractedJS = await extractScriptsFromHTML(cleanHTML, baseUrl);
      // Sanitize extracted JS (remove service worker registrations, importScripts, etc.)
      extractedJS = sanitizeExtractedJS(extractedJS);
      
      // Extract CSS from all <style> tags in the rendered HTML
      console.log(`🎨 Extracting CSS from Puppeteer-rendered HTML...`);
      const cssArray = [];
      const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
      let styleMatch;
      let totalCSSSize = 0;
      while ((styleMatch = styleRegex.exec(cleanHTML)) !== null) {
        const css = styleMatch[1];
        if (css && css.trim().length > 0) {
          cssArray.push(css);
          totalCSSSize += css.length;
        }
      }
      const extractedCSS = cssArray.length > 0 ? cssArray.join('\n\n/* ===== STYLE SEPARATOR ===== */\n\n') : '';
      console.log(`📊 Extracted ${cssArray.length} style blocks, total: ${totalCSSSize} bytes`);
      
      // Remove all script tags from HTML (since we're returning JS separately)
      console.log(`🧹 Removing script and style tags from HTML...`);
      let htmlWithoutScriptsAndStyles = removeScriptTagsFromHTML(cleanHTML);
      htmlWithoutScriptsAndStyles = removeStyleTagsFromHTML(htmlWithoutScriptsAndStyles);
      
      console.log(`✅ Puppeteer extraction complete`);
      
      return {
        success: true,
        html: htmlWithoutScriptsAndStyles,
        css: extractedCSS, // Return extracted CSS for proper reconstruction
        js: extractedJS,   // Return extracted JS
        assets: [],
        title: title,
        method: 'puppeteer-static'
      };
    }

    // For static HTML (non-Puppeteer): Extract CSS and JS to embed separately
    // Extract CSS and JS FIRST (before cleaning HTML which removes the links)
    console.log(`🎨 Extracting CSS...`);
    const css = await extractAllCSS($, baseUrl);

    console.log(`⚙️ Extracting JavaScript...`);
    let js = await extractAllJS($, baseUrl);
    // Sanitize extracted JS for service worker registrations and imports
    js = sanitizeExtractedJS(js);

    // If we found no CSS but there are scripts, it's likely styles are injected at runtime.
    // In that case, fall back to Puppeteer to capture rendered styles and assets.
    const inlineCssEmpty = !css || css.trim().length < 100;
    const scriptCount = ($('script').length || 0);
    const looksLikeRootApp = /<div[^>]*(id|class)=["'](?:root|app|__next|gatsby-root)["']/i.test(html) || (html && html.length < 5000);
    if (inlineCssEmpty) {
      console.log('⚠️ No CSS discovered via static fetch but scripts present — falling back to Puppeteer for runtime rendering');
      const result = await scrapeWithPuppeteer(url);
      if (result && typeof result === 'object') {
        let cleanHTML = result.html || '';
        const captured = result.assets || {};
        title = result.title || title;

        // Post-process similarly to the Puppeteer branch
        cleanHTML = convertRelativeUrlsInAttributes(cleanHTML, baseUrl);
        cleanHTML = rewriteMediaUrls(cleanHTML, baseUrl);
        cleanHTML = sanitizeHtmlForCloning(cleanHTML);
        cleanHTML = stripCSPAndServiceWorker(cleanHTML);

        // Remove common error messages
        cleanHTML = cleanHTML.replace(/Unexpected Application Error/gi, '');
        cleanHTML = cleanHTML.replace(/404 Not Found/gi, '');
        cleanHTML = cleanHTML.replace(/You can provide a way better UX/gi, '');
        cleanHTML = cleanHTML.replace(/Hey developer/gi, '');
        cleanHTML = cleanHTML.replace(/ErrorBoundary/gi, '');

        // Inline assets using captured map
        if (cleanHTML.length < 10000000) {
          cleanHTML = await inlineAssetsInHtml(cleanHTML, baseUrl, captured);
        }

        // Extract JS and CSS from the rendered HTML
        const extractedJS = await extractScriptsFromHTML(cleanHTML, baseUrl);
        const cssArray = [];
        const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
        let styleMatch;
        while ((styleMatch = styleRegex.exec(cleanHTML)) !== null) {
          const c = styleMatch[1];
          if (c && c.trim().length > 0) cssArray.push(c);
        }
        const extractedCSS = cssArray.length > 0 ? cssArray.join('\n\n/* ===== STYLE SEPARATOR ===== */\n\n') : '';

        // Remove script/style tags from HTML for returned clean HTML
        let htmlWithoutScriptsAndStyles = removeScriptTagsFromHTML(cleanHTML);
        htmlWithoutScriptsAndStyles = removeStyleTagsFromHTML(htmlWithoutScriptsAndStyles);

        return {
          success: true,
          html: htmlWithoutScriptsAndStyles,
          css: extractedCSS,
          js: sanitizeExtractedJS(extractedJS),
          assets: [],
          title: title,
          method: 'puppeteer-static'
        };
      }
    }

    console.log(`🖼️ Extracting assets (images, videos, fonts)...`);
    const assets = await extractAllAssets($, baseUrl);

    // Now extract clean HTML (after we've grabbed the resource links)
    console.log(`📄 Extracting clean HTML...`);
    const cleanHTML2 = extractCleanHTML($, title, baseUrl, css, js, false);

    console.log(`✅ Extraction complete (static HTML with CSS+JS)`);

    return {
      success: true,
      html: cleanHTML2,
      css: css,
      js: js,
      assets: assets,
      title: title,
      method: 'axios'
    };
  } catch (error) {
    console.error('❌ Error:', error.message);
    return {
      success: false,
      error: error.message || 'Failed to fetch website',
      details: error.toString()
    };
  }
}

// API endpoint to clone website
app.post('/api/clone', async (req, res) => {
  try {
    const { url, includeHelpers } = req.body;  // Changed default to pure HTML

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log(`\n🌐 Clone Request: ${url}${includeHelpers ? ' (WITH helper scripts)' : ' (PURE HTML)'}`);
    const result = await extractWebsiteFiles(url, !includeHelpers);  // Invert the logic

    if (result.success) {
      console.log(`✅ Success (${result.method}): ${result.title}\n`);
    } else {
      console.log(`❌ Failed: ${result.error}\n`);
    }

    res.json(result);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      details: error.message
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Website Cloner API is running' });
});

// Favicon endpoint - prevent 404 errors
app.get('/favicon.ico', (req, res) => {
  res.status(204).send(); // No content
});

// Fallback to index.html
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Handle 404 for any other GET requests silently
app.get('*', (req, res) => {
  // If it looks like a resource request, return 204 (no content) instead of 404
  if (req.path.includes('.') || req.path.match(/\.(js|css|png|jpg|gif|svg|woff|woff2|ttf|eot|map)$/i)) {
    res.status(204).send();
  } else {
    res.sendFile(join(__dirname, 'public', 'index.html'));
  }
});

const server = app.listen(PORT, () => {
  console.log(`\n🚀 Website Cloner running at http://localhost:${PORT}`);
  console.log(`📍 Open your browser and navigate to http://localhost:${PORT}\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await closeBrowser();
  server.close(() => {
    console.log('Server stopped');
    process.exit(0);
  });
});
