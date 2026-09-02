# 智慧烟感预警系统 · 前端

> 基于 HTML/CSS/原生 JS 的物联网烟感预警平台前端，支持四角色权限、实时告警推送、AI 视觉复核、摄像头管理、RAG 智能问答等功能。

## 功能模块

### 1. 用户与权限

| 角色 | 登录页 | 数据范围 | 核心权限 |
|------|--------|----------|----------|
| 系统管理员 | index.html | 全部小区 | 设备/用户/社区/摄像头 CRUD、紧急广播、全局设置 |
| 小区管理员 | index.html | 本小区 | 本小区设备/摄像头管理、用户审核、告警处置 |
| 居民 | user.html | 本小区 | 个人设备查看、告警通知、消息收发 |
| 消防员 | firefighter.html | 全部小区 | 全量告警监控、设备状态、应急联动、处置记录 |

- 注册流程：居民/小区管理员/消防员注册 → 状态 PENDING → 系统管理员审核通过 → 状态 ACTIVE → 可登录
- 小区管理员注册后由系统管理员审核时指定管理小区
- JWT 认证，前端按角色自动路由到对应页面

### 2. 三级界面结构

```
总览层          → 全部小区统计卡 + 社区入口卡片
  └─ 社区层     → 单个小区的设备列表 + 告警列表
       └─ 感知层 → 单个设备的实时读数 + 摄像头监控 + 趋势图
```

- 系统管理员可切换全部三级
- 小区管理员直接进入本小区总览（社区层按钮隐藏）
- 感知层支持设备下拉选择、汇总/单设备切换、Esc/×号关闭

### 3. 实时告警与 AI 视觉复核

- WebSocket 推送告警事件，按角色和小区订阅不同主题
- 告警类型：火警(FIRE)、设备离线(OFFLINE)、低电量(LOW_BATTERY)、传感器故障(SENSOR_FAULT)
- 告警触发后自动 AI 视觉复核：
  1. 调用 `GET /devices/{id}/snapshot` 获取传感器画面
  2. 在告警卡片底部显示复核图片
  3. 调用 `POST /knowledge-chunks/recognize` 进行 AI 分析
  4. 右侧显示 AI 预测结果
- 管理员/消防员可消除紧急告警（确认设备正常后）
- 归档/误报告警自动过滤不显示

### 4. 摄像头管理

- 设置 → 摄像头管理 Tab：创建/编辑/删除摄像头、绑定/解绑传感器设备
- 感知层 → 摄像头监控分区：摄像头卡片 + 拍照按钮
- 拍照功能：调用本地摄像头（`getUserMedia`）→ 实时预览 → 拍摄 → base64 上传 → AI 分析结果
- 设备管理新增设备时可选择绑定摄像头（双向绑定）
- 角色权限：系统管理员全 CRUD、小区管理员本社区、居民/消防员仅查看+拍照

### 5. RAG 智能问答

- 页面右下角浮动按钮，点击展开对话面板
- 支持多轮对话、会话历史、新建/删除会话
- AI 回答附带引用来源（悬停查看）

### 6. 传感器趋势图表

- 点击设备卡片打开趋势图弹窗
- 双 Y 轴 SVG 曲线展示烟雾、CO 浓度及温度变化趋势
- 支持时间范围切换（1h / 6h / 12h / 24h）

## 技术架构

```
┌─────────────────────────────────────────────┐
│                  浏览器前端                    │
├─────────────────────────────────────────────┤
│  HTML 页面层    index.html / login.html /     │
│                 user.html / firefighter.html   │
├─────────────────────────────────────────────┤
│  组件层 (components/)                         │
│  overview / alerts / settings / device-mgr    │
│  camera-capture / rag-chat / trend-modal     │
│  auth / role-guard / header / broadcast ...   │
├─────────────────────────────────────────────┤
│  API 封装层 (api/client.js)                   │
│  DashboardApi.User/Community/Device/         │
│  Camera/AiRecognize/Rag/AlarmLog/...          │
├─────────────────────────────────────────────┤
│  工具层 (utils/)     dom / date              │
├─────────────────────────────────────────────┤
│  通信层    HTTP (fetch) + WebSocket (ws.js)  │
└─────────────────────────────────────────────┘
        ↕                    ↕
   REST API (8080)     WebSocket/MQTT (1883)
```

- 纯原生 JS，无框架依赖，无构建步骤
- CSS 变量统一主题，命名空间隔离避免样式冲突
- 版本号参数（`?v=20260901`）绕过浏览器缓存
- 异步操作全部 try/catch 兜底，异常时 Toast 提示

## 后端接口需求

| 模块 | 接口 | 方法 | 说明 |
|------|------|------|------|
| 用户 | `/users/login` | POST | 登录，返回 token + 角色 |
| 用户 | `/users/register` | POST | 注册（支持 role 参数） |
| 用户 | `/users/{id}/audit` | PUT | 审核用户 |
| 社区 | `/community/public` | GET | 公开小区列表（注册页下拉） |
| 设备 | `/devices` | GET | 设备列表（按角色过滤） |
| 设备 | `/devices/realtime` | GET | 实时设备列表 |
| 告警 | `/alarm-logs` | GET | 告警日志 |
| 趋势 | `/smoke-readings/trend` | GET | 传感器趋势数据 |
| 摄像头 | `/cameras` | GET/POST | 摄像头列表/创建 |
| 摄像头 | `/cameras/{id}` | PUT/DELETE | 更新/删除 |
| 摄像头 | `/cameras/{id}/capture` | POST | 拍照上传→AI分析 |
| 摄像头 | `/cameras/{id}/snapshot` | GET | 获取最新画面 |
| 摄像头 | `/cameras/{id}/bind-device/{deviceId}` | POST | 绑定设备 |
| 摄像头 | `/cameras/{id}/bind-device` | DELETE | 解绑设备 |
| AI | `/knowledge-chunks/recognize` | POST | 图像识别 |
| AI | `/knowledge-chunks/chat` | POST | RAG 问答 |
| AI | `/knowledge-chunks/sessions` | GET | 会话列表 |

## 快速开始

```bash
# 1. 进入项目目录
cd frontend-github

# 2. 启动本地 HTTP 服务器（任选一种）
python -m http.server 8088
# 或
npx serve .

# 3. 浏览器打开
# http://localhost:8088/login.html
```

> 需配合后端服务使用。后端启动后，修改 `assets/js/api/client.js` 中的 API 地址（默认动态获取当前 hostname:8080）。

## 文件结构

```
├── index.html              # 管理员界面
├── login.html               # 登录/注册页
├── user.html                # 居民界面
├── firefighter.html         # 消防员界面
├── package.json
└── assets/
    ├── css/
    │   ├── base.css         # 全局变量与重置
    │   ├── layout.css       # 布局结构
    │   ├── components.css   # 组件样式
    │   ├── modals.css       # 弹窗样式
    │   ├── login.css        # 登录页样式
    │   ├── user.css         # 居民页样式
    │   └── animations.css  # 动画
    └── js/
        ├── api/client.js    # 全部后端接口封装
        ├── components/      # 16 个功能组件
        ├── utils/           # DOM 与日期工具
        ├── main.js          # 管理员入口
        ├── login.js         # 登录逻辑
        ├── user.js          # 居民逻辑
        ├── firefighter.js   # 消防员逻辑
        └── ws.js            # WebSocket 实时推送
```
