# 智慧烟感管理平台 — API 接口文档

> 本文档由后端代码梳理生成，供前端对接使用。

## 通用约定

|项目|说明|
|-|-|
|**基础路径**|`http://localhost:8080`|
|**认证方式**|除注册/登录及 3 个硬件上报接口外，所有请求 Header 需携带 `token`（JWT，15 小时有效）|
|**统一响应格式**|`{"code": 200, "errorMsg": null, "data": ...}`，成功 `code=200`，失败 `code=4xx/500`|
|**分页格式**|请求 `page`（从 1 开始，默认 1）、`pageSize`（默认 10）；返回 `{"total": "100", "records": \[...]}`|
|**时间格式**|ISO 8601，如 `2026-08-22T16:44:41.454783`|
|**ID 类型**|所有 `id`、`deviceId` 等标识字段返回为字符串（避免前端大数精度丢失）|

### 无需 token 的接口

* `POST /users/register`、`POST /users/login`
* 硬件通道（HTTP 降级）：`POST /devices/heartbeat`、`POST /devices/self-check`、`POST /smoke-readings/report`

### 角色枚举（role）

|值|含义|
|-|-|
|`RESIDENT`|居民|
|`COMMUNITY\_ADMIN`|小区管理员|
|`SYSTEM\_ADMIN`|系统管理员|
|`FIREFIGHTER`|消防员|

\---

## 1\. 用户模块 — `/users`

### 1.1 用户注册

* **URL**：`POST /users/register`
* **认证**：不需要
* **请求体**：

|字段|类型|必填|说明|
|-|-|-|-|
|username|string|是|用户名，不可重复|
|password|string|是|密码（BCrypt 加密存储）|
|role|string|否|角色，默认 `RESIDENT`|
|communityId|long|否|归属小区|

```json
{"username": "admin", "password": "123456", "role": "SYSTEM\_ADMIN", "communityId": 1}
```

* **返回** `LoginVO`：

|字段|类型|说明|
|-|-|-|
|token|string|JWT 令牌|
|userId|string|用户 ID|
|username|string|用户名|
|role|string|角色|

### 1.2 用户登录

* **URL**：`POST /users/login`
* **认证**：不需要
* **请求体**：

```json
{"username": "admin", "password": "123456"}
```

* **返回**：`LoginVO`（同上）

\---

## 2\. 设备管理 — `/devices`

> 数据权限：`RESIDENT`、`COMMUNITY\_ADMIN` 只能看到本 `communityId` 的设备；`SYSTEM\_ADMIN`、`FIREFIGHTER` 可见全部。

### 2.1 设备分页列表

* **URL**：`GET /devices`
* **请求参数**：

|参数|类型|必填|说明|
|-|-|-|-|
|page|int|否|默认 1|
|pageSize|int|否|默认 10|
|deviceName|string|否|名称模糊搜索|
|deviceType|string|否|类型，见附录|
|onlineStatus|string|否|`ONLINE` / `OFFLINE`|

* **返回**：`PageResult<DeviceVO>`

|字段|类型|说明|
|-|-|-|
|id|string|设备 ID|
|deviceName|string|设备名称|
|deviceSn|string|设备序列号（硬件标识）|
|deviceType|string|设备类型|
|communityId|long|归属小区|
|location|string|安装位置|
|onlineStatus|string|在线状态|
|batteryLevel|int|电量百分比（可空）|
|lastHeartbeatTime|string|最近心跳时间|
|createdAt|string|创建时间|

### 2.2 设备概览统计

* **URL**：`GET /devices/statistics`
* **返回** `DeviceStatisticsVO`：

|字段|类型|说明|
|-|-|-|
|totalCount|string|设备总数|
|onlineCount|string|在线数|
|offlineCount|string|离线数|
|activeAlarmCount|string|活跃告警数|

### 2.3 设备详情

* **URL**：`GET /devices/{id}`
* **路径参数**：`id` 设备 ID
* **返回** `DeviceDetailVO`（`DeviceVO` 全部字段 + 以下）：

|字段|类型|说明|
|-|-|-|
|latestSmokeConcentration|number|最新烟雾浓度|
|activeAlarmCount|long|活跃告警数|

### 2.4 添加设备

* **URL**：`POST /devices`
* **角色**：`SYSTEM\_ADMIN` / `COMMUNITY\_ADMIN`
* **请求体**：

|字段|类型|必填|说明|
|-|-|-|-|
|deviceName|string|是|设备名称|
|deviceSn|string|是|序列号（唯一）|
|deviceType|string|否|默认 `SMOKE\_SENSOR`|
|communityId|long|否|归属小区|
|location|string|否|安装位置|

```json
{"deviceName": "1栋1单元301烟感", "deviceSn": "SN001", "deviceType": "SMOKE\_SENSOR", "communityId": 1, "location": "1栋-1单元-301"}
```

* **返回**：`data = "添加成功"`

### 2.5 编辑设备

* **URL**：`PUT /devices/{id}`
* **角色**：`SYSTEM\_ADMIN` / `COMMUNITY\_ADMIN`
* **请求体**：同 2.4（`deviceSn` 不可修改，忽略即可）

### 2.6 删除设备

* **URL**：`DELETE /devices/{id}`
* **角色**：`SYSTEM\_ADMIN`
* **返回**：`data = "删除成功"`（同时删除该设备的烟雾记录和告警）

### 2.7 硬件心跳上报（HTTP 降级通道）

* **URL**：`POST /devices/heartbeat`
* **认证**：不需要（硬件通道）
* **请求体**：

```json
{"deviceSn": "SN001", "batteryLevel": 80}
```

|字段|类型|必填|说明|
|-|-|-|-|
|deviceSn|string|是|设备序列号|
|batteryLevel|int|否|电量百分比|

* **返回**：`data = "ok"`

### 2.8 硬件自检上报（HTTP 降级通道）

* **URL**：`POST /devices/self-check`
* **认证**：不需要（硬件通道）
* **请求体**：

```json
{"deviceSn": "SN001", "batteryLevel": 10, "sensorFault": false}
```

|字段|类型|必填|说明|
|-|-|-|-|
|deviceSn|string|是|设备序列号|
|batteryLevel|int|否|电量百分比|
|sensorFault|boolean|否|传感器是否故障|

* **返回**：`data = "ok"`（`sensorFault=true` 时触发 `SENSOR\_FAULT` 告警）

\---

## 3\. 烟雾监测 — `/smoke-readings`

### 3.1 烟雾记录分页列表

* **URL**：`GET /smoke-readings`
* **请求参数**：

|参数|类型|必填|说明|
|-|-|-|-|
|page|int|否|默认 1|
|pageSize|int|否|默认 10|
|deviceId|long|否|设备 ID|
|startTime|string|否|开始时间 `yyyy-MM-dd HH:mm:ss`|
|endTime|string|否|结束时间|

* **返回**：`PageResult<SmokeReadingsVO>`

|字段|类型|说明|
|-|-|-|
|id|string|记录 ID|
|deviceId|string|设备 ID|
|deviceName|string|设备名称|
|smokeConcentration|number|烟雾浓度|
|temperature|number|温度（可空）|
|coConcentration|number|CO 浓度（可空）|
|createdAt|string|采集时间|

### 3.2 设备最新烟雾

* **URL**：`GET /smoke-readings/latest/{deviceId}`
* **返回** `LatestSmokeVO`：`deviceId`、`smokeConcentration`、`temperature`、`coConcentration`、`createdAt`

### 3.3 历史趋势

* **URL**：`GET /smoke-readings/trend`
* **请求参数**：

|参数|类型|必填|说明|
|-|-|-|-|
|deviceId|long|是|设备 ID|
|startTime|string|是|`yyyy-MM-dd HH:mm:ss`|
|endTime|string|是|`yyyy-MM-dd HH:mm:ss`|

* **返回**：`List<TrendPointVO>`（`time` + `value`，按时间升序，供折线图）

### 3.4 烟雾数据上报（HTTP 降级通道）

* **URL**：`POST /smoke-readings/report`
* **认证**：不需要（硬件通道）
* **请求体**：

```json
{"deviceSn": "SN001", "smokeConcentration": 250, "temperature": 60, "coConcentration": 150}
```

|字段|类型|必填|说明|
|-|-|-|-|
|deviceSn|string|是|设备序列号|
|smokeConcentration|number|是|烟雾浓度|
|temperature|number|否|温度（联合判定用）|
|coConcentration|number|否|CO 浓度（联合判定用）|

* **返回**：`data = "ok"`

> \*\*说明\*\*：上报会自动刷新设备在线状态、保存记录，并触发规则引擎分级判定（连续超阈值 N 次后产生告警）。

\---

## 4\. 告警管理 — `/alarm-logs`

### 4.1 告警分页列表

* **URL**：`GET /alarm-logs`
* **请求参数**：

|参数|类型|必填|说明|
|-|-|-|-|
|page / pageSize|int|否|分页|
|deviceId|long|否|设备 ID|
|alarmType|string|否|告警类型|
|alarmLevel|string|否|告警等级|
|status|string|否|`ACTIVE` / `RESOLVED`|

* **返回**：`PageResult<AlarmLogVO>`

|字段|类型|说明|
|-|-|-|
|id|string|告警 ID|
|deviceId|string|设备 ID|
|deviceName|string|设备名称|
|alarmType|string|告警类型|
|alarmLevel|string|告警等级|
|message|string|告警详情|
|status|string|`ACTIVE` / `RESOLVED`|
|disposition|string|处置结论（可空）|
|acknowledgedAt|string|首次确认时间（可空）|
|escalated|boolean|是否已升级|
|createdAt|string|产生时间|
|resolvedAt|string|解决时间（可空）|

### 4.2 告警统计

* **URL**：`GET /alarm-logs/statistics`
* **返回** `AlarmStatisticsVO`：

|字段|类型|说明|
|-|-|-|
|activeCount|string|活跃告警总数|
|fireCount|string|活跃火警数|
|warnCount|string|活跃预警数|
|byType|array|`\[{alarmType, count}]` 按类型统计|

### 4.3 告警详情

* **URL**：`GET /alarm-logs/{id}`
* **返回**：`AlarmLogVO`

### 4.4 解决告警

* **URL**：`PUT /alarm-logs/{id}/resolve`
* **角色**：`SYSTEM\_ADMIN` / `COMMUNITY\_ADMIN`
* **返回**：`data = "处理成功"`

### 4.5 确认告警（记录确认时间）

* **URL**：`PUT /alarm-logs/{id}/acknowledge`
* **角色**：`SYSTEM\_ADMIN` / `COMMUNITY\_ADMIN`

### 4.6 确认处置结论（误报率统计用）

* **URL**：`PUT /alarm-logs/{id}/confirm`
* **角色**：`SYSTEM\_ADMIN` / `COMMUNITY\_ADMIN` / `FIREFIGHTER`
* **请求体**：

```json
{"disposition": "CONFIRMED\_FIRE"}
```

|字段|类型|必填|说明|
|-|-|-|-|
|disposition|string|是|`CONFIRMED\_FIRE`（真火警）/ `FALSE\_ALARM`（误报）|

\---

## 5\. 阈值配置 — `/threshold-config`

### 5.1 获取阈值

* **URL**：`GET /threshold-config`
* **返回** `ThresholdConfigVO`：

|字段|类型|说明|
|-|-|-|
|id|string|配置 ID（固定 1）|
|smokeWarnThreshold|number|烟雾预警阈值|
|smokeAlarmThreshold|number|烟雾报警阈值（火警）|
|temperatureThreshold|number|温度阈值（联合判定）|
|coThreshold|number|CO 阈值（联合判定）|
|heartbeatTimeout|int|心跳超时秒数|
|batteryLowThreshold|int|低电量阈值百分比|
|debounceCount|int|消抖连续次数|
|escalationMinutes|int|告警升级分钟数|
|multiParamEnabled|boolean|是否启用多参数联合判定|
|updatedAt|string|更新时间|

### 5.2 更新阈值

* **URL**：`PUT /threshold-config`
* **角色**：`SYSTEM\_ADMIN`
* **请求体**：`ThresholdUpdateRequest`（上述字段，均为可选，非空才更新）

```json
{"smokeWarnThreshold": 100, "smokeAlarmThreshold": 200, "debounceCount": 3}
```

\---

## 6\. 控制日志 — `/control-logs`

### 6.1 日志分页列表

* **URL**：`GET /control-logs`
* **角色**：`SYSTEM\_ADMIN`
* **请求参数**：`page` / `pageSize` / `deviceId` / `command` / `operatorId`
* **返回**：`PageResult<ControlLogVO>`

|字段|类型|说明|
|-|-|-|
|id|string|日志 ID|
|deviceId|string|设备 ID（可空）|
|deviceName|string|设备名称|
|operatorId|string|操作人 ID（可空）|
|operatorName|string|操作人用户名|
|command|string|操作类型|
|source|string|`SYSTEM` / `MANUAL` / `AUTO`|
|result|string|`SUCCESS` / `FAIL`|
|createdAt|string|操作时间|

### 6.2 日志详情

* **URL**：`GET /control-logs/{id}`
* **角色**：`SYSTEM\_ADMIN`

\---

## 7\. RAG 问答 — `/knowledge-chunks`

### 7.1 大模型问答

* **URL**：`POST /knowledge-chunks/chat`
* **请求体**：

```json
{"message": "烟感报警后应该怎么疏散人员？"}
```

* **返回**：`data = "大模型回复文本"`

### 7.2 知识库导入

* **URL**：`POST /knowledge-chunks/import`
* **角色**：`SYSTEM\_ADMIN`
* **请求体**：

```json
{"documents": \[{"title": "火灾应急预案", "content": "发现火情后..."}]}
```

* **返回**：`data = "成功导入 N 条知识"`

\---

## 8\. WebSocket 实时推送 — `/ws`

* **连接**：`ws://localhost:8080/ws?token={jwt\_token}`（STOMP over WebSocket）
* **消息信封**：`{"type": "...", "timestamp": "...", "data": {...}}`

|主题|消息类型|触发时机|
|-|-|-|
|`/topic/smoke-readings`|`SMOKE\_REPORTED`|烟雾数据上报|
|`/topic/device-status`|`DEVICE\_STATUS\_CHANGED`|设备状态变更|
|`/topic/device-online`|`DEVICE\_ONLINE\_STATUS\_CHANGED`|设备上线/离线|
|`/topic/alarms`|`ALARM\_CREATED`|新告警|
|`/topic/alarms`|`ALARM\_ESCALATED`|告警升级|

\---

## 9\. MQTT 主题（硬件通信）

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
{"deviceSn": "SN001", "alarmType": "SMOKE\_HIGH", "message": "烟雾异常"}
// heartbeat
{"deviceSn": "SN001", "batteryLevel": 80}
// self-check
{"deviceSn": "SN001", "batteryLevel": 10, "sensorFault": false}
```

\---

## 附录 A：枚举值

**告警类型 `alarmType`**：`SMOKE\_HIGH`（烟雾超标）、`TEMP\_HIGH`（温度超标）、`CO\_HIGH`（CO 超标）、`OFFLINE`（离线）、`LOW\_BATTERY`（低电量）、`SENSOR\_FAULT`（传感器故障）

**告警等级 `alarmLevel`**：`WARN`（预警）、`FIRE`（火警）、`OFFLINE`（离线）、`FAULT`（故障）、`LOW\_BATTERY`（低电量）

**告警状态 `status`**：`ACTIVE`（活跃）、`RESOLVED`（已解决）

**处置结论 `disposition`**：`CONFIRMED\_FIRE`（真火警）、`FALSE\_ALARM`（误报）

**在线状态 `onlineStatus`**：`ONLINE`、`OFFLINE`

**设备类型 `deviceType`**：`SMOKE\_SENSOR`（烟感）、`CAMERA`（摄像头）、`BROADCAST`（广播）、`SPRINKLER`（喷淋）、`EXHAUST\_FAN`（排烟风机）、`FIRE\_DOOR`（防火门）、`ELEVATOR`（电梯）

## 附录 B：错误返回结构

```json
{"code": 500, "errorMsg": "错误描述", "data": null}
```

常见错误码：`400` 参数错误、`401` 未登录/登录过期、`403` 无权限、`404` 资源不存在、`500` 服务器错误。

