package com.cqu.service;

import com.cqu.entity.Cameras;
import com.cqu.vo.CameraVO;
import com.cqu.vo.PageResult;

import java.util.Map;

/**
 * 摄像头服务接口
 */
public interface ICamerasService {

    /** 分页查询摄像头（按角色过滤小区） */
    PageResult<CameraVO> pageCameras(int page, int pageSize, String cameraName, String onlineStatus);

    /** 查询摄像头详情 */
    CameraVO getCameraById(Long id);

    /** 创建摄像头 */
    void createCamera(Cameras camera);

    /** 更新摄像头 */
    void updateCamera(Long id, Cameras camera);

    /** 删除摄像头（同时解绑关联设备） */
    void deleteCamera(Long id);

    /** 拍照上传（base64 → 保存文件 → 返回 URL） */
    Map<String, String> capture(Long cameraId, String base64Image);

    /** 获取最新截图 URL */
    String getSnapshot(Long cameraId);

    /** 绑定烟感设备（cameras.bound_device_id 与 devices.bound_camera_id 双向同步） */
    void bindDevice(Long cameraId, Long deviceId);

    /** 解绑烟感设备 */
    void unbindDevice(Long cameraId);
}
