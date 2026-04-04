import { z } from 'zod';

export const TodoSchema = z.object({
  id: z.number().int().positive(),
  todo: z.string().min(1),
  completed: z.boolean().default(false),
  userId: z.number().int().positive(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Todo = z.infer<typeof TodoSchema>;

export const CreateTodoSchema = z.object({
  todo: z.string().min(1),
  userId: z.number().int().positive(),
});

export type CreateTodoInput = z.infer<typeof CreateTodoSchema>;

export const UpdateTodoSchema = z.object({
  completed: z.boolean(),
});

export type UpdateTodoInput = z.infer<typeof UpdateTodoSchema>;
