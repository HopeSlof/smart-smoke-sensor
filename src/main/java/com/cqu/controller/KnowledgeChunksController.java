package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.service.IKnowledgeChunksService;
import com.cqu.vo.ChatRequest;
import com.cqu.vo.KnowledgeImportRequest;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * RAG 智能问答与知识库导入
 */
@RestController
@RequestMapping("/knowledge-chunks")
public class KnowledgeChunksController {

    @Autowired
    private IKnowledgeChunksService knowledgeChunksService;

    @PostMapping("/chat")
    public Result<String> chat(@RequestBody ChatRequest request) {
        return Result.success(knowledgeChunksService.ask(request.getMessage()));
    }

    @RequireRole({Role.SYSTEM_ADMIN})
    @PostMapping("/import")
    public Result<String> importDocuments(@RequestBody KnowledgeImportRequest request) {
        int count = knowledgeChunksService.importDocuments(request);
        return Result.success("成功导入 " + count + " 条知识");
    }
}
