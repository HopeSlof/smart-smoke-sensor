-- ============================================================
-- 智慧烟感 — 数据库数据重置脚本
-- 作用：清空所有业务表数据（保留表结构），并恢复阈值默认配置。
-- 注意：执行后所有用户（含 admin）、小区、设备、烟雾记录、告警都会被清空。
--       默认系统管理员（admin）会在应用下次启动时自动重建，其余需重新注册/添加。
--
-- 使用（在项目目录下执行）：
--   type sql\reset-data.sql | docker exec -i pg17-vector psql -U postgres -d smart-smoke-sensor
-- ============================================================

-- 清空业务表（RESTART IDENTITY 同时重置自增主键）
TRUNCATE community, users, user_device, devices, smoke_readings, alarm_logs, control_logs, knowledge_chunks
    RESTART IDENTITY CASCADE;

-- 重置阈值配置为默认值
TRUNCATE threshold_config RESTART IDENTITY CASCADE;
INSERT INTO threshold_config (smoke_warn_threshold, smoke_alarm_threshold, temperature_threshold,
                              co_threshold, heartbeat_timeout, battery_low_threshold,
                              debounce_count, escalation_minutes, multi_param_enabled)
VALUES (100, 200, 55, 100, 60, 20, 3, 5, TRUE);
