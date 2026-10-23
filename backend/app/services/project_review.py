"""Server-only check and rubric, authorization and frozen student source files."""
from contextvars import ContextVar
from sqlalchemy import select
from fastapi import HTTPException
from app.models.sql.project_review import ProjectReviewResponse
from app.services.common_support import digest

review_dispatch_check = ContextVar('review_dispatch_check', default=None)

TEMPLATE = {
    'version': 'snake-review/v1', 'source': '自编课堂理解核查；待教师审阅，非验证量表',
    'questions': [
        {'id': 'q1', 'title': '找到移动的代码', 'text': '选中自己代码中“蛇向当前方向移动一格”的片段。新蛇头的位置怎样得到？没有吃到食物时，蛇尾怎样处理？两句即可。', 'max_length': 200},
        {'id': 'q2', 'title': '先想，再判断', 'text': '这是统一阅读题，不一定是你的写法。仅把条件中的 == 改为 !=，其他不变，运行后输出什么？用一句话说明理由。',
         'code': 'snake = [(3, 2), (2, 2), (1, 2)]\nfood = (3, 2)\nscore = 0\nif snake[0] == food:\n    snake.append(snake[-1])\n    score = score + 10\nprint(len(snake), score)',
         'options': ['4 10', '3 0', '4 0', '3 10'], 'max_length': 150},
        {'id': 'q3', 'title': '用自己的游戏验证', 'text': '分别检查一次普通移动和一次吃到食物。先选预期，再运行并记录长度变化。无法运行也可以说明原因。', 'max_length': 150},
    ],
    'rubric': {
        'q1': ['定位相关更新代码（1分）', '结合代码解释新蛇头坐标与方向（1分）', '解释普通移动尾部处理及长度不变（1分）'],
        'q2': ['预测输出 3 0（1分）', '蛇头与食物相同，!= 为假（1分）', '分支不执行，长度和分数不变（1分）'],
        'q3': ['普通移动情境与预期合理（1分）', '进食情境与预期合理（1分）', '实际记录可核对且区分两情境（1分）', '结论符合证据（1分）'],
        'notes': '接纳等价实现；代码有错但能解释实际与预期的区别仍可得理解分。不按字数/关键词自动评分；不能运行保留原因，不自动给0。10分只用于本次课堂核查，不写入mastery。',
    },
}


def student_template(template):
    return {'version': template['version'], 'questions': template['questions']}


async def held(db, user_id, since=None):
    condition = ProjectReviewResponse.ai_hold.is_(True)
    if since is not None:
        condition = condition | (ProjectReviewResponse.created_at >= since)
    return bool(await db.scalar(select(ProjectReviewResponse.id).where(
        ProjectReviewResponse.user_id == user_id, condition).limit(1)))


def hold_error():
    return HTTPException(423, detail={'code': 'PROJECT_REVIEW_HOLD', 'message': '项目回顾期间暂停站内 AI，请完成回顾并等待老师结束本轮。'})


def freeze_source(submission):
    workspace = submission.workspace_data or {} if submission else {}
    basic = workspace.get('basicSnake') or {}
    if basic.get('runtime') == 'basic-snake/v1' and isinstance(basic.get('code'), str):
        result = {'files': {'main.py': basic['code']}, 'runtime': 'basic-snake/v1',
                  'creative_functions': [], 'source': 'server_saved_submission',
                  'submission_id': str(submission.id),
                  'note': '冻结服务器已保存的基础贪吃蛇代码，10×10、按键分步运行；不是正确性证明。'}
        return result, digest(result)
    files = {}
    if submission and submission.code_submitted:
        files['main.py'] = submission.code_submitted
    for key, value in (workspace.get('progress') or {}).items():
        if isinstance(value, dict) and isinstance(value.get('code'), str):
            files[str(key)[:200]] = value['code']
    for card in workspace.get('creativeFunctions', []):
        if isinstance(card, dict) and isinstance(card.get('code'), str):
            files['creative:' + str(card.get('id', 'unknown'))[:160]] = card['code']
    if len(files) > 60 or sum(len(v) for v in files.values()) > 200000:
        raise HTTPException(413, '作品过大，请老师协助处理；未截断或覆盖作品')
    creative = [{k: card.get(k) for k in ('id', 'title', 'hook', 'code', 'enabled', 'verified', 'updatedAt')}
                for card in workspace.get('creativeFunctions', []) if isinstance(card, dict) and isinstance(card.get('code'), str)]
    result = {'files': files, 'creative_functions': creative, 'source': 'server_saved_submission', 'submission_id': str(submission.id) if submission else None,
              'note': '冻结服务器已保存版本。缺失函数可能由现有预览器辅助装配；不是独立运行正确性证明。'}
    return result, digest(result)
