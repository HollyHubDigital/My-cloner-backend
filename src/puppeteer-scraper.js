/**
 * Browser-based rendering for JavaScript-heavy SPA websites
 * Multiple fallback strategies for rendering
 */

import axios from 'axios';

// Try to use local Puppeteer if available, otherwise use cloud services
let puppeteerAvailable = false;
let browser = null;

// Check if Puppeteer is available
async function checkPuppeteer() {
  try {
    const puppeteer = (await import('puppeteer')).default;
    console.log('✅ Puppeteer available - will use for SPA rendering');
    puppeteerAvailable = true;
    return puppeteer;
  } catch (e) {
    console.log('ℹ️ Puppeteer not installed - will use cloud services');
    return null;
  }
}

let puppeteerModule = null;
checkPuppeteer().then(p => puppeteerModule = p);

// Detect if content looks like an empty SPA
export function detectSPA(html) {
  if (!html) return false;

  const indicators = {
    modulepreload: (html.match(/rel="modulepreload"/g) || []).length > 5,
    frameworkScripts: /(?:react|vue|angular|next\.js|nuxt|svelte|gatsby)/i.test(html),
    templateTags: (html.match(/<template/g) || []).length > 2,
    dataReactRoot: /data-react-root|data-reactroot|__next|#app|#root/i.test(html),
  };

  const count = Object.values(indicators).filter(Boolean).length;
  return count >= 2;
}

// Render with local Puppeteer (Clean approach - preserve rendered structure)
async function renderWithLocalPuppeteer(url) {
  if (!puppeteerModule) return null;

  try {
    console.log(`🎭 Rendering with local Puppeteer...`);

    if (!browser) {
      browser = await puppeteerModule.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
    }

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    // Inject script to prevent React Router errors before page even loads
    // This runs BEFORE any framework scripts load, which is critical
    await page.evaluateOnNewDocument(() => {
      window.__CLONED_SITE__ = true;
      window.__DISABLE_ERROR_DISPLAY = true;
      
      // Intercept console errors to prevent React error boundary activation
      window.__reactInternalHandler = { captureException: () => {} };
      
      // Patch History API BEFORE anything else runs
      const origPushState = History.prototype.pushState;
      const origReplaceState = History.prototype.replaceState;
      
      History.prototype.pushState = function(state, title, url) {
        // Log but don't execute navigation in cloned context
        return null;
      };
      
      History.prototype.replaceState = function(state, title, url) {
        // Log but don't execute navigation in cloned context
        return null;
      };
      
      // Intercept popstate to prevent unwanted navigation
      window.addEventListener('popstate', (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, true);
      
      // Override these early
      window.addEventListener('hashchange', (e) => {
        e.preventDefault();
      });
    });
    
    await page.setViewport({ width: 1920, height: 1080 });

    // Capture network responses (images, fonts, stylesheets, scripts, XHR) for inlining later
    const captured = new Map();
    page.on('response', async (response) => {
      try {
        const status = response.status();
        if (status < 200 || status >= 300) return;

        const urlResp = response.url();
        // Prefer header-driven detection in case resourceType is misleading
        const headers = (response.headers && typeof response.headers === 'function') ? response.headers() : (response.headers ? response.headers : {});
        const contentType = headers['content-type'] || headers['Content-Type'] || '';

        // Only capture likely useful asset types
        const shouldCaptureByType = /(^|\b)(image\/|text\/css|font\/|application\/(?:javascript|x-javascript)|text\/javascript|application\/svg\+xml|application\/octet-stream)/i.test(contentType);

        // Also allow capture for known resource types
        const req = response.request();
        const rtype = req && typeof req.resourceType === 'function' ? req.resourceType() : (req && req.resourceType) || '';
        const shouldCaptureByResource = ['image', 'font', 'stylesheet', 'script', 'xhr', 'fetch', 'document'].includes(rtype);

        if (!shouldCaptureByType && !shouldCaptureByResource) return;

        // Avoid extremely large assets
        const buffer = await response.buffer();
        if (!buffer || buffer.length === 0) return;
        const MAX_CAPTURE_BYTES = 1024 * 1024 * 3; // 3MB
        if (buffer.length > MAX_CAPTURE_BYTES) return; // skip huge assets

        const base64 = buffer.toString('base64');
        const mime = contentType ? contentType.split(';')[0].trim() : '';
        const dataUrl = mime ? `data:${mime};base64,${base64}` : `data:application/octet-stream;base64,${base64}`;

        // Normalize keys: full URL, protocol-less, and without query string
        try {
          const u = new URL(urlResp);
          const withoutQuery = u.origin + u.pathname;
          captured.set(urlResp, dataUrl);
          captured.set(withoutQuery, dataUrl);
          captured.set(urlResp.replace(/^https?:/, ''), dataUrl);
        } catch (e) {
          // fallback: store raw
          captured.set(urlResp, dataUrl);
        }
      } catch (e) {
        // ignore per-response failures
      }
    });

    console.log(`⏳ Navigating to ${url}...`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    console.log(`📜 Waiting for framework to render...`);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Wait for React/Vue/Angular to finish rendering
    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (typeof window !== 'undefined') {
          // Wait up to 5 seconds for no DOM mutations
          let mutationTimeout;
          const observer = new MutationObserver(() => {
            clearTimeout(mutationTimeout);
            mutationTimeout = setTimeout(() => {
              observer.disconnect();
              resolve();
            }, 1000);
          });
          
          observer.observe(document.body, { 
            subtree: true, 
            childList: true,
            attributes: true,
            characterData: true
          });
          
          // Fallback timeout
          setTimeout(() => {
            observer.disconnect();
            resolve();
          }, 5000);
        } else {
          resolve();
        }
      });
    });

    console.log(`📜 Extra wait for lazy loading...`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Remove modal overlays and error boundaries
    console.log(`🧹 Cleaning up error overlays only...`);
    await page.evaluate(() => {
      // ONLY remove error-related overlays and error boundaries
      // DO NOT remove modals, dialogs, menus - these are UI functionality
      
      // Remove React error boundaries specifically
      document.querySelectorAll('[class*="ErrorBoundary"], [data-testid*="error"]').forEach(el => {
        const text = el.textContent || '';
        if (text.includes('Unexpected Application Error') || 
            text.includes('route matches URL') ||
            text.includes('Cannot GET')) {
          el.remove();
        }
      });
      
      // Remove loading spinners and skeleton screens (not UI elements)
      document.querySelectorAll('[class*="loading-overlay"], [class*="skeleton"], [class*="spinner-overlay"]').forEach(el => {
        el.remove();
      });
      
      // Remove 404 error pages ONLY if they're the main content
      document.querySelectorAll('[class*="error-page"], [class*="not-found-page"]').forEach(el => {
        const text = el.textContent || '';
        if (text.includes('404') && el.children.length > 5) {
          el.remove();
        }
      });
      
      // Preserve ALL modals, dialogs, menus, buttons, toggles
      // These are essential UI functionality
      // DO NOT remove: [class*="modal"], [class*="dialog"], [class*="menu"], [class*="dropdown"], [class*="toggle"]
      
      // Unlock body scrolling for cloned view
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
    });

    console.log(`📜 Scrolling to load lazy content...`);
    // Scroll to trigger lazy loading
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 500;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 100);
      });
    });

    console.log(`⏳ Waiting for lazy content to render...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Wait for any remaining network activity to settle
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
    } catch (e) {
      // Ignore timeout
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get the fully rendered HTML with all stylesheets inlined and shadow DOM serialized
    console.log(`📄 Extracting fully rendered HTML with stylesheet inlining...`);

    // Inject CSS inlining logic - extract stylesheets that are already loaded
    const htmlWithInlinedStyles = await page.evaluate(() => {
      let allCssContent = '';
      
      // Collect CSS from all <style> tags
      document.querySelectorAll('style').forEach((styleTag) => {
        allCssContent += '\n' + styleTag.textContent;
      });
      
      // Collect CSS rules from all loaded stylesheets via document.styleSheets
      try {
        for (let i = 0; i < document.styleSheets.length; i++) {
          try {
            const sheet = document.styleSheets[i];
            const href = sheet.href || '';
            let sheetCss = '';
            
            // Try to read the stylesheet rules
            try {
              if (sheet.cssRules) {
                for (let j = 0; j < sheet.cssRules.length; j++) {
                  const rule = sheet.cssRules[j];
                  if (rule.cssText) {
                    sheetCss += rule.cssText + '\n';
                  }
                }
              }
            } catch (e) {
              // CORS or other security issue - skip this stylesheet
            }
            
            if (sheetCss) {
              allCssContent += '\n/* From: ' + href + ' */\n' + sheetCss;
            }
          } catch (e) {
            // Skip sheets we can't read
          }
        }
      } catch (e) {
        // Fallback if document.styleSheets not accessible
      }
      
      // Remove all <link rel="stylesheet"> tags
      document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
        link.remove();
      });
      
      // Create a comprehensive <style> tag with all CSS at top of <head>
      if (allCssContent.trim().length > 0) {
        const styleTag = document.createElement('style');
        styleTag.setAttribute('data-origin', 'inlined-stylesheets');
        styleTag.textContent = allCssContent;
        
        // Insert at very beginning of head
        if (document.head) {
          document.head.insertBefore(styleTag, document.head.firstChild);
        } else {
          document.documentElement.insertBefore(styleTag, document.documentElement.firstChild);
        }
      }
      
      // Serialize Shadow DOM content by appending a hidden container with the shadowHTML
      try {
        const hosts = [];
        const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
        let node = walker.currentNode;
        while (node) {
          try {
            if (node.shadowRoot) {
              // Append a hidden container so serialization includes shadow DOM content
              const container = document.createElement('div');
              container.setAttribute('data-cloned-shadowroot-for', node.tagName.toLowerCase());
              container.style.display = 'none';
              container.innerHTML = node.shadowRoot.innerHTML || '';
              node.appendChild(container);
            }
          } catch (e) {
            // ignore
          }
          node = walker.nextNode();
        }
      } catch (e) {
        // ignore
      }

      // Return the complete HTML
      return document.documentElement.outerHTML;
    });

    // Extract captured assets into a plain object
    const assetsObj = {};
    for (const [k, v] of captured.entries()) assetsObj[k] = v;

    // Attempt to inline external SVG sprite files referenced via <use> by injecting their markup
    try {
      // Find external <use> references like <use xlink:href="/icons.svg#icon"> in the HTML
      const useHrefRegex = /<use[^>]+(?:xlink:href|href)=["']([^"']+)["'][^>]*>/gi;
      const spriteBases = new Set();
      let m;
      while ((m = useHrefRegex.exec(htmlWithInlinedStyles)) !== null) {
        const ref = m[1];
        if (!ref) continue;
        const hashIdx = ref.indexOf('#');
        if (hashIdx > 0) {
          const base = ref.substring(0, hashIdx);
          // resolve relative URLs by using the page URL
          try {
            const resolved = new URL(base, url).href;
            spriteBases.add(resolved);
          } catch (e) {
            spriteBases.add(base);
          }
        }
      }

      if (spriteBases.size > 0) {
        let injectedSprites = '';
        for (const base of spriteBases) {
          const dataUrl = assetsObj[base] || assetsObj[base.replace(/^https?:/, '')];
          if (!dataUrl) continue;
          // Only handle SVG content
          if (/^data:(?:image|text)\/svg\+xml;base64,/.test(dataUrl)) {
            const b64 = dataUrl.split(',')[1];
            try {
              const svgText = Buffer.from(b64, 'base64').toString('utf8');
              injectedSprites += '\n' + svgText + '\n';
            } catch (e) {
              // ignore decode errors
            }
          }
        }

        if (injectedSprites) {
          // Inject the collected sprites into a hidden container at the start of <body>
          const headIdx = htmlWithInlinedStyles.indexOf('<body');
          const insertPos = headIdx >= 0 ? htmlWithInlinedStyles.indexOf('>', headIdx) + 1 : htmlWithInlinedStyles.indexOf('>') + 1;
          if (insertPos > 0) {
            const spriteContainer = `<div id="__inlined_svg_sprites" style="display:none">${injectedSprites}</div>`;
            htmlWithInlinedStyles = htmlWithInlinedStyles.slice(0, insertPos) + spriteContainer + htmlWithInlinedStyles.slice(insertPos);
          } else {
            htmlWithInlinedStyles = `<div id="__inlined_svg_sprites" style="display:none">${injectedSprites}</div>` + htmlWithInlinedStyles;
          }
        }
      }
    } catch (e) {
      // ignore sprite injection errors
    }

    await page.close();

    // Ensure DOCTYPE is included
    const doctype = '<!DOCTYPE html>';
    const finalHtml = htmlWithInlinedStyles.toLowerCase().startsWith('<!doctype')
      ? htmlWithInlinedStyles
      : doctype + htmlWithInlinedStyles;

    console.log(`✅ Puppeteer rendering complete with inlined styles (captured ${Object.keys(assetsObj).length} assets)`);
    return { html: finalHtml, assets: assetsObj };
  } catch (error) {
    console.log(`⚠️ Puppeteer failed: ${error.message}`);
    return { error: error.message || String(error) };
  }
}

// Render with cloud service (Browserless)
async function renderWithBrowserless(url) {
  try {
    console.log(`☁️ Trying Browserless cloud browser...`);
    
    const apiKey = process.env.BROWSERLESS_API_KEY || 'demo';
    const keyDisplay = apiKey === 'demo' ? 'demo (limited)' : apiKey.substring(0, 10) + '...';
    console.log(`   Using key: ${keyDisplay}`);
    
    const payload = {
      url: url,
      rejectResourceTypes: ['image', 'stylesheet', 'font', 'media'],
      waitFor: 5000,
      scrollPage: false,
    };

    console.log(`   Sending request...`);
    
    const response = await axios.post(
      `https://chrome.browserless.io/content?token=${apiKey}`,
      payload,
      {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    console.log(`✅ Browserless rendering successful`);
    return response.data;
  } catch (error) {
    console.error(`⚠️ Browserless FAILED: ${error.message}`);
    if (error.response?.status) {
      console.error(`   HTTP ${error.response.status}`);
      const respData = error.response?.data;
      if (typeof respData === 'string') {
        console.error(`   Response: ${respData.substring(0, 500)}`);
      } else if (respData) {
        console.error(`   Response:`, JSON.stringify(respData).substring(0, 500));
      }
    } else {
      console.error(`   Error details:`, error.code, error.errno);
    }
    const respData = error.response?.data;
    const snippet = typeof respData === 'string' ? respData.substring(0, 1000) : respData ? JSON.stringify(respData).substring(0, 1000) : null;
    return { error: error.message || String(error), status: error.response?.status, responseSnippet: snippet };
  }
}

// Render with alternative cloud service (ScrapingBee)
async function renderWithScrapingBee(url) {
  try {
    console.log(`☁️ Trying ScrapingBee...`);
    
    const apiKey = process.env.SCRAPINGBEE_API_KEY || 'public';
    console.log(`   Using key: ${apiKey.substring(0, 10)}...`);
    
    const params = new URLSearchParams({
      url: url,
      api_key: apiKey,
      render_javascript: 'true',
    });

    console.log(`   Request URL: https://api.scrapingbee.com/api/v1/store/html?url=...`);
    
    const response = await axios.get(
      `https://api.scrapingbee.com/api/v1/store/html?${params}`,
      { timeout: 30000 }
    );

    if (response.data && response.data.trim().length > 500) {
      console.log(`✅ ScrapingBee rendering successful (${response.data.length} bytes)`);
      return response.data;
    }
    console.log(`⚠️ ScrapingBee returned too little data: ${response.data?.length || 0} bytes`);
    return null;
  } catch (error) {
    console.error(`⚠️ ScrapingBee FAILED: ${error.message}`);
    if (error.response?.status) {
      console.error(`   HTTP ${error.response.status}`);
      const respData = error.response?.data;
      if (typeof respData === 'string') {
        console.error(`   Response: ${respData.substring(0, 500)}`);
      } else if (respData) {
        console.error(`   Response:`, JSON.stringify(respData).substring(0, 500));
      }
    } else {
      console.error(`   Error details:`, error.code, error.errno);
    }
    const respData = error.response?.data;
    const snippet = typeof respData === 'string' ? respData.substring(0, 1000) : respData ? JSON.stringify(respData).substring(0, 1000) : null;
    return { error: error.message || String(error), status: error.response?.status, responseSnippet: snippet };
  }
}

// Extract title from HTML
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : 'Cloned Website';
}

// Main scraping function with multiple fallbacks
export async function scrapeWithPuppeteer(url) {
  try {
    let html = null;
    let method = 'unknown';
    let assets = {};

    // Collect per-strategy error details for debugging
    let localError = null;
    let browserlessError = null;
    let scrapingBeeError = null;

    // Strategy 1: Try local Puppeteer
    if (puppeteerModule) {
      const result = await renderWithLocalPuppeteer(url);
      if (result) {
        if (typeof result === 'object' && result.html) {
          html = result.html;
          assets = result.assets || {};
          method = 'local-puppeteer';
        } else if (typeof result === 'object' && result.error) {
          localError = result.error;
        } else if (typeof result === 'string') {
          html = result;
          method = 'local-puppeteer';
        }
      }
    }

    // Strategy 2: Try Browserless cloud
    if (!html) {
      const bres = await renderWithBrowserless(url);
      if (bres) {
        if (typeof bres === 'object' && bres.html) {
          html = bres.html;
          method = 'browserless';
        } else if (typeof bres === 'string') {
          html = bres;
          method = 'browserless';
        } else if (typeof bres === 'object' && bres.error) {
          browserlessError = `${bres.error}` + (bres.status ? ` (HTTP ${bres.status})` : '');
          if (bres.responseSnippet) browserlessError += ` -- ${bres.responseSnippet.substring(0,300)}`;
        }
      }
    }

    // Strategy 3: Try ScrapingBee
    if (!html) {
      const sres = await renderWithScrapingBee(url);
      if (sres) {
        if (typeof sres === 'object' && sres.html) {
          html = sres.html;
          method = 'scrapingbee';
        } else if (typeof sres === 'string') {
          html = sres;
          method = 'scrapingbee';
        } else if (typeof sres === 'object' && sres.error) {
          scrapingBeeError = `${sres.error}` + (sres.status ? ` (HTTP ${sres.status})` : '');
          if (sres.responseSnippet) scrapingBeeError += ` -- ${sres.responseSnippet.substring(0,300)}`;
        }
      }
    }

    if (!html) {
      const browserlessKey = process.env.BROWSERLESS_API_KEY || 'demo';
      const scrapingbeeKey = process.env.SCRAPINGBEE_API_KEY || 'public';
      
      const errorDetails = [
        '❌ ALL RENDERING METHODS FAILED',
        `Strategy 1 (Local Puppeteer): ${puppeteerModule ? 'Available but failed' : 'Not available'}`,
        localError ? `  - Local error: ${localError.substring(0,400)}` : null,
        `Strategy 2 (Browserless): Using key '${browserlessKey}'`,
        browserlessError ? `  - Browserless error: ${browserlessError.substring(0,400)}` : null,
        `Strategy 3 (ScrapingBee): Using key '${scrapingbeeKey}'`,
        scrapingBeeError ? `  - ScrapingBee error: ${scrapingBeeError.substring(0,400)}` : null,
        '',
        'SOLUTION: Add API keys to Vercel environment variables:',
        '- BROWSERLESS_API_KEY (get free at browserless.io)',
        '- SCRAPINGBEE_API_KEY (get free at scrapingbee.com)'
      ].filter(Boolean).join('\n');

      console.error(errorDetails);
      throw new Error(`All rendering methods failed. ${errorDetails}`);
    }

    return {
      html,
      assets,
      title: extractTitle(typeof html === 'string' ? html : (html.html || '')),
      method,
    };
  } catch (error) {
    console.error(`❌ Rendering error: ${error.message}`);
    throw error;
  }
}

// Graceful browser shutdown
export async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
      browser = null;
      console.log('✅ Browser closed');
    } catch (error) {
      console.error('Error closing browser:', error);
    }
  }
}
