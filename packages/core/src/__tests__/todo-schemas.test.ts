import { describe, it, expect } from 'vitest';
import { TodoSchema, CreateTodoSchema, UpdateTodoSchema } from '../domain/todo';

describe('TodoSchema', () => {
  const validTodo = {
    id: 1,
    todo: 'Buy groceries',
    completed: false,
    userId: 42,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  it('parses a valid todo', () => {
    const result = TodoSchema.parse(validTodo);
    expect(result).toEqual(validTodo);
  });

  it('defaults completed to false when omitted', () => {
    const { completed, ...withoutCompleted } = validTodo;
    const result = TodoSchema.parse(withoutCompleted);
    expect(result.completed).toBe(false);
  });

  it('rejects non-positive id', () => {
    expect(() => TodoSchema.parse({ ...validTodo, id: 0 })).toThrow();
    expect(() => TodoSchema.parse({ ...validTodo, id: -1 })).toThrow();
  });

  it('rejects non-integer id', () => {
    expect(() => TodoSchema.parse({ ...validTodo, id: 1.5 })).toThrow();
  });

  it('rejects empty todo string', () => {
    expect(() => TodoSchema.parse({ ...validTodo, todo: '' })).toThrow();
  });

  it('rejects non-positive userId', () => {
    expect(() => TodoSchema.parse({ ...validTodo, userId: 0 })).toThrow();
    expect(() => TodoSchema.parse({ ...validTodo, userId: -5 })).toThrow();
  });

  it('rejects non-integer userId', () => {
    expect(() => TodoSchema.parse({ ...validTodo, userId: 1.5 })).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => TodoSchema.parse({})).toThrow();
    expect(() => TodoSchema.parse({ id: 1 })).toThrow();
  });

  it('rejects invalid date types', () => {
    expect(() => TodoSchema.parse({ ...validTodo, createdAt: 'not-a-date' })).toThrow();
  });
});

describe('CreateTodoSchema', () => {
  it('parses valid input', () => {
    const result = CreateTodoSchema.parse({ todo: 'Test', userId: 1 });
    expect(result).toEqual({ todo: 'Test', userId: 1 });
  });

  it('rejects empty todo', () => {
    expect(() => CreateTodoSchema.parse({ todo: '', userId: 1 })).toThrow();
  });

  it('rejects missing todo', () => {
    expect(() => CreateTodoSchema.parse({ userId: 1 })).toThrow();
  });

  it('rejects missing userId', () => {
    expect(() => CreateTodoSchema.parse({ todo: 'Test' })).toThrow();
  });

  it('rejects non-positive userId', () => {
    expect(() => CreateTodoSchema.parse({ todo: 'Test', userId: 0 })).toThrow();
  });

  it('strips unknown fields', () => {
    const result = CreateTodoSchema.parse({ todo: 'Test', userId: 1, extra: 'field' });
    expect(result).toEqual({ todo: 'Test', userId: 1 });
  });
});

describe('UpdateTodoSchema', () => {
  it('parses valid completed=true', () => {
    const result = UpdateTodoSchema.parse({ completed: true });
    expect(result).toEqual({ completed: true });
  });

  it('parses valid completed=false', () => {
    const result = UpdateTodoSchema.parse({ completed: false });
    expect(result).toEqual({ completed: false });
  });

  it('rejects missing completed', () => {
    expect(() => UpdateTodoSchema.parse({})).toThrow();
  });

  it('rejects non-boolean completed', () => {
    expect(() => UpdateTodoSchema.parse({ completed: 'yes' })).toThrow();
    expect(() => UpdateTodoSchema.parse({ completed: 1 })).toThrow();
  });
});
