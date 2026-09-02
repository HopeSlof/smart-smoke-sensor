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
    status       VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',   -- PENDING | ACTIVE | DISABLED
    real_name    VARCHAR(64),                              -- 真实姓名（审核用）
    phone        VARCHAR(32),                              -- 联系电话（审核用）
    created_at   TIMESTAMP    NOT NULL DEFAULT now()
);
COMMENT ON TABLE users IS '用户表';
COMMENT ON COLUMN users.role IS '角色: RESIDENT-居民, COMMUNITY_ADMIN-小区管理员, SYSTEM_ADMIN-系统管理员, FIREFIGHTER-消防员';
COMMENT ON COLUMN users.status IS '账号状态: PENDING-待审核, ACTIVE-正常, DISABLED-禁用';

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
    bound_camera_id     BIGINT,                                 -- 绑定的摄像头 ID（烟感专属，AI 视觉复核用）
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
-- HNSW 向量索引（pgvector >= 0.5 支持，无需预先灌数据即可建索引，查询更快）
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- 8. RAG 多轮对话会话表
CREATE TABLE IF NOT EXISTS chat_session
(
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT,                                  -- 归属用户（可空）
    title      VARCHAR(256),                            -- 会话标题（首条消息摘要）
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);
COMMENT ON TABLE chat_session IS 'RAG 多轮对话会话';
CREATE INDEX IF NOT EXISTS idx_chat_session_user ON chat_session (user_id, updated_at DESC);

-- 9. RAG 多轮对话消息表
CREATE TABLE IF NOT EXISTS chat_message
(
    id         BIGSERIAL PRIMARY KEY,
    session_id BIGINT       NOT NULL,
    role       VARCHAR(16)  NOT NULL, -- user | assistant
    content    TEXT         NOT NULL,
    sources    TEXT,                   -- 引用来源 JSON 数组（仅 assistant 消息）
    created_at TIMESTAMP    NOT NULL DEFAULT now()
);
COMMENT ON TABLE chat_message IS 'RAG 多轮对话消息';
CREATE INDEX IF NOT EXISTS idx_chat_message_session ON chat_message (session_id, id);

-- 10. 小区表（负责人机制）
CREATE TABLE IF NOT EXISTS community
(
    id            BIGSERIAL PRIMARY KEY,
    name          VARCHAR(128) NOT NULL,           -- 小区名称
    address       VARCHAR(256),                    -- 小区地址
    admin_user_id BIGINT,                          -- 负责人（COMMUNITY_ADMIN 用户 ID），可空
    created_at    TIMESTAMP    NOT NULL DEFAULT now()
);
COMMENT ON TABLE community IS '小区表';
COMMENT ON COLUMN community.admin_user_id IS '小区负责人（COMMUNITY_ADMIN 用户 ID）';

-- 9. 住户-设备绑定表（用于告警重点提示）
CREATE TABLE IF NOT EXISTS user_device
(
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT      NOT NULL,   -- 住户（RESIDENT）
    device_id  BIGINT      NOT NULL,   -- 烟感设备
    created_at TIMESTAMP   NOT NULL DEFAULT now(),
    UNIQUE (user_id, device_id)        -- 同一住户对同一设备只绑定一次
);
COMMENT ON TABLE user_device IS '住户与其家中烟感设备的绑定关系表（用于告警重点提示）';
CREATE INDEX IF NOT EXISTS idx_user_device_user ON user_device (user_id);
CREATE INDEX IF NOT EXISTS idx_user_device_device ON user_device (device_id);

-- 站内消息表（居民-管理员双向消息）
CREATE TABLE IF NOT EXISTS user_message
(
    id              BIGSERIAL PRIMARY KEY,
    sender_user_id  BIGINT      NOT NULL,   -- 发送者用户 ID
    sender_username VARCHAR(64),            -- 发送者用户名（冗余，便于展示）
    community_id    BIGINT,                 -- 所属小区
    type            VARCHAR(32) DEFAULT 'OTHER',
    content         TEXT,
    status          VARCHAR(16) DEFAULT 'UNREAD',
    reply_to_id     BIGINT,                 -- 回复的原消息 ID（管理员回复居民时指向原消息）
    sender_role     VARCHAR(16) DEFAULT 'RESIDENT', -- RESIDENT=居民发, ADMIN=管理员回复
    created_at      TIMESTAMP   NOT NULL DEFAULT now()
);
COMMENT ON TABLE user_message IS '站内消息（居民-管理员双向消息）';
CREATE INDEX IF NOT EXISTS idx_user_message_sender ON user_message (sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_message_community ON user_message (community_id, created_at DESC);

-- 13. AI 视觉复核记录表
CREATE TABLE IF NOT EXISTS ai_review_log
(
    id               BIGSERIAL PRIMARY KEY,
    alarm_log_id     BIGINT      NOT NULL,       -- 关联告警记录
    smoke_device_id  BIGINT,                     -- 触发告警的烟感设备
    camera_device_id BIGINT,                     -- 复核用摄像头
    image_url        TEXT,                        -- 送给 AI 分析的图片 URL
    ai_result        VARCHAR(32),                 -- FIRE / NO_FIRE / UNCERTAIN
    confidence       DOUBLE PRECISION,            -- 置信度 0.0-1.0
    ai_description   TEXT,                        -- AI 分析描述
    status           VARCHAR(16) DEFAULT 'PENDING', -- PENDING / SUCCESS / FAILED
    error_message    TEXT,                         -- 失败时的错误信息
    review_time      TIMESTAMP,                    -- AI 复核完成时间
    created_at       TIMESTAMP   NOT NULL DEFAULT now()
);
COMMENT ON TABLE ai_review_log IS 'AI 视觉复核记录';
CREATE INDEX IF NOT EXISTS idx_ai_review_alarm ON ai_review_log (alarm_log_id);

-- 14. 摄像头表（独立管理，与 devices 表一对一关联）
CREATE TABLE IF NOT EXISTS cameras
(
    id              BIGSERIAL PRIMARY KEY,
    camera_name     VARCHAR(128) NOT NULL,               -- 摄像头名称
    camera_sn       VARCHAR(64)  NOT NULL UNIQUE,         -- 序列号
    community_id    BIGINT,                               -- 归属小区
    location        VARCHAR(256),                         -- 安装位置
    online_status   VARCHAR(16)  NOT NULL DEFAULT 'OFFLINE', -- ONLINE | OFFLINE
    bound_device_id BIGINT,                               -- 绑定的烟感设备 ID（一对一）
    snapshot_url    VARCHAR(512),                         -- 最新截图 URL
    created_at      TIMESTAMP    NOT NULL DEFAULT now()
);
COMMENT ON TABLE cameras IS '摄像头表（独立于 devices，通过 bound_device_id 与烟感设备一对一关联）';
COMMENT ON COLUMN cameras.bound_device_id IS '绑定的烟感设备 ID（一对一，与 devices.bound_camera_id 双向同步）';
CREATE INDEX IF NOT EXISTS idx_cameras_community ON cameras (community_id);
CREATE INDEX IF NOT EXISTS idx_cameras_bound_device ON cameras (bound_device_id);
