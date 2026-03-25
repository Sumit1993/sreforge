'use client';
import React, { useState } from 'react';
import { Box, Input, Button, Stack } from '@chakra-ui/react';

interface TodoFormProps {
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

const TodoForm: React.FC<TodoFormProps> = ({ onSubmit, onCancel }) => {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      onSubmit(text);
      setText('');
    }
  };

  return (
    <Box as="form" onSubmit={handleSubmit}>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter a new todo"
        mb={2}
        autoFocus
      />
      <Stack direction="row" gap={2}>
        <Button type="submit" colorPalette="blue" disabled={!text.trim()}>
          Add
        </Button>
        <Button onClick={onCancel} variant="outline">
          Cancel
        </Button>
      </Stack>
    </Box>
  );
};

export default TodoForm; 