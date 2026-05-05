import axios from 'axios';
import { load } from 'cheerio';
import { JSDOM } from 'jsdom';
import { URL } from 'url';

export async function scrapeWebsite(pageUrl) {
  try {
    // Fetch the webpage with extended timeout
    const response = await axios.get(pageUrl, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      maxRedirects: 5
    });

    const html = response.data;
    const $ = load(html);
    const baseUrl = new URL(pageUrl);

    // Extract all CSS content
    let styles = '';
    
    // Get inline styles
    $('style').each((i, el) => {
      const styleContent = $(el).html();
      if (styleContent && styleContent.trim().length > 0) {
        styles += styleContent + '\n\n';
      }
    });

    // Get external stylesheets content with retry logic
    const styleLinks = [];
    const externalStyles = [];
    
    $('link[rel="stylesheet"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) {
        styleLinks.push(href);
      }
    });

    // Fetch each external stylesheet
    console.log(`📥 Fetching ${styleLinks.length} external stylesheets...`);
    for (const link of styleLinks) {
      try {
        const fullUrl = resolveUrl(link, baseUrl.href);
        const cssResponse = await axios.get(fullUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        if (cssResponse.data) {
          externalStyles.push(cssResponse.data);
          console.log(`✅ Fetched CSS: ${link.substring(0, 50)}...`);
        }
      } catch (err) {
        console.log(`⚠️ Failed to fetch CSS ${link}: ${err.message}`);
      }
    }

    // Combine all styles
    if (externalStyles.length > 0) {
      styles += '/* External Stylesheets */\n' + externalStyles.join('\n\n') + '\n\n';
    }

    // Extract assets more comprehensively
    const assets = {
      images: [],
      fonts: [],
      scripts: [],
      stylesheets: styleLinks
    };

    // Collect images (including srcset)
    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        assets.images.push({
          src: resolveUrl(src, baseUrl.href),
          alt: $(el).attr('alt') || ''
        });
      }
    });

    // Collect picture sources
    $('picture source').each((i, el) => {
      const srcset = $(el).attr('srcset');
      if (srcset) {
        srcset.split(',').forEach(src => {
          const url = src.trim().split(' ')[0];
          if (url) {
            assets.images.push({
              src: resolveUrl(url, baseUrl.href),
              alt: 'picture-source'
            });
          }
        });
      }
    });

    // Collect fonts (Google Fonts, local, etc)
    $('link[rel*="font"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) {
        assets.fonts.push(resolveUrl(href, baseUrl.href));
      }
    });

    // Collect @font-face from CSS
    const fontFaceMatches = styles.match(/@font-face\s*{[^}]+}/g) || [];
    console.log(`🔤 Found ${fontFaceMatches.length} @font-face declarations`);

    // Script sources
    $('script[src]').each((i, el) => {
      const src = $(el).attr('src');
      if (src && !src.includes('chrome-extension')) {
        assets.scripts.push(resolveUrl(src, baseUrl.href));
      }
    });

    // Clean up the HTML
    let cleanHtml = $.html();

    // Remove script tags (but try to keep inline scripts)
    cleanHtml = cleanHtml.replace(/<script\s+[^>]*src=["'][^"']*["'][^>]*><\/script>/gi, '');
    
    // Remove external stylesheets (we already extracted them)
    cleanHtml = cleanHtml.replace(/<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
    
    // Inline all extracted styles with priority
    if (styles && styles.trim().length > 0) {
      const styleTag = `<style id="inlined-styles" data-timestamp="${Date.now()}">
/* Inlined & Enhanced CSS Rules */
${styles}
/* Ensure visibility of all content */
* { visibility: visible !important; opacity: 1 !important; }
body, html { overflow: auto !important; }
</style>`;
      cleanHtml = cleanHtml.replace('</head>', `${styleTag}\n</head>`);
    }

    // Resolve relative URLs in attributes
    cleanHtml = resolveRelativeUrls(cleanHtml, baseUrl.href);

    console.log(`✅ Extraction complete: ${assets.images.length} images, ${assets.stylesheets.length} stylesheets, ${assets.scripts.length} scripts`);

    return {
      html: cleanHtml,
      styles: styles,
      assets: assets,
      baseUrl: baseUrl.href
    };
  } catch (error) {
    throw new Error(`Failed to scrape website: ${error.message}`);
  }
}

function resolveUrl(url, baseUrl) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  if (url.startsWith('//')) {
    return 'https:' + url;
  }
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function resolveRelativeUrls(html, baseUrl) {
  const doc = new JSDOM(html).window.document;

  // Resolve img src
  doc.querySelectorAll('img').forEach(img => {
    if (img.src && !img.src.startsWith('http')) {
      img.src = resolveUrl(img.src, baseUrl);
    }
  });

  // Resolve link href
  doc.querySelectorAll('a').forEach(a => {
    if (a.href && !a.href.startsWith('http') && !a.href.startsWith('javascript')) {
      a.href = resolveUrl(a.href, baseUrl);
    }
  });

  // Resolve form action
  doc.querySelectorAll('form').forEach(form => {
    if (form.action && !form.action.startsWith('http')) {
      form.action = resolveUrl(form.action, baseUrl);
    }
  });

  // Resolve srcset
  doc.querySelectorAll('[srcset]').forEach(el => {
    const srcset = el.getAttribute('srcset');
    if (srcset) {
      const resolved = srcset.split(',').map(src => {
        const parts = src.trim().split(' ');
        parts[0] = resolveUrl(parts[0], baseUrl);
        return parts.join(' ');
      }).join(', ');
      el.setAttribute('srcset', resolved);
    }
  });

  return doc.documentElement.outerHTML;
}
