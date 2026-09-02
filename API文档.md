# 智慧烟感管理平台 — API 接口文档

> 本文档由后端代码梳理生成，供前端对接使用。版本：v2.0 — **含 AI 视觉复核、RAG 智能问答（已启用）、烟感-摄像头一对一绑定**、站内消息、忘记密码、消防员角色完整支持。

## 通用约定

|项目|说明|
|-|-|
|**基础路径**|`http://localhost:8080`|
|**认证方式**|除注册/登录及 3 个硬件上报接口外，所有请求 Header 需携带 `token`（JWT，15 小时有效）。每个请求会实时校验账号状态，**禁用/待审核立即失效（403）**，角色/小区变更即时生效。|
|**统一响应格式**|`{"code": 200, "errorMsg": null, "data": ...}`，成功 `code=200`，失败 `code=4xx/500`|
|**分页格式**|请求 `page`（从 1 开始，默认 1）、`pageSize`（默认 10）；返回 `{"total": "100", "records": [...]}`|
|**ID 类型**|所有 `id`、`deviceId` 等标识字段返回为字符串（避免前端大数精度丢失）|

### 无需 token 的接口

- `POST /users/register`、`POST /users/login`、`POST /users/reset-password`（忘记密码）
- 硬件通道（HTTP 降级）：`POST /devices/heartbeat`、`POST /devices/self-check`、`POST /smoke-readings/report`

### 角色与权限总览

|角色|枚举值|数据范围|说明|
|-|-|-|-|
|居民|`RESIDENT`|本小区只读|查看本小区设备/告警，绑定设备告警重点提示|
|小区管理员|`COMMUNITY_ADMIN`|本小区管理|本小区设备/用户/告警管理|
|消防员|`FIREFIGHTER`|跨小区|查看全部设备/趋势，处置火警（解决/确认/归档）|
|系统管理员|`SYSTEM_ADMIN`|全量|所有小区、用户、设备、阈值、RAG|

> 数据权限规则：居民/小区管理员只能看本小区数据；消防员可跨小区查看设备与火警；系统管理员看全部。

---

## 1. 用户模块 — `/users`

### 1.1 用户注册

- **URL**：`POST /users/register`
- **认证**：不需要
- **说明**：注册支持 `RESIDENT`（普通用户）与 `COMMUNITY_ADMIN`（小区管理员）两种角色，其余角色一律降级为 `RESIDENT`；注册后为**待审核（PENDING）**，需管理员审核通过后才能登录；**注册不返回 token**。

|字段|类型|必填|说明|
|-|-|-|-|
|username|string|是|用户名，不可重复|
|password|string|是|密码（BCrypt 加密存储）|
|role|string|否|`RESIDENT`（默认）/ `COMMUNITY_ADMIN`，其他值降级为 RESIDENT|
|communityId|long|是|归属小区|
|realName|string|否|真实姓名（审核用）|
|phone|string|否|联系电话（审核用）|

```json
{"username": "zhangsan", "password": "123456", "communityId": 2091425987927519234, "realName": "张三", "phone": "13800000000"}
```

- **返回** `LoginVO`：`token` 为 `null`，仅返回 `userId`、`username`、`role`。

### 1.2 用户登录

- **URL**：`POST /users/login`
- **认证**：不需要

```json
{"username": "admin", "password": "123456"}
```

- **返回** `LoginVO`：

|字段|类型|说明|
|-|-|-|
|token|string|JWT 令牌（登录成功才有）|
|userId|string|用户 ID|
|username|string|用户名|
|role|string|角色|
|realName|string|真实姓名|
|phone|string|绑定手机号|
|communityId|long|归属小区 ID（可空）|
|communityName|string|归属小区名称（可空）|
|status|string|账号状态 `ACTIVE`/`PENDING`/`DISABLED`|

- **失败**：待审核返回「账号待审核」，禁用返回「账号已被禁用」。

### 1.3 用户分页列表

- **URL**：`GET /users`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员只看本小区用户）

|参数|类型|必填|说明|
|-|-|-|-|
|page / pageSize|int|否|分页|
|role|string|否|按角色筛选|
|communityId|long|否|按小区筛选|
|status|string|否|`PENDING` / `ACTIVE` / `DISABLED`|

- **返回** `PageResult<UserVO>`：

|字段|类型|说明|
|-|-|-|
|id|string|用户 ID|
|username|string|用户名|
|role|string|角色|
|communityId|long|归属小区|
|status|string|账号状态|
|realName|string|真实姓名|
|phone|string|联系电话|
|createdAt|string|创建时间|

### 1.4 管理员创建用户

- **URL**：`POST /users`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员只能创建居民、只能在本小区创建）

|字段|类型|必填|说明|
|-|-|-|-|
|username|string|是|用户名|
|password|string|是|密码|
|role|string|是|`RESIDENT` / `COMMUNITY_ADMIN` / `FIREFIGHTER`（不能为 SYSTEM_ADMIN）|
|communityId|long|否|归属小区（居民/小区管理员必填；消防员忽略）|
|realName|string|否|真实姓名|
|phone|string|否|联系电话|

- **返回**：`data = "创建成功"`

### 1.5 编辑用户

- **URL**：`PUT /users/{id}`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员不能改角色为管理员/消防员、不能改所属小区）

|字段|类型|必填|说明|
|-|-|-|-|
|role|string|否|新角色|
|communityId|long|否|新小区|
|realName|string|否|真实姓名|
|phone|string|否|联系电话|

### 1.6 启停用户

- **URL**：`PUT /users/{id}/status`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`
- **请求体**：`{"status": "DISABLED"}`（`ACTIVE` / `DISABLED`）

### 1.7 重置密码

- **URL**：`PUT /users/{id}/password`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`
- **请求体**：`{"password": "newpass"}`

### 1.8 审核注册

- **URL**：`PUT /users/{id}/audit`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`
- **请求体**：`{"approve": true}`（`true` 通过→ACTIVE，`false` 拒绝→DISABLED）

### 1.9 删除用户

- **URL**：`DELETE /users/{id}`
- **角色**：`SYSTEM_ADMIN`
- **说明**：不能删除系统管理员；删除时自动清理其设备绑定与小区负责人引用。

### 1.10 查询住户绑定设备

- **URL**：`GET /users/{userId}/devices`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN` / `RESIDENT`（居民只能查自己）
- **返回**：`List<DeviceVO>`

### 1.11 忘记密码（无需登录态）

- **URL**：`POST /users/reset-password`
- **认证**：不需要
- **请求体**：

|字段|类型|必填|说明|
|-|-|-|-|
|username|string|是|登录账号|
|phone|string|是|绑定手机号（需与注册时一致）|
|newPassword|string|是|新密码|

- **说明**：账号 + 绑定手机号匹配后重置密码；不匹配返回错误。

---

## 2. 小区管理 — `/community`

### 2.1 新增小区

- **URL**：`POST /community`
- **角色**：`SYSTEM_ADMIN`
- **请求体** `CommunitySaveRequest`：

|字段|类型|必填|说明|
|-|-|-|-|
|name|string|是|小区名称|
|address|string|否|小区地址|
|adminUserId|long|否|负责人（COMMUNITY_ADMIN 用户 ID）|

### 2.2 小区列表

- **URL**：`GET /community`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员只看本小区）
- **参数**：`page` / `pageSize` / `name`（模糊）
- **返回** `PageResult<CommunityVO>`：

|字段|类型|说明|
|-|-|-|
|id|string|小区 ID|
|name|string|名称|
|address|string|地址|
|adminUserId|string|负责人用户 ID（可空）|
|adminUsername|string|负责人用户名|
|createdAt|string|创建时间|

### 2.3 小区详情

- **URL**：`GET /community/{id}`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员只能看本小区）

### 2.4 修改小区

- **URL**：`PUT /community/{id}`
- **角色**：`SYSTEM_ADMIN`
- **请求体**：同 2.1

### 2.5 删除小区

- **URL**：`DELETE /community/{id}`
- **角色**：`SYSTEM_ADMIN`
- **说明**：小区下存在用户或设备时拒绝删除。

### 2.6 指定小区负责人

- **URL**：`PUT /community/{id}/admin`
- **角色**：`SYSTEM_ADMIN`
- **请求体**：`{"adminUserId": 123}`（`adminUserId` 为空表示清除负责人）
- **说明**：若被指定用户当前为居民（RESIDENT），会自动升级为小区管理员（COMMUNITY_ADMIN）；消防员/系统管理员仍会被拒绝。

---

## 3. 设备管理 — `/devices`

> 数据权限：`RESIDENT`、`COMMUNITY_ADMIN` 只能看本小区设备；`SYSTEM_ADMIN`、`FIREFIGHTER` 看全部设备。

### 3.1 设备分页列表

- **URL**：`GET /devices`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN` / `RESIDENT` / `FIREFIGHTER`

|参数|类型|必填|说明|
|-|-|-|-|
|page / pageSize|int|否|分页|
|deviceName|string|否|名称模糊|
|deviceType|string|否|类型|
|onlineStatus|string|否|`ONLINE` / `OFFLINE`|

- **返回** `PageResult<DeviceVO>`：`id`、`deviceName`、`deviceSn`、`deviceType`、`communityId`、`location`、`onlineStatus`、`batteryLevel`、`boundCameraId`（**绑定的专属摄像头 ID，一对一关系**，可空）、`lastHeartbeatTime`、`createdAt`

### 3.2 设备概览统计

- **URL**：`GET /devices/statistics`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员只统计本小区）
- **返回** `DeviceStatisticsVO`：`totalCount`、`onlineCount`、`offlineCount`、`activeAlarmCount`

### 3.3 设备详情

- **URL**：`GET /devices/{id}`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN` / `RESIDENT` / `FIREFIGHTER`
- **返回** `DeviceDetailVO`（`DeviceVO` 字段 + `latestSmokeConcentration`、`activeAlarmCount`）

### 3.4 添加设备

- **URL**：`POST /devices`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员只能加到本小区，忽略前端传的 communityId）

|字段|类型|必填|说明|
|-|-|-|-|
|deviceName|string|是|设备名称|
|deviceSn|string|是|序列号（唯一）|
|deviceType|string|否|默认 `SMOKE_SENSOR`。可选：`SMOKE_SENSOR` / `CAMERA` / `BROADCAST` / `SPRINKLER` / `EXHAUST_FAN`|
|communityId|long|否|归属小区（小区管理员忽略）|
|location|string|否|安装位置|

- **重要行为（后端自动处理）**：
  - 当 `deviceType = SMOKE_SENSOR`（烟感）时，后端 `@Transactional` **自动在 cameras 表创建同位置的专属摄像头并绑定**（`devices.bound_camera_id` 指向 `cameras.id`，`cameras.bound_device_id` 反向指向烟感），确保一对一。摄像头可在 `GET /cameras` 中查询。
  - 删除烟感时**级联删除 cameras 表中绑定的摄像头**（同事务，不会产生孤儿数据）。
  - 更新烟感名称/位置时，**自动同步到 cameras 表绑定的摄像头**。

### 3.5 编辑设备

- **URL**：`PUT /devices/{id}`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员不能改设备所属小区）

### 3.6 删除设备

- **URL**：`DELETE /devices/{id}`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员只能删本小区设备）
- **说明**：同时删除该设备的烟雾记录、告警和住户绑定关系；若为烟感且绑定了摄像头，**级联删除 cameras 表中的摄像头记录**（同事务）。

### 3.7 绑定住户-设备

- **URL**：`PUT /devices/{deviceId}/bind`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员只能操作本小区）
- **请求体**：`{"userId": 123}`（userId 必须是居民，且与设备同小区）

### 3.8 解绑住户-设备

- **URL**：`PUT /devices/{deviceId}/unbind`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`
- **请求体**：`{"userId": 123}`

### 3.9 硬件心跳上报（HTTP 降级通道）

- **URL**：`POST /devices/heartbeat`，认证不需要
- **请求体**：`{"deviceSn": "SN001", "batteryLevel": 80}`

### 3.10 硬件自检上报（HTTP 降级通道）

- **URL**：`POST /devices/self-check`，认证不需要
- **请求体**：`{"deviceSn": "SN001", "batteryLevel": 10, "sensorFault": false}`

### 3.11 绑定摄像头到烟感（一对一）

- **URL**：`PUT /devices/{smokeDeviceId}/bind-camera/{cameraId}`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`
- **说明**：
  - **`cameraId` 为 cameras 表 ID**（从 `GET /cameras` 获取），与摄像头快照、AI 复核链路统一语义；传 devices 表 ID 会返回"摄像头不存在"。
  - 绑定是**一对一**关系，一个摄像头只能被一个烟感绑定（已被绑的摄像头会返回"该摄像头已被其他烟感绑定，请先解绑"）。
  - `smokeDeviceId` 必须是 `SMOKE_SENSOR` 类型设备。
  - 小区隔离：摄像头必须与烟感**同小区**，跨小区返回 403。
  - 绑定成功后**双向同步**：`devices.bound_camera_id = cameraId` 且 `cameras.bound_device_id = smokeDeviceId`；若烟感原已绑定其他摄像头，原摄像头关联自动被替换。

### 3.12 解绑烟感的摄像头

- **URL**：`DELETE /devices/{smokeDeviceId}/bind-camera`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`
- **说明**：小区管理员只能解绑本小区烟感的摄像头。解绑**同时清空双向关系**（`devices.bound_camera_id` 置空 + `cameras.bound_device_id` 置空），不会删除摄像头记录。

### 3.13 摄像头管理 — `/cameras`

摄像头独立表（`cameras`），通过 `bound_device_id` 与烟感一对一关联（与 3.11/3.12 双向同步）。所有接口需登录。

|接口|方法|角色|说明|
|-|-|-|-|
|`/cameras`|GET|全部角色|分页列表，参数 `page`、`pageSize`、`cameraName`、`onlineStatus`；居民/小区管理员只看本小区|
|`/cameras/{id}`|GET|全部角色|摄像头详情|
|`/cameras`|POST|`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`|创建摄像头|
|`/cameras/{id}`|PUT|`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`|更新摄像头|
|`/cameras/{id}`|DELETE|`SYSTEM_ADMIN`|删除摄像头（若绑定烟感则同步解绑）|
|`/cameras/{id}/capture`|POST|全部角色|拍照上传：`{"image": "<base64>"}`，保存文件并更新 `snapshotUrl`|
|`/cameras/{id}/snapshot`|GET|全部角色|获取最新截图 URL|
|`/cameras/{id}/bind-device/{deviceId}`|POST|`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`|摄像头侧绑定烟感（双向同步，等价 3.11）|
|`/cameras/{id}/bind-device`|DELETE|`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`|摄像头侧解绑（双向清理）|

- **CameraVO 字段**：`id`、`cameraName`、`cameraSn`、`communityId`、`communityName`、`location`、`onlineStatus`、`boundDeviceId`、`boundDeviceName`、`snapshotUrl`、`createdAt`

---

## 4. 烟雾监测 — `/smoke-readings`

### 4.1 烟雾记录分页列表

- **URL**：`GET /smoke-readings`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN` / `RESIDENT` / `FIREFIGHTER`
- **参数**：`page` / `pageSize` / `deviceId` / `startTime` / `endTime`
- **返回** `PageResult<SmokeReadingsVO>`：`id`、`deviceId`、`deviceName`、`smokeConcentration`、`temperature`、`coConcentration`、`createdAt`

### 4.2 设备最新烟雾

- **URL**：`GET /smoke-readings/latest/{deviceId}`
- **返回** `LatestSmokeVO`：`deviceId`、`smokeConcentration`、`temperature`、`coConcentration`、`createdAt`

### 4.3 历史趋势（多指标）

- **URL**：`GET /smoke-readings/trend`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN` / `RESIDENT`

|参数|类型|必填|说明|
|-|-|-|-|
|deviceId|long|是|设备 ID|
|startTime|string|是|`yyyy-MM-dd HH:mm:ss`|
|endTime|string|是|`yyyy-MM-dd HH:mm:ss`|

- **返回** `TrendVO`（三条曲线，供折线图）：

```json
{
  "smoke": [{"time": "2026-08-23T15:26:54", "value": "50.00"}],
  "temperature": [{"time": "2026-08-23T15:26:54", "value": "25.00"}],
  "co": [{"time": "2026-08-23T15:26:54", "value": "5.00"}]
}
```

### 4.4 烟雾数据上报（HTTP 降级通道）

- **URL**：`POST /smoke-readings/report`，认证不需要
- **请求体**：`{"deviceSn": "SN001", "smokeConcentration": 250, "temperature": 60, "coConcentration": 150}`
- **说明**：刷新在线状态、保存记录、WebSocket 推送，并触发规则引擎分级判定。
- **错误处理**：`deviceSn` 不存在时返回 **400**（`设备不存在: SNxxx`），拒绝入库；MQTT 通道由网关兜底捕获异常，不影响连接。

---

## 5. 告警管理 — `/alarm-logs`

> 数据权限：居民/小区管理员只看本小区告警；消防员只看火警；系统管理员看全部。

### 5.1 告警分页列表

- **URL**：`GET /alarm-logs`
- **参数**：`page` / `pageSize` / `deviceId` / `alarmType` / `alarmLevel` / `status`
- **返回** `PageResult<AlarmLogVO>`：`id`、`deviceId`、`deviceName`、`alarmType`、`alarmLevel`、`message`、`status`、`disposition`、`acknowledgedAt`、`escalated`、`createdAt`、`resolvedAt`

### 5.2 告警统计

- **URL**：`GET /alarm-logs/statistics`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN` / `FIREFIGHTER`
- **返回** `AlarmStatisticsVO`：`activeCount`、`fireCount`、`warnCount`、`byType[]`

### 5.3 告警详情

- **URL**：`GET /alarm-logs/{id}`
- **返回**：`AlarmLogVO`

### 5.4 解决告警

- **URL**：`PUT /alarm-logs/{id}/resolve`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN` / `FIREFIGHTER`（消防员只能解决火警）

### 5.5 确认告警（记录确认时间）

- **URL**：`PUT /alarm-logs/{id}/acknowledge`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN` / `FIREFIGHTER`

### 5.6 确认处置结论（误报率统计用）

- **URL**：`PUT /alarm-logs/{id}/confirm`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN` / `FIREFIGHTER`（消防员只能处置火警）
- **请求体**：`{"disposition": "CONFIRMED_FIRE"}`（`CONFIRMED_FIRE` / `FALSE_ALARM`）

---

## 6. 阈值配置 — `/threshold-config`

### 6.1 获取阈值

- **URL**：`GET /threshold-config`
- **返回** `ThresholdConfigVO`：`id`、`smokeWarnThreshold`、`smokeAlarmThreshold`、`temperatureThreshold`、`coThreshold`、`heartbeatTimeout`、`batteryLowThreshold`、`debounceCount`、`escalationMinutes`、`multiParamEnabled`、`updatedAt`

### 6.2 更新阈值

- **URL**：`PUT /threshold-config`
- **角色**：`SYSTEM_ADMIN`
- **请求体**：上述字段，非空才更新。

---

## 7. 控制日志 — `/control-logs`

- **URL**：`GET /control-logs`（分页，参数 `page` / `pageSize` / `deviceId` / `command` / `operatorId`）
- **URL**：`GET /control-logs/{id}`
- **角色**：`SYSTEM_ADMIN`
- **返回** `ControlLogVO`：`id`、`deviceId`、`deviceName`、`operatorId`、`operatorName`、`command`、`source`、`result`、`createdAt`

---

## 8. 站内消息 — `/messages`

居民与管理员之间的双向消息。

### 8.1 居民发消息给管理员

- **URL**：`POST /messages`
- **角色**：`RESIDENT`
- **请求体**：`{"content": "..."}`
- **返回**：`data = "发送成功"`

### 8.2 管理员查消息

- **URL**：`GET /messages`
- **角色**：`SYSTEM_ADMIN`（看全部）/ `COMMUNITY_ADMIN`（看本小区）
- **返回**：`List<MessageVO>`

### 8.3 居民查我的消息

- **URL**：`GET /messages/my`
- **角色**：`RESIDENT`
- **返回**：`List<MessageVO>`（自己发的消息 + 管理员回复）

### 8.4 管理员回复居民消息

- **URL**：`POST /messages/{id}/reply`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`
- **请求体**：`{"content": "..."}`

### 8.5 管理员标记已读

- **URL**：`PUT /messages/{id}/read`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`

**MessageVO 字段**：`id`、`senderUserId`、`senderUsername`、`communityId`、`type`、`content`、`status`、`replyToId`、`senderRole`（`RESIDENT`/`ADMIN`）、`createdAt`

---

## 9. RAG 消防知识问答 — `/knowledge-chunks`

> **已启用**：后端已接入 SiliconFlow 大模型（Qwen2.5-7B-Instruct + BAAI/bge-m3 embedding），6 篇消防知识已向量化入库。异常时自动降级为纯 LLM 回答。
>
> **检索阈值**：向量检索按余弦距离过滤（`embedding <=> query < llm.rag.similarity-threshold`，默认 0.75），完全无关的长句不再被强凑进 `sources`；阈值可在 `application-secret.yml` 中调整（越小越严格）。

### 9.1 智能问答（支持多轮会话）

- **URL**：`POST /knowledge-chunks/chat`
- **角色**：所有已登录用户
- **请求体 `ChatRequest`**：

|字段|类型|必填|说明|
|-|-|-|-|
|message|string|是|用户问题|
|sessionId|long|否|多轮续接时传上一次返回的 sessionId；不传则新建会话|

```json
{"message": "油锅起火怎么办？"}
// 或多轮续接：
{"message": "报警器装在哪里？", "sessionId": 2092889598818066433}
```

- **返回 `ChatResponse`**：

|字段|类型|说明|
|-|-|-|
|answer|string|大模型生成的回答文本|
|sessionId|long|会话 ID（多轮对话续接用；首次提问返回新 ID，续接时返回传入的 ID）|
|sources|`List<ChatSource>`|命中的知识来源片段（前端可展示为引用）|

ChatSource 字段：`title`（知识标题）、`content`（片段内容）

```json
{
  "code": 200,
  "data": {
    "answer": "油锅起火时应立即盖上锅盖隔绝空气...",
    "sessionId": 2092889598818066433,
    "sources": [
      {"title": "家庭火灾处置指南", "content": "油锅起火是厨房常见火情..."},
      {"title": "灭火基本方法", "content": "窒息法：用锅盖或湿布覆盖..."},
      {"title": "智能烟感联动说明", "content": "当烟感检测到烟雾浓度超标..."}
    ]
  }
}
```

### 9.2 当前用户会话列表

- **URL**：`GET /knowledge-chunks/sessions`
- **角色**：所有已登录用户（只能查自己的会话）
- **返回** `List<ChatSessionVO>`：

|字段|类型|说明|
|-|-|-|
|id|string|会话 ID|
|title|string|会话标题（首问自动截取）|
|updatedAt|string|最后更新时间|

### 9.3 会话历史消息

- **URL**：`GET /knowledge-chunks/sessions/{sessionId}/messages`
- **角色**：所有已登录用户（只能查自己的会话，否则 403）
- **返回** `List<ChatMessageVO>`：

|字段|类型|说明|
|-|-|-|
|role|string|`USER` / `ASSISTANT`|
|content|string|消息内容|
|sources|`List<ChatSource>`|AI 回复的引用来源（USER 消息该字段为 null）|
|createdAt|string|创建时间|

### 9.4 删除会话

- **URL**：`DELETE /knowledge-chunks/sessions/{sessionId}`
- **角色**：所有已登录用户（只能删自己的会话，否则 403）
- **返回**：`data = null`

### 9.5 知识导入（管理员）

- **URL**：`POST /knowledge-chunks/import`
- **角色**：`SYSTEM_ADMIN`
- **请求体 `KnowledgeImportRequest`**：

|字段|类型|必填|说明|
|-|-|-|-|
|documents|`List<Doc>`|是|知识文档列表|

Doc 字段：

|字段|类型|必填|说明|
|-|-|-|-|
|title|string|是|知识标题|
|content|string|是|知识正文（后端自动切块：chunkSize=500, overlap=50，每块独立向量化）|

```json
{
  "documents": [
    {"title": "火灾应急预案", "content": "发生火灾时应保持冷静..."},
    {"title": "灭火器使用方法", "content": "干粉灭火器适用于..." }
  ]
}
```

- **返回**：`data = "成功导入 12 条知识"`（数字为切块数）

---

## 10. AI 视觉复核（明火检测） — `/ai-review`

> **已启用**：FIRE 级别告警自动触发 `@Async` 异步视觉复核（不阻塞主流程）。后端接入 SiliconFlow 视觉大模型（Qwen3-VL-8B-Instruct），摄像头查找用三级降级策略：优先绑定的专属摄像头（`devices.bound_camera_id`，统一指向 **cameras 表**）→ 同小区在线摄像头 → 同小区任意摄像头。结果通过 WebSocket `/topic/ai-review` 实时推送。
>
> **图片来源三级优先**：① 手动重试显式传入的 `imageUrl` → ② 本机电脑摄像头实时截图（`camera-enabled: true` 时用 ffmpeg dshow 拍一帧，存 `uploads/ai-review/`，通过 `/images/ai-review/**` 静态访问）→ ③ 配置的 `default-snapshot-url`（仿真模式，无摄像头/截图失败时自动降级）。

### 10.1 查询某告警的 AI 复核结果

- **URL**：`GET /ai-review/{alarmLogId}`
- **角色**：所有已登录用户（**数据权限校验**：小区管理员/普通用户只能查本小区告警的 AI 结果）
- **返回** `AiReviewVO`：

|字段|类型|说明|
|-|-|-|
|id|string|AI 复核记录 ID|
|alarmLogId|string|关联的告警记录 ID|
|smokeDeviceId|string|烟感设备 ID|
|cameraDeviceId|string|使用的摄像头 ID（**cameras 表 ID**）|
|cameraDeviceName|string|摄像头名称（cameras 表 `camera_name`）|
|imageUrl|string|AI 复核使用的图片地址。两种形态：本机截图为**相对路径**（`/images/ai-review/review-x.jpg`，前端需拼 `API_BASE` 后展示 `<img>`）；仿真/外链为**完整 URL**，直接展示|
|aiResult|string|AI 判定结果：`FIRE`（确认火情）/ `NO_FIRE`（无火情）/ `UNCERTAIN`（不确定）|
|confidence|string|置信度（0.0 - 1.0，如 "0.98"）|
|aiDescription|string|AI 返回的自然语言描述|
|status|string|复核状态：`PENDING`（进行中）/ `SUCCESS`（完成）/ `FAILED`（失败）|
|reviewTime|string|复核完成时间|
|errorMessage|string|失败时的错误信息|
|createdAt|string|创建时间|

- **返回为 null 的场景**：该告警尚未触发 AI 复核（如非 FIRE 级别的告警不会自动触发）。

### 10.2 手动触发 / 重试 AI 复核

- **URL**：`POST /ai-review/{alarmLogId}/retry`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员只能重试本小区告警）
- **请求体**（可选）：

|字段|类型|必填|说明|
|-|-|-|-|
|imageUrl|string|否|指定图片 URL 覆盖默认来源（最高优先级）；不传则按 10 章开头的三级优先自动选择|

```json
{}
// 或指定图片：
{"imageUrl": "https://example.com/fire-snapshot.jpg"}
```

- **返回**：`data = null`（触发即返回，实际复核异步进行；前端通过 WebSocket `/topic/ai-review` 等待结果，或轮询 10.1 接口）

### 10.3 自动触发时机

后端在 `AlarmLogsServiceImpl.createAlarm()` 创建 **FIRE** 级别告警时，自动 `@Async` 异步调用 AI 复核，无需前端手动触发。

### 10.4 图片可视化（静态资源）

本机摄像头截图保存在后端 `uploads/ai-review/` 目录，并映射为静态资源：

- **URL**：`GET /images/ai-review/{文件名}`（如 `/images/ai-review/review-12-1756280000000.jpg`）
- **认证**：无需 token（静态资源不受 JWT 拦截器校验），`<img>` 标签可直接引用
- **跨域**：已允许任意来源（同全局 CORS 配置）
- **前端展示**：`<img :src="API_BASE + imageUrl" />`（imageUrl 为相对路径时）或 `<img :src="imageUrl" />`（完整 URL 时）

---

## 11. WebSocket 实时推送 — `/ws`

- **连接**：`ws://localhost:8080/ws?token={jwt_token}`（STOMP over WebSocket）
- **消息信封**：`{"type": "...", "timestamp": "...", "data": {...}}`

|主题|订阅者|消息类型|触发时机|
|-|-|-|-|
|`/topic/smoke-readings`|全部|`SMOKE_REPORTED`|烟雾数据上报|
|`/topic/device-online`|全部|`DEVICE_ONLINE_STATUS_CHANGED`|设备上线/离线（心跳超时判定、上报刷新）|
|`/topic/alarms`|全部|`ALARM_ESCALATED`|告警升级（定时任务 AlertEscalationTask 检测到超时未处理时）|
|`/topic/alarms/fire`|全部角色|`ALARM_CREATED`|火警（跨小区广播）|
|`/topic/community/{communityId}/alarms`|本小区居民/管理员|`ALARM_CREATED`|本小区非火警告警（离线/低电量/故障等）|
|`/topic/ai-review`|全部登录态|`AI_REVIEW_RESULT`|AI 视觉复核完成（data 为 AiReviewVO，含 aiResult/confidence/aiDescription/status）|
|`/user/{userId}/queue/alerts`|单个住户|`ALARM_HIGHLIGHT`|绑定设备告警重点提示（定向推送）|

> 注意：`/topic/device-status`（`DEVICE_STATUS_CHANGED`）目前后端已定义但未启用推送，属于预留主题；`/topic/community/{id}/devices` 与 `/topic/community/{id}/smoke` 同样为预留，当前实际推送走全局主题。

---

## 12. MQTT 主题（硬件通信）

|Topic|方向|QoS|说明|
|-|-|-|-|
|`smoke-sensor/{deviceSn}/smoke`|硬件 → 服务端|0|烟雾上报（含温度/CO）|
|`smoke-sensor/{deviceSn}/alarm`|硬件 → 服务端|1|硬件主动告警|
|`smoke-sensor/{deviceSn}/heartbeat`|硬件 → 服务端|0|心跳（含电量）|
|`smoke-sensor/{deviceSn}/self-check`|硬件 → 服务端|0|自检（电量+传感器状态）|
|`smoke-sensor/{deviceSn}/command`|服务端 → 硬件|1|下发指令（预留）|

消息体示例：

```json
// smoke
{"deviceSn": "SN001", "smokeConcentration": 250, "temperature": 60, "coConcentration": 150}
// alarm
{"deviceSn": "SN001", "alarmType": "SMOKE_HIGH", "message": "烟雾异常"}
// heartbeat
{"deviceSn": "SN001", "batteryLevel": 80}
// self-check
{"deviceSn": "SN001", "batteryLevel": 10, "sensorFault": false}
```

---

## 附录 A：枚举值

**账号状态 `status`**：`PENDING`（待审核）、`ACTIVE`（正常）、`DISABLED`（禁用）

**告警类型 `alarmType`**：`SMOKE_HIGH`、`TEMP_HIGH`、`CO_HIGH`、`OFFLINE`、`LOW_BATTERY`、`SENSOR_FAULT`

**告警等级 `alarmLevel`**：`WARN`、`FIRE`、`OFFLINE`、`FAULT`、`LOW_BATTERY`

**告警状态 `status`**：`ACTIVE`、`RESOLVED`

**处置结论 `disposition`**：`CONFIRMED_FIRE`、`FALSE_ALARM`

**在线状态 `onlineStatus`**：`ONLINE`、`OFFLINE`

**设备类型 `deviceType`**：`SMOKE_SENSOR`、`CAMERA`、`BROADCAST`、`SPRINKLER`、`EXHAUST_FAN`、`FIRE_DOOR`、`ELEVATOR`

## 附录 B：错误返回结构

```json
{"code": 500, "errorMsg": "错误描述", "data": null}
```

常见错误码：`400` 参数错误、`401` 未登录/登录过期、`403` 无权限或账号禁用/待审核、`404` 资源不存在、`500` 服务器错误。
