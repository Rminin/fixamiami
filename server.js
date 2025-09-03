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

app.get("/eng/detail", async (req, res) => {
  const { gcode, debug } = req.query;
  if (!gcode) return res.status(400).send("Missing gcode");

  const targetUrl = `https://www.amiami.com/eng/detail/?gcode=${gcode}`;

  try {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: CHROME_PATH, // optional
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForSelector(".item-detail__slider img", { timeout: 15000 });
    await page.waitForSelector(".item-detail__price_selling-price", { timeout: 15000 }).catch(() => {});

    const data = await page.evaluate(() => {
      const title = document.querySelector(".item-detail__section-title")?.innerText.trim() || "AmiAmi Product";
      const imgEl = document.querySelector(".item-detail__slider img");
      const image = imgEl ? imgEl.getAttribute("src") : "";
      const priceEl = document.querySelector(".item-detail__price_selling-price");
      const price = priceEl ? priceEl.textContent.trim().replace(/\s+/g, "") : "";
      return { title, image, price };
    });

    await browser.close();

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
    res.status(500).send("Failed to fetch product");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FixAmiAmi Puppeteer server running on port ${PORT}`);
});
