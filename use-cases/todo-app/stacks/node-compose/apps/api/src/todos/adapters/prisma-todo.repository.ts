import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { ITodoRepository, Todo, CreateTodoInput, UpdateTodoInput } from '@todo-app/core';

@Injectable()
export class PrismaTodoRepository implements ITodoRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<Todo[]> {
    const todos = await this.prisma.todo.findMany({
      orderBy: { id: 'asc' },
    });
    return todos.map((t) => ({
      ...t,
      userId: t.userId,
    }));
  }

  async findById(id: number): Promise<Todo | null> {
    const numericId = Number(id);
    const todo = await this.prisma.todo.findUnique({ where: { id: numericId } });
    if (!todo) return null;
    return { ...todo, userId: todo.userId };
  }

  async create(input: CreateTodoInput): Promise<Todo> {
    const todo = await this.prisma.todo.create({
      data: {
        todo: input.todo,
        completed: false,
        userId: Number(input.userId),
      },
    });
    return { ...todo, userId: todo.userId };
  }

  async update(id: number, input: UpdateTodoInput): Promise<Todo> {
    const numericId = Number(id);
    const todo = await this.prisma.todo.update({
      where: { id: numericId },
      data: { completed: input.completed },
    });
    return { ...todo, userId: todo.userId };
  }

  async delete(id: number): Promise<Todo> {
    const numericId = Number(id);
    const todo = await this.prisma.todo.delete({ where: { id: numericId } });
    return { ...todo, userId: todo.userId };
  }
}
