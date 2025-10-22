# 运维与安全治理手册

面向日常运维值守与事故响应，本手册总结了当前队列/任务系统的监控、告警与排障建议。

## 运行时观测

- **Metadata 日志**：所有任务状态变更均通过统一 logger 输出 JSON 行日志，仅包含任务 ID、类型、状态、耗时、重试次数等元数据，不会持久化用户上传的文件或 payload 内容。
- **健康探针**：
  - `GET /health` 返回服务运行状态、进程 uptime、当前并发与排队深度。
  - `GET /status`/`/healthz` 提供更详细的指标（各状态任务数、并发上限、rate limit 配置等），可用于 Prometheus/自定义采集。
- **存储巡检**：后台清理任务每分钟执行一次，清除 10 分钟以上的临时文件与终态任务元数据，确保磁盘与队列残留可控。

## 告警与错误处理

- **Webhook 占位**：`ALERT_WEBHOOK_URL` 配置后，作业失败、超时、维护任务异常会以 JSON payload 方式推送，可对接 Slack/飞书/企业微信。
- **日志监听**：推荐将结构化日志（`jobs.*`, `alerts.*`, `cleanup.*`）汇聚到集中式日志平台，基于 `level` 与 `event` 字段建立监控规则。
- **异常兜底**：Express 全局错误处理中会触发 `maintenance_issue` 告警，确保接口异常可见。

## 事故响应建议

1. **确认状态**：通过 `/status` 获取各状态任务数量，必要时查看最近的 `jobs.failed` / `jobs.timeout` 日志确定问题范围。
2. **排除资源瓶颈**：检查 `jobs.concurrency.clamped` 日志确认有效并发（上限 10），关注 rate limit 命中情况；必要时调整环境变量后重启。
3. **重置队列**：如存在大量陈旧任务，可手动调用 `manager.cleanup()` 或删除 data/tmp 目录中的残留文件（注意保留运行中的任务）。
4. **沟通与复盘**：
   - 通过 webhook/IM 通知干系人。
   - 记录 root cause、缓解措施与后续改进。
   - 在知识库更新本手册或 runbook。

## 监控扩展建议

- 接入 Prometheus/Grafana，对 `/status` 输出进行指标化采集。
- 将 `cleanup.files.removed` 与 `jobs.cleanup.store` 指标纳入容量监控，预估磁盘增长趋势。
- 根据业务 SLA，为 `job_timeout` 和 `job_failure` 事件设置分级告警策略。
- 在 CI/CD 中添加合规检测，防止日志中泄露敏感数据。

> 所有运维操作均应避免直接访问用户输入的原始文件；如需调试，请使用脱敏数据或本地沙箱环境。
