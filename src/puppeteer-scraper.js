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

    // Get the fully rendered HTML with all stylesheets inlined
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
      
      // Return the complete HTML
      return document.documentElement.outerHTML;
    });

    await page.close();

    // Ensure DOCTYPE is included
    const doctype = '<!DOCTYPE html>';
    const finalHtml = htmlWithInlinedStyles.toLowerCase().startsWith('<!doctype') 
      ? htmlWithInlinedStyles 
      : doctype + htmlWithInlinedStyles;

    console.log(`✅ Puppeteer rendering complete with inlined styles`);
    return finalHtml;
  } catch (error) {
    console.log(`⚠️ Puppeteer failed: ${error.message}`);
    return null;
  }
}

// Render with cloud service (Browserless)
async function renderWithBrowserless(url) {
  try {
    console.log(`☁️ Trying Browserless cloud browser...`);
    
    const apiKey = process.env.BROWSERLESS_API_KEY || 'demo';
    
    const payload = {
      url: url,
      rejectResourceTypes: ['image', 'stylesheet', 'font', 'media'],
      waitFor: 5000,
      scrollPage: false,
    };

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
    console.log(`⚠️ Browserless unavailable: ${error.message}`);
    return null;
  }
}

// Render with alternative cloud service (ScrapingBee)
async function renderWithScrapingBee(url) {
  try {
    console.log(`☁️ Trying ScrapingBee...`);
    
    const params = new URLSearchParams({
      url: url,
      api_key: 'public',
      render_javascript: 'true',
    });

    const response = await axios.get(
      `https://api.scrapingbee.com/api/v1/store/html?${params}`,
      { timeout: 30000 }
    );

    if (response.data && response.data.trim().length > 500) {
      console.log(`✅ ScrapingBee rendering successful`);
      return response.data;
    }
    return null;
  } catch (error) {
    console.log(`⚠️ ScrapingBee unavailable: ${error.message}`);
    return null;
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

    // Strategy 1: Try local Puppeteer
    if (puppeteerModule) {
      html = await renderWithLocalPuppeteer(url);
      if (html) method = 'local-puppeteer';
    }

    // Strategy 2: Try Browserless cloud
    if (!html) {
      html = await renderWithBrowserless(url);
      if (html) method = 'browserless';
    }

    // Strategy 3: Try ScrapingBee
    if (!html) {
      html = await renderWithScrapingBee(url);
      if (html) method = 'scrapingbee';
    }

    if (!html) {
      throw new Error('All rendering methods failed');
    }

    return {
      html,
      title: extractTitle(html),
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
