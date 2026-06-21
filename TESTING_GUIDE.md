# 测试和验证指南

## 🧪 本地测试步骤

### 1. 准备环境

```bash
# 克隆或更新仓库
cd katabump

# 安装依赖
npm install

# 配置账号
cp login.json.template login.json
# 编辑 login.json，填入测试账号
```

### 2. 配置测试模式

编辑 `renew.js`，找到第 15 行：

```javascript
const HEADLESS = false;  // 设置为 false，可以看到浏览器窗口
```

### 3. 运行测试

```bash
# 直接运行
node renew.js

# 使用代理运行（如果需要）
# PowerShell:
$env:HTTP_PROXY="http://127.0.0.1:7890"
node renew.js

# CMD:
set HTTP_PROXY=http://127.0.0.1:7890
node renew.js
```

### 4. 观察日志输出

#### ✅ 成功的标志

```
[Turnstile Injected] Script loaded in iframe: https://challenges.cloudflare.com/...
>> Checking 3 frames for Turnstile...
>> Frame 1: https://challenges.cloudflare.com/...
[Turnstile Injected] Shadow root attached
[Turnstile Injected] Found element with selector: input[type="checkbox"]
[Turnstile Injected] ✓ Checkbox found! Ratios: { xRatio: 0.5, yRatio: 0.5 }
>> ✓ Found Turnstile checkbox! Ratios: { xRatio: 0.5, yRatio: 0.5, timestamp: ... }
>> Target coordinates: (640.00, 360.00)
>> Iframe box: x=600.00, y=340.00, w=80.00, h=40.00
>> Simulating human-like mouse movement...
>> Hovering over checkbox...
>> Clicking...
>> ✓ Click sequence completed successfully!
   >> CDP Click active. Waiting 8s for Cloudflare check...
   >> Detected "Success!" in Turnstile iframe.
   >> ✅ Modal closed. Renew successful!
```

#### ❌ 失败的标志

```
>> Checking 3 frames for Turnstile...
>> Frame 0: about:blank
>> Frame 1: https://dashboard.katabump.com/...
>> Frame 2: https://challenges.cloudflare.com/...
>> Frame 2 error: Execution context was destroyed
   >> Turnstile checkbox not confirmed after retries.
   >> ⚠️ Error detected: "Please complete the captcha".
```

### 5. 检查截图

查看 `photo/` 目录：

- `username_Turnstile_1.png` - 第一次尝试时的截图
- `username_Turnstile_2.png` - 第二次尝试时的截图（如果有）
- `username.png` - 最终状态截图

**查看重点**：
- Turnstile checkbox 是否可见
- 是否显示绿色勾选标记
- 是否有红色错误提示

## 🔧 常见问题排查

### 问题 1：找不到 Turnstile checkbox

**日志表现**：
```
>> Checking 3 frames for Turnstile...
（没有 "✓ Found Turnstile checkbox" 消息）
```

**可能原因**：
1. Cloudflare 更新了 DOM 结构
2. iframe 加载太慢
3. 选择器不匹配

**解决方法**：
```javascript
// 在 renew.js 的 INJECTED_SCRIPT 中添加更多选择器
const selectors = [
    'input[type="checkbox"]',
    'input[name="cf-turnstile-response"]',
    'input.cf-turnstile-response',
    '[role="checkbox"]',
    'div[class*="checkbox"]',  // 添加新的
    'span[class*="check"]',    // 添加新的
    'input'
];
```

### 问题 2：找到了但点击无效

**日志表现**：
```
>> ✓ Click sequence completed successfully!
   >> ⚠️ Error detected: "Please complete the captcha".
```

**可能原因**：
1. 坐标计算错误
2. 点击速度太快
3. 缺少鼠标移动

**解决方法**：
```javascript
// 已在新版本中实现：
// 1. 贝塞尔曲线移动
// 2. 悬停时间
// 3. 随机化点击时长

// 如果仍然失败，可以增加等待时间：
await page.waitForTimeout(250 + Math.random() * 300); // 250-550ms 悬停
```

### 问题 3：iframe 坐标错误

**日志表现**：
```
>> Target coordinates: (-100.00, -200.00)  // 负数坐标
```

**可能原因**：
1. iframe 不可见
2. iframe 在视口外

**解决方法**：
```javascript
// 在点击前滚动到 iframe
const iframeElement = await frame.frameElement();
await iframeElement.scrollIntoViewIfNeeded();
await page.waitForTimeout(1000);
```

### 问题 4：CDP 连接失败

**日志表现**：
```
连接尝试 1 失败。2秒后重试...
连接尝试 2 失败。2秒后重试...
```

**可能原因**：
1. Chrome 未正确启动
2. 端口被占用
3. 防火墙阻止

**解决方法**：
```bash
# 检查端口是否被占用
netstat -ano | findstr 9222

# 手动终止 Chrome 进程
taskkill /F /IM chrome.exe

# 重新运行脚本
node renew.js
```

## 📊 性能优化建议

### 1. 减少等待时间

如果网络环境良好，可以适当减少等待：

```javascript
// 在 attemptTurnstileCdp 中
for (let findAttempt = 0; findAttempt < 20; findAttempt++) {  // 从 30 改为 20
    cdpClickResult = await attemptTurnstileCdp(page);
    if (cdpClickResult) break;
    await page.waitForTimeout(800);  // 从 1000 改为 800
}
```

### 2. 增加成功率

如果经常失败，可以增加重试：

```javascript
// 在主循环中
for (let attempt = 1; attempt <= 30; attempt++) {  // 从 20 改为 30
    // ...
}
```

### 3. 使用代理

如果 IP 被限制：

```bash
# 使用代理
export HTTP_PROXY=http://127.0.0.1:7890
node renew.js
```

## 🐛 调试模式

### 启用详细日志

编辑脚本，在 `attemptTurnstileCdp` 函数中添加：

```javascript
// 输出所有 frame 的 URL
const frames = page.frames();
for (let i = 0; i < frames.length; i++) {
    console.log(`Frame ${i}: ${frames[i].url()}`);
}

// 输出注入脚本状态
const data = await frame.evaluate(() => ({
    hasTurnstileData: !!window.__turnstile_data,
    turnstileData: window.__turnstile_data,
    allInputs: Array.from(document.querySelectorAll('input')).map(el => ({
        type: el.type,
        name: el.name,
        className: el.className
    }))
})).catch(() => null);
console.log('Frame debug info:', data);
```

### 保存 HTML 快照

```javascript
// 在发现错误时保存完整 HTML
if (await page.getByText('Please complete the captcha').isVisible()) {
    const html = await page.content();
    fs.writeFileSync('error_page.html', html);
    console.log('HTML saved to error_page.html');
}
```

## ✅ 验收测试清单

- [ ] 本地运行可以看到浏览器窗口
- [ ] 日志显示 "✓ Found Turnstile checkbox"
- [ ] 日志显示 "✓ Click sequence completed successfully"
- [ ] 日志显示 "Detected 'Success!' in Turnstile iframe"
- [ ] 日志显示 "✅ Modal closed. Renew successful!"
- [ ] 截图显示绿色勾选标记
- [ ] 没有 "Please complete the captcha" 错误
- [ ] GitHub Actions 运行成功（如果使用）

## 📞 获取帮助

如果以上方法都无法解决问题，请提供：

1. **完整的日志输出**（从开始到结束）
2. **所有截图**（`photo/` 目录）
3. **系统信息**：
   - 操作系统版本
   - Chrome 版本
   - Node.js 版本
4. **网络环境**：
   - 是否使用代理
   - 网络延迟情况
5. **失败频率**：
   - 每次都失败？
   - 偶尔失败？
   - 特定账号失败？

---

**提示**：首次测试建议使用单个测试账号，确认成功后再批量运行。
