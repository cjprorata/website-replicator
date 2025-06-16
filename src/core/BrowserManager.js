// src/core/BrowserManager.js
const puppeteer = require('puppeteer');
const { chromium, firefox, webkit } = require('playwright');
const logger = require('../utils/logger');
const axios = require('axios');
const cheerio = require('cheerio');

class BrowserManager {
  constructor(options = {}) {
    this.options = {
      headless: options.headless !== false,
      timeout: options.timeout || 30000,
      userAgent: options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      viewport: options.viewport || { width: 1920, height: 1080 },
      engine: options.engine || 'puppeteer', // 'puppeteer' or 'playwright'
      browserType: options.browserType || 'chromium', // 'chromium', 'firefox', 'webkit'
      ...options
    };
    this.browser = null;
    this.pages = new Map();
    this.isVercelEnvironment = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  }

  async initialize(correlationId) {
    try {
      logger.logProgress(correlationId, 'browser_initialization', {
        engine: this.options.engine,
        browserType: this.options.browserType,
        isVercel: this.isVercelEnvironment
      });

      if (this.isVercelEnvironment) {
        // In Vercel, we'll use a simple HTTP client instead of browser automation
        logger.logProgress(correlationId, 'using_fallback_mode', {
          reason: 'serverless_environment'
        });
        this.browser = { _isHttpClient: true };
      } else {
        if (this.options.engine === 'puppeteer') {
          this.browser = await this.initializePuppeteer(correlationId);
        } else {
          this.browser = await this.initializePlaywright(correlationId);
        }
      }

      logger.logProgress(correlationId, 'browser_initialized', {
        engine: this.options.engine,
        browserType: this.options.browserType,
        fallbackMode: this.isVercelEnvironment
      });

      return this.browser;
    } catch (error) {
      logger.logError(correlationId, error, {
        stage: 'browser_initialization',
        engine: this.options.engine
      });
      
      // If browser initialization fails, try fallback mode
      if (!this.isVercelEnvironment) {
        logger.logProgress(correlationId, 'falling_back_to_http_client', {
          reason: 'browser_initialization_failed'
        });
        this.browser = { _isHttpClient: true };
        this.isVercelEnvironment = true; // Switch to fallback mode
        return this.browser;
      }
      
      throw new Error(`Failed to initialize browser: ${error.message}`);
    }
  }

  async initializePuppeteer(correlationId) {
    const launchOptions = {
      headless: this.options.headless,
      defaultViewport: this.options.viewport,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    };

    // Handle different execution environments
    if (process.env.NODE_ENV === 'production') {
      launchOptions.executablePath = '/usr/bin/chromium-browser';
    }

    return await puppeteer.launch(launchOptions);
  }

  async initializePlaywright(correlationId) {
    const launchOptions = {
      headless: this.options.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    };

    switch (this.options.browserType) {
      case 'firefox':
        return await firefox.launch(launchOptions);
      case 'webkit':
        return await webkit.launch(launchOptions);
      default:
        return await chromium.launch(launchOptions);
    }
  }

  async createPage(correlationId, url) {
    try {
      if (this.isVercelEnvironment) {
        // Return a mock page object for HTTP client mode
        const pageId = `${correlationId}-${Date.now()}`;
        const mockPage = {
          _isHttpClient: true,
          _pageId: pageId,
          _url: url,
          goto: async (url) => this.httpGoto(url),
          content: async () => this.httpContent,
          screenshot: async () => null, // No screenshots in fallback mode
          evaluate: async (fn) => null, // No JS evaluation in fallback mode
          close: async () => {}
        };
        
        this.pages.set(pageId, mockPage);
        logger.logProgress(correlationId, 'page_created', { pageId, url, mode: 'http_client' });
        return { page: mockPage, pageId };
      }

      const page = await this.browser.newPage();
      
      // Configure page settings for optimal scraping
      await this.configurePage(page, correlationId);
      
      const pageId = `${correlationId}-${Date.now()}`;
      this.pages.set(pageId, page);
      
      logger.logProgress(correlationId, 'page_created', { pageId, url, mode: 'browser' });
      
      return { page, pageId };
    } catch (error) {
      logger.logError(correlationId, error, {
        stage: 'page_creation',
        url
      });
      throw error;
    }
  }

  async httpGoto(url) {
    try {
      const response = await axios.get(url, {
        timeout: this.options.timeout,
        headers: {
          'User-Agent': this.options.userAgent
        },
        maxRedirects: 5
      });
      
      this.httpContent = response.data;
      return { status: () => response.status };
    } catch (error) {
      throw new Error(`Failed to fetch ${url}: ${error.message}`);
    }
  }

  async configurePage(page, correlationId) {
    if (this.isVercelEnvironment) {
      return; // No configuration needed for HTTP client mode
    }

    // Block unnecessary resources for faster loading
    if (this.options.engine === 'puppeteer') {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['stylesheet', 'font', 'image'].includes(resourceType) &&
            !this.options.includeAssets) {
          req.abort();
        } else {
          req.continue();
        }
      });
    }

    // Set user agent and viewport
    await page.setUserAgent(this.options.userAgent);
    if (this.options.viewport) {
      await page.setViewport(this.options.viewport);
    }

    // Configure timeouts
    page.setDefaultNavigationTimeout(this.options.timeout);
    page.setDefaultTimeout(this.options.timeout);

    // Handle page errors
    page.on('error', (error) => {
      logger.logError(correlationId, error, {
        stage: 'page_runtime_error'
      });
    });

    page.on('pageerror', (error) => {
      logger.logError(correlationId, error, {
        stage: 'page_script_error'
      });
    });
  }

  async closePage(pageId) {
    const page = this.pages.get(pageId);
    if (page && !page._isHttpClient) {
      await page.close();
    }
    this.pages.delete(pageId);
  }

  async close() {
    // Close all pages
    for (const [pageId, page] of this.pages) {
      try {
        if (!page._isHttpClient) {
          await page.close();
        }
      } catch (error) {
        // Ignore close errors
      }
    }
    this.pages.clear();

    // Close browser
    if (this.browser && !this.browser._isHttpClient) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = BrowserManager;