# cto.new 平台文档与部署指南（Phase 1）

> 本文档覆盖 cto.new 平台在 Phase 1 阶段的整体说明，包括系统架构、开发环境准备、部署策略、FAQ、隐私合规及下一阶段规划。所有内容以中文撰写，方便团队成员及合作方快速对齐。

## 目录
- [项目简介](#项目简介)
- [架构概述](#架构概述)
- [目录结构（规划）](#目录结构规划)
- [主要依赖](#主要依赖)
- [环境变量说明](#环境变量说明)
- [本地开发步骤](#本地开发步骤)
  - [通用准备](#通用准备)
  - [环境配置](#环境配置)
  - [启动前端（Next.js）](#启动前端nextjs)
  - [启动后端（Node.js API）](#启动后端nodejs-api)
  - [启动 Python Worker](#启动-python-worker)
  - [启动 Redis（可选）](#启动-redis可选)
  - [测试指令](#测试指令)
- [示例配置](#示例配置)
- [部署指南](#部署指南)
  - [前端：Vercel 与 Netlify](#前端vercel-与-netlify)
  - [后端与 Worker：Render、Fly.io、阿里云](#后端与-workerrenderflyio阿里云)
  - [对象存储：S3 与 OSS 配置](#对象存储s3-与-oss-配置)
- [FAQ](#faq)
- [隐私与合规声明](#隐私与合规声明)
- [Phase 2 功能路线概览](#phase-2-功能路线概览)

## 项目简介
cto.new 是一个面向技术领导者的交互式平台，提供工程协同、知识管理与自动化助手能力。平台采用前后端分离、事件驱动的微服务架构，以保障扩展性与稳定性。

## 架构概述
```
┌────────────────────┐          ┌────────────────┐
│    前端 Web 应用    │  HTTP    │  API Gateway   │
│   (Next.js / SSR)  ├─────────▶│  (NestJS)      │
└────────────────────┘          └─────┬──────────┘
                                       │REST / GraphQL
                                       ▼
                               ┌──────────────┐
                               │  应用服务层   │
                               │  (Prisma,    │
                               │   Business)  │
                               └─────┬────────┘
                                     │Events / Jobs
                                     ▼
                             ┌────────────────┐
                             │ Python Worker  │
                             │ (Dramatiq +    │
                             │  Redis)        │
                             └─────┬──────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
            ┌──────────────┐               ┌──────────────┐
            │ PostgreSQL   │               │ Object Store │
            │ (RDS/PolarDB)│               │ (S3 / OSS)   │
            └──────────────┘               └──────────────┘
```
- **前端**：提供 SSR + CSR 混合渲染，负责 UI/UX 与客户端逻辑。
- **API 层**：基于 NestJS 构建的 Node.js 服务，负责业务接口、鉴权、数据访问。
- **Python Worker**：处理异步任务（如文档解析、AI 推理），通过 Redis 作为消息队列/结果存储。
- **数据层**：PostgreSQL 作为主数据库；Redis 用于缓存、队列；对象存储用于文件/模型资产托管。
- **外部集成**：AWS S3 与阿里云 OSS 作为互斥的文件存储选项，保持多云兼容性。

## 目录结构（规划）
> 当前仓库为 Phase 1 文档落地阶段，代码目录将于后续迭代逐步补充。以下结构用于指导未来落地与协作。
```
project-root/
├─ apps/
│  ├─ web/               # Next.js 前端应用
│  └─ api/               # NestJS 后端服务
├─ services/
│  └─ worker/            # Python 异步任务 Worker
├─ packages/
│  ├─ ui/                # 共享 UI 组件库
│  ├─ config/            # tsconfig、eslint 配置
│  └─ utils/             # 通用工具函数
├─ infra/
│  ├─ docker/            # Dockerfile、compose 模板
│  ├─ terraform/         # 基础设施 IaC (AWS/Fly/Render)
│  └─ vercel/            # 前端部署配置
├─ docs/                 # 文档、流程图、产品需求
└─ scripts/              # 自动化脚本（seed、backup 等）
```

## 主要依赖
| 层级 | 技术栈 | 核心依赖 | 说明 |
| --- | --- | --- | --- |
| 前端 | Node.js 18+, Next.js 14, React 18 | `next`, `react`, `tailwindcss`, `swr`, `zustand` | 支持 SSR、API 代理与组件按需加载 |
| 后端 | Node.js 18+, NestJS 10, TypeScript | `@nestjs/core`, `prisma`, `class-validator`, `axios`, `bullmq` | 提供 REST/GraphQL 接口、队列调度、数据库访问 |
| 数据库 | PostgreSQL 14+, Prisma ORM | `prisma`, `pg` | 数据迁移与 schema 管理 |
| 缓存/队列 | Redis 7+ | `ioredis`, `bullmq`（Node）、`redis`（Python） | 用于缓存、任务队列、速率限制 |
| Worker | Python 3.11, Dramatiq | `dramatiq`, `pydantic`, `httpx`, `numpy`, `openai` | 执行 CPU/IO 密集任务（AI、批处理） |
| 工具 | 包管理 & 构建 | `pnpm`, `Poetry`, `Docker`, `Terraform`, `pre-commit` | 确保依赖管理一致性与基础设施代码化 |

## 环境变量说明
| 变量名 | 适用组件 | 必填 | 说明 | 示例 |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | Web / API / Worker | 是 | 运行环境（`development` / `production`） | `development` |
| `NEXT_PUBLIC_API_BASE_URL` | Web | 是 | 前端调用后端的基础 URL | `http://localhost:3001` |
| `API_PORT` | API | 否 | 后端监听端口，默认 `3001` | `3001` |
| `DATABASE_URL` | API | 是 | PostgreSQL 连接字符串 | `postgresql://user:pass@127.0.0.1:5432/cto_new` |
| `REDIS_URL` | API / Worker | 是 | Redis 连接字符串（作为缓存、队列） | `redis://localhost:6379/0` |
| `JWT_SECRET` | API | 是 | 用户鉴权密钥 | `change-me` |
| `WORKER_CONCURRENCY` | Worker | 否 | Worker 并发度 | `4` |
| `WORKER_BROKER_URL` | Worker | 否 | 消息代理，默认与 `REDIS_URL` 相同 | `redis://localhost:6379/1` |
| `STORAGE_DRIVER` | API / Worker | 是 | 对象存储驱动：`s3` 或 `oss` | `s3` |
| `S3_ENDPOINT` | API / Worker (S3) | 视驱动 | 自定义 S3 Endpoint（可为空，使用 AWS 默认） | `https://s3.amazonaws.com` |
| `S3_REGION` | API / Worker (S3) | 视驱动 | 区域 | `us-east-1` |
| `S3_BUCKET` | API / Worker (S3) | 视驱动 | 存储桶名称 | `cto-new-assets` |
| `S3_ACCESS_KEY_ID` | API / Worker (S3) | 视驱动 | 访问凭证 | `AKIA...` |
| `S3_SECRET_ACCESS_KEY` | API / Worker (S3) | 视驱动 | 凭证密钥 | `xxxx` |
| `OSS_ENDPOINT` | API / Worker (OSS) | 视驱动 | OSS Endpoint | `https://oss-cn-hangzhou.aliyuncs.com` |
| `OSS_BUCKET` | API / Worker (OSS) | 视驱动 | OSS 存储桶 | `cto-new-prod` |
| `OSS_ACCESS_KEY_ID` | API / Worker (OSS) | 视驱动 | 阿里云访问凭证 | `LTAI...` |
| `OSS_ACCESS_KEY_SECRET` | API / Worker (OSS) | 视驱动 | 凭证密钥 | `xxxx` |
| `LOG_LEVEL` | 全组件 | 否 | 日志级别（`debug` / `info` / `warn`） | `info` |
| `FRONTEND_BASE_URL` | API | 否 | 链接生成用前端地址 | `http://localhost:3000` |

> 建议将公共变量维护在仓库根目录 `.env`，并分别在 `apps/web/.env.local`、`apps/api/.env`、`services/worker/.env` 中按需覆盖。

## 本地开发步骤

### 通用准备
1. 安装 **Node.js 18+** 与 **pnpm 8+**：`corepack enable`。
2. 安装 **Python 3.11** 与 **Poetry 1.6+**。
3. 安装 Docker（用于本地数据库 & Redis），推荐 Docker Desktop 或 Colima。
4. （可选）安装 AWS CLI / 阿里云 CLI，用于调试对象存储。
5. 克隆仓库：
   ```bash
   git clone https://github.com/kriswu-jail/cto.new.git
   cd cto.new
   git checkout docs-deploy-phase1-zh
   ```

### 环境配置
1. 复制示例配置：`cp .env.example .env`（若不存在可参考 [示例配置](#示例配置)）。
2. 分别在 `apps/web/.env.local`、`apps/api/.env`、`services/worker/.env` 中配置对应变量。
3. 启动数据库与 Redis（见下文）。

### 启动前端（Next.js）
```bash
pnpm install
pnpm --filter web dev
```
- 默认运行于 `http://localhost:3000`。
- 支持热更新与 API 代理，必要时在 `apps/web/next.config.js` 中调整。

### 启动后端（Node.js API）
```bash
pnpm --filter api install
pnpm --filter api prisma migrate dev
pnpm --filter api start:dev
```
- 默认监听 `3001` 端口，可通过 `API_PORT` 覆盖。
- `prisma migrate dev` 会应用最新 schema 并生成客户端。

### 启动 Python Worker
```bash
cd services/worker
poetry install
poetry run dramatiq worker.main --processes 1 --threads 2
```
- `worker.main` 为入口模块，可通过 `WORKER_CONCURRENCY` 与 CLI 参数调整并发。
- 支持在 `.env` 中开启指标导出（例如 `ENABLE_PROMETHEUS=true`）。

### 启动 Redis（可选）
- 快速启动：
  ```bash
  docker run --name cto-new-redis -p 6379:6379 -d redis:7
  ```
- 若使用 `infra/docker/docker-compose.yml`：
  ```bash
  docker compose up redis postgres -d
  ```
- 如需开启持久化，请挂载数据卷或引用云端 Redis（ApsaraDB、Elasticache 等）。

### 测试指令
- 前端：`pnpm --filter web test`（基于 Vitest/React Testing Library）。
- 后端：`pnpm --filter api test`（Jest + supertest），可加 `--watch`。
- Worker：`poetry run pytest`（放置于 `services/worker/tests`）。
- E2E（可选）：`pnpm turbo run test:e2e --filter api...`。

## 示例配置
```dotenv
# 根目录 .env
NODE_ENV=development
LOG_LEVEL=debug
STORAGE_DRIVER=s3

# apps/web/.env.local
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
FRONTEND_BASE_URL=http://localhost:3000

# apps/api/.env
API_PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cto_new
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=replace-with-secure-secret
S3_REGION=us-east-1
S3_BUCKET=cto-new-dev
S3_ACCESS_KEY_ID=local-key
S3_SECRET_ACCESS_KEY=local-secret

# services/worker/.env
REDIS_URL=redis://localhost:6379/0
WORKER_BROKER_URL=redis://localhost:6379/1
WORKER_CONCURRENCY=4
S3_REGION=us-east-1
S3_BUCKET=cto-new-dev
S3_ACCESS_KEY_ID=local-key
S3_SECRET_ACCESS_KEY=local-secret
```

## 部署指南

### 前端：Vercel 与 Netlify
#### Vercel
1. 在 Vercel Dashboard 中 `Import Project`，选择 Git 仓库。
2. Framework 选择 **Next.js**，构建命令：`pnpm --filter web build`，产物目录：`apps/web/.next`。
3. 设置环境变量（参考上方表格），添加 `NEXT_PUBLIC_API_BASE_URL` 指向后端公网地址。
4. 启用自定义域名与 Edge 函数（可选）。如需 ISR，确保后端回调地址配置对应。

#### Netlify
1. 新建站点，选择 Git 仓库并指定根目录 `apps/web`。
2. 构建命令：`pnpm --filter web build`，发布目录：`apps/web/.next`（需启用 Next Runtime）。
3. 在 "Deploy settings → Environment" 中配置变量。
4. 若使用 Netlify Functions 代理 API，请在 `netlify.toml` 配置重写规则。

> 若需提前编译共享包，请在根目录新增 `netlify-build.sh`，执行 `pnpm install && pnpm turbo run build --filter web`。

### 后端与 Worker：Render、Fly.io、阿里云

| 平台 | 部署形态 | 网络特性 | 构建 & 启动 | 备注 |
| --- | --- | --- | --- | --- |
| Render | Web Service (API) + Background Worker | 提供内网服务发现，自动 HTTPS | Docker 或 Node/Nix 构建；命令示例：`pnpm --filter api build && pnpm --filter api start:prod`；Worker：`poetry run dramatiq worker.main` | 支持自动扩缩与 Cron Job，需在 Dashboard 绑定 Postgres/Redis | 
| Fly.io | App + Machines/Scale | 可绑定 WireGuard 内网，支持多地域部署 | `fly launch` 生成 `fly.toml`，使用 `Dockerfile` 构建；API 通过 `[http_service]` 暴露 3001；Worker 使用 `processes` 或独立 app | 推荐使用 `fly volumes` 存储静态文件缓存，Redis 可采用 Fly Redis Launchpad |
| 阿里云 | ACK/ECS + SLB | 私网 + SLB 负载均衡，需自建 TLS | 通过容器镜像部署（ACR），或在 ECS 上使用 `pm2`/`supervisor`；Worker 可作为 Cron/守护进程运行 | 数据库可用 PolarDB / RDS，Redis 使用 ApsaraDB；OSS 原生支持 |

部署步骤建议：
1. **构建镜像**：使用 `infra/docker/Dockerfile.api`、`infra/docker/Dockerfile.worker` 生成镜像，推送至 GHCR/ACR。
2. **配置环境变量**：保持与本地一致，并增加生产密钥（`JWT_SECRET`、`DATABASE_URL`）。
3. **数据库迁移**：在部署后端前运行 `pnpm --filter api prisma migrate deploy`。
4. **健康检查**：API 提供 `/healthz`，Worker 可通过 `dramatiq --watch` 输出心跳日志。
5. **监控与告警**：建议接入 OpenTelemetry（Jaeger/Grafana），或使用平台原生指标。

### 对象存储：S3 与 OSS 配置
- **AWS S3**
  1. 创建 Bucket，启用版本管理及生命周期规则（可选）。
  2. 创建 IAM 用户并最小化权限（仅限目标桶 CRUD，禁止 `s3:*`）。
  3. 在环境变量配置 Access Key 与 Secret，必要时开启 `S3_ENDPOINT` 指向 MinIO 或其他兼容服务。
  4. 若需私有访问，开启签名 URL（API 提供 `/files/sign`）。
- **阿里云 OSS**
  1. 在控制台创建 Bucket，选择地域与冗余策略（标准/低频）。
  2. 创建 RAM 用户并配置最小权限策略。
  3. 将 `STORAGE_DRIVER` 设为 `oss`，并提供 Endpoint 与凭证。
  4. 若部署在中国内地，建议启用 CDN 加速以降低跨域延迟。

> 在多云部署时，可通过抽象化的 Storage Provider（`packages/utils/storage`）实现不同驱动的切换，以配置项为主而非编译时开关。

## FAQ
1. **Q：前端启动时报错 `Cannot find module '@packages/ui'`？**
   - A：执行 `pnpm install` 后运行 `pnpm turbo run build --filter ui`，确保工作区依赖已构建。
2. **Q：后端提示 `ECONNREFUSED 127.0.0.1:5432`？**
   - A：PostgreSQL 未启动或端口被占用。确认 Docker 容器运行，或更新 `DATABASE_URL` 指向正确地址。
3. **Q：Worker 无法连接 Redis？**
   - A：检查 `REDIS_URL` / `WORKER_BROKER_URL`，以及安全组/防火墙配置；在云环境中请使用 VPC 内网地址。
4. **Q：如何在生产环境切换 S3 与 OSS？**
   - A：通过调整 `STORAGE_DRIVER` 并配置对应变量即可。确保在部署前同步迁移历史文件或使用双写策略。
5. **Q：日志中出现 OpenAI 请求超时？**
   - A：检查 Worker 的出站网络权限与 `OPENAI_API_KEY`（若适用）；可通过 `httpx` 设置重试策略，或在队列中增加容错逻辑。

## 隐私与合规声明
- **数据最小化**：仅收集实现核心功能所需的数据，所有敏感字段（例如用户邮箱、操作日志）在静止状态采用 AES-256 加密。
- **传输安全**：强制使用 HTTPS/TLS，并在内部服务间启用 mTLS（Fly.io/Render 可通过私网证书实现）。
- **访问控制**：后台采用 RBAC，敏感操作需双因素认证。云端资源绑定特定 IAM/RAM 策略，禁止宽权限访问。
- **数据驻留与合规**：默认遵循 GDPR、CCPA 要求，提供数据导出、删除能力；如在中国大陆部署，遵循《个人信息保护法》《数据安全法》。可根据客户地域选择数据中心。
- **日志与保留策略**：应用日志默认保留 30 天，可通过 SIEM（如 Datadog/SLS）集中管理。备份加密存储，定期执行恢复演练。

## Phase 2 功能路线概览
- **多租户与空间管理**：支持组织/团队级隔离、计费与配额。
- **自动化流程编排**：拖拽式 Workflow Builder，与第三方服务（Jira、GitHub、Slack）集成。
- **知识图谱与搜索**：引入向量数据库，实现跨团队知识检索与相关性推荐。
- **更精细的权限模型**：字段级权限、审批流、操作审计（Audit Log）。
- **可观测性增强**：全链路 Trace、指标告警仪表盘，支持 SLO/SLA 报表。
- **AI 智能体扩展**：开放 Plugin / Tooling SDK，支持企业自定义 Prompt 与模型路由。

> Phase 2 的详细时间表与里程碑将在产品需求评审后另行发布；当前文档将持续迭代同步最新进展。
