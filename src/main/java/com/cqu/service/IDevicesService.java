package com.cqu.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.cqu.entity.Devices;
import com.cqu.vo.DeviceAddRequest;
import com.cqu.vo.DeviceDetailVO;
import com.cqu.vo.DeviceStatisticsVO;
import com.cqu.vo.DeviceVO;
import com.cqu.vo.PageResult;

/**
 * 设备服务
 */
public interface IDevicesService extends IService<Devices> {

    PageResult<DeviceVO> pageDevices(int page, int pageSize, String deviceName, String deviceType, String onlineStatus);

    DeviceDetailVO getDeviceDetail(Long id);

    void addDevice(DeviceAddRequest request);

    void updateDevice(Long id, DeviceAddRequest request);

    void deleteDevice(Long id);

    DeviceStatisticsVO getStatistics();

    /** 心跳上报（隐式刷新在线 + 电量） */
    void updateHeartbeat(String deviceSn, Integer batteryLevel);

    /** 自检上报（电量 + 传感器故障） */
    void handleSelfCheck(String deviceSn, Integer batteryLevel, Boolean sensorFault);
}
