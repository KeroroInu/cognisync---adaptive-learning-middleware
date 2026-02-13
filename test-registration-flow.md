# 注册流程测试指南

## 测试前准备

1. **完全清除浏览器数据**
   ```
   - 按 F12 打开开发者工具
   - 右键点击刷新按钮 → 选择"清空缓存并硬性重新加载"
   - 或者：Application → Storage → Clear site data
   ```

2. **确认 localStorage 已清空**
   ```javascript
   // 在浏览器控制台执行
   localStorage.clear()
   sessionStorage.clear()
   location.reload()
   ```

## 测试步骤

### 量表注册流程

1. 访问 http://localhost:3000
2. 点击"注册"
3. 填写：
   - 姓名：测试用户（可选）
   - 邮箱：test-scale-new@example.com
   - 密码：test123
   - 确认密码：test123
4. 点击"下一步"
5. **应该看到模式选择页面**（两张卡片）
6. 点击"量表模式"
7. **应该看到量表问卷页面**（6个问题）
8. 填写所有问题（选择 1-5）
9. 点击"提交"
10. **应该成功进入 dashboard**

### AI注册流程

1. 重复上述步骤，使用不同邮箱：test-ai-new@example.com
2. 选择"AI对话模式"
3. 回答4个问题
4. 点击"完成注册"
5. 应该成功进入 dashboard

## 如果仍然跳过问卷

请检查：

1. **浏览器控制台错误**
   - F12 → Console 标签
   - 截图所有红色错误

2. **Network 标签**
   - F12 → Network 标签
   - 清除记录
   - 重新注册
   - 查看 /api/auth/register 的响应
   - 截图响应内容

3. **检查当前 view 状态**
   ```javascript
   // 在浏览器控制台执行
   console.log('Current URL:', window.location.href)
   console.log('LocalStorage token:', localStorage.getItem('cognisync-token'))
   ```
