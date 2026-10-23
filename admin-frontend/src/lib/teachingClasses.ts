/** Teaching destinations. Historical names are not automatically reclassified. */
export const TEACHING_CLASSES = [
  { name: '解构班', group: 'pdt' },
  { name: '开发班', group: 'ai_pbl' },
  { name: '体验组', group: 'experience' },
] as const;
export const isTeachingClass = (name: string) => TEACHING_CLASSES.some(item => item.name === name);
