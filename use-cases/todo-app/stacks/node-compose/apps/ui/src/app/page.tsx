'use client';
import React from 'react';
import { Box, Container, Heading, Text, Link } from '@chakra-ui/react';
import { Alert } from '@chakra-ui/react';
import TodoList from './components/TodoList';
import { LuExternalLink } from "react-icons/lu";

export default function Home() {
  const isLocal = process.env.NODE_ENV !== 'production';

  return (
    <Container maxW="container.md" py={8}>
      <Box mb={8} textAlign="center">
        <Heading as="h1" size="xl" mb={2}>Todo App</Heading>
        <Text color="gray.600">
          A simple todo application using Next.js and NestJS
        </Text>

        {!isLocal && (
          <Alert.Root status="info" mt={4}>
            <Alert.Indicator />
            <Alert.Title>This application is using free tier cloud services that may take 30+ seconds to start up after inactivity.</Alert.Title>
          </Alert.Root>
        )}
      </Box>

      <TodoList />

      <Box mt={8} pt={6} borderTop="1px" borderColor="gray.200" fontSize="sm" color="gray.500" textAlign="center">
        <Text>
          Todo App — {isLocal ? 'running locally' : 'deployed on Vercel + Render'}
        </Text>
        <Text mt={2}>
          <Link href="https://github.com/Sumit1993/todo-app-ui" color="blue.500">
            View Source on GitHub <LuExternalLink style={{ display: 'inline' }} />
          </Link>
        </Text>
      </Box>
    </Container>
  );
}
