const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const http = require('http');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

async function sendTelegramMessage(message, imagePath = null) {
    if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;

    // 1. 发送文字消息
    try {
        const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TG_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
        console.log('[Telegram] Message sent.');
    } catch (e) {
        console.error('[Telegram] Failed to send message:', e.message);
    }

    // 2. 发送图片 (如果有)
    if (imagePath && fs.existsSync(imagePath)) {
        console.log('[Telegram] Sending photo...');
        // 使用 curl 发送图片，避免引入额外的 multipart 依赖
        // 注意：Windows 本地测试可能需要环境支持 curl，GitHub Actions (Ubuntu) 默认支持
        const cmd = `curl -s -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto" -F chat_id="${TG_CHAT_ID}" -F photo="@${imagePath}"`;
        await new Promise(resolve => {
            exec(cmd, (err) => {
                if (err) console.error('[Telegram] Failed to send photo via curl:', err.message);
                else console.log('[Telegram] Photo sent.');
                resolve();
            });
        });
    }
}

// 启用 stealth 插件
chromium.use(stealth);

// GitHub Actions 环境下的 Chrome 路径 (通常是 google-chrome)
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const DEBUG_PORT = 9222;

// 确保 localhost 不走代理
process.env.NO_PROXY = 'localhost,127.0.0.1';

// --- Proxy Configuration ---
const HTTP_PROXY = process.env.HTTP_PROXY;
let PROXY_CONFIG = null;

if (HTTP_PROXY) {
    try {
        const proxyUrl = new URL(HTTP_PROXY);
        PROXY_CONFIG = {
            server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
            username: proxyUrl.username ? decodeURIComponent(proxyUrl.username) : undefined,
            password: proxyUrl.password ? decodeURIComponent(proxyUrl.password) : undefined
        };
        console.log(`[代理] 检测到配置: 服务器=${PROXY_CONFIG.server}, 认证=${PROXY_CONFIG.username ? '是' : '否'}`);
    } catch (e) {
        console.error('[代理] TODO HTTP_PROXY 格式无效。期望格式: http://user:pass@host:port 或 http://host:port');
        process.exit(1);
    }
}

// --- INJECTED_SCRIPT (增强版) ---
const INJECTED_SCRIPT = `
(function() {
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

                        if (rect.width > 0 && rect.height > 0 && window.innerWidth > 0 && window.innerHeight > 0) {
                            const xRatio = (rect.left + rect.width / 2) / window.innerWidth;
                            const yRatio = (rect.top + rect.height / 2) / window.innerHeight;

                            console.log('[Turnstile Injected] ✓ Checkbox found! Ratios:', { xRatio, yRatio });

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
        console.log('[Turnstile Injected] attachShadow hook installed');
    } catch (e) {
        console.error('[Turnstile Injected] Error hooking attachShadow:', e);
    }

    // 4. 也尝试直接在 document 上查找
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

    const docInterval = setInterval(() => {
        if (checkDocument()) clearInterval(docInterval);
    }, 500);

    setTimeout(() => clearInterval(docInterval), 30000);
})();
`;

// 辅助函数：检测代理是否可用
async function checkProxy() {
    if (!PROXY_CONFIG) return true;

    console.log('[代理] 正在验证代理连接...');
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

        await axios.get('https://www.google.com', axiosConfig);
        console.log('[代理] 连接成功！');
        return true;
    } catch (error) {
        console.error(`[代理] 连接失败: ${error.message}`);
        return false;
    }
}

function checkPort(port) {
    return new Promise((resolve) => {
        const net = require('net');
        const socket = new net.Socket();

        socket.setTimeout(2000);

        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });

        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });

        socket.connect(port, 'localhost');
    });
}

async function launchChrome() {
    console.log('检查 Chrome 是否已在端口 ' + DEBUG_PORT + ' 上运行...');
    if (await checkPort(DEBUG_PORT)) {
        console.log('Chrome 已开启。');
        return;
    }

    // 清理旧的用户数据目录
    try {
        const fs = require('fs');
        if (fs.existsSync('/tmp/chrome_user_data')) {
            console.log('清理旧的 Chrome 用户数据...');
            require('child_process').execSync('rm -rf /tmp/chrome_user_data');
        }
    } catch (e) {
        console.log('清理用户数据失败（可忽略）:', e.message);
    }

    // 检查 Chrome 是否存在
    try {
        const fs = require('fs');
        if (!fs.existsSync(CHROME_PATH)) {
            console.error(`Chrome 未找到: ${CHROME_PATH}`);
            // 尝试查找其他可能的路径
            const possiblePaths = [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser'
            ];
            for (const path of possiblePaths) {
                if (fs.existsSync(path)) {
                    console.log(`找到替代 Chrome: ${path}`);
                    break;
                }
            }
        }
    } catch (e) { }

    console.log(`正在启动 Chrome (路径: ${CHROME_PATH})...`);

    const args = [
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--no-first-run',
        '--no-default-browser-check',
        // '--headless=new', // (已被注释) 使用 xvfb-run 时不需要 headless 模式，这样可以模拟有头浏览器增加成功率
        '--disable-gpu',
        '--window-size=1280,720',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // 避免共享内存不足
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=IsolateOrigins,site-per-process',
        '--user-data-dir=/tmp/chrome_user_data' // 必须指定用户数据目录，否则远程调试可能失败
    ];

    if (PROXY_CONFIG) {
        args.push(`--proxy-server=${PROXY_CONFIG.server}`);
        args.push('--proxy-bypass-list=<-loopback>');
    }
    // 添加针对 Linux 环境的额外稳定性参数
    args.push('--disable-dev-shm-usage'); // 避免共享内存不足


    const chrome = spawn(CHROME_PATH, args, {
        detached: true,
        stdio: 'ignore'
    });
    chrome.unref();

    console.log('正在等待 Chrome 初始化...');
    for (let i = 0; i < 40; i++) {  // 从 30 增加到 40
        // 先检查 TCP 端口
        if (await checkPort(DEBUG_PORT)) {
            console.log(`端口 ${DEBUG_PORT} 已打开，检查 CDP 端点...`);
            // 再检查 HTTP 端点
            try {
                const response = await new Promise((resolve) => {
                    const req = http.get(`http://localhost:${DEBUG_PORT}/json/version`, (res) => {
                        resolve(true);
                    });
                    req.on('error', () => resolve(false));
                    req.setTimeout(3000, () => {
                        req.destroy();
                        resolve(false);
                    });
                });
                if (response) {
                    console.log('Chrome 已成功启动！');
                    break;
                }
            } catch (e) { }
        }
        await new Promise(r => setTimeout(r, 1000));
        if (i % 5 === 4) {
            console.log(`等待中... ${i + 1}/40 秒`);
        }
    }

    if (!await checkPort(DEBUG_PORT)) {
        console.error('Chrome 无法在端口 ' + DEBUG_PORT + ' 上启动');
        console.error('尝试检查 Chrome 进程...');
        try {
            const { exec } = require('child_process');
            await new Promise((resolve) => {
                exec('ps aux | grep chrome', (err, stdout) => {
                    console.error('Chrome 进程列表:', stdout);
                    resolve();
                });
            });
            // 最后尝试检查 HTTP 端点
            console.error('尝试直接访问 CDP 端点...');
            await new Promise((resolve) => {
                const req = http.get(`http://localhost:${DEBUG_PORT}/json/version`, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        console.error('CDP 响应:', data);
                        resolve();
                    });
                });
                req.on('error', (e) => {
                    console.error('CDP 连接错误:', e.message);
                    resolve();
                });
                req.setTimeout(5000, () => {
                    req.destroy();
                    console.error('CDP 连接超时');
                    resolve();
                });
            });
        } catch (e) { }
        throw new Error('Chrome 启动失败');
    }
}

function getUsers() {
    // 从环境变量读取 JSON 字符串
    // GitHub Actions Secret: USERS_JSON = [{"username":..., "password":...}]
    try {
        if (process.env.USERS_JSON) {
            const parsed = JSON.parse(process.env.USERS_JSON);
            return Array.isArray(parsed) ? parsed : (parsed.users || []);
        }
    } catch (e) {
        console.error('解析 USERS_JSON 环境变量错误:', e);
    }
    return [];
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

            const data = await frame.evaluate(() => window.__turnstile_data).catch(() => null);

            if (data) {
                console.log('>> ✓ Found Turnstile checkbox! Ratios:', data);

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

                const clickX = box.x + (box.width * data.xRatio);
                const clickY = box.y + (box.height * data.yRatio);

                console.log(`>> Target coordinates: (${clickX.toFixed(2)}, ${clickY.toFixed(2)})`);
                console.log(`>> Iframe box: x=${box.x.toFixed(2)}, y=${box.y.toFixed(2)}, w=${box.width.toFixed(2)}, h=${box.height.toFixed(2)}`);

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
                    await new Promise(r => setTimeout(r, 2 + Math.random() * 3));
                }

                // 4. 悬停在目标位置上
                console.log('>> Hovering over checkbox...');
                await page.waitForTimeout(150 + Math.random() * 200);

                // 5. 执行点击
                console.log('>> Clicking...');
                await client.send('Input.dispatchMouseEvent', {
                    type: 'mousePressed',
                    x: clickX,
                    y: clickY,
                    button: 'left',
                    clickCount: 1
                });

                await new Promise(r => setTimeout(r, 80 + Math.random() * 100));

                await client.send('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: clickX,
                    y: clickY,
                    button: 'left',
                    clickCount: 1
                });

                console.log('>> ✓ Click sequence completed successfully!');
                await client.detach();
                return true;
            }
        } catch (e) {
            console.log(`>> Frame ${i} error: ${e.message}`);
        }
    }
    return false;
}

(async () => {
    const users = getUsers();
    if (users.length === 0) {
        console.log('未在 process.env.USERS_JSON 中找到用户');
        process.exit(1);
    }

    if (PROXY_CONFIG) {
        const isValid = await checkProxy();
        if (!isValid) {
            console.error('[代理] 代理无效，终止运行。');
            process.exit(1);
        }
    }

    await launchChrome();

    console.log(`正在连接 Chrome...`);
    let browser;
    for (let k = 0; k < 5; k++) {
        try {
            browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
            console.log('连接成功！');
            break;
        } catch (e) {
            console.log(`连接尝试 ${k + 1} 失败。2秒后重试...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    if (!browser) {
        console.error('连接失败。退出。');
        process.exit(1);
    }

    const context = browser.contexts()[0];
    let page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    page.setDefaultTimeout(60000);

    if (PROXY_CONFIG && PROXY_CONFIG.username) {
        console.log('[代理] 正在设置认证...');
        await context.setHTTPCredentials({
            username: PROXY_CONFIG.username,
            password: PROXY_CONFIG.password
        });
    } else {
        await context.setHTTPCredentials(null);
    }

    await page.addInitScript(INJECTED_SCRIPT);
    console.log('注入脚本已添加。');

    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        console.log(`\n=== 正在处理用户 ${i + 1}/${users.length} ===`); // 隐去具体邮箱 logging

        try {
            if (page.isClosed()) {
                page = await context.newPage();
                // Context credentials apply
                await page.addInitScript(INJECTED_SCRIPT);
            }

            // --- 登录逻辑 (简略版，逻辑一致) ---
            if (page.url().includes('dashboard')) {
                await page.goto('https://dashboard.katabump.com/auth/logout');
                await page.waitForTimeout(2000);
            }
            // 总是先去登录页
            await page.goto('https://dashboard.katabump.com/auth/login');
            await page.waitForTimeout(2000);
            if (page.url().includes('dashboard')) {
                // 如果登出没成功，再次登出
                await page.goto('https://dashboard.katabump.com/auth/logout');
                await page.waitForTimeout(2000);
                await page.goto('https://dashboard.katabump.com/auth/login');
            }

            console.log('正在输入凭据...');
            try {
                const emailInput = page.getByRole('textbox', { name: 'Email' });
                await emailInput.waitFor({ state: 'visible', timeout: 5000 });
                await emailInput.fill(user.username);
                const pwdInput = page.getByRole('textbox', { name: 'Password' });
                await pwdInput.fill(user.password);
                await page.waitForTimeout(500);

                // --- Cloudflare Turnstile Bypass for Login ---
                console.log('   >> 正在登录前检查 Turnstile (使用 CDP 绕过)...');
                let cdpClickResult = false;
                for (let findAttempt = 0; findAttempt < 30; findAttempt++) {
                    cdpClickResult = await attemptTurnstileCdp(page);
                    if (cdpClickResult) {
                        console.log(`   >> CDP 点击已发送，等待 Cloudflare 验证...`);

                        // 等待验证成功的标志
                        let verifySuccess = false;
                        for (let verifySec = 0; verifySec < 12; verifySec++) {
                            const frames = page.frames();
                            for (const f of frames) {
                                if (f.url().includes('cloudflare')) {
                                    try {
                                        if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                            console.log('   >> ✅ 登录前 Turnstile 验证成功！');
                                            verifySuccess = true;
                                            break;
                                        }
                                    } catch (e) { }
                                }
                            }
                            if (verifySuccess) break;
                            await page.waitForTimeout(1000);
                        }

                        if (verifySuccess) {
                            break; // 验证成功，跳出查找循环
                        } else {
                            console.log('   >> ⚠ 点击后未检测到 Success 标志，继续尝试...');
                            cdpClickResult = false; // 重置，继续查找
                        }
                    }
                    console.log(`   >> [尝试 ${findAttempt + 1}/30] 等待 Turnstile...`);
                    await page.waitForTimeout(1000);
                }

                if (cdpClickResult) {
                    console.log('   >> ✅ 登录 Turnstile 验证完成！');
                } else {
                    console.log('   >> ⚠ 登录 Turnstile 未验证成功，尝试继续登录...');
                }
                // --------------------------------------------

                await page.getByRole('button', { name: 'Login', exact: true }).click();

                // User Request: Check for incorrect password
                try {
                    const errorMsg = page.getByText('Incorrect password or no account');
                    if (await errorMsg.isVisible({ timeout: 3000 })) {
                        console.error(`   >> ❌ 登录失败: 用户 ${user.username} 账号或密码错误`);
                        const failShotPath = path.join(photoDir, `${safeUsername}.png`);
                        try { await page.screenshot({ path: failShotPath, fullPage: true }); } catch (e) { }

                        await sendTelegramMessage(`❌ *登录失败*\n用户: ${user.username}\n原因: 账号或密码错误`, failShotPath);

                        continue;
                    }
                } catch (e) { }

            } catch (e) {
                console.log('登录错误:', e.message);
            }

            console.log('正在寻找 "See" 链接...');
            try {
                await page.getByRole('link', { name: 'See' }).first().waitFor({ timeout: 15000 });
                await page.waitForTimeout(1000);
                await page.getByRole('link', { name: 'See' }).first().click();
            } catch (e) {
                console.log('未找到 "See" 按钮。');
                continue;
            }

            // --- Renew 逻辑 ---
            let renewSuccess = false;
            // 2. 一个扁平化的主循环：尝试 Renew 整个流程 (最多 20 次)
            for (let attempt = 1; attempt <= 20; attempt++) {
                let hasCaptchaError = false;

                // 1. 如果是重试 (attempt > 1)，说明之前失败了或者刚刷新完页面
                // 我们直接开始寻找 Renew 按钮
                console.log(`\n[尝试 ${attempt}/20] 正在寻找 Renew 按钮...`);

                const renewBtn = page.getByRole('button', { name: 'Renew', exact: true }).first();
                try {
                    // 稍微等待一下，防止页面刚刷新还没渲染出来
                    await renewBtn.waitFor({ state: 'visible', timeout: 5000 });
                } catch (e) { }

                if (await renewBtn.isVisible()) {
                    await renewBtn.click();
                    console.log('Renew 按钮已点击。等待模态框...');

                    const modal = page.locator('#renew-modal');
                    try { await modal.waitFor({ state: 'visible', timeout: 5000 }); } catch (e) {
                        console.log('模态框未出现？重试中...');
                        continue;
                    }

                    // A. 在模态框里晃晃鼠标
                    try {
                        const box = await modal.boundingBox();
                        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
                    } catch (e) { }

                    // B. 找 Turnstile (小重试)
                    console.log('正在检查 Turnstile (使用 CDP 绕过)...');
                    let cdpClickResult = false;
                    for (let findAttempt = 0; findAttempt < 30; findAttempt++) {
                        cdpClickResult = await attemptTurnstileCdp(page);
                        if (cdpClickResult) {
                            console.log(`   >> CDP 点击已发送，等待 Cloudflare 验证...`);

                            // 等待验证成功的标志
                            let verifySuccess = false;
                            for (let verifySec = 0; verifySec < 12; verifySec++) {
                                const frames = page.frames();
                                for (const f of frames) {
                                    if (f.url().includes('cloudflare')) {
                                        try {
                                            if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                                console.log('   >> ✅ Cloudflare 验证成功！');
                                                verifySuccess = true;
                                                break;
                                            }
                                        } catch (e) { }
                                    }
                                }
                                if (verifySuccess) break;
                                await page.waitForTimeout(1000);
                            }

                            if (verifySuccess) {
                                break; // 验证成功，跳出查找循环
                            } else {
                                console.log('   >> ⚠ 点击后未检测到 Success 标志，继续尝试...');
                                cdpClickResult = false; // 重置，继续查找
                            }
                        }
                        console.log(`   >> [寻找尝试 ${findAttempt + 1}/30] 尚未找到或验证 Turnstile...`);
                        await page.waitForTimeout(1000);
                    }

                    let isTurnstileSuccess = false;
                    if (cdpClickResult) {
                        console.log('   >> Turnstile 已验证成功。');
                        isTurnstileSuccess = true;
                    } else {
                        console.log('   >> 重试后仍未确认 Turnstile 验证成功。');
                    }

                    // D. 准备点击确认
                    const confirmBtn = modal.getByRole('button', { name: 'Renew' });
                    if (await confirmBtn.isVisible()) {

                        // User Requested: Screenshot BEFORE final click
                        const fs = require('fs');
                        const path = require('path');
                        const photoDir = path.join(process.cwd(), 'screenshots');
                        if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
                        const safeUser = user.username.replace(/[^a-z0-9]/gi, '_');
                        const tsScreenshotName = `${safeUser}_Turnstile_${attempt}.png`;
                        try {
                            await page.screenshot({ path: path.join(photoDir, tsScreenshotName), fullPage: true });
                            console.log(`   >> 📸 快照已保存: ${tsScreenshotName}`);
                        } catch (e) { }

                        // User Request: 找不到的话这个循环直接下一步点击renew，然后检测有没有Please complete the captcha to continue
                        console.log('   >> 点击 Renew 确认按钮 (无论 Turnstile 状态如何)...');
                        await confirmBtn.click();

                        try {
                            // 1. Check for Errors (Captcha or Date limit)
                            const startVerifyTime = Date.now();
                            while (Date.now() - startVerifyTime < 3000) {
                                // A. Captcha Error
                                if (await page.getByText('Please complete the captcha to continue').isVisible()) {
                                    console.log('   >> ⚠️ 检测到错误: "Please complete the captcha".');
                                    hasCaptchaError = true;
                                    break;
                                }

                                // B. Not Renew Time Error
                                const notTimeLoc = page.getByText("You can't renew your server yet");
                                if (await notTimeLoc.isVisible()) {
                                    const text = await notTimeLoc.innerText();
                                    const match = text.match(/as of\s+(.*?)\s+\(/);
                                    let dateStr = match ? match[1] : 'Unknown Date';
                                    console.log(`   >> ⏳ 暂无法续期。下次可用时间: ${dateStr}`);

                                    // 截图证明
                                    const fs = require('fs');
                                    const path = require('path');
                                    const photoDir = path.join(process.cwd(), 'screenshots');
                                    if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
                                    const safeUser = user.username.replace(/[^a-z0-9]/gi, '_');
                                    const skipShotPath = path.join(photoDir, `${safeUser}_skip.png`);
                                    try { await page.screenshot({ path: skipShotPath, fullPage: true }); } catch (e) { }

                                    await sendTelegramMessage(`⏳ *暂无法续期 (跳过)*\n用户: ${user.username}\n原因: 还没到时间\n下次可用: ${dateStr}`, skipShotPath);

                                    renewSuccess = true; // Mark as done to stop retries
                                    try {
                                        const closeBtn = modal.getByLabel('Close');
                                        if (await closeBtn.isVisible()) await closeBtn.click();
                                    } catch (e) { }
                                    break;
                                }
                                await page.waitForTimeout(200);
                            }
                        } catch (e) { }

                        if (renewSuccess) break; // Break loop if not time yet

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

                            // 截图成功状态
                            const fs = require('fs');
                            const path = require('path');
                            const photoDir = path.join(process.cwd(), 'screenshots');
                            if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
                            const safeUser = user.username.replace(/[^a-z0-9]/gi, '_');
                            const successShotPath = path.join(photoDir, `${safeUser}_success.png`);
                            try { await page.screenshot({ path: successShotPath, fullPage: true }); } catch (e) { }

                            await sendTelegramMessage(`✅ *续期成功*\n用户: ${user.username}\n状态: 服务器已成功续期！`, successShotPath);
                            renewSuccess = true;
                            break;
                        } else {
                            console.log('   >> 模态框仍打开但无错误？重试循环...');
                            await page.reload();
                            await page.waitForTimeout(3000);
                            continue;
                        }
                    } else {
                        console.log('   >> 未找到模态框内的验证按钮？刷新中...');
                        await page.reload();
                        await page.waitForTimeout(3000);
                        continue;
                    }

                } else {
                    console.log('未找到 Renew 按钮 (服务器可能已续期或页面加载错误)。');
                    break;
                }
            }
        } catch (err) {
            console.error(`Error processing user:`, err);
        }

        // Snapshot before handling next user
        // In GitHub Actions, we save to 'screenshots' dir
        const fs = require('fs');
        const path = require('path');
        const photoDir = path.join(process.cwd(), 'screenshots');
        if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
        // Use safe filename
        const safeUsername = user.username.replace(/[^a-z0-9]/gi, '_');
        const screenshotPath = path.join(photoDir, `${safeUsername}.png`);
        try {
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`截图已保存至: ${screenshotPath}`);
        } catch (e) {
            console.log('截图失败:', e.message);
        }

        console.log(`用户处理完成\n`);
    }

    console.log('完成。');
    await browser.close();
    process.exit(0);
})();
