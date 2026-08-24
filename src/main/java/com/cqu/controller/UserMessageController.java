package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.service.IUserMessageService;
import com.cqu.vo.MessageVO;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 站内消息（居民-管理员双向消息）
 */
@RestController
@RequestMapping("/messages")
public class UserMessageController {

    @Autowired
    private IUserMessageService userMessageService;

    /** 居民发消息给管理员 */
    @RequireRole({Role.RESIDENT})
    @PostMapping
    public Result<String> send(@RequestBody Map<String, String> body) {
        userMessageService.sendMessage(body.get("content"));
        return Result.success("发送成功");
    }

    /** 管理员查消息（系统看全部/小区看本小区） */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @GetMapping
    public Result<List<MessageVO>> list() {
        return Result.success(userMessageService.listMessages());
    }

    /** 居民查「我的消息」含管理员回复 */
    @RequireRole({Role.RESIDENT})
    @GetMapping("/my")
    public Result<List<MessageVO>> listMy() {
        return Result.success(userMessageService.listMyMessages());
    }

    /** 管理员回复居民消息 */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PostMapping("/{id}/reply")
    public Result<String> reply(@PathVariable Long id, @RequestBody Map<String, String> body) {
        userMessageService.replyToMessage(id, body.get("content"));
        return Result.success("回复成功");
    }

    /** 管理员标记已读 */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @PutMapping("/{id}/read")
    public Result<String> markRead(@PathVariable Long id) {
        userMessageService.markRead(id);
        return Result.success("已读");
    }
}
