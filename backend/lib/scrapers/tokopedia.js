const fs = require('fs');
const path = require('path');

let chromium;
try {
  chromium = require('playwright-chromium').chromium;
} catch (e) {
  console.error('[scraper] standard playwright-chromium is missing:', e.message);
}

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

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
          "--disable-http2",
          "--disable-web-security",
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
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "id-ID",
    extraHTTPHeaders: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1"
    }
  });
  const page = await ctx.newPage();
  try {
    // Navigate with waitUntil: "commit" to resolve instantly when headers arrive, avoiding blocks/timeouts on analytics/scripts
    const response = await page.goto(url, { waitUntil: "commit", timeout: 20000 });
    const status = response ? response.status() : null;
    if (status === 404) {
      throw new Error("Produk tidak ditemukan (404). Pastikan URL Tokopedia benar.");
    }

    // Quick check for bot block or 404 page
    const initialTitle = await page.title();
    const initialBody = await page.evaluate(() => document.body?.innerText || "");
    if (initialTitle.includes("Pasang Kuda-Kuda") || initialBody.includes("Pasang Kuda-Kuda") || initialBody.includes("Pardon Our Interruption")) {
      throw new Error("Akses diblokir oleh sistem anti-bot Tokopedia. Silakan coba sesaat lagi.");
    }
    if (initialBody.includes("tujuanmu nggak ada") || initialBody.includes("tujuanmu tidak ditemukan")) {
      throw new Error("Produk tidak ditemukan di Tokopedia. Pastikan URL benar.");
    }

    // Wait for the main H1 or product container to ensure the page starts rendering
    await page
      .waitForSelector('h1[data-testid="lblPDPDetailProductName"], h1, [data-testid="pdpProductName"]', { timeout: 12000 })
      .catch(() => {});

    // Scroll to trigger lazy hydration
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 700);
      await sleep(300);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);

    // Extract shopDomain & productKey from redirected URL or original URL
    const redirectedUrl = page.url();
    let m = redirectedUrl.match(/tokopedia\.com\/([^/?#]+)\/([^/?#]+)/i);
    if (!m) {
      m = url.match(/tokopedia\.com\/([^/?#]+)\/([^/?#]+)/i);
    }
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
        pickText('[data-testid="pdpProductName"]') ||
        pickText("h1") ||
        document.title;
      const price =
        pickText('[data-testid="lblPDPDetailProductPrice"]') ||
        pickText('div[data-testid="lblPDPDetailProductPrice"]') ||
        pickText('[data-testid="pdpProductPrice"]') ||
        "";
      const description =
        pickText('[data-testid="lblPDPDescriptionProduk"]') ||
        pickText('div[data-testid="lblPDPDescriptionProduk"]') ||
        pickText('[data-testid="pdpDescriptionContainer"]') ||
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

    if (!data.title) {
      const finalTitle = await page.title();
      const finalBody = await page.evaluate(() => document.body?.innerText || "");
      if (finalTitle.includes("Pasang Kuda-Kuda") || finalBody.includes("Pasang Kuda-Kuda") || finalBody.includes("Pardon Our Interruption")) {
        throw new Error("Akses diblokir oleh sistem anti-bot Tokopedia. Silakan coba sesaat lagi.");
      }
      if (finalBody.includes("tujuanmu nggak ada") || finalBody.includes("tujuanmu tidak ditemukan") || finalBody.includes("tujuanmu")) {
        throw new Error("Produk tidak ditemukan di Tokopedia. Pastikan URL benar.");
      }
      throw new Error("Gagal mengekstrak detail produk Tokopedia. Coba periksa kembali URL.");
    }

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
