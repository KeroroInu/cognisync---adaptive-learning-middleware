"""Frozen, common trial materials. No solutions, group policy or scoring engine."""
import json
from pathlib import Path
from functools import lru_cache

VERSION = 'snake-classroom/2026-10-14.2'
# New course IDs do not reuse L03–L10, which identify earlier frozen materials.
COURSE_LESSONS = {'C01': 'L03', 'C02': 'L04', 'C03': 'L06', 'C04': 'L08', 'C05': 'L09'}


@lru_cache(maxsize=1)
def current_course():
    source = json.loads((Path(__file__).resolve().parents[1] / 'resources/worksheet_templates.json').read_text())
    return source['template_version'], {row['lesson_id']: row for row in source['lessons']}


def course_text(text, lesson_id):
    if lesson_id not in COURSE_LESSONS:
        return text
    text = text.replace('试用约定：', '共同约定：').replace('阶段编号不等于学校已排定的一节课。', '课程从第1课开始，实际排课由教师确认。')
    for old, new in [('第3—5课', '第1—3课'), ('第9—10课', '第7—8课')]:
        text = text.replace(old, new)
    # Single pass: replacements must not cascade (e.g. old 6→4→2).
    import re
    return re.sub(r'第(\d+)(课|阶段)', lambda m: f'第{int(m[1])-2}{m[2]}' if int(m[1]) >= 3 else m[0], text)
RULES = [
    '试用约定：10×10 棋盘，[行,列] 从 0 开始；默认蛇头 [4,6]，身体 [4,5]、[4,4]，朝右，食物 [4,7]。',
    '每步只上下左右移动一格，不穿墙、不瞬移。普通移动长度不变，进食增长一格、加 1 分；允许进入本步刚腾出的尾格。',
    '从第4课起：相反方向视为撞颈结束；越界或撞到本步仍占用的身体结束。结束后不再移动或加分；没有空格时胜利结束。',
    '方向键/WASD 控制，空格暂停或继续，R 重置。第3阶段每次按键移动一步，可反复操作，不能只走一次就退出；第4阶段起持续前进，每约 360 ms 走一步，玩家按键改变方向，界面保持响应。',
    '第5课起：暂停时点击合法空格放食物；蛇身、障碍或棋盘外点击不改变原目标并给提示。运行中不接受重新放置。',
    '第6课起：地图寻食不随机补食物，吃完给定目标即完成。第9课起有3个目标，每步合法移动计1步，每次进食仍增长1格。',
    '地图测试最多200步；超限、无路或策略失败应停止并如实报告。比较同图同初态的完成情况与步数，不比较动画速度。',
]
CURRICULUM = {
    'L03': '变量保存当前数据；列表保存多个坐标，snake[0] 可以表示蛇头。向右移动时列增加1，行不变。先用纸笔预测一次变化。',
    'L04': 'if/else 区分普通移动、进食和碰撞；循环重复更新状态。先判断这一步是否增长，再考虑尾部是否移走。图形界面循环要处理事件、让出CPU，不能用没有等待的死循环。',
    'L05': '屏幕坐标是[x,y]，游戏坐标是[行,列]。若格宽40，像素[100,60]对应[1,2]。先检查合法，再修改食物数据；仅画一个点不等于目标改变。',
    'L06': '策略负责决定下一方向，移动规则负责执行。可以尝试按坐标靠近目标，或先探索再执行。遇到蛇身和边界要重新判断；一次成功不能证明所有情况都可行。',
    'L07': '列表可以保存障碍坐标；成员判断可以检查位置是否在障碍中。上下左右是候选位置，越界和占用位置需要排除。暂时远离目标有时才能绕开障碍。',
    'L08': '搜索可以记录候选位置和已考虑位置，避免重复。BFS、其他可解释策略都可讨论，不规定唯一算法。计划路径后仍须检查移动中的蛇身和增长，静态通路不等于安全路线。',
    'L09': '用列表保存剩余食物；吃到一个后移除它，再决定下个目标。可比较固定顺序、就近选择、估计路线等思路。近的目标不一定带来最少总步数。',
    'L10': '只改变一项策略，用同图同初态比较修改前后，再换一张地图。保留失败结果；正确性优先于步数，不能修改地图或增长规则来获得更好结果。',
}
CURRICULUM.update({key: CURRICULUM[legacy] for key, legacy in COURSE_LESSONS.items()})


def rules_for(lesson_id):
    if lesson_id in current_course()[1]:
        return list(current_course()[1][lesson_id]['rules'])
    number = int(COURSE_LESSONS.get(lesson_id, lesson_id)[1:])
    indices = [0, 1, 3]
    if number >= 4:
        indices.append(2)
    if number >= 5:
        indices.append(4)
    if number >= 6:
        indices.extend([5, 6])
    return [course_text(RULES[index], lesson_id) for index in sorted(indices)]


def scenarios(lesson_id):
    if lesson_id in current_course()[1]:
        return [case for legacy in current_course()[1][lesson_id]['scenario_sources'] for case in scenarios(legacy)]
    lesson_id = COURSE_LESSONS.get(lesson_id, lesson_id)
    state = {'rows': 10, 'cols': 10, 'snake': [[4, 6], [4, 5], [4, 4]], 'direction': 'RIGHT', 'score': 0, 'obstacles': [], 'step_limit': 200}
    def case(name, foods, note, **changes):
        return {'id': name, **state, 'foods': foods, 'check': note, **changes}
    if lesson_id == 'L03':
        return [case('move-right', [[1, 1]], '向右一步，头[4,7]、长度3。')]
    if lesson_id == 'L04':
        return [case('ordinary', [[1, 1]], '向右一步，头[4,7]、长度3、得分0。'),
                case('eat', [[4, 7]], '向右一步，头[4,7]、长度4、得分1；新食物不在蛇身。'),
                case('edge', [[1, 1]], '向右一步应结束，不增加分数。', snake=[[4, 9], [4, 8], [4, 7]]),
                case('body', [[1, 1]], '向左进入[4,4]，仍被身体占用，应结束。', snake=[[4,5],[5,5],[5,4],[4,4],[3,4]], direction='LEFT'),
                case('vacating-tail', [[1,1]], '向左进入[4,4]是本步腾出的尾格，普通移动合法。', snake=[[4,5],[5,5],[5,4],[4,4]], direction='LEFT')]
    if lesson_id == 'L05':
        return [case('click', [[4, 7]], '暂停后点击[1,2]应改变目标；点击[4,5]或棋盘外应保留原目标并提示。')]
    if lesson_id == 'L06':
        return [case('straight', [[4, 8]], '安全吃到目标。'), case('turn', [[2, 8]], '安全转弯到达。'), case('near-body', [[4, 3]], '不能穿越蛇身；绕行或明确报告当前策略不能完成。')]
    walls = [[r, 7] for r in range(2, 7)]
    if lesson_id in ('L07', 'L08'):
        return [case('detour', [[4, 8]], '应绕过墙，不能穿过[4,7]；点击墙上不得改变目标。', obstacles=walls),
                case('away-first', [[4, 8]], '先暂时远离目标才能绕过封口，记录当前策略能否完成。', obstacles=[[r,7] for r in range(2,8)]+[[2,c] for c in range(4,7)]+[[7,c] for c in range(4,7)]),
                case('enclosed', [[1, 1]], '目标封闭不可达，应停止或报告失败，不能无限循环。', obstacles=[[0,1],[1,0],[1,2],[2,1]])]
    return [case('three-targets-a', [[1, 8], [8, 8], [1, 2]], '固定3个目标，自选顺序；全部吃到后完成，保留步数和失败。', obstacles=walls),
            case('three-targets-b', [[2, 2], [7, 8], [8, 2]], '同样规则的另一地图，用来检查方法局限。', obstacles=[[5,c] for c in range(3,7)])]


def freeze(lesson_id):
    if lesson_id in current_course()[1]:
        return freeze_current(lesson_id)
    if lesson_id not in CURRICULUM:
        return None
    cases = scenarios(lesson_id)
    interface = '''# 怎么使用公共输入输出工具

这是共同显示底座，不是游戏答案。可修改外观或自写绘图，仍遵守公共游戏规则。阶段编号不等于学校已排定的一节课。
环境由 SFLS setup 经确认准备，固定 pygame==2.6.1。来源：https://pypi.org/project/pygame/2.6.1/
先运行 python board.py 检查窗口、按键和点击；关闭窗口结束。它只显示静态数据，不会移动。
请在 project/main.py 写自己的程序，运行 python main.py。SFLS 已在 project 目录工作；依赖安装失败属于环境问题，不算任务失败。

可用接口：
- from board import Board；board = Board() 创建10×10窗口。
- board.events() 返回事件列表：quit、key（UP/DOWN/LEFT/RIGHT/PAUSE/RESET）、click。
- click.position 为[行,列]，棋盘外为None；pixel保留[x,y]，是否接受点击由你判断。
- board.draw(snake, foods, obstacles, score, message) 只画当前数据，不修改游戏。
- board.wait(30) 限制刷新频率并返回经过的毫秒；移动间隔由你决定。不要把30帧误当每秒移动30格。
- board.close() 关闭窗口。message建议短英文，避免机房缺中文字体；其他界面可自行改造。

## 公共样例接口
samples.json 的 cases 是独立初态，不是连续步骤。每次测试重新加载初态，不沿用上次的蛇身和分数。
可让SFLS给 main.py 增加 --case 样例编号，读取 ../materials/samples.json 的对应项，再转换为你的内部数据。
rows/cols：大小；snake：头在前的身体；foods：目标列表；direction：方向；obstacles：障碍；step_limit：上限。
样例没有给出路径或解法。第3—5课按 check 操作；第6课起自动寻食。不是线上OJ，不传网络端口。
第9—10课可额外输出一行JSON：{"case_id":"...","completed":false,"steps":0,"reason":"未完成"}。
completed/steps须由实际运行得到，不把示例数值当结果。老师可以按实际轨迹核对，这不是自动能力评分。
'''
    interface = course_text(interface, lesson_id)
    if lesson_id == 'C01':
        interface += '\n## 第一次使用\n先登录平台、下载并解压自己的任务包，在该文件夹启动SFLS，按提示配置老师提供的密钥并检查环境。先运行board.py确认窗口和按键，再开始第一版程序。不要求有上一课作品；安装或窗口问题先请老师协助，不算编程失败。\n'
    files = {
        'materials/公共规则.md': '# 两班共同规则\n\n版本：'+VERSION+'；供课前核对，教师发布后本次材料冻结。\n\n'+'\n'.join('- '+r for r in rules_for(lesson_id)),
        'materials/运行与接口.md': interface,
        'materials/公开测试.md': '# 本课公开检查\n\n'+'\n'.join(f'- {c["id"]}：{c["check"]}' for c in cases)+'\n\n未实现或未通过如实记录；不要把样例直接写成已通过。',
        'materials/environment.json': json.dumps({'schema': 'sfls-environment/1', 'packages': ['pygame==2.6.1']}),
        'materials/samples.json': json.dumps({'schema': 'snake-cases/1', 'version': VERSION, 'lesson_id': lesson_id, 'cases': cases}, ensure_ascii=False, indent=2),
    }
    board = (Path(__file__).resolve().parents[1] / 'resources/snake_trial/board.py').read_text()
    return {'version': VERSION, 'lesson_id': lesson_id, 'files': files, 'starter_files': {'project/board.py': board}, 'curriculum': CURRICULUM[lesson_id]}


def freeze_current(lesson_id):
    version, lessons = current_course()
    lesson = lessons[lesson_id]
    # Reuse the neutral display utility, never the old eight-lesson instructions.
    bundle = freeze(COURSE_LESSONS[lesson_id])
    bundle.update(version='snake-classroom/' + version, lesson_id=lesson_id, curriculum=lesson['curriculum'])
    cases = scenarios(lesson_id)
    interface = """# 运行与样例

在解压后的本人任务包中启动 SFLS。它在 project 目录工作，运行自己的 main.py。
从第2课起接着本人已交工程修改；已有界面可以保留，不必改用公共显示工具。
可选 board.py 只提供显示与输入，不包含游戏实现：
Board.events() 返回 key、click、quit；click.position 为[行,列]。
Board.draw(snake, foods, obstacles, score, message) 显示当前状态；Board.wait(30) 限制刷新频率，不代表移动间隔。
可让 SFLS 增加 --case 参数读取 ../materials/samples.json。各 case 是独立初态，不连续叠加。
rows/cols 是大小，snake 头在前，foods 是目标列表，obstacles 是障碍，direction 是初始方向，step_limit 是步数上限。
样例只给初态和检查要求，不提供算法或正确路径；没有实测不得标记通过。
"""
    if lesson_id == 'C01':
        bundle['starter_files'] = {}
        if lesson.get('student_brief'):
            interface = ('# 启动与运行\n\n'
                         '完整解压本课任务包，在任务文件夹打开终端输入 `sfls`，或双击 `Start.cmd`（Windows）/ `Start.command`（Mac）。\n'
                         '按提示输入老师提供的 API key；本人下载的新版任务包会自动关联账号。不要把密钥写进代码或 README。\n\n'
                         '程序代码保存在 `project` 里。告诉 SFLS“帮我运行一下”，观察并操作自己的游戏；结束时关闭窗口或输入 `/stop`。\n'
                         '把报错原文或与预期不同的现象告诉 SFLS，一起修改。启动、环境有问题请老师协助。\n\n'
                         '详细目标和步骤见 `本课任务单.md`。提交用 `/submit`，以服务器收件回执为准；备用方式是 `/pack` 后到网页上传 ZIP。\n')
        else:
            interface = ('# 第一次体验\n\n登录本人平台账号，下载并完整解压自己的任务包，在任务文件夹输入 sfls 或双击 Start，按提示输入本课 API key，不用再次输入学号密码。\n'
                     '先自由说明想法，再尝试一个关键问题和少量代码；不会可以请SFLS解释并帮助完成。不要求先画架构图或写需求文档，不需要上一课代码。\n'
                     '结束时结合实际代码简短回顾，再 /submit 并确认收件回执；选择回顾后，讨论结束需再次 /submit。备用：/pack 生成ZIP，再到网页上传ZIP，不上传文件夹。未完成也能交。\n'
                     '环境已由老师课前部署；遇到安装或窗口问题请老师协助，不把环境故障当作编程失败。\n')
    if version == '2026-10-21.1':
        # Ordinary filename is required: SFLS 0.1.20 excludes dot-prefixed
        # entries. Freeze the exact teaching context along with each task.
        guide = (Path(__file__).resolve().parents[1] / 'resources/classroom_agent_support.md').read_text()
        if lesson_id == 'C01':
            guide += ('\n## 第一课共同体验\n\n'
                      '本课两班相同，不实施解构组/开发组差异路径，不强制架构图、需求文档或七个模块。工具演示与问卷后约16分钟体验，最后约5分钟回顾提交。\n'
                      '优先单人基础闭环：方向控制、移动、进食增长、碰撞结束；扩展不是必做。关键试写只抓一个合适节点，例如普通移动与进食的区别；已有代码就沿用，不为试写重做项目。\n'
                      '收尾回到本次真正讨论过的关键逻辑，不临时改考集合推导、元组哈希或尾格腾出的边界特例；学生主动询问可以简短解释。所有未完成、不会或未实测如实保留，不影响提交。\n')
        bundle['files']['materials/00-teacher-guide.md'] = guide
    bundle['files'].update({
        'materials/公共规则.md': '# 本课共同约定\n\n' + '\n'.join('- ' + r for r in lesson['rules']),
        'materials/运行与接口.md': interface,
        'materials/公开测试.md': '# 本课检查\n\n' + '\n'.join('- ' + r for r in lesson['acceptance']) + '\n\n' + lesson['common_test_hint'],
        'materials/samples.json': json.dumps({'schema': 'snake-cases/1', 'version': bundle['version'], 'lesson_id': lesson_id, 'cases': cases}, ensure_ascii=False, indent=2),
    })
    return bundle
