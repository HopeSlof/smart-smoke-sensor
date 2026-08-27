package com.cqu.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.cqu.common.enums.AlarmLevel;
import com.cqu.common.enums.AlarmType;
import com.cqu.common.enums.DeviceType;
import com.cqu.common.enums.OnlineStatus;
import com.cqu.common.enums.Role;
import com.cqu.common.exception.BusinessException;
import com.cqu.common.exception.ErrorCode;
import com.cqu.entity.AlarmLogs;
import com.cqu.entity.Devices;
import com.cqu.entity.SmokeReadings;
import com.cqu.entity.UserDevice;
import com.cqu.mapper.AlarmLogsMapper;
import com.cqu.mapper.DevicesMapper;
import com.cqu.mapper.SmokeReadingsMapper;
import com.cqu.mapper.UserDeviceMapper;
import com.cqu.service.IAlarmLogsService;
import com.cqu.service.IControlLogsService;
import com.cqu.service.IDevicesService;
import com.cqu.utils.UserHolder;
import com.cqu.utils.WebSocketNotifier;
import com.cqu.vo.DeviceAddRequest;
import com.cqu.vo.DeviceDetailVO;
import com.cqu.vo.DeviceStatisticsVO;
import com.cqu.vo.DeviceVO;
import com.cqu.vo.PageResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 设备服务实现
 */
@Slf4j
@Service
public class DevicesServiceImpl extends ServiceImpl<DevicesMapper, Devices> implements IDevicesService {

    @Autowired
    private DevicesMapper devicesMapper;

    @Autowired
    private SmokeReadingsMapper smokeReadingsMapper;

    @Autowired
    private AlarmLogsMapper alarmLogsMapper;

    @Autowired
    private UserDeviceMapper userDeviceMapper;

    @Autowired
    private IControlLogsService controlLogsService;

    @Autowired
    private IAlarmLogsService alarmLogsService;

    @Autowired
    private WebSocketNotifier webSocketNotifier;

    @Override
    public PageResult<DeviceVO> pageDevices(int page, int pageSize, String deviceName, String deviceType, String onlineStatus) {
        LambdaQueryWrapper<Devices> wrapper = new LambdaQueryWrapper<>();
        wrapper.like(deviceName != null && !deviceName.isBlank(), Devices::getDeviceName, deviceName);
        wrapper.eq(deviceType != null && !deviceType.isBlank(), Devices::getDeviceType, deviceType);
        wrapper.eq(onlineStatus != null && !onlineStatus.isBlank(), Devices::getOnlineStatus, onlineStatus);

        // 数据权限：居民 / 小区管理员只能看本小区设备
        applyCommunityScope(wrapper);

        wrapper.orderByDesc(Devices::getCreatedAt);
        Page<Devices> pageResult = this.page(new Page<>(page, pageSize), wrapper);

        List<DeviceVO> records = pageResult.getRecords().stream().map(this::toDeviceVO).collect(Collectors.toList());
        return PageResult.of(pageResult.getTotal(), records);
    }

    @Override
    public DeviceDetailVO getDeviceDetail(Long id) {
        Devices device = this.getById(id);
        if (device == null) {
            throw new BusinessException("设备不存在");
        }
        checkCommunityAccess(device);

        LambdaQueryWrapper<SmokeReadings> smokeWrapper = new LambdaQueryWrapper<>();
        smokeWrapper.eq(SmokeReadings::getDeviceId, id)
                .orderByDesc(SmokeReadings::getCreatedAt)
                .last("LIMIT 1");
        SmokeReadings latest = smokeReadingsMapper.selectOne(smokeWrapper);

        Long activeAlarmCount = alarmLogsMapper.selectCount(
                new LambdaQueryWrapper<AlarmLogs>()
                        .eq(AlarmLogs::getDeviceId, id)
                        .eq(AlarmLogs::getStatus, "ACTIVE"));

        return DeviceDetailVO.builder()
                .id(String.valueOf(device.getId()))
                .deviceName(device.getDeviceName())
                .deviceSn(device.getDeviceSn())
                .deviceType(device.getDeviceType())
                .communityId(device.getCommunityId())
                .location(device.getLocation())
                .onlineStatus(device.getOnlineStatus())
                .batteryLevel(device.getBatteryLevel())
                .lastHeartbeatTime(device.getLastHeartbeatTime() != null ? String.valueOf(device.getLastHeartbeatTime()) : null)
                .createdAt(device.getCreatedAt() != null ? String.valueOf(device.getCreatedAt()) : null)
                .latestSmokeConcentration(latest != null ? latest.getSmokeConcentration() : null)
                .activeAlarmCount(activeAlarmCount)
                .build();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void addDevice(DeviceAddRequest request) {
        if (request.getDeviceName() == null || request.getDeviceName().isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "设备名称不能为空");
        }
        if (request.getDeviceSn() == null || request.getDeviceSn().isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "设备序列号不能为空");
        }
        if (this.lambdaQuery().eq(Devices::getDeviceSn, request.getDeviceSn()).count() > 0) {
            throw new BusinessException("设备序列号已存在");
        }

        Devices device = new Devices();
        device.setDeviceName(request.getDeviceName());
        device.setDeviceSn(request.getDeviceSn());
        String deviceType = request.getDeviceType() != null && !request.getDeviceType().isBlank()
                ? request.getDeviceType() : DeviceType.SMOKE_SENSOR.name();
        device.setDeviceType(deviceType);
        // 小区管理员只能把设备加到本小区
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            device.setCommunityId(UserHolder.getCommunityId());
        } else {
            device.setCommunityId(request.getCommunityId());
        }
        device.setLocation(request.getLocation());
        this.save(device);
        log.info("新增设备: deviceSn={}, communityId={}, operatorId={}", request.getDeviceSn(), device.getCommunityId(), UserHolder.getUserId());

        // 新增烟感时自动创建专属摄像头并绑定
        if (DeviceType.SMOKE_SENSOR.name().equals(deviceType)) {
            Devices camera = new Devices();
            String camSn = "SN-CAM-AUTO-" + device.getDeviceSn().replace("SN-", "");
            camera.setDeviceName(request.getDeviceName() + "摄像头");
            camera.setDeviceSn(camSn);
            camera.setDeviceType(DeviceType.CAMERA.name());
            camera.setCommunityId(device.getCommunityId());
            camera.setLocation((request.getLocation() != null ? request.getLocation() : "") + "门口");
            camera.setOnlineStatus("ONLINE");
            camera.setBatteryLevel(100);
            this.save(camera);

            device.setBoundCameraId(camera.getId());
            this.updateById(device);
            log.info("自动创建摄像头并绑定: smokeDevice={}, camera={}", device.getDeviceName(), camera.getDeviceName());
        }

        controlLogsService.recordLog(device.getId(), "ADD_DEVICE", "SUCCESS", "MANUAL");
    }

    @Override
    public void updateDevice(Long id, DeviceAddRequest request) {
        Devices device = this.getById(id);
        if (device == null) {
            throw new BusinessException("设备不存在");
        }
        checkCommunityAccess(device);
        boolean nameChanged = false;
        boolean locationChanged = false;
        if (request.getDeviceName() != null && !request.getDeviceName().isBlank()) {
            if (!request.getDeviceName().equals(device.getDeviceName())) {
                nameChanged = true;
            }
            device.setDeviceName(request.getDeviceName());
        }
        if (request.getDeviceType() != null && !request.getDeviceType().isBlank()) {
            device.setDeviceType(request.getDeviceType());
        }
        if (request.getLocation() != null) {
            if (!request.getLocation().equals(device.getLocation())) {
                locationChanged = true;
            }
            device.setLocation(request.getLocation());
        }
        if (request.getCommunityId() != null) {
            // 小区管理员不能修改设备所属小区
            if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
                throw new BusinessException(ErrorCode.FORBIDDEN, "小区管理员不能修改设备所属小区");
            }
            device.setCommunityId(request.getCommunityId());
        }
        this.updateById(device);

        // 同步烟感绑定摄像头的名称和位置
        if (DeviceType.SMOKE_SENSOR.name().equals(device.getDeviceType())
                && device.getBoundCameraId() != null
                && (nameChanged || locationChanged)) {
            Devices camera = this.getById(device.getBoundCameraId());
            if (camera != null) {
                if (nameChanged) {
                    camera.setDeviceName(device.getDeviceName() + "摄像头");
                }
                if (locationChanged && device.getLocation() != null) {
                    camera.setLocation(device.getLocation() + "门口");
                }
                this.updateById(camera);
            }
        }

        controlLogsService.recordLog(id, "UPDATE_DEVICE", "SUCCESS", "MANUAL");
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteDevice(Long id) {
        Devices device = this.getById(id);
        if (device == null) {
            throw new BusinessException("设备不存在");
        }
        checkCommunityAccess(device);
        smokeReadingsMapper.delete(new LambdaQueryWrapper<SmokeReadings>().eq(SmokeReadings::getDeviceId, id));
        alarmLogsMapper.delete(new LambdaQueryWrapper<AlarmLogs>().eq(AlarmLogs::getDeviceId, id));
        userDeviceMapper.delete(new LambdaQueryWrapper<UserDevice>().eq(UserDevice::getDeviceId, id));

        // 如果是烟感且绑定了摄像头，一并处理（解绑或级联删除）
        if (DeviceType.SMOKE_SENSOR.name().equals(device.getDeviceType()) && device.getBoundCameraId() != null) {
            Devices camera = this.getById(device.getBoundCameraId());
            if (camera != null) {
                // 如果该摄像头只被这个烟感绑定，级联删除；否则只解绑
                long bindCount = this.lambdaQuery().eq(Devices::getBoundCameraId, camera.getId()).count();
                if (bindCount <= 1) {
                    this.removeById(camera.getId());
                    log.info("级联删除摄像头: cameraId={}, 原因=烟感 {} 被删除", camera.getId(), id);
                } else {
                    log.info("摄像头 {} 仍被其他烟感绑定，保留仅解绑", camera.getId());
                }
            }
        }

        this.removeById(id);
        log.info("删除设备: id={}, operatorId={}", id, UserHolder.getUserId());

        controlLogsService.recordLog(id, "DELETE_DEVICE", "SUCCESS", "MANUAL");
    }

    /** 居民/小区管理员只能访问本小区设备 */
    private void checkCommunityAccess(Devices device) {
        String role = UserHolder.getRole();
        if (Role.RESIDENT.name().equals(role) || Role.COMMUNITY_ADMIN.name().equals(role)) {
            Long currentCommunityId = UserHolder.getCommunityId();
            if (currentCommunityId == null || !currentCommunityId.equals(device.getCommunityId())) {
                throw new BusinessException(ErrorCode.FORBIDDEN, "无权访问其他小区设备");
            }
        }
    }

    @Override
    public DeviceStatisticsVO getStatistics() {
        LambdaQueryWrapper<Devices> totalWrapper = new LambdaQueryWrapper<>();
        applyCommunityScope(totalWrapper);
        long total = this.count(totalWrapper);

        LambdaQueryWrapper<Devices> onlineWrapper = new LambdaQueryWrapper<>();
        onlineWrapper.eq(Devices::getOnlineStatus, OnlineStatus.ONLINE.name());
        applyCommunityScope(onlineWrapper);
        long online = this.count(onlineWrapper);

        LambdaQueryWrapper<Devices> offlineWrapper = new LambdaQueryWrapper<>();
        offlineWrapper.eq(Devices::getOnlineStatus, OnlineStatus.OFFLINE.name());
        applyCommunityScope(offlineWrapper);
        long offline = this.count(offlineWrapper);

        // 活跃告警数按设备社区过滤
        long activeAlarm;
        String role = UserHolder.getRole();
        if (Role.RESIDENT.name().equals(role) || Role.COMMUNITY_ADMIN.name().equals(role)) {
            Long communityId = UserHolder.getCommunityId();
            List<Long> deviceIds = devicesMapper.selectList(
                    new LambdaQueryWrapper<Devices>().eq(Devices::getCommunityId, communityId))
                    .stream().map(Devices::getId).collect(Collectors.toList());
            activeAlarm = deviceIds.isEmpty() ? 0L : alarmLogsMapper.selectCount(
                    new LambdaQueryWrapper<AlarmLogs>().eq(AlarmLogs::getStatus, "ACTIVE").in(AlarmLogs::getDeviceId, deviceIds));
        } else {
            activeAlarm = alarmLogsMapper.selectCount(new LambdaQueryWrapper<AlarmLogs>().eq(AlarmLogs::getStatus, "ACTIVE"));
        }

        return DeviceStatisticsVO.builder()
                .totalCount(String.valueOf(total))
                .onlineCount(String.valueOf(online))
                .offlineCount(String.valueOf(offline))
                .activeAlarmCount(String.valueOf(activeAlarm))
                .build();
    }

    @Override
    public void updateHeartbeat(String deviceSn, Integer batteryLevel) {
        Devices device = getBySn(deviceSn);
        if (device == null) {
            log.warn("心跳上报：未找到设备 deviceSn={}", deviceSn);
            return;
        }
        boolean wasOffline = !OnlineStatus.ONLINE.name().equals(device.getOnlineStatus());

        device.setOnlineStatus(OnlineStatus.ONLINE.name());
        device.setLastHeartbeatTime(LocalDateTime.now());
        if (batteryLevel != null) {
            device.setBatteryLevel(batteryLevel);
        }
        devicesMapper.updateById(device);

        if (wasOffline) {
            pushOnline(device);
        }
    }

    @Override
    public void handleSelfCheck(String deviceSn, Integer batteryLevel, Boolean sensorFault) {
        Devices device = getBySn(deviceSn);
        if (device == null) {
            log.warn("自检上报：未找到设备 deviceSn={}", deviceSn);
            return;
        }
        boolean wasOffline = !OnlineStatus.ONLINE.name().equals(device.getOnlineStatus());

        device.setOnlineStatus(OnlineStatus.ONLINE.name());
        device.setLastHeartbeatTime(LocalDateTime.now());
        if (batteryLevel != null) {
            device.setBatteryLevel(batteryLevel);
        }
        devicesMapper.updateById(device);

        if (Boolean.TRUE.equals(sensorFault)) {
            alarmLogsService.createAlarm(device.getId(), AlarmType.SENSOR_FAULT.name(),
                    AlarmLevel.FAULT.name(), "设备自检发现传感器故障");
        }
        if (wasOffline) {
            pushOnline(device);
        }
    }

    private Devices getBySn(String deviceSn) {
        return devicesMapper.selectOne(
                new LambdaQueryWrapper<Devices>().eq(Devices::getDeviceSn, deviceSn));
    }

    private void applyCommunityScope(LambdaQueryWrapper<Devices> wrapper) {
        String role = UserHolder.getRole();
        if (role == null) {
            return;
        }
        if (Role.RESIDENT.name().equals(role) || Role.COMMUNITY_ADMIN.name().equals(role)) {
            Long communityId = UserHolder.getCommunityId();
            wrapper.eq(communityId != null, Devices::getCommunityId, communityId);
        }
    }

    private void pushOnline(Devices device) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("deviceId", device.getId());
        data.put("deviceName", device.getDeviceName());
        data.put("onlineStatus", device.getOnlineStatus());
        data.put("lastHeartbeatTime", device.getLastHeartbeatTime());
        webSocketNotifier.pushDeviceOnline(data);
    }

    private DeviceVO toDeviceVO(Devices device) {
        return DeviceVO.builder()
                .id(String.valueOf(device.getId()))
                .deviceName(device.getDeviceName())
                .deviceSn(device.getDeviceSn())
                .deviceType(device.getDeviceType())
                .communityId(device.getCommunityId())
                .location(device.getLocation())
                .onlineStatus(device.getOnlineStatus())
                .batteryLevel(device.getBatteryLevel())
                .boundCameraId(device.getBoundCameraId())
                .lastHeartbeatTime(device.getLastHeartbeatTime() != null ? String.valueOf(device.getLastHeartbeatTime()) : null)
                .createdAt(device.getCreatedAt() != null ? String.valueOf(device.getCreatedAt()) : null)
                .build();
    }

    @Override
    public void bindCamera(Long smokeDeviceId, Long cameraDeviceId) {
        Devices smokeDevice = getById(smokeDeviceId);
        if (smokeDevice == null) {
            throw new BusinessException("烟感设备不存在");
        }
        checkCommunityAccess(smokeDevice);
        if (!DeviceType.SMOKE_SENSOR.name().equals(smokeDevice.getDeviceType())) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "只能给烟感设备绑定摄像头");
        }
        Devices camera = getById(cameraDeviceId);
        if (camera == null) {
            throw new BusinessException("摄像头设备不存在");
        }
        checkCommunityAccess(camera);
        if (!DeviceType.CAMERA.name().equals(camera.getDeviceType())) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "目标设备不是摄像头");
        }
        // 摄像头只能被一个烟感专属绑定（一对一）
        long existingBindCount = this.lambdaQuery().eq(Devices::getBoundCameraId, cameraDeviceId).count();
        if (existingBindCount > 0) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "该摄像头已被其他烟感绑定，请先解绑");
        }
        smokeDevice.setBoundCameraId(cameraDeviceId);
        updateById(smokeDevice);
        log.info("绑定摄像头: smokeDevice={}({}) -> camera={}({})",
                smokeDevice.getDeviceName(), smokeDevice.getId(), camera.getDeviceName(), camera.getId());
    }

    @Override
    public void unbindCamera(Long smokeDeviceId) {
        Devices smokeDevice = getById(smokeDeviceId);
        if (smokeDevice == null) {
            throw new BusinessException("烟感设备不存在");
        }
        checkCommunityAccess(smokeDevice);
        smokeDevice.setBoundCameraId(null);
        updateById(smokeDevice);
        log.info("解绑摄像头: smokeDevice={}({})", smokeDevice.getDeviceName(), smokeDevice.getId());
    }
}
