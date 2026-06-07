import type { Todo, CreateTodoInput, UpdateTodoInput } from '../domain/todo.js';

export interface ITodoRepository {
  findAll(): Promise<Todo[]>;
  findById(id: number): Promise<Todo | null>;
  create(input: CreateTodoInput): Promise<Todo>;
  update(id: number, input: UpdateTodoInput): Promise<Todo>;
  delete(id: number): Promise<Todo>;
}
