import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

type RawDocument = Record<string, unknown>;
type QuestionPlan = {
  id: string;
  legacyOptions?: string[];
  correctOptionIndex?: number;
};
type OptionPlan = {
  id: string;
  questionId: string;
  content: string;
  position: number;
  isCorrect: boolean;
};
type AnswerPlan = {
  id: string;
  questionId: string;
  position?: number;
  selectedOptionId?: string;
};

function documents(value: unknown): RawDocument[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) => !item || typeof item !== 'object' || Array.isArray(item),
    )
  ) {
    throw new Error('MongoDB returned an unexpected document list.');
  }
  return value as RawDocument[];
}

function objectId(value: unknown, label: string): string {
  const id =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && '$oid' in value
        ? (value as { $oid: unknown }).$oid
        : undefined;
  if (typeof id !== 'string' || !/^[0-9a-f]{24}$/i.test(id)) {
    throw new Error(`${label}: invalid ObjectId.`);
  }
  return id.toLowerCase();
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}: expected a non-negative integer.`);
  }
  return value;
}

function optionKey(questionId: string, position: number): string {
  return `${questionId}:${position}`;
}

function checkWriteResult(result: Record<string, unknown>): void {
  if (
    result.ok !== 1 ||
    (Array.isArray(result.writeErrors) && result.writeErrors.length > 0) ||
    result.writeConcernError
  ) {
    throw new Error(
      'MongoDB rejected a migration update; rerun after checking the database.',
    );
  }
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.includes('--help')) {
    console.log('Usage: npm run prisma:migrate-options -- [--apply]');
    console.log(
      'Default: validate and report only. --apply converts legacy data without deleting it.',
    );
    return;
  }
  if (flags.some((flag) => flag !== '--apply')) {
    throw new Error('Only --apply and --help are supported.');
  }
  const apply = flags.includes('--apply');
  const prisma = new PrismaClient();

  try {
    const [questionRows, optionRows, answerRows, attemptRows] =
      await Promise.all([
        prisma.question.findRaw({
          options: {
            projection: { _id: 1, options: 1, correctOptionIndex: 1 },
          },
        }),
        prisma.option.findRaw(),
        prisma.attemptAnswer.findRaw({
          options: {
            projection: {
              _id: 1,
              questionId: 1,
              selectedOptionIndex: 1,
              selectedOptionId: 1,
            },
          },
        }),
        prisma.attempt.findRaw({
          options: { projection: { _id: 1, answerVersion: 1 } },
        }),
      ]);

    // Validate the complete snapshot before making any writes.
    const questions = new Map<string, QuestionPlan>();
    for (const row of documents(questionRows)) {
      const id = objectId(row._id, 'Question');
      const question: QuestionPlan = { id };
      if (row.options !== undefined) {
        if (
          !Array.isArray(row.options) ||
          row.options.length === 0 ||
          row.options.some((option) => typeof option !== 'string')
        ) {
          throw new Error(
            `Question ${id}: legacy options must be a non-empty string array.`,
          );
        }
        const correctOptionIndex = integer(
          row.correctOptionIndex,
          `Question ${id}`,
        );
        if (correctOptionIndex >= row.options.length) {
          throw new Error(
            `Question ${id}: correctOptionIndex is out of range.`,
          );
        }
        question.legacyOptions = row.options as string[];
        question.correctOptionIndex = correctOptionIndex;
      }
      questions.set(id, question);
    }

    const optionsByKey = new Map<string, OptionPlan>();
    const optionsById = new Map<string, OptionPlan>();
    for (const row of documents(optionRows)) {
      const id = objectId(row._id, 'Option');
      const questionId = objectId(row.questionId, `Option ${id}`);
      const question = questions.get(questionId);
      const position = integer(row.position, `Option ${id}`);
      if (
        !question ||
        typeof row.content !== 'string' ||
        typeof row.isCorrect !== 'boolean'
      ) {
        throw new Error(
          `Option ${id}: missing question, content or isCorrect.`,
        );
      }
      const key = optionKey(questionId, position);
      if (optionsByKey.has(key)) {
        throw new Error(
          `Question ${questionId}: duplicate option position ${position}.`,
        );
      }
      if (
        question.legacyOptions &&
        (question.legacyOptions[position] !== row.content ||
          (position === question.correctOptionIndex) !== row.isCorrect)
      ) {
        throw new Error(
          `Question ${questionId}: existing options disagree with legacy data.`,
        );
      }
      const option = {
        id,
        questionId,
        content: row.content,
        position,
        isCorrect: row.isCorrect,
      };
      optionsByKey.set(key, option);
      optionsById.set(id, option);
    }

    const answers: AnswerPlan[] = documents(answerRows).map((row) => {
      const id = objectId(row._id, 'Answer');
      const questionId = objectId(row.questionId, `Answer ${id}`);
      const question = questions.get(questionId);
      if (!question) {
        throw new Error(`Answer ${id}: question is missing.`);
      }
      const answer: AnswerPlan = { id, questionId };
      if (row.selectedOptionId !== undefined) {
        // Once converted, the current option ID is authoritative. The retained
        // legacy index is historical and may differ after a student edits it.
        answer.selectedOptionId = objectId(
          row.selectedOptionId,
          `Answer ${id}`,
        );
        const option = optionsById.get(answer.selectedOptionId);
        if (!option || option.questionId !== questionId) {
          throw new Error(
            `Answer ${id}: selectedOptionId disagrees with its question.`,
          );
        }
      } else if (row.selectedOptionIndex !== undefined) {
        answer.position = integer(row.selectedOptionIndex, `Answer ${id}`);
        if (
          !question.legacyOptions ||
          answer.position >= question.legacyOptions.length
        ) {
          throw new Error(
            `Answer ${id}: selectedOptionIndex cannot be mapped to an option.`,
          );
        }
      } else {
        throw new Error(`Answer ${id}: no selected option or legacy index.`);
      }
      return answer;
    });

    const attempts = documents(attemptRows);
    for (const attempt of attempts) {
      const id = objectId(attempt._id, 'Attempt');
      if (attempt.answerVersion !== undefined) {
        integer(attempt.answerVersion, `Attempt ${id}: answerVersion`);
      }
    }

    let newOptions = 0;
    for (const question of questions.values()) {
      question.legacyOptions?.forEach((_, position) => {
        if (!optionsByKey.has(optionKey(question.id, position))) newOptions++;
      });
    }
    const answersToConvert = answers.filter(
      (answer) => !answer.selectedOptionId,
    );
    const attemptsToInitialize = attempts.filter(
      (attempt) => attempt.answerVersion === undefined,
    );
    console.log(
      `Validated ${questions.size} questions and ${answers.length} answers.`,
    );
    console.log(
      `Pending: ${newOptions} options, ${answersToConvert.length} answer links, ${attemptsToInitialize.length} attempt versions.`,
    );
    if (!apply) {
      console.log(
        'Dry run complete. Back up the database and stop API writes before rerunning with --apply.',
      );
      return;
    }

    for (const question of questions.values()) {
      for (const [position, content] of (
        question.legacyOptions ?? []
      ).entries()) {
        const key = optionKey(question.id, position);
        if (optionsByKey.has(key)) continue;
        const isCorrect = position === question.correctOptionIndex;
        const option = await prisma.option.upsert({
          where: { questionId_position: { questionId: question.id, position } },
          update: {},
          create: { questionId: question.id, content, position, isCorrect },
        });
        if (option.content !== content || option.isCorrect !== isCorrect) {
          throw new Error(
            `Question ${question.id}: option changed during migration.`,
          );
        }
        optionsByKey.set(key, option);
      }
    }

    for (const answer of answersToConvert) {
      const selectedOption = optionsByKey.get(
        optionKey(answer.questionId, answer.position!),
      );
      if (!selectedOption)
        throw new Error(
          `Answer ${answer.id}: selected option was not created.`,
        );
      const result = await prisma.$runCommandRaw({
        update: 'Answer',
        updates: [
          {
            q: {
              _id: { $oid: answer.id },
              selectedOptionId: { $exists: false },
            },
            u: { $set: { selectedOptionId: { $oid: selectedOption.id } } },
          },
        ],
      });
      checkWriteResult(result);
      if (result.n !== 1) {
        throw new Error(
          `Answer ${answer.id}: changed during migration; stop API writes and rerun.`,
        );
      }
    }

    const versionsResult = await prisma.$runCommandRaw({
      update: 'Attempt',
      updates: [
        {
          q: { answerVersion: { $exists: false } },
          u: { $set: { answerVersion: 0 } },
          multi: true,
        },
      ],
    });
    checkWriteResult(versionsResult);
    console.log(
      'Migration complete. IDs, scores, answer timestamps and legacy fields were preserved.',
    );
    console.log(
      'Run the dry run again, then prisma db push to create the new indexes.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown migration error.';
  console.error(
    message.replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted database URL]'),
  );
  process.exitCode = 1;
});
