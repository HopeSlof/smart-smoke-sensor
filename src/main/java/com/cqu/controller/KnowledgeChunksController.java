package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.service.IKnowledgeChunksService;
import com.cqu.vo.ChatMessageVO;
import com.cqu.vo.ChatRequest;
import com.cqu.vo.ChatResponse;
import com.cqu.vo.ChatSessionVO;
import com.cqu.vo.KnowledgeImportRequest;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * RAG 智能问答与知识库导入、多轮会话
 */
@RestController
@RequestMapping("/knowledge-chunks")
public class KnowledgeChunksController {

    @Autowired
    private IKnowledgeChunksService knowledgeChunksService;

    /** 智能问答（支持多轮：传 sessionId 续接会话） */
    @PostMapping("/chat")
    public Result<ChatResponse> chat(@RequestBody ChatRequest request) {
        return Result.success(knowledgeChunksService.ask(request));
    }

    @RequireRole({Role.SYSTEM_ADMIN})
    @PostMapping("/import")
    public Result<String> importDocuments(@RequestBody KnowledgeImportRequest request) {
        int count = knowledgeChunksService.importDocuments(request);
        return Result.success("成功导入 " + count + " 条知识");
    }

    /** 当前用户会话列表 */
    @GetMapping("/sessions")
    public Result<List<ChatSessionVO>> listSessions() {
        return Result.success(knowledgeChunksService.listSessions());
    }

    /** 会话历史消息 */
    @GetMapping("/sessions/{sessionId}/messages")
    public Result<List<ChatMessageVO>> getMessages(@PathVariable Long sessionId) {
        return Result.success(knowledgeChunksService.getMessages(sessionId));
    }

    /** 删除会话 */
    @DeleteMapping("/sessions/{sessionId}")
    public Result<Void> deleteSession(@PathVariable Long sessionId) {
        knowledgeChunksService.deleteSession(sessionId);
        return Result.success();
    }
}
