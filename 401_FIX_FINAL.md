# 401错误修复 - 最终方案

**时间:** 2026-02-12 23:30
**状态:** ✅ 已完成并重启

---

## 🔍 根本原因分析

### 问题现象
```
❌ 浏览器前端请求 → 401 Unauthorized
✅ curl测试请求 → 200 OK
```

### 根本原因
**前端的API请求没有发送Authorization header！**

代码审查发现：
```typescript
// frontend/services/api.ts (修复前)
function getHeaders(includeAuth = false) {  // ← 默认false!
  const headers = { 'Content-Type': 'application/json' };
  if (includeAuth) {  // ← 大部分调用都没传true
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// 调用示例
export async function getActiveScaleTemplate() {
  const response = await fetch(`${API_BASE_URL}/api/forms/active`, {
    headers: getHeaders(),  // ← 没有传true，所以没有Authorization header!
  });
}
```

**结论：** 所有需要认证的API调用都没有带上token，所以后端返回401。

---

## ✅ 已完成的修复

### 1. 修复 getHeaders 函数

**文件:** `frontend/services/api.ts`

**修改内容:**
```typescript
// 修复前
function getHeaders(includeAuth = false) { ... }

// 修复后
function getHeaders(includeAuth = true) { ... }  // ← 默认true
```

**效果:** 现在所有API请求默认都会带上Authorization header。

### 2. 修复 login 和 register 函数

**问题1:** login/register请求不应该带token（它们本身就是获取token的）

**修改:**
```typescript
// 修复后
export async function login(credentials) {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    headers: getHeaders(false),  // ← 显式传false，不带token
    ...
  });
}

export async function register(data) {
  const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
    headers: getHeaders(false),  // ← 显式传false，不带token
    ...
  });
}
```

**问题2:** 响应格式不匹配

前端期待：
```json
{
  "success": true,
  "data": {"token": "...", "user": {...}}
}
```

后端返回：
```json
{
  "token": "...",
  "user": {...}
}
```

**修改:**
```typescript
// 修复后
export async function login(credentials) {
  const result = await response.json();

  // 后端直接返回 {token, user}
  if (result.token) {
    localStorage.setItem('cognisync-token', result.token);
  }

  // 包装成前端期待的格式
  return {
    success: true,
    data: result  // {token, user}
  } as AuthResponse;
}
```

### 3. 添加后端认证日志

**文件:** `backend/app/api/endpoints/auth.py`

**添加的日志:**
```python
async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict:
    logger.info(f"[AUTH] Authorization header: {authorization[:50] if authorization else 'None'}...")

    if not authorization:
        logger.warning("[AUTH] No valid Authorization header")
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.split(" ")[1]
    logger.info(f"[AUTH] Extracted token: {token[:20]}...")

    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    user_id = payload.get("sub")
    logger.info(f"[AUTH] Decoded user_id: {user_id}")

    logger.info(f"[AUTH] ✅ Authentication successful for user: {user['email']}")
    return user
```

**效果:** 现在可以在后端日志中看到详细的认证过程，方便调试。

### 4. 修复 apiClient 兼容性

**文件:** `frontend/lib/apiClient.ts`

**修改内容:** 兼容两种响应格式
```typescript
// 检测响应格式
const isWrappedFormat = typeof data === 'object' && 'success' in data;

// 返回正确的数据
return (isWrappedFormat ? data.data : data) as T;
```

---

## 📋 完整的认证流程（修复后）

### 注册流程
```
1. 用户填写注册信息
   ↓
2. 调用 register(data)
   - 发送 POST /api/auth/register (不带Authorization header)
   ↓
3. 后端返回 {token, user, onboardingMode}
   ↓
4. 前端保存 token 到 localStorage['cognisync-token']
   ↓
5. 跳转到 onboarding 页面
   ↓
6. onboarding 页面调用 API (自动带上Authorization header)
   - GET /api/forms/active
   - 或 POST /api/onboarding/ai/start
   ↓
7. 后端验证 token，返回200 ✅
```

### Token 流转
```
注册/登录
  ↓
localStorage.setItem('cognisync-token', token)
  ↓
后续所有API请求
  ↓
getHeaders() → 自动从 localStorage 读取 token
  ↓
headers['Authorization'] = `Bearer ${token}`
  ↓
后端 get_current_user() 验证 token
  ↓
返回用户数据 ✅
```

---

## 🧪 测试验证

### 测试步骤
1. **清除浏览器缓存**（重要！）
   ```
   Cmd+Shift+R (Mac) 或 Ctrl+Shift+R (Windows)
   或 F12 → Application → Clear storage
   ```

2. **测试注册流程**
   ```
   访问 http://localhost:3000/register
   填写信息 → 选择模式 → 提交
   ```

3. **检查网络请求**
   ```
   F12 → Network

   ✅ POST /api/auth/register → 200 OK
   ✅ GET /api/forms/active → 200 OK (带Authorization header)
   ✅ POST /api/onboarding/ai/start → 200 OK (带Authorization header)
   ```

4. **检查后端日志**
   ```bash
   tail -f /tmp/cognisync-backend.log

   应该看到：
   [AUTH] Authorization header: Bearer eyJ...
   [AUTH] Extracted token: eyJhbGciOiJIUzI1N...
   [AUTH] Decoded user_id: 8f0860ff-d8c4...
   [AUTH] ✅ Authentication successful for user: user@example.com
   ```

---

## 🔍 如果仍然有问题

### 调试checklist

#### 1. 检查 localStorage
```javascript
// 在浏览器Console执行
localStorage.getItem('cognisync-token')
```
应该返回一个JWT token字符串

#### 2. 检查请求 Headers
```
F12 → Network → 选择任意API请求 → Headers
```
应该看到：
```
Authorization: Bearer eyJhbGciOiJIUzI...
```

#### 3. 检查后端日志
```bash
tail -f /tmp/cognisync-backend.log | grep AUTH
```
应该看到详细的认证日志

#### 4. 检查前端console
```
F12 → Console
```
看是否有JavaScript错误

### 常见问题

**Q: Token保存了但请求还是401**
A: 可能是token过期了。检查：
```python
# backend/app/api/endpoints/auth.py
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24小时
```

**Q: 后端日志显示 "No valid Authorization header"**
A: 前端确实没发送header。检查：
1. 前端是否重新编译（npm run dev）
2. 浏览器是否缓存了旧代码（强制刷新）

**Q: localStorage有token，但后端说token无效**
A: 可能是SECRET_KEY不匹配。检查：
```python
# backend/app/api/endpoints/auth.py
SECRET_KEY = "cognisync-dev-secret-key-change-in-production"
```

---

## 📊 系统状态

```
✅ 后端 (8000)     - 运行中，已添加认证日志
✅ 前端 (3000)     - 运行中，已修复Authorization header
✅ 管理系统 (3001)  - 运行中
```

### 文件修改清单
- ✅ `frontend/services/api.ts` - 修复getHeaders, login, register
- ✅ `frontend/lib/apiClient.ts` - 兼容响应格式
- ✅ `backend/app/api/endpoints/auth.py` - 添加认证日志
- ✅ `backend/app/schemas/auth.py` - 添加onboardingMode字段

---

## 🎯 下一步

如果测试通过：
1. ✅ 401问题已解决
2. 继续实现AI引导DeepSeek集成
3. 创建量表数据库存储

如果测试失败：
1. 按照"调试checklist"排查
2. 提供具体的错误信息和截图
3. 查看后端详细日志

---

**状态:** ✅ 修复完成，等待测试验证
**更新时间:** 2026-02-12 23:30
