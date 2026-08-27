-- ============================================================
-- 样例数据脚本：清理测试数据 + 生成演示样例
-- 说明：
--   1. 所有样例账号密码统一为 123456（BCrypt 与系统默认 admin 一致）
--   2. 保留系统管理员 admin 与阈值默认配置（threshold_config id=1）
-- 执行方式：
--   docker cp sample-data.sql pg17-vector:/tmp/sample-data.sql
--   docker exec pg17-vector psql -U postgres -d smart-smoke-sensor -f /tmp/sample-data.sql
-- ============================================================

BEGIN;

-- 1. 清理业务数据（保留 admin 与阈值默认配置）
DELETE FROM user_message;
DELETE FROM user_device;
DELETE FROM alarm_logs;
DELETE FROM smoke_readings;
DELETE FROM control_logs;
DELETE FROM devices;
DELETE FROM community;
DELETE FROM users WHERE username <> 'admin';

-- 2. 小区（负责人指向下方小区管理员）
INSERT INTO community (id, name, address, admin_user_id) VALUES
  (1, '阳光花园小区', '阳光大道 1 号', 101),
  (2, '翡翠湖畔小区', '翡翠路 88 号', 102),
  (3, '云栖雅苑小区', '云栖路 66 号', 103);

-- 3. 用户（密码均为 123456）
INSERT INTO users (id, username, password, role, community_id, status, real_name, phone) VALUES
  -- 小区管理员
  (101, 'sun_admin', '$2a$10$bQxR.TzpVhPVamIS3FZ/VOHkJxVE00RgPaLxD2qWUshi3iS.UkjlG', 'COMMUNITY_ADMIN', 1, 'ACTIVE', '张管理', '13800000001'),
  (102, 'fei_admin', '$2a$10$bQxR.TzpVhPVamIS3FZ/VOHkJxVE00RgPaLxD2qWUshi3iS.UkjlG', 'COMMUNITY_ADMIN', 2, 'ACTIVE', '李管理', '13800000002'),
  (103, 'yun_admin', '$2a$10$bQxR.TzpVhPVamIS3FZ/VOHkJxVE00RgPaLxD2qWUshi3iS.UkjlG', 'COMMUNITY_ADMIN', 3, 'ACTIVE', '王管理', '13800000003'),
  -- 居民
  (201, 'zhangwei', '$2a$10$bQxR.TzpVhPVamIS3FZ/VOHkJxVE00RgPaLxD2qWUshi3iS.UkjlG', 'RESIDENT', 1, 'ACTIVE', '张伟', '13900000001'),
  (202, 'lina',     '$2a$10$bQxR.TzpVhPVamIS3FZ/VOHkJxVE00RgPaLxD2qWUshi3iS.UkjlG', 'RESIDENT', 1, 'ACTIVE', '李娜', '13900000002'),
  (203, 'wangfang', '$2a$10$bQxR.TzpVhPVamIS3FZ/VOHkJxVE00RgPaLxD2qWUshi3iS.UkjlG', 'RESIDENT', 1, 'ACTIVE', '王芳', '13900000003'),
  (204, 'liuyang',  '$2a$10$bQxR.TzpVhPVamIS3FZ/VOHkJxVE00RgPaLxD2qWUshi3iS.UkjlG', 'RESIDENT', 2, 'ACTIVE', '刘洋', '13900000004'),
  (205, 'chenjing', '$2a$10$bQxR.TzpVhPVamIS3FZ/VOHkJxVE00RgPaLxD2qWUshi3iS.UkjlG', 'RESIDENT', 2, 'ACTIVE', '陈静', '13900000005'),
  (206, 'yangfan',  '$2a$10$bQxR.TzpVhPVamIS3FZ/VOHkJxVE00RgPaLxD2qWUshi3iS.UkjlG', 'RESIDENT', 3, 'ACTIVE', '杨帆', '13900000006'),
  (207, 'zhaomin',  '$2a$10$bQxR.TzpVhPVamIS3FZ/VOHkJxVE00RgPaLxD2qWUshi3iS.UkjlG', 'RESIDENT', 3, 'ACTIVE', '赵敏', '13900000007'),
  -- 消防员
  (301, 'fire_chen', '$2a$10$bQxR.TzpVhPVamIS3FZ/VOHkJxVE00RgPaLxD2qWUshi3iS.UkjlG', 'FIREFIGHTER', NULL, 'ACTIVE', '陈刚', '13700000001'),
  (302, 'fire_lin',  '$2a$10$bQxR.TzpVhPVamIS3FZ/VOHkJxVE00RgPaLxD2qWUshi3iS.UkjlG', 'FIREFIGHTER', NULL, 'ACTIVE', '林涛', '13700000002');

-- 4. 设备（烟感与摄像头一一绑定，AI 视觉复核时直接用绑定的摄像头）
INSERT INTO devices (id, device_name, device_sn, device_type, community_id, location, online_status, bound_camera_id, battery_level, last_heartbeat_time) VALUES
  -- 烟感设备（每个烟感绑定专属摄像头）
  (11, '1栋1单元101室烟感', 'SN-C1-001', 'SMOKE_SENSOR', 1, '1栋1单元101室', 'ONLINE',  18, 95, now() - interval '2 minutes'),
  (12, '1栋2单元302室烟感', 'SN-C1-002', 'SMOKE_SENSOR', 1, '1栋2单元302室', 'ONLINE',  19, 15, now() - interval '5 minutes'),
  (13, '2栋1单元501室烟感', 'SN-C1-003', 'SMOKE_SENSOR', 1, '2栋1单元501室', 'ONLINE',  20, 88, now() - interval '1 minutes'),
  (14, 'A栋3单元201室烟感', 'SN-C2-001', 'SMOKE_SENSOR', 2, 'A栋3单元201室', 'ONLINE',  21, 90, now() - interval '3 minutes'),
  (15, 'B栋1单元402室烟感', 'SN-C2-002', 'SMOKE_SENSOR', 2, 'B栋1单元402室', 'OFFLINE', 22, 70, now() - interval '2 hours'),
  (16, '6栋2单元603室烟感', 'SN-C3-001', 'SMOKE_SENSOR', 3, '6栋2单元603室', 'ONLINE',  23, 85, now() - interval '4 minutes'),
  (17, '8栋1单元301室烟感', 'SN-C3-002', 'SMOKE_SENSOR', 3, '8栋1单元301室', 'ONLINE',  24, 92, now() - interval '6 minutes'),
  -- 摄像头设备（每个烟感门口安装一个专属摄像头，一一绑定）
  (18, '1栋1单元101室摄像头', 'SN-CAM-C1-001', 'CAMERA', 1, '1栋1单元101室门口', 'ONLINE',  NULL, 100, now() - interval '1 minutes'),
  (19, '1栋2单元302室摄像头', 'SN-CAM-C1-002', 'CAMERA', 1, '1栋2单元302室门口', 'ONLINE',  NULL, 100, now() - interval '1 minutes'),
  (20, '2栋1单元501室摄像头', 'SN-CAM-C1-003', 'CAMERA', 1, '2栋1单元501室门口', 'ONLINE',  NULL, 100, now() - interval '1 minutes'),
  (21, 'A栋3单元201室摄像头', 'SN-CAM-C2-001', 'CAMERA', 2, 'A栋3单元201室门口', 'ONLINE',  NULL, 100, now() - interval '1 minutes'),
  (22, 'B栋1单元402室摄像头', 'SN-CAM-C2-002', 'CAMERA', 2, 'B栋1单元402室门口', 'OFFLINE', NULL, 100, now() - interval '2 hours'),
  (23, '6栋2单元603室摄像头', 'SN-CAM-C3-001', 'CAMERA', 3, '6栋2单元603室门口', 'ONLINE',  NULL, 100, now() - interval '1 minutes'),
  (24, '8栋1单元301室摄像头', 'SN-CAM-C3-002', 'CAMERA', 3, '8栋1单元301室门口', 'ONLINE',  NULL, 100, now() - interval '1 minutes');

-- 5. 居民-设备绑定
INSERT INTO user_device (user_id, device_id) VALUES
  (201, 11),
  (202, 12),
  (204, 14),
  (206, 16);

-- 6. 烟雾读数（时间序列，供趋势图展示）
INSERT INTO smoke_readings (device_id, smoke_concentration, temperature, co_concentration, created_at) VALUES
  (11, 28.5, 24.2, 1.5, now() - interval '4 hours'),
  (11, 31.0, 24.8, 2.0, now() - interval '3 hours'),
  (11, 29.2, 24.5, 1.8, now() - interval '2 hours'),
  (11, 33.5, 25.1, 2.3, now() - interval '1 hour'),
  (11, 30.8, 24.9, 2.1, now() - interval '10 minutes'),
  (12, 25.0, 23.5, 1.2, now() - interval '4 hours'),
  (12, 26.3, 23.8, 1.4, now() - interval '3 hours'),
  (12, 24.1, 23.2, 1.0, now() - interval '2 hours'),
  (12, 27.6, 24.0, 1.6, now() - interval '1 hour'),
  (13, 32.0, 25.0, 2.5, now() - interval '4 hours'),
  (13, 45.5, 26.3, 4.8, now() - interval '3 hours'),
  (13, 88.0, 30.1, 15.2, now() - interval '2 hours'),
  (13, 175.6, 42.8, 60.5, now() - interval '1 hour'),
  (13, 210.3, 58.7, 120.0, now() - interval '20 minutes'),
  (14, 27.0, 24.1, 1.4, now() - interval '3 hours'),
  (14, 29.4, 24.6, 1.9, now() - interval '2 hours'),
  (14, 28.1, 24.3, 1.7, now() - interval '1 hour'),
  (15, 26.8, 23.9, 1.3, now() - interval '3 hours'),
  (15, 25.2, 23.6, 1.1, now() - interval '2 hours'),
  (16, 30.1, 24.7, 2.0, now() - interval '3 hours'),
  (16, 28.7, 24.4, 1.8, now() - interval '2 hours'),
  (16, 31.9, 25.2, 2.4, now() - interval '1 hour'),
  (17, 27.5, 24.0, 1.5, now() - interval '3 hours'),
  (17, 29.8, 24.5, 2.0, now() - interval '2 hours'),
  (17, 28.3, 24.2, 1.7, now() - interval '1 hour');

-- 7. 告警
INSERT INTO alarm_logs (device_id, alarm_type, alarm_level, message, status, disposition, acknowledged_at, escalated, created_at, resolved_at) VALUES
  (13, 'SMOKE_HIGH', 'FIRE', '烟雾浓度持续超标，疑似火情', 'ACTIVE', NULL, now() - interval '15 minutes', FALSE, now() - interval '20 minutes', NULL),
  (15, 'OFFLINE', 'OFFLINE', '设备心跳超时，已离线', 'ACTIVE', NULL, NULL, FALSE, now() - interval '2 hours', NULL),
  (12, 'LOW_BATTERY', 'LOW_BATTERY', '设备电量低于 20%', 'ACTIVE', NULL, NULL, FALSE, now() - interval '30 minutes', NULL),
  (11, 'SMOKE_HIGH', 'FIRE', '烟雾浓度异常升高', 'RESOLVED', 'CONFIRMED_FIRE', now() - interval '1 day', TRUE, now() - interval '1 day 1 hour', now() - interval '1 day');

COMMIT;
