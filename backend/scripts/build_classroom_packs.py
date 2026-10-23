"""Build one teacher preparation archive; never publish or touch student records."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile

from app.services.lesson_pack import freeze, current_course
from app.services.worksheet import catalog, task_text


def build():
    files = {}
    rows = []
    for template in catalog():
        stage = template['lesson_id']
        group = '解构班' if template['condition'] == 'pdt' else '开发班'
        number = int(stage[1:])
        prefix = f'{group}/第{number:02d}课/'
        bundle = freeze(stage)
        files[prefix + '本课任务单.md'] = task_text(template).encode()
        files[prefix + '本课知识.md'] = bundle['curriculum'].encode()
        for name, content in {**bundle['files'], **bundle['starter_files']}.items():
            files[prefix + name] = content.encode()
        rows.append(f'| 第{number}课 | {group} | {template["title"]} |')
    files['教师先读.md'] = (
        '# 第1—5课备课材料\n\n'
        '这是教师核对用材料，不是绑定学生账户的作业包，不能直接作为学生提交包。\n'
        '平台“布置任务”选班→选择本课任务→确认要求→发布；学生登录后下载Mac/Windows包，系统自动加入本人设计与继承工程。\n'
        '课程从第1课开始，不假定已经上过两课。第1课先认识任务、下载与解压任务包、启动SFLS并检查显示环境，再开始第一版贪吃蛇；不继承旧试用或诊断作品。以后每次新建下载文件夹，继续本人上次已收讫代码，不覆盖旧课。\n'
        '两班共同目标/规则/知识/样例/时间与SFLS支架，只有两条思考提示不同。图或文字等价，不要求标准UML。\n'
        '第1—5课与当前PPT同步，第6课迁移任务暂不制作和发布。\n'
        '每课共用一份README，不重复填写两套表。最低一次实测不等于所有验收通过。\n'
        'README由SFLS据原始表达和实际结果整理，学生核对；教师共同口头追问用于核查，不另设每课必填问卷。\n'
        '首次问卷及正式前测由教师另行安排发放；不能用第1课经过教学提示后的作品冒充干预前基线，也不假定基线已收齐。\n'
        '内部C01-C05标识本轮课程；历史L03-L10和旧已发布包保留原编号，不混作当前课次。\n\n'
        '| 课次 | 班级 | 任务 |\n| --- | --- | --- |\n' + '\n'.join(rows) + '\n'
    ).encode()
    manifest = {'schema': 'sfls-teacher-preparation/1', 'version': current_course()[0],
                'purpose': 'teacher_review_not_student_submission',
                'files': [{'path': name, 'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()}
                          for name, value in sorted(files.items())]}
    files['manifest.json'] = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(files.items()):
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
    return output.getvalue()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation avoids overwriting a previously reviewed package.
    with args.output.open('xb') as target:
        target.write(build())
    print(args.output.resolve())
