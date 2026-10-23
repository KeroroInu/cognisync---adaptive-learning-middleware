import { useState } from 'react';
import './SflsGuide.css';

export async function copySflsCommand(command: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(command);
    return '已复制';
  } catch {
    return '无法自动复制，请选中命令复制。';
  }
}

function Command({ value, hint }: { value: string; hint: string }) {
  const [status, setStatus] = useState('');
  return <div className="sfls-guide-command">
    <div><code>{value}</code><span>{hint}</span></div>
    <button type="button" aria-label={`复制 ${value}`} onClick={async () => setStatus(await copySflsCommand(value))}>复制</button>
    {status && <span className="sfls-guide-copy-status" role="status">{status}</span>}
  </div>;
}

export function SflsGuide({ expanded = false }: { expanded?: boolean }) {
  return <details className="sfls-guide" open={expanded || undefined}>
    <summary><strong>SFLS 使用指南</strong><span>安装 · 启动 · 交作业</span></summary>
    <div className="sfls-guide-body">
      <ol className="sfls-guide-start">
        <li><strong>下载并解压本课任务包</strong><span>不要直接在 ZIP 里操作，也不要借用别人的任务包。</span></li>
        <li><strong>在任务文件夹打开 SFLS</strong><span>双击 Start，或在这个文件夹打开终端输入 sfls。新下载的本人任务包会自动核对身份，不必再输入学号和密码。</span></li>
        <li><strong>完成后提交</strong><span>在 SFLS 对话里输入 /submit，确认上传，看到成功提示才算交好。</span></li>
      </ol>
      <div className="sfls-guide-group">
        <h3>在电脑终端输入</h3>
        <Command value="sfls" hint="打开本人任务包。首次填写老师给的 API key；新课换 key 时按下方说明更新。" />
      </div>
      <div className="sfls-guide-group">
        <h3>进入 SFLS 后输入</h3>
        <Command value="/task" hint="再看一眼本课要求。平时直接打字和 AI 讨论就好。" />
        <Command value="/play" hint="SFLS 0.1.5 起：用本课 Python 打开作品，游戏窗口就在你的电脑上。" />
        <Command value="/stop" hint="停止通过 /play 打开的作品；也可以直接关闭游戏窗口。先关作品再打包。" />
        <Command value="/submit" hint="确认后提交代码和对话记录；没成功可以再试。" />
        <Command value="/advice" hint="给老师提课程或工具建议（需支持此命令的新版 SFLS）。实名发送，不填密钥；未送达时再次输入重试。" />
        <Command value="/pack" hint="只生成 ZIP、不上传。回到本页选择 submissions 文件夹里生成的 ZIP 文件，再点“上传作品”；不要上传整个文件夹或原任务包。" />
        <Command value="/quit" hint="退出 SFLS，回到电脑终端。" />
      </div>
      <details className="sfls-guide-more"><summary>第一次使用：安装与密钥</summary>
        <p>点击上方“安装 SFLS · Windows”，下载后完整解压，双击 Install.cmd。按提示安装并注册命令，再重新打开终端。只需安装一次，不要把安装包当作本课任务包上传。</p>
        <p>老师已统一安装的电脑无需再装。完整离线安装包自带 Node、Python 和 pygame，任务环境会从本机自动准备，不必另装 pip 或从 GitHub 下载环境；AI 对话仍需联网和老师提供的密钥。模型已有默认设置，不需要每次选择。</p>
        <a href="https://gitee.com/kerorororo/sfls-install" target="_blank" rel="noopener noreferrer">查看安装说明 ↗</a>
        <p>安装受学校电脑限制时请找老师，不要关闭安全防护。密钥填入 SFLS 的配置提示，不要发到 AI 聊天、代码或作业包里。</p>
      </details>
      <details className="sfls-guide-more"><summary>换密钥、继续上次对话、旧任务包登录</summary>
        <p>先用 /quit 退出，再在本课任务文件夹的电脑终端输入：</p>
        <Command value="sfls model" hint="更换 API key：先在智能体中 /quit 退出，再在任务文件夹终端执行此指令，粘贴新 key（输入不显示）。用 sfls run --resume 继续对话。" />
        <p>每节课使用老师当堂发放的 key。老师已停用旧 key 时，需要更新；没有更换且仍有效时可以复用，不用重新安装。</p>
        <Command value="sfls run --resume" hint="继续这个任务文件夹里上次的对话，不是跨课恢复。" />
        <p>新任务包绑定下载者身份。换同学时应登录网页下载自己的任务包，不要借用上一位同学的文件夹。下面的手动登录仅供没有自动身份凭据的旧任务包备用。</p>
        <Command value="sfls login" hint="旧任务包备用：按提示填写平台地址、学号和密码；新下载的本人任务包不用执行。" />
        <Command value="sfls logout" hint="退出平台账户；不会删除本机作品或模型密钥。" />
        <p>共用电脑时，退出账户并按老师要求保管自己的任务文件夹。</p>
      </details>
      <details className="sfls-guide-more"><summary>启动不了怎么办？</summary>
        <p>先确认已经解压，并进入有 sfls-task.json 的任务文件夹。提示找不到 sfls 时，重新打开终端，或尝试双击 Start。</p>
        <p>输入密钥时看不到字符是正常的，粘贴一次后回车。完整离线安装正常时会自动准备本课环境；旧版或缺少离线环境时才可能询问下载，同意才输入 y。学校电脑出现缺 pip 或反复下载提示，请保留报错并找老师，不要反复安装。</p>
        <p>本课 Python 在任务文件夹的 .sfls/environment 内。另开的终端找不到 python，不代表没安装；新版优先用 /play，旧版把报错交给老师，不要反复重装。</p>
        <Command value="sfls doctor" hint="在电脑终端检查环境，把报错给老师看。" />
        <p>提交失败先别删文件。可以 /pack 后手动上传；打包也失败时，请保留整个任务文件夹并联系老师。</p>
      </details>
    </div>
  </details>;
}
