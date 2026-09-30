# 贡献指南（Contributing）

感谢愿意花时间。项目不大，规矩也少，核心就一条：**改动要能被验证**。

## 先读什么

| 想做什么 | 先读 |
| --- | --- |
| 搭环境 / 跑起来 / 跑测试 | [`docs/development.md`](docs/development.md) |
| 改接口 / CLI / MCP | [`docs/api.md`](docs/api.md) |
| 发版规则（版本号怎么升、tag 怎么打） | [`docs/versioning.md`](docs/versioning.md) |
| 增删依赖 | [`docs/dependencies.md`](docs/dependencies.md) —— **先查后装**，且要登记进表 |
| 用 AI 代理改代码 | [`AGENTS.md`](AGENTS.md) |
| 文档放哪儿 | [`docs/README.md`](docs/README.md) |

## 环境要求

- **Node ≥ 24**（`.nvmrc` 已给；`.npmrc` 开了 `engine-strict`，版本不符 `npm ci` 会**直接失败**而不是只警告）
- 不想装 Node 也可以走 Docker，见 [README「快速开始」](README.md)

## 提交前必过：质量门

```bash
rm -rf dist && bash tools/ci-check.sh
```

这就是 CI 跑的那一套（依赖检查 / 构建 / 前端 + 测试类型检查 / 全量测试 / 500KB chunk 预算），**必须全绿**。

> 测试用例数**只增不减**；判据是 `fail 0`，不是某个具体数字。

## 几条硬规矩

1. **不要改已应用的迁移文件**。要改 schema 就**新增**一个，编号 = `migrations/` 里最大号 + 1。
2. **迁移必须幂等**（服务启动时会自动跑一遍）。验证：`DATA_DIR=$(mktemp -d) npm run migrate`。
3. **依赖只减不增**：能复用既有技术栈就别引新包；确需新依赖，先按 `docs/dependencies.md` 的两道闸门查许可与漏洞，并**登记进那张表**。
4. **`docs/` 只放最终状态文档**；过程记录、临时对账放 `tmp/`（`.gitignore` 已忽略，永不入库）。
5. **改了接口 / 环境变量 / 错误码，同步更新 `docs/api.md`**。

## Commit 规范

```
<type>(<scope>): <一句话说清做了什么>
```

`type` 用 `feat` / `fix` / `docs` / `refactor` / `test` / `chore`。
正文写**为什么**（根因、取舍），不要复述 diff。

## 提 PR

- 一个 PR 一件事，别把不相关的改动混在一起
- PR 描述带三样：**改了什么** / **为什么** / **怎么验证的**（贴 `ci-check` 结论）
- 界面改动请附截图（PC 与移动端各一张）

## 报告 Bug

开 issue 时带上这三样，能省很多来回：

1. **部署形态**：Docker 还是源码（systemd）？在反向代理后面吗？
2. **版本**：`curl -s http://<你的地址>:8767/healthz` 的输出
3. **复现步骤**：从哪一步开始不对、期望什么、实际什么（附错误信息）

**安全漏洞不要开公开 issue** —— 走 [`SECURITY.md`](SECURITY.md) 的私密渠道。
