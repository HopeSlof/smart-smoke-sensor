-- ============================================================
-- 智慧烟感 — 数据库建表脚本
-- 数据库: PostgreSQL（需启用 pgvector 扩展）
--
-- 【使用前】先创建数据库（任选其一）：
--   1) 图形客户端执行:  CREATE DATABASE "smart-smoke-sensor";
--   2) docker 命令:
--      docker exec -i pg17-vector psql -U postgres -c "CREATE DATABASE \"smart-smoke-sensor\";"
-- 然后连接到 smart-smoke-sensor 库，再执行本脚本（建扩展 + 建表）。
-- ============================================================

-- pgvector 扩展（RAG 向量检索）
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. 用户表
CREATE TABLE IF NOT EXISTS users
(
    id           BIGSERIAL PRIMARY KEY,
    username     VARCHAR(64)  NOT NULL UNIQUE,
    password     VARCHAR(256) NOT NULL,
    role         VARCHAR(32)  NOT NULL DEFAULT 'RESIDENT', -- RESIDENT | COMMUNITY_ADMIN | SYSTEM_ADMIN | FIREFIGHTER
    community_id BIGINT,                                   -- 归属小区（居民/小区管理员绑定）
    created_at   TIMESTAMP    NOT NULL DEFAULT now()
);
COMMENT ON TABLE users IS '用户表';
COMMENT ON COLUMN users.role IS '角色: RESIDENT-居民, COMMUNITY_ADMIN-小区管理员, SYSTEM_ADMIN-系统管理员, FIREFIGHTER-消防员';

-- 2. 烟感设备表
CREATE TABLE IF NOT EXISTS devices
(
    id                  BIGSERIAL PRIMARY KEY,
    device_name         VARCHAR(128) NOT NULL,
    device_sn           VARCHAR(64)  NOT NULL UNIQUE,           -- 设备序列号（MQTT 主题标识）
    device_type         VARCHAR(32)  NOT NULL DEFAULT 'SMOKE_SENSOR', -- SMOKE_SENSOR | CAMERA | BROADCAST | SPRINKLER ...
    community_id        BIGINT,                                 -- 归属小区（数据权限过滤）
    location            VARCHAR(256),                           -- 安装位置（如 1栋-2单元-301）
    online_status       VARCHAR(16)  NOT NULL DEFAULT 'OFFLINE', -- ONLINE | OFFLINE
    battery_level       INT,                                    -- 电量百分比 0-100（烟感自检上报）
    last_heartbeat_time TIMESTAMP,
    created_at          TIMESTAMP    NOT NULL DEFAULT now()
);
COMMENT ON TABLE devices IS '烟感设备表';
COMMENT ON COLUMN devices.online_status IS '在线状态: ONLINE-在线, OFFLINE-离线';
COMMENT ON COLUMN devices.device_sn IS '硬件唯一序列号，MQTT 主题标识';
CREATE INDEX IF NOT EXISTS idx_devices_community ON devices (community_id);

-- 3. 烟雾浓度记录表（时序数据，含多参数联合判定所需字段）
CREATE TABLE IF NOT EXISTS smoke_readings
(
    id                 BIGSERIAL PRIMARY KEY,
    device_id          BIGINT        NOT NULL,
    smoke_concentration NUMERIC(8, 2) NOT NULL, -- 烟雾浓度值
    temperature        NUMERIC(8, 2),           -- 温度（可选，联合判定）
    co_concentration   NUMERIC(8, 2),           -- 一氧化碳浓度（可选，联合判定）
    created_at         TIMESTAMP     NOT NULL DEFAULT now()
);
COMMENT ON TABLE smoke_readings IS '烟雾浓度采集记录（时序数据）';
CREATE INDEX IF NOT EXISTS idx_smoke_readings_device_time
    ON smoke_readings (device_id, created_at DESC);

-- 4. 阈值配置表（单行配置）
CREATE TABLE IF NOT EXISTS threshold_config
(
    id                     BIGSERIAL PRIMARY KEY,
    smoke_warn_threshold   NUMERIC(8, 2) NOT NULL DEFAULT 100,  -- 烟雾预警阈值
    smoke_alarm_threshold  NUMERIC(8, 2) NOT NULL DEFAULT 200,  -- 烟雾报警阈值（火警）
    temperature_threshold  NUMERIC(8, 2) NOT NULL DEFAULT 55,   -- 温度阈值（联合判定）
    co_threshold           NUMERIC(8, 2) NOT NULL DEFAULT 100,  -- CO 阈值（联合判定）
    heartbeat_timeout      INT           NOT NULL DEFAULT 60,   -- 心跳超时秒数
    battery_low_threshold  INT           NOT NULL DEFAULT 20,   -- 低电量阈值百分比
    debounce_count         INT           NOT NULL DEFAULT 3,    -- 消抖连续超阈值次数
    escalation_minutes     INT           NOT NULL DEFAULT 5,    -- 告警升级分钟数
    multi_param_enabled    BOOLEAN       NOT NULL DEFAULT TRUE, -- 是否启用多参数联合判定
    updated_at             TIMESTAMP     NOT NULL DEFAULT now()
);
COMMENT ON TABLE threshold_config IS '系统阈值与判定规则配置表（单行）';
-- 预置默认配置（只有一行，约定 id = 1）
INSERT INTO threshold_config (smoke_warn_threshold, smoke_alarm_threshold, temperature_threshold,
                              co_threshold, heartbeat_timeout, battery_low_threshold,
                              debounce_count, escalation_minutes, multi_param_enabled)
VALUES (100, 200, 55, 100, 60, 20, 3, 5, TRUE);

-- 5. 告警记录表
CREATE TABLE IF NOT EXISTS alarm_logs
(
    id              BIGSERIAL PRIMARY KEY,
    device_id       BIGINT      NOT NULL,
    alarm_type      VARCHAR(32) NOT NULL,                    -- SMOKE_HIGH | TEMP_HIGH | CO_HIGH | OFFLINE | LOW_BATTERY | SENSOR_FAULT
    alarm_level     VARCHAR(32) NOT NULL DEFAULT 'WARN',     -- WARN | FIRE | OFFLINE | FAULT | LOW_BATTERY
    message         VARCHAR(512),
    status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | RESOLVED
    disposition     VARCHAR(32),                             -- 处置结论: CONFIRMED_FIRE | FALSE_ALARM（用于误报率统计）
    acknowledged_at TIMESTAMP,                               -- 首次确认时间（用于告警升级判定）
    escalated       BOOLEAN     NOT NULL DEFAULT FALSE,      -- 是否已升级
    created_at      TIMESTAMP   NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMP
);
COMMENT ON TABLE alarm_logs IS '告警记录表';
COMMENT ON COLUMN alarm_logs.alarm_level IS '告警等级: WARN-预警, FIRE-火警, OFFLINE-离线, FAULT-故障, LOW_BATTERY-低电量';
COMMENT ON COLUMN alarm_logs.status IS '告警状态: ACTIVE-活跃, RESOLVED-已解决';
CREATE INDEX IF NOT EXISTS idx_alarm_logs_device ON alarm_logs (device_id, status);
CREATE INDEX IF NOT EXISTS idx_alarm_logs_created ON alarm_logs (created_at DESC);

-- 6. 控制日志表（审计：告警处理、联动指令、阈值变更等）
CREATE TABLE IF NOT EXISTS control_logs
(
    id          BIGSERIAL PRIMARY KEY,
    device_id   BIGINT,
    operator_id BIGINT,
    command     VARCHAR(32) NOT NULL,                   -- RESOLVE_ALARM / CONFIRM_FIRE / FALSE_ALARM / ESCALATE_ALARM / UPDATE_THRESHOLD / ...
    source      VARCHAR(16) NOT NULL DEFAULT 'SYSTEM',  -- SYSTEM | MANUAL | AUTO
    result      VARCHAR(16) NOT NULL DEFAULT 'SUCCESS', -- SUCCESS | FAIL
    created_at  TIMESTAMP   NOT NULL DEFAULT now()
);
COMMENT ON TABLE control_logs IS '操作审计日志表';
CREATE INDEX IF NOT EXISTS idx_control_logs_time ON control_logs (created_at DESC);

-- 7. RAG 知识库表（pgvector 向量存储）
CREATE TABLE IF NOT EXISTS knowledge_chunks
(
    id         BIGSERIAL PRIMARY KEY,
    title      VARCHAR(256),
    content    TEXT         NOT NULL, -- 文本块内容
    embedding  VECTOR(1024) NOT NULL, -- 文本向量（BGE-large-zh 默认 1024 维）
    created_at TIMESTAMP    NOT NULL DEFAULT now()
);
COMMENT ON TABLE knowledge_chunks IS 'RAG 知识库 — 消防应急预案/疏散/设备维护知识向量';
-- 向量索引（先灌数据再建索引，否则 IVFFlat 无效）
-- CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
