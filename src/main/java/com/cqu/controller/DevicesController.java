package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.service.IDevicesService;
import com.cqu.vo.DeviceAddRequest;
import com.cqu.vo.DeviceDetailVO;
import com.cqu.vo.DeviceStatisticsVO;
import com.cqu.vo.DeviceVO;
import com.cqu.vo.PageResult;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 设备管理
 */
@RestController
@RequestMapping("/devices")
public class DevicesController {

    @Autowired
    private IDevicesService devicesService;

    @GetMapping
    public Result<PageResult<DeviceVO>> list(@RequestParam(defaultValue = "1") int page,
                                             @RequestParam(defaultValue = "10") int pageSize,
                                             @RequestParam(required = false) String deviceName,
                                             @RequestParam(required = false) String deviceType,
                                             @RequestParam(required = false) String onlineStatus) {
        return Result.success(devicesService.pageDevices(page, pageSize, deviceName, deviceType, onlineStatus));
    }

    @GetMapping("/statistics")
    public Result<DeviceStatisticsVO> statistics() {
        return Result.success(devicesService.getStatistics());
    }

    @GetMapping("/{id}")
    public Result<DeviceDetailVO> detail(@PathVariable Long id) {
        return Result.success(devicesService.getDeviceDetail(id));
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PostMapping
    public Result<String> add(@RequestBody DeviceAddRequest request) {
        devicesService.addDevice(request);
        return Result.success("添加成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PutMapping("/{id}")
    public Result<String> update(@PathVariable Long id, @RequestBody DeviceAddRequest request) {
        devicesService.updateDevice(id, request);
        return Result.success("修改成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN})
    @DeleteMapping("/{id}")
    public Result<String> delete(@PathVariable Long id) {
        devicesService.deleteDevice(id);
        return Result.success("删除成功");
    }

    /** 硬件心跳上报（HTTP 降级通道，不校验 JWT） */
    @PostMapping("/heartbeat")
    public Result<String> heartbeat(@RequestBody Map<String, Object> body) {
        String deviceSn = (String) body.get("deviceSn");
        Integer batteryLevel = body.get("batteryLevel") != null
                ? Integer.valueOf(body.get("batteryLevel").toString()) : null;
        devicesService.updateHeartbeat(deviceSn, batteryLevel);
        return Result.success("ok");
    }

    /** 硬件自检上报（HTTP 降级通道，不校验 JWT） */
    @PostMapping("/self-check")
    public Result<String> selfCheck(@RequestBody Map<String, Object> body) {
        String deviceSn = (String) body.get("deviceSn");
        Integer batteryLevel = body.get("batteryLevel") != null
                ? Integer.valueOf(body.get("batteryLevel").toString()) : null;
        Boolean sensorFault = body.get("sensorFault") != null
                ? Boolean.valueOf(body.get("sensorFault").toString()) : null;
        devicesService.handleSelfCheck(deviceSn, batteryLevel, sensorFault);
        return Result.success("ok");
    }
}
