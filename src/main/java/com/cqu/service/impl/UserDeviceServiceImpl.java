package com.cqu.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.cqu.common.enums.Role;
import com.cqu.common.exception.BusinessException;
import com.cqu.common.exception.ErrorCode;
import com.cqu.entity.Devices;
import com.cqu.entity.UserDevice;
import com.cqu.entity.Users;
import com.cqu.mapper.DevicesMapper;
import com.cqu.mapper.UserDeviceMapper;
import com.cqu.mapper.UsersMapper;
import com.cqu.service.IUserDeviceService;
import com.cqu.utils.UserHolder;
import com.cqu.vo.DeviceVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 住户-设备绑定服务实现
 */
@Service
public class UserDeviceServiceImpl extends ServiceImpl<UserDeviceMapper, UserDevice> implements IUserDeviceService {

    @Autowired
    private UsersMapper usersMapper;

    @Autowired
    private DevicesMapper devicesMapper;

    @Override
    public void bind(Long deviceId, Long userId) {
        if (deviceId == null || userId == null) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "设备ID和用户ID不能为空");
        }
        Users user = usersMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException("用户不存在");
        }
        if (!Role.RESIDENT.name().equals(user.getRole())) {
            throw new BusinessException("只能绑定住户（居民）");
        }
        Devices device = devicesMapper.selectById(deviceId);
        if (device == null) {
            throw new BusinessException("设备不存在");
        }
        // 设备必须属于住户所在小区，防止跨小区误绑
        if (user.getCommunityId() == null || !user.getCommunityId().equals(device.getCommunityId())) {
            throw new BusinessException("设备与住户不在同一小区，无法绑定");
        }
        long exists = this.lambdaQuery()
                .eq(UserDevice::getUserId, userId)
                .eq(UserDevice::getDeviceId, deviceId)
                .count();
        if (exists > 0) {
            throw new BusinessException("已绑定该设备");
        }

        UserDevice userDevice = new UserDevice();
        userDevice.setUserId(userId);
        userDevice.setDeviceId(deviceId);
        this.save(userDevice);
    }

    @Override
    public void unbind(Long deviceId, Long userId) {
        UserDevice userDevice = this.lambdaQuery()
                .eq(UserDevice::getUserId, userId)
                .eq(UserDevice::getDeviceId, deviceId)
                .one();
        if (userDevice == null) {
            throw new BusinessException("未绑定该设备");
        }
        this.removeById(userDevice.getId());
    }

    @Override
    public List<DeviceVO> listBoundDevices(Long userId) {
        // 居民只能查看自己的绑定设备
        if (Role.RESIDENT.name().equals(UserHolder.getRole())) {
            Long currentUserId = UserHolder.getUserId();
            if (currentUserId == null || !currentUserId.equals(userId)) {
                throw new BusinessException(ErrorCode.FORBIDDEN, "无权查看其他住户的绑定设备");
            }
        }
        List<UserDevice> binds = this.lambdaQuery().eq(UserDevice::getUserId, userId).list();
        if (binds.isEmpty()) return List.of();
        List<Long> deviceIds = binds.stream().map(UserDevice::getDeviceId).collect(Collectors.toList());
        return devicesMapper.selectBatchIds(deviceIds).stream().map(this::toDeviceVO).collect(Collectors.toList());
    }

    @Override
    public List<Long> listBoundDeviceIds(Long userId) {
        return this.lambdaQuery().eq(UserDevice::getUserId, userId).list()
                .stream().map(UserDevice::getDeviceId).collect(Collectors.toList());
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
                .lastHeartbeatTime(device.getLastHeartbeatTime() != null ? String.valueOf(device.getLastHeartbeatTime()) : null)
                .createdAt(device.getCreatedAt() != null ? String.valueOf(device.getCreatedAt()) : null)
                .build();
    }
}
