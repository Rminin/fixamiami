const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");

puppeteer.use(StealthPlugin());

const app = express();

// Optional local Chrome detection
function getChromePath() {
  const winChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (fs.existsSync(winChrome)) return winChrome;
  return undefined;
}

const CHROME_PATH = getChromePath();

// Rotate user agents
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 }
];

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomDelay(min = 1000, max = 3000) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function setupPage(page) {
  const userAgent = getRandomElement(USER_AGENTS);
  const viewport = getRandomElement(VIEWPORTS);
  
  await page.setUserAgent(userAgent);
  await page.setViewport(viewport);
  
  await page.setExtraHTTPHeaders({
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'sec-ch-ua': '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1'
  });

  await page.evaluateOnNewDocument(() => {
    delete navigator.__proto__.webdriver;
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
  });
}

async function waitForContent(page) {
  // Wait for the main content area to load
  await page.waitForSelector('.item-detail', { timeout: 30000 });
  
  // Additional wait for dynamic content
  await randomDelay(2000, 4000);
  
  // Wait for images to start loading
  await page.waitForFunction(() => {
    const imgs = document.querySelectorAll('.item-detail__slider img, .item-detail__image img');
    return imgs.length > 0 && Array.from(imgs).some(img => img.src && img.src.includes('amiami.com'));
  }, { timeout: 20000 }).catch(() => {
    console.log('Images not fully loaded, proceeding anyway');
  });
}

app.get("/eng/detail", async (req, res) => {
  const { gcode, debug } = req.query;
  if (!gcode) return res.status(400).send("Missing gcode");

  const targetUrl = `https://www.amiami.com/eng/detail/?gcode=${gcode}`;
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      executablePath: CHROME_PATH,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=VizDisplayCompositor",
        "--disable-extensions",
        "--disable-plugins",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-ipc-flooding-protection"
      ],
    });
    
    const page = await browser.newPage();
    await setupPage(page);

    console.log(`Navigating to ${targetUrl}`);
    
    // Navigate and wait for network to be mostly idle
    await page.goto(targetUrl, {
      waitUntil: ["domcontentloaded", "networkidle2"],
      timeout: 60000,
    });

    // Wait for content to load
    await waitForContent(page);

    // Simulate some human behavior
    await page.evaluate(() => {
      window.scrollTo(0, 200);
    });
    await randomDelay(1000, 2000);

    // Debug: Check what we have
    if (debug) {
      const pageContent = await page.content();
      console.log("Page title:", await page.title());
      console.log("URL:", page.url());
      
      // Check for specific elements
      const hasItemDetail = await page.$('.item-detail') !== null;
      const hasSlider = await page.$('.item-detail__slider') !== null;
      const hasPrice = await page.$('.item-detail__price_selling-price') !== null;
      const hasTitle = await page.$('.item-detail__section-title') !== null;
      
      console.log('Element check:', { hasItemDetail, hasSlider, hasPrice, hasTitle });
    }

    // Extract data with more robust selectors
    const data = await page.evaluate(() => {
      // Title extraction with fallbacks
      const titleSelectors = [
        '.item-detail__section-title',
        'h2.item-detail__section-title',
        'h1',
        '[class*="section-title"]'
      ];
      
      let title = "";
      for (const selector of titleSelectors) {
        const element = document.querySelector(selector);
        if (element && element.innerText.trim()) {
          title = element.innerText.trim();
          // Remove (Pre-order) suffix if present
          title = title.replace(/\s*\([^)]*\)\s*$/, '');
          break;
        }
      }
      
      // Image extraction with fallbacks
      const imageSelectors = [
        '.item-detail__slider img',
        '.item-detail__image img',
        '.item-detail img[src*="amiami.com"]',
        'img[alt*="GOODS"]'
      ];
      
      let image = "";
      for (const selector of imageSelectors) {
        const imgEl = document.querySelector(selector);
        if (imgEl) {
          image = imgEl.getAttribute("src") || imgEl.getAttribute("data-src") || "";
          if (image) {
            // Ensure full URL
            if (image.startsWith('//')) {
              image = 'https:' + image;
            } else if (image.startsWith('/')) {
              image = 'https://img.amiami.com' + image;
            } else if (!image.startsWith('http')) {
              image = 'https://img.amiami.com/images/' + image;
            }
            break;
          }
        }
      }
      
      // Price extraction with fallbacks
      const priceSelectors = [
        '.item-detail__price_selling-price',
        '.item-detail__price [class*="selling"]',
        '[class*="price"] [class*="selling"]'
      ];
      
      let price = "";
      for (const selector of priceSelectors) {
        const priceEl = document.querySelector(selector);
        if (priceEl && priceEl.textContent.trim()) {
          price = priceEl.textContent.trim().replace(/\s+/g, " ");
          break;
        }
      }
      
      // Brand extraction
      let brand = "";
      const brandEl = document.querySelector('.item-detail__brand');
      if (brandEl) {
        brand = brandEl.textContent.trim();
      }
      
      return { title, image, price, brand };
    });

    await browser.close();

    console.log('Extracted data:', data);

    // Validate data
    if (!data.title && !data.image && !data.price) {
      throw new Error("Failed to extract any product data");
    }

    // Construct description
    const descriptionParts = [];
    if (data.price) descriptionParts.push(data.price);
    if (data.brand) descriptionParts.push(`by ${data.brand}`);
    const description = descriptionParts.join(' ') || "AmiAmi product listing";

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>${data.title || "AmiAmi Product"}</title>
        <meta property="og:title" content="${data.title || "AmiAmi Product"}">
        <meta property="og:description" content="${description}">
        ${data.image ? `<meta property="og:image" content="${data.image}">` : ''}
        <meta property="og:url" content="${targetUrl}">
        <meta property="og:type" content="website">
        <meta property="og:site_name" content="AmiAmi">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="${data.title || "AmiAmi Product"}">
        <meta name="twitter:description" content="${description}">
        ${data.image ? `<meta name="twitter:image" content="${data.image}">` : ''}
        ${debug ? "" : `<meta http-equiv="refresh" content="3;url=${targetUrl}" />`}
      </head>
      <body>
        <h1>${data.title || "AmiAmi Product"}</h1>
        <p>${description}</p>
        ${data.image ? `<img src="${data.image}" alt="${data.title}" style="max-width: 300px;">` : ''}
        <p>Redirecting to <a href="${targetUrl}">AmiAmi</a> in 3 seconds...</p>
        ${debug ? `<pre>${JSON.stringify(data, null, 2)}</pre>` : ""}
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Scrape failed:", err);
    if (browser) await browser.close();
    
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>AmiAmi Product</title>
        <meta property="og:title" content="AmiAmi Product">
        <meta property="og:description" content="View this product on AmiAmi">
        <meta property="og:url" content="${targetUrl}">
        <meta property="og:type" content="website">
        <meta property="og:site_name" content="AmiAmi">
        ${debug ? "" : `<meta http-equiv="refresh" content="0;url=${targetUrl}" />`}
      </head>
      <body>
        <p>Error loading product data. Redirecting to <a href="${targetUrl}">AmiAmi</a></p>
      </body>
      </html>
    `);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FixAmiAmi Puppeteer server running on port ${PORT}`);
});