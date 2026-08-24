# 智慧烟感管理平台 — API 接口文档

> 本文档由后端代码梳理生成，供前端对接使用。版本：前端 Web 面板 + 站内消息 + 忘记密码 + 消防员角色完整支持。

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

- **返回** `PageResult<DeviceVO>`：`id`、`deviceName`、`deviceSn`、`deviceType`、`communityId`、`location`、`onlineStatus`、`batteryLevel`、`lastHeartbeatTime`、`createdAt`

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
|deviceType|string|否|默认 `SMOKE_SENSOR`|
|communityId|long|否|归属小区（小区管理员忽略）|
|location|string|否|安装位置|

### 3.5 编辑设备

- **URL**：`PUT /devices/{id}`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员不能改设备所属小区）

### 3.6 删除设备

- **URL**：`DELETE /devices/{id}`
- **角色**：`SYSTEM_ADMIN` / `COMMUNITY_ADMIN`（小区管理员只能删本小区设备）
- **说明**：同时删除该设备的烟雾记录、告警和住户绑定关系。

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

## 9. RAG 问答 — `/knowledge-chunks`

### 8.1 大模型问答

- **URL**：`POST /knowledge-chunks/chat`
- **请求体**：`{"message": "烟感报警后应该怎么疏散人员？"}`
- **返回**：`data = "大模型回复文本"`

### 8.2 知识库导入

- **URL**：`POST /knowledge-chunks/import`
- **角色**：`SYSTEM_ADMIN`
- **请求体**：`{"documents": [{"title": "火灾应急预案", "content": "..."}]}`

---

## 9. WebSocket 实时推送 — `/ws`

- **连接**：`ws://localhost:8080/ws?token={jwt_token}`（STOMP over WebSocket）
- **消息信封**：`{"type": "...", "timestamp": "...", "data": {...}}`

|主题|订阅者|消息类型|触发时机|
|-|-|-|-|
|`/topic/smoke-readings`|全部|`SMOKE_REPORTED`|烟雾数据上报|
|`/topic/device-online`|全部|`DEVICE_ONLINE_STATUS_CHANGED`|设备上线/离线|
|`/topic/alarms/fire`|全部角色|`ALARM_CREATED`|火警（跨小区广播）|
|`/topic/community/{communityId}/alarms`|本小区居民/管理员|`ALARM_CREATED`|本小区告警（含离线/低电量/故障）|
|`/topic/community/{communityId}/devices`|本小区管理员|`DEVICE_STATUS_CHANGED`|设备状态与自检|
|`/topic/community/{communityId}/smoke`|本小区居民/管理员|`SMOKE_REPORTED`|烟雾读数|
|`/user/{userId}/queue/alerts`|单个住户|`ALARM_HIGHLIGHT`|绑定设备告警重点提示（定向推送）|

---

## 11. MQTT 主题（硬件通信）

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
