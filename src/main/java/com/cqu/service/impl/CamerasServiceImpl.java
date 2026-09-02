package com.cqu.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.cqu.common.enums.Role;
import com.cqu.common.exception.BusinessException;
import com.cqu.entity.Cameras;
import com.cqu.entity.Community;
import com.cqu.entity.Devices;
import com.cqu.mapper.CamerasMapper;
import com.cqu.mapper.CommunityMapper;
import com.cqu.mapper.DevicesMapper;
import com.cqu.service.ICamerasService;
import com.cqu.utils.UserHolder;
import com.cqu.vo.CameraVO;
import com.cqu.vo.PageResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 摄像头服务实现
 */
@Slf4j
@Service
public class CamerasServiceImpl implements ICamerasService {

    @Autowired
    private CamerasMapper camerasMapper;

    @Autowired
    private DevicesMapper devicesMapper;

    @Autowired
    private CommunityMapper communityMapper;

    @Value("${ai-review.snapshot-dir:uploads/ai-review}")
    private String snapshotDir;

    @Override
    public PageResult<CameraVO> pageCameras(int page, int pageSize, String cameraName, String onlineStatus) {
        LambdaQueryWrapper<Cameras> wrapper = new LambdaQueryWrapper<>();
        // 小区隔离：非系统管理员/消防员只能看本小区
        String role = UserHolder.getRole();
        if (!Role.SYSTEM_ADMIN.name().equals(role) && !Role.FIREFIGHTER.name().equals(role)) {
            Long cid = UserHolder.getCommunityId();
            if (cid == null) {
                return PageResult.of(0L, new ArrayList<>());
            }
            wrapper.eq(Cameras::getCommunityId, cid);
        }
        if (cameraName != null && !cameraName.isBlank()) {
            wrapper.like(Cameras::getCameraName, cameraName);
        }
        if (onlineStatus != null && !onlineStatus.isBlank()) {
            wrapper.eq(Cameras::getOnlineStatus, onlineStatus.toUpperCase());
        }
        wrapper.orderByDesc(Cameras::getCreatedAt);

        Page<Cameras> p = camerasMapper.selectPage(new Page<>(page, pageSize), wrapper);
        List<CameraVO> voList = new ArrayList<>();
        for (Cameras c : p.getRecords()) {
            voList.add(toVO(c));
        }
        return PageResult.of(p.getTotal(), voList);
    }

    @Override
    public CameraVO getCameraById(Long id) {
        Cameras c = camerasMapper.selectById(id);
        if (c == null) {
            throw new BusinessException("摄像头不存在");
        }
        checkCommunityAccess(c.getCommunityId());
        return toVO(c);
    }

    @Override
    public void createCamera(Cameras camera) {
        // 小区管理员只能创建本小区摄像头
        String role = UserHolder.getRole();
        if (Role.COMMUNITY_ADMIN.name().equals(role)) {
            Long cid = UserHolder.getCommunityId();
            if (cid == null || (camera.getCommunityId() != null && !camera.getCommunityId().equals(cid))) {
                throw new BusinessException("无权为其他小区创建摄像头");
            }
            camera.setCommunityId(cid);
        }
        if (camera.getOnlineStatus() == null) {
            camera.setOnlineStatus("OFFLINE");
        }
        camera.setCreatedAt(LocalDateTime.now());
        camerasMapper.insert(camera);
        log.info("创建摄像头: id={}, name={}", camera.getId(), camera.getCameraName());
    }

    @Override
    public void updateCamera(Long id, Cameras camera) {
        Cameras existing = camerasMapper.selectById(id);
        if (existing == null) {
            throw new BusinessException("摄像头不存在");
        }
        checkCommunityAccess(existing.getCommunityId());
        if (camera.getCameraName() != null) {
            existing.setCameraName(camera.getCameraName());
        }
        if (camera.getLocation() != null) {
            existing.setLocation(camera.getLocation());
        }
        if (camera.getOnlineStatus() != null) {
            existing.setOnlineStatus(camera.getOnlineStatus());
        }
        if (camera.getCommunityId() != null) {
            existing.setCommunityId(camera.getCommunityId());
        }
        camerasMapper.updateById(existing);
        log.info("更新摄像头: id={}", id);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteCamera(Long id) {
        Cameras existing = camerasMapper.selectById(id);
        if (existing == null) {
            throw new BusinessException("摄像头不存在");
        }
        checkCommunityAccess(existing.getCommunityId());
        // 同步解绑关联的烟感设备（显式 set null）
        if (existing.getBoundDeviceId() != null) {
            devicesMapper.update(null, new UpdateWrapper<Devices>()
                    .eq("id", existing.getBoundDeviceId()).set("bound_camera_id", null));
        }
        camerasMapper.deleteById(id);
        log.info("删除摄像头: id={}", id);
    }

    @Override
    public Map<String, String> capture(Long cameraId, String base64Image) {
        Cameras camera = camerasMapper.selectById(cameraId);
        if (camera == null) {
            throw new BusinessException("摄像头不存在");
        }
        checkCommunityAccess(camera.getCommunityId());
        if (base64Image == null || base64Image.isBlank()) {
            throw new BusinessException("图片数据为空");
        }
        // 去掉 data:image/...;base64, 前缀
        String raw = base64Image;
        int commaIdx = raw.indexOf(',');
        if (commaIdx > 0) {
            raw = raw.substring(commaIdx + 1);
        }
        try {
            byte[] bytes = Base64.getDecoder().decode(raw);
            Path dir = Paths.get(snapshotDir);
            Files.createDirectories(dir);
            String fileName = "capture-" + cameraId + "-" +
                    LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmssSSS")) + ".jpg";
            Path file = dir.resolve(fileName);
            Files.write(file, bytes);
            String url = "/images/ai-review/" + fileName;
            // 更新最新截图 URL
            camera.setSnapshotUrl(url);
            camerasMapper.updateById(camera);
            log.info("摄像头拍照成功: cameraId={} -> {}", cameraId, url);
            Map<String, String> result = new HashMap<>();
            result.put("imageUrl", url);
            return result;
        } catch (IllegalArgumentException e) {
            throw new BusinessException("base64 解码失败");
        } catch (Exception e) {
            log.error("摄像头拍照保存失败: cameraId={}", cameraId, e);
            throw new BusinessException("图片保存失败: " + e.getMessage());
        }
    }

    @Override
    public String getSnapshot(Long cameraId) {
        Cameras camera = camerasMapper.selectById(cameraId);
        if (camera == null) {
            throw new BusinessException("摄像头不存在");
        }
        checkCommunityAccess(camera.getCommunityId());
        return camera.getSnapshotUrl();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void bindDevice(Long cameraId, Long deviceId) {
        Cameras camera = camerasMapper.selectById(cameraId);
        if (camera == null) {
            throw new BusinessException("摄像头不存在");
        }
        checkCommunityAccess(camera.getCommunityId());
        Devices device = devicesMapper.selectById(deviceId);
        if (device == null) {
            throw new BusinessException("烟感设备不存在");
        }
        checkCommunityAccess(device.getCommunityId());
        // 校验同小区
        if (camera.getCommunityId() != null && device.getCommunityId() != null
                && !camera.getCommunityId().equals(device.getCommunityId())) {
            throw new BusinessException("摄像头与设备不在同一小区，无法绑定");
        }
        // 校验设备未被其他摄像头绑定
        if (device.getBoundCameraId() != null && !device.getBoundCameraId().equals(cameraId)) {
            throw new BusinessException("该设备已被其他摄像头绑定");
        }
        // 清除原绑定（显式 set null）
        if (camera.getBoundDeviceId() != null) {
            devicesMapper.update(null, new UpdateWrapper<Devices>()
                    .eq("id", camera.getBoundDeviceId()).set("bound_camera_id", null));
        }
        // 双向同步
        camera.setBoundDeviceId(deviceId);
        camerasMapper.updateById(camera);
        device.setBoundCameraId(cameraId);
        devicesMapper.updateById(device);
        log.info("摄像头绑定设备: cameraId={} <-> deviceId={}", cameraId, deviceId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void unbindDevice(Long cameraId) {
        Cameras camera = camerasMapper.selectById(cameraId);
        if (camera == null) {
            throw new BusinessException("摄像头不存在");
        }
        checkCommunityAccess(camera.getCommunityId());
        if (camera.getBoundDeviceId() == null) {
            throw new BusinessException("该摄像头未绑定设备");
        }
        // 显式 set null（MyBatis-Plus updateById 默认不更新 null 值）
        devicesMapper.update(null, new UpdateWrapper<Devices>()
                .eq("id", camera.getBoundDeviceId()).set("bound_camera_id", null));
        camerasMapper.update(null, new UpdateWrapper<Cameras>()
                .eq("id", cameraId).set("bound_device_id", null));
        log.info("摄像头解绑设备: cameraId={}", cameraId);
    }

    /** 小区隔离检查：非系统管理员/消防员只能操作本小区数据 */
    private void checkCommunityAccess(Long communityId) {
        String role = UserHolder.getRole();
        if (Role.SYSTEM_ADMIN.name().equals(role) || Role.FIREFIGHTER.name().equals(role)) {
            return;
        }
        Long userCid = UserHolder.getCommunityId();
        if (userCid == null || (communityId != null && !userCid.equals(communityId))) {
            throw new BusinessException("无权访问其他小区数据");
        }
    }

    /** 实体转 VO（关联查小区名和设备名） */
    private CameraVO toVO(Cameras c) {
        CameraVO vo = new CameraVO();
        vo.setId(String.valueOf(c.getId()));
        vo.setCameraName(c.getCameraName());
        vo.setCameraSn(c.getCameraSn());
        vo.setCommunityId(c.getCommunityId());
        vo.setLocation(c.getLocation());
        vo.setOnlineStatus(c.getOnlineStatus());
        vo.setBoundDeviceId(c.getBoundDeviceId() != null ? String.valueOf(c.getBoundDeviceId()) : null);
        vo.setSnapshotUrl(c.getSnapshotUrl());
        vo.setCreatedAt(c.getCreatedAt() != null ? c.getCreatedAt().toString() : null);
        // 关联查小区名
        if (c.getCommunityId() != null) {
            Community community = communityMapper.selectById(c.getCommunityId());
            if (community != null) {
                vo.setCommunityName(community.getName());
            }
        }
        // 关联查设备名
        if (c.getBoundDeviceId() != null) {
            Devices device = devicesMapper.selectById(c.getBoundDeviceId());
            if (device != null) {
                vo.setBoundDeviceName(device.getDeviceName());
            }
        }
        return vo;
    }
}
