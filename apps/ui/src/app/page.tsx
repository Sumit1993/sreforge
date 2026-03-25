'use client';
import React, { useState } from 'react';
import { Box, Container, Heading, Text, Link } from '@chakra-ui/react';
import { Alert, Tabs } from '@chakra-ui/react';
import TodoList from './components/TodoList';
import IssueSimulator from './components/IssueSimulator';
import { LuExternalLink } from "react-icons/lu";

export default function Home() {
  const [activeTab, setActiveTab] = useState("todo");
  const isLocal = process.env.NODE_ENV !== 'production';

  return (
    <Container maxW="container.md" py={8}>
      <Box mb={8} textAlign="center">
        <Heading as="h1" size="xl" mb={2}>Todo App {isLocal ? '(Local Version)' : '(Cloud Version)'}</Heading>
        <Text color="gray.600">
          A simple todo application using Next.js and NestJS {isLocal ? '- running locally' : '- deployed on free cloud services'}
        </Text>
        
        {!isLocal && (
          <Alert.Root status="info" mt={4}>
            <Alert.Indicator />
            <Alert.Title>This application is using free tier cloud services that may take 30+ seconds to start up after inactivity.</Alert.Title>
          </Alert.Root>
        )}
      </Box>

      <Tabs.Root 
        value={activeTab}
        onValueChange={(e) => setActiveTab(e.value)}
        colorPalette="blue"
        variant="enclosed"
      >
        <Tabs.List>
          <Tabs.Trigger value="todo">Todo List</Tabs.Trigger>
          <Tabs.Trigger value="simulator">Issue Simulator</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="todo">
          <TodoList />
        </Tabs.Content>
        <Tabs.Content value="simulator">
          <IssueSimulator />
        </Tabs.Content>
      </Tabs.Root>

      <Box mt={8} pt={6} borderTop="1px" borderColor="gray.200" fontSize="sm" color="gray.500" textAlign="center">
        <Text>
          Todo App - {isLocal ? 'Running locally with Prometheus monitoring' : 'Running on Vercel (Frontend) and Render (Backend) with Prometheus metrics scraping and Grafana Loki logs'}
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
