import {
  generateShuffledMapping,
  isShuffledMapping,
  shuffleArray,
} from './shuffling';

describe('shuffling utils', () => {
  describe('shuffleArray', () => {
    it('handles empty and single-element arrays', () => {
      expect(shuffleArray([])).toEqual([]);
      expect(shuffleArray(['a'])).toEqual(['a']);
    });

    it('returns an array containing all original elements without mutation', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const copy = [...original];
      const shuffled = shuffleArray(original);

      expect(original).toEqual(copy);
      expect(shuffled).toHaveLength(original.length);
      expect(shuffled.sort()).toEqual(original.sort());
    });

    it('produces different permutations across multiple runs', () => {
      const items = Array.from({ length: 20 }, (_, i) => i + 1);
      const results = new Set<string>();

      for (let i = 0; i < 10; i++) {
        results.add(shuffleArray(items).join(','));
      }

      // 10 runs of a 20-element array should yield at least 2 distinct orders
      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('generateShuffledMapping', () => {
    it('generates a mapped structure with all question and option IDs', () => {
      const questions = [
        { id: 'q1', options: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }] },
        { id: 'q2', options: [{ id: 'o4' }, { id: 'o5' }] },
      ];

      const mapping = generateShuffledMapping(questions);

      expect(mapping).toHaveLength(2);
      const questionIds = mapping.map((m) => m.questionId).sort();
      expect(questionIds).toEqual(['q1', 'q2']);

      const q1Mapping = mapping.find((m) => m.questionId === 'q1')!;
      expect(q1Mapping.optionIds.sort()).toEqual(['o1', 'o2', 'o3']);

      const q2Mapping = mapping.find((m) => m.questionId === 'q2')!;
      expect(q2Mapping.optionIds.sort()).toEqual(['o4', 'o5']);
    });
  });

  describe('isShuffledMapping', () => {
    it('identifies valid mapping arrays', () => {
      expect(
        isShuffledMapping([
          { questionId: 'q1', optionIds: ['o1', 'o2'] },
          { questionId: 'q2', optionIds: ['o3'] },
        ]),
      ).toBe(true);
    });

    it('rejects invalid or empty values', () => {
      expect(isShuffledMapping(null)).toBe(false);
      expect(isShuffledMapping(undefined)).toBe(false);
      expect(isShuffledMapping([])).toBe(false);
      expect(isShuffledMapping({})).toBe(false);
      expect(isShuffledMapping([{ questionId: 123, optionIds: [] }])).toBe(false);
      expect(isShuffledMapping([{ questionId: 'q1', optionIds: [123] }])).toBe(false);
    });
  });
});
