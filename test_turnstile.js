/**
 * 快速测试脚本 - 验证 Turnstile 点击功能
 *
 * 使用方法：node test_turnstile.js
 *
 * 这个脚本会：
 * 1. 启动浏览器（非 headless 模式，可以看到）
 * 2. 访问 Katabump 登录页
 * 3. 检测 Turnstile
 * 4. 尝试点击验证
 * 5. 输出详细的调试信息
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

chromium.use(stealth);

const CHROME_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const USER_DATA_DIR = path.join(__dirname, 'ChromeData_Test');
const DEBUG_PORT = 9223; // 使用不同的端口避免冲突
const HEADLESS = false; // 始终显示浏览器窗口

// 注入脚本（增强版）
const INJECTED_SCRIPT = `
(function() {
    if (window.self === window.top) return;

    console.log('[TEST] Script loaded in iframe:', window.location.href);

    try {
        function getRandomInt(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }
        let screenX = getRandomInt(800, 1200);
        let screenY = getRandomInt(400, 600);

        Object.defineProperty(MouseEvent.prototype, 'screenX', {
            get: function() { return screenX; },
            configurable: true
        });
        Object.defineProperty(MouseEvent.prototype, 'screenY', {
            get: function() { return screenY; },
            configurable: true
        });
    } catch (e) {
        console.log('[TEST] screenX/Y override failed:', e.message);
    }

    function findTurnstileCheckbox(root) {
        const selectors = [
            'input[type="checkbox"]',
            'input[name="cf-turnstile-response"]',
            'input.cf-turnstile-response',
            '[role="checkbox"]',
            'input'
        ];

        for (const selector of selectors) {
            const element = root.querySelector(selector);
            if (element) {
                console.log('[TEST] Found element with selector:', selector);
                return element;
            }
        }
        return null;
    }

    try {
        const originalAttachShadow = Element.prototype.attachShadow;

        Element.prototype.attachShadow = function(init) {
            const shadowRoot = originalAttachShadow.call(this, init);

            if (shadowRoot) {
                console.log('[TEST] Shadow root attached');

                const checkAndReport = () => {
                    const checkbox = findTurnstileCheckbox(shadowRoot);
                    if (checkbox) {
                        const rect = checkbox.getBoundingClientRect();
                        console.log('[TEST] Checkbox rect:', rect);

                        if (rect.width > 0 && rect.height > 0 && window.innerWidth > 0 && window.innerHeight > 0) {
                            const xRatio = (rect.left + rect.width / 2) / window.innerWidth;
                            const yRatio = (rect.top + rect.height / 2) / window.innerHeight;

                            console.log('[TEST] ✓ Checkbox found! Ratios:', { xRatio, yRatio });
                            window.__turnstile_data = { xRatio, yRatio, timestamp: Date.now() };
                            return true;
                        }
                    }
                    return false;
                };

                if (!checkAndReport()) {
                    const observer = new MutationObserver(() => {
                        if (checkAndReport()) observer.disconnect();
                    });
                    observer.observe(shadowRoot, { childList: true, subtree: true });

                    const interval = setInterval(() => {
                        if (checkAndReport()) {
                            clearInterval(interval);
                            observer.disconnect();
                        }
                    }, 500);

                    setTimeout(() => {
                        clearInterval(interval);
                        observer.disconnect();
                    }, 30000);
                }
            }
            return shadowRoot;
        };
        console.log('[TEST] attachShadow hook installed');
    } catch (e) {
        console.error('[TEST] Error hooking attachShadow:', e);
    }

    function checkDocument() {
        const checkbox = findTurnstileCheckbox(document);
        if (checkbox) {
            const rect = checkbox.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const xRatio = (rect.left + rect.width / 2) / window.innerWidth;
                const yRatio = (rect.top + rect.height / 2) / window.innerHeight;
                console.log('[TEST] ✓ Found in document! Ratios:', { xRatio, yRatio });
                window.__turnstile_data = { xRatio, yRatio, timestamp: Date.now() };
                return true;
            }
        }
        return false;
    }

    const docInterval = setInterval(() => {
        if (checkDocument()) clearInterval(docInterval);
    }, 500);

    setTimeout(() => clearInterval(docInterval), 30000);
})();
`;

function generateBezierPath(startX, startY, endX, endY, steps = 20) {
    const points = [];
    const cp1x = startX + (endX - startX) * (0.25 + Math.random() * 0.25);
    const cp1y = startY + (endY - startY) * (0.1 + Math.random() * 0.3);
    const cp2x = startX + (endX - startX) * (0.5 + Math.random() * 0.25);
    const cp2y = startY + (endY - startY) * (0.7 + Math.random() * 0.2);

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const t2 = t * t;
        const t3 = t2 * t;

        const x = mt3 * startX + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * endX;
        const y = mt3 * startY + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * endY;
        points.push({ x, y });
    }
    return points;
}

async function attemptTurnstileCdp(page) {
    const frames = page.frames();
    console.log(`\n[TEST] Checking ${frames.length} frames for Turnstile...`);

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        try {
            const frameUrl = frame.url();
            console.log(`[TEST] Frame ${i}: ${frameUrl.substring(0, 80)}...`);

            if (!frameUrl.includes('cloudflare') && !frameUrl.includes('turnstile')) {
                console.log(`[TEST]   → Skipping (not Cloudflare/Turnstile)`);
                continue;
            }

            const data = await frame.evaluate(() => window.__turnstile_data).catch(() => null);

            if (data) {
                console.log(`[TEST] ✓ Found Turnstile checkbox in frame ${i}!`);
                console.log(`[TEST]   Ratios: xRatio=${data.xRatio.toFixed(4)}, yRatio=${data.yRatio.toFixed(4)}`);

                const iframeElement = await frame.frameElement();
                if (!iframeElement) {
                    console.log('[TEST] ✗ Cannot get iframe element');
                    continue;
                }

                const box = await iframeElement.boundingBox();
                if (!box) {
                    console.log('[TEST] ✗ Cannot get iframe bounding box');
                    continue;
                }

                const clickX = box.x + (box.width * data.xRatio);
                const clickY = box.y + (box.height * data.yRatio);

                console.log(`[TEST]   Iframe box: x=${box.x.toFixed(2)}, y=${box.y.toFixed(2)}, w=${box.width.toFixed(2)}, h=${box.height.toFixed(2)}`);
                console.log(`[TEST]   Target coordinates: (${clickX.toFixed(2)}, ${clickY.toFixed(2)})`);

                const client = await page.context().newCDPSession(page);

                const startX = clickX + (Math.random() - 0.5) * 200;
                const startY = clickY + (Math.random() - 0.5) * 200;

                console.log(`[TEST] Simulating mouse movement...`);
                const path = generateBezierPath(startX, startY, clickX, clickY, 25);

                for (const point of path) {
                    await client.send('Input.dispatchMouseEvent', {
                        type: 'mouseMoved',
                        x: point.x,
                        y: point.y
                    });
                    await new Promise(r => setTimeout(r, 2 + Math.random() * 3));
                }

                const hoverTime = 150 + Math.random() * 200;
                console.log(`[TEST] Hovering for ${hoverTime.toFixed(0)}ms...`);
                await page.waitForTimeout(hoverTime);

                console.log(`[TEST] Clicking...`);
                await client.send('Input.dispatchMouseEvent', {
                    type: 'mousePressed',
                    x: clickX,
                    y: clickY,
                    button: 'left',
                    clickCount: 1
                });

                const clickDuration = 80 + Math.random() * 100;
                await new Promise(r => setTimeout(r, clickDuration));

                await client.send('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: clickX,
                    y: clickY,
                    button: 'left',
                    clickCount: 1
                });

                console.log(`[TEST] ✓ Click sequence completed (duration: ${clickDuration.toFixed(0)}ms)!`);
                await client.detach();
                return true;
            }
        } catch (e) {
            console.log(`[TEST] Frame ${i} error: ${e.message}`);
        }
    }
    return false;
}

function checkPort(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}/json/version`, (res) => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.end();
    });
}

async function launchNativeChrome() {
    console.log('[TEST] Checking if Chrome is running on port ' + DEBUG_PORT + '...');
    if (await checkPort(DEBUG_PORT)) {
        console.log('[TEST] Chrome is already open.');
        return;
    }

    console.log('[TEST] Launching native Chrome...');
    const args = [
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${USER_DATA_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
    ];

    if (HEADLESS) {
        args.push('--headless=new');
    }

    const chrome = spawn(CHROME_PATH, args, {
        detached: true,
        stdio: 'ignore'
    });
    chrome.unref();

    console.log('[TEST] Waiting for Chrome to initialize...');
    for (let i = 0; i < 20; i++) {
        if (await checkPort(DEBUG_PORT)) break;
        await new Promise(r => setTimeout(r, 1000));
    }

    if (!await checkPort(DEBUG_PORT)) {
        console.error('[TEST] Chrome failed to start on port ' + DEBUG_PORT);
        throw new Error('Chrome launch failed');
    }
    console.log('[TEST] Chrome started successfully!');
}

(async () => {
    console.log('\n===========================================');
    console.log('  Katabump Turnstile 测试脚本');
    console.log('===========================================\n');

    try {
        await launchNativeChrome();

        console.log('[TEST] Connecting to Chrome...');
        let browser;
        for (let k = 0; k < 5; k++) {
            try {
                browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
                console.log('[TEST] Connected successfully!\n');
                break;
            } catch (e) {
                console.log(`[TEST] Connection attempt ${k + 1} failed. Retrying...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (!browser) {
            console.error('[TEST] Failed to connect to Chrome. Exiting.');
            process.exit(1);
        }

        const context = browser.contexts()[0];
        const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
        page.setDefaultTimeout(60000);

        await page.addInitScript(INJECTED_SCRIPT);
        console.log('[TEST] Injection script added.\n');

        console.log('[TEST] Navigating to Katabump login page...');
        await page.goto('https://dashboard.katabump.com/auth/login');
        await page.waitForTimeout(3000);

        console.log('[TEST] Page loaded. Waiting for Turnstile to appear...\n');

        // 尝试检测 Turnstile（最多 30 秒）
        let found = false;
        for (let attempt = 1; attempt <= 30; attempt++) {
            console.log(`[TEST] === Attempt ${attempt}/30 ===`);
            found = await attemptTurnstileCdp(page);

            if (found) {
                console.log('\n[TEST] ✓✓✓ SUCCESS! Turnstile was clicked! ✓✓✓');
                console.log('[TEST] Waiting 10 seconds to observe the result...\n');
                await page.waitForTimeout(10000);

                // 检查是否成功
                const frames = page.frames();
                let success = false;
                for (const f of frames) {
                    if (f.url().includes('cloudflare')) {
                        try {
                            if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                console.log('[TEST] ✓✓✓ Cloudflare verification SUCCESS detected! ✓✓✓\n');
                                success = true;
                                break;
                            }
                        } catch (e) { }
                    }
                }

                if (!success) {
                    console.log('[TEST] ⚠ Click was sent, but "Success!" message not detected.');
                    console.log('[TEST] This might still work - please observe the browser window.\n');
                }

                break;
            }

            await page.waitForTimeout(1000);
        }

        if (!found) {
            console.log('\n[TEST] ✗✗✗ FAILED: Could not find or click Turnstile after 30 attempts. ✗✗✗');
            console.log('[TEST] Please check:');
            console.log('[TEST]   1. Is Turnstile visible in the browser window?');
            console.log('[TEST]   2. Are there any errors in the console?');
            console.log('[TEST]   3. Is the page fully loaded?\n');
        }

        console.log('[TEST] Test completed. Browser will remain open for inspection.');
        console.log('[TEST] Press Ctrl+C to close.\n');

    } catch (err) {
        console.error('[TEST] Error:', err);
        process.exit(1);
    }
})();
