/** README replaces duplicate forms; existing worksheet evidence is retained. */
export function TaskInstructions({ practice }: { practice: boolean; hasWorksheet: boolean }) {
  return <aside className="studio-record-hint" aria-label="这节课怎么完成">
    <span className="studio-eyebrow">留下你的创作过程</span><h3>边做边聊，最后补齐记录。</h3>
    <p>{practice ? '让 SFLS 根据对话整理 README：想做什么、具体要求、实际结果。只补没有说清楚的地方，不用重新填表。' : '按任务要求完成作品，README 简单说明功能、运行方式和检查结果。'}</p>
    <small>没测试的写“未验证”，还不懂的可以直接说。提交包会一起带上代码、README 和对话记录。</small>
  </aside>;
}
