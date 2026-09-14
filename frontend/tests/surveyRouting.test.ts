import { describe, expect, it } from 'vitest';
import { cleanVisibleAnswers, toggleMultiple, validDraftAnswer, visibleQuestions, type AssessmentQuestion } from '../services/assessments';
import survey from '../../backend/app/resources/programming_ai_survey_v1.json';

const questions = survey.questions as AssessmentQuestion[];
describe('survey branches and multiple choices', () => {
  it('skips experience questions for a novice and preserves support questions', () => {
    const ids = visibleQuestions(questions, { q3: 'none', q8: 'never' }).map(q => q.id);
    expect(ids).toEqual(['q1', 'q2', 'q3', 'q8', 'q17', 'q18', 'q19']);
  });
  it('removes downstream answers when the student changes an earlier choice', () => {
    const clean = cleanVisibleAnswers(questions, { q3: 'project', q8: 'never', q11: 'yes', q12: ['generate'], q13: ['run'], q17: ['comments'] });
    expect(clean).not.toHaveProperty('q11'); expect(clean).not.toHaveProperty('q12'); expect(clean).not.toHaveProperty('q13');
    expect(clean.q17).toEqual(['comments']);
  });
  it('handles exclusive options, limits and malformed drafts', () => {
    const q = questions.find(q => q.id === 'q17')!;
    expect(toggleMultiple(q, ['comments', 'blanks'], 'none')).toEqual(['none']);
    expect(toggleMultiple(q, ['none'], 'comments')).toEqual(['comments']);
    expect(toggleMultiple(q, ['comments', 'blanks', 'example'], 'task')).toHaveLength(3);
    expect(validDraftAnswer(q, ['none', 'comments'])).toBe(false);
    expect(validDraftAnswer(q, ['comments', 'comments'])).toBe(false);
    expect(validDraftAnswer(q, ['fake'])).toBe(false);
    expect(validDraftAnswer(q, ['comments', 'blanks'])).toBe(true);
  });
});
