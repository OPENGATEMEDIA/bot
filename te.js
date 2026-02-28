/**
 * ╔══════════════════════════════════════════════╗
 * ║   AD CLICKER BOT — Proxy Rotation            ║
 * ║   Scrape 1 website → temukan iklan → klik    ║
 * ╚══════════════════════════════════════════════╝
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

// ─────────────────────────────────────────────────────────────────────────────
//  KONFIGURASI — Sesuaikan di sini
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  // 🎯 URL TARGET (hanya 1 website)
  targetUrl: 'https://opengatemedia.top',

  // File proxy list
  proxyFile: 'proxies.txt',

  // Jumlah klik per sesi (per proxy)
  clicksPerSession: 3,

  // Delay antar klik (ms) — agar terlihat natural
  delayBetweenClicks: [1500, 4000], // random antara min-max

  // Delay sebelum klik pertama setelah halaman terbuka
  delayBeforeFirstClick: [2000, 5000],

  // Delay antar session (ganti proxy)
  delayBetweenSessions: [5000, 12000],

  // Berapa kali loop (sesi)
  totalSessions: 10,

  // Timeout load halaman (ms)
  pageTimeout: 40000,

  // Scroll sebelum klik agar terlihat natural
  scrollBeforeClick: true,

  // Simpan screenshot setiap klik
  saveScreenshot: true,
  screenshotDir: 'results/screenshots',

  // Simpan log JSON
  logFile: 'results/click_log.json',

  // Headless mode
  headless: true,

  // Rotasi proxy: 'round-robin' | 'random'
  proxyMode: 'random',
};

// ─────────────────────────────────────────────────────────────────────────────
//  AD SELECTORS
// ─────────────────────────────────────────────────────────────────────────────
const AD_SELECTORS = [
  'ins.adsbygoogle',
  'div[id*="google_ads"]',
  'div[class*="google-ad"]',
  'div[id*="div-gpt-ad"]',
  'div[class*="dfp"]',
  'div[class*="gpt-ad"]',
  'div[id*="ad-"]',
  'div[id*="-ad"]',
  'div[class*="ad-slot"]',
  'div[class*="ad-unit"]',
  'div[class*="ad-container"]',
  'div[class*="advertisement"]',
  'div[class*="adsense"]',
  'div[class*="banner-ad"]',
  'div[class*="ads-"]',
  'iframe[src*="googlesyndication"]',
  'iframe[src*="doubleclick"]',
  'iframe[id*="google_ads"]',
  'a[href*="googleadservices"]',
  'a[href*="doubleclick"]',
  'a[data-ad-click]',
  'div[class*="sponsor"]',
  'div[class*="promoted"]',
  'div[class*="native-ad"]',
  '[data-google-query-id] a',
  '.ad-wrapper a',
  '.ad-slot a',
  'ins.adsbygoogle a',
];

// ─────────────────────────────────────────────────────────────────────────────
//  PROXY MANAGER
// ─────────────────────────────────────────────────────────────────────────────
class ProxyManager {
  constructor(filePath, mode = 'random') {
    this.mode = mode;
    this.proxies = this.loadFromFile(filePath);
    this.index = 0;
    this.failed = new Set();
    this.used = new Set();

    console.log(
      chalk.cyan(`🔄 Loaded ${this.proxies.length} proxy dari ${filePath}`)
    );
  }

  loadFromFile(filePath) {
    if (!fs.existsSync(filePath)) {
      console.log(chalk.red(`✗ File ${filePath} tidak ditemukan!`));
      return [];
    }

    const lines = fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    const proxies = [];
    for (const line of lines) {
      const parsed = this.parseLine(line);
      if (parsed) proxies.push(parsed);
    }
    return proxies;
  }

  parseLine(line) {
    try {
      // Format: protocol://user:pass@host:port atau protocol://host:port atau host:port
      const regex =
        /^(?:(https?|socks[45]):\/\/)?(?:([^:@\s]+):([^@\s]+)@)?([^\s:\/]+):(\d+)/;
      const m = line.match(regex);
      if (!m) return null;
      return {
        protocol: m[1] || 'http',
        username: m[2] || null,
        password: m[3] || null,
        host: m[4],
        port: parseInt(m[5]),
        str: `${m[4]}:${m[5]}`,
      };
    } catch {
      return null;
    }
  }

  get() {
    const available = this.proxies.filter((_, i) => !this.failed.has(i));
    if (available.length === 0) {
      console.log(chalk.yellow('⚠ Semua proxy gagal, reset...'));
      this.failed.clear();
      return this.proxies[0] || null;
    }

    let proxy;
    if (this.mode === 'random') {
      proxy = available[Math.floor(Math.random() * available.length)];
    } else {
      proxy = available[this.index % available.length];
      this.index++;
    }
    this.used.add(proxy.str);
    return proxy;
  }

  markFailed(proxy) {
    const i = this.proxies.findIndex((p) => p.str === proxy.str);
    if (i !== -1) this.failed.add(i);
    console.log(chalk.red(`  ✗ Proxy gagal: ${proxy.str}`));
  }

  stats() {
    return {
      total: this.proxies.length,
      failed: this.failed.size,
      active: this.proxies.length - this.failed.size,
      usedUnique: this.used.size,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER UTILS
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = ([min, max]) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
];

const randomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// ─────────────────────────────────────────────────────────────────────────────
//  AD CLICKER
// ─────────────────────────────────────────────────────────────────────────────
class AdClickerBot {
  constructor(config, proxyManager) {
    this.config = config;
    this.pm = proxyManager;
    this.log = [];
    this.totalClicks = 0;
    this.totalAdsFound = 0;
    this.sessionCount = 0;
  }

  async init() {
    fs.mkdirSync('results', { recursive: true });
    if (this.config.saveScreenshot) {
      fs.mkdirSync(this.config.screenshotDir, { recursive: true });
    }
  }

  async launchBrowser(proxy) {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,768',
    ];

    if (proxy) {
      args.push(`--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`);
    }

    const browser = await puppeteer.launch({
      headless: this.config.headless,
      args,
      defaultViewport: { width: 1366, height: 768 },
    });

    return browser;
  }

  async setupPage(browser, proxy) {
    const page = await browser.newPage();

    // Random user agent
    const ua = randomUA();
    await page.setUserAgent(ua);

    // Autentikasi proxy
    if (proxy?.username && proxy?.password) {
      await page.authenticate({
        username: proxy.username,
        password: proxy.password,
      });
    }

    // Sembunyikan jejak automation
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en', 'id'],
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
    });

    // Accept cookies popup umum
    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });

    return page;
  }

  async humanScroll(page) {
    const scrollSteps = Math.floor(Math.random() * 5) + 3;
    for (let i = 0; i < scrollSteps; i++) {
      const scrollAmt = Math.floor(Math.random() * 400) + 100;
      await page.evaluate((amt) => window.scrollBy(0, amt), scrollAmt);
      await sleep(rand([300, 800]));
    }
  }

  async findAds(page) {
    return page.evaluate((selectors) => {
      const found = [];
      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        elements.forEach((el, idx) => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 20 && rect.height > 10) {
            // Cari elemen yang bisa diklik (anchor atau parent anchor)
            let clickTarget = el;
            if (el.tagName !== 'A') {
              const anchor = el.querySelector('a');
              if (anchor) clickTarget = anchor;
            }

            found.push({
              selector: sel,
              index: idx,
              tagName: el.tagName,
              id: el.id || null,
              className:
                (typeof el.className === 'string'
                  ? el.className
                  : ''
                ).substring(0, 80),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              href:
                clickTarget.tagName === 'A'
                  ? clickTarget.href
                  : null,
              hasClickableAnchor: el.querySelector('a') !== null,
              isAnchor: el.tagName === 'A',
            });
          }
        });
      }
      // Hapus duplikat berdasarkan posisi
      const unique = [];
      const seen = new Set();
      for (const ad of found) {
        const key = `${Math.round(ad.top / 10)}-${Math.round(ad.left / 10)}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(ad);
        }
      }
      return unique;
    }, AD_SELECTORS);
  }

  async clickAd(page, ad, sessionId, clickNum) {
    try {
      // Scroll ke posisi iklan
      await page.evaluate((top) => {
        window.scrollTo({ top: Math.max(0, top - 200), behavior: 'smooth' });
      }, ad.top);
      await sleep(rand([500, 1200]));

      // Gerakan mouse natural menuju iklan
      const centerX = ad.left + Math.floor(ad.width / 2);
      const centerY = ad.top + Math.floor(ad.height / 2);

      // Move mouse bertahap
      const startX = Math.floor(Math.random() * 400) + 100;
      const startY = Math.floor(Math.random() * 300) + 100;
      await page.mouse.move(startX, startY);
      await sleep(rand([100, 300]));
      await page.mouse.move(centerX - 30, centerY - 20, { steps: 10 });
      await sleep(rand([100, 200]));
      await page.mouse.move(centerX, centerY, { steps: 5 });
      await sleep(rand([200, 600]));

      // Screenshot sebelum klik
      let screenshotBefore = null;
      if (this.config.saveScreenshot) {
        screenshotBefore = path.join(
          this.config.screenshotDir,
          `session${sessionId}_click${clickNum}_before.png`
        );
        await page.screenshot({ path: screenshotBefore });
      }

      // KLIK
      await page.mouse.click(centerX, centerY);
      console.log(
        chalk.green(
          `  🖱  Diklik! [${ad.width}x${ad.height}px] selector: ${ad.selector}`
        )
      );
      if (ad.href) console.log(chalk.gray(`     → ${ad.href.substring(0, 80)}`));

      await sleep(rand([1000, 2500]));

      // Screenshot setelah klik
      let screenshotAfter = null;
      if (this.config.saveScreenshot) {
        screenshotAfter = path.join(
          this.config.screenshotDir,
          `session${sessionId}_click${clickNum}_after.png`
        );
        await page.screenshot({ path: screenshotAfter }).catch(() => {});
      }

      // Kembali ke halaman utama jika buka tab baru
      const pages = await page.browser().pages();
      if (pages.length > 2) {
        for (let i = 2; i < pages.length; i++) {
          await pages[i].close().catch(() => {});
        }
      }

      return {
        status: 'clicked',
        selector: ad.selector,
        href: ad.href,
        adSize: `${ad.width}x${ad.height}`,
        screenshotBefore,
        screenshotAfter,
      };
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ Gagal klik: ${err.message}`));
      return { status: 'failed', error: err.message };
    }
  }

  async runSession(sessionId) {
    const proxy = this.pm.get();
    console.log(chalk.cyan(`\n${'═'.repeat(55)}`));
    console.log(
      chalk.cyan(
        `  SESSION #${sessionId} | Proxy: ${proxy ? proxy.str : 'DIRECT'}`
      )
    );
    console.log(chalk.cyan(`${'═'.repeat(55)}`));

    let browser;
    try {
      browser = await this.launchBrowser(proxy);
      const page = await this.setupPage(browser, proxy);

      // Navigate ke target
      console.log(chalk.yellow(`  🌐 Membuka: ${this.config.targetUrl}`));
      await page.goto(this.config.targetUrl, {
        waitUntil: 'networkidle2',
        timeout: this.config.pageTimeout,
      });
      console.log(chalk.green(`  ✅ Halaman terbuka`));

      // Tunggu sebentar seperti manusia
      await sleep(rand(this.config.delayBeforeFirstClick));

      // Scroll natural
      if (this.config.scrollBeforeClick) {
        console.log(chalk.gray('  📜 Scrolling halaman...'));
        await this.humanScroll(page);
      }

      // Tunggu iklan dimuat
      await sleep(2000);

      // Temukan iklan
      const ads = await this.findAds(page);
      this.totalAdsFound += ads.length;
      console.log(chalk.magenta(`  📢 Iklan ditemukan: ${ads.length}`));

      const sessionLog = {
        sessionId,
        timestamp: new Date().toISOString(),
        proxy: proxy?.str || 'direct',
        url: this.config.targetUrl,
        adsFound: ads.length,
        clicks: [],
      };

      if (ads.length === 0) {
        console.log(chalk.yellow('  ⚠ Tidak ada iklan yang bisa diklik'));
        sessionLog.status = 'no_ads';
      } else {
        // Pilih iklan secara acak untuk diklik
        const toClick = [];
        const shuffled = [...ads].sort(() => Math.random() - 0.5);
        const maxClick = Math.min(
          this.config.clicksPerSession,
          shuffled.length
        );
        for (let i = 0; i < maxClick; i++) toClick.push(shuffled[i]);

        console.log(
          chalk.yellow(`  🎯 Akan klik ${toClick.length} iklan...`)
        );

        for (let i = 0; i < toClick.length; i++) {
          const ad = toClick[i];
          console.log(
            chalk.blue(
              `\n  [${i + 1}/${toClick.length}] Klik iklan...`
            )
          );

          const result = await this.clickAd(page, ad, sessionId, i + 1);
          sessionLog.clicks.push({ ad, result });

          if (result.status === 'clicked') this.totalClicks++;

          if (i < toClick.length - 1) {
            const delay = rand(this.config.delayBetweenClicks);
            console.log(chalk.gray(`  ⏳ Tunggu ${delay}ms...`));
            await sleep(delay);
          }
        }

        sessionLog.status = 'done';
      }

      this.log.push(sessionLog);
      await this.saveLog();
    } catch (err) {
      if (proxy) this.pm.markFailed(proxy);
      console.log(chalk.red(`  ✗ Session gagal: ${err.message}`));
      this.log.push({
        sessionId,
        timestamp: new Date().toISOString(),
        proxy: proxy?.str || 'direct',
        status: 'error',
        error: err.message,
      });
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  async saveLog() {
    const output = {
      generatedAt: new Date().toISOString(),
      targetUrl: this.config.targetUrl,
      proxyStats: this.pm.stats(),
      totalSessions: this.sessionCount,
      totalAdsFound: this.totalAdsFound,
      totalClicks: this.totalClicks,
      sessions: this.log,
    };
    fs.writeFileSync(this.config.logFile, JSON.stringify(output, null, 2));
  }

  async run() {
    await this.init();

    console.log(chalk.bgBlue.white('\n  🤖 AD CLICKER BOT DIMULAI  \n'));
    console.log(chalk.white(`  🎯 Target   : ${this.config.targetUrl}`));
    console.log(chalk.white(`  🔄 Proxy    : ${this.pm.proxies.length} tersedia`));
    console.log(chalk.white(`  📋 Sessions : ${this.config.totalSessions}`));
    console.log(chalk.white(`  🖱  Klik/sesi: ${this.config.clicksPerSession}`));

    for (let i = 1; i <= this.config.totalSessions; i++) {
      this.sessionCount = i;
      await this.runSession(i);

      if (i < this.config.totalSessions) {
        const delay = rand(this.config.delayBetweenSessions);
        console.log(
          chalk.gray(`\n  ⏳ Jeda ${(delay / 1000).toFixed(1)}s sebelum session berikutnya...`)
        );
        await sleep(delay);
      }
    }

    await this.saveLog();
    this.printSummary();
  }

  printSummary() {
    const ps = this.pm.stats();
    console.log(chalk.cyan(`\n${'═'.repeat(55)}`));
    console.log(chalk.cyan('              📊 RINGKASAN AKHIR'));
    console.log(chalk.cyan(`${'═'.repeat(55)}`));
    console.log(chalk.white(`  🎯 Target URL      : ${this.config.targetUrl}`));
    console.log(chalk.white(`  📋 Total Sessions  : ${this.sessionCount}`));
    console.log(chalk.magenta(`  📢 Total Iklan     : ${this.totalAdsFound}`));
    console.log(chalk.green(`  🖱  Total Klik      : ${this.totalClicks}`));
    console.log(chalk.blue(`  🔄 Proxy Aktif     : ${ps.active}/${ps.total}`));
    console.log(chalk.red(`  ✗  Proxy Gagal     : ${ps.failed}`));
    console.log(chalk.yellow(`  💾 Log disimpan    : ${this.config.logFile}`));
    console.log(chalk.cyan(`${'═'.repeat(55)}\n`));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const pm = new ProxyManager(CONFIG.proxyFile, CONFIG.proxyMode);

  if (pm.proxies.length === 0) {
    console.log(
      chalk.red(
        '✗ Tidak ada proxy! Cek file proxies.txt atau jalankan: node fetch-proxies.js'
      )
    );
    process.exit(1);
  }

  const bot = new AdClickerBot(CONFIG, pm);
  await bot.run();
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:', err.message));
  process.exit(1);
});
