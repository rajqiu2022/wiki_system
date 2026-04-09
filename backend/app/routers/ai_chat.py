from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict
from datetime import datetime
import httpx
import json
import re
import logging
import asyncio
import uuid as uuid_lib

from ..database import SessionLocal
from ..auth import get_current_user
from ..models import User, Requirement, WikiList, WikiFile, KnowledgeGraph, TypeList
from ..schemas import AIChatRequest, AIChatResponse, RequirementCreate

router = APIRouter(prefix="/api/ai", tags=["ai"])

logger = logging.getLogger(__name__)

# In-memory task tracker for async knowledge graph generation
_kg_tasks: Dict[str, dict] = {}

# Alibaba Coding Plan API config (supports kimi-k2.5 model)
API_URL = "https://coding.dashscope.aliyuncs.com/v1/chat/completions"
API_KEY = "sk-sp-26203a91b43c4ed9ac1e2c072ebeca14"


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


SYSTEM_PROMPT = """你是一个需求管理助手，专门帮助用户创建和管理需求/bug反馈。

你的职责：
1. 帮助用户梳理需求，提取关键信息
2. 根据用户描述，生成结构化的需求标题和描述
3. 当用户明确要求创建需求时，使用工具创建

当用户想要创建需求时，你需要在回复中包含一个特殊标记：
【CREATE_REQUIREMENT】
标题：xxx
类型：feature/bug
优先级：low/medium/high/urgent
描述：xxx
期望完成日期：YYYY-MM-DD（可选）
【END】

注意：
- 类型只能是 feature（新功能）或 bug（问题修复）
- 优先级只能是 low、medium、high、urgent
- 描述要详细，可以包含功能细节、预期效果等
- 如果用户没有指定期望完成日期，可以不写
- 用户消息中的"[用户上传了一张图片]"表示用户粘贴了截图，图片会自动附加到需求中，你在描述中可以提及"参见附图"

请用中文回复用户。"""


KNOWLEDGE_GRAPH_BATCH_PROMPT = """你是一个知识图谱分析专家。我会给你一批wiki文章信息，请分析并提取产品和分类信息。

请严格按照以下JSON格式返回（不要包含任何其他文字，只返回纯JSON）：

{
  "categories": [
    {
      "name": "分类名称",
      "description": "分类描述",
      "article_count": 数量,
      "sub_categories": ["子分类1", "子分类2"]
    }
  ],
  "products": [
    {
      "name": "产品名称",
      "category": "所属分类",
      "related_articles": ["文章标题1"],
      "keywords": ["关键词1", "关键词2"],
      "description": "产品简要描述(20字以内)"
    }
  ],
  "relationships": [
    {
      "source": "产品/分类A",
      "target": "产品/分类B",
      "relation": "关系描述"
    }
  ]
}

要求：
1. 根据文章标题和内容识别产品型号、技术领域
2. 按产品类型（如ESP32、Arduino、显示屏、传感器等）进行分类
3. 识别产品之间的关联关系（兼容性、扩展性等）
4. 产品描述尽量简短，不超过20字
5. 只返回JSON，不要有其他文字"""

KNOWLEDGE_GRAPH_MERGE_PROMPT = """你是一个知识图谱分析专家。我会给你多批次分析的结果（JSON格式），请将它们合并为一个完整的知识图谱。

合并规则：
1. 合并所有categories，相同分类合并article_count和sub_categories
2. 合并所有products，去重（同名产品合并related_articles和keywords）
3. 合并所有relationships，去重
4. 生成整体summary

请严格按照以下JSON格式返回（不要包含任何其他文字，只返回纯JSON）：

{
  "categories": [
    {
      "name": "分类名称",
      "description": "分类描述",
      "article_count": 数量,
      "sub_categories": ["子分类1", "子分类2"]
    }
  ],
  "products": [
    {
      "name": "产品名称",
      "category": "所属分类",
      "related_articles": ["文章标题1", "文章标题2"],
      "keywords": ["关键词1", "关键词2"],
      "description": "产品简要描述(20字以内)"
    }
  ],
  "relationships": [
    {
      "source": "产品/分类A",
      "target": "产品/分类B",
      "relation": "关系描述"
    }
  ],
  "summary": {
    "total_articles": 总文章数,
    "total_categories": 分类数,
    "total_products": 产品数,
    "top_categories": ["最大分类1", "最大分类2", "最大分类3"],
    "overview": "整体知识库概述（100字以内）"
  }
}

只返回JSON，不要有其他文字"""


async def call_ai_api(messages: List[dict], max_tokens: int = 2000) -> str:
    """Call AI API (kimi-k2.5 via Alibaba Coding Plan) for chat completion"""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    
    payload = {
        "model": "kimi-k2.5",
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": max_tokens,
    }
    
    async with httpx.AsyncClient(timeout=300.0) as client:
        response = await client.post(
            API_URL,
            headers=headers,
            json=payload,
        )
        if response.status_code != 200:
            logger.error(f"AI API error: {response.status_code} - {response.text}")
            raise HTTPException(500, f"AI service error: {response.status_code}")
        
        data = response.json()
        return data["choices"][0]["message"]["content"]


def parse_requirement_from_response(content: str) -> dict:
    """Parse requirement data from AI response"""
    pattern = r"【CREATE_REQUIREMENT】(.*?)【END】"
    match = re.search(pattern, content, re.DOTALL)
    
    if not match:
        return None
    
    req_text = match.group(1).strip()
    result = {}
    
    # Parse each field
    title_match = re.search(r"标题[：:]\s*(.+)", req_text)
    if title_match:
        result["title"] = title_match.group(1).strip()
    
    type_match = re.search(r"类型[：:]\s*(\w+)", req_text)
    if type_match:
        req_type = type_match.group(1).strip().lower()
        if req_type in ["feature", "bug"]:
            result["type"] = req_type
    
    priority_match = re.search(r"优先级[：:]\s*(\w+)", req_text)
    if priority_match:
        priority = priority_match.group(1).strip().lower()
        if priority in ["low", "medium", "high", "urgent"]:
            result["priority"] = priority
    
    desc_match = re.search(r"描述[：:]\s*(.+?)(?=期望完成日期|$)", req_text, re.DOTALL)
    if desc_match:
        result["description"] = desc_match.group(1).strip()
    
    date_match = re.search(r"期望完成日期[：:]\s*(\d{4}-\d{2}-\d{2})", req_text)
    if date_match:
        try:
            result["expected_date"] = datetime.strptime(date_match.group(1), "%Y-%m-%d")
        except:
            pass
    
    return result if result.get("title") else None


@router.post("/chat", response_model=AIChatResponse)
async def chat_with_ai(
    request: AIChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Chat with AI to manage requirements (admin only)"""
    if current_user.role != "admin":
        raise HTTPException(403, "Only admin can use AI chat")
    
    # Build messages with system prompt
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in request.messages:
        messages.append({"role": msg.role, "content": msg.content})
    
    # Call AI API
    ai_response = await call_ai_api(messages)
    
    # Check if AI wants to create a requirement
    requirement_created = None
    req_data = parse_requirement_from_response(ai_response)
    
    if req_data:
        # Append user-uploaded image URLs to the requirement description
        description = req_data.get("description", "")
        if request.image_urls:
            img_html = "\n".join(
                f'<img src="{url}" alt="image" style="max-width:100%;border-radius:4px;margin:8px 0;display:block" />'
                for url in request.image_urls
            )
            description = f"{description}\n<br/>\n{img_html}" if description else img_html

        # Create requirement in database
        req = Requirement(
            title=req_data["title"],
            description=description,
            type=req_data.get("type", "feature"),
            priority=req_data.get("priority", "medium"),
            expected_date=req_data.get("expected_date"),
            created_by=current_user.username,
            created_at=datetime.now(),
            status="pending",
        )
        db.add(req)
        db.commit()
        db.refresh(req)
        
        requirement_created = {
            "id": req.id,
            "title": req.title,
            "type": req.type,
            "priority": req.priority,
        }
        
        # Remove the CREATE_REQUIREMENT marker from response
        ai_response = re.sub(r"【CREATE_REQUIREMENT】.*?【END】", "", ai_response, flags=re.DOTALL).strip()
        ai_response += f"\n\n✅ 已创建需求：**{req.title}** (ID: {req.id})"
    
    return AIChatResponse(
        content=ai_response,
        requirement_created=requirement_created,
    )


@router.post("/knowledge-graph/generate")
async def generate_knowledge_graph(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start async knowledge graph generation. Returns task_id immediately."""
    if current_user.role != "admin":
        raise HTTPException(403, "Only admin can generate knowledge graph")
    
    # Check if there's already a running task
    for tid, task_info in _kg_tasks.items():
        if task_info["status"] == "running":
            return {
                "task_id": tid,
                "status": "running",
                "message": "A knowledge graph generation is already in progress",
                "progress": task_info.get("progress", ""),
            }
    
    # Fetch all published articles (publish_status=0 means published)
    published_docs = (
        db.query(WikiList)
        .filter(WikiList.status != 1)  # Not deleted
        .filter(WikiList.publish_status == 0)  # Published
        .all()
    )
    
    if not published_docs:
        raise HTTPException(400, "No published articles found")
    
    # Build article info list with content excerpts
    article_infos = []
    for doc in published_docs:
        wiki_file = (
            db.query(WikiFile)
            .filter(WikiFile.list_id == doc.id)
            .order_by(WikiFile.id.desc())
            .first()
        )
        content_excerpt = ""
        if wiki_file and wiki_file.content:
            raw = wiki_file.content[:300]
            raw = re.sub(r'!\[.*?\]\(.*?\)', '', raw)
            raw = re.sub(r'\[([^\]]*)\]\(.*?\)', r'\1', raw)
            raw = re.sub(r'[#*`>|]', '', raw)
            content_excerpt = raw.strip()
        
        article_infos.append({
            "title": doc.name,
            "path": doc.path or "",
            "excerpt": content_excerpt,
        })
    
    nav_categories = _extract_nav_categories(db)
    
    # Create task ID and start background task
    task_id = str(uuid_lib.uuid4())[:8]
    _kg_tasks[task_id] = {
        "status": "running",
        "progress": f"Starting... ({len(article_infos)} articles)",
        "username": current_user.username,
        "started_at": datetime.now().isoformat(),
    }
    
    # Launch background task
    asyncio.create_task(
        _run_kg_generation(task_id, article_infos, nav_categories, current_user.username)
    )
    
    return {
        "task_id": task_id,
        "status": "running",
        "message": f"Knowledge graph generation started for {len(article_infos)} articles",
        "progress": _kg_tasks[task_id]["progress"],
    }


async def _run_kg_generation(task_id: str, article_infos: list, nav_categories: list, username: str):
    """Background task to generate knowledge graph"""
    db = SessionLocal()
    try:
        categories_text = "\n".join([
            f"- {cat}" for cat in nav_categories
        ]) if nav_categories else "无分类信息"
        
        BATCH_SIZE = 40
        batches = [article_infos[i:i + BATCH_SIZE] for i in range(0, len(article_infos), BATCH_SIZE)]
        batch_results = []
        
        logger.info(f"[Task {task_id}] Knowledge graph: processing {len(article_infos)} articles in {len(batches)} batches")
        
        for batch_idx, batch in enumerate(batches):
            _kg_tasks[task_id]["progress"] = f"Analyzing batch {batch_idx + 1}/{len(batches)} ({len(batch)} articles)"
            logger.info(f"[Task {task_id}] Processing batch {batch_idx + 1}/{len(batches)} ({len(batch)} articles)")
            
            articles_text = "\n".join([
                f"- 标题: {a['title']}, 分类路径: {a['path']}, 内容摘要: {a['excerpt'][:150]}"
                for a in batch
            ])
            
            user_message = f"""以下是第 {batch_idx + 1} 批文章（共 {len(batches)} 批），本批 {len(batch)} 篇：

## 导航分类结构
{categories_text}

## 文章列表
{articles_text}

请分析以上文章，提取产品和分类信息。"""
            
            messages = [
                {"role": "system", "content": KNOWLEDGE_GRAPH_BATCH_PROMPT},
                {"role": "user", "content": user_message},
            ]
            
            try:
                ai_response = await call_ai_api(messages, max_tokens=4000)
                batch_data = _extract_json_from_response(ai_response)
                
                if batch_data:
                    batch_results.append(batch_data)
                    logger.info(f"[Task {task_id}] Batch {batch_idx + 1} parsed successfully")
                else:
                    logger.warning(f"[Task {task_id}] Batch {batch_idx + 1} failed to parse JSON, skipping")
            except Exception as batch_err:
                logger.warning(f"[Task {task_id}] Batch {batch_idx + 1} failed: {batch_err}")
        
        if not batch_results:
            kg = KnowledgeGraph(
                graph_data="{}",
                article_count=len(article_infos),
                generated_at=datetime.now(),
                generated_by=username,
                status="failed",
                message="All batches failed to parse",
            )
            db.add(kg)
            db.commit()
            _kg_tasks[task_id]["status"] = "failed"
            _kg_tasks[task_id]["progress"] = "All batches failed"
            return
        
        # --- Merge batch results ---
        _kg_tasks[task_id]["progress"] = "Merging results..."
        
        if len(batch_results) == 1:
            graph_data = batch_results[0]
            if "summary" not in graph_data:
                graph_data["summary"] = _build_summary(graph_data, len(article_infos))
        else:
            graph_data = _merge_batch_results(batch_results, len(article_infos))
            
            try:
                _kg_tasks[task_id]["progress"] = "AI optimizing merged results..."
                merge_msg = f"""以下是对 {len(article_infos)} 篇文章分 {len(batches)} 批分析后的合并结果，请优化合并并生成最终知识图谱：

{json.dumps(graph_data, ensure_ascii=False)}"""
                merge_messages = [
                    {"role": "system", "content": KNOWLEDGE_GRAPH_MERGE_PROMPT},
                    {"role": "user", "content": merge_msg},
                ]
                merge_response = await call_ai_api(merge_messages, max_tokens=4000)
                refined_data = _extract_json_from_response(merge_response)
                if refined_data:
                    graph_data = refined_data
                    logger.info(f"[Task {task_id}] AI merge refinement successful")
            except Exception as merge_err:
                logger.warning(f"[Task {task_id}] AI merge refinement failed, using local merge: {merge_err}")
        
        if "summary" not in graph_data:
            graph_data["summary"] = _build_summary(graph_data, len(article_infos))
        
        # Save successful result
        kg = KnowledgeGraph(
            graph_data=json.dumps(graph_data, ensure_ascii=False),
            article_count=len(article_infos),
            generated_at=datetime.now(),
            generated_by=username,
            status="completed",
            message=f"Successfully analyzed {len(article_infos)} articles in {len(batches)} batches ({len(batch_results)} succeeded)",
        )
        db.add(kg)
        db.commit()
        db.refresh(kg)
        
        _kg_tasks[task_id]["status"] = "completed"
        _kg_tasks[task_id]["progress"] = f"Done! Analyzed {len(article_infos)} articles"
        _kg_tasks[task_id]["result_id"] = kg.id
        logger.info(f"[Task {task_id}] Knowledge graph generation completed successfully")
        
    except Exception as e:
        logger.error(f"[Task {task_id}] Knowledge graph generation failed: {e}")
        try:
            kg = KnowledgeGraph(
                graph_data="{}",
                article_count=len(article_infos),
                generated_at=datetime.now(),
                generated_by=username,
                status="failed",
                message=str(e),
            )
            db.add(kg)
            db.commit()
        except Exception:
            pass
        _kg_tasks[task_id]["status"] = "failed"
        _kg_tasks[task_id]["progress"] = f"Failed: {str(e)[:100]}"
    finally:
        db.close()


@router.get("/knowledge-graph/task/{task_id}")
async def get_kg_task_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
):
    """Poll the status of a knowledge graph generation task"""
    if current_user.role != "admin":
        raise HTTPException(403, "Only admin can view knowledge graph")
    
    task_info = _kg_tasks.get(task_id)
    if not task_info:
        raise HTTPException(404, "Task not found")
    
    return {
        "task_id": task_id,
        "status": task_info["status"],
        "progress": task_info.get("progress", ""),
        "result_id": task_info.get("result_id"),
    }


def _merge_batch_results(batch_results: List[dict], total_articles: int) -> dict:
    """Merge multiple batch analysis results into one knowledge graph"""
    merged_categories = {}  # name -> category dict
    merged_products = {}    # name -> product dict
    merged_relationships = []  # list of relationship dicts
    seen_rels = set()  # for dedup
    
    for batch in batch_results:
        # Merge categories
        for cat in batch.get("categories", []):
            name = cat.get("name", "")
            if not name:
                continue
            if name in merged_categories:
                existing = merged_categories[name]
                existing["article_count"] = existing.get("article_count", 0) + cat.get("article_count", 0)
                existing_subs = set(existing.get("sub_categories", []))
                existing_subs.update(cat.get("sub_categories", []))
                existing["sub_categories"] = list(existing_subs)
            else:
                merged_categories[name] = {
                    "name": name,
                    "description": cat.get("description", ""),
                    "article_count": cat.get("article_count", 0),
                    "sub_categories": list(cat.get("sub_categories", [])),
                }
        
        # Merge products
        for prod in batch.get("products", []):
            name = prod.get("name", "")
            if not name:
                continue
            if name in merged_products:
                existing = merged_products[name]
                existing_articles = set(existing.get("related_articles", []))
                existing_articles.update(prod.get("related_articles", []))
                existing["related_articles"] = list(existing_articles)
                existing_kw = set(existing.get("keywords", []))
                existing_kw.update(prod.get("keywords", []))
                existing["keywords"] = list(existing_kw)
            else:
                merged_products[name] = {
                    "name": name,
                    "category": prod.get("category", ""),
                    "related_articles": list(prod.get("related_articles", [])),
                    "keywords": list(prod.get("keywords", [])),
                    "description": prod.get("description", ""),
                }
        
        # Merge relationships
        for rel in batch.get("relationships", []):
            key = (rel.get("source", ""), rel.get("target", ""), rel.get("relation", ""))
            if key not in seen_rels:
                seen_rels.add(key)
                merged_relationships.append(rel)
    
    result = {
        "categories": list(merged_categories.values()),
        "products": list(merged_products.values()),
        "relationships": merged_relationships,
        "summary": _build_summary(
            {"categories": list(merged_categories.values()), "products": list(merged_products.values())},
            total_articles
        ),
    }
    return result


def _build_summary(graph_data: dict, total_articles: int) -> dict:
    """Build summary from graph data"""
    categories = graph_data.get("categories", [])
    products = graph_data.get("products", [])
    # Sort categories by article_count descending
    sorted_cats = sorted(categories, key=lambda c: c.get("article_count", 0), reverse=True)
    top_cats = [c["name"] for c in sorted_cats[:3]]
    return {
        "total_articles": total_articles,
        "total_categories": len(categories),
        "total_products": len(products),
        "top_categories": top_cats,
        "overview": f"知识库共收录 {total_articles} 篇文章，涵盖 {len(categories)} 个产品分类和 {len(products)} 个产品型号。",
    }


@router.get("/knowledge-graph/latest")
async def get_latest_knowledge_graph(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the latest successfully generated knowledge graph"""
    if current_user.role != "admin":
        raise HTTPException(403, "Only admin can view knowledge graph")
    
    kg = (
        db.query(KnowledgeGraph)
        .filter(KnowledgeGraph.status == "completed")
        .order_by(KnowledgeGraph.id.desc())
        .first()
    )
    
    if not kg:
        return None
    
    try:
        graph_data = json.loads(kg.graph_data)
    except (json.JSONDecodeError, TypeError):
        graph_data = {}
    
    return {
        "id": kg.id,
        "graph_data": graph_data,
        "article_count": kg.article_count,
        "generated_at": kg.generated_at.isoformat() if kg.generated_at else None,
        "generated_by": kg.generated_by,
        "status": kg.status,
        "message": kg.message,
    }


@router.get("/knowledge-graph/history")
async def get_knowledge_graph_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get knowledge graph generation history"""
    if current_user.role != "admin":
        raise HTTPException(403, "Only admin can view knowledge graph history")
    
    records = (
        db.query(KnowledgeGraph)
        .order_by(KnowledgeGraph.id.desc())
        .limit(20)
        .all()
    )
    
    return [
        {
            "id": r.id,
            "article_count": r.article_count,
            "generated_at": r.generated_at.isoformat() if r.generated_at else None,
            "generated_by": r.generated_by,
            "status": r.status,
            "message": r.message,
        }
        for r in records
    ]


def _extract_nav_categories(db: Session) -> List[str]:
    """Extract category names from nav tree for knowledge graph context"""
    import yaml
    import os
    
    # Try to read from mkdocs.yml - check multiple possible locations
    _BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if os.path.basename(_BASE_DIR) == "backend":
        _PROJECT_ROOT = os.path.normpath(os.path.join(_BASE_DIR, ".."))
    else:
        _PROJECT_ROOT = _BASE_DIR
    
    # Check multiple possible paths for mkdocs.yml
    possible_paths = [
        os.path.join(_PROJECT_ROOT, "mkdocs.yml"),
        os.path.join(_PROJECT_ROOT, "mkdocs-config", "mkdocs.yml"),
        os.path.join(_PROJECT_ROOT, "mkdocs-site", "mkdocs.yml"),
        "/app/mkdocs-config/mkdocs.yml",
        "/app/mkdocs-site/mkdocs.yml",
    ]
    mkdocs_path = None
    for p in possible_paths:
        if os.path.isfile(p):
            mkdocs_path = p
            break
    
    if not mkdocs_path:
        return []
    try:
        with open(mkdocs_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        nav = config.get("nav", [])
        categories = []
        _collect_categories(nav, "", categories)
        return categories
    except Exception:
        return []


def _collect_categories(nav_items: list, prefix: str, result: list):
    """Recursively collect category names from mkdocs nav"""
    for item in nav_items:
        if isinstance(item, dict):
            for key, value in item.items():
                path = f"{prefix}/{key}" if prefix else key
                if isinstance(value, list):
                    result.append(path)
                    _collect_categories(value, path, result)


def _extract_json_from_response(text: str) -> dict:
    """Try to extract JSON object from AI response text"""
    # Try direct parse
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass
    
    # Try to find JSON block in markdown code fence
    json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1).strip())
        except (json.JSONDecodeError, TypeError):
            pass
    
    # Try to find JSON object pattern
    brace_match = re.search(r'\{[\s\S]*\}', text)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except (json.JSONDecodeError, TypeError):
            pass
    
    return None
