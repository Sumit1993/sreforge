// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://sreforge.sfun.cloud',
  base: '/',
  integrations: [
    starlight({
      title: 'SREForge',
      description:
        'A contamination-controlled, event-triggered evaluation harness for autonomous SWE/SRE agents.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/prismalens/sreforge' },
      ],
      editLink: {
        baseUrl: 'https://github.com/prismalens/sreforge/edit/main/docs/',
      },
      lastUpdated: true,
      sidebar: [
        {
          label: 'Concepts',
          items: [
            { label: 'Overview', link: '/concepts/overview/' },
            { label: 'Taxonomy & profiles', link: '/concepts/taxonomy/' },
            { label: 'Closed-loop verification', link: '/concepts/closed-loop-verification/' },
            { label: 'Contamination control', link: '/concepts/contamination-control/' },
            { label: 'Glossary', link: '/concepts/glossary/' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Quickstart', link: '/guides/quickstart/' },
            { label: 'Run an incident', link: '/guides/run-an-incident/' },
            { label: 'Drive an external agent', link: '/guides/drive-an-agent/' },
            { label: 'Add a use-case', link: '/guides/add-a-use-case/' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI — pnpm forge', link: '/reference/cli/' },
            { label: 'Architecture', link: '/reference/architecture/' },
            { label: 'Scenario format', link: '/reference/scenario-format/' },
            { label: 'Run contract', link: '/reference/run-contract/' },
          ],
        },
        {
          label: 'Project',
          items: [{ label: 'Contributing', link: '/contributing/' }],
        },
      ],
    }),
  ],
});
