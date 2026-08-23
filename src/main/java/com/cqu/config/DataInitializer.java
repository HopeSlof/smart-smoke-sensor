package com.cqu.config;

import cn.hutool.crypto.digest.BCrypt;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.cqu.common.enums.Role;
import com.cqu.entity.Community;
import com.cqu.entity.Users;
import com.cqu.mapper.CommunityMapper;
import com.cqu.mapper.UsersMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

/**
 * 启动数据初始化：seed 默认系统管理员与示例小区
 */
@Slf4j
@Component
public class DataInitializer implements CommandLineRunner {

    @Autowired
    private UsersMapper usersMapper;

    @Autowired
    private CommunityMapper communityMapper;

    @Override
    public void run(String... args) {
        initAdmin();
        initDemoCommunity();
    }

    private void initAdmin() {
        Long count = usersMapper.selectCount(new LambdaQueryWrapper<Users>());
        if (count != null && count > 0) {
            return;
        }
        Users admin = new Users();
        admin.setUsername("admin");
        admin.setPassword(BCrypt.hashpw("123456"));
        admin.setRole(Role.SYSTEM_ADMIN.name());
        admin.setStatus("ACTIVE");
        admin.setRealName("系统管理员");
        usersMapper.insert(admin);
        log.info("已初始化默认系统管理员 admin");
    }

    private void initDemoCommunity() {
        Long count = communityMapper.selectCount(new LambdaQueryWrapper<Community>());
        if (count != null && count > 0) {
            return;
        }
        Community community = new Community();
        community.setName("示例小区");
        community.setAddress("示例地址");
        communityMapper.insert(community);
        log.info("已初始化示例小区");
    }
}
