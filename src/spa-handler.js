import axios from 'axios';

/**
 * Advanced SPA/JavaScript Detection and Rendering
 * Uses ScrapingBee or Bright Data for JavaScript rendering
 */

// Using ScrapingBee API (free tier available, no credit card needed for testing)
// Alternative: Use BrightData or Puppeteer if you have resources

const SCRAPING_BEE_API = 'https://api.scrapingbee.com/api/v1/store/html';

// Check if content is likely a JavaScript-rendered SPA
export function isSPA(html) {
  // Indicators that a page is a SPA:
  // 1. Lots of modulepreload links (Vue/React/Next.js)
  // 2. Empty body with just script tags
  // 3. Minimal HTML content
  // 4. Framework detection scripts

  const indicators = {
    modulepreload: (html.match(/rel="modulepreload"/g) || []).length > 5,
    frameworkScripts: /react|vue|angular|Next\.js|_nuxt/.test(html),
    templateTags: (html.match(/<template/g) || []).length > 0,
    emptyBody: html.match(/<body[^>]*>\s*<\/body>/i),
    dataReact: /data-react-root|data-reactroot/.test(html),
  };

  // Count indicators
  const count = Object.values(indicators).filter(Boolean).length;
  return count >= 2; // If 2+ indicators, treat as SPA
}

/**
 * Fetch JavaScript-rendered content using browser rendering APIs
 * Fallback methods in order:
 * 1. ScrapingBee (easiest, free)
 * 2. Simple retry with longer timeout
 * 3. Return original HTML if all else fails
 */
export async function scrapeJavaScriptRenderedPage(url) {
  try {
    console.log(`🔍 Detecting SPA - attempting to render JavaScript...`);

    // Method 1: Try ScrapingBee API (free tier)
    try {
      const response = await axios.get(SCRAPING_BEE_API, {
        params: {
          url: url,
          api_key: 'public', // Free tier
          render_javascript: 'true',
          wait_for: 'body',
        },
        timeout: 30000,
      });

      if (response.data && response.data.trim().length > 500) {
        console.log(`✅ Successfully rendered with ScrapingBee`);
        return response.data;
      }
    } catch (error) {
      console.log(`⚠️ ScrapingBee unavailable, trying alternative...`);
    }

    // Method 2: ScrapingAPI or similar service
    try {
      const response = await axios.get('https://api.apify.com/v2/browser-crawler', {
        params: {
          url: url,
          outputFormat: 'html',
        },
        timeout: 30000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (response.data && response.data.trim().length > 500) {
        console.log(`✅ Successfully rendered with backup service`);
        return response.data;
      }
    } catch (error) {
      console.log(`⚠️ Backup service unavailable`);
    }

    // Method 3: Return null to fall back to standard fetch
    console.log(
      `⚠️ Could not render JavaScript content - will use standard HTML`
    );
    return null;
  } catch (error) {
    console.error(`Error in SPA rendering:`, error.message);
    return null;
  }
}

/**
 * For local development, you can use Puppeteer if installed
 * Uncomment below and run: npm install puppeteer
 */

// import puppeteer from 'puppeteer';
//
// export async function scrapeWithPuppeteer(url) {
//   let browser;
//   try {
//     console.log(`🎭 Launching Puppeteer for JavaScript rendering...`);
//     browser = await puppeteer.launch({
//       headless: 'new',
//       args: ['--no-sandbox', '--disable-setuid-sandbox'],
//     });
//
//     const page = await browser.newPage();
//     await page.setUserAgent(
//       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
//     );
//
//     await page.goto(url, {
//       waitUntil: 'networkidle2',
//       timeout: 30000,
//     });
//
//     // Wait for common frameworks to finish rendering
//     await page.waitForTimeout(2000);
//
//     const html = await page.content();
//     console.log(`✅ Successfully rendered with Puppeteer`);
//
//     return html;
//   } catch (error) {
//     console.error(`Puppeteer error:`, error.message);
//     return null;
//   } finally {
//     if (browser) await browser.close();
//   }
// }
