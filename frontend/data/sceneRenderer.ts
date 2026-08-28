import type { CSSProperties } from 'react';

import { SCENE_LIMITS, resolveSceneColor } from './creativeCapabilities';
import type { PythonGameObject } from '../services/pythonModuleRunner';

/**
 * 通用场景渲染映射。
 *
 * 输入必须是**已经过主线程校验**的对象（`validateSceneState`）：这里只做
 * 「合法字段 → 受控样式」的翻译，不再重复做安全判断，也绝不接受来自 Python
 * 的 HTML/CSS 文本、DOM 选择器或事件处理器。
 *
 * 未使用 V2 字段的旧对象返回空样式，继续沿用 `is-<type>` 的既有皮肤，
 * 因此历史创意卡画面与 V1 一致；未知 type 也能凭 shape/color/label 绘制，
 * 不需要为每个学生创意新增 React 组件。
 */
export const sceneObjectStyle = (object: PythonGameObject): CSSProperties => {
  const style: CSSProperties = {};

  if (object.size) {
    const [width, height] = object.size;
    style.inset = 'auto';
    style.left = '50%';
    style.top = '50%';
    style.width = `${Math.round(width * 100)}%`;
    style.height = `${Math.round(height * 100)}%`;
  }
  if (object.color) style.background = resolveSceneColor(object.color);
  if (object.strokeColor) style.border = `2px solid ${resolveSceneColor(object.strokeColor)}`;
  if (object.opacity !== undefined) style.opacity = object.opacity;
  // 结束遮罩固定在 z-index 20，学生对象最高只能到 10。
  if (object.zIndex !== undefined) style.zIndex = Math.min(object.zIndex, SCENE_LIMITS.maxZIndex) + 1;

  const transforms = [
    object.size ? 'translate(-50%, -50%)' : '',
    object.rotation ? `rotate(${object.rotation}deg)` : '',
  ].filter(Boolean);
  if (transforms.length > 0) style.transform = transforms.join(' ');

  if (object.shape === 'circle') style.borderRadius = '50%';
  if (object.shape === 'rect') style.borderRadius = '12%';
  if (object.shape === 'line') {
    style.borderRadius = '2px';
    if (!object.size) style.inset = '46% 8%';
  }
  if (object.shape === 'text') {
    style.background = 'transparent';
    style.border = '0';
    if (object.color) style.color = resolveSceneColor(object.color);
  }
  return style;
};

const LEGACY_VISUAL_TYPES = ['obstacle', 'wall', 'bomb', 'portal', 'bonus', 'shield'];

export const objectVisualType = (type: string) => (
  LEGACY_VISUAL_TYPES.includes(type) ? type : 'custom'
);

export const sceneObjectClassName = (object: PythonGameObject) => [
  'construction-object',
  `is-${objectVisualType(object.type)}`,
  object.shape ? `has-shape-${object.shape}` : '',
  object.animation && object.animation !== 'none' ? `is-anim-${object.animation}` : '',
].filter(Boolean).join(' ');

/** 旧对象（没有任何 V2 表现字段）应当保持 V1 外观，不带内联样式。 */
export const usesLegacyPresentation = (object: PythonGameObject) => (
  object.shape === undefined
  && object.size === undefined
  && object.color === undefined
  && object.strokeColor === undefined
  && object.opacity === undefined
  && object.rotation === undefined
  && object.zIndex === undefined
  && (object.animation === undefined || object.animation === 'none')
);
