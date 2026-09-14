"""Small configuration ZIPs: fixed tooling, no model keys, no automatic host installation."""
import io
import json
from pathlib import Path
import zipfile

PI_VERSION = '0.85.1'
TEMPLATES = Path(__file__).resolve().parents[1] / 'resources/pi'


def freeze_pi_templates():
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in ('Start.command', 'Start.cmd', 'Start.ps1', 'bootstrap.mjs', 'pack.py'):
            archive.writestr(name, (TEMPLATES / name).read_bytes())
    return output.getvalue()


def make_pi_package(material, user_id, download_id, platform, frozen_templates):
    manifest = {'schema': 'cognisync-local/1', 'material_id': str(material.id), 'user_id': str(user_id),
                'download_id': str(download_id), 'pi_version': material.configuration['pi_version'], 'platform': platform}
    config = material.configuration
    prompt = ('# 课堂协作约定\n只在当前 project 内处理本任务，不访问其他目录、账户或密钥。'
              '不能读取或改写 evidence、manifest.json、安装脚本。不要替学生伪造理解、操作或日志。'
              '这些是行为约定，不是操作系统沙箱。\n用简短中文和短注释；每次说明当前改哪里及如何验证。\n\n'
              f'# 本次任务\n{config["task"]}\n\n# 教师支持要求\n{config["support"]}\n')
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(frozen_templates)) as templates, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in (['Start.command'] if platform == 'mac' else ['Start.cmd', 'Start.ps1']) + ['bootstrap.mjs', 'pack.py']:
            info = zipfile.ZipInfo(name)
            info.external_attr = (0o100755 if name.endswith('.command') else 0o100644) << 16
            archive.writestr(info, templates.read(name))
        archive.writestr('manifest.json', json.dumps(manifest))
        archive.writestr('AGENTS.md', prompt)
        archive.writestr('project/TASK.md', config['task'])
        archive.writestr('project/main.py', '# 从这里开始\n')
        archive.writestr('使用说明.txt', '1. 解压到一个新的空文件夹，不要放进私人项目。\n'
                          '2. Mac 打开 Start.command；Windows 打开 Start.cmd。首次联网安装 Node、Python 和 Pi，只装在本文件夹。\n'
                          '3. 如果系统阻止脚本、下载失败或需要权限，请找老师；不要关闭安全防护。\n'
                          '4. 在 Pi 用 /login 设置老师单独发的密钥，不要粘贴到聊天。\n'
                          '5. 退出 Pi 后上传 submission.zip；包含代码、AI 会话、启动/退出时间。\n'
                          '安装/模型请求需要互联网。Windows 需 10/11 x64；Mac 支持 Intel/Apple Silicon。\n'
                          'Pi 可运行本机命令，不是隔离沙箱；只在学校批准的实验账户使用。\n'
                          '日志是可修改的本地记录；不能据此直接判定有效学习时长或能力。\n'
                          '关网页不会停止本地 Pi。不要在任务里填写个人隐私；提交前可让老师检查。\n')
    return output.getvalue()
