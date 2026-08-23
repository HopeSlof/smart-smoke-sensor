package com.cqu.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.cqu.entity.UserDevice;
import com.cqu.vo.DeviceVO;

import java.util.List;

/**
 * 住户-设备绑定服务
 */
public interface IUserDeviceService extends IService<UserDevice> {

    void bind(Long deviceId, Long userId);

    void unbind(Long deviceId, Long userId);

    List<DeviceVO> listBoundDevices(Long userId);

    /** 查询住户绑定的设备 ID 集合（供告警重点提示/DataScope 使用） */
    List<Long> listBoundDeviceIds(Long userId);
}
