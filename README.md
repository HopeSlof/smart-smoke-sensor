# 智慧烟感管理平台

面向社区/园区的火灾预警与设备管理系统，含后端服务与前端 Web 面板。后端通过 MQTT 接收烟感设备实时数据，基于多参数联合判定 + 消抖规则引擎实现分级告警，并提供设备管理、离线/低电量检测、告警升级、警情统计与 RAG 大模型问答；内置**多小区负责人机制**（居民 / 小区管理员 / 消防员 / 系统管理员四角色 + 数据权限 + 注册审核 + 住户设备绑定 + 站内消息）。前端提供登录、管理大屏、居民个人中心、消防员指挥台等页面。

## 技术栈

后端：Java 21 · Spring Boot 3.5 · MyBatis-Plus · PostgreSQL(pgvector) · MQTT · WebSocket(STOMP) · JWT
前端：原生 HTML / CSS / JavaScript（无构建，Live Server 直接运行）

## 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| JDK | 21+（已验证 25） | 配置 `JAVA_HOME` |
| Maven | 3.9+ | 配置 `PATH`，需含 `bin` 目录 |
| Docker | 任意较新版本 | 运行 PostgreSQL 与 EMQX |

> 国内环境拉镜像需先配置镜像加速器（Docker Desktop → Settings → Docker Engine → 添加 `registry-mirrors`）。

## 快速开始

### 1. 启动基础设施（Docker）

```cmd
:: 启动 PostgreSQL（pgvector 版，数据持久化到 C:\docker-data\pg17-vector）
docker run -d --name pg17-vector -p 5432:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=123456 -v C:\docker-data\pg17-vector:/var/lib/postgresql/data pgvector/pgvector:pg17

:: 启动 EMQX（MQTT 消息队列，管理界面 http://localhost:18083 默认 admin/public）
docker run -d --name emqx -p 1883:1883 -p 18083:18083 emqx/emqx
```

### 2. 建库建表

```cmd
:: 进入项目目录
cd "d:\code\artificial smogg —\smart-smoke-sensor"

:: 创建数据库
docker exec -i pg17-vector createdb -U postgres smart-smoke-sensor

:: 建表 + 初始化默认阈值（cmd 用 type；PowerShell 可换 Get-Content）
type sql\schema.sql | docker exec -i pg17-vector psql -U postgres -d smart-smoke-sensor
```

> `schema.sql` 已包含 14 张表：`users`、`community`、`devices`、`user_device`、`cameras`、`smoke_readings`、`threshold_config`、`alarm_logs`、`control_logs`、`knowledge_chunks`、`chat_session`、`chat_message`、`ai_review_log`、`user_message`。

### 3. 配置敏感信息

1. 复制 `src/main/resources/application-secret-example.yml` 为 `application-secret.yml`（同目录）
2. 填写数据库密码（默认 `123456`）与 JWT 密钥（任意 ≥32 位字符串）

### 4. 启动应用

```cmd
mvn spring-boot:run
```

看到 `Started SmartSmokeSensorApplication` 即启动成功，后端监听 `http://localhost:8080`。启动时 `DataInitializer` 会自动初始化默认系统管理员（`admin / 123456`）和一个示例小区。

### 5. 验证

直接登录默认管理员：

```cmd
curl -X POST http://localhost:8080/users/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"123456\"}"
```

返回 `{"code":200,...}` 即链路正常。

### 6. 启动前端

前端为纯静态页面，位于 `frontend/web-dashboard/`，无需构建，用任意静态服务器即可运行（推荐 VS Code 的 Live Server 插件）：

1. 用 VS Code 打开 `frontend/web-dashboard/` 目录。
2. 右键 `login.html` → 「Open with Live Server」（默认端口 5500）。
3. 浏览器打开后登录即可（默认管理员 `admin / 123456`，或使用 [样例数据脚本](sql/sample-data.sql) 中的账号，密码均为 `123456`）。

> 前端通过 API 访问后端，默认指向 `http://localhost:8080`；如需局域网联调，把前端 JS 中的后端地址改为后端机器 IP（后端已开启跨域 CORS）。

## 配置说明

| 文件 | 说明 |
|------|------|
| `application.yml` | 公开配置（端口、数据库地址、MQTT 地址、MyBatis、日志等） |
| `application-secret.yml` | 敏感配置（数据库密码、JWT 密钥、LLM Key），已 gitignore，需自行创建 |
| `application-secret-example.yml` | 敏感配置模板，供复制参考 |

## 常用命令

| 操作 | 命令 |
|------|------|
| 启动后端 | `mvn spring-boot:run` |
| 停止后端 | 在运行窗口按 `Ctrl + C` |
| 编译打包 | `mvn clean package` |
| 清空业务数据（重置） | `type sql\reset-data.sql \| docker exec -i pg17-vector psql -U postgres -d smart-smoke-sensor` |
| 启动容器 | `docker start pg17-vector emqx` |
| 停止容器 | `docker stop pg17-vector emqx` |

> 重置数据后所有用户、小区、设备、告警都会被清空；默认管理员 `admin/123456` 会在应用下次启动时自动重建，其余需重新注册/添加。

## 相关文档

- [项目结构与功能说明](项目结构与功能说明.md) — 架构、目录、各模块职责、核心业务流程
- [API 接口文档](API文档.md) — 全部接口的路径、参数、返回格式（供前端对接）
- [负责人机制与多小区权限设计](负责人机制与多小区权限设计.md) — 多小区、角色权限、数据权限、告警路由设计
- [数据库建表脚本](sql/schema.sql)
- [数据重置脚本](sql/reset-data.sql)

## 硬件接入说明

设备通过 MQTT 上报，主题与消息体示例见 [API文档.md](API文档.md) 第 10 节；同时提供 HTTP 降级上报接口（`POST /smoke-readings/report`、`POST /devices/heartbeat`、`POST /devices/self-check`），便于无 MQTT 环境下的联调测试。
