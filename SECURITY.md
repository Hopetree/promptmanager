# 安全策略（Security Policy）

## 支持版本

只有**最新发布版**接收安全修复。

| 版本 | 是否支持 |
| --- | --- |
| 最新 `vX.Y.Z` | ✅ |
| 更早的版本 | ❌ —— 请先升级 |

升级方式见 [README「备份与升级」](README.md)。

## 报告漏洞

**请不要开公开 issue。** 请走 GitHub 的私密渠道：

> **→ [报告安全漏洞](https://github.com/Hopetree/promptmanager/security/advisories/new)**

这是 GitHub Security Advisories，**只有维护者能看到内容**，修复发布后再公开。

报告里请尽量带上：

- **影响**：攻击者能做什么（越权读 / 写、绕过认证、执行代码……）
- **复现步骤**：能照着做出来的最小步骤；有 PoC 更好
- **部署形态**：Docker 还是源码（systemd）？是否在反向代理之后？
- **版本**：`curl -s http://<你的地址>:8767/healthz` 的输出
- **你的判断**：严重程度、是否建议立即处理

## 响应节奏

个人项目，**尽力而为**，不承诺 SLA：

- **3 天内**确认收到
- **7 天内**给出初步判断（是否确认、影响面、是否计划修）
- 确认后修复，随下一个版本发布，并在 [`CHANGELOG.md`](CHANGELOG.md) 记录

## 范围

**属于本项目**：应用自身的代码 —— 认证与授权、会话与令牌、加解密、
SQL 注入、XSS、路径穿越、SSRF、导入导出与远程同步的数据处理等。

**不属于本项目**（请自行处理）：

- 你的部署配置问题（服务裸暴露到公网、未启用 HTTPS、`CORS_ORIGINS` 配错等）
- 反向代理 / 操作系统 / 容器运行时自身的漏洞
- 依赖包的漏洞 —— 欢迎告诉我们，但请**同时向上游报告**
- 需要攻击者**已经拿到主机权限**才能做的事

## 已知的安全设计（便于判断"这算不算问题"）

以下都是**有意为之**，不是漏洞：

- 口令用 **argon2id** 哈希；登录有失败阈值 + 每 IP 限流（`LOGIN_MAX_FAILURES` / `LOGIN_WINDOW_SECONDS`）
- API 令牌**只存 sha256**，明文仅在创建 / 查看时出现；令牌**不能**管理令牌
- 「令牌管理 / 改口令 / 登出 / 远程同步」**仅浏览器会话可用**（用令牌调 ⇒ `403 session_required`）
- GitHub 同步令牌以 **AES-256-GCM** 加密落库，接口只回「已设置 + 尾 4 位」
- 会话 cookie 在 `PUBLIC_ORIGIN` 为 HTTPS 时自动追加 `Secure`
- Markdown 服务端渲染做 **DOMPurify 净化** + 代码高亮字符上限
- 全部 SQL 参数化；导出文件校验 `app` / `schema_version`

细节见 [`docs/api.md`](docs/api.md) 的认证章节与 [`AGENTS.md`](AGENTS.md)。

## 致谢

确认并修复后，如果你愿意，会在 `CHANGELOG.md` 的对应版本里具名致谢。
