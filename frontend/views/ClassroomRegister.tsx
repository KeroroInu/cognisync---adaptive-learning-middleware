import React, { useRef, useState } from 'react';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import { Input } from '../components/Input';
import { register } from '../services/api';
import type { RegisterProps } from './Register';
import { normalizeStudentId, registrationError } from '../utils/studentRegistration';
import './StudentAccess.css';

type Props = Pick<RegisterProps, 'language' | 'onRegisterSuccess' | 'onNavigateToLogin'>;

export const ClassroomRegister = ({ onRegisterSuccess, onNavigateToLogin }: Props) => {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [grade, setGrade] = useState('');
  const [classNumber, setClassNumber] = useState('');
  const className = grade && classNumber ? `${grade}（${classNumber}）班` : '';
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const problem = registrationError({ name, studentId, gender, className, password });
    setError(problem);
    if (problem) return;
    pending.current = true;
    setBusy(true);
    try {
      const response = await register({ name: name.trim(), student_id: normalizeStudentId(studentId), gender, schoolClass: className, password, mode: 'classroom' });
      if (!response.success || !response.data?.token) throw new Error('注册未完成，请重试。');
      onRegisterSuccess(response.data.token, response.data.user, 'scale');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(/failed to fetch|networkerror|load failed/i.test(message) ? '暂时连不上服务器。请保留填写内容，稍后再试。' : message || '注册未完成，请重试。');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <main className="student-access">
    <section className="student-access-card" aria-labelledby="register-title">
      <header className="student-access-heading">
        <p className="student-access-brand"><span>SFLS</span> 编程课堂</p>
        <h1 id="register-title">创建课堂账号</h1>
        <p>用学号登录，接收任务、保存作品。</p>
      </header>
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset className="student-access-fields" disabled={busy}>
          <div className="student-access-row">
            <Input label="姓名" placeholder="填写真实姓名" value={name} onChange={event => setName(event.target.value)} autoComplete="name" required maxLength={50} />
            <fieldset className="student-access-choice"><legend>性别</legend>
              <div>{([{ value: 'male', label: '男', icon: '♂' }, { value: 'female', label: '女', icon: '♀' }] as const).map(option =>
                <label key={option.value}><input type="radio" name="gender" value={option.value} checked={gender === option.value} onChange={() => setGender(option.value)} required /><span><i aria-hidden="true">{option.icon}</i>{option.label}</span></label>)}</div>
            </fieldset>
          </div>
          <div className="student-access-row">
            <label>年级<select aria-label="年级" value={grade} onChange={event => setGrade(event.target.value)} required><option value="">请选择年级</option>{['高一', '高二', '高三'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>班级<select aria-label="班级" value={classNumber} onChange={event => setClassNumber(event.target.value)} required><option value="">请选择班级</option>{[1, 2, 3, 4, 5, 6, 7].map(value => <option key={value} value={value}>{value} 班</option>)}</select></label>
          </div>
          <div><Input label="学号（完整序号）" placeholder="G20xx…" value={studentId} onChange={event => setStudentId(event.target.value)} autoComplete="username" autoCapitalize="characters" spellCheck={false} maxLength={50} required aria-describedby="student-id-help" />
            <p id="student-id-help" className="student-access-hint">填写 G 开头、含 20xx 的完整学号，不要只填班内序号。</p></div>
          <div><div className="student-access-password"><Input label="密码" placeholder="设置至少 6 位密码" type={visible ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} minLength={6} maxLength={72} required autoComplete="new-password" aria-describedby="password-help" />
            <button type="button" aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>
            <p id="password-help" className="student-access-hint">请勿使用其他重要账号的密码。</p></div>
        </fieldset>
        {error && <p className="student-access-error" role="alert">{error}</p>}
        <button className="student-access-primary" type="submit" disabled={busy}>{busy ? '正在注册…' : '注册并进入课堂'}{!busy && <ArrowRight size={18} aria-hidden="true" />}</button>
        <button className="student-access-link" type="button" disabled={busy} onClick={onNavigateToLogin}>已有账号？直接登录</button>
      </form>
    </section>
  </main>;
};
