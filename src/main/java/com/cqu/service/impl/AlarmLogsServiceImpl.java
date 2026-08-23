package com.cqu.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.cqu.common.enums.AlarmLevel;
import com.cqu.common.enums.AlarmStatus;
import com.cqu.common.enums.AlarmType;
import com.cqu.common.enums.Disposition;
import com.cqu.common.enums.Role;
import com.cqu.common.exception.BusinessException;
import com.cqu.common.exception.ErrorCode;
import com.cqu.entity.AlarmLogs;
import com.cqu.entity.Devices;
import com.cqu.entity.UserDevice;
import com.cqu.mapper.AlarmLogsMapper;
import com.cqu.mapper.DevicesMapper;
import com.cqu.mapper.UserDeviceMapper;
import com.cqu.service.IAlarmLogsService;
import com.cqu.service.IControlLogsService;
import com.cqu.utils.DataScope;
import com.cqu.utils.UserHolder;
import com.cqu.utils.WebSocketNotifier;
import com.cqu.vo.AlarmLogVO;
import com.cqu.vo.AlarmStatisticsVO;
import com.cqu.vo.PageResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 告警服务实现
 */
@Slf4j
@Service
public class AlarmLogsServiceImpl extends ServiceImpl<AlarmLogsMapper, AlarmLogs> implements IAlarmLogsService {

    @Autowired
    private DevicesMapper devicesMapper;

    @Autowired
    private UserDeviceMapper userDeviceMapper;

    @Autowired
    private IControlLogsService controlLogsService;

    @Autowired
    private WebSocketNotifier webSocketNotifier;

    @Override
    public PageResult<AlarmLogVO> pageAlarms(int page, int pageSize, Long deviceId,
                                             String alarmType, String alarmLevel, String status) {
        LambdaQueryWrapper<AlarmLogs> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(deviceId != null, AlarmLogs::getDeviceId, deviceId);
        wrapper.eq(alarmType != null && !alarmType.isBlank(), AlarmLogs::getAlarmType, alarmType);
        wrapper.eq(alarmLevel != null && !alarmLevel.isBlank(), AlarmLogs::getAlarmLevel, alarmLevel);
        wrapper.eq(status != null && !status.isBlank(), AlarmLogs::getStatus, status);
        // 消防员仅可查看火警
        if (Role.FIREFIGHTER.name().equals(UserHolder.getRole())) {
            wrapper.eq(AlarmLogs::getAlarmLevel, AlarmLevel.FIRE.name());
        }
        // 数据权限：居民/小区管理员只看本小区
        applyCommunityScope(wrapper);
        wrapper.orderByDesc(AlarmLogs::getCreatedAt);

        Page<AlarmLogs> pageResult = this.page(new Page<>(page, pageSize), wrapper);
        Map<Long, String> deviceNameMap = buildDeviceNameMap(pageResult.getRecords());

        List<AlarmLogVO> records = pageResult.getRecords().stream()
                .map(a -> toVO(a, deviceNameMap.get(a.getDeviceId())))
                .collect(Collectors.toList());

        return PageResult.of(pageResult.getTotal(), records);
    }

    @Override
    public AlarmLogVO getAlarmDetail(Long id) {
        AlarmLogs alarm = this.getById(id);
        if (alarm == null) {
            throw new BusinessException("告警记录不存在");
        }
        checkAlarmAccess(alarm);
        String deviceName = null;
        Devices device = devicesMapper.selectById(alarm.getDeviceId());
        if (device != null) deviceName = device.getDeviceName();
        return toVO(alarm, deviceName);
    }

    private void checkAlarmAccess(AlarmLogs alarm) {
        // 消防员仅可查看火警
        if (Role.FIREFIGHTER.name().equals(UserHolder.getRole())) {
            if (!AlarmLevel.FIRE.name().equals(alarm.getAlarmLevel())) {
                throw new BusinessException(ErrorCode.FORBIDDEN, "消防员仅可查看火警");
            }
            return;
        }
        // 居民/小区管理员只能查看本小区设备的告警
        String role = UserHolder.getRole();
        if (Role.RESIDENT.name().equals(role) || Role.COMMUNITY_ADMIN.name().equals(role)) {
            Long currentCommunityId = UserHolder.getCommunityId();
            Devices device = devicesMapper.selectById(alarm.getDeviceId());
            if (device == null || currentCommunityId == null || !currentCommunityId.equals(device.getCommunityId())) {
                throw new BusinessException(ErrorCode.FORBIDDEN, "无权查看其他小区告警");
            }
        }
    }

    @Override
    public void resolveAlarm(Long id) {
        AlarmLogs alarm = this.getById(id);
        if (alarm == null) {
            throw new BusinessException("告警记录不存在");
        }
        if (!AlarmStatus.ACTIVE.name().equals(alarm.getStatus())) {
            throw new BusinessException("该告警已被处理");
        }
        checkFirefighterFireOnly(alarm);
        alarm.setStatus(AlarmStatus.RESOLVED.name());
        alarm.setResolvedAt(LocalDateTime.now());
        this.updateById(alarm);

        controlLogsService.recordLog(alarm.getDeviceId(), "RESOLVE_ALARM", "SUCCESS", "MANUAL");
    }

    @Override
    public void acknowledgeAlarm(Long id) {
        AlarmLogs alarm = this.getById(id);
        if (alarm == null) {
            throw new BusinessException("告警记录不存在");
        }
        if (alarm.getAcknowledgedAt() == null) {
            alarm.setAcknowledgedAt(LocalDateTime.now());
            this.updateById(alarm);
        }
    }

    @Override
    public void confirmAlarm(Long id, String disposition) {
        AlarmLogs alarm = this.getById(id);
        if (alarm == null) {
            throw new BusinessException("告警记录不存在");
        }
        try {
            Disposition.valueOf(disposition);
        } catch (Exception e) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "处置结论非法，应为 CONFIRMED_FIRE 或 FALSE_ALARM");
        }
        checkFirefighterFireOnly(alarm);

        alarm.setDisposition(disposition);
        if (alarm.getAcknowledgedAt() == null) {
            alarm.setAcknowledgedAt(LocalDateTime.now());
        }
        this.updateById(alarm);

        String command = Disposition.CONFIRMED_FIRE.name().equals(disposition) ? "CONFIRM_FIRE" : "FALSE_ALARM";
        controlLogsService.recordLog(alarm.getDeviceId(), command, "SUCCESS", "MANUAL");
    }

    private void checkFirefighterFireOnly(AlarmLogs alarm) {
        if (Role.FIREFIGHTER.name().equals(UserHolder.getRole())
                && !AlarmLevel.FIRE.name().equals(alarm.getAlarmLevel())) {
            throw new BusinessException(ErrorCode.FORBIDDEN, "消防员仅可处置火警");
        }
    }

    @Override
    public AlarmStatisticsVO getStatistics() {
        LambdaQueryWrapper<AlarmLogs> activeWrapper = new LambdaQueryWrapper<AlarmLogs>()
                .eq(AlarmLogs::getStatus, AlarmStatus.ACTIVE.name());
        applyCommunityScope(activeWrapper);
        long activeCount = this.count(activeWrapper);

        LambdaQueryWrapper<AlarmLogs> fireWrapper = new LambdaQueryWrapper<AlarmLogs>()
                .eq(AlarmLogs::getStatus, AlarmStatus.ACTIVE.name())
                .eq(AlarmLogs::getAlarmLevel, AlarmLevel.FIRE.name());
        applyCommunityScope(fireWrapper);
        long fireCount = this.count(fireWrapper);

        LambdaQueryWrapper<AlarmLogs> warnWrapper = new LambdaQueryWrapper<AlarmLogs>()
                .eq(AlarmLogs::getStatus, AlarmStatus.ACTIVE.name())
                .eq(AlarmLogs::getAlarmLevel, AlarmLevel.WARN.name());
        applyCommunityScope(warnWrapper);
        long warnCount = this.count(warnWrapper);

        List<AlarmLogs> activeAlarms = this.list(activeWrapper);

        List<AlarmStatisticsVO.AlarmTypeCount> byType = activeAlarms.stream()
                .collect(Collectors.groupingBy(AlarmLogs::getAlarmType, Collectors.counting()))
                .entrySet().stream()
                .map(e -> AlarmStatisticsVO.AlarmTypeCount.builder()
                        .alarmType(e.getKey())
                        .count(String.valueOf(e.getValue()))
                        .build())
                .collect(Collectors.toList());

        return AlarmStatisticsVO.builder()
                .activeCount(String.valueOf(activeCount))
                .fireCount(String.valueOf(fireCount))
                .warnCount(String.valueOf(warnCount))
                .byType(byType)
                .build();
    }

    @Override
    public void createAlarm(Long deviceId, String alarmType, String alarmLevel, String message) {
        if (deviceId == null || alarmType == null || alarmType.isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "设备ID和告警类型不能为空");
        }
        String resolvedLevel = inferLevel(alarmLevel, alarmType);

        // 去重：同设备同类型同等级且 ACTIVE 的告警不重复创建
        long exists = this.lambdaQuery()
                .eq(AlarmLogs::getDeviceId, deviceId)
                .eq(AlarmLogs::getAlarmType, alarmType)
                .eq(AlarmLogs::getAlarmLevel, resolvedLevel)
                .eq(AlarmLogs::getStatus, AlarmStatus.ACTIVE.name())
                .count();
        if (exists > 0) {
            log.debug("告警去重：deviceId={}, type={}, level={} 已存在活跃告警", deviceId, alarmType, resolvedLevel);
            return;
        }

        AlarmLogs alarm = new AlarmLogs();
        alarm.setDeviceId(deviceId);
        alarm.setAlarmType(alarmType);
        alarm.setAlarmLevel(resolvedLevel);
        alarm.setMessage(message);
        alarm.setStatus(AlarmStatus.ACTIVE.name());
        alarm.setEscalated(false);
        this.save(alarm);
        log.info("创建告警: deviceId={}, type={}, level={}", deviceId, alarmType, resolvedLevel);

        String deviceName = null;
        Devices device = devicesMapper.selectById(deviceId);
        if (device != null) deviceName = device.getDeviceName();
        routeAlarm(alarm, device, toVO(alarm, deviceName));
    }

    private void routeAlarm(AlarmLogs alarm, Devices device, AlarmLogVO vo) {
        String alarmType = alarm.getAlarmType();
        boolean fire = AlarmType.SMOKE_HIGH.name().equals(alarmType)
                || AlarmType.TEMP_HIGH.name().equals(alarmType)
                || AlarmType.CO_HIGH.name().equals(alarmType);

        if (fire) {
            webSocketNotifier.pushFireAlarm(vo);
        }
        if (device != null && device.getCommunityId() != null) {
            webSocketNotifier.pushCommunityAlarm(device.getCommunityId(), vo);
            // 绑定设备重点提示：火警/低电量定向推送给绑定住户
            if (fire || AlarmType.LOW_BATTERY.name().equals(alarmType)) {
                List<Long> boundUserIds = userDeviceMapper.selectList(
                        new LambdaQueryWrapper<UserDevice>().eq(UserDevice::getDeviceId, device.getId()))
                        .stream().map(UserDevice::getUserId).collect(Collectors.toList());
                for (Long userId : boundUserIds) {
                    webSocketNotifier.pushUserAlert(userId, vo);
                }
            }
        }
    }

    @Override
    public void createAlarm(String deviceSn, String alarmType, String alarmLevel, String message) {
        Devices device = devicesMapper.selectOne(
                new LambdaQueryWrapper<Devices>().eq(Devices::getDeviceSn, deviceSn));
        if (device == null) {
            log.warn("告警上报：未找到设备 deviceSn={}，告警丢弃", deviceSn);
            return;
        }
        createAlarm(device.getId(), alarmType, alarmLevel, message);
    }

    private String inferLevel(String alarmLevel, String alarmType) {
        if (alarmLevel != null && !alarmLevel.isBlank()) {
            return alarmLevel;
        }
        if (AlarmType.SMOKE_HIGH.name().equals(alarmType)
                || AlarmType.TEMP_HIGH.name().equals(alarmType)
                || AlarmType.CO_HIGH.name().equals(alarmType)) {
            return AlarmLevel.FIRE.name();
        }
        if (AlarmType.OFFLINE.name().equals(alarmType)) return AlarmLevel.OFFLINE.name();
        if (AlarmType.LOW_BATTERY.name().equals(alarmType)) return AlarmLevel.LOW_BATTERY.name();
        if (AlarmType.SENSOR_FAULT.name().equals(alarmType)) return AlarmLevel.FAULT.name();
        return AlarmLevel.WARN.name();
    }

    private void applyCommunityScope(LambdaQueryWrapper<AlarmLogs> wrapper) {
        DataScope.Scope scope = DataScope.resolve();
        if (scope.all() || scope.communityId() == null) {
            return;
        }
        List<Long> deviceIds = devicesMapper.selectList(
                new LambdaQueryWrapper<Devices>().eq(Devices::getCommunityId, scope.communityId()))
                .stream().map(Devices::getId).collect(Collectors.toList());
        if (deviceIds.isEmpty()) {
            wrapper.eq(AlarmLogs::getDeviceId, 0L);
        } else {
            wrapper.in(AlarmLogs::getDeviceId, deviceIds);
        }
    }

    private Map<Long, String> buildDeviceNameMap(List<AlarmLogs> alarms) {
        List<Long> ids = alarms.stream().map(AlarmLogs::getDeviceId).distinct().collect(Collectors.toList());
        if (ids.isEmpty()) return Map.of();
        return devicesMapper.selectBatchIds(ids).stream()
                .collect(Collectors.toMap(Devices::getId, Devices::getDeviceName));
    }

    private AlarmLogVO toVO(AlarmLogs alarm, String deviceName) {
        return AlarmLogVO.builder()
                .id(String.valueOf(alarm.getId()))
                .deviceId(String.valueOf(alarm.getDeviceId()))
                .deviceName(deviceName)
                .alarmType(alarm.getAlarmType())
                .alarmLevel(alarm.getAlarmLevel())
                .message(alarm.getMessage())
                .status(alarm.getStatus())
                .disposition(alarm.getDisposition())
                .acknowledgedAt(alarm.getAcknowledgedAt() != null ? String.valueOf(alarm.getAcknowledgedAt()) : null)
                .escalated(alarm.getEscalated())
                .createdAt(alarm.getCreatedAt() != null ? String.valueOf(alarm.getCreatedAt()) : null)
                .resolvedAt(alarm.getResolvedAt() != null ? String.valueOf(alarm.getResolvedAt()) : null)
                .build();
    }
}
