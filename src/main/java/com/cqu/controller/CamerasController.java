package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.entity.Cameras;
import com.cqu.service.ICamerasService;
import com.cqu.vo.CameraVO;
import com.cqu.vo.PageResult;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 摄像头管理接口（对接前端 /cameras）
 */
@RestController
@RequestMapping("/cameras")
public class CamerasController {

    @Autowired
    private ICamerasService camerasService;

    /**
     * 摄像头分页列表（按角色过滤小区）
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.RESIDENT, Role.FIREFIGHTER})
    @GetMapping
    public Result<PageResult<CameraVO>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int pageSize,
            @RequestParam(required = false) String cameraName,
            @RequestParam(required = false) String onlineStatus) {
        return Result.success(camerasService.pageCameras(page, pageSize, cameraName, onlineStatus));
    }

    /**
     * 摄像头详情
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.RESIDENT, Role.FIREFIGHTER})
    @GetMapping("/{id}")
    public Result<CameraVO> detail(@PathVariable Long id) {
        return Result.success(camerasService.getCameraById(id));
    }

    /**
     * 创建摄像头（仅管理员）
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PostMapping
    public Result<Void> create(@RequestBody Cameras camera) {
        camerasService.createCamera(camera);
        return Result.success(null);
    }

    /**
     * 更新摄像头（仅管理员）
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @RequestBody Cameras camera) {
        camerasService.updateCamera(id, camera);
        return Result.success(null);
    }

    /**
     * 删除摄像头（仅系统管理员）
     */
    @RequireRole({Role.SYSTEM_ADMIN})
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        camerasService.deleteCamera(id);
        return Result.success(null);
    }

    /**
     * 拍照上传（前端 getUserMedia 拍照 → base64 上传 → 保存文件 → 返回 URL）
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.RESIDENT, Role.FIREFIGHTER})
    @PostMapping("/{id}/capture")
    public Result<Map<String, String>> capture(@PathVariable Long id,
                                               @RequestBody Map<String, String> body) {
        String base64Image = body != null ? body.get("image") : null;
        if (base64Image == null) {
            base64Image = body != null ? body.get("imageBase64") : null;
        }
        return Result.success(camerasService.capture(id, base64Image));
    }

    /**
     * 获取最新截图 URL
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.RESIDENT, Role.FIREFIGHTER})
    @GetMapping("/{id}/snapshot")
    public Result<Map<String, String>> snapshot(@PathVariable Long id) {
        String url = camerasService.getSnapshot(id);
        return Result.success(Map.of("snapshotUrl", url != null ? url : ""));
    }

    /**
     * 绑定烟感设备（摄像头 → 设备，双向同步）
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PostMapping("/{id}/bind-device/{deviceId}")
    public Result<Void> bindDevice(@PathVariable Long id, @PathVariable Long deviceId) {
        camerasService.bindDevice(id, deviceId);
        return Result.success(null);
    }

    /**
     * 解绑烟感设备
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @DeleteMapping("/{id}/bind-device")
    public Result<Void> unbindDevice(@PathVariable Long id) {
        camerasService.unbindDevice(id);
        return Result.success(null);
    }
}
