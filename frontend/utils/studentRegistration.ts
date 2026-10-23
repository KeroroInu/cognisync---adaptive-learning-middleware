/** Only standardize the school's G20xx prefix; preserve legacy account IDs. */
export function normalizeStudentId(value: string): string {
  const trimmed = value.trim();
  return /^g20/i.test(trimmed) ? 'G' + trimmed.slice(1) : trimmed;
}

export function registrationError(data: { name: string; studentId: string; gender: string | null; className: string; password: string }): string {
  if (!data.name.trim() || data.name.trim().length > 50) return '请填写姓名（不超过 50 个字）。';
  if (!['male', 'female'].includes(data.gender || '')) return '请选择性别。';
  if (!/^高[一二三]（[1-7]）班$/.test(data.className)) return '请选择年级和班级。';
  if (!data.studentId.trim() || data.studentId.trim().length > 50 || /\s/.test(data.studentId.trim())) return '请填写完整学号，学号中不要包含空格。';
  if (data.password.length < 6) return '密码至少需要 6 位。';
  if (new TextEncoder().encode(data.password).length > 72) return '密码过长，请使用不超过 72 个英文字符，或较短的中文密码。';
  return '';
}
