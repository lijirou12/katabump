const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const http = require('http');

// 启用 stealth 插件
chromium.use(stealth);

const CHROME_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const USER_DATA_DIR = path.join(__dirname, 'ChromeData_Katabump');
const DEBUG_PORT = 9222;
const HEADLESS = false;
// const HTTP_PROXY = ""
// --- Proxy Configuration ---
const HTTP_PROXY = process.env.HTTP_PROXY; // e.g., http://user:pass@1.2.3.4:8080 or http://1.2.3.4:8080
let PROXY_CONFIG = null;

if (HTTP_PROXY) {
    try {
        const proxyUrl = new URL(HTTP_PROXY);
        PROXY_CONFIG = {
            server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
            username: proxyUrl.username ? decodeURIComponent(proxyUrl.username) : undefined,
            password: proxyUrl.password ? decodeURIComponent(proxyUrl.password) : undefined
        };
        console.log(`[Proxy] Configuration detected: Server=${PROXY_CONFIG.server}, Auth=${PROXY_CONFIG.username ? 'Yes' : 'No'}`);
    } catch (e) {
        console.error('[Proxy] Invalid HTTP_PROXY format. Expected: http://user:pass@host:port or http://host:port');
        process.exit(1);
    }
}


// --- injected.js 核心逻辑 (增强版) ---
// 这个脚本会被注入到每个 Frame 中。它劫持 attachShadow 以捕获 Turnstile 的 checkbox，
// 计算其相对于 Frame 视口的位置比例，并存入 window.__turnstile_data 供外部读取。
const INJECTED_SCRIPT = `
(function() {
    // 只在 iframe 中运行（Turnstile 通常在 iframe 里）
    if (window.self === window.top) return;

    console.log('[Turnstile Injected] Script loaded in iframe:', window.location.href);

    // 1. 模拟鼠标屏幕坐标
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
        console.log('[Turnstile Injected] screenX/Y override failed:', e.message);
    }

    // 2. 多种选择器查找 Turnstile checkbox
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
                console.log('[Turnstile Injected] Found element with selector:', selector);
                return element;
            }
        }
        return null;
    }

    // 3. attachShadow Hook
    try {
        const originalAttachShadow = Element.prototype.attachShadow;

        Element.prototype.attachShadow = function(init) {
            const shadowRoot = originalAttachShadow.call(this, init);

            if (shadowRoot) {
                console.log('[Turnstile Injected] Shadow root attached');

                const checkAndReport = () => {
                    const checkbox = findTurnstileCheckbox(shadowRoot);
                    if (checkbox) {
                        const rect = checkbox.getBoundingClientRect();
                        console.log('[Turnstile Injected] Checkbox rect:', rect);

                        // 确保元素已渲染且可见
                        if (rect.width > 0 && rect.height > 0 && window.innerWidth > 0 && window.innerHeight > 0) {
                            const xRatio = (rect.left + rect.width / 2) / window.innerWidth;
                            const yRatio = (rect.top + rect.height / 2) / window.innerHeight;

                            console.log('[Turnstile Injected] ✓ Checkbox found! Ratios:', { xRatio, yRatio });

                            // 暴露数据给 Playwright
                            window.__turnstile_data = { xRatio, yRatio, timestamp: Date.now() };
                            return true;
                        }
                    }
                    return false;
                };

                // 立即检查一次
                if (!checkAndReport()) {
                    // 如果没找到，监听 DOM 变化
                    const observer = new MutationObserver(() => {
                        if (checkAndReport()) observer.disconnect();
                    });
                    observer.observe(shadowRoot, { childList: true, subtree: true });

                    // 也定期检查（防止 observer 漏掉）
                    const interval = setInterval(() => {
                        if (checkAndReport()) {
                            clearInterval(interval);
                            observer.disconnect();
                        }
                    }, 500);

                    // 30秒后停止
                    setTimeout(() => {
                        clearInterval(interval);
                        observer.disconnect();
                    }, 30000);
                }
            }
            return shadowRoot;
        };
        console.log('[Turnstile Injected] attachShadow hook installed');
    } catch (e) {
        console.error('[Turnstile Injected] Error hooking attachShadow:', e);
    }

    // 4. 也尝试直接在 document 上查找（有些情况下不在 shadow root 里）
    function checkDocument() {
        const checkbox = findTurnstileCheckbox(document);
        if (checkbox) {
            const rect = checkbox.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const xRatio = (rect.left + rect.width / 2) / window.innerWidth;
                const yRatio = (rect.top + rect.height / 2) / window.innerHeight;
                console.log('[Turnstile Injected] ✓ Found in document! Ratios:', { xRatio, yRatio });
                window.__turnstile_data = { xRatio, yRatio, timestamp: Date.now() };
                return true;
            }
        }
        return false;
    }

    // 定期检查 document
    const docInterval = setInterval(() => {
        if (checkDocument()) clearInterval(docInterval);
    }, 500);

    setTimeout(() => clearInterval(docInterval), 30000);
})();
`;

// 辅助函数：检测代理是否可用
async function checkProxy() {
    if (!PROXY_CONFIG) return true;

    console.log('[Proxy] Validating proxy connection...');
    try {
        const axiosConfig = {
            proxy: {
                protocol: 'http',
                host: new URL(PROXY_CONFIG.server).hostname,
                port: new URL(PROXY_CONFIG.server).port,
            },
            timeout: 10000
        };

        if (PROXY_CONFIG.username && PROXY_CONFIG.password) {
            axiosConfig.proxy.auth = {
                username: PROXY_CONFIG.username,
                password: PROXY_CONFIG.password
            };
        }

        // 尝试访问一个可靠的测试地址 (Cloudflare Trace 或者 Google)
        await axios.get('https://www.google.com', axiosConfig);
        console.log('[Proxy] Connection successful!');
        return true;
    } catch (error) {
        console.error(`[Proxy] Connection failed: ${error.message}`);
        return false;
    }
}

// 辅助函数：检测端口是否开放
function checkPort(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}/json/version`, (res) => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.end();
    });
}

// 辅助函数：启动原生 Chrome
async function launchNativeChrome() {
    console.log('Checking if Chrome is already running on port ' + DEBUG_PORT + '...');
    if (await checkPort(DEBUG_PORT)) {
        console.log('Chrome is already open.');
        return;
    }

    console.log('Launching native Chrome...');
    const args = [
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${USER_DATA_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
    ];

    if (PROXY_CONFIG) {
        // Chrome 命令行只接受 server 地址，认证需要在 playright 层或者插件层处理
        // 这里我们要 strip 掉 username:password
        args.push(`--proxy-server=${PROXY_CONFIG.server}`);
        // 确保 Chrome 自身请求 localhost (如 CDP) 不走代理
        args.push('--proxy-bypass-list=<-loopback>');
    }

    if (HEADLESS) {
        args.push('--headless=new');
    }

    const chrome = spawn(CHROME_PATH, args, {
        detached: true,
        stdio: 'ignore'
    });
    chrome.unref();

    console.log('Waiting for Chrome to initialize...');
    for (let i = 0; i < 20; i++) {
        if (await checkPort(DEBUG_PORT)) break;
        await new Promise(r => setTimeout(r, 1000));
    }

    if (!await checkPort(DEBUG_PORT)) {
        console.error('Chrome failed to start on port ' + DEBUG_PORT);
        if (!checkPort(DEBUG_PORT)) {
            try { chrome.kill(); } catch (e) { }
        }
        throw new Error('Chrome launch failed');
    }
}

// 从 login.json 读取用户列表
function getUsers() {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'login.json'), 'utf8');
        const json = JSON.parse(data);
        return Array.isArray(json) ? json : (json.users || []);
    } catch (e) {
        console.error('Error reading login.json:', e);
        return [];
    }
}

/**
 * 生成贝塞尔曲线路径点，模拟自然鼠标移动
 */
function generateBezierPath(startX, startY, endX, endY, steps = 20) {
    const points = [];
    // 生成两个随机控制点
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

/**
 * 核心功能：遍历所有 Frames，查找被注入脚本标记的 Turnstile 坐标，
 * 计算绝对屏幕坐标，并使用 CDP 发送原生鼠标点击事件。
 * 增强版：添加自然鼠标移动轨迹和悬停
 */
async function attemptTurnstileCdp(page) {
    const frames = page.frames();
    console.log(`>> Checking ${frames.length} frames for Turnstile...`);

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        try {
            const frameUrl = frame.url();
            // 优先检查 Cloudflare 域名的 iframe
            if (!frameUrl.includes('cloudflare') && !frameUrl.includes('turnstile')) {
                continue;
            }

            console.log(`>> Frame ${i}: ${frameUrl.substring(0, 60)}...`);

            // 检查当前 Frame 是否捕获到了 Turnstile 数据
            const data = await frame.evaluate(() => window.__turnstile_data).catch(() => null);

            if (data) {
                console.log('>> ✓ Found Turnstile checkbox! Ratios:', data);

                // 获取 iframe 元素在主页面中的位置
                const iframeElement = await frame.frameElement();
                if (!iframeElement) {
                    console.log('>> ✗ Cannot get iframe element');
                    continue;
                }

                const box = await iframeElement.boundingBox();
                if (!box) {
                    console.log('>> ✗ Cannot get iframe bounding box');
                    continue;
                }

                // 计算绝对坐标：iframe 左上角 + (iframe 宽/高 * 比例)
                const clickX = box.x + (box.width * data.xRatio);
                const clickY = box.y + (box.height * data.yRatio);

                console.log(`>> Target coordinates: (${clickX.toFixed(2)}, ${clickY.toFixed(2)})`);
                console.log(`>> Iframe box: x=${box.x.toFixed(2)}, y=${box.y.toFixed(2)}, w=${box.width.toFixed(2)}, h=${box.height.toFixed(2)}`);

                // 创建 CDP 会话
                const client = await page.context().newCDPSession(page);

                // 1. 先移动鼠标到一个随机起始位置
                const startX = clickX + (Math.random() - 0.5) * 200;
                const startY = clickY + (Math.random() - 0.5) * 200;

                // 2. 生成贝塞尔曲线路径
                console.log('>> Simulating human-like mouse movement...');
                const path = generateBezierPath(startX, startY, clickX, clickY, 25);

                // 3. 沿路径移动鼠标
                for (const point of path) {
                    await client.send('Input.dispatchMouseEvent', {
                        type: 'mouseMoved',
                        x: point.x,
                        y: point.y
                    });
                    await new Promise(r => setTimeout(r, 2 + Math.random() * 3)); // 每步2-5ms
                }

                // 4. 悬停在目标位置上
                console.log('>> Hovering over checkbox...');
                await page.waitForTimeout(150 + Math.random() * 200); // 150-350ms 悬停

                // 5. 执行点击：MousePressed
                console.log('>> Clicking...');
                await client.send('Input.dispatchMouseEvent', {
                    type: 'mousePressed',
                    x: clickX,
                    y: clickY,
                    button: 'left',
                    clickCount: 1
                });

                // 6. 模拟人类点击持续时间 (80-180ms)
                await new Promise(r => setTimeout(r, 80 + Math.random() * 100));

                // 7. MouseReleased
                await client.send('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: clickX,
                    y: clickY,
                    button: 'left',
                    clickCount: 1
                });

                console.log('>> ✓ Click sequence completed successfully!');
                await client.detach();
                return true; // 成功点击
            }
        } catch (e) {
            // 忽略 Frame 访问错误（跨域等）
            console.log(`>> Frame ${i} error: ${e.message}`);
        }
    }
    return false;
}

(async () => {
    const users = getUsers();
    if (users.length === 0) {
        console.log('No users found in login.json');
        return;
    }

    // 检查代理有效性
    if (PROXY_CONFIG) {
        const isValid = await checkProxy();
        if (!isValid) {
            console.error('[Proxy] Aborting due to invalid proxy.');
            process.exit(1);
        }
    }

    await launchNativeChrome();

    console.log(`Connecting to Chrome instance...`);
    let browser;
    for (let k = 0; k < 5; k++) {
        try {
            browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
            console.log('Successfully connected!');
            break;
        } catch (e) {
            console.log(`Connection attempt ${k + 1} failed. Retrying in 2s...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    if (!browser) {
        console.error('Failed to connect. Exiting.');
        return;
    }

    const context = browser.contexts()[0];
    let page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    page.setDefaultTimeout(60000);

    // --- 代理认证处理 ---
    if (PROXY_CONFIG && PROXY_CONFIG.username) {
        console.log('[Proxy] Setting up authentication...');
        await context.setHTTPCredentials({
            username: PROXY_CONFIG.username,
            password: PROXY_CONFIG.password
        });
    } else {
        // 如果没有代理(或者代理无认证)，清除之前的认证信息，防止干扰
        await context.setHTTPCredentials(null);
    }

    // --- 关键：注入 Hook 脚本 ---
    // 这会在每次页面加载/导航前执行，确保能拦截到 Turnstile 的创建
    await page.addInitScript(INJECTED_SCRIPT);
    console.log('Injection script added to page context.');

    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        console.log(`\n=== Processing User ${i + 1}/${users.length}: ${user.username} ===`);

        try {
            if (page.isClosed()) {
                page = await context.newPage();
                // Context credentials should persist, no need to re-auth per page
                await page.addInitScript(INJECTED_SCRIPT); // 新页面也要注入
            }

            // 登录逻辑保持不变...
            console.log('Checking session state...');
            if (page.url().includes('/auth/login')) {
                // Already on login logic
            } else if (page.url().includes('dashboard')) {
                await page.goto('https://dashboard.katabump.com/auth/logout');
                await page.waitForTimeout(2000);
            } else {
                await page.goto('https://dashboard.katabump.com/auth/login');
                await page.waitForTimeout(2000);
                if (page.url().includes('dashboard')) {
                    await page.goto('https://dashboard.katabump.com/auth/logout');
                    await page.waitForTimeout(2000);
                    await page.goto('https://dashboard.katabump.com/auth/login');
                }
            }

            console.log('Filling credentials...');
            try {
                const emailInput = page.getByRole('textbox', { name: 'Email' });
                await emailInput.waitFor({ state: 'visible', timeout: 5000 });
                await emailInput.fill(user.username);
                const pwdInput = page.getByRole('textbox', { name: 'Password' });
                await pwdInput.fill(user.password);
                await page.waitForTimeout(500);

                // --- Cloudflare Turnstile Bypass for Login ---
                console.log('   >> Checking for Turnstile before login (using CDP bypass)...');
                let cdpClickResult = false;
                for (let findAttempt = 0; findAttempt < 15; findAttempt++) {
                    cdpClickResult = await attemptTurnstileCdp(page);
                    if (cdpClickResult) break;
                    // console.log(`   >> [Login Find Attempt ${findAttempt + 1}/15] Turnstile checkbox not found yet...`);
                    await page.waitForTimeout(1000);
                }

                if (cdpClickResult) {
                    console.log('   >> CDP Click active for login. Waiting up to 10s for Cloudflare success...');
                    // Wait for the "Success!" mark in any cloudflare frame
                    for (let waitSec = 0; waitSec < 10; waitSec++) {
                        const frames = page.frames();
                        let isSuccess = false;
                        for (const f of frames) {
                            if (f.url().includes('cloudflare')) {
                                try {
                                    if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                        isSuccess = true;
                                        break;
                                    }
                                } catch (e) { }
                            }
                        }
                        if (isSuccess) {
                            console.log('   >> Turnstile verification successful before login.');
                            break;
                        }
                        await page.waitForTimeout(1000);
                    }
                } else {
                    console.log('   >> No Turnstile detected or clicked before login, proceeding anyway...');
                }
                // --------------------------------------------

                await page.getByRole('button', { name: 'Login', exact: true }).click();

                // User Request: Check for "Incorrect password or no account"
                try {
                    const errorMsg = page.getByText('Incorrect password or no account');
                    if (await errorMsg.isVisible({ timeout: 3000 })) {
                        console.error(`   >> ❌ Login failed: Incorrect password or no account for user ${user.username}`);

                        // Screenshot for login failure
                        const photoDir = path.join(__dirname, 'photo');
                        if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
                        try { await page.screenshot({ path: path.join(photoDir, `${user.username}.png`), fullPage: true }); } catch (e) { }

                        // Skip to next user
                        continue;
                    }
                } catch (e) { }

            } catch (e) {
                // 可能已经登录了，或者是其他 UI 状态
                console.log('Login form interaction error (maybe already logged in?):', e.message);
            }

            console.log('Waiting for "See" link...');
            try {
                await page.getByRole('link', { name: 'See' }).first().waitFor({ timeout: 15000 });
                await page.waitForTimeout(1000);
                await page.getByRole('link', { name: 'See' }).first().click();
            } catch (e) {
                console.log('Could not find "See" button. Checking if already on detail page or login failed.');
                if (page.url().includes('login')) {
                    console.error('Login failed for user ' + user.username);
                    continue;
                }
            }

            let renewSuccess = false;
            // 2. 一个扁平化的主循环：尝试 Renew 整个流程 (最多 20 次)
            for (let attempt = 1; attempt <= 20; attempt++) {
                let hasCaptchaError = false;

                // 1. 如果是重试 (attempt > 1)，说明之前失败了或者刚刷新完页面
                // 我们直接开始寻找 Renew 按钮
                console.log(`\n[Attempt ${attempt}/20] Looking for Renew button...`);

                const renewBtn = page.getByRole('button', { name: 'Renew', exact: true }).first();
                try {
                    // 稍微等待一下，防止页面刚刷新还没渲染出来
                    await renewBtn.waitFor({ state: 'visible', timeout: 5000 });
                } catch (e) { }

                if (await renewBtn.isVisible()) {
                    await renewBtn.click();
                    console.log('Renew button clicked. Waiting for modal...');

                    const modal = page.locator('#renew-modal');
                    try { await modal.waitFor({ state: 'visible', timeout: 5000 }); } catch (e) {
                        console.log('Modal did not appear? Retrying...');
                        continue;
                    }

                    // A. 在模态框里晃晃鼠标
                    try {
                        const box = await modal.boundingBox();
                        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
                    } catch (e) { }

                    // B. 找 Turnstile (小重试)
                    console.log('Checking for Turnstile (using CDP bypass)...');
                    let cdpClickResult = false;
                    for (let findAttempt = 0; findAttempt < 30; findAttempt++) {
                        cdpClickResult = await attemptTurnstileCdp(page);
                        if (cdpClickResult) break;
                        console.log(`   >> [Find Attempt ${findAttempt + 1}/30] Turnstile checkbox not found yet...`);
                        await page.waitForTimeout(1000);
                    }

                    let isTurnstileSuccess = false;
                    if (cdpClickResult) {
                        console.log('   >> CDP Click active. Waiting 8s for Cloudflare check...');
                        await page.waitForTimeout(8000);
                    } else {
                        console.log('   >> Turnstile checkbox not confirmed after retries.');
                    }

                    // C. 检查 Success 标志
                    const frames = page.frames();
                    for (const f of frames) {
                        if (f.url().includes('cloudflare')) {
                            try {
                                if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                    console.log('   >> Detected "Success!" in Turnstile iframe.');
                                    isTurnstileSuccess = true;
                                    break;
                                }
                            } catch (e) { }
                        }
                    }

                    // D. 准备点击确认
                    const confirmBtn = modal.getByRole('button', { name: 'Renew' });
                    if (await confirmBtn.isVisible()) {

                        // User Requested: Screenshot BEFORE final click (Regardless of CDP status)
                        const photoDir = path.join(__dirname, 'photo');
                        if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
                        const tsScreenshotName = `${user.username}_Turnstile_${attempt}.png`;
                        try {
                            await page.screenshot({ path: path.join(photoDir, tsScreenshotName), fullPage: true });
                            console.log(`   >> 📸 Snapshot saved: ${tsScreenshotName}`);
                        } catch (e) {
                            console.log('   >> Failed to take Turnstile snapshot:', e.message);
                        }

                        // User Request: 找不到的话这个循环直接下一步点击renew，然后检测有没有Please complete the captcha to continue
                        console.log('   >> Clicking Renew confirm button (regardless of Turnstile status)...');
                        await confirmBtn.click();

                        try {
                            // 1. Check for "Please complete the captcha" error
                            const startVerifyTime = Date.now();
                            while (Date.now() - startVerifyTime < 3000) {
                                // A. Captcha Error
                                if (await page.getByText('Please complete the captcha to continue').isVisible()) {
                                    console.log('   >> ⚠️ Error detected: "Please complete the captcha".');
                                    hasCaptchaError = true;
                                    break;
                                }

                                // B. Not Renew Time Error
                                // content: "You can't renew your server yet. You will be able to as of 02 February (in 3 day(s))."
                                const notTimeLoc = page.getByText("You can't renew your server yet");
                                if (await notTimeLoc.isVisible()) {
                                    const text = await notTimeLoc.innerText();
                                    const match = text.match(/as of\s+(.*?)\s+\(/);
                                    let dateStr = match ? match[1] : 'Unknown Date';
                                    console.log(`   >> ⏳ Cannot renew yet. Next renewal available as of: ${dateStr}`);

                                    // Treat this as a "successful" run so we don't retry loop
                                    renewSuccess = true;
                                    // Manually close modal
                                    try {
                                        const closeBtn = modal.getByLabel('Close');
                                        if (await closeBtn.isVisible()) await closeBtn.click();
                                    } catch (e) { }
                                    break; // Break loop
                                }

                                await page.waitForTimeout(200);
                            }
                        } catch (e) { }

                        if (renewSuccess) break; // 如果是因为还没到时间，直接跳出大循环

                        if (hasCaptchaError) {
                            console.log('   >> Error found. Refreshing page to reset Turnstile...');
                            await page.reload();
                            await page.waitForTimeout(3000);
                            continue; // 刷新后，重新开始大循环
                        }

                        // F. 检查成功 (模态框消失)
                        await page.waitForTimeout(2000);
                        if (!await modal.isVisible()) {
                            console.log('   >> ✅ Modal closed. Renew successful!');
                            renewSuccess = true;
                            // 成功了！退出循环
                            break;
                        } else {
                            console.log('   >> Modal still open but no error? Weird. Retrying loop...');
                            // 可以选择 continue 或只是重试下一次循环，这里我们选择刷新重来，确保稳健
                            await page.reload();
                            await page.waitForTimeout(3000);
                            continue;
                        }
                    } else {
                        console.log('   >> Verify button inside modal not found? Refreshing...');
                        await page.reload();
                        await page.waitForTimeout(3000);
                        continue;
                    }

                } else {
                    console.log('Renew button not found (Server might be already renewed or page load error).');
                    // 如果是还没加载出来，那我们可能不需要 break，而是重试几次?
                    // 但这里为了简化逻辑，如果经过 waitFor 5s 还不是 visible，我们假设已经续期了或者不在列表里
                    // 但考虑到用户想要的是 retry，如果真的没找到，也许我们应该 break
                    break;
                }
            }

        } catch (err) {
            console.error(`Error processing user ${user.username}:`, err);
        }

        // Snapshot before handling next user (Normal end of loop)
        const photoDir = path.join(__dirname, 'photo');
        if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
        const screenshotPath = path.join(photoDir, `${user.username}.png`);
        try {
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`Saved screenshot to: ${screenshotPath}`);
        } catch (e) {
            console.log('Failed to take screenshot:', e.message);
        }

        console.log(`Finished User ${user.username}\n`);
    }

    console.log('All users processed.');
    console.log('Closing browser connection.');
    await browser.close();
})();
