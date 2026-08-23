package com.cqu.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.cqu.entity.Community;
import com.cqu.vo.CommunitySaveRequest;
import com.cqu.vo.CommunityVO;
import com.cqu.vo.PageResult;

/**
 * 小区服务
 */
public interface ICommunityService extends IService<Community> {

    PageResult<CommunityVO> pageCommunities(int page, int pageSize, String name);

    CommunityVO getCommunity(Long id);

    Long addCommunity(CommunitySaveRequest request);

    void updateCommunity(Long id, CommunitySaveRequest request);

    void deleteCommunity(Long id);

    void setAdmin(Long id, Long adminUserId);
}
