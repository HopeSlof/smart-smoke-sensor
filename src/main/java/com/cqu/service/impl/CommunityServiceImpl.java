package com.cqu.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.cqu.common.enums.Role;
import com.cqu.common.exception.BusinessException;
import com.cqu.common.exception.ErrorCode;
import com.cqu.entity.Community;
import com.cqu.entity.Devices;
import com.cqu.entity.Users;
import com.cqu.mapper.CommunityMapper;
import com.cqu.mapper.DevicesMapper;
import com.cqu.mapper.UsersMapper;
import com.cqu.service.ICommunityService;
import com.cqu.utils.UserHolder;
import com.cqu.vo.CommunitySaveRequest;
import com.cqu.vo.CommunityVO;
import com.cqu.vo.PageResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 小区服务实现
 */
@Slf4j
@Service
public class CommunityServiceImpl extends ServiceImpl<CommunityMapper, Community> implements ICommunityService {

    @Autowired
    private UsersMapper usersMapper;

    @Autowired
    private DevicesMapper devicesMapper;

    @Override
    public PageResult<CommunityVO> pageCommunities(int page, int pageSize, String name) {
        LambdaQueryWrapper<Community> wrapper = new LambdaQueryWrapper<>();
        wrapper.like(name != null && !name.isBlank(), Community::getName, name);
        // 小区管理员只能看本小区
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            wrapper.eq(Community::getId, UserHolder.getCommunityId());
        }
        wrapper.orderByAsc(Community::getId);
        Page<Community> pageResult = this.page(new Page<>(page, pageSize), wrapper);

        Map<Long, String> adminNameMap = buildAdminNameMap(pageResult.getRecords());
        List<CommunityVO> records = pageResult.getRecords().stream()
                .map(c -> toVO(c, adminNameMap.get(c.getAdminUserId())))
                .collect(Collectors.toList());
        return PageResult.of(pageResult.getTotal(), records);
    }

    @Override
    public CommunityVO getCommunity(Long id) {
        Community community = this.getById(id);
        if (community == null) {
            throw new BusinessException("小区不存在");
        }
        // 小区管理员只能查看本小区
        if (Role.COMMUNITY_ADMIN.name().equals(UserHolder.getRole())) {
            Long currentCommunityId = UserHolder.getCommunityId();
            if (currentCommunityId == null || !currentCommunityId.equals(id)) {
                throw new BusinessException(ErrorCode.FORBIDDEN, "无权查看其他小区");
            }
        }
        String adminName = null;
        if (community.getAdminUserId() != null) {
            Users admin = usersMapper.selectById(community.getAdminUserId());
            if (admin != null) adminName = admin.getUsername();
        }
        return toVO(community, adminName);
    }

    @Override
    public Long addCommunity(CommunitySaveRequest request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "小区名称不能为空");
        }
        if (this.lambdaQuery().eq(Community::getName, request.getName()).count() > 0) {
            throw new BusinessException("小区名称已存在");
        }
        Community community = new Community();
        community.setName(request.getName());
        community.setAddress(request.getAddress());
        community.setAdminUserId(request.getAdminUserId());
        this.save(community);
        log.info("新增小区: id={}, name={}", community.getId(), community.getName());
        return community.getId();
    }

    @Override
    public void updateCommunity(Long id, CommunitySaveRequest request) {
        Community community = this.getById(id);
        if (community == null) {
            throw new BusinessException("小区不存在");
        }
        if (request.getName() != null && !request.getName().isBlank()) {
            community.setName(request.getName());
        }
        if (request.getAddress() != null) {
            community.setAddress(request.getAddress());
        }
        if (request.getAdminUserId() != null) {
            community.setAdminUserId(request.getAdminUserId());
        }
        this.updateById(community);
    }

    @Override
    public void deleteCommunity(Long id) {
        if (this.getById(id) == null) {
            throw new BusinessException("小区不存在");
        }
        long userCount = usersMapper.selectCount(
                new LambdaQueryWrapper<Users>().eq(Users::getCommunityId, id));
        long deviceCount = devicesMapper.selectCount(
                new LambdaQueryWrapper<Devices>().eq(Devices::getCommunityId, id));
        if (userCount > 0 || deviceCount > 0) {
            throw new BusinessException("该小区下存在用户或设备，无法删除");
        }
        this.removeById(id);
        log.info("删除小区: id={}", id);
    }

    @Override
    public void setAdmin(Long id, Long adminUserId) {
        Community community = this.getById(id);
        if (community == null) {
            throw new BusinessException("小区不存在");
        }
        if (adminUserId == null) {
            community.setAdminUserId(null);
            this.updateById(community);
            return;
        }
        Users admin = usersMapper.selectById(adminUserId);
        if (admin == null) {
            throw new BusinessException("负责人用户不存在");
        }
        // 居民自动升级为小区管理员（方案B：前端可能未成功调用角色提升接口，这里兜底）
        if (Role.RESIDENT.name().equals(admin.getRole())) {
            admin.setRole(Role.COMMUNITY_ADMIN.name());
            usersMapper.updateById(admin);
            log.info("setAdmin 自动将用户 {}({}) 从 RESIDENT 升级为 COMMUNITY_ADMIN", admin.getUsername(), adminUserId);
        }
        if (!Role.COMMUNITY_ADMIN.name().equals(admin.getRole())) {
            throw new BusinessException("负责人必须是小区管理员角色");
        }
        community.setAdminUserId(adminUserId);
        this.updateById(community);
        log.info("设置小区负责人: communityId={}, adminUserId={}", id, adminUserId);
    }

    private Map<Long, String> buildAdminNameMap(List<Community> communities) {
        List<Long> ids = communities.stream()
                .map(Community::getAdminUserId)
                .filter(id -> id != null)
                .distinct()
                .collect(Collectors.toList());
        if (ids.isEmpty()) return Map.of();
        return usersMapper.selectBatchIds(ids).stream()
                .collect(Collectors.toMap(Users::getId, Users::getUsername));
    }

    private CommunityVO toVO(Community community, String adminUsername) {
        return CommunityVO.builder()
                .id(String.valueOf(community.getId()))
                .name(community.getName())
                .address(community.getAddress())
                .adminUserId(community.getAdminUserId() != null ? String.valueOf(community.getAdminUserId()) : null)
                .adminUsername(adminUsername)
                .createdAt(community.getCreatedAt() != null ? String.valueOf(community.getCreatedAt()) : null)
                .build();
    }
}
