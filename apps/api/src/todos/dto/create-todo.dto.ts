import { IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateTodoDto {
  @IsString()
  todo: string;

  @IsNumber()
  @IsOptional()
  userId?: number;
}
