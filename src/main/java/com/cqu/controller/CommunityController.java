package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.service.ICommunityService;
import com.cqu.vo.CommunitySaveRequest;
import com.cqu.vo.CommunityVO;
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
 * 小区管理
 */
@RestController
@RequestMapping("/community")
public class CommunityController {

    @Autowired
    private ICommunityService communityService;

    @RequireRole({Role.SYSTEM_ADMIN})
    @PostMapping
    public Result<Long> add(@RequestBody CommunitySaveRequest request) {
        return Result.success(communityService.addCommunity(request));
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @GetMapping
    public Result<PageResult<CommunityVO>> list(@RequestParam(defaultValue = "1") int page,
                                                @RequestParam(defaultValue = "10") int pageSize,
                                                @RequestParam(required = false) String name) {
        return Result.success(communityService.pageCommunities(page, pageSize, name));
    }

    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @GetMapping("/{id}")
    public Result<CommunityVO> detail(@PathVariable Long id) {
        return Result.success(communityService.getCommunity(id));
    }

    @RequireRole({Role.SYSTEM_ADMIN})
    @PutMapping("/{id}")
    public Result<String> update(@PathVariable Long id, @RequestBody CommunitySaveRequest request) {
        communityService.updateCommunity(id, request);
        return Result.success("修改成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN})
    @DeleteMapping("/{id}")
    public Result<String> delete(@PathVariable Long id) {
        communityService.deleteCommunity(id);
        return Result.success("删除成功");
    }

    @RequireRole({Role.SYSTEM_ADMIN})
    @PutMapping("/{id}/admin")
    public Result<String> setAdmin(@PathVariable Long id, @RequestBody Map<String, Long> body) {
        communityService.setAdmin(id, body.get("adminUserId"));
        return Result.success("设置成功");
    }
}
