package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.entity.Cameras;
import com.cqu.entity.Devices;
import com.cqu.mapper.CamerasMapper;
import com.cqu.mapper.DevicesMapper;
import com.cqu.service.IDevicesService;
import com.cqu.service.IUserDeviceService;
import com.cqu.vo.BindDeviceRequest;
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

import java.util.HashMap;
import java.util.Map;

/**
 * 设备管理
 */
@RestController
@RequestMapping("/devices")
public class DevicesController {

    @Autowired
    private IDevicesService devicesService;

    @Autowired
    private IUserDeviceService userDeviceService;

    @Autowired
    private DevicesMapper devicesMapper;

    @Autowired
    private CamerasMapper camerasMapper;

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.RESIDENT, Role.FIREFIGHTER})
    @GetMapping
    public Result<PageResult<DeviceVO>> list(@RequestParam(defaultValue = "1") int page,
                                             @RequestParam(defaultValue = "10") int pageSize,
                                             @RequestParam(required = false) String deviceName,
                                             @RequestParam(required = false) String deviceType,
                                             @RequestParam(required = false) String onlineStatus) {
        return Result.success(devicesService.pageDevices(page, pageSize, deviceName, deviceType, onlineStatus));
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @GetMapping("/statistics")
    public Result<DeviceStatisticsVO> statistics() {
        return Result.success(devicesService.getStatistics());
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.RESIDENT, Role.FIREFIGHTER})
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

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @DeleteMapping("/{id}")
    public Result<String> delete(@PathVariable Long id) {
        devicesService.deleteDevice(id);
        return Result.success("删除成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PutMapping("/{deviceId}/bind")
    public Result<String> bind(@PathVariable Long deviceId, @RequestBody BindDeviceRequest request) {
        userDeviceService.bind(deviceId, request.getUserId());
        return Result.success("绑定成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PutMapping("/{deviceId}/unbind")
    public Result<String> unbind(@PathVariable Long deviceId, @RequestBody BindDeviceRequest request) {
        userDeviceService.unbind(deviceId, request.getUserId());
        return Result.success("解绑成功");
    }

    /** 绑定摄像头到烟感设备 */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PutMapping("/{smokeDeviceId}/bind-camera/{cameraId}")
    public Result<String> bindCamera(@PathVariable Long smokeDeviceId, @PathVariable Long cameraId) {
        devicesService.bindCamera(smokeDeviceId, cameraId);
        return Result.success("摄像头绑定成功");
    }

    /** 解绑烟感设备的摄像头 */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @DeleteMapping("/{smokeDeviceId}/bind-camera")
    public Result<String> unbindCamera(@PathVariable Long smokeDeviceId) {
        devicesService.unbindCamera(smokeDeviceId);
        return Result.success("摄像头解绑成功");
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

    /**
     * 获取设备绑定摄像头的最新截图（前端 AiRecognizeApi.getSnapshot）
     * GET /devices/{deviceId}/snapshot
     * 返回：{ snapshotUrl: "..." }
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.RESIDENT, Role.FIREFIGHTER})
    @GetMapping("/{deviceId}/snapshot")
    public Result<Map<String, Object>> getSnapshot(@PathVariable Long deviceId) {
        Devices device = devicesMapper.selectById(deviceId);
        if (device == null) {
            return Result.success(Map.of("snapshotUrl", "", "deviceName", "", "deviceId", String.valueOf(deviceId)));
        }
        Map<String, Object> result = new HashMap<>();
        result.put("deviceId", String.valueOf(deviceId));
        result.put("deviceName", device.getDeviceName());
        // 通过 devices.bound_camera_id 查 cameras 表
        String snapshotUrl = "";
        if (device.getBoundCameraId() != null) {
            Cameras camera = camerasMapper.selectById(device.getBoundCameraId());
            if (camera != null && camera.getSnapshotUrl() != null) {
                snapshotUrl = camera.getSnapshotUrl();
            }
        }
        result.put("snapshotUrl", snapshotUrl);
        return Result.success(result);
    }
}
