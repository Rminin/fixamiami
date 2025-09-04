const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");

puppeteer.use(StealthPlugin());

const app = express();

// Optional local Chrome detection
function getChromePath() {
  // Local Windows Chrome
  const winChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (fs.existsSync(winChrome)) return winChrome;
  // Otherwise, use bundled Chromium
  return undefined;
}

const CHROME_PATH = getChromePath();

// Rotate user agents
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 }
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
  
  // More realistic headers
  await page.setExtraHTTPHeaders({
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'max-age=0',
    'sec-ch-ua': '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1'
  });

  // Override permissions, geolocation, etc.
  await page.evaluateOnNewDocument(() => {
    // Remove webdriver property
    delete navigator.__proto__.webdriver;
    
    // Mock permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );

    // Mock plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
  });
}

async function handleCloudflareChallenge(page) {
  try {
    // Wait a bit for potential Cloudflare challenge
    await randomDelay(2000, 4000);
    
    // Check for Cloudflare challenge indicators
    const challengeSelectors = [
      '#challenge-form',
      '.cf-browser-verification',
      '.cf-checking-browser',
      '[data-ray]',
      '.challenge-running'
    ];
    
    let isChallenge = false;
    for (const selector of challengeSelectors) {
      const element = await page.$(selector);
      if (element) {
        console.log(`Cloudflare challenge detected: ${selector}`);
        isChallenge = true;
        break;
      }
    }
    
    if (isChallenge) {
      console.log('Waiting for Cloudflare challenge to complete...');
      // Wait longer for challenge to complete
      await randomDelay(5000, 10000);
      
      // Wait for challenge to disappear or page to load
      await page.waitForFunction(() => {
        const challengeElements = [
          document.querySelector('#challenge-form'),
          document.querySelector('.cf-browser-verification'),
          document.querySelector('.cf-checking-browser')
        ];
        return !challengeElements.some(el => el !== null);
      }, { timeout: 30000 }).catch(() => {
        console.log('Challenge timeout - proceeding anyway');
      });
    }
  } catch (error) {
    console.log('Challenge handling error:', error.message);
  }
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
        "--no-pings",
        "--password-store=basic",
        "--use-mock-keychain",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding"
      ],
    });
    
    const page = await browser.newPage();
    await setupPage(page);

    console.log(`Navigating to ${targetUrl}`);
    
    // Navigate with more realistic timing
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Handle potential Cloudflare challenge
    await handleCloudflareChallenge(page);

    // Add some human-like behavior
    await randomDelay(1000, 2000);
    
    // Scroll a bit to mimic human behavior
    await page.evaluate(() => {
      window.scrollTo(0, Math.floor(Math.random() * 500));
    });

    await randomDelay(500, 1000);

    // Debug dump of HTML
    if (debug) {
      const html = await page.content();
      console.log("=== HTML snippet ===");
      console.log(html.slice(0, 1000));
      console.log("====================");
    }

    // Check if we got blocked
    const title = await page.title();
    const url = page.url();
    console.log(`Page title: ${title}`);
    console.log(`Current URL: ${url}`);

    if (title.includes('Access denied') || title.includes('Cloudflare') || url.includes('cloudflare')) {
      throw new Error('Blocked by Cloudflare');
    }

    // Check selectors manually before waiting
    const hasImg = await page.$(".item-detail__slider img") !== null;
    const hasPrice = await page.$(".item-detail__price_selling-price") !== null;
    
    console.log("Selector check:", { hasImg, hasPrice });

    // More flexible waiting strategy
    const waitPromises = [
      page.waitForSelector(".item-detail__slider img", { timeout: 15000 }).catch(() => null),
      page.waitForSelector(".item-detail__price_selling-price", { timeout: 15000 }).catch(() => null)
    ];
    
    await Promise.allSettled(waitPromises);

    const data = await page.evaluate(() => {
      const title = document.querySelector(".item-detail__section-title")?.innerText.trim() || 
                   document.querySelector("h1")?.innerText.trim() || 
                   "AmiAmi Product";
      
      const imgEl = document.querySelector(".item-detail__slider img") || 
                   document.querySelector(".item-detail img") ||
                   document.querySelector("img[src*='images.amiami.com']");
      
      let image = "";
      if (imgEl) {
        image = imgEl.getAttribute("src") || imgEl.getAttribute("data-src") || "";
        if (image && !image.startsWith('http')) {
          image = 'https://www.amiami.com' + image;
        }
      }
      
      const priceEl = document.querySelector(".item-detail__price_selling-price") ||
                     document.querySelector("[class*='price']") ||
                     document.querySelector("[class*='selling']");
      
      const price = priceEl ? priceEl.textContent.trim().replace(/\s+/g, " ") : "";
      
      return { title, image, price };
    });

    await browser.close();

    // Validate data
    if (!data.title || data.title === "AmiAmi Product") {
      throw new Error("Failed to extract product data");
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>${data.title}</title>
        <meta property="og:title" content="${data.title}">
        <meta property="og:description" content="${data.price || "AmiAmi product listing"}">
        <meta property="og:image" content="${data.image}">
        <meta property="og:url" content="${targetUrl}">
        <meta property="og:type" content="website">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="${data.title}">
        <meta name="twitter:description" content="${data.price || "AmiAmi product listing"}">
        <meta name="twitter:image" content="${data.image}">
        ${debug ? "" : `<meta http-equiv="refresh" content="0;url=${targetUrl}" />`}
      </head>
      <body>
        <p>Redirecting to <a href="${targetUrl}">${data.title}</a></p>
        ${debug ? `<pre>${JSON.stringify(data, null, 2)}</pre>` : ""}
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Scrape failed:", err);
    if (browser) await browser.close();
    
    // Return a basic response with the original URL
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
        ${debug ? "" : `<meta http-equiv="refresh" content="0;url=${targetUrl}" />`}
      </head>
      <body>
        <p>Redirecting to <a href="${targetUrl}">AmiAmi</a></p>
      </body>
      </html>
    `);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FixAmiAmi Puppeteer server running on port ${PORT}`);
});