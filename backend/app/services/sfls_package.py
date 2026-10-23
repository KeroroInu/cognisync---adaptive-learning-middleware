"""Bounded SFLS task assembly. No student code is imported or executed."""
import hashlib
import html
import io
import json
import zipfile

from fastapi import HTTPException

from app.services.classroom_files import inspect_zip, MAX_FILE
from app.services.worksheet import context_files, context_binding, learning_context_for_template, task_text
from app.services.drawio import diagram_text
SFLS_VERSION = '0.1.17'
POLICY_VERSION = 'sfls-scaffold/2-draft'
README_TEMPLATE = ('# 我的作品\n\n> AI整理，待学生核对；学生表达引用原话，未提供的内容不代填。\n\n'
                   '## 想做什么\n想解决的问题或实现的效果。\n\n'
                   '## 具体要求\n需要哪些功能？怎样算完成？\n\n'
                   '## 算法与代码实现\n使用了什么数据结构或算法？关键函数怎样实现要求？不清楚的地方可写“待解释”。\n\n'
                   '## 实际结果与差距\n检查操作、预期、实际；注明工具实测 / 学生反馈 / 未验证。\n\n'
                   '## 怎么运行\n启动方式与按键。\n')


def task_contract(material):
    """Use the policy frozen at publication, not the currently installed server policy."""
    config = material.configuration
    contract = {'schema': 'sfls-task/1', 'project_id': config['project_id'], 'task_id': str(material.id),
                'version': str(material.id), 'phase': config['phase'],
                'support': {'schema': 'sfls-support/1', 'mode': 'classroom' if config['phase'] == 'practice' else 'assessment',
                            'policy_version': config.get('policy_version', 'sfls-scaffold/1-draft')}}
    if config['phase'] == 'practice':
        context = learning_context_for_template(config.get('worksheet'))
        if context:
            contract['learning_context'] = context
    return contract


def validate_submission_contract(data, material, download):
    """Retain safe uploads and flag declared configuration differences, not cheating or ability."""
    expected = (download.detail or {}).get('task_contract') or task_contract(material)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        sfls = json.loads(archive.read('manifest.json')).get('sfls', {})
        task = sfls.get('task', {})
        reported = {key: task.get(key) for key in expected}
        differences = [key for key, value in expected.items() if reported.get(key) != value]
        if sfls.get('policy_version') != expected['support']['policy_version']:
            differences.append('runtime_policy_version')
        # Compare nested binding too; the outer manifest was already authenticated.
        binding = task.get('platform')
        if not isinstance(binding, dict) or any(binding.get(key) != value for key, value in {
                'user_id': str(download.user_id), 'material_id': str(material.id), 'download_id': str(download.id)}.items()):
            differences.append('task.platform')
        # Local logs are claims, but detectable contradictions must not be silently accepted.
        if 'evidence/events.jsonl' in archive.namelist():
            for line in archive.read('evidence/events.jsonl').splitlines():
                try:
                    event = json.loads(line)
                except (ValueError, UnicodeError, RecursionError):
                    differences.append('event_log_invalid')
                    break
                if not isinstance(event, dict):
                    differences.append('event_log_invalid')
                    break
                if any(key in event and event[key] != value for key, value in {
                        'phase': expected['phase'], 'task_mode': expected['support']['mode'],
                        'policy': expected['support']['policy_version']}.items()):
                    differences.append('event_mode_or_policy')
                    break
    frozen = bool((download.detail or {}).get('task_contract'))
    status = ('mismatch' if differences else 'matched') if frozen else 'unverified_legacy'
    message = {'matched': '任务配置与下载记录一致；不代表作品正确或本地日志未经修改。',
               'mismatch': '作品已保留，但任务模式或配置与下载记录不一致，请联系老师核对。',
               'unverified_legacy': '作品已保留，旧下载记录没有完整配置快照，需要老师核对。'}[status]
    return {'schema': 'sfls-task-validation/1', 'status': status, 'differences': differences,
            'expected': expected, 'reported': reported, 'message': message,
            'scope': 'declared_configuration_only_not_execution_attestation'}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, indent=2).encode('utf-8')


def design_files(design, folder):
    if not design:
        return {}
    if design.get('drawio_xml'):
        return {f'design/{folder}/requirements.md': ('# 我的需求\n\n' + design.get('requirements', '')).encode(),
                f'design/{folder}/architecture.json': encoded(design),
                f'design/{folder}/architecture.drawio': design['drawio_xml'].encode(),
                f'design/{folder}/architecture.md': diagram_text(design['drawio_xml']).encode()}
    nodes, edges = design.get('nodes', []), design.get('edges', [])
    labels = {node['id']: node['title'] for node in nodes}
    steps = ['# 我的功能架构', '']
    steps.extend(f'- {node["title"]}：{node["purpose"]}' for node in nodes)
    steps.extend(f'- {labels.get(edge["source"], "?")} → {labels.get(edge["target"], "?")}' for edge in edges)
    pieces = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600">', '<rect width="1000" height="600" fill="#faf9f1"/>']
    positions = {node['id']: node for node in nodes}
    for edge in edges:
        a, b = positions.get(edge['source']), positions.get(edge['target'])
        if a and b:
            pieces.append(f'<line x1="{a["x"]+85}" y1="{a["y"]+42}" x2="{b["x"]+85}" y2="{b["y"]+42}" stroke="#73822c" stroke-width="2"/>')
    for node in nodes:
        pieces.append(f'<rect x="{node["x"]}" y="{node["y"]}" width="170" height="84" rx="10" fill="#eff6cb" stroke="#73822c"/>')
        pieces.append(f'<text x="{node["x"]+12}" y="{node["y"]+34}" font-size="16" fill="#222">{html.escape(node["title"])}</text>')
    pieces.append('</svg>')
    return {f'design/{folder}/requirements.md': ('# 我的需求\n\n' + design.get('requirements', '')).encode(),
            f'design/{folder}/architecture.json': encoded(design),
            f'design/{folder}/architecture.md': '\n'.join(steps).encode(),
            f'design/{folder}/architecture.svg': ''.join(pieces).encode()}


def previous_project(data, user_id, project_id, material_id):
    inspect_zip(data, {'schema': 'cognisync-local/1', 'user_id': str(user_id), 'material_id': str(material_id)})
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        sfls = manifest.get('sfls')
        task = sfls.get('task') if isinstance(sfls, dict) else None
        if not isinstance(task, dict) or task.get('project_id') != project_id:
            raise HTTPException(409, '上次作品的课程标记不匹配，请老师检查原件')
        entries = manifest.get('files', [])
        if not isinstance(entries, list):
            raise HTTPException(409, '上次作品缺少文件校验清单')
        if any(not isinstance(item, dict) or not isinstance(item.get('path'), str) or not isinstance(item.get('sha256'), str) for item in entries):
            raise HTTPException(409, '作品文件校验清单格式错误')
        hashes = {item['path']: item['sha256'] for item in entries}
        if len(hashes) != len(entries):
            raise HTTPException(409, '作品文件校验清单有重复路径')
        result = {}
        for info in archive.infolist():
            if not info.is_dir() and info.filename.startswith('project/'):
                content = archive.read(info)
                if hashes.get(info.filename) != hashlib.sha256(content).hexdigest():
                    raise HTTPException(409, '上次作品的文件校验失败；原件仍保留，请老师检查')
                result[info.filename] = content
        if not result:
            raise HTTPException(409, '上次作品没有工程文件，请老师检查原件')
        return result


def make_sfls_package(material, user_id, download_id, platform, initial, current, previous=None, server=None, worksheet_context=None, task_access=None):
    config = material.configuration
    files = {'project/main.py': b'# Start your program here.\n'}
    provenance = {'source': 'teacher_starter', 'initial_design_revision': initial.get('revision') if initial else None,
                  'current_design_revision': current.get('revision') if current else None}
    if worksheet_context and config['phase'] == 'practice':
        provenance['worksheet_context'] = context_binding(worksheet_context)
    if previous:
        files = previous_project(previous['content'], user_id, config['project_id'], previous['material_id'])
        provenance.update(source='server_received_submission', receipt_id=str(previous['id']),
                          material_id=str(previous['material_id']), sha256=hashlib.sha256(previous['content']).hexdigest())
    bundle = config.get('lesson_pack') if config['phase'] == 'practice' else None
    if bundle:
        # Teaching assets are frozen at publication, never read from mutable source at download.
        # Keep the student's inherited board implementation if they have edited it.
        for name, value in bundle['starter_files'].items():
            files.setdefault(name, value.encode())
        files.update({name: value.encode() for name, value in bundle['files'].items()})
        provenance['lesson_pack_version'] = bundle['version']
    if config['phase'] == 'practice' and config.get('worksheet'):
        provenance['lesson_id'] = config['worksheet']['lesson_id']
        provenance['template_version'] = config['worksheet']['template_version']
    binding = {'user_id': str(user_id), 'material_id': str(material.id), 'download_id': str(download_id)}
    if server:
        binding['server'] = server
    task = {**task_contract(material), 'title': material.title, 'platform': binding, 'provenance': provenance}
    # Preserve the student's existing README when continuing a project.
    files.setdefault('project/README.md', README_TEMPLATE.encode())
    files.update({'sfls-task.json': encoded(task), 'materials/TASK.md': config['task'].encode(),
                  'materials/本课知识.md': (config.get('curriculum') or '本课知识范围由老师在课堂说明。').encode()})
    if config.get('agent_guidance'):
        guide_name = 'materials/00-teacher-guide.md'
        # Keep any frozen course guide; append the teacher's task-specific note.
        # This is a hidden teaching reference, never an executable system policy.
        prefix = files.get(guide_name, b'')
        files[guide_name] = prefix + ('\n\n# 教师给 SFLS 的本次任务引导\n\n'
            '以下仅作为本任务的教学参考，不改变统一支架、工具边界或提交要求。\n\n'
            + config['agent_guidance'] + '\n').encode()
    if task_access:
        # Private capability is not teaching context and must never enter the
        # task manifest, inherited project, evidence snapshots or submissions.
        files['.sfls/task-access.json'] = encoded(task_access)
    files.update(design_files(initial, 'initial'))
    files.update(design_files(current, 'current'))
    if config['phase'] == 'practice':
        files.update(context_files(worksheet_context))
        if config.get('worksheet'):
            files['materials/本课任务单.md'] = task_text(config['worksheet']).encode()
        files['materials/作品记录.md'] = (
            '# 本课作品记录\n\n以 project/README.md 作为轻量任务记录，不需要再填一份网页任务单。\n'
            'SFLS 根据已有对话、任务要求和实际代码逐步整理：想做什么、具体要求、实际结果与差距、怎么运行。\n'
            '已有表达不重复问；到功能完成、方案改变或准备提交时再更新，不每轮重写。\n'
            '只对影响目标、验收或关键思路的缺口请学生补一句，允许保留“不确定/待补充”；不得卡住打包或提交。\n'
            '明确区分老师给定要求、学生原话与AI整理；不要用AI生成的解释代替学生已经理解。\n'
            '测试注明工具实测、学生反馈或未验证，不从“看起来好了”推断全部通过。\n'
            '有学生自己的方法或知识解释时可加“我的想法”并引用原话；没有就留待补，不安排额外长问卷。\n'
            '原始对话、版本与工具记录仍随包上传，README只是整理，不能替代原始证据。\n'
        ).encode()
        if config.get('worksheet', {}).get('student_brief') and config['worksheet'].get('lesson_id') == 'C01':
            files['materials/作品记录.md'] = (
                '# 我的作品回顾\n\n'
                '在结束前，请 SFLS 展示一小段今天实际使用的代码，一起回顾：\n\n'
                '- 我原本想做什么？目前完成了哪些功能？\n'
                '- 使用了什么数据或方法？这段代码怎样实现其中一项要求？\n'
                '- 我实际运行、检查了什么？结果与预期有什么不同？\n'
                '- 还有什么没有完成或不太明白？下次想怎样修改？\n\n'
                '让 SFLS 协助整理到 `project/README.md`，补上运行方式与按键，自己核对。'
                '不清楚的地方可以直接提问；没有运行过的功能写“未验证”。\n\n'
                '关闭游戏后输入 `/submit`，看到服务器收件回执才算成功。'
                '若先进入回顾，结束后再输入一次 `/submit`；也可跳过回顾提交当前进度。\n'
            ).encode()
    mode = '课堂练习：按需要提供提示。/direct 仅让下一次请求少追问；/guide 恢复引导。' if config['phase'] == 'practice' else '前后测：自由协作，不主动安排教学问答；/direct 和 /guide 不改变模式。'
    worksheet_help = ('本课用README记录：根据对话整理目标、具体要求和实际结果，只补缺少的部分，不再重复填写网页任务单。\n'
                      'AI整理需注明来源，保留学生原话；没有表达不代填。图和需求变化时可在平台工具包保存并下载给SFLS。\n') if config['phase'] == 'practice' else ''
    start_help = ('3. 双击 Start，或在本文件夹终端输入 sfls；本人下载的任务包会自动核对身份，不用再次输入学号密码。首次输入老师给的 API key，之后同一身份自动复用；老师换密钥时，退出SFLS，在终端运行 sfls model 更新，再运行 sfls。老师提供的离线环境会自动准备。\n'
                  if task_access else
                  '3. 双击 Start：按提示登录本人平台账号、配置老师给的密钥，并确认准备 Python 环境。已有环境会复用，缺少的环境经你确认后下载。\n')
    explanation = (f'# 本课使用说明\n\n{mode}\n任务模式由老师发布的任务包确定；不要修改 sfls-task.json。\n\n'
                   '1. 每课解压到新的文件夹，不覆盖上课工程。\n2. 首次使用，先运行老师提供的 SFLS 安装包。\n'
                   f'{start_help}'
                   '4. 顶部显示当前模式；/task 看任务。也可在本文件夹的终端运行 sfls launch（已全局安装时）。\n'
                   '   SFLS 0.1.6起：直接说“帮我运行一下”或“停一下”；AI可启动本机游戏窗口。也可用 /play、/stop（0.1.5起）。关闭作品后再打包。当前自动运行不支持终端键盘输入；旧版请用本课虚拟环境解释器，不要重装系统Python。\n'
                   '5. /submit 确认后提交；也可 /pack，将 submissions 中的 ZIP 回网页上传。\n\n'
                   f'{worksheet_help}'
                   '结束时检查 project/README.md；学生理解由本人表达，AI不代填。\n'
                   '包含代码、对话、工具输出和设计记录。不要放密码、密钥或私人文件；本人任务包不要转发给其他同学。\n'
                   'SFLS 能执行本机命令，不是沙箱。老师关闭网页提交不等于停止本机 SFLS。\n'
                   'macOS 双击受限时，可在本文件夹的终端运行 bash Start.command；Windows 如被学校策略阻止，请找老师，不要关闭系统安全防护。\n'
                   '安装器不修改系统 PATH 或系统 Python；网络、权限和 Windows 机房兼容性仍需老师课前检查。\n')
    files['使用说明.md'] = explanation.encode()
    if platform == 'mac':
        files['Start.command'] = b'''#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
if [ -f "materials/00-teacher-guide.md" ]; then
  chflags hidden "materials/00-teacher-guide.md" 2>/dev/null || true
fi
if [ -f "$HOME/.sfls-runtime/node-path.txt" ] && [ -f "$HOME/.sfls-runtime/launch.mjs" ]; then
  IFS= read -r SFLS_NODE < "$HOME/.sfls-runtime/node-path.txt"
  "$SFLS_NODE" "$HOME/.sfls-runtime/launch.mjs" launch
elif command -v sfls >/dev/null 2>&1; then
  sfls launch
else
  printf 'Please run the SFLS installer from your teacher first.\\n'
fi
printf 'Press Enter to close... '
read answer
'''
    else:
        files['Start.cmd'] = b'''@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
if exist "materials\\00-teacher-guide.md" attrib +h "materials\\00-teacher-guide.md" >nul 2>&1
if not exist "%USERPROFILE%\\.sfls-runtime\\node-path.txt" goto global
if not exist "%USERPROFILE%\\.sfls-runtime\\launch.mjs" goto global
set /p SFLS_NODE=<"%USERPROFILE%\\.sfls-runtime\\node-path.txt"
"%SFLS_NODE%" "%USERPROFILE%\\.sfls-runtime\\launch.mjs" launch
goto done
:global
where sfls >nul 2>&1
if errorlevel 1 goto missing
call sfls launch
goto done
:missing
echo Please run the SFLS installer from your teacher first.
:done
pause
'''.replace(b'\n', b'\r\n')
    if len(files) > 480 or sum(len(value) for value in files.values()) > 28 * 1024 * 1024:
        raise HTTPException(413, '任务包过大，请老师检查工程资源')
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            info = zipfile.ZipInfo(name)
            info.external_attr = (0o100755 if name.endswith('.command') else 0o100600 if name == '.sfls/task-access.json' else 0o100644) << 16
            if name == 'materials/00-teacher-guide.md':
                # DOS Hidden for extractors that preserve it; the Start script
                # repeats this as a best effort. It is not access control.
                info.external_attr |= 0x02
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
    if out.tell() > MAX_FILE:
        raise HTTPException(413, '任务包超过 10 MiB，请老师检查工程资源')
    return out.getvalue(), provenance
