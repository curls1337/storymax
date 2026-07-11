const fs = require('fs');
const path = require('path');

// Direct require from pre-installed path in user's D: drive
const { chromium } = require('D:/UGC2/reference/tokopedia-scraper/node_modules/playwright-extra');
const stealth = require('D:/UGC2/reference/tokopedia-scraper/node_modules/puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let browserPromise = null;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const launchOpts = {
        headless: true,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-setuid-sandbox",
        ],
      };
      
      const candidatePaths = [
        process.env.CHROME_PATH,
        process.platform === "win32"
          ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
          : null,
      ].filter(Boolean);

      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          console.log("[scraper] launching real Chrome:", p);
          return await chromium.launch({ ...launchOpts, executablePath: p });
        }
      }
      console.log("[scraper] launching bundled Chromium");
      return chromium.launch(launchOpts);
    })();
  }
  return browserPromise;
}

async function scrapeTokopedia(url) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1689, height: 1225 },
    deviceScaleFactor: 1,
    locale: "id-ID",
  });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page
      .waitForSelector('h1[data-testid="lblPDPDetailProductName"], h1', { timeout: 20000 })
      .catch(() => {});

    // Scroll to trigger lazy hydration
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 700);
      await sleep(300);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);

    // Extract shopDomain & productKey from URL
    const m = url.match(/tokopedia\.com\/([^/?#]+)\/([^/?#]+)/i);
    const shopDomain = m?.[1] || "";
    const productKey = m?.[2] || "";
    
    const hdImageUrls = await page
      .evaluate(
        async ({ shopDomain, productKey }) => {
          try {
            const res = await fetch("https://gql.tokopedia.com/graphql/PDPMainInfo", {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                "x-source": "tokopedia-lite",
                "x-device": "desktop",
              },
              body: JSON.stringify([
                {
                  operationName: "PDPMainInfo",
                  variables: {
                    productKey,
                    shopDomain,
                    layoutID: "",
                    extraPayload: "",
                    queryParam: "",
                    source: "P1",
                    userLocation: {
                      addressID: "",
                      districtID: "2274",
                      postalCode: "",
                      latlon: "",
                      cityID: "176",
                    },
                  },
                  query:
                    "fragment ProductMedia on pdpDataProductMedia { media { type urlOriginal: URLOriginal urlThumbnail: URLThumbnail urlMaxRes: URLMaxRes __typename } __typename }\nquery PDPMainInfo($productKey: String, $shopDomain: String, $layoutID: String, $extraPayload: String, $queryParam: String, $source: String, $userLocation: pdpUserLocation) { pdpMainInfo(shopDomain: $shopDomain, productKey: $productKey, layoutID: $layoutID, extraPayload: $extraPayload, queryParam: $queryParam, source: $source, userLocation: $userLocation) { components { name type data { ...ProductMedia __typename } __typename } __typename } }",
                },
              ]),
            });
            const json = await res.json();
            const components = json?.[0]?.data?.pdpMainInfo?.components || [];
            const mediaComp = components.find(
              (c) => c.name === "product_media" || c.type === "product_media"
            );
            const mediaArr =
              mediaComp?.data?.media ||
              mediaComp?.data?.[0]?.media ||
              [];
            const urls = [];
            for (const item of mediaArr) {
              if (item?.type !== "image") continue;
              const u = item.urlMaxRes || item.urlOriginal || item.urlThumbnail;
              if (u) urls.push(u);
            }
            return urls;
          } catch (e) {
            return [];
          }
        },
        { shopDomain, productKey }
      )
      .catch(() => []);

    console.log("[scraper] PDPMainInfo HD images:", hdImageUrls.length);
    const hdUrls = new Set(hdImageUrls);

    // Wait for hydration
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await sleep(800);

    const data = await page.evaluate((hdSeed) => {
      const pickText = (sel) =>
        document.querySelector(sel)?.innerText?.trim() || "";
      const title =
        pickText('h1[data-testid="lblPDPDetailProductName"]') ||
        pickText("h1") ||
        document.title;
      const price =
        pickText('[data-testid="lblPDPDetailProductPrice"]') ||
        pickText('div[data-testid="lblPDPDetailProductPrice"]') ||
        "";
      const description =
        pickText('[data-testid="lblPDPDescriptionProduk"]') ||
        pickText('div[data-testid="lblPDPDescriptionProduk"]') ||
        "";
      const rating =
        pickText('[data-testid="lblPDPDetailProductRatingNumber"]') || "";

      const upgrade = (src) =>
        src
          .replace(/\/(50|100|150|200|220|250|300|360|400|500|600)-square\//, "/700-square/")
          .replace(/\/cache\/(50|100|150|200|220|250|300|360|400|500|600)\//, "/cache/700/");

      const isProductImg = (src) =>
        /tokopedia[-.]?(static)?\.net|tokopedia\.com|tokopedia\.link|tokopedia-static|tokopedia-cdn|tkpd|akamaized.*tokopedia/i.test(
          src
        ) &&
        /\.(jpg|jpeg|png|webp)|tplv-/i.test(src) &&
        !/\/icons?\/|\/logo|\/badge|sprite|avatar|profile-pic|shop_avatar|shopcredibility|svg|\.svg|placeholder/i.test(
          src
        );

      const imgSet = new Set();

      hdSeed.forEach((u) => {
        if (u && isProductImg(u)) imgSet.add(upgrade(u));
      });

      document.querySelectorAll("img").forEach((img) => {
        const candidates = [
          img.src,
          img.getAttribute("data-src") || "",
          img.getAttribute("data-original") || "",
          img.currentSrc || "",
        ];
        const srcset = img.getAttribute("srcset") || "";
        if (srcset) {
          srcset.split(",").forEach((part) => {
            const u = part.trim().split(/\s+/)[0];
            if (u) candidates.push(u);
          });
        }
        for (const src of candidates) {
          if (src && isProductImg(src)) imgSet.add(upgrade(src));
        }
      });

      document.querySelectorAll("source").forEach((src) => {
        const ss = src.srcset || "";
        ss.split(",").forEach((part) => {
          const u = part.trim().split(/\s+/)[0];
          if (u && isProductImg(u)) imgSet.add(upgrade(u));
        });
      });

      document.querySelectorAll("[style*='background']").forEach((el) => {
        const m = el.style.backgroundImage?.match(/url\(["']?([^"')]+)["']?\)/);
        if (m && isProductImg(m[1])) imgSet.add(upgrade(m[1]));
      });

      try {
        const nd = document.getElementById("__NEXT_DATA__");
        if (nd?.textContent) {
          const re = /https?:\/\/[a-z0-9./_-]*tokopedia[a-z0-9./_-]*\.(jpg|jpeg|png|webp)/gi;
          const matches = nd.textContent.match(re) || [];
          matches.forEach((u) => {
            if (isProductImg(u)) imgSet.add(upgrade(u));
          });
        }
      } catch (err) {}

      const og = document.querySelector('meta[property="og:image"]');
      if (og?.content) imgSet.add(og.content);

      const byKey = new Map();
      for (const u of imgSet) {
        const hashMatch = u.match(/[a-f0-9]{20,}/i);
        const key = hashMatch
          ? hashMatch[0]
          : u
              .replace(/^https?:\/\/[^/]+/, "")
              .replace(/\/(50|100|150|200|250|300|360|400|500|600|700)-square\//, "/X/")
              .replace(/\/cache\/\d+\//, "/cache/X/")
              .replace(/~tplv-[^/?]+/, "~X");
        const existing = byKey.get(key);
        const score = (s) => {
          let pts = 0;
          const sz = s.match(/[-:](\d{3,4}):\d{1,4}\.(jpe?g|webp|png)/i);
          if (sz) pts += Math.min(parseInt(sz[1], 10) / 100, 20);
          if (/white-pad-v1:\d{3,4}/i.test(s)) pts += 10;
          if (/-resize(-jpeg)?:\d{2,3}:/i.test(s)) pts -= 5;
          if (s.includes("700-square")) pts += 5;
          if (/\/(50|100|150|200|250|300)-square\//.test(s)) pts -= 5;
          if (s.includes("images.tokopedia.net")) pts += 1;
          if (!sz && !/-square/.test(s)) pts += 2;
          return pts;
        };
        if (!existing || score(u) > score(existing)) {
          byKey.set(key, u);
        }
      }

      return {
        title,
        price,
        description,
        rating,
        images: Array.from(byKey.values()).slice(0, 15),
      };
    }, Array.from(hdUrls));

    if (!data.title) throw new Error("Gagal ekstrak judul Tokopedia");

    return {
      platform: "tokopedia",
      url,
      title: data.title,
      description: data.description,
      price: data.price,
      rating: data.rating,
      images: data.images,
      scrapedAt: Date.now(),
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

module.exports = { scrapeTokopedia };
