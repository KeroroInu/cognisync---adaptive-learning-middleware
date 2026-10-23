"""Evidence classification, not a learner score or a claim of causal attribution."""
import hashlib

VERSION = "learning-evidence/v1"


def turn_evidence(code, context=None):
    return {
        "version": VERSION,
        "record_type": "student_report",
        "code_source": "browser_editor_snapshot" if code is not None else "not_supplied",
        "code_snapshot": code,
        "code_sha256": hashlib.sha256(code.encode()).hexdigest() if code is not None else None,
        "stage": context.stage if context else None,
        "focus_id": context.currentModule if context else None,
        "independent_authorship": None,
        "mastery": None,
    }


def evidence_support_prompt(language="zh"):
    if language == "en":
        return """
COGNISYNC_EVIDENCE_SUPPORT_V1
Distinguish supplied records (browser-reported results are not server-verified), student statements, and your tentative inferences. Missing evidence means unknown, not no activity. Questionnaire answers are self-report; graph/profile estimates are not mastery diagnoses.
Respond to this difficulty, not a fixed ability label: syntax -> a tiny example with short comments; relationships -> compare two sequences; verification -> one runnable case. Ask at most one necessary question. Never repeatedly ask for facts already supplied. Preserve this stage and teacher's code-support limits. Giving code is not itself a failure to scaffold.
Observations may directly reference a run; do not demand paraphrasing. Invite an optional prediction or question. A flow diagram should help predict or debug a concrete case, not just contain all symbols. Revisions may revisit earlier stages. Do not impose extra forms or infer understanding from completion, speed, or AI-generated work.
"""
    return """
COGNISYNC_EVIDENCE_SUPPORT_V1
区分系统提供的记录、学生自述、你的待核实推断；浏览器上报的运行结果不是服务端独立验证。缺失记录是未知，不等于学生没有做。问卷是自述，画像和图谱是参考，不能当作能力诊断。
先回应本次困难，不按固定能力标签分配任务：语法困难给小例子和简短注释；关系不清比较两种执行顺序；验证困难给一个可运行的具体情境。最多问一个必要问题，已有资料不要反复问。遵守当前环节和教师代码支持权限，不能把少给代码本身当成好的支架。
观察可以直接引用运行记录，不强迫改写同一句话；可邀请学生补充一个猜想或疑问。流程图用于预测具体情境或定位问题，不只检查符号是否齐全。允许回到前面修订，不新增表格或每步反思；不根据完成数量、速度或AI代写内容宣称学生理解了。
"""
