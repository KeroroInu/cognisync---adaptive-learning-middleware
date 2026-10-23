type ReceiptIdentity = { id?: string | null; name?: string | null; student_id?: string | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const encoder = new TextEncoder();

function filenamePart(value: string | null | undefined, fallback: string, maxBytes: number): string {
  // These are readable labels only, never an authorization or database identity.
  let safe = (typeof value === 'string' ? value : '').normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/\.{2,}/g, '_').replace(/^[._-]+|[._-]+$/g, '');
  if (!safe) safe = fallback;
  if (windowsReserved.test(safe)) safe = '_' + safe;
  let clipped = '';
  for (const character of safe) {
    if (encoder.encode(clipped + character).byteLength > maxBytes) break;
    clipped += character;
  }
  return clipped.replace(/[. ]+$/g, '') || fallback;
}

/** Build a local download label from server-confirmed receipt fields. */
export function receiptFilename(receipt: ReceiptIdentity, title?: string | null): string {
  const id = typeof receipt.id === 'string' && uuid.test(receipt.id)
    ? receipt.id : filenamePart(receipt.id, '未编号', 40);
  return [filenamePart(receipt.student_id, '未实名', 40), filenamePart(receipt.name, '未填写姓名', 48),
    filenamePart(title, '课堂任务', 60), id].join('_') + '.zip';
}
